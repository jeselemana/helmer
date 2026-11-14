import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from 'redis';
import { getGeminiClient } from '../src/services/ai/client.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { configureProviderPolicy } from '../src/services/security/provider-policy.js';
import { executionContext } from '../src/services/security/privacy-policy.js';

function safeFailure(error) {
  const status = Number(error?.status);
  const codes = { 401: 'GEMINI_AUTH_FAILED', 403: 'GEMINI_PERMISSION_DENIED', 404: 'GEMINI_MODEL_UNAVAILABLE', 429: 'GEMINI_RATE_LIMITED' };
  return { ok: false, code: error?.name === 'TimeoutError' || error?.name === 'AbortError'
    ? 'GEMINI_TIMEOUT' : codes[status] || 'GEMINI_CHECK_FAILED',
    ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}) };
}

// Express API keys support generation, streaming and token counting, not the
// model metadata GET endpoint. Probe the operation the application actually uses.
export async function checkGeminiConnection({ client, signal = AbortSignal.timeout(20000) } = {}) {
  const startedAt = Date.now();
  try {
    signal.throwIfAborted();
    const response = await (client || getGeminiClient()).models.generateContent({
      model: 'gemini-4-hydrogen', contents: 'Reply with exactly OK.',
      config: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: 'LOW' }, abortSignal: signal },
    });
    signal.throwIfAborted();
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason !== 'STOP' || typeof response.text !== 'string' || !response.text.trim()) {
      return { ok: false, code: 'GEMINI_INVALID_RESPONSE', elapsedMs: Date.now() - startedAt };
    }
    return { ok: true, model: 'gemini-4-hydrogen', operation: 'generateContent', elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { ...safeFailure(error), elapsedMs: Date.now() - startedAt };
  }
}

async function main() {
  dotenv.config({ quiet: true });
  let redis;
  try {
    if (process.env.REDIS_URL) {
      redis = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 5000, reconnectStrategy: false } });
      redis.on('error', () => {});
      await redis.connect();
    }
    // Retain the application's provider admission/budget policy for this small,
    // synthetic probe. It never reads a user profile or stores model content.
    configureProviderPolicy(new AiPolicy({ redis }));
    const controller = new AbortController();
    const context = { ownerId: `diagnostic_${randomUUID()}`, controller, signal: controller.signal,
      assertAuthorized: async () => controller.signal.throwIfAborted() };
    const result = await executionContext.run(context, () => checkGeminiConnection());
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify(safeFailure(error)));
    process.exitCode = 1;
  } finally {
    configureProviderPolicy(undefined);
    if (redis?.isOpen) redis.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
