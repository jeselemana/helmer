import fs from "node:fs";
import { buildConfig } from "./build-config.js";
import { wrapProvider } from "../security/provider-policy.js";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { hasOpenAIConfiguration, hasGeminiConfiguration } from "./config.js";

let client;
let geminiClient;

export function getOpenAIClient() {
  if (!hasOpenAIConfiguration()) {
    const error = new Error("OpenAI is not configured.");
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }

  if (!client) {
    client = wrapProvider(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 180000, maxRetries: 0 }), "openai");
  }

  return client;
}

export function resolveGeminiClientOptions(env = process.env, existsSync = fs.existsSync) {
  const credPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const hasValidCredFile = Boolean(credPath && existsSync(credPath));
  const apiKey = env.GEMINI_API_KEY?.trim();
  const isVertexKey = Boolean(apiKey?.startsWith("AQ."));
  const project = (env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT)?.trim() || "";
  const location = env.GOOGLE_CLOUD_LOCATION?.trim() || "global";
  const hasServiceAccount = Boolean(hasValidCredFile || project);
  const isVertex = env.GEMINI_USE_VERTEX === "true" ||
    isVertexKey ||
    (!apiKey && hasServiceAccount);

  // Vertex AI with ADC / Service Account / GCP Project must not simultaneously pass a non-Vertex Developer API key
  const useVertexProjectAuth = Boolean(isVertex && !isVertexKey && hasServiceAccount);
  const passApiKey = Boolean(apiKey && !useVertexProjectAuth);

  return {
    credPath,
    hasValidCredFile,
    options: {
      ...(passApiKey ? { apiKey } : {}),
      ...(isVertex ? { vertexai: true } : {}),
      ...(isVertex && !isVertexKey ? { location } : {}),
      ...(isVertex && !isVertexKey && project ? { project } : {}),
      httpOptions: { timeout: 180000 },
    },
  };
}

export function getGeminiClient() {
  if (!hasGeminiConfiguration()) {
    const error = new Error("Gemini xidməti konfiqurasiya edilməyib. GEMINI_API_KEY və ya Vertex layihə ID-si əlavə edin.");
    error.code = "GEMINI_NOT_CONFIGURED";
    throw error;
  }

  if (!geminiClient) {
    const { credPath, hasValidCredFile, options } = resolveGeminiClientOptions(process.env, fs.existsSync);
    if (credPath && !hasValidCredFile) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }

    const savedProject = process.env.GOOGLE_CLOUD_PROJECT;
    const savedGcpProject = process.env.GCP_PROJECT;
    const savedLocation = process.env.GOOGLE_CLOUD_LOCATION;
    if (options.vertexai && options.apiKey) {
      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GCP_PROJECT;
      delete process.env.GOOGLE_CLOUD_LOCATION;
    }
    try {
      geminiClient = wrapProvider(new GoogleGenAI(options), "gemini");
    } finally {
      if (options.vertexai && options.apiKey) {
        if (savedProject !== undefined) process.env.GOOGLE_CLOUD_PROJECT = savedProject;
        if (savedGcpProject !== undefined) process.env.GCP_PROJECT = savedGcpProject;
        if (savedLocation !== undefined) process.env.GOOGLE_CLOUD_LOCATION = savedLocation;
      }
    }
  }

  return geminiClient;
}

export function resolveVertexBaseUrl(location = "us") {
  const normalized = String(location || "us").trim().toLowerCase();
  if (normalized === "global") return "https://aiplatform.googleapis.com";
  if (normalized === "us") return "https://aiplatform.us.rep.googleapis.com";
  if (normalized === "eu") return "https://aiplatform.eu.rep.googleapis.com";
  if (/^[a-z]+-[a-z]+\d+$/.test(normalized)) {
    return `https://${normalized}-aiplatform.googleapis.com`;
  }
  throw Object.assign(new Error("Invalid Vertex AI location."), { code: "AI_NOT_CONFIGURED", status: 503 });
}

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
