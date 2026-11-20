import { createBuildOrchestrator } from '../../src/services/ai/build-orchestrator.js';
import { assessBrief, generateStrategy, refineStrategy } from '../../src/services/ai/strategy-service.js';
import { createStrategyRouter } from '../../src/http/strategy-router.js';
import { beforeEach } from 'node:test';
import { getBuildVertexClient } from "./legacy-google-inference.js";
import { getGeminiClient } from "../../src/services/ai/research-google-client.js";

// Storage/concurrency regressions provide a final-result mock on the legacy
// Gemini client. Bridge it to the isolated Build client and supply its scout.
export function installBuildRoutingFixture() {
  beforeEach(t => {
    const previousProject = process.env.GOOGLE_CLOUD_PROJECT;
    const previousGemini = process.env.GEMINI_API_KEY;
    process.env.GOOGLE_CLOUD_PROJECT ||= 'test-helmer-project';
    process.env.GEMINI_API_KEY ||= 'test-build-workhorse-key';
    const legacy = getGeminiClient(), build = getBuildVertexClient();
    t.mock.method(build.models, 'generateContent', async params => {
      if (params.config.responseSchema.properties.needs_search) return {
        text: JSON.stringify({ needs_search: false, target_model: 'gemini-4-hydrogen', thinking_level: 'low', facts: [], focus_area: 'Narrow edit' }),
        candidates: [{ finishReason: 'STOP' }],
      };
      return legacy.models.generateContent(params, { signal: params.config.abortSignal });
    });
    t.mock.method(build.models, 'generateContentStream', async params => (async function* () {
      yield await legacy.models.generateContent(params, { signal: params.config.abortSignal });
    })());
    t.after(() => {
      if (previousProject === undefined) delete process.env.GOOGLE_CLOUD_PROJECT; else process.env.GOOGLE_CLOUD_PROJECT = previousProject;
      if (previousGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousGemini;
    });
  });
}

// These historical safety and persistence tests use the legacy provider contract
// as a fixture. The production router defaults to the Responses orchestrator.
export function createFixtureStrategyRouter(repository, learning, options = {}) {
  const orchestrate = createBuildOrchestrator({ gemini: getBuildVertexClient });
  return createStrategyRouter(repository, learning, {
    ...options,
    generationServices: {
      assessBrief: args => assessBrief({ ...args, orchestrate }),
      generateStrategy: args => generateStrategy({ ...args, orchestrate }),
      refineStrategy: (payload, ownerId, signal, profile, onChunk, onUsage) =>
        refineStrategy(payload, ownerId, signal, profile, onChunk, onUsage, orchestrate),
    },
  });
}
