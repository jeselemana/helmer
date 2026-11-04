import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = await readFile(new URL('../public/script.js', import.meta.url), 'utf8');
const extraction = source.slice(source.indexOf('function extractGroundingSearchSuggestions('), source.indexOf('function renderAskSourceChips('));
const panel = source.slice(source.indexOf('function buildOrchestrationMetaPanel('), source.indexOf('\n}\n', source.indexOf('function buildOrchestrationMetaPanel(')) + 3);
function harness(t) {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only', url: 'https://helmer.local' });
  t.after(() => dom.window.close());
  dom.window.eval(`function element(tag, cls, text) { const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n; }\n${extraction}\n${panel}\nwindow.renderPanel = buildOrchestrationMetaPanel;`);
  return dom.window;
}
test('Build renders suggestions even when source filtering removes every source', t => {
  const w = harness(t);
  const panel = w.renderPanel({ orchestration: { sources: [], searchQueries: ['Market & trends'] } }, true);
  assert.ok(panel);
  const link = panel.querySelector('.ask-search-suggestion-chip');
  assert.equal(link.textContent, 'Market & trends');
  assert.equal(link.href, 'https://www.google.com/search?q=Market%20%26%20trends');
  assert.equal(link.rel, 'noopener noreferrer');
  assert.equal(w.renderPanel({ orchestration: { sources: [] } }, true), null);
});
test('Build never injects provider suggestion HTML, handlers, scripts or hostile link schemes into DOM', t => {
  const w = harness(t);
  const panel = w.renderPanel({ orchestration: { sources: [], searchEntryPoint: { renderedContent: '<script>alert(1)</script><img src="https://evil.example/pixel"><a href="javascript:alert(1)" onclick="alert(1)">Market</a>' } } }, true);
  assert.ok(panel);
  assert.equal(panel.querySelector('script,img,iframe,[onclick]'), null);
  const link = panel.querySelector('.ask-search-suggestion-chip');
  assert.equal(link.href, 'https://www.google.com/search?q=Market');
  assert.doesNotMatch(panel.outerHTML, /javascript:|evil.example|alert\(1\)/);
});
