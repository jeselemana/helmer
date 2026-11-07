#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { FileAiLearningRepository } from '../src/repositories/file-ai-learning-repository.js';
import { FileChatRepository } from '../src/repositories/file-chat-repository.js';
import { FileTelemetryRepository } from '../src/repositories/file-telemetry-repository.js';
import { isR2Configured, listTenantObjects, readChatObject } from '../src/http/r2-storage.js';
import { pruneExpiredGroundedResults } from '../src/services/ai/grounded-chat-retention.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const flags = new Set(process.argv.slice(2));
const cloud = flags.has('--cloud');
const apply = flags.has('--apply');
const now = Date.now();
const shardName = /^[a-f0-9]{64}\.json$/;
const redactedPrompt = '[Zəruri əməliyyat qeydi - Məzmun ötürülmür]';
const redactedResponse = '[Məzmun gizlədilib - Töhfə deaktivdir]';
const redactedSummary = '[Zəruri məlumat] Model inkişafına töhfə deaktivdir - Məzmun ötürülmür';

function scrubLearning(store) {
  const grounded = store.interactions.filter(item =>
    item.groundingActive === true || item.mode === 'ask_research' || item.taskType === 'deep_research' ||
    item.groundingMetadata || item.relevantContext?.searchGrounded || item.relevantContext?.groundingActive);
  const ids = new Set(grounded.map(item => item.id));
  let changed = 0;
  for (const item of grounded) {
    if (item.userPrompt !== redactedPrompt || item.modelResponse !== redactedResponse ||
        item.relevantContext !== null || !item.onlyNecessaryData || item.modelImprovement !== false) changed++;
    Object.assign(item, {
      userPrompt: redactedPrompt, modelResponse: redactedResponse, relevantContext: null,
      groundingActive: true, onlyNecessaryData: true, modelImprovement: false,
    });
    delete item.groundingMetadata;
  }
  const originalCount = store.signals.length + store.candidates.length + store.iterations.length;
  store.signals = store.signals.filter(item => !ids.has(item.interactionId));
  store.candidates = store.candidates.filter(item => !ids.has(item.sourceInteractionId));
  store.iterations = store.iterations.filter(item => !ids.has(item.parentInteractionId));
  return changed + originalCount - store.signals.length - store.candidates.length - store.iterations.length;
}

function scrubTelemetry(store) {
  let changed = 0;
  for (const item of store.events) {
    if (!item.groundingActive) continue;
    const metadata = {
      model: item.model, tokens: item.tokens?.total, latencyMs: item.latencyMs,
      groundingActive: true, onlyNecessaryData: true, dataRestricted: true,
    };
    const before = JSON.stringify(item);
    Object.assign(item, {
      summary: redactedSummary, category: 'Zəruri Əməliyyat', marketMode: 'GLOBAL_MODE',
      qualityScore: null, onlyNecessaryData: true, modelImprovement: false, metadata,
    });
    delete item.querySnippet;
    if (JSON.stringify(item) !== before) changed++;
  }
  return changed;
}

async function exists(file) {
  try { await fs.access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function maintainStore(store, scrub) {
  if (!cloud && !await exists(store.filePath)) return 0;
  const { store: current } = await store.readAuthoritative();
  const count = scrub(current);
  return apply && count ? store.update(scrub) : count;
}

async function shardNames(directory, prefix) {
  const names = cloud ? (await listTenantObjects(prefix)).map(key => key.split('/').at(-1))
    : await exists(directory) ? await fs.readdir(directory) : [];
  return names.filter(name => shardName.test(name));
}

async function run() {
  if ([...flags].some(flag => !['--apply', '--dry-run', '--cloud'].includes(flag)) ||
      (apply && flags.has('--dry-run'))) throw new Error('Invalid cleanup options');
  if (cloud) loadEnv({ path: path.join(root, '.env'), quiet: true });
  if (cloud && !isR2Configured()) throw new Error('R2 configuration required');
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
  const learning = new FileAiLearningRepository(path.join(dataDir, 'ai-learning-v1.json'), null, { cloud });
  const telemetry = new FileTelemetryRepository(path.join(dataDir, 'telemetry.json'), null, { cloud });
  const chats = new FileChatRepository(path.join(dataDir, 'chats.json'), null, { cloud });
  const report = {
    mode: apply ? 'apply' : 'dry-run', authority: cloud ? 'R2' : 'local',
    learning: await maintainStore(learning, scrubLearning),
    telemetry: await maintainStore(telemetry, scrubTelemetry),
    expiredChatTurns: 0,
  };

  for (const name of await shardNames(telemetry.shardsDirectory, 'telemetry-v2/')) {
    report.telemetry += await maintainStore(telemetry.shardByKey(name.slice(0, -5)), scrubTelemetry);
  }
  for (const name of await shardNames(chats.chatsDir, 'chats-v1/')) {
    const key = name.slice(0, -5);
    // This scan identifies the owner. A mutation always rereads the shard under
    // the repository lock and uses the authoritative revision for the write.
    const record = cloud ? (await readChatObject(key)).record
      : JSON.parse(await fs.readFile(chats.tenantFilePath(key), 'utf8'));
    if (record === null || record?._tombstone) continue;
    if (!Array.isArray(record)) throw new Error('Invalid chat shard');
    if (!record.length) continue;
    const ownerId = record[0]?.ownerId;
    if (!ownerId || chats.tenantKey(ownerId) !== key || record.some(chat => chat.ownerId !== ownerId)) {
      throw new Error('Chat shard ownership verification failed');
    }
    const count = record.reduce((total, chat) => total + pruneExpiredGroundedResults(chat, now), 0);
    report.expiredChatTurns += apply && count ? await chats.pruneGroundedHistory(ownerId, now) : count;
  }
  console.log(JSON.stringify(report));
}

run().catch(error => {
  console.error('Grounded record maintenance failed:', error.code || error.name);
  process.exitCode = 1;
});
