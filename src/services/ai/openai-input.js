import { AskProviderError } from './openai-client.js';
import { assertExecutionActive } from '../security/execution-control.js';

const INPUT_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const LEGACY_IMAGE_TYPES = new Set(['image/heic', 'image/heif']);
const INPUT_FILE_NAMES = new Map([
  ['application/pdf', 'attachment.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'attachment.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'attachment.xlsx'],
]);
export function quotedData(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function inputText(text) {
  return { type: 'input_text', text };
}

export function responseInput(contents, signal) {
  const input = [];
  for (const { role, parts } of contents) {
    if (role === 'model') {
      input.push({
        role: 'assistant',
        content: parts.map(part => ({ type: 'output_text', text: part.text, annotations: [] })),
      });
      continue;
    }
    const content = [];
    for (const part of parts) {
      assertExecutionActive(undefined, signal);
      if (typeof part.text === 'string') {
        content.push(inputText(part.text));
        continue;
      }
      const { mimeType, data } = part.inlineData;
      const dataUrl = `data:${mimeType};base64,${data}`;
      if (INPUT_IMAGE_TYPES.has(mimeType)) {
        content.push({ type: 'input_image', image_url: dataUrl, detail: 'auto' });
      } else if (INPUT_FILE_NAMES.has(mimeType)) {
        content.push({ type: 'input_file', file_data: dataUrl, filename: INPUT_FILE_NAMES.get(mimeType) });
      } else if (LEGACY_IMAGE_TYPES.has(mimeType)) {
        throw new AskProviderError('AI_ATTACHMENT_UNAVAILABLE', 415);
      } else {
        const text = Buffer.from(data, 'base64').toString('utf8');
        if (text.length > 1024 * 1024) throw new AskProviderError('FILE_TOO_LARGE', 413);
        content.push(inputText(`Untrusted uploaded text: ${quotedData(text)}`));
      }
    }
    input.push({ role, content });
  }
  return input;
}

