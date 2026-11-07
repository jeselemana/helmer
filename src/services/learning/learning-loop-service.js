import { randomUUID } from "node:crypto";
import { estimateCost, learningConfig } from "./config.js";
import { calculateQualityScore } from "./quality-score.js";
import { sanitizeRelevantContext, sanitizeTrainingText } from "./sanitizer.js";

function asText(value, limit) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return text.slice(0, limit);
}

function usageFields(usage = {}) {
  const safeUsage = usage || {};
  const inputTokens = Number(safeUsage.input_tokens ?? safeUsage.prompt_tokens);
  const outputTokens = Number(safeUsage.output_tokens ?? safeUsage.completion_tokens);
  const totalTokens = Number(safeUsage.total_tokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
    totalTokens: Number.isFinite(totalTokens)
      ? totalTokens
      : Number.isFinite(inputTokens) && Number.isFinite(outputTokens) ? inputTokens + outputTokens : null,
  };
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

function isGroundedInteraction(item) {
  if (!item) return false;
  return Boolean(
    item.groundingActive === true ||
    item.mode === "ask_research" ||
    item.taskType === "deep_research" ||
    item.groundingMetadata?.groundingChunks?.length ||
    item.groundingMetadata?.webSearchQueries?.length ||
    item.groundingMetadata?.searchSuggestions?.length ||
    item.groundingMetadata?.searchEntryPoint ||
    (item.relevantContext && (item.relevantContext.searchGrounded || item.relevantContext.groundingActive))
  );
}

export class LearningLoopService {
  constructor(repository, config = learningConfig, privacyPolicy = null) {
    this.repository = repository;
    this.config = config;
    this.privacyPolicy = privacyPolicy;
  }

  async readVisibleStore() {
    const store = structuredClone(await this.repository.readStore());
    const groundedIds = new Set(
      store.interactions.filter((item) => isGroundedInteraction(item)).map((item) => item.id),
    );
    for (const item of store.interactions) {
      if (groundedIds.has(item.id)) {
        item.onlyNecessaryData = true;
        item.modelImprovement = false;
        item.userPrompt = "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]";
        item.modelResponse = "[Məzmun gizlədilib - Töhfə deaktivdir]";
        item.relevantContext = null;
      }
    }
    if (!this.privacyPolicy) {
      if (groundedIds.size > 0) {
        store.candidates = store.candidates.filter((item) => !groundedIds.has(item.sourceInteractionId));
        store.iterations = store.iterations.filter((item) => !groundedIds.has(item.parentInteractionId));
      }
      return store;
    }
    const owners = new Map();
    for (const item of store.interactions) {
      if (!owners.has(item.ownerId)) owners.set(item.ownerId, await this.privacyPolicy.allows(item.ownerId));
      if (!owners.get(item.ownerId) || item.onlyNecessaryData || item.modelImprovement === false) {
        item.onlyNecessaryData = true; item.modelImprovement = false;
        item.userPrompt = "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]";
        item.modelResponse = "[Məzmun gizlədilib - Töhfə deaktivdir]"; item.relevantContext = null;
      }
    }
    const restricted = new Set(store.interactions.filter(item => item.onlyNecessaryData).map(item => item.id));
    store.candidates = store.candidates.filter(
      (item) => !restricted.has(item.sourceInteractionId) && !groundedIds.has(item.sourceInteractionId),
    );
    store.iterations = store.iterations.filter(
      (item) => !restricted.has(item.parentInteractionId) && !groundedIds.has(item.parentInteractionId),
    );
    store.signals = store.signals.filter(item => !restricted.has(item.interactionId));
    return store;
  }

  createInteractionId() {
    return randomUUID();
  }

  async recordInteraction(input) {
    const groundingActive = isGroundedInteraction(input);
    const isRestricted = groundingActive || input.onlyNecessaryData === true || input.modelImprovement === false || (this.privacyPolicy && !await this.privacyPolicy.allows(input.ownerId, input.privacySnapshot));
    const now = input.createdAt || new Date().toISOString();
    const tokens = usageFields(input.usage);
    const cost = estimateCost(input.modelName, tokens.inputTokens, tokens.outputTokens);
    const interaction = {
      id: input.id || this.createInteractionId(),
      ownerId: input.ownerId || null,
      sessionId: input.sessionId || null,
      mode: input.mode,
      taskType: input.taskType || `${input.mode}_general`,
      userPrompt: isRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : asText(input.userPrompt, this.config.maxPromptChars),
      relevantContext: isRestricted ? null : sanitizeRelevantContext(input.relevantContext),
      modelProvider: input.modelProvider || "unknown",
      modelName: input.modelName || "unknown",
      modelResponse: isRestricted ? "[Məzmun gizlədilib - Töhfə deaktivdir]" : asText(input.modelResponse, this.config.maxResponseChars),
      ...tokens,
      estimatedCost: cost.estimatedCost,
      pricingSnapshot: cost.pricingSnapshot,
      latencyMs: Number.isFinite(Number(input.latencyMs)) ? Math.max(0, Math.round(Number(input.latencyMs))) : null,
      requestStatus: input.requestStatus || "success",
      errorType: input.errorType || null,
      qualityScore: this.config.weights.baseline,
      qualityBreakdown: [{ label: "Neutral baseline", value: this.config.weights.baseline, source: "system", strength: "neutral" }],
      groundingActive,
      onlyNecessaryData: isRestricted,
      modelImprovement: !isRestricted,
      createdAt: now,
    };
    await this.repository.update(async (store) => {
      // Recheck on every CAS attempt, after reading the authoritative learning revision.
      if (this.privacyPolicy && !await this.privacyPolicy.allows(input.ownerId, input.privacySnapshot)) {
        interaction.onlyNecessaryData = true; interaction.modelImprovement = false;
        interaction.userPrompt = "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]";
        interaction.modelResponse = "[Məzmun gizlədilib - Töhfə deaktivdir]";
        interaction.relevantContext = null;
      }
      const index = store.interactions.findIndex((item) => item.id === interaction.id);
      if (index === -1) store.interactions.push(interaction);
      else store.interactions[index] = { ...store.interactions[index], ...interaction };
      return interaction;
    });
    return interaction;
  }

  async recordSignal(interactionId, ownerId, values) {
    if (this.privacyPolicy && !await this.privacyPolicy.allows(ownerId)) return null;
    const allowed = Object.fromEntries(Object.entries({
      accepted: values.accepted === true ? true : undefined,
      regenerated: values.regenerated === true ? true : undefined,
      edited: values.edited === true ? true : undefined,
      copied: values.copied === true ? true : undefined,
      continuedConversation: values.continuedConversation === true ? true : undefined,
      explicitRating: ["positive", "negative"].includes(values.explicitRating) ? values.explicitRating : undefined,
      timeToNextAction: Number.isFinite(Number(values.timeToNextAction)) ? Math.max(0, Math.round(Number(values.timeToNextAction))) : undefined,
    }).filter(([, value]) => value !== undefined));
    return this.repository.update(async (store) => {
      if (this.privacyPolicy && !await this.privacyPolicy.allows(ownerId)) return null;
      const interaction = store.interactions.find((item) => item.id === interactionId && item.ownerId === ownerId);
      if (isGroundedInteraction(interaction)) return null;
      if (!interaction) return null;
      const signal = { id: randomUUID(), interactionId, ...allowed, createdAt: new Date().toISOString() };
      store.signals.push(signal);
      this.recalculate(store, interaction);
      return signal;
    });
  }

  async recordIteration(input) {
    if (this.privacyPolicy && !await this.privacyPolicy.allows(input.ownerId, input.privacySnapshot)) return null;
    return this.repository.update(async (store) => {
      if (this.privacyPolicy && !await this.privacyPolicy.allows(input.ownerId, input.privacySnapshot)) return null;
      const parent = store.interactions.find((item) => item.id === input.parentInteractionId);
      if (!parent || (input.ownerId && parent.ownerId !== input.ownerId)
        || parent.onlyNecessaryData === true || parent.modelImprovement === false
        || isGroundedInteraction(parent) || isGroundedInteraction(input.response?.orchestration ? { groundingActive: input.response.orchestration.searchGrounded } : input)) return null;
      const siblings = store.iterations.filter((item) => item.parentInteractionId === parent.id);
      const iteration = {
        id: randomUUID(),
        parentInteractionId: parent.id,
        interactionId: input.interactionId || null,
        iterationNumber: siblings.length + 1,
        modificationRequest: asText(input.modificationRequest, this.config.maxPromptChars),
        response: asText(input.response, this.config.maxResponseChars),
        modelProvider: input.modelProvider || parent.modelProvider,
        modelName: input.modelName || parent.modelName,
        finalAccepted: input.finalAccepted === true,
        createdAt: input.createdAt || new Date().toISOString(),
      };
      store.iterations.push(iteration);
      this.recalculate(store, parent);
      return iteration;
    });
  }

  recalculate(store, interaction) {
    if (!interaction) {
      if (store?.interactions) {
        for (const item of store.interactions) {
          this.recalculate(store, item);
        }
      }
      return;
    }
    if (interaction.onlyNecessaryData === true || interaction.modelImprovement === false || isGroundedInteraction(interaction)) {
      const existingCandidate = store.candidates.find((item) => item.sourceInteractionId === interaction.id);
      if (existingCandidate) {
        store.candidates = store.candidates.filter((item) => item.id !== existingCandidate.id);
      }
      return;
    }
    const signals = store.signals.filter((item) => item.interactionId === interaction.id);
    const iterations = store.iterations.filter((item) => item.parentInteractionId === interaction.id);
    const quality = calculateQualityScore(signals, iterations, this.config.weights);
    interaction.qualityScore = quality.score;
    interaction.qualityBreakdown = quality.breakdown;
    const existingCandidate = store.candidates.find((item) => item.sourceInteractionId === interaction.id);
    if (quality.score < this.config.candidateThreshold || interaction.requestStatus !== "success") {
      if (existingCandidate?.status === "pending") {
        store.candidates = store.candidates.filter((item) => item.id !== existingCandidate.id);
      }
      return;
    }

    const latestIteration = [...iterations].sort((a, b) => b.iterationNumber - a.iterationNumber)[0];
    const inputSanitization = sanitizeTrainingText(interaction.userPrompt);
    const outputSanitization = sanitizeTrainingText(latestIteration?.response || interaction.modelResponse);
    if (!inputSanitization.text.trim() || !outputSanitization.text.trim()) return;
    const reasonParts = quality.breakdown.filter((item) => item.value > 0 && item.source !== "system").map((item) => item.label);
    const candidateData = {
      sourceInteractionId: interaction.id,
      taskType: interaction.taskType,
      sanitizedInput: inputSanitization.text,
      preferredOutput: outputSanitization.text,
      qualityScore: quality.score,
      qualityBreakdown: quality.breakdown,
      candidateReason: reasonParts.join(", ") || "Quality threshold reached",
      containsSensitiveData: inputSanitization.containsSensitiveData || outputSanitization.containsSensitiveData,
      sanitizationStatus: inputSanitization.status === "redacted" || outputSanitization.status === "redacted" ? "redacted" : "clean",
      sanitizationResult: { input: inputSanitization.detections, output: outputSanitization.detections },
      sourceModelProvider: interaction.modelProvider,
      sourceModelName: interaction.modelName,
    };
    const existing = existingCandidate;
    if (!existing) {
      store.candidates.push({ id: randomUUID(), ...candidateData, status: "pending", reviewedAt: null, reviewedBy: null, createdAt: new Date().toISOString() });
    } else if (existing.status === "pending") {
      Object.assign(existing, candidateData);
    }
  }

  async reviewCandidate(id, status, reviewerId) {
    if (!["pending", "approved", "rejected"].includes(status)) return null;
    return this.repository.update((store) => {
      const candidate = store.candidates.find((item) => item.id === id);
      if (!candidate) return null;
      candidate.status = status;
      candidate.reviewedAt = status === "pending" ? null : new Date().toISOString();
      candidate.reviewedBy = status === "pending" ? null : reviewerId;
      return candidate;
    });
  }

  filterInteractions(store, filters = {}) {
    const from = filters.from ? new Date(filters.from).getTime() : null;
    const to = filters.to ? new Date(filters.to).getTime() : null;
    const minQuality = filters.minQuality !== undefined ? Number(filters.minQuality) : null;
    const maxQuality = filters.maxQuality !== undefined ? Number(filters.maxQuality) : null;
    return store.interactions.filter((item) => {
      const timestamp = new Date(item.createdAt).getTime();
      if (Number.isFinite(from) && timestamp < from) return false;
      if (Number.isFinite(to) && timestamp > to) return false;
      if (filters.mode && filters.mode !== "all" && item.mode !== filters.mode) return false;
      if (filters.provider && filters.provider !== "all" && item.modelProvider !== filters.provider) return false;
      if (filters.model && filters.model !== "all" && item.modelName !== filters.model) return false;
      if (filters.taskType && filters.taskType !== "all" && item.taskType !== filters.taskType) return false;
      if (Number.isFinite(minQuality) && item.qualityScore < minQuality) return false;
      if (Number.isFinite(maxQuality) && item.qualityScore > maxQuality) return false;
      const candidate = store.candidates.find((candidateItem) => candidateItem.sourceInteractionId === item.id);
      if (filters.candidateStatus && filters.candidateStatus !== "all" && candidate?.status !== filters.candidateStatus) return false;
      return true;
    });
  }

  async overview(filters = {}) {
    const store = await this.readVisibleStore();
    const interactions = this.filterInteractions(store, filters);
    const ids = new Set(interactions.map((item) => item.id));
    const candidates = store.candidates.filter((item) => ids.has(item.sourceInteractionId));
    const pricedInteractions = interactions.filter((item) => item.estimatedCost !== null);
    const totalEstimatedCost = interactions.reduce((sum, item) => sum + (item.estimatedCost || 0), 0);
    return {
      totalInteractions: interactions.length,
      askInteractions: interactions.filter((item) => item.mode === "ask").length,
      buildInteractions: interactions.filter((item) => item.mode === "build").length,
      trainingCandidates: candidates.length,
      approvedSamples: candidates.filter((item) => item.status === "approved").length,
      pendingCandidates: candidates.filter((item) => item.status === "pending").length,
      rejectedCandidates: candidates.filter((item) => item.status === "rejected").length,
      totalEstimatedCost: Number(totalEstimatedCost.toFixed(8)),
      askEstimatedCost: Number(interactions.filter((item) => item.mode === "ask").reduce((sum, item) => sum + (item.estimatedCost || 0), 0).toFixed(8)),
      buildEstimatedCost: Number(interactions.filter((item) => item.mode === "build").reduce((sum, item) => sum + (item.estimatedCost || 0), 0).toFixed(8)),
      averageEstimatedCost: pricedInteractions.length ? Number((totalEstimatedCost / pricedInteractions.length).toFixed(8)) : null,
      inputTokens: interactions.reduce((sum, item) => sum + (item.inputTokens || 0), 0),
      outputTokens: interactions.reduce((sum, item) => sum + (item.outputTokens || 0), 0),
      unpricedInteractions: interactions.filter((item) => item.estimatedCost === null).length,
    };
  }

  async growth(filters = {}) {
    const store = await this.readVisibleStore();
    const interactions = this.filterInteractions(store, filters);
    const ids = new Set(interactions.map((item) => item.id));
    const candidates = store.candidates.filter((item) => ids.has(item.sourceInteractionId));
    const days = new Map();
    const ensure = (createdAt) => {
      const key = startOfDay(createdAt).toISOString().slice(0, 10);
      if (!days.has(key)) days.set(key, { date: key, rawInteractions: 0, trainingCandidates: 0, approvedSamples: 0 });
      return days.get(key);
    };
    interactions.forEach((item) => { ensure(item.createdAt).rawInteractions += 1; });
    candidates.forEach((item) => {
      ensure(item.createdAt).trainingCandidates += 1;
      if (item.status === "approved") ensure(item.reviewedAt || item.createdAt).approvedSamples += 1;
    });
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async modelPerformance(filters = {}) {
    const store = await this.readVisibleStore();
    const interactions = this.filterInteractions(store, filters);
    const groups = new Map();
    for (const item of interactions) {
      const key = `${item.modelProvider}:${item.modelName}`;
      const group = groups.get(key) || { provider: item.modelProvider, model: item.modelName, requestCount: 0, latencyTotal: 0, latencyCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, scored: 0 };
      group.requestCount += 1;
      if (item.latencyMs !== null) { group.latencyTotal += item.latencyMs; group.latencyCount += 1; }
      group.inputTokens += item.inputTokens || 0;
      group.outputTokens += item.outputTokens || 0;
      group.totalTokens += item.totalTokens || 0;
      group.estimatedCost += item.estimatedCost || 0;
      group.scored += item.qualityScore || 0;
      groups.set(key, group);
    }
    const signalsByInteraction = new Map();
    store.signals.forEach((signal) => signalsByInteraction.set(signal.interactionId, { ...(signalsByInteraction.get(signal.interactionId) || {}), ...signal }));
    return [...groups.values()].map((group) => {
      const members = interactions.filter((item) => item.modelProvider === group.provider && item.modelName === group.model);
      const latestSignals = members.map((item) => signalsByInteraction.get(item.id) || {});
      const candidateCount = members.filter((item) => store.candidates.some((candidate) => candidate.sourceInteractionId === item.id)).length;
      return {
        provider: group.provider, model: group.model, requestCount: group.requestCount,
        averageLatency: group.latencyCount ? Math.round(group.latencyTotal / group.latencyCount) : null,
        inputTokens: group.inputTokens, outputTokens: group.outputTokens, totalTokens: group.totalTokens,
        estimatedCost: Number(group.estimatedCost.toFixed(8)),
        regenerateRate: ratio(latestSignals.filter((item) => item.regenerated).length, group.requestCount),
        positiveFeedbackRate: ratio(latestSignals.filter((item) => item.explicitRating === "positive").length, group.requestCount),
        negativeFeedbackRate: ratio(latestSignals.filter((item) => item.explicitRating === "negative").length, group.requestCount),
        averageQualityScore: Number((group.scored / group.requestCount).toFixed(4)),
        candidateConversionRate: ratio(candidateCount, group.requestCount),
      };
    }).sort((a, b) => b.requestCount - a.requestCount);
  }

  async taskIntelligence(filters = {}) {
    const store = await this.readVisibleStore();
    const interactions = this.filterInteractions(store, filters);
    const groups = new Map();
    for (const item of interactions) {
      const key = `${item.mode}:${item.taskType}`;
      const group = groups.get(key) || { mode: item.mode, taskType: item.taskType, requestCount: 0, qualityTotal: 0, regenerated: 0, corrections: 0, candidates: 0 };
      group.requestCount += 1;
      group.qualityTotal += item.qualityScore || 0;
      if (store.signals.some((signal) => signal.interactionId === item.id && signal.regenerated)) group.regenerated += 1;
      group.corrections += store.iterations.filter((iteration) => iteration.parentInteractionId === item.id && iteration.modificationRequest).length;
      if (store.candidates.some((candidate) => candidate.sourceInteractionId === item.id)) group.candidates += 1;
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({
      ...group,
      averageQualityScore: Number((group.qualityTotal / group.requestCount).toFixed(4)),
      regenerateRate: ratio(group.regenerated, group.requestCount),
      candidateConversionRate: ratio(group.candidates, group.requestCount),
    })).sort((a, b) => b.requestCount - a.requestCount);
  }

  async listInteractions(filters = {}, page = 1, pageSize = 25) {
    const store = await this.readVisibleStore();
    const items = this.filterInteractions(store, filters).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const safePage = Math.max(1, Number(page) || 1);
    const slice = items.slice((safePage - 1) * safeSize, safePage * safeSize).map((item) => ({
      ...item,
      ownerId: undefined,
      userPrompt: item.onlyNecessaryData ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : item.userPrompt.slice(0, 160),
      modelResponse: item.onlyNecessaryData ? "[Məzmun gizlədilib - Töhfə deaktivdir]" : item.modelResponse.slice(0, 180),
      onlyNecessaryData: Boolean(item.onlyNecessaryData),
      groundingActive: isGroundedInteraction(item),
      trainingStatus: (item.onlyNecessaryData || isGroundedInteraction(item))
        ? "restricted"
        : (store.candidates.find((candidate) => candidate.sourceInteractionId === item.id)?.status || null),
    }));
    return { items: slice, page: safePage, pageSize: safeSize, total: items.length, totalPages: Math.ceil(items.length / safeSize) };
  }

  async getInteraction(id) {
    const store = await this.readVisibleStore();
    const interaction = store.interactions.find((item) => item.id === id);
    if (!interaction) return null;
    const iterations = store.iterations.filter((item) => item.parentInteractionId === id).sort((a, b) => a.iterationNumber - b.iterationNumber);
    const isRestricted = Boolean(interaction.onlyNecessaryData);
    return {
      ...interaction, ownerId: undefined,
      onlyNecessaryData: isRestricted,
      userPrompt: isRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : interaction.userPrompt,
      modelResponse: isRestricted ? "[Məzmun gizlədilib - Töhfə deaktivdir]" : interaction.modelResponse,
      relevantContext: isRestricted ? null : interaction.relevantContext,
      signals: isRestricted ? [] : store.signals.filter((item) => item.interactionId === id),
      iterations: isRestricted ? [] : iterations,
      preferredResponse: isRestricted ? "[Məzmun gizlədilib - Töhfə deaktivdir]" : (iterations.at(-1)?.response || interaction.modelResponse),
      candidate: isRestricted ? null : (store.candidates.find((item) => item.sourceInteractionId === id) || null),
    };
  }

  async listCandidates(filters = {}, page = 1, pageSize = 25) {
    const store = await this.readVisibleStore();
    const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 25));
    const safePage = Math.max(1, Number(page) || 1);
    const minQuality = Number(filters.minQuality);
    const maxQuality = Number(filters.maxQuality);
    const items = store.candidates.filter((item) => {
      if (filters.status && filters.status !== "all" && item.status !== filters.status) return false;
      if (filters.taskType && filters.taskType !== "all" && item.taskType !== filters.taskType) return false;
      if (Number.isFinite(minQuality) && item.qualityScore < minQuality) return false;
      if (Number.isFinite(maxQuality) && item.qualityScore > maxQuality) return false;
      return true;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const slice = items.slice((safePage - 1) * safeSize, safePage * safeSize).map((item) => ({ ...item, sanitizedInput: item.sanitizedInput.slice(0, 180), preferredOutput: item.preferredOutput.slice(0, 180) }));
    return { items: slice, page: safePage, pageSize: safeSize, total: items.length, totalPages: Math.ceil(items.length / safeSize) };
  }

  async getCandidate(id) {
    const store = await this.readVisibleStore();
    const candidate = store.candidates.find((item) => item.id === id);
    if (!candidate) return null;
    const source = store.interactions.find((item) => item.id === candidate.sourceInteractionId);
    return { ...candidate, sourceInteraction: source ? { id: source.id, mode: source.mode, taskType: source.taskType, modelProvider: source.modelProvider, modelName: source.modelName } : null, iterations: store.iterations.filter((item) => item.parentInteractionId === candidate.sourceInteractionId) };
  }

  async exportApproved(format = "openai-chat-jsonl") {
    if (format !== "openai-chat-jsonl") throw new Error("Unsupported export format");
    const store = await this.readVisibleStore();
    const approved = [];
    for (const item of store.candidates) {
      if (item.status !== "approved") continue;
      const source = store.interactions.find((i) => i.id === item.sourceInteractionId);
      if (source?.onlyNecessaryData === true || source?.modelImprovement === false || isGroundedInteraction(source)) continue;
      if (source?.ownerId && this.privacyPolicy) {
        const allowed = await this.privacyPolicy.allows(source.ownerId);
        if (!allowed) continue;
      }
      approved.push(item);
    }
    return approved.map((item) => JSON.stringify({
      messages: [{ role: "user", content: item.sanitizedInput }, { role: "assistant", content: item.preferredOutput }],
      metadata: { task_type: item.taskType, quality_score: item.qualityScore, source: "helmer", candidate_id: item.id },
    })).join("\n") + (approved.length ? "\n" : "");
  }
}

export function logWithoutBlocking(promise, label = "AI learning logging") {
  Promise.resolve(promise).catch((error) => console.error(`⚠️ ${label} failed:`, error?.message || error));
}
