import { assertPlatformEnabled } from '../security/provider-policy.js';
import { ResearchService } from './research-service.js';
import { PrivacyPolicy, executionContext } from '../security/privacy-policy.js';
import { acquireOwnerExecutionLease } from '../security/owner-execution-lease.js';
import { isWithinGroundedRetention } from './grounded-chat-retention.js';

const terminal = status => ['completed', 'failed', 'cancelled', 'interrupted', 'deleted'].includes(status);
const revoked = () => Object.assign(new Error('Execution authorization revoked'), { code: 'EXECUTION_REVOKED', status: 403 });

export class DistributedResearchService extends ResearchService {
  constructor({ jobStore, redis, userRepository, authStore, recoveryIntervalMs = 60000, ...options }) {
    super(options);
    Object.assign(this, { jobStore, redis, userRepository });
    this.privacyPolicy = userRepository ? new PrivacyPolicy(userRepository, authStore) : null;
    this.pendingOwners = new Set();
    this.subClients = new Set();
    this.stopping = false;
    if (this.redis?.isReady) this.initDistributedSignals().catch(() => {});
    this.recoveryTimer = setInterval(() => this.resumeOrphanedJobs().catch(() => {}), recoveryIntervalMs);
    this.recoveryTimer.unref();
  }

  async initDistributedSignals() {
    if (!this.redis?.duplicate) return;
    const sub = this.redis.duplicate();
    this.subClients.add(sub);
    try {
      await sub.connect();
      await sub.subscribe('helmer:research:cancel', message => {
        try {
          const { jobId, ownerId } = JSON.parse(message);
          const job = this.activeJobs.get(jobId);
          if (job && ownerId === job.ownerId) job.abortController.abort(revoked());
        } catch {}
      });
    } catch { this.subClients.delete(sub); await sub.quit().catch(() => {}); }
  }

  async assertJobOwned(job) {
    await job.executionLease?.lease.assertOwned?.();
    if (this.redis?.isReady && job.researchLeaseToken && await this.redis.get(`helmer:research:lease:${job.id}`) !== job.researchLeaseToken) throw Object.assign(new Error('Research lease lost'), { code: 'EXECUTION_LOCK_LOST' });
    if (this.jobStore) {
      const saved = await this.readCheckpoint(job.id, job.ownerId);
      if (!saved || saved.executionFence !== job.executionFence) throw Object.assign(new Error('Research ownership lost'), { code: 'EXECUTION_LOCK_LOST' });
    }
  }

  async claimJob(job) {
    await job.executionLease?.lease.assertOwned?.();
    await this.mutateCheckpoint(job.id, job.ownerId, async current => {
      await job.executionLease?.lease.assertOwned?.();
      if (!current || current.ownerId !== job.ownerId ||
          (terminal(current.status) && !current.completionPending) || !isWithinGroundedRetention(current.createdAt)) throw revoked();
      job.executionFence = (current.executionFence || 0) + 1;
      return { value: { ...current, executionFence: job.executionFence }, result: job.executionFence };
    });
    if (job.executionFence !== undefined) await this.chatRepository.claimResearchMessage?.(job.chatId, job.ownerId, job.id, job.executionFence);
  }

  async assertJobAuthorized(job) {
    try {
      job.abortController.signal.throwIfAborted();
      await assertPlatformEnabled();
      await this.assertJobOwned(job);
      if (this.privacyPolicy) await this.privacyPolicy.assertExecution({ ownerId: job.ownerId, sessionId: job.sessionId, privacySnapshot: job.privacySnapshot, signal: job.abortController.signal });
      const chat = await this.chatRepository.getById(job.chatId, job.ownerId, { coalesce: false });
      if (!chat || chat.deleted) throw revoked();
      if (job.strategyId && !await this.strategyRepository?.getById(job.strategyId, job.ownerId, { coalesce: false })) throw revoked();
      if (job.briefId && !await this.strategyRepository?.getById(job.briefId, job.ownerId, { coalesce: false })) throw revoked();
      if (job.taskId && !(await this.plannerRepository?.list(job.ownerId, { coalesce: false }) || []).some(task => task.id === job.taskId)) throw revoked();
      if (this.jobStore) {
        const durable = await this.readCheckpoint(job.id, job.ownerId);
        if (!durable || durable.ownerId !== job.ownerId || ['cancelled', 'deleted', 'interrupted'].includes(durable.status)) throw revoked();
      }
    } catch (error) { job.abortController.abort(error); throw error; }
  }

  snapshot(job) {
    return Object.fromEntries(['executionFence', 'id', 'messageId', 'ownerId', 'sessionId', 'chatId', 'prompt', 'language', 'googleSearchEnabled', 'strategyId', 'briefId', 'taskId', 'strategyContext', 'taskContext', 'privacySnapshot', 'status', 'steps', 'sources', 'verifiedResearchSources', 'artifacts', 'content', 'error', 'groundingMetadata', 'createdAt', 'deadlineAt', 'checkpoint', 'usageByModel', 'model', 'provider'].map(key => [key, structuredClone(job[key])]));
  }

  readCheckpoint(jobId, ownerId) {
    if (this.jobStore?.readJob) return this.jobStore.readJob(jobId, ownerId);
    return this.jobStore?.read(`research:${jobId}`);
  }

  mutateCheckpoint(jobId, ownerId, operation) {
    if (this.jobStore?.mutateJob) return this.jobStore.mutateJob(jobId, ownerId, operation);
    return this.jobStore?.mutate(`research:${jobId}`, operation);
  }

  async persistCheckpoint(jobId, patch, { create = false, control = false, worker = this.activeJobs.get(jobId) } = {}) {
    if (!this.jobStore) return;
    const job = worker;
    if (!create && !control) await this.assertJobOwned(job || { id: jobId, executionFence: patch.executionFence });
    const fence = patch.executionFence ?? job?.executionFence;
    if (create) await this.jobStore.index?.(patch);
    const snapshot = await this.mutateCheckpoint(jobId, patch.ownerId || job?.ownerId, async current => {
      if (!control) await job?.executionLease?.lease.assertOwned?.();
      // CAS fencing rejects late writes even if a successor is also running.
      if ((create && current?.executionFence !== undefined) || (!create && !control && current?.executionFence !== fence)) throw Object.assign(new Error('Research ownership lost'), { code: 'EXECUTION_LOCK_LOST' });
      if (!current && !create) throw revoked();
      if (current && patch.ownerId && current.ownerId !== patch.ownerId) throw revoked();
      if (!control && !isWithinGroundedRetention(current?.createdAt || patch.createdAt)) throw revoked();
      if (current && patch.status !== 'deleted' && (['cancelled', 'deleted', 'interrupted'].includes(current.status) || (terminal(current.status) && !current.completionPending && patch.status && current.status !== patch.status))) {
        if (current?.status === patch.status && !(current.completionPending && patch.completionPending === false)) return { value: current, result: current };
        if (current?.status !== patch.status) throw revoked();
      }
      const next = { ...(current || {}), ...patch, version: 1, updatedAt: new Date().toISOString() };
      return { value: next, result: next };
    });
    if (terminal(snapshot.status) && !snapshot.completionPending) {
      await this.jobStore.removeActive?.({ id: jobId, ownerId: patch.ownerId || job?.ownerId }).catch(() => {});
    }
  }

  async prepareJob(job) {
    await this.persistCheckpoint(job.id, this.snapshot(job), { create: true });
  }

  async prepareIntent(job) {
    await this.persistCheckpoint(job.id, this.snapshot(job), { create: true });
  }

  async createResearchJob(args) {
    if (this.stopping || this.pendingOwners.has(args.ownerId) || this.hasActiveJobForOwner(args.ownerId)) throw Object.assign(new Error('Execution busy'), { code: 'EXECUTION_BUSY', status: 429 });
    this.pendingOwners.add(args.ownerId);
    const controller = new AbortController();
    const request = executionContext.getStore();
    let lease, admission;
    try {
      await request?.assertAuthorized?.();
      lease = request?.transferToBackground ? request.transferToBackground() : await acquireOwnerExecutionLease(this.redis, args.ownerId, controller);
      // prepareJob runs before execution starts, so admission is held through persistence.
      // Per-call lease is passed through args rather than shared mutable callback state.
      admission = { lease, controller };
      const result = await super.createResearchJob({ ...args, sessionId: request?.sessionId, executionLease: admission });
      return result;
    } catch (error) {
      for (const [id, job] of this.activeJobs) if (job.ownerId === args.ownerId && !job.executionPromise) {
        job.detachLease?.(); job.abortController.abort(error); this.activeJobs.delete(id);
      }
      if (admission?.intent) await this.persistCheckpoint(admission.intent.id, { ownerId: args.ownerId, status: 'failed', error: 'Research initialization failed.', prompt: null, strategyContext: null, taskContext: null, checkpoint: null }, { worker: { ...admission.intent, executionLease: admission } }).catch(() => {});
      if (request && !request.mutationPending && !request.mutationCommitted) {
        request.isBackgroundJob = false;
        if (!error?.status || error.status >= 500) request.preCommitFailure = true;
      }
      await lease?.release();
      throw error;
    } finally { this.pendingOwners.delete(args.ownerId); }
  }

  async executeJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;
    let checking = false;
    const authority = setInterval(async () => {
      if (checking) return;
      checking = true;
      try { await this.assertJobAuthorized(job); } catch {} finally { checking = false; }
    }, 1000);
    authority.unref();
    try {
      if (job.executionFence === undefined) await this.claimJob(job);
      await this.assertJobAuthorized(job);
      await super.executeJob(jobId);
    } catch (error) {
      job.abortController.abort(error);
      const isRestart = job.abortController.signal.reason?.code === 'RESEARCH_RESTART' || error?.code === 'RESEARCH_RESTART';
      job.status = isRestart ? 'pending' : 'cancelled';
      job.error = isRestart ? null : (job.language === 'en' ? 'Research was canceled.' : 'Araşdırma dayandırıldı.');
      await this.persistJobMessage(job).catch(() => {});
      await this.broadcast(jobId, {
        type: isRestart ? 'step' : 'failed',
        status: job.status,
        error: job.error,
        steps: job.steps,
      });
    } finally {
      clearInterval(authority);
      job.detachLease?.();
      await job.executionLease?.lease.release();
    }
  }

  async persistJobMessage(job) {
    await this.assertJobOwned(job);
    if (!job.abortController?.signal.aborted && !['failed', 'cancelled', 'interrupted'].includes(job.status)) await this.assertJobAuthorized(job);
    if (this.jobStore && job.status === 'completed') {
      // Keep the durable result recoverable until the fenced chat projection is published.
      await this.persistCheckpoint(job.id, { ...this.snapshot(job), status: 'running', completionPending: true }, { worker: job });
      if (await this.publishCompletion(job)) return true;
      if (this.activeJobs.get(job.id) === job) this.activeJobs.delete(job.id);
      return false;
    }
    await this.persistCheckpoint(job.id, this.snapshot(job), { worker: job });
    await super.persistJobMessage(job);
  }

  async publishCompletion(job) {
    try {
      await this.assertJobAuthorized(job);
      await super.persistJobMessage(job, { retryProjection: true });
      await this.assertJobAuthorized(job);
      await this.persistCheckpoint(job.id, { status: 'completed', completionPending: false }, { worker: job });
      return true;
    } catch {
      // Recovery retries the saved result without running models or deleting its artifacts.
      return false;
    }
  }

  async rollbackJobArtifacts(job) {
    await this.assertJobOwned(job);
    return super.rollbackJobArtifacts(job);
  }

  broadcast(jobId, eventData) {
    const job = this.activeJobs.get(jobId);
    if (!job) return Promise.resolve();
    return this.assertJobOwned(job).then(() => {
      super.broadcast(jobId, eventData);
      if (eventData && this.redis?.isReady) return this.redis.publish(`helmer:research:${jobId}`, JSON.stringify(eventData));
    }).catch(() => {});
  }

  async getJob(jobId, ownerId) {
    if (!ownerId || !/^[A-Za-z0-9_-]{1,80}$/.test(String(jobId || ''))) return null;
    const active = this.activeJobs.get(jobId);
    if (active && (!this.jobStore || active.status !== 'completed')) return super.getJob(jobId, ownerId);
    const remote = await this.readCheckpoint(jobId, ownerId);
    if (!remote) return super.getJob(jobId, ownerId);
    if (remote.ownerId !== ownerId || remote.status === 'deleted' || !isWithinGroundedRetention(remote.createdAt)) return null;
    const chat = remote.chatId ? await this.chatRepository.getById(remote.chatId, ownerId, { coalesce: false }) : null;
    if (!chat || chat.deleted) {
      await this.persistCheckpoint(jobId, { ownerId, status: 'deleted', prompt: null, content: null, checkpoint: null, strategyContext: null, taskContext: null, sources: [], steps: [], groundingMetadata: null }, { control: true }).catch(() => {});
      return null;
    }
    const verified = remote.verifiedResearchSources === true;
    return { id: remote.id || jobId, chatId: remote.chatId, status: remote.status, steps: remote.steps || [], sources: verified ? remote.sources || [] : [], artifacts: remote.completionPending ? [] : remote.artifacts || [], groundingMetadata: verified && !remote.completionPending ? remote.groundingMetadata || null : null, content: remote.completionPending ? '' : remote.content || '', error: remote.error || null, createdAt: remote.createdAt, updatedAt: remote.updatedAt };
  }

  subscribe(jobId, ownerId, listener) {
    const unsubscribeLocal = super.subscribe(jobId, ownerId, listener);
    let remoteSub, closed = false;
    const releaseRemote = () => {
      if (!remoteSub) return;
      this.subClients.delete(remoteSub);
      try {
        if (typeof remoteSub.destroy === 'function') remoteSub.destroy();
        else void remoteSub.quit().catch(() => {});
      } catch {}
      remoteSub = undefined;
    };
    if (this.redis?.isReady && !this.activeJobs.has(jobId)) {
      (async () => {
        try {
          if (!await this.getJob(jobId, ownerId) || closed) return;
          const sub = this.redis.duplicate({ socket: { connectTimeout: 5000, reconnectStrategy: false } });
          remoteSub = sub;
          this.subClients.add(sub);
          sub.on?.('error', () => { if (remoteSub === sub) releaseRemote(); });
          await sub.connect();
          if (closed || remoteSub !== sub) return;
          await sub.subscribe(`helmer:research:${jobId}`, async message => {
            try { if (!closed && await this.getJob(jobId, ownerId)) listener(JSON.parse(message)); } catch {}
          });
        } catch { releaseRemote(); }
      })();
    }
    return () => {
      closed = true;
      unsubscribeLocal?.();
      releaseRemote();
    };
  }

  async cancelJob(jobId, ownerId) {
    const visible = ownerId ? await this.getJob(jobId, ownerId) : null;
    if (!visible || terminal(visible.status)) return false;
    const current = await this.readCheckpoint(jobId, ownerId);
    if (current && !terminal(current.status)) await this.persistCheckpoint(jobId, { ownerId, status: 'cancelled' }, { control: true });
    await super.cancelJob(jobId, ownerId);
    if (this.redis?.isReady) await this.redis.publish('helmer:research:cancel', JSON.stringify({ jobId, ownerId })).catch(() => {});
    return true;
  }

  async resumeOrphanedJobs() {
    if (this.stopping || this.recovering || !this.jobStore) return;
    this.recovering = true;
    try {
      const page = this.jobStore.activePage
        ? await this.jobStore.activePage(this.recoveryCursor)
        : { records: (await this.jobStore.entries()).filter(entry => entry.key?.startsWith('research:')) };
      this.recoveryCursor = page.cursor;
      for (const entry of page.records) {
        if (this.stopping) break;
        const saved = entry.value;
        if (!saved || !isWithinGroundedRetention(saved.createdAt) ||
            (terminal(saved.status) && !saved.completionPending) || this.activeJobs.has(saved.id)) continue;
        if (this.redis?.isReady && await this.redis.get(`helmer:research:lease:${saved.id}`)) continue;
        if (this.pendingOwners.has(saved.ownerId) || this.hasActiveJobForOwner(saved.ownerId)) continue;
        this.pendingOwners.add(saved.ownerId);
        let lease;
        const job = { ...saved, steps: saved.steps?.length ? saved.steps : this.createInitialSteps(saved.language), modelImprovement: false, startedAt: Date.now(), subscribers: new Set(), abortController: new AbortController() };
        try {
          lease = await acquireOwnerExecutionLease(this.redis, job.ownerId, job.abortController);
          if (this.stopping) { await lease.release(); break; }
          job.executionLease = { lease };
          if (saved.completionPending) {
            try {
              let chatRemoved = false;
              try {
                await this.claimJob(job);
              } catch (error) {
                if (error?.code !== 'EXECUTION_REVOKED') throw error;
                const latest = await this.readCheckpoint(job.id, job.ownerId).catch(() => null);
                if (!latest || (terminal(latest.status) && !latest.completionPending) || !isWithinGroundedRetention(latest.createdAt)) {
                  await this.jobStore.removeActive?.(job).catch(() => {});
                  continue;
                }
                chatRemoved = true;
              }
              if (!chatRemoved && saved.status !== 'cancelled') {
                job.status = 'completed';
                if (await this.publishCompletion(job)) {
                  this.recordCompletion(job);
                  continue;
                }
                if (job.abortController.signal.reason?.code !== 'EXECUTION_REVOKED') continue;
              }
              job.status = 'cancelled';
              job.content = '';
              job.groundingMetadata = null;
              await this.rollbackJobArtifacts(job).catch(() => {});
              if (!chatRemoved) {
                await super.persistJobMessage(job, { retryProjection: true }).catch(err => {
                  if (err?.code !== 'EXECUTION_REVOKED' && err?.code !== 'NOT_FOUND' && !/removed/i.test(String(err?.message || ''))) throw err;
                });
              }
              await this.persistCheckpoint(
                job.id,
                { ...this.snapshot(job), artifacts: [], prompt: null, strategyContext: null, taskContext: null, checkpoint: null, completionPending: false },
                { worker: job },
              );
            } finally { await lease.release(); }
            continue;
          }
          await this.claimJob(job);
          if (saved.version !== 1 || !saved.privacySnapshot || !saved.deadlineAt || saved.deadlineAt <= Date.now()) {
            job.status = 'interrupted';
            await this.persistJobMessage(job);
            await lease.release();
            continue;
          }
          await this.assertJobAuthorized(job);
          this.activeJobs.set(job.id, job);
          const context = { ownerId: job.ownerId, privacySnapshot: job.privacySnapshot, signal: job.abortController.signal, controller: job.abortController, guest: false, isBackgroundJob: true, assertAuthorized: () => this.assertJobAuthorized(job) };
          context.onProviderUsage = usage => this.recordProviderUsage(job, usage);
          const promise = executionContext.run(context, () => this.executeJob(job.id));
          job.executionPromise = promise;
          this.runningJobPromises.add(promise);
          promise.finally(() => this.runningJobPromises.delete(promise));
        } catch (error) {
          if (lease && !saved.completionPending && error.code !== 'EXECUTION_BUSY') {
            job.status = 'interrupted';
            if (error?.code === 'EXECUTION_REVOKED') {
              job.prompt = null;
              job.strategyContext = null;
              job.taskContext = null;
              job.checkpoint = null;
              job.content = '';
              job.groundingMetadata = null;
            }
            if (job.executionFence !== undefined) await this.persistJobMessage(job).catch(() => {});
            if (error?.code === 'EXECUTION_REVOKED') await this.jobStore.removeActive?.(job).catch(() => {});
          }
          await lease?.release();
        } finally { this.pendingOwners.delete(saved.ownerId); }
      }
    } finally { this.recovering = false; }
  }

  async shutdown() {
    this.stopping = true;
    clearInterval(this.recoveryTimer);
    for (const job of this.activeJobs.values()) if (!terminal(job.status)) job.abortController.abort(Object.assign(new Error('Research worker shutting down'), { code: 'RESEARCH_RESTART' }));
    await this.waitForAllJobs();
    await Promise.allSettled([...this.subClients].map(sub => sub.quit()));
    this.subClients.clear();
  }
}
