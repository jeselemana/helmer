import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMimeType,
  isTextLikeFile,
  arrayBufferToBase64,
  readUploadedFileAsData,
} from "../public/file-utils.js";
import { prepareUploadedContext } from "../src/services/artifacts/upload-context.js";

test("detectMimeType infers MIME type from extension when type is missing or generic", () => {
  assert.equal(detectMimeType("document.pdf", ""), "application/pdf");
  assert.equal(detectMimeType("photo.png", "application/octet-stream"), "image/png");
  assert.equal(detectMimeType("data.csv", ""), "text/csv");
  assert.equal(detectMimeType("notes.md", ""), "text/markdown");
  assert.equal(detectMimeType("config.json", ""), "application/json");
  assert.equal(detectMimeType("sheet.xlsx", ""), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(detectMimeType("explicit.png", "image/png"), "image/png");
  assert.equal(detectMimeType("unknown.xyz", ""), "application/octet-stream");
});

test("isTextLikeFile correctly classifies text vs binary files", () => {
  assert.equal(isTextLikeFile({ name: "notes.txt" }), true);
  assert.equal(isTextLikeFile({ name: "readme.md" }), true);
  assert.equal(isTextLikeFile({ name: "sales.csv" }), true);
  assert.equal(isTextLikeFile({ name: "script.py" }), true);
  assert.equal(isTextLikeFile({ name: "custom.log", type: "text/plain" }), true);
  assert.equal(isTextLikeFile({ name: "image.png", type: "image/png" }), false);
  assert.equal(isTextLikeFile({ name: "doc.pdf", type: "application/pdf" }), false);
});

test("arrayBufferToBase64 encodes empty, small, and chunked buffers accurately", () => {
  assert.equal(arrayBufferToBase64(new ArrayBuffer(0)), "");

  const text = "Hello from Helmer file upload test!";
  const buffer = new TextEncoder().encode(text).buffer;
  const expectedBase64 = Buffer.from(text).toString("base64");
  assert.equal(arrayBufferToBase64(buffer), expectedBase64);

  // Large buffer (100KB) across chunks
  const largeData = new Uint8Array(100 * 1024);
  for (let i = 0; i < largeData.length; i++) largeData[i] = i % 256;
  const largeExpected = Buffer.from(largeData).toString("base64");
  assert.equal(arrayBufferToBase64(largeData.buffer), largeExpected);
});

test("readUploadedFileAsData reads text file and extracts textContent and base64", async () => {
  const content = "brand,budget,goal\nHelmer,5000,scale";
  const file = new File([content], "marketing.csv", { type: "text/csv" });

  const result = await readUploadedFileAsData(file, { isEn: true });
  assert.ok(result);
  assert.equal(result.name, "marketing.csv");
  assert.equal(result.size, file.size);
  assert.equal(result.mimeType, "text/csv");
  assert.equal(result.textContent, content);
  assert.equal(result.data, Buffer.from(content).toString("base64"));
});

test("readUploadedFileAsData reads binary file without textContent and infers MIME type", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  const file = new File([bytes], "strategy-deck.pdf", { type: "" });

  const result = await readUploadedFileAsData(file, { isEn: true });
  assert.ok(result);
  assert.equal(result.name, "strategy-deck.pdf");
  assert.equal(result.mimeType, "application/pdf");
  assert.equal(result.textContent, undefined);
  assert.equal(result.data, Buffer.from(bytes).toString("base64"));
});

test("readUploadedFileAsData throws when file exceeds 20MB", async () => {
  const oversizedFile = {
    name: "huge.mov",
    size: 25 * 1024 * 1024,
    type: "video/quicktime",
  };

  await assert.rejects(
    async () => readUploadedFileAsData(oversizedFile, { isEn: true }),
    { message: "File size must not exceed 20MB." }
  );

  await assert.rejects(
    async () => readUploadedFileAsData(oversizedFile, { isEn: false }),
    { message: "Faylın həcmi 20MB-dan çox ola bilməz." }
  );
});

test("legacy Office (.doc/.xls) and SVG uploads are cleanly rejected on client and server", async () => {
  for (const [name, mime] of [
    ["legacy.doc", "application/msword"],
    ["legacy.xls", "application/vnd.ms-excel"],
    ["vector.svg", "image/svg+xml"],
  ]) {
    const file = new File(["dummy"], name, { type: mime });
    await assert.rejects(
      () => readUploadedFileAsData(file, { isEn: true }),
      /Unsupported format/
    );
    await assert.rejects(
      () => prepareUploadedContext({ name, mimeType: mime, data: Buffer.from("dummy").toString("base64") }),
      (err) => err?.status === 400 && err?.code === "VALIDATION_ERROR"
    );
  }
});
