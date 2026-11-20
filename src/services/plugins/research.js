import { hasOpenAIConfiguration } from "../ai/config.js";
import { extractCleanDomain, isGoogleRelayHostOrUrl, isLowQualityDomain, scoreDomain } from "../ai/research-service.js";

function safeSource(url, title, rawDomain) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.href.length > 2000) return null;
    const cleanRawDomain = typeof rawDomain === "string" ? rawDomain.trim() : "";
    const isOfficialVertexRedirect =
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "vertexaisearch.cloud.google.com" &&
      parsed.pathname.startsWith("/grounding-api-redirect/");

    let verifiedDomain = "";
    if (isOfficialVertexRedirect) {
      if (!cleanRawDomain || isLowQualityDomain(cleanRawDomain)) return null;
      verifiedDomain = extractCleanDomain(cleanRawDomain);
    } else {
      if (isGoogleRelayHostOrUrl(parsed.href)) return null;
      verifiedDomain = extractCleanDomain(parsed.hostname);
      if (cleanRawDomain && (!extractCleanDomain(cleanRawDomain) || isLowQualityDomain(cleanRawDomain))) return null;
    }
    if (!verifiedDomain || isLowQualityDomain(verifiedDomain)) return null;
    return {
      web: {
        uri: parsed.href,
        title: String(title || verifiedDomain).slice(0, 180),
        domain: verifiedDomain,
      },
    };
  } catch {
    return null;
  }
}

export function createWebResearch({ openaiResearch } = {}) {
  return async ({ messages, instructions, signal, onChunk }) => {
    if (hasOpenAIConfiguration() && openaiResearch) {
      try {
        const result = await openaiResearch({ messages, instructions, signal, onChunk });
        const rawChunks = result.groundingMetadata?.groundingChunks || [];
        const groundingChunks = rawChunks
          .map(chunk => safeSource(chunk.web?.uri, chunk.web?.title, chunk.web?.domain))
          .filter(Boolean)
          .sort((a, b) => scoreDomain(b.web?.domain || b.web?.uri) - scoreDomain(a.web?.domain || a.web?.uri))
          .slice(0, 30);
        if (groundingChunks.length || result?.ungroundedFallback) {
          return { ...result, groundingMetadata: { ...(result.groundingMetadata || {}), groundingChunks } };
        }
      } catch (error) {
        throw error;
      }
    }
    throw Object.assign(new Error("Web search grounding unavailable"), { code: 'GROUNDING_UNAVAILABLE', status: 503 });
  };
}
