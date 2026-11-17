import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deleteTenantObject, isR2Configured, readTenantObject, writeTenantObject, listTenantObjects, listTenantObjectsPage } from '../../http/r2-storage.js';
import { TenantLockManager } from '../../repositories/tenant-lock.js';
import { writeJsonAtomically } from '../../repositories/atomic-json-store.js';

export class DurableStore {
  constructor(directory, { cloud = isR2Configured(), read = readTenantObject, write = writeTenantObject, list = listTenantObjects, listPage = listTenantObjectsPage, remove = deleteTenantObject, prefix = 'security-v4', scoped = false } = {}) {
    Object.assign(this, { directory, cloud, readCloud: read, writeCloud: write, listCloud: list, listPage, removeCloud: remove, prefix, scoped });
    this.locks = new TenantLockManager(directory);
  }
  name(key) {
    if (!this.scoped) return createHash('sha256').update(key).digest('hex');
    if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(key)) throw new Error('Invalid storage key');
    return key;
  }
  async read(key) {
    return (await this.readRecord(`${this.name(key)}.json`))?.value ?? null;
  }
  async readRecord(filename) {
    if (this.cloud) return (await this.readCloud(`${this.prefix}/${filename}`, { force: true })).record;
    try { return JSON.parse(await fs.readFile(path.join(this.directory, filename), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  mutate(key, operation) {
    const name = this.name(key);
    const lockKey = this.scoped ? createHash('sha256').update(name).digest('hex') : name;
    return this.locks.runInLock(lockKey, async () => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const objectKey = `${this.prefix}/${name}.json`;
        const existing = this.cloud ? await this.readCloud(objectKey, { force: true }) : { record: { value: await this.read(key) } };
        const { value, result } = await operation(structuredClone(existing.record?.value ?? null));
        const record = { key, value, updatedAt: Date.now() };
        if (this.cloud && !await this.writeCloud(objectKey, record, existing.etag)) continue;
        await writeJsonAtomically(path.join(this.directory, `${name}.json`), record);
        return result;
      }
      throw Object.assign(new Error('Storage concurrency conflict'), { code: 'STORAGE_BUSY', status: 503 });
    });
  }
  async removeIndex(key) {
    if (!this.scoped || !/^(?:active|retention)\//.test(key)) throw new Error('Invalid index key');
    const name = this.name(key);
    const filename = `${name}.json`;
    await this.locks.runInLock(createHash('sha256').update(name).digest('hex'), async () => {
      if (this.cloud && !await this.removeCloud(`${this.prefix}/${filename}`)) throw new Error('Index removal failed');
      await fs.rm(path.join(this.directory, filename), { force: true });
    });
  }
  async entriesPage(scope = '', { cursor, limit = 64, select = () => true } = {}) {
    if (scope) this.name(scope.slice(0, -1));
    const prefix = `${this.prefix}/${scope}`;
    let filenames, nextCursor;
    if (this.cloud) {
      const page = await this.listPage(prefix, { cursor, limit });
      const rootPrefix = `data/${this.prefix}/`;
      filenames = page.keys.filter(key => key.startsWith(rootPrefix)).map(key => key.slice(rootPrefix.length));
      nextCursor = page.cursor;
    } else {
      let names;
      try { names = await fs.readdir(path.join(this.directory, scope), { recursive: this.scoped }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
      const remaining = names.filter(name => /^[a-z0-9/-]+\.json$/.test(name)).sort()
        .map(name => scope + name).filter(name => !cursor || name > cursor);
      filenames = remaining.slice(0, limit);
      if (remaining.length > limit) nextCursor = filenames.at(-1);
    }
    const records = await Promise.all(filenames.filter(select).map(filename => this.readRecord(filename)));
    return { records: records.filter(Boolean), cursor: nextCursor };
  }
  async entries() {
    if (this.cloud) {
      const keys = await this.listCloud(`${this.prefix}/`);
      const records = [];
      for (const key of keys) { const item = (await this.readCloud(key, { force: true })).record; if (item) records.push(item); }
      return records;
    }
    let names; try { names = await fs.readdir(this.directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const records = [];
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) records.push(JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')));
    return records;
  }
}
