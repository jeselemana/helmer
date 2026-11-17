import { createHash } from 'node:crypto';
import { isWithinGroundedRetention, MAX_GROUNDED_CHAT_RETENTION_MS } from '../ai/grounded-chat-retention.js';
import { DurableStore } from './durable-store.js';

const jobIdPattern = /^[0-9a-f-]{36}$/i;
const terminalStatuses = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'deleted']);

function jobPath(ownerId, jobId) {
  if (typeof ownerId !== 'string' || !ownerId || typeof jobId !== 'string' || !jobIdPattern.test(jobId)) {
    throw new Error('Invalid Research identity');
  }
  return `${createHash('sha256').update(ownerId).digest('hex')}/${jobId.toLowerCase()}`;
}

function retentionKey(job) {
  const due = new Date(Date.parse(job.createdAt) + MAX_GROUNDED_CHAT_RETENTION_MS).toISOString().slice(0, 10);
  return `retention/${due}/${jobPath(job.ownerId, job.id)}`;
}

export class ResearchJobStore {
  constructor(directory, options) {
    this.store = new DurableStore(directory, { ...options, prefix: 'research-jobs-v1', scoped: true });
  }

  async readJob(jobId, ownerId) {
    const job = await this.store.read(`jobs/${jobPath(ownerId, jobId)}`);
    return job?.ownerId === ownerId && job.id === jobId ? job : null;
  }

  mutateJob(jobId, ownerId, operation) {
    return this.store.mutate(`jobs/${jobPath(ownerId, jobId)}`, async current => {
      if (current && (current.ownerId !== ownerId || current.id !== jobId)) throw new Error('Invalid Research record');
      return operation(current);
    });
  }

  async index(job) {
    const marker = { id: job.id, ownerId: job.ownerId, createdAt: job.createdAt, indexedAt: Date.now() };
    await this.store.mutate(retentionKey(marker), current => ({ value: current || marker }));
    if (!terminalStatuses.has(job.status)) {
      await this.store.mutate(`active/${jobPath(job.ownerId, job.id)}`, current => ({ value: current || marker }));
    }
  }

  async importLegacy(job) {
    if (await this.readJob(job.id, job.ownerId)) return;
    await this.index(job);
    await this.mutateJob(job.id, job.ownerId, current => ({ value: current || job }));
  }

  async removeActive(job) {
    await this.store.removeIndex(`active/${jobPath(job.ownerId, job.id)}`);
  }

  async removeRetention(job) {
    await this.store.removeIndex(retentionKey(job));
  }

  async activePage(cursor) {
    const page = await this.store.entriesPage('active/', { cursor });
    const records = [];
    for (const { value: marker } of page.records) {
      if (!marker) continue;
      const job = await this.readJob(marker.id, marker.ownerId);
      if (job && (!terminalStatuses.has(job.status) || job.completionPending) && isWithinGroundedRetention(job.createdAt)) {
        records.push({ value: job });
      } else if (job || Date.now() - marker.indexedAt > 10 * 60 * 1000) {
        await this.removeActive(marker).catch(() => {});
      }
    }
    return { records, cursor: page.cursor };
  }

  async retentionPage(cursor, now) {
    const today = new Date(now).toISOString().slice(0, 10);
    let hasFuture = false;
    const page = await this.store.entriesPage('retention/', {
      cursor,
      select: filename => {
        const due = filename.split('/')[1];
        if (due > today) hasFuture = true;
        return due <= today;
      },
    });
    return { records: page.records, cursor: hasFuture ? undefined : page.cursor };
  }

  async *jobsForOwner(ownerId) {
    const tenant = createHash('sha256').update(ownerId).digest('hex');
    let cursor;
    do {
      const page = await this.store.entriesPage(`jobs/${tenant}/`, { cursor });
      for (const { value } of page.records) if (value?.ownerId === ownerId) yield value;
      cursor = page.cursor;
    } while (cursor);
  }
}
