// Build-only contract; other modes retain their existing provider configuration.
const primaryLocation = (process.env.BUILD_VERTEX_LOCATION || process.env.GOOGLE_CLOUD_BUILD_LOCATION || "us").trim() || "us";
const fallbackLocations = Object.freeze(["global", "us"].filter((loc) => loc !== primaryLocation));
const parsedScoutTimeoutMs = Number.parseInt(process.env.BUILD_SCOUT_TIMEOUT_MS || "35000", 10);

export const buildConfig = Object.freeze({
  routerModel: "gemini-3.8-flash",
  strategistModel: "gemini-4-argon",
  fasterModel: "gemini-3.8-flash",
  buildModes: Object.freeze(["auto", "faster"]),
  fasterThinkingLevels: Object.freeze(["medium", "high"]),
  location: primaryLocation,
  fallbackLocations,
  maxInputChars: 512000,
  maxOutputChars: 256000,
  routeCacheTtlMs: 300000,
  scoutCheckpointTtlMs: 300000,
  maxCachedRoutes: 512,
  estimateTimeoutMs: 30000,
  assessmentTimeoutMs: 60000,
  scoutTimeoutMs: Number.isFinite(parsedScoutTimeoutMs) && parsedScoutTimeoutMs >= 5000 ? parsedScoutTimeoutMs : 35000,
  finalTimeoutMs: Object.freeze({
    LOW: 180000,
    MEDIUM: 240000,
    HIGH: 360000,
  }),
  clientTimeoutMs: 360000,
  maxScoutAttempts: 2,
  maxAssessmentAttempts: 2,
  maxFinalAttempts: 3,
  retryBaseDelayMs: 250,
  allowDeterministicRouteOnScoutFailure: true,
  searchEnabled: process.env.ENABLE_BUILD_SEARCH_GROUNDING !== "false",
});

export const BUILD_SAFETY_SETTINGS = Object.freeze([
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_LOW_AND_ABOVE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
].map((setting) => Object.freeze(setting)));

// Realistic admission reservations (including thinking tokens), distinct from model context capacity.
export const BUILD_OUTPUT_RESERVATIONS = Object.freeze({
  "gemini-3.8-flash": 16384,
  "gemini-4-argon": 32768,
});

export const BUILD_ARGON_THINKING_RESERVATIONS = Object.freeze({
  LOW: 16384,
  MEDIUM: 24576,
  HIGH: 32768,
});

export function resolveBuildOutputReservation(params) {
  const model = params?.model;
  if (!model || !Object.hasOwn(BUILD_OUTPUT_RESERVATIONS, model)) return undefined;
  if (model === "gemini-4-argon") {
    const level = String(params?.config?.thinkingConfig?.thinkingLevel || "").toUpperCase();
    if (Object.hasOwn(BUILD_ARGON_THINKING_RESERVATIONS, level)) {
      return BUILD_ARGON_THINKING_RESERVATIONS[level];
    }
  }
  return BUILD_OUTPUT_RESERVATIONS[model];
}

export function isValidBuildOutputReservation(modelKey, reservationValue) {
  if (!Number.isSafeInteger(reservationValue) || reservationValue <= 0) return false;
  if (modelKey === "gemini-3.8-flash") {
    return reservationValue === BUILD_OUTPUT_RESERVATIONS["gemini-3.8-flash"];
  }
  if (modelKey === "gemini-4-argon") {
    return Object.values(BUILD_ARGON_THINKING_RESERVATIONS).includes(reservationValue) ||
      reservationValue === BUILD_OUTPUT_RESERVATIONS["gemini-4-argon"];
  }
  return false;
}
