import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import { wrapProvider } from "../security/provider-policy.js";
import { hasGeminiConfiguration } from "./config.js";

let geminiClient;

export function resolveGeminiClientOptions(env = process.env, existsSync = fs.existsSync) {
  const credPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const hasValidCredFile = Boolean(credPath && existsSync(credPath));
  const apiKey = env.GEMINI_API_KEY?.trim();
  const isVertexKey = Boolean(apiKey?.startsWith("AQ."));
  const project = (env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT)?.trim() || "";
  const location = (
    env.GOOGLE_CLOUD_LOCATION?.trim() ||
    env.GOOGLE_CLOUD_REGION?.trim() ||
    env.BUILD_VERTEX_LOCATION?.trim() ||
    "us-central1"
  ).toLowerCase();
  const hasServiceAccount = Boolean(hasValidCredFile || project);
  const isVertex = env.GEMINI_USE_VERTEX === "true" ||
    isVertexKey ||
    (!apiKey && hasServiceAccount);

  // Vertex AI with ADC / Service Account / GCP Project must not simultaneously pass a non-Vertex Developer API key
  const useVertexProjectAuth = Boolean(isVertex && !isVertexKey && hasServiceAccount);
  const passApiKey = Boolean(apiKey && !useVertexProjectAuth);
  const vertexBaseUrl = isVertex && !isVertexKey ? resolveVertexBaseUrl(location) : null;

  return {
    credPath,
    hasValidCredFile,
    options: {
      ...(passApiKey ? { apiKey } : {}),
      ...(isVertex ? { vertexai: true } : {}),
      ...(isVertex && !isVertexKey ? { location } : {}),
      ...(isVertex && !isVertexKey && project ? { project } : {}),
      httpOptions: {
        ...(vertexBaseUrl ? { baseUrl: vertexBaseUrl } : {}),
        timeout: 180000,
        retryOptions: { attempts: 1 },
      },
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
