import { assertExecutionAuthorized } from '../services/security/execution-control.js';
import { createAskTransport } from './ask-transport.js';
import { createAskConfig } from '../services/ai/ask-config.js';
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { uuid } from "../services/artifacts/schemas.js";
import { resolveCapabilityIntent } from "../services/plugins/registry.js";
import { publicArtifact } from "../repositories/artifact-repository.js";
import { GUEST_RESTRICTION_NOTICES } from "../services/ai/prompts.js";
import { requireAuth } from "./auth-middleware.js";
import { prepareUploadedContext, validUploadMetadata, assertCachedFileReference } from "../services/artifacts/upload-context.js";
import {
  isGroundedAssistantMessage,
  isGroundedStrategyRecord,
  isGroundedArtifactRecord,
  isGroundedPlannerTaskInput,
  resolveGroundedStrategyProvenance,
  stripInternalStrategyMetadata,
} from "../services/ai/grounded-chat-retention.js";

const upload = z.object({
  fileId: z.string().max(100).optional(), name: z.string().min(1).max(255).refine(name => !/[\/\\\x00-\x1f]/.test(name)),
  size: z.number().min(0).max(20 * 1024 * 1024), type: z.string().max(100), mimeType: z.string().max(100).optional(),
  data: z.string().max(28 * 1024 * 1024).optional(), textContent: z.string().max(200000).optional(),
  ownerId: z.string().max(100).optional(),
}).strict().refine(validUploadMetadata, "Invalid upload MIME or extension");
// Existing Ask UI fields are accepted explicitly. Persisted artifact metadata always comes from the server.
export const askRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "model"]), content: z.string().max(10000), file: upload.optional(),
    strategyTitle: z.string().max(1000).optional(), taskTitle: z.string().max(1000).optional(), model: z.string().max(100).optional(),
    interactionId: uuid.optional(), createdAt: z.string().max(100).optional(), feedback: z.enum(["positive", "negative"]).nullable().optional(),
    isStreaming: z.boolean().optional(), status: z.string().max(100).optional(), statusText: z.string().max(500).optional(),
    thinkingLevel: z.enum(["low", "medium", "high", "xhigh", "off", "auto"]).optional(), thinkingEnabled: z.boolean().optional(), userPrompt: z.string().max(10000).optional(),
    groundingMetadata: z.unknown().optional(), artifacts: z.array(z.unknown()).max(6).optional(), execution: z.unknown().optional(),
    pluginIds: z.array(z.string().max(41)).max(6).optional(),
    type: z.string().max(100).optional(), jobId: uuid.optional(), steps: z.array(z.unknown()).optional(),
    sources: z.array(z.unknown()).optional(), query: z.string().max(10000).optional(), error: z.string().max(2000).optional(),
    searchGrounded: z.boolean().optional(), groundingActive: z.boolean().optional(),
    updatedAt: z.string().max(100).optional(), id: uuid.optional(),
  }).strict()).min(1).max(200),
  model: z.string().max(100).optional(), mode: z.enum(["ask", "research"]).optional(), thinkingLevel: z.enum(["low", "medium", "high", "xhigh", "off", "auto"]).optional(),
  strategyId: uuid.optional(), taskId: uuid.optional(), chatId: uuid.optional(),
  pluginIds: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,40}$/)).max(6).optional(),
  chatRevision: z.number().int().positive().optional(),
  artifactId: uuid.optional(), stream: z.boolean().optional(),
}).strict();

function storedMessage(message) {
  return { role: message.role, content: message.content, ...(message.strategyTitle ? { strategyTitle: message.strategyTitle } : {}), ...(message.taskTitle ? { taskTitle: message.taskTitle } : {}),
    ...(message.file ? { file: { fileId: message.file.fileId, name: message.file.name, size: message.file.size, type: message.file.type, mimeType: message.file.mimeType } } : {}) };
}

function sanitizeStrategyForCapabilityContext(strategyRecord) {
  if (!strategyRecord || typeof strategyRecord !== "object") return null;
  const rawStrategy = strategyRecord.strategy && typeof strategyRecord.strategy === "object"
    ? strategyRecord.strategy
    : null;
  if (!rawStrategy) {
    return {
      title: strategyRecord.title,
      brief: strategyRecord.brief,
      strategy: stripInternalStrategyMetadata(strategyRecord.strategy),
    };
  }
  return {
    title: strategyRecord.title,
    brief: strategyRecord.brief,
    strategy: stripInternalStrategyMetadata(rawStrategy),
  };
}

function isArtifactFromGroundedContext(artifactRecord, chat = null, strategyRecord = null) {
  if (!artifactRecord) return false;
  if (isGroundedArtifactRecord(artifactRecord, strategyRecord)) return true;
  if (Array.isArray(artifactRecord.versions)) {
    const hasGroundedExec = artifactRecord.versions.some((v) =>
      v?.execution?.groundingActive === true ||
      v?.execution?.searchGrounded === true ||
      v?.execution?.intent === "web_research" ||
      (Array.isArray(v?.execution?.steps) &&
        v.execution.steps.some((s) => s?.pluginId === "web" || s?.outputType === "research"))
    );
    if (hasGroundedExec) return true;
  }
  if (chat && Array.isArray(chat.messages)) {
    const ownerMsg = chat.messages.find(
      (msg) => Array.isArray(msg?.artifacts) && msg.artifacts.some((a) => a?.id === artifactRecord.id)
    );
    if (ownerMsg && isGroundedAssistantMessage(ownerMsg)) return true;
  }
  return false;
}

function sanitizeArtifactSpecForPrompt(spec) {
  if (!spec || typeof spec !== "object") return null;
  return stripInternalStrategyMetadata(spec);
}

export function createCapabilityRouter({ allowGuestChat = false, registry, workflow, artifacts, chats, strategies, planner, rateLimit, hydrateFile, onComplete, limits = createAskConfig() }) {
  const router = express.Router();
  router.get("/plugins", requireAuth, (_req, res) => res.json({ plugins: registry.list() }));
  router.post("/", (req, res, next) => allowGuestChat && !req.user && req.ownerId?.startsWith("guest_") ? next() : requireAuth(req, res, next), async (req, res, next) => {
    let transport, completedResult, committed = false, allocatedChatId, initialChat;
    try {
      const parsed = askRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Sorğu parametrləri düzgün deyil.", code: "VALIDATION_ERROR" });
      const payload = parsed.data;
      if (!req.user && (payload.mode === 'research' || payload.artifactId || payload.messages.some(message => message.file) || (payload.pluginIds || []).some(id => id !== 'web'))) {
        const errorMsg = payload.messages.some(message => message.file)
          ? "Fayl yükləmək və sənədlərinizi analiz etmək üçün qeydiyyatdan keçməlisiniz."
          : "Davam etmək üçün qeydiyyatdan keçməlisiniz.";
        return res.status(401).json({ code: 'AUTH_REQUIRED', error: errorMsg, reply: errorMsg });
      }
      const prompt = payload.messages.at(-1)?.content || "";
      if (payload.messages.at(-1)?.role !== "user" || (!prompt.trim() && !payload.messages.at(-1)?.file)) return res.status(400).json({ error: "Mesaj daxil edilməyib.", code: "VALIDATION_ERROR" });
      const chat = payload.chatId ? await chats.getById(payload.chatId, req.ownerId) : null;
      if (payload.chatId && !chat) return res.status(404).json({ error: "Söhbət tapılmadı.", code: "NOT_FOUND" });
      if (!req.user && (chat?.strategyId || chat?.taskId || chat?.messages.some(message => message.file))) {
        const notice = chat.strategyId ? GUEST_RESTRICTION_NOTICES.strategy : chat.taskId ? GUEST_RESTRICTION_NOTICES.planner : GUEST_RESTRICTION_NOTICES.file;
        return res.status(401).json({ code: 'AUTH_REQUIRED', error: notice, reply: notice });
      }
      const expectedRevision = chat ? (chat.revision || 1) : 1;
      const clientRevision = payload.chatRevision !== undefined && payload.chatRevision !== null
        ? Number(payload.chatRevision)
        : expectedRevision;
      if (chat && clientRevision !== expectedRevision) return res.status(409).json({ code: 'REVISION_CONFLICT', revision: expectedRevision });
      const references = chat?.messages.flatMap(message => message.artifacts || []) || [];
      const selectedArtifacts = (payload.pluginIds || []).map(id => registry.get(id)).filter(plugin => plugin?.capabilities.includes("artifact_generation"));
      const inferredReference = selectedArtifacts.length === 1 ? selectedArtifacts[0] : registry.reference(prompt);
      let target = payload.artifactId ? references.find(artifact => artifact.id === payload.artifactId) : (inferredReference ? references.filter(artifact => artifact.pluginId === inferredReference.id).at(-1) : references.at(-1));
      if (payload.artifactId && !target) return res.status(404).json({ error: "Artifact bu söhbətdə tapılmadı.", code: "NOT_FOUND" });
      const preliminarySelection = resolveCapabilityIntent({ registry, pluginIds: payload.pluginIds, prompt, previousArtifact: target ? { pluginId: target.pluginId } : null });
      if (preliminarySelection.intent === "chat" && !target) {
        if (chat) req.preloadedAskChat = chat;
        return next();
      }
      const previous = target ? await artifacts.get(target.id, req.ownerId) : null;
      const latestPublished = target ? references.filter(artifact => artifact.id === target.id).at(-1) : null;
      if (previous && previous.versions.at(-1).version !== latestPublished?.version) throw new Error("Artifact update is still being committed");
      const chatStrategy =
        previous && chat?.strategyId && strategies && typeof strategies.getById === "function"
          ? await strategies.getById(chat.strategyId, req.ownerId).catch(() => null)
          : null;
      const chatStrategyMissingOrGrounded = Boolean(
        previous && chat?.strategyId && strategies && (!chatStrategy || isGroundedStrategyRecord(chatStrategy))
      );
      const previousIsGrounded =
        isArtifactFromGroundedContext(previous, chat, chatStrategy) || chatStrategyMissingOrGrounded;
      const effectivePreviousForSelection = previousIsGrounded && !payload.artifactId ? null : previous;
      const selection = resolveCapabilityIntent({ registry, pluginIds: payload.pluginIds, prompt, previousArtifact: effectivePreviousForSelection });
      if (selection.intent === "chat" || (selection.plugins.length === 1 && selection.plugins[0].id === "web")) {
        if (chat) req.preloadedAskChat = chat;
        if (previous && !previousIsGrounded) {
          const safeSpec = sanitizeArtifactSpecForPrompt(previous.versions.at(-1)?.spec);
          if (safeSpec) req.askArtifactContext = JSON.stringify(safeSpec);
        }
        return next();
      }
      if (!req.user) return res.status(401).json({ code: "AUTH_REQUIRED" });
      if (rateLimit) { let limited = true; rateLimit(req, res, () => { limited = false; }); if (limited) return; }
      transport = createAskTransport(req, res, limits);
      const streaming = payload.stream === true || req.headers.accept?.includes("text/event-stream");
      const strategyId = payload.strategyId || chat?.strategyId;
      const taskId = payload.taskId || chat?.taskId;
      if (strategies && typeof strategies.loadOwnerProvenance === "function") {
        await strategies.loadOwnerProvenance(req.ownerId).catch(() => {});
      }
      const [strategy, task, allOwnerStrategies] = await Promise.all([
        strategyId && strategies ? (chatStrategy && strategyId === chatStrategy.id ? chatStrategy : strategies.getById(strategyId, req.ownerId)) : null,
        taskId && planner ? planner.list(req.ownerId).then(items => items.find(item => item.id === taskId) || null) : null,
        strategies && typeof strategies.readAll === "function" ? strategies.readAll(req.ownerId).catch(() => []) : Promise.resolve([]),
      ]);
      transport.signal.throwIfAborted();
      if ((payload.strategyId && !strategy) || (payload.taskId && !task)) return res.status(404).json({ error: "Seçilmiş kontekst tapılmadı.", code: "NOT_FOUND" });
      if ((strategyId && !strategy) || (taskId && !task)) return res.status(404).json({ error: "Seçilmiş kontekst tapılmadı.", code: "NOT_FOUND" });
      const taskStrategy = task?.strategyId && strategies ? await strategies.getById(task.strategyId, req.ownerId) : null;
      const taskIsGrounded = Boolean(
        task &&
          (isGroundedStrategyRecord(taskStrategy) ||
            (task.strategyId && strategies && !taskStrategy) ||
            isGroundedPlannerTaskInput(
              req.ownerId,
              {
                strategyId: task.strategyId || null,
                strategyTitle: task.strategyTitle || null,
                tasks: [task],
                source: task.source || null,
                searchGrounded: Boolean(task.searchGrounded || task.groundingActive),
              },
              allOwnerStrategies
            ))
      );
      const strategyProvenance = strategy
        ? resolveGroundedStrategyProvenance(req.ownerId, strategy, allOwnerStrategies)
        : { grounded: false };
      if (
        isGroundedStrategyRecord(strategy) ||
        strategyProvenance.grounded ||
        (chat?.strategy && isGroundedStrategyRecord(chat.strategy)) ||
        taskIsGrounded
      ) {
        return res.status(422).json({
          code: "GROUNDED_STRATEGY_RESTRICTED",
          error: "Veb araşdırması olan strategiyanı sənəd generasiyasına və ya növbəti model çağırışına ötürmək mümkün deyil.",
        });
      }
      if (previous && (previousIsGrounded || isArtifactFromGroundedContext(previous, chat, strategy))) {
        if (payload.artifactId) {
          return res.status(422).json({
            code: "GROUNDED_STRATEGY_RESTRICTED",
            error: "Veb araşdırması ilə yaradılmış sənədi model vasitəsilə redaktə etmək mümkün deyil.",
          });
        }
      }
      const safePrevious = previous && !previousIsGrounded && !isArtifactFromGroundedContext(previous, chat, strategy) ? previous : null;
      const sourceContext = strategy || task ? JSON.stringify({ strategy: strategy ? sanitizeStrategyForCapabilityContext(strategy) : null, task: task ? { text: task.text, strategyTitle: task.strategyTitle } : null }) : "";
      const isRetry = chat?.messages.at(-1)?.role === "user" && chat.messages.at(-1).content === prompt;
      const incoming = payload.messages.at(-1);
      const fresh = { ...storedMessage(incoming), ...(incoming.file ? { file: incoming.file } : {}) };
      const withGroundedMarkers = (message) => ({
        ...storedMessage(message),
        ...(message.file ? { file: message.file } : {}),
        ...(isGroundedAssistantMessage(message) ? { searchGrounded: true } : {}),
        ...(typeof message.type === "string" ? { type: message.type } : {}),
        ...(Array.isArray(message.pluginIds) ? { pluginIds: message.pluginIds } : {}),
        ...(Array.isArray(message.sources) ? { sources: message.sources } : {}),
        ...(message.groundingMetadata && typeof message.groundingMetadata === "object" ? { groundingMetadata: message.groundingMetadata } : {}),
        ...(message.groundingActive === true ? { groundingActive: true } : {}),
      });
      const history = chat ? [...chat.messages.map(message => ({ ...message })), ...(isRetry ? [] : [fresh])] : payload.messages.map(withGroundedMarkers);
      if (isRetry && incoming.file) history.at(-1).file = incoming.file;
      history.at(-1).pluginIds = selection.plugins.map(plugin => plugin.id);
      for (const message of history) if (message.file) {
        transport.signal.throwIfAborted();
        assertCachedFileReference(message.file, chat);
        message.file = await prepareUploadedContext(hydrateFile ? await hydrateFile(message.file, req.ownerId) : message.file);
        if (!message.file.data && !message.file.textContent) throw new Error("Uploaded context expired; attach the file again");
      }
      allocatedChatId = chat?.id || randomUUID();
      // Establish an owner-scoped chat before artifact persistence; failed runs stay retryable.
      const safeHistory = history.map((message, index) => (
        chat && index < chat.messages.length
          ? chat.messages[index]
          : { ...withGroundedMarkers(message), ...(message.pluginIds ? { pluginIds: message.pluginIds } : {}) }
      ));
      await assertExecutionAuthorized(transport.signal);
      initialChat = await chats.saveChat({ id: allocatedChatId, ownerId: req.ownerId, messages: safeHistory, strategyId, taskId, mustExist: Boolean(chat), expectedRevision: chat ? expectedRevision : null });
      if (req.securityContext) req.securityContext.assertResources = async () => {
        const [authorizedChat, authorizedStrategy, authorizedTasks] = await Promise.all([
          chats.getById(allocatedChatId, req.ownerId),
          strategyId ? strategies.getById(strategyId, req.ownerId) : null,
          taskId ? planner.list(req.ownerId) : null,
        ]);
        if (!authorizedChat || (strategyId && !authorizedStrategy) ||
            (taskId && !authorizedTasks.some(item => item.id === taskId))) {
          throw Object.assign(new Error('Execution context removed'), { code: 'EXECUTION_REVOKED', status: 403 });
        }
      };
      if (streaming) {
        transport.start();
        transport.send({ status: "analyzing", statusText: "Məlumatları analiz edirəm...", chatId: allocatedChatId, chatRevision: initialChat.revision });
      }
      transport.signal.throwIfAborted();
      const workflowMessages = history
        .filter((message) => !isGroundedAssistantMessage(message))
        .map((message) => stripInternalStrategyMetadata(message));
      const result = completedResult = await workflow.execute({ plugins: selection.plugins, ownerId: req.ownerId, chatId: allocatedChatId, prompt, messages: workflowMessages, sourceContext, previous: safePrevious,
        preferEdit: Boolean(payload.artifactId),
        requestedModel: payload.model, scopes: new Set(["context:read", "artifacts:write", "web:search"]), signal: transport.signal,
        language: req.user?.settings?.language || (req.headers["accept-language"]?.includes("en") ? "en" : "az"),
        onStatus: streaming ? transport.send : undefined,
      });
      const assistant = { role: "assistant", content: result.reply, artifacts: result.artifacts, execution: result.execution, model: result.model, groundingMetadata: result.groundingMetadata, createdAt: new Date().toISOString() };
      await req.securityContext?.assertAuthorized?.();
      transport.signal.throwIfAborted();
      req.securityContext?.markMutationPending?.();
      const savedChat = await chats.saveChat({ id: allocatedChatId, ownerId: req.ownerId, messages: [...safeHistory, assistant], strategyId, taskId, mustExist: true, expectedRevision: initialChat.revision || 1 });
      committed = true;
      const response = { done: true, reply: result.reply, artifacts: result.artifacts, execution: result.execution, model: result.model, chat: savedChat, chatId: savedChat.id, chatRevision: savedChat.revision, groundingMetadata: result.groundingMetadata };
      req.securityContext?.recordIdempotentResult?.(200, response);
      await req.securityContext?.persistIdempotentResult?.();
      transport.signal.throwIfAborted();
      onComplete?.({ req, result });
      if (streaming) { transport.send(response); await transport.drain(); return res.end(); }
      return res.json(response);
    } catch (error) {
      if (completedResult && !committed) for (const artifact of completedResult.artifacts.reverse()) await artifacts.rollback(artifact, req.ownerId).catch(() => {});
      // Provider/renderer internals and raw model output never appear in the conversation.
      const response = { error: "Tapşırığı tamamlamaq mümkün olmadı. Yenidən cəhd edin.", code: "CAPABILITY_EXECUTION_FAILED", retryable: true, execution: error.execution, chatId: allocatedChatId, chatRevision: initialChat?.revision };
      console.error("Capability execution failed:", error.code || error.name);
      if (transport?.streaming) return transport.fail(error, response);
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) return res.status(502).json(response);
    } finally { transport?.dispose(); }
  });
  return router;
}

export function createArtifactRouter({ artifacts, chats }) {
  const router = express.Router();
  router.use(requireAuth);
  router.get("/:id/versions/:version/:action", async (req, res) => {
    try {
      if (!uuid.safeParse(req.params.id).success || !/^[1-9]\d{0,2}$/.test(req.params.version) || !["download", "preview"].includes(req.params.action)) return res.status(400).json({ error: "Fayl seçimi düzgün deyil." });
      const record = await artifacts.get(req.params.id, req.ownerId);
      const chat = record ? await chats.getById(record.chatId, req.ownerId) : null;
      const queryRevision = req.query.chatRevision !== undefined ? Number(req.query.chatRevision) : undefined;
      if (chat && queryRevision !== undefined && queryRevision !== (chat.revision || 1)) return res.status(409).json({ code: 'REVISION_CONFLICT', revision: chat.revision || 1 });
      const references = chat?.messages.flatMap(message => message.artifacts || []).filter(artifact => artifact.id === record?.id) || [];
      if (!record || !chat || !references.some(artifact => artifact.version === Number(req.params.version))) return res.status(404).json({ error: "Fayl tapılmadı." });
      const version = record.versions.find(item => item.version === Number(req.params.version));
      if (!version) return res.status(404).json({ error: "Versiya tapılmadı." });
      res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      if (req.params.action === "preview") return res.json({ artifact: publicArtifact(record, version), specification: version.spec, versions: record.versions.filter(item => references.some(reference => reference.version === item.version)).map(item => publicArtifact(record, item)) });
      const result = await artifacts.download(record, version.version, req.ownerId);
      res.set({ "Content-Type": record.mimeType, "Content-Length": String(result.buffer.length), "Content-Disposition": `attachment; filename="Helmer_Artifact.${record.extension}"; filename*=UTF-8''${encodeURIComponent(version.filename)}` });
      return res.send(result.buffer);
    } catch { return res.status(503).json({ error: "Faylı açmaq mümkün olmadı. Yenidən cəhd edin." }); }
  });
  return router;
}
