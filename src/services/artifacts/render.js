import { Worker } from "node:worker_threads";
const MAX_RENDER_TIMEOUT_MS = 30000;
const MAX_RENDER_SPEC_BYTES = 1500000;
const RENDER_RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 192,
  maxYoungGenerationSizeMb: 32,
  codeRangeSizeMb: 24,
  stackSizeMb: 4,
};

function renderWorker(kind, spec, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Artifact execution canceled"));
    const worker = new Worker(new URL("./render-worker.js", import.meta.url), { workerData: { kind, spec }, resourceLimits: RENDER_RESOURCE_LIMITS });
    let settled = false;
    const finish = (error, buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.terminate();
      if (error) reject(error); else resolve(Buffer.from(buffer));
    };
    const abort = () => finish(new Error("Artifact execution canceled"));
    const timer = setTimeout(() => finish(new Error("Artifact renderer timed out")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", message => finish(message.error ? new Error(message.error) : null, message.buffer));
    worker.once("error", error => finish(error));
    worker.once("exit", () => finish(new Error("Artifact renderer stopped")));
  });
}

let queue = Promise.resolve(), waiting = 0;
export async function renderArtifact(kind, spec, { signal, timeoutMs = MAX_RENDER_TIMEOUT_MS } = {}) {
  signal?.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(spec)) > MAX_RENDER_SPEC_BYTES) throw new Error("Artifact specification size limit exceeded");
  const timeout = Math.min(timeoutMs, MAX_RENDER_TIMEOUT_MS);
  if (waiting >= 4) return Promise.reject(Object.assign(new Error('Artifact render queue full'), { status: 429, code: 'EXECUTION_BUSY' }));
  const started = Date.now(); waiting++;
  const operation = queue.then(() => {
    signal?.throwIfAborted();
    const remaining = timeout - (Date.now() - started);
    if (remaining <= 0) throw new Error('Artifact renderer timed out');
    return renderWorker(kind, spec, { signal, timeoutMs: remaining });
  });
  queue = operation.catch(() => {});
  return operation.finally(() => { waiting--; });
}
