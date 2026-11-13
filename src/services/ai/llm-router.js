import { assertExecutionActive } from '../security/execution-control.js';
import { createHash } from "node:crypto";
import { zodTextFormat, zodResponseFormat } from "openai/helpers/zod";
import { getGeminiClient, getOpenAIClient } from "./client.js";
import { aiConfig, hasGeminiConfiguration, hasOpenAIConfiguration } from "./config.js";

export class LLMProviderError extends Error {
  constructor(message, { code = "AI_PROVIDER_ERROR", status = 502, model, provider, details = null } = {}) {
    super(message);
    this.name = "LLMProviderError";
    this.code = code;
    this.status = status;
    this.model = model;
    this.provider = provider;
    this.details = details;
  }
}

function privacySafeIdentifier(ownerId) {
  return ownerId ? createHash("sha256").update(String(ownerId)).digest("hex").slice(0, 32) : undefined;
}

export function extractJsonFromText(rawText) {
  if (typeof rawText !== "string") return rawText;
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Boş mətn təqdim edilib.");
  }

  // 1. Direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue with resilient extraction
  }

  // 2. Strip Markdown code fences: ```json ... ``` or ``` ... ```
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // 3. Extract balanced outer object: { ... }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue
    }
  }

  // 4. Extract balanced outer array: [ ... ]
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = trimmed.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue
    }
  }

  throw new Error("Mətndən etibarlı JSON strukturu çıxarıla bilmədi.");
}

export function normalizeStructuredOutput(parsed, name) {
  if (!parsed || typeof parsed !== "object") return parsed;

  if (name === "strategy_assessment") {
    const rawStatus = String(parsed.status || "").toLowerCase().trim();
    if (rawStatus.includes("clarif")) {
      parsed.status = "needs_clarification";
    } else if (rawStatus.includes("ready") || rawStatus.includes("complete")) {
      parsed.status = "ready";
    } else {
      parsed.status = Array.isArray(parsed.questions) && parsed.questions.length > 0 ? "needs_clarification" : "ready";
    }

    const understandingStr = typeof parsed.understanding === "string" ? parsed.understanding.trim() : "";
    parsed.understanding = understandingStr ? understandingStr.slice(0, 3000) : "Brif analiz edildi və strateji istiqamətlər müəyyənləşdirildi.";

    parsed.questions = Array.isArray(parsed.questions)
      ? parsed.questions.slice(0, 5).map((question, index) => ({
          id: String(question?.id || `q_${index + 1}`).trim().slice(0, 80) || `q_${index + 1}`,
          question: String(question?.question || "Əlavə detal").trim().slice(0, 300) || "Əlavə detal tələb olunur",
          reason: String(question?.reason || "").trim().slice(0, 800),
          inputType: ["single_choice", "multi_choice", "text"].includes(question?.inputType) ? question.inputType : "single_choice",
          options: Array.isArray(question?.options)
            ? question.options.slice(0, 8).map((opt) => String(opt || "").trim().slice(0, 200)).filter(Boolean)
            : [],
        }))
      : [];

    parsed.assumptions = Array.isArray(parsed.assumptions)
      ? parsed.assumptions.slice(0, 12).map((a) => (typeof a === "string" ? a.trim().slice(0, 3000) : String(a || "").slice(0, 3000))).filter(Boolean)
      : [];

    return parsed;
  }

  if (name === "helmer_strategy" || name === "helmer_refined_strategy") {
    // 1. Title & Summary
    const titleStr = typeof parsed.title === "string" ? parsed.title.trim() : "";
    parsed.title = titleStr ? titleStr.slice(0, 300) : "Biznes və Marketinq Strategiyası";

    const summaryStr = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    parsed.summary = summaryStr ? summaryStr.slice(0, 12000) : "Strateji icmal hazırlanmışdır.";

    // 2. Context
    const rawContext = parsed.context && typeof parsed.context === "object" ? parsed.context : {};
    parsed.context = {
      business: String(rawContext.business || "Biznes modeli və cari bazar mövqelənməsi.").trim().slice(0, 3000) || "Biznes modeli.",
      objective: String(rawContext.objective || "Əsas strateji və əməliyyat hədəfləri.").trim().slice(0, 3000) || "Strateji hədəf.",
      market: String(rawContext.market || "Bazar dinamikası və rəqabət mühiti.").trim().slice(0, 3000) || "Bazar mühiti.",
      targetAudience: String(rawContext.targetAudience || "Əsas hədəf auditoriya və müştəri seqmenti.").trim().slice(0, 3000) || "Hədəf auditoriya.",
    };

    // 3. Sections (min 3, max 12)
    const rawSections = Array.isArray(parsed.sections) ? parsed.sections : [];
    const normalizedSections = rawSections.slice(0, 12).map((sec, index) => {
      const s = sec && typeof sec === "object" ? sec : {};
      const secTitle = String(s.title || `Bölmə ${index + 1}`).trim().slice(0, 300) || `Bölmə ${index + 1}`;
      const secContent = String(s.content || "Bölmə üzrə strateji analiz və icra detalları.").trim().slice(0, 12000) || "Strateji icra detalları.";
      const secSummary = String(s.summary || "").trim().slice(0, 800);
      const secId = String(s.id || `section_${index + 1}`).trim().slice(0, 80) || `section_${index + 1}`;
      const secBullets = Array.isArray(s.bullets)
        ? s.bullets.slice(0, 12).map((b) => String(b || "").trim().slice(0, 3000)).filter(Boolean)
        : [];
      return {
        id: secId,
        title: secTitle,
        summary: secSummary,
        content: secContent,
        bullets: secBullets,
      };
    });

    const defaultSections = [
      { id: "sec_market_analysis", title: "Bazar və Rəqabət Analizi", summary: "Bazar dinamikası və rəqabət təhlili", content: "Mövcud bazar seqmenti və rəqabət mühitinin strateji təhlili aparılmışdır.", bullets: ["Rəqabət mühitinin xüsusiyyətləri", "Müştəri tələbatı və davranış modelləri"] },
      { id: "sec_positioning_go_to_market", title: "Mövqelənmə və Go-to-Market", summary: "Dəyər təklifi və satış kanalları", content: "Fərqləndirici dəyər təklifi və bazara çıxış mexanizmləri formalaşdırılmışdır.", bullets: ["Əsas fərqləndirici üstünlüklər", "Müştəri cəlbetmə kanalları"] },
      { id: "sec_operations_scalability", title: "Əməliyyat və Miqyaslanma", summary: "Davamlı icra və əməliyyat modeli", content: "Əməliyyat prosesləri, komanda resursları və miqyaslanma infrastrukturu qurulmuşdur.", bullets: ["Əməliyyat səmərəliliyi", "Böyümə üçün kritik resurslar"] },
    ];

    while (normalizedSections.length < 3) {
      const fallback = defaultSections[normalizedSections.length] || {
        id: `section_${normalizedSections.length + 1}`,
        title: `Əlavə Strateji Bölmə ${normalizedSections.length + 1}`,
        summary: "Strateji əlavə",
        content: "Strateji istiqamətin icra və inkişaf detalları.",
        bullets: [],
      };
      normalizedSections.push(fallback);
    }
    parsed.sections = normalizedSections;

    // 4. Priorities (min 1, max 10)
    const rawPriorities = Array.isArray(parsed.priorities) ? parsed.priorities : [];
    const normalizedPriorities = rawPriorities.slice(0, 10).map((pItem, index) => {
      const p = pItem && typeof pItem === "object" ? pItem : {};
      const pTitle = String(p.title || `Prioritet ${index + 1}`).trim().slice(0, 300) || `Prioritet ${index + 1}`;
      const pDesc = String(p.description || "Əsas icra istiqaməti və strateji diqqət mərkəzi.").trim().slice(0, 3000) || "İcra istiqaməti.";
      const rawLevel = String(p.priority || "").toLowerCase().trim();
      const priority = ["high", "medium", "low"].includes(rawLevel) ? rawLevel : "medium";
      return { title: pTitle, description: pDesc, priority };
    });

    if (normalizedPriorities.length === 0) {
      normalizedPriorities.push({
        title: "Əsas Strateji Prioritet",
        description: "İlk mərhələdə kritik bazar mövqelənməsi və ilkin müştəri cəlbinin təmin edilməsi.",
        priority: "high",
      });
    }
    parsed.priorities = normalizedPriorities;

    // 5. Action Plan (min 1, max 10)
    const rawActionPlan = Array.isArray(parsed.actionPlan) ? parsed.actionPlan : [];
    const normalizedActionPlan = rawActionPlan.slice(0, 10).map((act, index) => {
      const a = act && typeof act === "object" ? act : {};
      const phase = String(a.phase || `Faza ${index + 1}`).trim().slice(0, 300) || `Faza ${index + 1}`;
      const actions = Array.isArray(a.actions)
        ? a.actions.slice(0, 10).map((item) => String(item || "").trim().slice(0, 3000)).filter(Boolean)
        : [];
      if (actions.length === 0) {
        actions.push("İlkin icra və hazırlıq addımlarının başladılması.");
      }
      const expectedOutcome = String(a.expectedOutcome || "").trim().slice(0, 800);
      return { phase, actions, expectedOutcome };
    });

    if (normalizedActionPlan.length === 0) {
      normalizedActionPlan.push({
        phase: "Faza 1: İlkin Hazırlıq və Başlanğıc",
        actions: ["Komanda ilə fəaliyyət planının təsdiqi və ilkin icra addımlarının koordinasiyası."],
        expectedOutcome: "İcra prosesinin maneəsiz başlaması.",
      });
    }
    parsed.actionPlan = normalizedActionPlan;

    // 6. KPIs (min 1, max 12)
    const rawKpis = Array.isArray(parsed.kpis) ? parsed.kpis : [];
    const normalizedKpis = rawKpis.slice(0, 12).map((k, index) => {
      const item = k && typeof k === "object" ? k : {};
      const name = String(item.name || `KPI ${index + 1}`).trim().slice(0, 300) || `KPI ${index + 1}`;
      const reason = String(item.reason || "Nəticənin ölçülməsi və izlənməsi üçün əsas göstərici.").trim().slice(0, 3000) || "Ölçülmə göstəricisi.";
      const target = String(item.target || "[Hədəf KPI]: Stabil böyümə").trim().slice(0, 300);
      return { name, reason, target };
    });

    if (normalizedKpis.length === 0) {
      normalizedKpis.push({
        name: "Müştəri Qazanma Göstəricisi",
        reason: "İlkin cəlb kampaniyalarının effektivliyinin və dönüşümünün ölçülməsi.",
        target: "[Hədəf KPI]: Hədəflənən ilkin dönüşüm həcmi",
      });
    }
    parsed.kpis = normalizedKpis;

    // 7. Risks (max 10)
    const rawRisks = Array.isArray(parsed.risks) ? parsed.risks : [];
    parsed.risks = rawRisks.slice(0, 10).map((r) => {
      const item = r && typeof r === "object" ? r : {};
      return {
        risk: String(item.risk || "Potensial bazar və ya əməliyyat riski.").trim().slice(0, 3000) || "Potensial risk.",
        mitigation: String(item.mitigation || "Riskə qarşı önləyici tədbirlər və çevik uyğunlaşma.").trim().slice(0, 3000) || "Önləyici tədbir.",
      };
    });

    // 8. Assumptions (max 12)
    const rawAssumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions : [];
    parsed.assumptions = rawAssumptions
      .slice(0, 12)
      .map((a) => (typeof a === "string" ? a.trim().slice(0, 3000) : String(a || "").slice(0, 3000)))
      .filter(Boolean);

    // 9. Next Steps (min 1, max 12)
    const rawNextSteps = Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [];
    const normalizedNextSteps = rawNextSteps
      .slice(0, 12)
      .map((s) => (typeof s === "string" ? s.trim().slice(0, 3000) : String(s || "").slice(0, 3000)))
      .filter(Boolean);

    if (normalizedNextSteps.length === 0) {
      normalizedNextSteps.push("İlkin yol xəritəsinin təsdiqi və komanda ilə icraya başlanılması.");
    }
    parsed.nextSteps = normalizedNextSteps;

    // 10. Orchestration (optional pass-through)
    if (parsed.orchestration && typeof parsed.orchestration === "object") {
      parsed.orchestration = {
        models: Array.isArray(parsed.orchestration.models) ? parsed.orchestration.models.slice(0, 10).map(String) : null,
        searchGrounded: typeof parsed.orchestration.searchGrounded === "boolean" ? parsed.orchestration.searchGrounded : null,
        sources: Array.isArray(parsed.orchestration.sources)
          ? parsed.orchestration.sources
              .slice(0, 20)
              .filter((s) => {
                if (!s || typeof s.url !== "string") return false;
                try {
                  const u = new URL(s.url);
                  return u.protocol === "http:" || u.protocol === "https:";
                } catch {
                  return false;
                }
              })
              .map((s) => ({
                title: typeof s.title === "string" ? s.title.slice(0, 200) : undefined,
                url: s.url,
              }))
          : null,
        searchQueries: Array.isArray(parsed.orchestration.searchQueries)
          ? parsed.orchestration.searchQueries
              .map((q) => (typeof q === "string" ? q.trim().slice(0, 160) : ""))
              .filter(Boolean)
              .slice(0, 10)
          : undefined,
        searchEntryPoint: parsed.orchestration.searchEntryPoint && typeof parsed.orchestration.searchEntryPoint.renderedContent === "string"
          ? { renderedContent: parsed.orchestration.searchEntryPoint.renderedContent.slice(0, 50000) }
          : undefined,
      };
    }

    return parsed;
  }

  return parsed;
}

export function formatGeminiResponseSchema(schema, name) {
  const jsonFormat = zodResponseFormat(schema, name);
  const rawSchema = jsonFormat.json_schema?.schema || jsonFormat;
  const definitions = rawSchema.definitions || {};

  function resolve(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(resolve);
    const variants = obj.anyOf || obj.oneOf;
    if (Array.isArray(variants)) {
      const nonNull = variants.filter(variant => variant.type !== "null");
      if (nonNull.length === 1 && nonNull.length !== variants.length) return { ...resolve(nonNull[0]), nullable: true };
    }
    if (Array.isArray(obj.type) && obj.type.includes("null") && obj.type.length === 2) return { ...resolve({ ...obj, type: obj.type.find(type => type !== "null") }), nullable: true };
    if ("$ref" in obj) {
      const refKey = String(obj["$ref"]).replace("#/definitions/", "");
      if (definitions[refKey]) {
        return resolve(JSON.parse(JSON.stringify(definitions[refKey])));
      }
    }
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "properties" && v && typeof v === "object") {
        res.properties = {};
        for (const [propName, propVal] of Object.entries(v)) {
          res.properties[propName] = resolve(propVal);
        }
      } else if (k === "items" && v && typeof v === "object") {
        res.items = resolve(v);
      } else if (["type", "required", "enum", "description", "nullable"].includes(k)) {
        res[k] = Array.isArray(v) ? [...v] : v;
      }
    }
    return res;
  }

  return resolve(rawSchema);
}

export async function streamOpenAIContent({ model = aiConfig.strategyFallbackModel, instructions, input, onChunk, onUsage, ownerId, signal, maxOutputTokens = aiConfig.strategyMaxOutputTokens, reasoning = "medium" }) {
  if (!hasOpenAIConfiguration()) {
    throw new LLMProviderError("OpenAI xidməti hələ konfiqurasiya edilməyib. OPENAI_API_KEY əlavə et və yenidən yoxla.", { code: "AI_NOT_CONFIGURED", status: 503, model, provider: "openai" });
  }
  try {
    const stream = await getOpenAIClient().chat.completions.create({
      model,
      messages: [...(instructions ? [{ role: "system", content: instructions }] : []), { role: "user", content: input }],
      stream: true,
      max_completion_tokens: maxOutputTokens,
      reasoning_effort: reasoning,
      user: privacySafeIdentifier(ownerId),
    }, signal ? { signal } : undefined);
    let text = "";
    let finishReason = null;
    let usage = null;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      finishReason = chunk.choices?.[0]?.finish_reason || finishReason;
      usage = chunk.usage || usage;
      if (delta) {
        text += delta;
        onChunk?.({ chunk: delta, finishReason, model });
      }
    }
    onUsage?.({ usage, model, provider: "openai" });
    return { text, finishReason: finishReason || "STOP", model, provider: "openai", usage };
  } catch (error) {
    assertExecutionActive(error, signal);
    throw new LLMProviderError(`OpenAI xidməti ilə əlaqə qurmaq mümkün olmadı: ${error.message}`, { code: "AI_PROVIDER_ERROR", status: error.status || 503, model, provider: "openai", details: error });
  }
}

export async function routeStructuredGeneration({ schema, name, instructions, input, fallbackInput = null, maxOutputTokens, reasoning = "medium", ownerId, signal, onChunk, onUsage, askRoute = null, attachments = [] }) {
  const primaryModel = askRoute ? aiConfig.askGeminiModel : aiConfig.strategyModel;
  const fallbackModel = askRoute ? null : aiConfig.strategyFallbackModel;
  if (attachments.length && !hasGeminiConfiguration()) {
    throw new LLMProviderError("Binary attachment processing requires the configured Gemini multimodal route.", {
      code: "AI_ATTACHMENT_UNAVAILABLE", status: 503, model: primaryModel, provider: "gemini",
    });
  }

  if (askRoute && !hasGeminiConfiguration()) {
    throw new LLMProviderError("Gemini xidməti konfiqurasiya edilməyib. Zəhmət olmasa .env faylında GEMINI_API_KEY əlavə edin.", {
      code: "GEMINI_NOT_CONFIGURED",
      status: 503,
      model: primaryModel,
      provider: "google",
    });
  }

  // 1. Primary: Try Gemini via Vertex AI / Google GenAI
  if (hasGeminiConfiguration() && (!askRoute || askRoute === "gemini-3.8-flash" || askRoute === "gemini-4-hydrogen")) {
    try {
      const gemini = getGeminiClient();
      const geminiSchema = formatGeminiResponseSchema(schema, name);

      const response = await gemini.models.generateContent(
        {
          model: primaryModel,
          contents: attachments.length ? [{ role: "user", parts: [{ text: input }, ...attachments.map(file => ({ inlineData: { mimeType: file.mimeType || file.type, data: file.data } }))] }] : input,
          config: {
            systemInstruction: instructions || undefined,
            responseMimeType: "application/json",
            responseSchema: geminiSchema,
            abortSignal: signal,
            maxOutputTokens: maxOutputTokens || aiConfig.strategyMaxOutputTokens,
            thinkingConfig: {
              thinkingLevel: aiConfig.strategyThinkingLevel || "HIGH",
            },
          },
        },
        signal ? { signal } : undefined,
      );

      const rawText = response.text?.trim() || "";
      if (!rawText) {
        throw new LLMProviderError("Gemini 3.8 Flash boş cavab qaytardı.", {
          code: "AI_INVALID_OUTPUT",
          status: 502,
          model: primaryModel,
          provider: "google",
          details: response,
        });
      }

      let parsedJson;
      try {
        parsedJson = extractJsonFromText(rawText);
      } catch (parseError) {
        throw new LLMProviderError("Gemini 3.8 Flash JSON formatı etibarsızdır.", {
          code: "AI_INVALID_OUTPUT",
          status: 502,
          model: primaryModel,
          provider: "google",
          details: parseError,
        });
      }

      const data = schema.parse(normalizeStructuredOutput(parsedJson, name));
      const finalRawText = JSON.stringify(data);

      let usage = null;
      if (response.usageMetadata) {
        const promptTokens = response.usageMetadata.promptTokenCount || 0;
        const candidateTokens = response.usageMetadata.candidatesTokenCount || 0;
        const thoughtsTokens = response.usageMetadata.thoughtsTokenCount || 0;
        const completionTokens = candidateTokens + thoughtsTokens;
        usage = {
          prompt_tokens: promptTokens || null,
          completion_tokens: completionTokens || null,
          thoughts_tokens: thoughtsTokens || 0,
          total_tokens: response.usageMetadata.totalTokenCount || (promptTokens + completionTokens) || null,
        };
      }

      onChunk?.({ chunk: finalRawText, finishReason: "STOP", model: primaryModel });
      onUsage?.({ usage, model: primaryModel, provider: "google" });

      return {
        data,
        model: primaryModel,
        provider: "google",
        usage,
        finishReason: "STOP",
        rawText: finalRawText,
      };
    } catch (geminiError) {
      assertExecutionActive(geminiError, signal);
      if (askRoute) {
        // Ask mode must never fall back to GPT models.
        throw geminiError;
      }
      console.warn(`[Build Route] ${primaryModel} xətası baş verdi, fallback modelinə (${fallbackModel}) yönləndirilir:`, geminiError.message || geminiError);
      if (attachments.length) throw geminiError;
    }
  }

  // 2. Fallback for Build: GPT-6.1 Sol (medium reasoning) via the Responses API.
  if (askRoute) {
    throw new LLMProviderError("Ask rejimində GPT fallback icazə verilmir.", {
      code: "AI_PROVIDER_ERROR",
      status: 503,
      model: primaryModel,
      provider: "google",
    });
  }
  if (attachments.length) throw new LLMProviderError("Binary attachment processing requires the configured Gemini multimodal route.", {
    code: "AI_ATTACHMENT_UNAVAILABLE", status: 503, model: primaryModel, provider: "gemini",
  });
  if (!hasOpenAIConfiguration()) {
    throw new LLMProviderError("OpenAI xidməti hələ konfiqurasiya edilməyib. OPENAI_API_KEY əlavə et və yenidən yoxla.", {
      code: "AI_NOT_CONFIGURED",
      status: 503,
      model: fallbackModel,
      provider: "openai",
    });
  }

  try {
    const response = await getOpenAIClient().responses.parse(
      {
        model: fallbackModel,
        instructions,
        input: fallbackInput || input,
        text: { format: zodTextFormat(schema, name) },
        reasoning: { effort: reasoning || "medium" },
        max_output_tokens: maxOutputTokens || aiConfig.strategyMaxOutputTokens,
        safety_identifier: privacySafeIdentifier(ownerId),
      },
      signal ? { signal } : undefined,
    );

    if (!response.output_parsed) {
      throw new LLMProviderError("OpenAI cavabı doğrulana bilmədi.", {
        code: "AI_INVALID_OUTPUT",
        status: 502,
        model: fallbackModel,
        provider: "openai",
        details: response,
      });
    }

    const data = schema.parse(normalizeStructuredOutput(response.output_parsed, name));
    const rawText = JSON.stringify(data);
    onChunk?.({ chunk: rawText, finishReason: "STOP", model: fallbackModel });
    onUsage?.({ usage: response.usage || null, model: fallbackModel, provider: "openai" });

    return {
      data,
      model: fallbackModel,
      provider: "openai",
      usage: response.usage || null,
      finishReason: "STOP",
      rawText,
    };
  } catch (error) {
    if (error instanceof LLMProviderError) throw error;
    assertExecutionActive(error, signal);

    if (error.name === "ZodError") throw new LLMProviderError("Model output did not match the artifact schema.", { code: "AI_INVALID_OUTPUT", status: 502, model: fallbackModel, provider: "openai", details: error.issues });

    const httpStatus = error.status || 500;
    if (httpStatus === 429 || error.code === "rate_limit_exceeded") {
      throw new LLMProviderError("GPT-6.1 Sol xidmətində sorğu limiti aşılıb (429). Zəhmət olmasa bir az sonra yenidən cəhd edin.", {
        code: "AI_RATE_LIMITED",
        status: 429,
        model: fallbackModel,
        provider: "openai",
        details: error,
      });
    }

    throw new LLMProviderError(`OpenAI generasiya xətası: ${error.message}`, {
      code: error.code || "AI_PROVIDER_ERROR",
      status: httpStatus >= 500 ? 503 : httpStatus,
      model: fallbackModel,
      provider: "openai",
      details: error,
    });
  }
}
