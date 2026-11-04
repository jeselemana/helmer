import { parseResponse } from "openai/lib/ResponsesParser.mjs";
import { executionContext } from './privacy-policy.js';
import { providerUsage } from './provider-usage.js';
import { isValidBuildOutputReservation, resolveBuildOutputReservation } from "../ai/build-config.js";
let policy;
export function configureProviderPolicy(value) { policy = value; }
export async function assertPlatformEnabled() { await policy?.assertEnabled?.(); }
export function wrapProvider(client, kind, { buildVertex = false } = {}) {
  if (client.__helmerProtected) return client;
  function protect(target, method, type) {
    if (typeof target?.[method] !== 'function') return;
    const original = target[method].bind(target);
    target[method] = async (params, options) => {
      const outputTokenReservation = buildVertex ? resolveBuildOutputReservation(params) : undefined;
      if (buildVertex && (!isValidBuildOutputReservation(params.model, outputTokenReservation) || params.config?.maxOutputTokens !== undefined ||
          (params.model === 'gemini-4-argon' && params.config?.tools?.length) ||
          (params.config?.tools && (!Array.isArray(params.config.tools) || params.config.tools.length > 1 || params.config.tools.some(tool =>
            !tool?.googleSearch || Object.keys(tool).length !== 1 || Object.keys(tool.googleSearch).length !== 0))))) {
        throw Object.assign(new Error('Invalid Build provider configuration'), { code: 'EXECUTION_UNAVAILABLE', status: 503 });
      }
      if (!policy) return original(params, options);
      const context = executionContext.getStore();
      if (!context?.ownerId) throw Object.assign(new Error('Missing execution identity'), { code: 'EXECUTION_UNAVAILABLE', status: 503 });
      const measure = async (name, operation) => {
        const startedAt = Date.now();
        try { return await operation(); }
        finally {
          if (context.timings) {
            context.timings[name] = (context.timings[name] || 0) + Date.now() - startedAt;
            context.timings[`${name}Checks`] = (context.timings[`${name}Checks`] || 0) + 1;
          }
        }
      };
      const authorize = () => measure('authorizationMs', () => context.assertAuthorized?.());
      const enabled = () => measure('platformMs', () => assertPlatformEnabled());
      context.signal?.throwIfAborted();
      await Promise.all([enabled(), authorize()]);
      const release = await policy.reserveProvider(context, params, buildVertex ? { outputTokenReservation } : undefined);
      let checking = false;
      const authorizationTimer = setInterval(async () => {
        if (checking) return;
        checking = true;
        try { await Promise.all([enabled(), authorize()]); }
        catch (error) { context.controller?.abort(error); }
        finally { checking = false; }
      }, 1000);
      authorizationTimer?.unref();
      let lastUsage, released = false, groundedSearchUsed = false, observedOutputBytes = 0, completedSuccessfully = false;
      const observe = value => {
        lastUsage = providerUsage(value) || lastUsage;
        const gm = value?.candidates?.[0]?.groundingMetadata || value?.groundingMetadata;
        if (gm && (gm.webSearchQueries?.length || gm.groundingChunks?.length || gm.searchEntryPoint)) {
          groundedSearchUsed = true;
        }
        if (typeof value?.text === 'string' && value.text.length > 0) {
          observedOutputBytes += Buffer.byteLength(value.text);
        } else if (typeof value?.output_text === 'string' && value.output_text.length > 0) {
          observedOutputBytes += Buffer.byteLength(value.output_text);
        }
      };
      const finish = async () => {
        if (released) return;
        released = true;
        clearInterval(authorizationTimer);
        try {
          if (lastUsage) {
            const usageToRecord = buildVertex && type === 'gemini'
              ? {
                  ...lastUsage,
                  searchCalls: groundedSearchUsed ? Math.max(1, lastUsage.searchCalls || 0) : (lastUsage.searchCalls || 0),
                  searchUsageKnown: true,
                }
              : { ...lastUsage, searchUsageKnown: type !== 'gemini' };
            await release.recordUsage?.(usageToRecord);
            await context.onProviderUsage?.({ provider: kind, model: params.model, ...usageToRecord });
          } else if (completedSuccessfully && observedOutputBytes > 0) {
            const rawInput = typeof params?.contents === 'string' ? params.contents : JSON.stringify(params?.contents || params?.input || params?.messages || '');
            const estimatedUsage = {
              inputTokens: Math.max(1, Math.ceil(Buffer.byteLength(rawInput) / 4)),
              outputTokens: Math.max(1, Math.ceil(observedOutputBytes / 4)),
              searchCalls: groundedSearchUsed ? 1 : 0,
              searchUsageKnown: buildVertex ? true : type !== 'gemini',
              estimated: true,
            };
            await release.recordUsage?.(estimatedUsage);
            await context.onProviderUsage?.({ provider: kind, model: params.model, ...estimatedUsage });
          } else {
            await release.refund?.();
          }
        } catch (error) {
          const failure = /^EXECUTION_/.test(error.code || '') ? error : Object.assign(new Error('Usage settlement unavailable'), { code: 'EXECUTION_UNAVAILABLE', status: 503 });
          context.controller?.abort(failure);
          throw failure;
        } finally { await release(); }
      };
      try {
        context.signal?.throwIfAborted();
        await Promise.all([enabled(), authorize()]);
        const signals = [context.signal, type === 'gemini' ? params.config?.abortSignal : options?.signal].filter(Boolean);
        const signal = signals.length ? AbortSignal.any(signals) : undefined;
        let payload;
        if (type === 'gemini') {
          const rawThinking = params.config?.thinkingConfig;
          const sanitizedThinking = (rawThinking && rawThinking.thinkingLevel && rawThinking.thinkingBudget !== undefined)
            ? { thinkingLevel: rawThinking.thinkingLevel }
            : rawThinking;
          payload = {
            ...params,
            config: {
              ...params.config,
              ...(sanitizedThinking ? { thinkingConfig: sanitizedThinking } : {}),
              ...(buildVertex ? {} : { maxOutputTokens: Math.min(params.config?.maxOutputTokens || 16384, 16384) }),
              abortSignal: signal,
            },
          };
        }
        else if (type === 'chat') payload = { ...params, store: false, ...(params.max_completion_tokens ? { max_completion_tokens: Math.min(params.max_completion_tokens, 16384) } : { max_tokens: Math.min(params.max_tokens || 16384, 16384) }) };
        else payload = { ...params, store: false, max_output_tokens: Math.min(params.max_output_tokens || 16384, 16384), ...(context.guest ? { max_tool_calls: 1 } : {}) };
        context.providerStarted = true;
        if (context.timings) context.timings.providerRequestMs = Date.now() - context.timings.startedAt;
        const value = await original(payload, type === 'gemini' ? undefined : { ...options, signal });
        observe(value);
        if (value?.[Symbol.asyncIterator]) return (async function* () {
          // Grounded Ask keeps this prelude private until its source and fresh
          // authorization gate pass. Validate every event, but let independent
          // checks overlap so source metadata is not trapped behind cloud I/O.
          let bufferPrelude = type === 'gemini' && options?.bufferGroundingPrelude === true &&
            params.config?.tools?.some(tool => tool.googleSearch);
          let prelude = [];
          const validate = async event => {
            observe(event);
            signal?.throwIfAborted();
            await Promise.all([enabled(), authorize()]);
          };
          const drain = async function* () {
            const batch = prelude;
            prelude = [];
            const results = await Promise.all(batch.map(item => item.validation));
            const failure = results.find(result => result.error);
            if (failure) throw failure.error;
            for (const item of batch) {
              signal?.throwIfAborted();
              yield item.event;
            }
          };
          try {
            for await (const event of value) {
              if (context.timings && context.timings.firstProviderEventMs === undefined) {
                context.timings.firstProviderEventMs = Date.now() - context.timings.startedAt;
              }
              if (bufferPrelude) {
                // Attach a rejection handler immediately, even while the next
                // provider event is pending. Failed checks never publish data.
                const validation = validate(event).then(() => ({}), error => {
                  context.controller?.abort(error);
                  return { error };
                });
                prelude.push({ event, validation });
                const hasSources = Boolean((event.candidates?.[0]?.groundingMetadata || event.groundingMetadata)?.groundingChunks?.length);
                if (hasSources || prelude.length >= 16) yield* drain();
                if (hasSources) bufferPrelude = false;
              } else {
                await validate(event);
                yield event;
              }
            }
            if (prelude.length) yield* drain();
            completedSuccessfully = true;
          }
          finally { await finish(); }
        })();
        await Promise.all([enabled(), authorize()]);
        completedSuccessfully = true;
        await finish(); return value;
      } catch (error) {
        if (/^EXECUTION_/.test(error.code || '')) context.controller?.abort(error);
        try { await finish(); } catch {}
        throw error;
      }
    };
  }
  if (kind === 'gemini') {
    protect(client.models, 'generateContent', 'gemini');
    protect(client.models, 'generateContentStream', 'gemini');
    // Explicit caching creates an additional billable operation and persistent
    // provider data. Use bounded local context until it has its own admission.
    if (client.caches?.create) client.caches.create = async () => { throw Object.assign(new Error('Provider context caching disabled'), { code: 'CACHE_DISABLED' }); };
  } else {
    protect(client.responses, 'create', 'responses');
    if (client.responses?.parse) client.responses.parse = async (params, options) => parseResponse(await client.responses.create(params, options), params);
    protect(client.chat?.completions, 'create', 'chat');
  }
  Object.defineProperty(client, '__helmerProtected', { value: true });
  return client;
}
