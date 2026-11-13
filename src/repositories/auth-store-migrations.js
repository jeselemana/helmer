export const AUTH_USER_SCHEMA_VERSION = 3;

export function migrateUser(user) {
  if (!user || typeof user !== "object") return user;
  const currentSettings = user.settings && typeof user.settings === "object" ? user.settings : {};
  return {
    ...user,
    deletionRequestedAt: typeof user.deletionRequestedAt === "string" ? user.deletionRequestedAt : null,
    scheduledDeletionAt: typeof user.scheduledDeletionAt === "string" ? user.scheduledDeletionAt : null,
    status: user.status === "pending_deletion" ? "pending_deletion" : "active",
    settings: {
      personalIntelligence: currentSettings.personalIntelligence === true,
      brandName: typeof currentSettings.brandName === "string" ? currentSettings.brandName : "",
      industry: typeof currentSettings.industry === "string" ? currentSettings.industry : "",
      targetAudience: typeof currentSettings.targetAudience === "string" ? currentSettings.targetAudience : "",
      primaryMarket: typeof currentSettings.primaryMarket === "string" ? currentSettings.primaryMarket : "",
      tone: typeof currentSettings.tone === "string" ? currentSettings.tone : "professional",
      customInstructions: typeof currentSettings.customInstructions === "string" ? currentSettings.customInstructions : "",
      memories: Array.isArray(currentSettings.memories) ? currentSettings.memories : [],
      autoContext: currentSettings.autoContext !== false,
      strategyPersonalization: currentSettings.strategyPersonalization !== false,
      ...(currentSettings.autoSaveStrategies !== undefined ? { autoSaveStrategies: currentSettings.autoSaveStrategies !== false } : {}),
      ...(currentSettings.modelImprovement !== undefined ? { modelImprovement: currentSettings.modelImprovement !== false } : {}),
      defaultMode: currentSettings.defaultMode === "ask" ? "ask" : "build",
      language: currentSettings.language === "en" ? "en" : "az",
    },
  };
}

export function migrateAuthUserStore(input) {
  if (Array.isArray(input)) {
    return { schemaVersion: AUTH_USER_SCHEMA_VERSION, users: input.map(migrateUser) };
  }

  if (!input || typeof input !== "object") {
    return { schemaVersion: AUTH_USER_SCHEMA_VERSION, users: [] };
  }

  const users = Array.isArray(input.users) ? input.users.map(migrateUser) : [];
  return { schemaVersion: AUTH_USER_SCHEMA_VERSION, users };
}
