// Ask owns its latency/output limits. Build, Research and UP retain their settings.
export function createAskConfig(env = process.env) {
  const bounded = (name, fallback, min, max) => {
    const value = Number(env[name]);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
  };
  return Object.freeze({
    maxOutputTokens: bounded('ASK_MAX_OUTPUT_TOKENS', 8192, 256, 16384),
    requestTimeoutMs: bounded('ASK_REQUEST_TIMEOUT_MS', 165000, 1000, 240000),
    firstEventTimeoutMs: bounded('ASK_FIRST_EVENT_TIMEOUT_MS', 60000, 1000, 180000),
    idleTimeoutMs: bounded('ASK_STREAM_IDLE_TIMEOUT_MS', 30000, 1000, 180000),
    searchTimeoutMs: bounded('ASK_SEARCH_TIMEOUT_MS', 18000, 1000, 180000),
    maxHistoryMessages: 30,
    maxHistoryChars: 120000,
    maxBufferedBytes: 1024 * 1024,
  });
}
