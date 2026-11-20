export function deepResearchEnabled(env = process.env) {
  return env.DEEP_RESEARCH_ENABLED === 'true';
}

export function researchUnavailable() {
  return Object.assign(new Error('Temporarily unavailable'), { code: 'DEEP_RESEARCH_UNAVAILABLE', status: 503 });
}
