import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  RosterConflictError,
  RosterValidationError,
  normalizeRoster,
  readRoster,
  serializeRoster,
  writeRoster,
} from './fastinsight-roster.mjs'

const roster = {
  directions: [
    {
      name: 'Agent 安全',
      keywords: ['Agent Security', 'Prompt Injection'],
      owners: [
        { name: '温江涛', feishu_open_id: 'ou_agent_owner' },
        { name: '新同学' },
      ],
      priority: 2,
    },
  ],
  default_owner: { name: '何艺', feishu_open_id: 'ou_default_owner' },
}

test('normalizes and serializes the FastInsight roster', () => {
  const output = serializeRoster(roster)
  assert.match(output, /name: Agent 安全/)
  assert.match(output, /feishu_open_id: ou_agent_owner/)
  assert.deepEqual(normalizeRoster(roster).directions[0].keywords, ['Agent Security', 'Prompt Injection'])
})

test('rejects duplicate directions, keywords and owners', () => {
  assert.throws(() => normalizeRoster({
    directions: [
      { name: 'Agent', keywords: ['same', 'SAME'], owners: [{ name: 'A' }] },
      { name: 'agent', keywords: ['other'], owners: [{ name: 'B' }] },
    ],
  }), RosterValidationError)
})

test('writes atomically and detects concurrent edits', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fastresearch-roster-'))
  const filePath = path.join(directory, 'colleagues.yaml')
  try {
    await writeFile(filePath, 'directions: []\n', 'utf8')
    const first = await readRoster(filePath)
    const saved = await writeRoster(filePath, roster, first.revision)
    const stored = await readFile(filePath, 'utf8')
    assert.equal(stored, saved.raw)
    assert.equal((await readFile(`${filePath}.bak`, 'utf8')), first.raw)
    await assert.rejects(() => writeRoster(filePath, roster, first.revision), RosterConflictError)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
