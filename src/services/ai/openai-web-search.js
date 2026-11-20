import { detectSensitiveInformation } from '../../auth/validation.js';
import { LOW_QUALITY_DOMAINS } from './research-service.js';
import { sanitizeAskGroundingMetadata } from './ask-grounding.js';

export const MAX_WEB_SEARCH_CALLS = 2;

export function webSearchOptions(required = false) {
  return {
    tools: [{ type: 'web_search', filters: { blocked_domains: [...LOW_QUALITY_DOMAINS] } }],
    tool_choice: required ? 'required' : 'auto',
    max_tool_calls: MAX_WEB_SEARCH_CALLS,
  };
}

export function isBoundedWebSearch(params) {
  if (params.tools === undefined) return params.tool_choice === undefined && params.max_tool_calls === undefined;
  const tool = params.tools?.[0];
  const turn = params.input?.[0], part = turn?.content?.[0];
  return Array.isArray(params.tools) && params.tools.length === 1 &&
    tool?.type === 'web_search' && Object.keys(tool).length === 2 &&
    Object.keys(tool.filters || {}).length === 1 &&
    JSON.stringify(tool.filters?.blocked_domains) === JSON.stringify(LOW_QUALITY_DOMAINS) &&
    ['auto', 'required'].includes(params.tool_choice) &&
    Number.isInteger(params.max_tool_calls) && params.max_tool_calls >= 1 && params.max_tool_calls <= MAX_WEB_SEARCH_CALLS &&
    Array.isArray(params.input) && params.input.length === 1 && turn?.role === 'user' &&
    Array.isArray(turn.content) && turn.content.length === 1 && part?.type === 'input_text' &&
    Boolean(publicSearchText(part.text));
}

export function responseCitations(response) {
  return (response?.output || []).flatMap(item => item.type === 'message'
    ? (item.content || []).flatMap(part => part.type === 'output_text' ? part.annotations || [] : [])
    : []);
}

export function citationGrounding(annotations, sanitize = sanitizeAskGroundingMetadata) {
  const links = annotations.filter(annotation => annotation?.type === 'url_citation' && typeof annotation.url === 'string');
  const result = sanitize({ groundingChunks: links.map(({ url, title }) => ({ web: { uri: url, title } })) });
  return result?.groundingChunks?.length ? result : null;
}

// Only the user's public lookup text belongs in a tool-enabled request.
export function publicSearchText(input) {
  if (typeof input !== 'string') return '';
  const text = input.trim();
  if (!text || text.length > 2000 || detectSensitiveInformation(text).isSensitive ||
      /<\/?(?:untrusted|uploaded|saved_|system|developer)|\b(?:secret|private|confidential|credential|password|api[_ -]?key|access[_ -]?token|parol|məxfi)\b|\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)|https?:\/\/[^\s/]+@/iu.test(text)) return '';
  return text;
}
