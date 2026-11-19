import { Worker } from 'node:worker_threads';
export function assertCachedFileReference(file, chat) {
  if (file?.fileId && !file.data && !file.textContent && !chat?.messages?.some(message => message.file?.fileId === file.fileId)) {
    throw Object.assign(new Error('Cached file is not referenced by this conversation'), { code: 'VALIDATION_ERROR', status: 400 });
  }
}
import { executionContext } from '../security/privacy-policy.js';
import { MIME_TYPE_MAP, TEXT_LIKE_EXTENSIONS } from "../../../public/file-utils.js";

const UNSUPPORTED_UPLOAD_EXTENSIONS = new Set(["doc", "xls", "svg"]);

function validationError(message, code = "VALIDATION_ERROR") {
  return Object.assign(new Error(message), { status: 400, code });
}

function extractFileExtension(fileName) {
  const name = String(fileName || "");
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx >= name.length - 1) return "";
  return name.slice(dotIdx + 1).toLowerCase();
}

function hasValidImageMagicBytes(buffer, extension) {
  if (extension === "png") {
    return buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
  }
  if (extension === "jpg" || extension === "jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === "webp") {
    return buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (extension === "gif") {
    const header = buffer.subarray(0, 6).toString("ascii");
    return header === "GIF87a" || header === "GIF89a";
  }
  if (extension === "heic" || extension === "heif") {
    if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") return false;
    const brand = buffer.subarray(8, 12).toString("ascii");
    return ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heif"].includes(brand);
  }
  return true;
}

export function validUploadMetadata(file) {
  const extension = extractFileExtension(file?.name);
  if (!extension || UNSUPPORTED_UPLOAD_EXTENSIONS.has(extension)) return false;
  const expected = MIME_TYPE_MAP[extension];
  const mime = String(file.mimeType || file.type || "");
  return Boolean(expected && (mime === expected || (TEXT_LIKE_EXTENSIONS.has(extension) && /^(?:text\/[a-z0-9.+-]+|application\/(?:json|xml|x-yaml))(?:;\s*charset=[a-z0-9._-]+)?$/i.test(mime))));
}

export async function prepareUploadedContext(file) {
  if (!validUploadMetadata(file)) throw validationError("Unsupported upload type");
  if (!file.data) return file;
  const data = file.data.replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw validationError("Invalid file encoding");
  const buffer = Buffer.from(data, "base64");
  if (buffer.length > 20 * 1024 * 1024) throw validationError("Upload size limit exceeded", "FILE_TOO_LARGE");
  const extension = extractFileExtension(file.name);
  if (extension === "pdf" && buffer.subarray(0, 5).toString() !== "%PDF-") throw validationError("Invalid PDF upload");
  if (["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"].includes(extension) && !hasValidImageMagicBytes(buffer, extension)) {
    throw validationError("Invalid image upload");
  }
  if (!["docx", "xlsx"].includes(extension)) return { ...file, data };
  const textContent = await extractOffice(buffer, extension, executionContext.getStore()?.signal);
  return { ...file, data, textContent };
}

let waiting = 0, queue = Promise.resolve();
function extractOffice(buffer, extension, signal) {
  if (waiting >= 4) return Promise.reject(Object.assign(new Error('Upload queue full'), { status: 429, code: 'EXECUTION_BUSY' }));
  waiting++;
  const deadline = Date.now() + 30000;
  const operation = queue.then(() => new Promise((resolve, reject) => {
    if (signal?.aborted || Date.now() >= deadline) return reject(new Error('Upload cancelled or timed out'));
    const worker = new Worker(new URL('./upload-worker.js', import.meta.url), {
      workerData: { extension, bytes: buffer },
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32,
        codeRangeSizeMb: 24,
        stackSizeMb: 4,
      },
    });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      void worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new Error('Upload cancelled'));
    const timer = setTimeout(() => finish(new Error('Upload processing timed out')), deadline - Date.now());
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', result => finish(result.error ? new Error(result.error) : null, result.textContent));
    worker.once('error', error => finish(error));
    worker.once('exit', () => finish(new Error('Upload worker stopped')));
  }));
  queue = operation.catch(() => {});
  return operation.finally(() => { waiting--; });
}
