export function fastTaskStatusKey(status: string) {
  return ['satisfied', 'in_progress', 'planned', 'skipped', 'not_completed'].includes(status) ? `today.status.${status}` : 'today.status.default'
}
