export const MIME_TYPE_MAP = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
  js: "text/javascript",
  ts: "text/typescript",
  py: "text/x-python",
  html: "text/html",
  css: "text/css",
  sql: "text/x-sql",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

export const TEXT_LIKE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "js", "ts", "py", "html", "css", "sql", "xml", "yaml", "yml"
]);

export function detectMimeType(fileName = "", declaredType = "") {
  if (declaredType && declaredType !== "application/octet-stream") {
    return declaredType;
  }
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return MIME_TYPE_MAP[ext] || declaredType || "application/octet-stream";
}

export function isTextLikeFile(file) {
  if (!file) return false;
  const ext = (file.name || "").split(".").pop()?.toLowerCase() || "";
  if (TEXT_LIKE_EXTENSIONS.has(ext)) return true;
  if (file.type && file.type.startsWith("text/")) return true;
  return false;
}

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  let binary = "";
  const chunkSize = 0x4000; // 16KB safe chunks
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

const UNSUPPORTED_UPLOAD_EXTENSIONS = new Set(["doc", "xls", "svg"]);

function readAbortableBuffer(file, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(signal.reason);
    reader.onloadend = () => signal.removeEventListener("abort", abort);
    reader.readAsArrayBuffer(file);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function readUploadedFileAsData(file, { isEn = false, signal } = {}) {
  if (!file) return null;
  signal?.throwIfAborted();
  const ext = String(file.name || "").split(".").pop()?.toLowerCase() || "";
  if (UNSUPPORTED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error(
      isEn
        ? `Unsupported format (.${ext}). Please upload PDF, PNG/JPG/WEBP/GIF/HEIC, DOCX, XLSX, or text files.`
        : `Bu fayl formatı (.${ext}) dəstəklənmir. Zəhmət olmasa PDF, şəkil (PNG/JPG/WEBP), DOCX, XLSX və ya mətn faylı yükləyin.`
    );
  }
  const maxBytes = 20 * 1024 * 1024; // 20MB
  if (file.size > maxBytes) {
    throw new Error(isEn ? "File size must not exceed 20MB." : "Faylın həcmi 20MB-dan çox ola bilməz.");
  }

  const mimeType = detectMimeType(file.name, file.type);
  const isTextLike = isTextLikeFile(file);
  if (signal && typeof FileReader !== "undefined" && file instanceof Blob) {
    const buffer = await readAbortableBuffer(file, signal);
    signal.throwIfAborted();
    return {
      name: file.name,
      size: file.size,
      type: mimeType,
      mimeType,
      data: arrayBufferToBase64(buffer),
      textContent: isTextLike ? new TextDecoder().decode(buffer) : undefined,
    };
  }

  let textContent;
  if (isTextLike) {
    if (typeof file.text === "function") {
      try {
        textContent = await file.text();
      } catch (err) {
        console.warn("file.text() failed, falling back to FileReader:", err);
      }
    }
    if (typeof textContent !== "string" && typeof FileReader !== "undefined") {
      textContent = await new Promise((resolve) => {
        const textReader = new FileReader();
        textReader.onload = () => resolve(String(textReader.result || ""));
        textReader.onerror = () => resolve("");
        textReader.readAsText(file);
      });
    }
  }

  signal?.throwIfAborted();
  let base64Data = "";
  if (typeof file.arrayBuffer === "function") {
    try {
      const buffer = await file.arrayBuffer();
      base64Data = arrayBufferToBase64(buffer);
    } catch (err) {
      console.warn("file.arrayBuffer() failed, falling back to FileReader:", err);
    }
  }

  if (!base64Data && file.size > 0 && typeof FileReader !== "undefined") {
    base64Data = await new Promise((resolve, reject) => {
      const dataReader = new FileReader();
      dataReader.onload = () => {
        const res = String(dataReader.result || "");
        const raw = res.replace(/^data:[^;]+;base64,/, "");
        resolve(raw);
      };
      dataReader.onerror = () => {
        const details = dataReader.error?.message ? ` (${dataReader.error.message})` : "";
        reject(new Error((isEn ? "Failed to read file." : "Fayl oxuna bilmədi.") + details));
      };
      dataReader.readAsDataURL(file);
    });
  }

  signal?.throwIfAborted();
  return {
    name: file.name,
    size: file.size,
    type: mimeType,
    mimeType,
    data: base64Data,
    textContent,
  };
}
