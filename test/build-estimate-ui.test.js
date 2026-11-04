import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { preparationEstimateForRoute, preparationEstimateForFaster, BuildEstimateRequestSchema, buildRoutingInput } from '../src/services/ai/build-estimate.js';
const source = await readFile(new URL('../public/script.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('let buildEstimateTimer ='), source.indexOf('function renderIntake('));
const selectorSource = source.slice(source.indexOf('function createBuildModelSelector('), source.indexOf('function openMobileModelSheet('));
function harness(t) {
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only', url: 'https://helmer.local' });
  t.after(() => dom.window.close());
  dom.window.eval(`
    const state = {brief:'Prepare a secure technical strategy',mode:'build',status:'draft',currentUser:{id:'a'}};
    function element(tag, cls, text) { const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n; }
    function getLanguage() { return 'az'; }
    window.timers=[]; window.setTimeout=fn=>{window.timers.push(fn);return window.timers.length;};window.clearTimeout=()=>{};
    window.requests=[];
    async function api(path,opts) { return new Promise(resolve=>window.requests.push({path,opts,resolve})); }
    ${helpers}
    ${selectorSource}
    window.h={state,createBuildEstimateCard,refreshBuildEstimateCards,updateBuildEstimate,scheduleBuildEstimate,cancelBuildEstimate,createBuildModelSelector};
  `);
  return dom.window;
}
test('range uses Flash thinking classification and adds exactly two or three conservative upper minutes', () => {
  assert.deepEqual(preparationEstimateForRoute({argon_thinking_level:'Low'}), {minMinutes:1,maxMinutes:4,bufferMinutes:2});
  assert.deepEqual(preparationEstimateForRoute({argon_thinking_level:'Medium'}), {minMinutes:2,maxMinutes:7,bufferMinutes:3});
  assert.deepEqual(preparationEstimateForRoute({argon_thinking_level:'High',needs_search:true}), {minMinutes:5,maxMinutes:13,bufferMinutes:3});
  assert.equal(BuildEstimateRequestSchema.safeParse({brief:'Valid brief',model:'other'}).success,false);
  assert.equal(BuildEstimateRequestSchema.safeParse({brief:'Valid brief',buildMode:'faster',fasterThinkingLevel:'high'}).success,true);
  assert.deepEqual(preparationEstimateForFaster({fasterThinkingLevel:'medium',needs_search:false}), {minMinutes:1,maxMinutes:3,bufferMinutes:1});
  assert.deepEqual(preparationEstimateForFaster({fasterThinkingLevel:'high',needs_search:true}), {minMinutes:3,maxMinutes:6,bufferMinutes:2});
  assert.equal(buildRoutingInput({brief:' A prompt '}),buildRoutingInput({brief:'A prompt',answers:[],assumptions:[]}));
});
test('card renders safe validated numeric data and never renders supplied markup', t => {
  const w=harness(t),h=w.h,card=h.createBuildEstimateCard();w.document.body.append(card);
  h.updateBuildEstimate({minMinutes:4,maxMinutes:11,bufferMinutes:3});
  assert.match(card.textContent,/Təxmini hazırlanma vaxtı:4–11 dəqiqə/);
  h.updateBuildEstimate({minMinutes:'<img src=x onerror=alert(1)>',maxMinutes:11,bufferMinutes:3});
  assert.equal(card.querySelector('img'),null);assert.match(card.textContent,/4–11/);
  h.state.brief='';h.refreshBuildEstimateCards();assert.equal(card.hidden,true);
});
test('typing debounce cancels stale requests and editing prevents obsolete estimates overwriting the card', async t => {
  const w=harness(t),h=w.h;w.document.body.append(h.createBuildEstimateCard());
  h.scheduleBuildEstimate();w.timers.at(-1)();assert.equal(w.requests.length,1);
  const old=w.requests[0];h.state.brief='An entirely different application';h.scheduleBuildEstimate();
  assert.equal(old.opts.signal.aborted,true);
  old.resolve({preparationEstimate:{minMinutes:4,maxMinutes:11,bufferMinutes:3}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.state.buildPreparationEstimate,undefined);
  w.timers.at(-1)();w.requests[1].resolve({preparationEstimate:{minMinutes:1,maxMinutes:4,bufferMinutes:2}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.state.buildPreparationEstimate.maxMinutes,4);
  h.scheduleBuildEstimate();assert.equal(w.requests.length,2);
});
test('createBuildModelSelector enables Faster with Medium default and High thinking selector, and passes Faster params to estimate', t => {
  const w=harness(t),h=w.h;
  h.state.buildModel = 'auto';
  h.state.buildFasterThinkingLevel = 'medium';
  const menu = h.createBuildModelSelector(false);
  w.document.body.append(menu);
  const options = menu.querySelectorAll('.ask-model-option');
  assert.equal(options.length, 3);
  const [autoBtn, fasterMedBtn, fasterHighBtn] = options;
  assert.equal(fasterMedBtn.disabled, false);
  assert.equal(fasterHighBtn.disabled, false);
  const thinkingCard = menu.querySelector('.build-faster-thinking-card');
  assert.equal(thinkingCard.hidden, true);

  // Click Faster Medium -> activates Faster Medium
  fasterMedBtn.click();
  assert.equal(h.state.buildModel, 'faster');
  assert.equal(h.state.buildFasterThinkingLevel, 'medium');
  assert.equal(thinkingCard.hidden, false);
  assert.equal(menu.querySelector('.ask-model-name').textContent, 'Faster · Med');

  // Click Faster High -> switches to Faster High
  fasterHighBtn.click();
  assert.equal(h.state.buildModel, 'faster');
  assert.equal(h.state.buildFasterThinkingLevel, 'high');
  assert.equal(menu.querySelector('.ask-model-name').textContent, 'Faster · High');

  // Verify scheduleBuildEstimate sends buildMode: 'faster' and fasterThinkingLevel: 'high'
  w.timers.at(-1)();
  const lastBody = JSON.parse(w.requests.at(-1).opts.body);
  assert.equal(lastBody.buildMode, 'faster');
  assert.equal(lastBody.fasterThinkingLevel, 'high');
});
