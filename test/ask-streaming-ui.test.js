import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const source = await fs.readFile(new URL('../public/script.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function harness(t) {
  const dom = new JSDOM('<main></main>', { url: 'https://helmer.local', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(`
    function element(tag, className = '', text) {
      const node = document.createElement(tag); node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function button(text, className, handler) {
      const node = element('button', className, text); node.addEventListener('click', handler); return node;
    }
    function getLanguage() { return 'en'; }
    function openGroundingSourcesModal(metadata) { window.openedSources = metadata; }
    ${section('function cleanMarkdownFormatting(', 'async function copyAskResponse(')}
    ${section('function extractGroundingWebChunks(', 'const activeResearchStreams =')}
    window.askTest = { renderAskRichText, patchAskRichTextElement, parseAskRichTextBlocks, renderAskSourceChips };
  `);
  return dom.window;
}

test('streamed Markdown matches a full safe render at every character and keeps completed nodes', t => {
  const w = harness(t), { renderAskRichText, patchAskRichTextElement } = w.askTest;
  const samples = [
    'Hello\n\n## Heading\n\nA final paragraph.',
    'One\n\n- First\n\n- Second\n  continuation\n\nLast.',
    'One\n\n1. First\n\n2. Second\n\nLast.',
    'Hello\n\n| Name | Value |\n| --- | --- |\n| A | **B<br>C**<br />D `<br>` <img src=x onerror=alert(1)> |\n\nEnd.',
    'A\n\n```js\nconst value = 1;\n```\n\nAfter.',
    'Normal\n## Heading\nText\n\n---\n\nFinal **bold** [link](https://example.com).',
    'Text\r\n\r\nNext paragraph with <img src=x onerror=alert(1)>.',
    '## Title\n\n\n\n- bullet\n\n```\ncode\n```',
  ];
  for (const value of samples) {
    const root = renderAskRichText('');
    for (let end = 1; end <= value.length; end++) {
      const text = value.slice(0, end);
      patchAskRichTextElement(root, text);
      assert.equal(root.innerHTML, renderAskRichText(text).innerHTML, `Mismatch at ${end}: ${JSON.stringify(text)}`);
    }
    assert.equal(root.querySelector('img, script'), null);
    patchAskRichTextElement(root, 'Replaced final text.');
    assert.equal(root.textContent, 'Replaced final text.');
  }
  const root = renderAskRichText('Stable paragraph.\n\nNew');
  const first = root.firstChild;
  patchAskRichTextElement(root, 'Stable paragraph.\n\nNew text');
  assert.equal(root.firstChild, first);
  assert.equal(root._askParseCache.blocks[0].sourceStart, 0);
});

test('Ask tables render only safe breaks and preserve literal tags in code', t => {
  const w = harness(t);
  const root = w.askTest.renderAskRichText('| Name | Value |\n| --- | --- |\n| A | B<br>C `<br>` <br onclick=alert(1)> |');
  const cell = root.querySelectorAll('td')[1];
  assert.equal(cell.querySelectorAll('br').length, 1);
  assert.equal(cell.querySelector('code').textContent, '<br>');
  assert.match(cell.textContent, /<br onclick=alert\(1\)>/);
});

test('source chips use titles, preserve destinations, collapse queries and reject unsafe URLs', t => {
  const w = harness(t);
  const metadata = {
    groundingChunks: [
      { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/one', title: 'Bolt driver centre — Baku' } },
      { web: { uri: 'https://bolt.eu/az-az/support/', title: 'Bolt support' } },
      { web: { uri: 'javascript:alert(1)', title: 'Bad' } },
      { web: { uri: 'https://', title: 'Malformed' } },
      { web: { uri: 'https://user:secret@example.com/source', title: 'Credentials' } },
      { web: { uri: 'https://example.com/' + 'x'.repeat(2000), title: 'Overlong' } },
      { web: { uri: 'https://example.com/', title: '<img src=x onerror=alert(1)>' } },
      { web: { uri: 'https://EXAMPLE.com/', title: 'Canonical duplicate' } },
    ],
    citations: [{ url: 123 }, { url: 'data:text/html,bad' }],
    webSearchQueries: ['Bolt office Baku', 'Bolt driver centre'],
    searchSuggestions: [{ query: 'Bolt office Baku', url: 'https://user:secret@google.com/search?q=Bolt' }],
  };
  const root = w.askTest.renderAskSourceChips(metadata);
  w.document.querySelector('main').appendChild(root);
  const chips = root.querySelectorAll('a.ask-grounding-chip');
  assert.equal(chips.length, 3);
  assert.equal(chips[0].querySelector('.ask-grounding-chip-title').textContent, 'Bolt driver centre — Baku');
  assert.equal(chips[0].textContent.includes('vertexaisearch'), false);
  assert.equal(chips[0].href, metadata.groundingChunks[0].web.uri);
  assert.equal(root.querySelector('img, script'), null);
  assert.equal(root.querySelector('.ask-grounding-count').textContent, '3');
  assert.equal(root.querySelector('details').open, false);
  assert.equal(root.querySelectorAll('.ask-search-suggestion-chip').length, 2);
  for (const link of root.querySelectorAll('a')) {
    assert.match(link.href, /^https?:\/\//);
    assert.equal(new URL(link.href).username, '');
    assert.equal(new URL(link.href).password, '');
    assert.equal(link.rel, 'noopener noreferrer');
  }
  root.querySelector('.ask-grounding-all-btn').click();
  assert.equal(w.openedSources, metadata);
});

test('first words paint immediately and same-packet completion preserves a bounded streaming animation', async () => {
  let nextId = 0, now = 0;
  const frames = new Map(), timers = new Map();
  const context = vm.createContext({ window: {}, document: { hidden: false }, performance: { now: () => now },
    requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { timers.set(++nextId, callback); return nextId; },
    clearTimeout: id => timers.delete(id),
  });
  const advanceFrame = (elapsed = 16) => {
    now += elapsed;
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback());
  };
  const Typewriter = vm.runInContext(section('class LiveTypewriter {', 'function extractGroundingWebChunks(') + '; LiveTypewriter', context);
  const updates = []; let completions = 0;
  const writer = new Typewriter((text, done) => updates.push({ text, done }), () => completions++);
  const firstChunk = 'A long first chunk. '.repeat(500);
  writer.append(firstChunk);
  assert.ok(updates[0].text.length > 0, 'First words must appear before the first animation frame');
  assert.ok(updates[0].text.length < firstChunk.length, 'A large provider burst must animate instead of appearing all at once');
  writer.append(' Next'); writer.append(' part'); writer.finish(); writer.finish();
  assert.equal(frames.size, 1);
  assert.equal(completions, 0, 'A done event in the same packet must not cancel the animation');
  const initialLength = updates.at(-1).text.length;
  advanceFrame();
  assert.ok(updates.at(-1).text.length > initialLength);
  assert.ok(updates.at(-1).text.length < firstChunk.length);
  for (let i = 0; frames.size && i < 10; i++) advanceFrame();
  await writer.waitForCompletion();
  assert.ok(now <= 128, 'Large bursts must catch up in at most 120ms plus one frame');
  assert.equal(updates.at(-1).text, firstChunk + ' Next part');
  assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(completions, 1);
  writer.finish(); writer.flush(); assert.equal(completions, 1);

  context.document.hidden = true;
  const hidden = new Typewriter(text => updates.push({ text }), () => {});
  hidden.append('Hidden tab'); assert.equal(updates.at(-1).text, 'Hidden tab'); hidden.finish();
  await hidden.waitForCompletion();
  context.document.hidden = false;
  const stopped = new Typewriter(() => {}, () => {});
  stopped.append('One long chunk to animate'); stopped.append(' two'); stopped.flush();
  await stopped.waitForCompletion(); assert.equal(frames.size, 0);
  const stalled = new Typewriter(() => {}, () => {});
  stalled.append('A browser may throttle frame callbacks'); stalled.finish();
  [...timers.values()][0](); await stalled.waitForCompletion();
  assert.equal(stalled.currentText, stalled.targetText); assert.equal(frames.size, 0); assert.equal(timers.size, 0);
  context.window.matchMedia = () => ({ matches: true });
  const reduced = new Typewriter(() => {}, () => {});
  reduced.append('Reduced motion must not animate'); reduced.finish(); await reduced.waitForCompletion();
  assert.equal(reduced.currentText, reduced.targetText); assert.equal(frames.size, 0);
});

test('compact Ask omits inline source chips and cancels generation when closed', async t => {
  const w = harness(t);
  w.AbortController = AbortController;
  w.TextDecoder = TextDecoder;
  const data = { done: true, reply: 'Safe **answer**', groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/source', title: 'Official source' } }] } };
  w.fetch = async () => {
    let sent = false;
    return { ok: true, body: { getReader: () => ({
      read: async () => sent ? { done: true } : (sent = true, { value: new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`), done: false }),
      cancel: async () => {}, releaseLock() {},
    }) } };
  };
  w.eval(`
    ${section('function escapeHtml(', 'function isComplexAskQuery(')}
    const state = { askThinkingEnabled: false };
    function isModelImprovementActive() { return false; }
    function sanitizeAskMessageForApi(message) { return message; }
    function rememberSavedAskChat() { window.saved = true; }
    ${section('async function consumeAskEventStream(', 'async function submitAskMessage(')}
    ${section('function showLoadingAskModal(', 'async function startAssessment(')}
    showLoadingAskModal('Question');
  `);
  for (let i = 0; i < 20 && !w.saved; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(w.saved, true);
  assert.equal(w.document.querySelectorAll('.loading-ask-modal .ask-grounding-chip').length, 0);
  let signal;
  w.fetch = (_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Stopped'), { name: 'AbortError' })), { once: true });
  });
  w.eval("showLoadingAskModal('Pending question')");
  assert.ok(signal); assert.equal(signal.aborted, false);
  w.document.querySelector('.loading-ask-modal .analysis-history-close').click();
  assert.equal(signal.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(w.document.querySelector('.loading-ask-modal-overlay'), null);
});
