import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import { assignAccountIds } from './account-store.mjs';

/** Business fingerprint. Never includes key material, hashes, or passwords. */
export function contentFingerprint(record) {
  const view = {
    legacyKeyId: record.id,
    authors: record.followedAuthors ?? [],
    tags: record.customResearchTags ?? [],
    inbox: record.inbox ?? [],
    impression: record.researchImpression ?? null,
    insightCount: Array.isArray(record.insightItems) ? record.insightItems.length : 0,
    articleCount: Array.isArray(record.recentArticles) ? record.recentArticles.length : 0,
    workflowId: record.workflow?.id ?? null,
  };
  return createHash('sha256').update(JSON.stringify(view)).digest('hex');
}

export function planMigration(keys) {
  return (keys ?? []).map((record) => ({
    legacyKeyId: record.id,
    accountId: record.accountId || null,
    person: record.person,
    contentHash: contentFingerprint(record),
  }));
}

export function migrateAccounts(data, db, options = {}) {
  if (!Array.isArray(data.keys)) data.keys = [];
  const before = data.keys.map(contentFingerprint);
  if (options.backupFile && data.keys.some((record) => !record.accountId) && existsSync(options.sourceFile) && !existsSync(options.backupFile)) {
    copyFileSync(options.sourceFile, options.backupFile);
  }
  const changed = assignAccountIds(data.keys, db, () => randomBytes(16).toString('hex'));
  const after = data.keys.map(contentFingerprint);
  if (before.some((hash, index) => hash !== after[index])) {
    throw new Error('account migration changed content');
  }
  return changed;
}

/** Replace the secret without changing the account or the content hanging on it. */
export function rotateKey(record, next) {
  record.keyHash = next.keyHash;
  record.keyPreview = next.keyPreview;
  record.revokedAt = null;
  return record;
}
