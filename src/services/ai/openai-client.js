import OpenAI from 'openai';
import { wrapProvider } from '../security/provider-policy.js';
import { assertExecutionActive } from '../security/execution-control.js';
import { ASK_TERRA_MODEL } from './ask-routing.js';

let client;
let buildClient;

export function requestBuildResponse(params, { signal, timeoutMs } = {}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AskProviderError('AI_NOT_CONFIGURED', 503);
  buildClient ??= wrapProvider(new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1',
    logLevel: 'off',
    timeout: 450000,
    maxRetries: 0,
  }), 'openai', { buildResponses: true });
  return buildClient.responses.create({ ...params, store: false }, { signal, timeout: timeoutMs });
}

function getAskClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new AskProviderError('OPENAI_NOT_CONFIGURED', 503);
  client ??= wrapProvider(new OpenAI({
    apiKey,
    baseURL: 'https://api.openai.com/v1',
    logLevel: 'off',
    timeout: 180000,
    maxRetries: 0,
  }), 'openai', { askModels: new Set([ASK_TERRA_MODEL]) });
  return client;
}

export class AskProviderError extends Error {
  constructor(code, status, retryAfter) {
    super('Ask provider request failed');
    this.code = code;
    this.status = status;
    if (Number.isSafeInteger(retryAfter) && retryAfter > 0) this.retryAfter = Math.min(300, retryAfter);
  }
}

export function normalizeOpenAIAskError(error, signal) {
  assertExecutionActive(error?.name === 'AbortError' ? undefined : error, signal);
  if (error instanceof AskProviderError) return error;
  const source = error?.error ?? error;
  const code = source?.code;
  const status = error?.status;
  if (['content_filter', 'content_policy_violation', 'moderation_blocked', 'safety_violation'].includes(code)) {
    return new AskProviderError('AI_SAFETY_BLOCKED', 400);
  }
  if (status === 400 && source?.param === 'reasoning.effort' &&
      (['unsupported_value', 'unsupported_parameter'].includes(code) || /\bnone\b/i.test(source?.message || ''))) {
    return new AskProviderError('OPENAI_UNSUPPORTED_REASONING_EFFORT', 400);
  }
  if (status === 401 || status === 403 || ['invalid_api_key', 'permission_denied'].includes(code)) {
    return new AskProviderError('AI_AUTH_ERROR', 503);
  }
  if (status === 429 || ['rate_limit_exceeded', 'insufficient_quota'].includes(code)) {
    const header = error?.headers?.get?.('retry-after') ?? error?.headers?.['retry-after'];
    return new AskProviderError('AI_RATE_LIMITED', 429, /^\d+$/.test(header ?? '') ? Number(header) : 60);
  }
  if (status === 408 || status === 504 || error?.name === 'APIConnectionTimeoutError' || code === 'request_timeout') {
    return new AskProviderError('ASK_PROVIDER_TIMEOUT', 504);
  }
  if (code === 'OPENAI_NOT_CONFIGURED') return new AskProviderError(code, 503);
  return new AskProviderError('OPENAI_PROVIDER_ERROR', 503);
}

export async function requestAskResponse(params, { signal, timeoutMs } = {}) {
  try {
    return await getAskClient().responses.create({ ...params, store: false }, { signal, timeout: timeoutMs });
  } catch (error) {
    throw normalizeOpenAIAskError(error, signal);
  }
}

export function responseText(response) {
  const content = response?.output?.flatMap(item => item.type === 'message' ? item.content || [] : []) || [];
  if (response?.incomplete_details?.reason === 'content_filter' || content.some(part => part.type === 'refusal')) {
    throw new AskProviderError('AI_SAFETY_BLOCKED', 400);
  }
  return content.filter(part => part.type === 'output_text').map(part => part.text).join('');
}
