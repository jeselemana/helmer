import { extractCleanDomain, isGoogleRelayHostOrUrl, isLowQualityDomain, isHighSignalDomain } from "./research-service.js";

export function sanitizeAskGroundingMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  // Provider metadata is untrusted. Never expose arbitrary SDK fields or raw HTML.
  const sanitized = {
    groundingChunks: Array.isArray(metadata.groundingChunks) ? metadata.groundingChunks.slice(0, 64).map(chunk => ({
      web: { uri: chunk?.web?.uri, title: typeof chunk?.web?.title === 'string' ? chunk.web.title.slice(0, 300) : '' },
    })) : [],
    webSearchQueries: Array.isArray(metadata.webSearchQueries) ? metadata.webSearchQueries.slice(0, 10) : [],
    searchSuggestions: Array.isArray(metadata.searchSuggestions) ? metadata.searchSuggestions.slice(0, 10) : [],
    searchEntryPoint: typeof metadata.searchEntryPoint?.renderedContent === 'string'
      ? { renderedContent: metadata.searchEntryPoint.renderedContent.slice(0, 50000) } : undefined,
  };
  const seenSources = new Set();
  if (Array.isArray(sanitized.groundingChunks)) {
    sanitized.groundingChunks = sanitized.groundingChunks.filter((chunk) => {
      const uri = chunk?.web?.uri;
      if (typeof uri !== "string" || !uri.trim()) return false;
      try {
        const parsed = new URL(uri.trim());
        const cleanHost = extractCleanDomain(parsed.href);
        if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password ||
            parsed.href.length > 2000 || isGoogleRelayHostOrUrl(parsed.href) || !cleanHost ||
            isLowQualityDomain(cleanHost) || seenSources.has(parsed.href)) return false;
        chunk.web.uri = parsed.href;
        seenSources.add(parsed.href);
        return true;
      } catch {
        return false;
      }
    }).sort((left, right) => Number(isHighSignalDomain(right.web.uri)) - Number(isHighSignalDomain(left.web.uri)));
  }
  if (Array.isArray(sanitized.webSearchQueries)) {
    sanitized.webSearchQueries = sanitized.webSearchQueries
      .map((q) => (typeof q === "string" ? q.trim().slice(0, 160) : ""))
      .filter(Boolean)
      .slice(0, 10);
  }
  if (sanitized.searchEntryPoint && typeof sanitized.searchEntryPoint === "object") {
    const renderedContent = typeof sanitized.searchEntryPoint.renderedContent === "string"
      ? sanitized.searchEntryPoint.renderedContent.slice(0, 50000)
      : undefined;
    sanitized.searchEntryPoint = renderedContent ? { renderedContent } : undefined;
  }
  const suggestions = [];
  const seenSuggestions = new Set();
  const addSuggestion = (query, rawUrl) => {
    const cleanQuery = String(query || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!cleanQuery) return;
    let url = `https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}`;
    if (typeof rawUrl === "string" && rawUrl.trim()) {
      try {
        const parsed = new URL(rawUrl.trim());
        const host = parsed.hostname.toLowerCase();
        if (
          (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password && parsed.href.length <= 2000 &&
          (host === "www.google.com" || host === "google.com" || host.endsWith(".google.com") || host.endsWith(".cloud.google.com"))
        ) {
          url = parsed.href;
        }
      } catch {}
    }
    const key = cleanQuery.toLowerCase();
    if (seenSuggestions.has(key)) return;
    seenSuggestions.add(key);
    suggestions.push({ query: cleanQuery, url });
  };
  const rendered = sanitized?.searchEntryPoint?.renderedContent;
  if (typeof rendered === "string" && rendered.trim()) {
    const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(rendered)) !== null && suggestions.length < 10) {
      const href = match[1].replace(/&amp;/g, "&");
      const label = match[2].replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
      if (label) addSuggestion(label, href);
    }
  }
  if (Array.isArray(sanitized.webSearchQueries)) {
    for (const q of sanitized.webSearchQueries) {
      if (suggestions.length >= 10) break;
      if (typeof q === "string" && q.trim()) addSuggestion(q, null);
    }
  }
  if (Array.isArray(sanitized.searchSuggestions)) {
    for (const item of sanitized.searchSuggestions) {
      if (suggestions.length >= 10) break;
      if (item && typeof item === "object") addSuggestion(item.query || item.label, item.url);
    }
  }
  sanitized.searchSuggestions = suggestions;
  delete sanitized.searchEntryPoint;
  return sanitized;
}

