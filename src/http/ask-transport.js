import { publicAskErrorCode } from './ask-errors.js';
import { once } from 'node:events';
import { createExecutionController } from '../services/security/execution-control.js';

export const PUBLIC_ERROR_MESSAGES = Object.freeze({
  DAILY_BUDGET_EXCEEDED: 'Gündəlik istifadə limitinə çatmısınız. Sabah yenidən cəhd edin.',
  REVISION_CONFLICT: 'Söhbət başqa tabda yenilənib. Səhifəni yeniləyib təkrar cəhd edin.',
  EXECUTION_BUSY: 'Hazırda başqa tapşırıq icra olunur. Bir az sonra yenidən cəhd edin.',
  AI_SAFETY_BLOCKED: 'Sorğu təhlükəsizlik siyasəti səbəbindən dayandırıldı.',
  AI_CONTENT_BLOCKED: 'Sorğu təhlükəsizlik siyasəti səbəbindən dayandırıldı.',
  AI_ATTACHMENT_UNAVAILABLE: 'Şəkli PNG, JPG və ya WebP formatında yenidən əlavə edin.',
  AI_RATE_LIMITED: 'Süni intellekt xidmətinin sorğu limiti dolub. Bir qədər sonra yenidən cəhd edin.',
  ASK_PROVIDER_TIMEOUT: 'Cavab üçün gözləmə müddəti bitdi. Yenidən cəhd edin.',
  ASK_TIMEOUT: 'Cavab üçün gözləmə müddəti bitdi. Yenidən cəhd edin.',
  EXECUTION_TIMEOUT: 'Cavab üçün gözləmə müddəti bitdi. Yenidən cəhd edin.',
  GROUNDING_UNAVAILABLE: 'Veb axtarışı etibarlı mənbələri təsdiqləyə bilmədi. Yenidən cəhd edin.',
  AI_MAX_TOKENS: 'Cavab uzunluq limitinə çatdığı üçün tamamlanmadı. Sualı daha qısa hissələrə bölün.',
  ASK_EMPTY_RESPONSE: 'Model cavab qaytarmadı. Yenidən cəhd edin.',
  EXECUTION_REVOKED: 'Sessiya və ya kontekst dəyişdiyi üçün sorğu dayandırıldı.',
  STORAGE_BUSY: 'Məlumat bazası hazırda məşğuldur. Bir neçə saniyə sonra yenidən cəhd edin.',
  ASK_CANCELLED: 'Sorğu istifadəçi tərəfindən dayandırıldı.',
});

export function publicAskErrorMessage(errorOrCode) {
  const code = typeof errorOrCode === 'string'
    ? publicAskErrorCode({ code: errorOrCode })
    : publicAskErrorCode(errorOrCode);
  return PUBLIC_ERROR_MESSAGES[code] || 'Sorğunu tamamlamaq mümkün olmadı.';
}

// One lifetime spans context loading, generation, persistence and final delivery.
export function createAskTransport(req, res, { requestTimeoutMs = 180000, maxBufferedBytes = 1024 * 1024 } = {}) {
  const controller = createExecutionController();
  let streaming = false, heartbeat;
  let clientDisconnected = false;
  const abort = () => {
    if (!res.writableEnded) {
      clientDisconnected = true;
      clearInterval(heartbeat);
      controller.abort(Object.assign(new Error('Ask client disconnected'), { name: 'AbortError', code: 'ASK_CANCELLED' }));
    }
  };
  // IncomingMessage.close also fires after a completely received request body.
  const requestClosed = () => { if (req.aborted || req.complete === false) abort(); };
  req.on('close', requestClosed);
  req.on('aborted', abort);
  res.on('close', abort);
  const deadline = setTimeout(() => {
    const error = Object.assign(new Error('Ask deadline exceeded'), { code: 'ASK_TIMEOUT', status: 504 });
    controller.abort(error);
    if (res.destroyed || res.writableEnded) return;
    const payload = { code: error.code, error: 'Sorğunu tamamlamaq mümkün olmadı.' };
    if (req.securityContext) req.securityContext.askTerminalFailure = true;
    if (streaming) res.end(`data: ${JSON.stringify(payload)}\n\n`);
    else res.status(504).json(payload);
  }, requestTimeoutMs);
  deadline.unref?.();
  if (req.aborted || res.destroyed) abort();
  const send = data => {
    controller.signal.throwIfAborted();
    if (res.destroyed || res.writableEnded) throw Object.assign(new Error('Connection closed'), { name: 'AbortError' });
    if (res.writableLength > maxBufferedBytes) {
      controller.abort(Object.assign(new Error('Slow Ask consumer'), { code: 'ASK_SLOW_CONSUMER', status: 503 }));
      controller.signal.throwIfAborted();
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    res.flush?.();
  };
  return {
    signal: controller.signal,
    get streaming() { return streaming; },
    get disconnected() { return clientDisconnected || res.destroyed || res.writableEnded; },
    abortExplicit(reason) {
      controller.abort(
        reason || Object.assign(new Error('Ask cancelled by user'), { name: 'AbortError', code: 'ASK_CANCELLED' })
      );
    },
    start() {
      if (streaming) return;
      controller.signal.throwIfAborted();
      streaming = true;
      req.socket?.setTimeout?.(0);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Content-Encoding', 'identity');
      res.flushHeaders?.();
      if (!clientDisconnected && !res.destroyed && !res.writableEnded) {
        if (!res.writableNeedDrain && !controller.signal.aborted) {
          res.write(': keepalive\n\n');
          res.flush?.();
        }
        heartbeat = setInterval(() => {
          if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain && !controller.signal.aborted) {
            res.write(': keepalive\n\n');
            res.flush?.();
          }
        }, 15000);
        heartbeat.unref?.();
      }
    },
    send,
    async drain() {
      controller.signal.throwIfAborted();
      if (res.writableNeedDrain) await once(res, 'drain', { signal: controller.signal });
      controller.signal.throwIfAborted();
    },
    fail(error, publicPayload) {
      if (res.destroyed || res.writableEnded) return;
      if (req.securityContext) req.securityContext.askTerminalFailure = true;
      const code = publicAskErrorCode(error);
      const fallbackPayload = {
        error: PUBLIC_ERROR_MESSAGES[code] || 'Sorğunu tamamlamaq mümkün olmadı.',
        code,
        ...(code === 'AI_RATE_LIMITED' && Number.isSafeInteger(error?.retryAfter) ? { retryAfter: error.retryAfter } : {}),
        ...(code === 'REVISION_CONFLICT' && Number.isInteger(error?.revision) ? { revision: error.revision } : {}),
      };
      // The operation can be aborted while the HTTP socket is still usable.
      res.end(`data: ${JSON.stringify(publicPayload || fallbackPayload)}\n\n`);
    },
    dispose() {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      req.off('close', requestClosed);
      req.off('aborted', abort);
      res.off('close', abort);
    },
  };
}
