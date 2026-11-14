import { AsyncLocalStorage } from 'node:async_hooks';

export const executionContext = new AsyncLocalStorage();
export function privacySnapshot(user) {
  return { enabled: user?.settings?.modelImprovement === true && user?.settings?.personalIntelligence !== false, epoch: user?.privacyEpoch || 0, ownerId: user?.id, authVersion: user?.authVersion || 1 };
}
export class PrivacyPolicy {
  constructor(users) { this.users = users; }
  async allows(ownerId, snapshot) {
    if (!ownerId || typeof ownerId !== 'string' || ownerId.startsWith('guest_')) return false;
    const store = executionContext.getStore();
    const effectiveSnapshot = snapshot !== undefined
      ? snapshot
      : (store?.ownerId === ownerId ? store?.privacySnapshot : null);

    if (effectiveSnapshot && !effectiveSnapshot.enabled) return false;
    try {
      const user = await this.users.findById(ownerId);
      if (!user || user.status !== 'active' || user.scheduledDeletionAt || user.settings?.modelImprovement !== true || user.settings?.personalIntelligence === false) {
        return false;
      }
      if (effectiveSnapshot && (user.privacyEpoch || 0) !== effectiveSnapshot.epoch) {
        return false;
      }
      return true;
    } catch { return false; }
  }
  async assertExecution(context = executionContext.getStore()) {
    if (!context) return;
    context.signal?.throwIfAborted();
    // Every streaming boundary revalidates authoritative state cleanly in parallel.
    await Promise.all([
      (async () => {
        if (!context.guest) {
          const user = await this.users.findById(context.ownerId);
          const snapshot = context.privacySnapshot;
          if (!user || user.status !== 'active' || user.scheduledDeletionAt ||
              !snapshot || (user.privacyEpoch || 0) !== snapshot.epoch ||
              (snapshot.authVersion !== undefined && (user.authVersion || 1) !== snapshot.authVersion)) {
            throw Object.assign(new Error('Execution authorization revoked'), { code: 'EXECUTION_REVOKED', status: 403 });
          }
        }
      })(),
      context.assertResources?.(),
      ...(context.resourceChecks || []).map(async check => {
        if (!await check()) throw Object.assign(new Error('Execution context removed'), { code: 'EXECUTION_REVOKED', status: 403 });
      }),
    ]);
    context.signal?.throwIfAborted();
  }
  middleware() {
    return (req, res, next) => {
      const context = { ownerId: req.ownerId, privacySnapshot: privacySnapshot(req.user), providerStarted: false, guest: !req.user, signal: null, timings: req.askTimings };
      context.assertAuthorized = () => this.assertExecution(context);
      req.securityContext = context;
      executionContext.run(context, next);
    };
  }
}
