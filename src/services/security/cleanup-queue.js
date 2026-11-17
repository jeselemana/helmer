import { isWithinGroundedRetention } from '../ai/grounded-chat-retention.js';

export class CleanupQueue {
  constructor(store, artifacts, cache, researchStore = null) {
    this.store = store;
    this.artifacts = artifacts;
    this.cache = cache;
    this.researchStore = researchStore;
    this.timer = setInterval(() => this.process().catch(() => {}), 60000);
    this.timer.unref();
  }
  async enqueue(ownerIdOrChat, id, type = 'chat', metadata = {}) {
    let ownerId = ownerIdOrChat;
    let targetId = id;
    let targetType = type;
    let targetMeta = metadata;

    if (typeof ownerIdOrChat === 'object' && ownerIdOrChat !== null) {
      ownerId = ownerIdOrChat.ownerId;
      targetId = ownerIdOrChat.id;
      targetType = 'chat';
      targetMeta = { messages: ownerIdOrChat.messages || [], ...(typeof id === 'object' ? id : {}) };
    }

    if (!ownerId || !targetId) return;

    const key = `cleanup:${ownerId}:${targetId}`;
    await this.store.mutate(key, () => ({ value: { ownerId, id: targetId, type: targetType, metadata: targetMeta, queuedAt: Date.now(), attempts: 0 }, result: true }));
    if (targetType !== 'expired-research') void this.process().catch(() => {});
  }
  async enqueueChat(chat, metadata = {}) {
    if (!chat?.ownerId || !chat?.id) return;
    return this.enqueue(chat.ownerId, chat.id, 'chat', { messages: chat.messages || [], ...metadata });
  }
  async enqueueAskFile(ownerId, fileIds = []) {
    if (!ownerId || !Array.isArray(fileIds) || fileIds.length === 0) return;
    const cleanIds = [...new Set(fileIds.filter((id) => typeof id === 'string' && id.trim()))];
    if (cleanIds.length === 0) return;
    return this.enqueue(ownerId, `ask-file:${cleanIds[0]}`, 'ask-file', { fileIds: cleanIds });
  }
  async pending(ownerId, id) {
    const item = await this.store.read(`cleanup:${ownerId}:${id}`);
    return Boolean(item);
  }
  async deleteResearchRecord(jobId, ownerId, chatId, { expiredOnly = false, now = Date.now(), matchAnyChat = false } = {}) {
    if (!/^[0-9a-f-]{36}$/i.test(jobId || '')) return;
    const key = `research:${jobId}`;
    const belongsToChat = job => job && job.ownerId === ownerId && (matchAnyChat || job.chatId === chatId);
    const removable = job => belongsToChat(job) && (!expiredOnly || job.status === 'deleted' || !isWithinGroundedRetention(job.createdAt, now));
    const scoped = await this.researchStore?.readJob(jobId, ownerId);
    if (scoped) {
      if (!removable(scoped)) return;
      await this.artifacts?.deleteChatArtifacts({ id: scoped.chatId || chatId, ownerId, messages: [{ artifacts: scoped.artifacts || [] }] });
      await this.researchStore.mutateJob(jobId, ownerId, current => ({ value: removable(current) ? { id: jobId, ownerId, status: 'deleted' } : current }));
      await this.researchStore.removeRetention(scoped);
      await this.researchStore.removeActive(scoped);
      return;
    }
    await this.deleteLegacyResearchRecord(key, removable, ownerId, chatId);
  }
  async deleteLegacyResearchRecord(key, removable, ownerId, chatId) {
    const job = await this.store.read(key);
    if (!removable(job)) return;
    const jobId = key.slice('research:'.length);
    if (this.researchStore && /^[0-9a-f-]{36}$/i.test(jobId)) {
      await this.researchStore.mutateJob(jobId, ownerId, current => ({
        value: !current || removable(current) ? { id: jobId, ownerId, status: 'deleted' } : current,
      }));
    }
    await this.artifacts?.deleteChatArtifacts({ id: job.chatId || chatId, ownerId, messages: [{ artifacts: job.artifacts || [] }] });
    await this.store.mutate(key, current => ({ value: removable(current) ? null : current, result: true }));
  }
  process() {
    this.processing ??= this.processBatch().finally(() => { this.processing = null; });
    return this.processing;
  }
  async processBatch() {
    const now = Date.now();
    await this.cache?.cleanupPersistedExpired?.(now).catch(() => {});
    if (this.researchStore) {
      const retention = await this.researchStore.retentionPage(this.retentionCursor, now);
      this.retentionCursor = retention.cursor;
      for (const { value: marker } of retention.records) {
        if (!marker) continue;
        try {
          const job = await this.researchStore.readJob(marker.id, marker.ownerId);
          if (!job?.chatId) await this.researchStore.removeRetention(marker);
          else await this.deleteResearchRecord(job.id, job.ownerId, job.chatId, { expiredOnly: true, now });
        } catch { /* Retry the index item on the next pass. */ }
      }
    }
    const page = this.researchStore ? await this.store.entriesPage('', { cursor: this.queueCursor }) : { records: await this.store.entries() };
    this.queueCursor = page.cursor;
    const entries = page.records;
    for (const entry of entries) {
      if (entry.key?.startsWith('research:') && entry.value) {
        const job = entry.value;
        if (job.status === 'deleted' || !isWithinGroundedRetention(job.createdAt, now)) {
          await this.deleteLegacyResearchRecord(entry.key, current => current?.ownerId === job.ownerId &&
            current.chatId === job.chatId && (current.status === 'deleted' || !isWithinGroundedRetention(current.createdAt, now)),
          job.ownerId, job.chatId).catch(() => {});
        } else if (this.researchStore) {
          try {
            await this.researchStore.importLegacy(job);
            await this.store.mutate(entry.key, current => ({
              value: current?.ownerId === job.ownerId && current.updatedAt === job.updatedAt ? null : current,
            }));
          } catch { /* Retry migration on the next pass. */ }
        }
        continue;
      }
      if (!entry.key?.startsWith('cleanup:')) continue;
      const { ownerId, id, type, metadata } = entry.value || {};
      try {
        if (type === 'chat') {
          if (metadata?.messages) {
            await this.artifacts?.deleteChatArtifacts({ id, ownerId, messages: metadata.messages });
            await this.cache?.deleteChatFiles?.(ownerId, metadata.messages);
          }
          const researchJobIds = (metadata?.messages || [])
            .filter((m) => m.type === 'research' && m.jobId)
            .map((m) => m.jobId);
          for (const jobId of researchJobIds) {
            await this.deleteResearchRecord(jobId, ownerId, id);
          }
        }
        if (type === 'expired-research') {
          await this.artifacts?.deleteChatArtifacts({ id: metadata.chatId, ownerId, messages: [{ artifacts: metadata.artifacts }] });
          await this.deleteResearchRecord(metadata.jobId, ownerId, metadata.chatId, { expiredOnly: true });
        }
        if (type === 'ask-file' && Array.isArray(metadata?.fileIds)) {
          await this.cache?.deleteChatFiles?.(ownerId, metadata.fileIds.map(fileId => ({ file: { fileId } })));
        }
        if (type === 'owner') {
          const targetOwner = id || ownerId;
          await this.cache?.deleteOwnerPersistedFiles?.(targetOwner);
          if (this.researchStore) {
            for await (const job of this.researchStore.jobsForOwner(targetOwner)) {
              await this.deleteResearchRecord(job.id, targetOwner, job.chatId || null, { matchAnyChat: true });
            }
          }
          let cursor;
          do {
            const legacy = this.researchStore ? await this.store.entriesPage('', { cursor }) : { records: await this.store.entries() };
            for (const item of legacy.records) {
              if (item.key?.startsWith('research:') && item.value?.ownerId === targetOwner) {
                await this.deleteLegacyResearchRecord(item.key, current => current?.ownerId === targetOwner, targetOwner, item.value.chatId || null);
              }
            }
            cursor = legacy.cursor;
          } while (cursor);
        }
        if (type !== 'expired-research') {
          if (this.cache?.removeOwnerFiles) this.cache.removeOwnerFiles(ownerId);
          else if (this.cache?.clearOwner) this.cache.clearOwner(ownerId);
        }
        await this.store.mutate(entry.key, () => ({ value: null, result: true }));
      } catch (err) {
        await this.store.mutate(entry.key, (current) => ({ value: current ? { ...current, attempts: (current.attempts || 0) + 1, lastError: err.message } : null, result: false }));
      }
    }
  }
}
