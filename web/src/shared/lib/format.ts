export function splitInsight(summary?: string) {
  if (!summary) return { abstract: '', trend: '' }
  const marker = '\n\n趋势：'
  const index = summary.indexOf(marker)
  if (index === -1) return { abstract: summary, trend: '' }
  return { abstract: summary.slice(0, index), trend: summary.slice(index + marker.length).trim() }
}

export function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
