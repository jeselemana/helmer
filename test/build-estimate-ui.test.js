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
test('range uses Decision 1 Hydrogen/Carbon routing and adds calibrated conservative buffer minutes', () => {
  assert.deepEqual(preparationEstimateForRoute({target_model:'gemini-4-hydrogen',thinking_level:'Low'}), {minMinutes:1,maxMinutes:3,bufferMinutes:1});
  assert.deepEqual(preparationEstimateForRoute({target_model:'gemini-4-hydrogen',thinking_level:'Medium'}), {minMinutes:2,maxMinutes:5,bufferMinutes:2});
  assert.deepEqual(preparationEstimateForRoute({target_model:'gemini-4-hydrogen',thinking_level:'High'}), {minMinutes:3,maxMinutes:7,bufferMinutes:2});
  assert.deepEqual(preparationEstimateForRoute({target_model:'gemini-4-hydrogen',thinking_level:'XHigh'}), {minMinutes:4,maxMinutes:10,bufferMinutes:3});
  assert.deepEqual(preparationEstimateForRoute({target_model:'gemini-4-carbon',thinking_level:'Low'}), {minMinutes:3,maxMinutes:7,bufferMinutes:2});
  assert.deepEqual(preparationEstimateForRoute({target_model:'gemini-4-carbon',thinking_level:'Medium'}), {minMinutes:4,maxMinutes:11,bufferMinutes:3});
  assert.deepEqual(preparationEstimateForRoute({target_model:'gemini-4-carbon',thinking_level:'High',needs_search:true}), {minMinutes:7,maxMinutes:16,bufferMinutes:3});
  assert.equal(BuildEstimateRequestSchema.safeParse({brief:'Valid brief',model:'other'}).success,false);
  assert.equal(BuildEstimateRequestSchema.safeParse({brief:'Valid brief',buildMode:'faster',fasterThinkingLevel:'high'}).success,true);
  assert.deepEqual(preparationEstimateForFaster({fasterThinkingLevel:'medium',needs_search:false}), {minMinutes:1,maxMinutes:3,bufferMinutes:1});
  assert.deepEqual(preparationEstimateForFaster({fasterThinkingLevel:'high',needs_search:true}), {minMinutes:3,maxMinutes:7,bufferMinutes:2});
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

test('Build UI Carbon escalation banner renders via textContent only in Auto generating mode without leaking model names', () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="stage"></div></body></html>');
  const { document } = dom.window;
  const escalationSource = source.slice(
    source.indexOf('const BUILD_CARBON_ESCALATION_MESSAGE ='),
    source.indexOf('function renderLoading('),
  );
  const state = { status: 'idle', buildModel: 'auto', buildCarbonEscalated: false };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const fn = new Function(
    'document',
    'state',
    'element',
    `${escalationSource}\nreturn { BUILD_CARBON_ESCALATION_MESSAGE, syncBuildEscalationBanner, createBuildEscalationBanner };`,
  );
  const { BUILD_CARBON_ESCALATION_MESSAGE, syncBuildEscalationBanner, createBuildEscalationBanner } = fn(document, state, element);

  assert.equal(
    BUILD_CARBON_ESCALATION_MESSAGE,
    'Briefin keyfiyyət gözləntilərinizə uyğun olmasını təmin etmək məqsədilə o, flaqman modelə ötürüldü. Gözləmə vaxtı arta bilər.',
  );
  const stage = document.getElementById('stage');
  const banner = createBuildEscalationBanner();
  stage.appendChild(banner);
  assert.equal(banner.hidden, true);
  assert.equal(banner.querySelector('.intelligence-escalation-text').textContent, '');

  // Auto generating + escalated -> visible with safe textContent
  state.status = 'generating';
  state.buildModel = 'auto';
  state.buildCarbonEscalated = true;
  syncBuildEscalationBanner();
  assert.equal(banner.hidden, false);
  assert.equal(banner.querySelector('.intelligence-escalation-text').textContent, BUILD_CARBON_ESCALATION_MESSAGE);
  assert.doesNotMatch(banner.textContent, /carbon|hydrogen|decision|gemini/i);
  assert.equal(banner.querySelectorAll('script, img, a').length, 0);

  // Faster mode never shows Carbon escalation banner
  state.buildModel = 'faster';
  syncBuildEscalationBanner();
  assert.equal(banner.hidden, true);
  assert.equal(banner.querySelector('.intelligence-escalation-text').textContent, '');

  // Non-generating states hide & clear banner
  state.buildModel = 'auto';
  state.status = 'complete';
  syncBuildEscalationBanner();
  assert.equal(banner.hidden, true);
});
