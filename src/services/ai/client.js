import { wrapProvider } from "../security/provider-policy.js";
import OpenAI from "openai";
import { hasOpenAIConfiguration } from "./config.js";

let client;

export function getOpenAIClient() {
  if (!hasOpenAIConfiguration()) {
    const error = new Error("OpenAI is not configured.");
    error.code = "AI_NOT_CONFIGURED";
    throw error;
  }

  if (!client) {
    client = wrapProvider(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: "https://api.openai.com/v1", logLevel: "off", timeout: 180000, maxRetries: 0 }), "openai");
  }

  return client;
}
