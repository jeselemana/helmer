import { publicAskErrorCode } from './ask-errors.js';
import { once } from 'node:events';
import { createExecutionController } from '../services/security/execution-control.js';

// One lifetime spans context loading, generation, persistence and final delivery.
export function createAskTransport(req, res, { requestTimeoutMs = 180000, maxBufferedBytes = 1024 * 1024 } = {}) {
  const controller = createExecutionController();
  let streaming = false, heartbeat;
  const abort = () => { if (!res.writableEnded) controller.abort(); };
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
      heartbeat = setInterval(() => {
        if (!res.destroyed && !res.writableEnded && !res.writableNeedDrain && !controller.signal.aborted) {
          res.write(': keepalive\n\n');
          res.flush?.();
        }
      }, 15000);
      heartbeat.unref?.();
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
      // The operation can be aborted while the HTTP socket is still usable.
      res.end(`data: ${JSON.stringify(publicPayload || { error: 'Sorğunu tamamlamaq mümkün olmadı.', code: publicAskErrorCode(error) })}\n\n`);
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
