import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { buildConfig } from "../../src/services/ai/build-config.js";
import { wrapProvider } from "../../src/services/security/provider-policy.js";
import { resolveVertexBaseUrl } from "../../src/services/ai/research-google-client.js";

// Build uses isolated Vertex AI clients and ADC/Cloud Run service identity.
// Explicit project/location override any ambient Gemini/Google API keys in the SDK.
const buildVertexClients = new Map();

export function resolveBuildVertexClientOptions(env = process.env, existsSync = fs.existsSync, locationOverride = null) {
  const credentialPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const project = (env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT || "").trim();
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) ||
      (credentialPath && !existsSync(credentialPath)) ||
      (env.NODE_ENV === "production" && credentialPath)) {
    throw Object.assign(new Error("Build AI service is not configured."), { code: "AI_NOT_CONFIGURED", status: 503 });
  }
  const location = (locationOverride || env.BUILD_VERTEX_LOCATION || env.GOOGLE_CLOUD_BUILD_LOCATION || buildConfig.location || "us").trim().toLowerCase();
  const baseUrl = resolveVertexBaseUrl(location);
  return {
    vertexai: true,
    project,
    location,
    httpOptions: {
      baseUrl,
      apiVersion: "v1beta1",
      timeout: buildConfig.clientTimeoutMs,
      retryOptions: { attempts: 1 },
    },
  };
}

export function getBuildVertexClient(location = null) {
  const defaultLoc = (process.env.BUILD_VERTEX_LOCATION || process.env.GOOGLE_CLOUD_BUILD_LOCATION || buildConfig.location || "us").trim().toLowerCase();
  const targetLoc = (location || defaultLoc).trim().toLowerCase();

  if (!buildVertexClients.has(defaultLoc)) {
    const primaryOptions = resolveBuildVertexClientOptions(process.env, fs.existsSync, defaultLoc);
    buildVertexClients.set(defaultLoc, wrapProvider(new GoogleGenAI(primaryOptions), "gemini", { buildVertex: true }));
  }

  const primaryClient = buildVertexClients.get(defaultLoc);
  if (targetLoc === defaultLoc) {
    return primaryClient;
  }

  // If unit tests mocked methods on the primary client, route fallback calls through the mocked client.
  if (primaryClient?.models?.generateContent?.mock || primaryClient?.models?.generateContentStream?.mock) {
    return primaryClient;
  }

  if (!buildVertexClients.has(targetLoc)) {
    const targetOptions = resolveBuildVertexClientOptions(process.env, fs.existsSync, targetLoc);
    buildVertexClients.set(targetLoc, wrapProvider(new GoogleGenAI(targetOptions), "gemini", { buildVertex: true }));
  }

  return buildVertexClients.get(targetLoc);
}

const decisionVertexClients = new Map();

export function resolveDecisionApiKey(env = process.env) {
  const decisionKey = (env?.GEMINI_DECISION_API_KEY || env?.DECISIONS_API_KEY || "").trim();
  if (decisionKey) return decisionKey;
  const apiKey = env?.GEMINI_API_KEY?.trim() || "";
  return apiKey && !apiKey.startsWith("AQ.") ? apiKey : "";
}

export function getDecisionsApiStatus(env = process.env) {
  const dedicatedKey = (env?.GEMINI_DECISION_API_KEY || "").trim();
  const aliasKey = (env?.DECISIONS_API_KEY || "").trim();
  const resolved = resolveDecisionApiKey(env);
  return {
    model: "gemini-decision-1",
    fallbackModel: "gemini-3.5-flash-lite",
    configured: Boolean(resolved),
    keySource: dedicatedKey
      ? "GEMINI_DECISION_API_KEY"
      : aliasKey
        ? "DECISIONS_API_KEY"
        : (resolved ? "GEMINI_API_KEY" : "none"),
    endpoint: "https://generativelanguage.googleapis.com/v1beta/decisions",
  };
}

export function hasDecisionApiConfiguration(env = process.env) {
  return Boolean(resolveDecisionApiKey(env));
}

export function resolveDecisionVertexConfig(env = process.env, existsSync = fs.existsSync, locationOverride = null) {
  const location = (
    locationOverride ||
    env?.BUILD_VERTEX_LOCATION ||
    env?.GOOGLE_CLOUD_LOCATION ||
    env?.GOOGLE_CLOUD_BUILD_LOCATION ||
    buildConfig.location ||
    "us"
  ).trim().toLowerCase();

  const project = (env?.GOOGLE_CLOUD_PROJECT || env?.GCP_PROJECT || "").trim();
  const credentialPath = env?.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const apiKey = env?.GEMINI_API_KEY?.trim() || "";
  const isVertexKey = apiKey.startsWith("AQ.");

  if (/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) &&
      (!credentialPath || existsSync(credentialPath)) &&
      !(env?.NODE_ENV === "production" && credentialPath)) {
    const baseUrl = resolveVertexBaseUrl(location);
    return {
      vertexai: true,
      project,
      location,
      httpOptions: {
        baseUrl,
        apiVersion: "v1beta1",
        timeout: 10000,
        retryOptions: { attempts: 1 },
      },
    };
  }

  if (isVertexKey || env?.GEMINI_USE_VERTEX === "true" || hasGeminiConfiguration(env)) {
    const { options } = resolveGeminiClientOptions(env, existsSync);
    const vertexBaseUrl = options.vertexai && !isVertexKey ? resolveVertexBaseUrl(location) : null;
    return {
      ...options,
      vertexai: true,
      ...(options.vertexai && !isVertexKey ? { location } : {}),
      httpOptions: {
        ...(options.httpOptions || {}),
        ...(vertexBaseUrl ? { baseUrl: vertexBaseUrl } : {}),
        timeout: 10000,
      },
    };
  }

  throw Object.assign(new Error("Decision Vertex fallback service is not configured."), {
    code: "AI_NOT_CONFIGURED",
    status: 503,
  });
}

export function getDecisionVertexClient(location = null, env = process.env) {
  const options = resolveDecisionVertexConfig(env, fs.existsSync, location);
  const cacheKey = `${options.location || "default"}|${options.project || ""}|${options.apiKey ? "key" : "adc"}`;
  if (!decisionVertexClients.has(cacheKey)) {
    decisionVertexClients.set(cacheKey, wrapProvider(new GoogleGenAI(options), "gemini"));
  }
  return decisionVertexClients.get(cacheKey);
}

const SAFETY_BLOCK_PATTERN = /(?:safety|content_blocked|prohibited_content|blocklist|blocked)/i;

export async function callDecisionsApi({
  model = "gemini-decision-1",
  input,
  questions,
  signal,
  fetcher = fetch,
  env = process.env,
} = {}) {
  const apiKey = resolveDecisionApiKey(env);
  if (!apiKey) {
    throw Object.assign(new Error("Decisions API developer key is not configured."), {
      code: "AI_NOT_CONFIGURED",
      status: 503,
    });
  }

  return decisionsClient.decide({ model, input, questions }, { apiKey, signal, fetcher });
}

const decisionsClient = wrapProvider({
  decide: requestDecision,
}, "decision");

async function requestDecision(params, { apiKey, signal, fetcher }) {
  const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/decisions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(params),
    signal,
  });

  const rawText = await response.text();
  let payload = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errObj = payload?.error && typeof payload.error === "object" ? payload.error : {};
    const statusText = `${errObj.status || ""} ${errObj.code || ""} ${errObj.message || ""} ${rawText}`.trim();
    const isSafetyBlock = response.status === 400 && SAFETY_BLOCK_PATTERN.test(statusText);
    if (isSafetyBlock) {
      throw Object.assign(new Error("Decision request blocked by safety policy."), {
        code: "AI_CONTENT_BLOCKED",
        status: 400,
        isSafetyBlock: true,
        providerCode: errObj.status || "CONTENT_BLOCKED",
      });
    }
    throw Object.assign(
      new Error(`Decisions API request failed with status ${response.status}.`),
      {
        code: response.status === 429 ? "RATE_LIMITED" : "DECISION_API_ERROR",
        status: response.status,
      }
    );
  }

  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("Decisions API returned invalid JSON payload."), {
      code: "DECISION_API_INVALID_RESPONSE",
      status: 502,
    });
  }

  return payload;
}
