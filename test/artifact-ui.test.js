import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { JSDOM } from "jsdom";
import { randomUUID } from "node:crypto";

const source = await fs.readFile(new URL("../public/artifacts.js", import.meta.url), "utf8");
const plugins = [
  { id: "word", name: "Word", icon: "document", description: "sənəd yarat", status: "available" },
  { id: "excel", name: "Excel", icon: "spreadsheet", description: "analiz yarat", status: "available" },
  { id: "drive", name: "Drive", icon: "document", description: "Drive files", status: "available" },
];
async function domHarness(t) {
  const dom = new JSDOM('<html lang="az"><body><form><div id="composer"><textarea id="askInput"></textarea></div></form></body></html>', { url: "http://localhost", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ plugins }) });
  dom.window.eval(source);
  let selection = [];
  const input = dom.window.document.querySelector("textarea"), body = dom.window.document.querySelector("#composer");
  dom.window.HelmerArtifacts.attachComposer({ input, body, getSelection: () => selection, setSelection: value => { selection = value; } });
  await new Promise(resolve => setImmediate(resolve));
  const type = value => { input.value = value; input.setSelectionRange(value.length, value.length); input.dispatchEvent(new dom.window.Event("input", { bubbles: true })); };
  const key = value => input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
  return { window: dom.window, document: dom.window.document, input, body, type, key, selected: () => Array.from(selection) };
}

test("@ selector filters, navigates with arrows and Enter, creates removable chips and preserves prompt", async t => {
  const h = await domHarness(t);
  h.type("@"); assert.equal(h.document.querySelector(".ask-plugin-selector").hidden, false);
  h.key("ArrowDown"); assert.equal(h.document.querySelector(".ask-plugin-option.is-active strong").textContent, "@Excel");
  h.key("Enter"); assert.deepEqual(h.selected(), ["excel"]); assert.equal(h.input.value, "");
  assert.equal(h.document.querySelector(".ask-plugin-token").textContent.includes("@Excel"), true);
  h.type("Forecast hazırla @wo"); assert.equal(h.document.querySelectorAll(".ask-plugin-option").length, 1);
  h.key("Tab"); assert.deepEqual(h.selected(), ["excel", "word"]); assert.equal(h.input.value, "Forecast hazırla ");
  h.document.querySelector(".ask-plugin-token-remove").click(); assert.deepEqual(h.selected(), ["word"]);
  h.type(""); h.key("Backspace"); assert.deepEqual(h.selected(), []);
  h.type("@"); h.key("Escape"); assert.equal(h.document.querySelector(".ask-plugin-selector").hidden, true);
  h.type("lead@example.com"); assert.equal(h.document.querySelector(".ask-plugin-selector").hidden, true);
});

test("registry-only additions appear automatically and mouse selection works", async t => {
  const h = await domHarness(t); h.type("@dri");
  h.document.querySelector(".ask-plugin-option").click(); assert.deepEqual(h.selected(), ["drive"]);
});

test("@ selector follows the composer disabled state through repeated streaming completions", async t => {
  const h = await domHarness(t);
  for (let turn = 0; turn < 20; turn++) {
    h.input.disabled = true;
    h.type("@");
    assert.equal(h.document.querySelector(".ask-plugin-selector").hidden, true);
    h.input.disabled = false;
    h.type("@excel");
    assert.equal(h.document.querySelector(".ask-plugin-selector").hidden, false);
    h.key("Enter");
    assert.deepEqual(h.selected(), ["excel"]);
    h.key("Backspace");
  }
});

test("artifact cards use safe DOM text and server-generated authenticated URLs", async t => {
  const h = await domHarness(t);
  const artifact = { id: randomUUID(), version: 1, filename: '<img src=x onerror="alert(1)">.docx', size: 4096, pluginId: "word", downloadUrl: "javascript:alert(1)" };
  let edited;
  const card = h.window.HelmerArtifacts.artifactCard(artifact, value => { edited = value; }); h.body.append(card);
  assert.equal(card.querySelector("img"), null);
  assert.equal(card.querySelector("strong").textContent, artifact.filename);
  assert.equal(card.querySelector("a").getAttribute("href"), `/api/artifacts/${artifact.id}/versions/1/download`);
  card.querySelectorAll("button")[1].click(); assert.equal(edited.id, artifact.id);
  assert.equal(h.window.HelmerArtifacts.artifactCard({ ...artifact, id: "../../etc/passwd" }), null);
});
