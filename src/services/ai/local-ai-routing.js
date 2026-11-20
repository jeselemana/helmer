import { classifyAskFastPath } from './ask-search-routing.js';
import { evaluateSearchRoute, hasGroundedAssistantHistory } from './search-router.js';
import { analyzeBuildTaskSignals, buildReasoningLevel } from './build-orchestrator.js';
import { BUILD_OPENAI_MODEL } from './build-config.js';
import { assertExecutionActive } from '../security/execution-control.js';

const diagnostics = Object.freeze({
  model: null, fallbackModel: null, configured: true, active: true, mode: 'local_rules',
});

export function createLocalAiRouter() {
  return {
    getSyncStatus: () => diagnostics,
    getDiagnostics: async () => diagnostics,
    async routeAsk({ prompt = '', messages = [], explicitWeb = false, hasStrategyContext = false,
      hasGroundedHistory = hasGroundedAssistantHistory(messages), hasMedia = false, signal } = {}) {
      assertExecutionActive(undefined, signal);
      const lastUserMsg = prompt || messages.findLast(message => message?.role === 'user')?.content || '';
      const fast = classifyAskFastPath({
        lastUserMsg, messages, explicitWeb, hasStrategyContext, groundedHistory: hasGroundedHistory, hasMedia,
      });
      if (fast) return fast;
      return {
        ...evaluateSearchRoute({ prompt: lastUserMsg, messages, hasStrategyContext, hasGroundedHistory }),
        routerSource: 'local_rules', decisionPath: 'heuristic_fallback', latencyMs: 0,
      };
    },
    async routeBuild({ prompt = '', hasExistingBrief = false, signal } = {}) {
      assertExecutionActive(undefined, signal);
      const signals = analyzeBuildTaskSignals(prompt);
      const thinkingLevel = buildReasoningLevel(prompt, signals);
      return {
        briefAction: hasExistingBrief ? 'refine_brief' : 'draft_brief',
        briefDepth: thinkingLevel === 'HIGH' ? 2 : thinkingLevel === 'LOW' ? 0 : 1,
        hasEnoughContext: true, needsMarketSearch: signals.mandatorySearch,
        targetModel: BUILD_OPENAI_MODEL, thinkingLevel, routerSource: 'local_rules', latencyMs: 0,
      };
    },
  };
}
