// 格式化工具：金额 / 百分比 / 日期 / 脱敏

/** 12345.6 → 12,345.60 */
export function money(v, digits = 2) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  if (Number.isNaN(n)) return '-'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 0.106 → 10.6% */
export function percent(v, digits = 1) {
  if (v === null || v === undefined || v === '') return '-'
  return `${Number(v).toFixed(digits)}%`
}

/** 把已经是百分数的数值直接补 %（数据集里 ratio 字段多为 10.6 表示 10.6%） */
export function pct(v, digits = 1) {
  if (v === null || v === undefined || v === '') return '-'
  return `${Number(v).toFixed(digits)}%`
}

export function wan(v) {
  if (v === null || v === undefined || v === '') return '-'
  const n = Number(v)
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return money(n, 0)
}

/** 13800138001 → 138****8001 */
export function maskPhone(p) {
  if (!p) return '-'
  return String(p).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
}

export function maskId(id) {
  if (!id) return '-'
  return String(id).replace(/^(.{4}).*(.{4})$/, '$1**********$2')
}

/** 与当前演示基准日（数据生成日）相差天数 */
export const TODAY = '2026-10-21'

export function daysBetween(a, b = TODAY) {
  if (!a) return null
  const d1 = new Date(String(a).slice(0, 10))
  const d2 = new Date(b)
  return Math.round((d2 - d1) / 86400000)
}

/** 距到期天数 → 文案 */
export function expireText(date) {
  // daysBetween = 今天 - 到期日：正数=已经过去，负数=还没到
  const d = daysBetween(date)
  if (d === null) return '-'
  if (d === 0) return '今天到期'
  if (d > 0) return `已过期 ${d} 天`
  return `${Math.abs(d)} 天后到期`
}

export function trendText(t) {
  if (t === null || t === undefined) return ''
  const n = Number(t)
  if (n === 0) return '持平'
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}
