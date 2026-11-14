export class CleanupQueue {
  constructor(store, artifacts, cache) {
    this.store = store;
    this.artifacts = artifacts;
    this.cache = cache;
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
    void this.process();
  }
  async enqueueChat(chat, metadata = {}) {
    if (!chat?.ownerId || !chat?.id) return;
    return this.enqueue(chat.ownerId, chat.id, 'chat', { messages: chat.messages || [], ...metadata });
  }
  async pending(ownerId, id) {
    const item = await this.store.read(`cleanup:${ownerId}:${id}`);
    return Boolean(item);
  }
  async process() {
    const entries = await this.store.entries().catch(() => []);
    for (const entry of entries) {
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
            await this.store.mutate(`research:${jobId}`, () => ({ value: null, result: true }));
          }
        }
        if (type === 'owner') {
          await this.cache?.deleteOwnerPersistedFiles?.(id || ownerId);
          const all = await this.store.entries().catch(() => []);
          for (const item of all) {
            if (item.key?.startsWith('research:') && item.value?.ownerId === id) {
              await this.store.mutate(item.key, () => ({ value: null, result: true }));
            }
          }
        }
        if (this.cache?.removeOwnerFiles) this.cache.removeOwnerFiles(ownerId);
        else if (this.cache?.clearOwner) this.cache.clearOwner(ownerId);
        await this.store.mutate(entry.key, () => ({ value: null, result: true }));
      } catch (err) {
        await this.store.mutate(entry.key, (current) => ({ value: current ? { ...current, attempts: (current.attempts || 0) + 1, lastError: err.message } : null, result: false }));
      }
    }
  }
}
