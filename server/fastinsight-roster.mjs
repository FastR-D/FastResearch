import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse, stringify } from 'yaml'

const FILE_HEADER = `# FastInsight research routing roster
# Managed from the FastResearch workspace.
`

export class RosterValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RosterValidationError'
  }
}

export class RosterConflictError extends Error {
  constructor() {
    super('FastInsight 名册已被其他会话修改，请刷新后重试')
    this.name = 'RosterConflictError'
  }
}

function revisionOf(text) {
  return createHash('sha256').update(text).digest('hex')
}

function text(value, label, maxLength) {
  const result = String(value ?? '').trim()
  if (!result) throw new RosterValidationError(`${label}不能为空`)
  if (result.length > maxLength) throw new RosterValidationError(`${label}长度不能超过 ${maxLength} 个字符`)
  return result
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null || value === '') return ''
  return text(value, label, maxLength)
}

function normalizeOwner(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RosterValidationError(`${label}必须是对象`)
  }
  const owner = {
    ...value,
    name: text(value.name, `${label}姓名`, 80),
  }
  const openId = optionalText(value.feishu_open_id, `${label}飞书 Open ID`, 200)
  if (openId) owner.feishu_open_id = openId
  else delete owner.feishu_open_id
  return owner
}

function normalizeDirection(value, index) {
  const label = `研究领域 ${index + 1}`
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RosterValidationError(`${label}必须是对象`)
  }
  const name = text(value.name, `${label}名称`, 160)
  const rawKeywords = value.keywords ?? []
  const rawOwners = value.owners ?? []
  if (!Array.isArray(rawKeywords)) throw new RosterValidationError(`${label}的 keywords 必须是数组`)
  if (!Array.isArray(rawOwners)) throw new RosterValidationError(`${label}的 owners 必须是数组`)
  if (rawKeywords.length > 500) throw new RosterValidationError(`${label}的关键词不能超过 500 个`)
  if (rawOwners.length > 100) throw new RosterValidationError(`${label}的分发人物不能超过 100 个`)

  const keywords = rawKeywords.map((keyword, keywordIndex) => text(keyword, `${label}关键词 ${keywordIndex + 1}`, 160))
  const normalizedKeywords = new Set()
  for (const keyword of keywords) {
    const key = keyword.toLocaleLowerCase()
    if (normalizedKeywords.has(key)) throw new RosterValidationError(`${label}存在重复关键词：${keyword}`)
    normalizedKeywords.add(key)
  }

  const owners = rawOwners.map((owner, ownerIndex) => normalizeOwner(owner, `${label}分发人物 ${ownerIndex + 1}`))
  const normalizedOwners = new Set()
  for (const owner of owners) {
    const key = owner.name.toLocaleLowerCase()
    if (normalizedOwners.has(key)) throw new RosterValidationError(`${label}存在重复分发人物：${owner.name}`)
    normalizedOwners.add(key)
  }

  const direction = { ...value, name, keywords, owners }
  if (value.priority !== undefined && value.priority !== null && value.priority !== '') {
    const priority = Number(value.priority)
    if (!Number.isInteger(priority)) throw new RosterValidationError(`${label}优先级必须是整数`)
    direction.priority = priority
  } else {
    delete direction.priority
  }
  return direction
}

export function normalizeRoster(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RosterValidationError('名册必须是对象')
  }
  const rawDirections = value.directions ?? []
  if (!Array.isArray(rawDirections)) throw new RosterValidationError('directions 必须是数组')
  if (rawDirections.length > 200) throw new RosterValidationError('研究领域不能超过 200 个')
  const directions = rawDirections.map(normalizeDirection)
  const names = new Set()
  for (const direction of directions) {
    const key = direction.name.toLocaleLowerCase()
    if (names.has(key)) throw new RosterValidationError(`研究领域名称重复：${direction.name}`)
    names.add(key)
  }

  const roster = { ...value, directions }
  if (value.default_owner !== undefined && value.default_owner !== null) {
    roster.default_owner = normalizeOwner(value.default_owner, '默认分发人物')
  } else {
    delete roster.default_owner
  }
  return roster
}

export function serializeRoster(value) {
  return `${FILE_HEADER}${stringify(normalizeRoster(value), { lineWidth: 0 })}\n`
}

export async function readRoster(filePath) {
  let raw
  try {
    raw = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') throw new RosterValidationError('FastInsight 名册文件不存在')
    throw error
  }
  let parsed
  try {
    parsed = parse(raw)
  } catch (error) {
    throw new RosterValidationError(`FastInsight 名册 YAML 格式无效：${error.message}`)
  }
  return {
    roster: normalizeRoster(parsed ?? {}),
    revision: revisionOf(raw),
    raw,
  }
}

export async function writeRoster(filePath, value, expectedRevision) {
  if (!String(expectedRevision ?? '').trim()) throw new RosterValidationError('缺少名册版本')
  const current = await readRoster(filePath)
  if (current.revision !== expectedRevision) throw new RosterConflictError()
  const output = serializeRoster(value)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(`${filePath}.bak`, current.raw, 'utf8')
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporaryPath, output, { encoding: 'utf8', mode: 0o644 })
  try {
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
  return {
    roster: normalizeRoster(parse(output)),
    revision: revisionOf(output),
    raw: output,
  }
}
