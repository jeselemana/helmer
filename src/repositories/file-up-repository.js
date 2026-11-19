import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isR2Configured, readUpObject, writeUpObject } from '../http/r2-storage.js';
import { migrateUpState } from './up-migrations.js';
import { fail } from '../services/up/domain.js';
import { TenantLockManager } from './tenant-lock.js';
import { writeJsonAtomically } from './atomic-json-store.js';

export class FileUpRepository {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.cloud = options.cloud ?? isR2Configured();
    this.readCloud = options.readCloud || readUpObject;
    this.writeCloud = options.writeCloud || writeUpObject;
    this.lockManager = new TenantLockManager(this.directory, {
      timeoutMs: options.lockTimeoutMs ?? 15000,
      staleMs: options.lockStaleMs ?? 20000,
    });
  }
  key(ownerId) {
    if (!/^(?:usr_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) fail('INVALID_OWNER');
    return createHash('sha256').update(ownerId).digest('hex');
  }
  async read(ownerId) {
    const key = this.key(ownerId);
    if (this.cloud) return migrateUpState((await this.readCloud(key)).record, ownerId);
    try { return migrateUpState(JSON.parse(await fs.readFile(path.join(this.directory, `${key}.json`), 'utf8')), ownerId); }
    catch (error) { if (error.code === 'ENOENT') return migrateUpState(null, ownerId); throw error; }
  }
  // Callbacks are synchronous/pure: optimistic retries never repeat a model request.
  async mutate(ownerId, change) {
    const key = this.key(ownerId);
    if (this.cloud) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const { record, etag } = await this.readCloud(key);
        const state = migrateUpState(record, ownerId);
        const result = change(state);
        if (result?.then) throw new Error('UP mutation must be synchronous');
        state.revision++;
        this.checkSize(state);
        if (await this.writeCloud(key, state, etag)) return structuredClone(result);
      }
      fail('STORAGE_BUSY', 503);
    }
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      return await this.lockManager.runInLock(key, async () => {
        const state = await this.read(ownerId);
        const result = change(state);
        if (result?.then) throw new Error('UP mutation must be synchronous');
        state.revision++;
        this.checkSize(state);
        await writeJsonAtomically(path.join(this.directory, `${key}.json`), state);
        return structuredClone(result);
      });
    } catch (error) {
      if (error?.code === 'STORAGE_BUSY') fail('STORAGE_BUSY', 503);
      throw error;
    }
  }
  checkSize(state) { if (Buffer.byteLength(JSON.stringify(state)) > 20 * 1024 * 1024) fail('STORAGE_LIMIT', 409); }
  async deleteAllByOwner(ownerId) {
    // Persist a tombstone atomically so an in-flight evaluator cannot resurrect data.
    await this.mutate(ownerId, state => {
      const revision = state.revision;
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, migrateUpState(null, ownerId), { revision, deleted: true });
    });
    return 1;
  }
}
