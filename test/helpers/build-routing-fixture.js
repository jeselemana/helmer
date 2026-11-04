import { beforeEach } from 'node:test';
import { getGeminiClient, getBuildVertexClient } from '../../src/services/ai/client.js';

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
        text: JSON.stringify({ needs_search: false, argon_thinking_level: 'Low', facts: [], focus_area: 'Narrow edit' }),
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
