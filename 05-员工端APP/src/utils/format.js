/** 格式化小工具（移动端只留用得到的几条） */

/** 手机号脱敏：138****8001 */
export const maskPhone = p => (p ? String(p).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '—')

/** 金额：¥1,234.00 */
export const money = n =>
  `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 时长：小时 → 3.5 小时 / 2 天 3 小时 */
export const hoursText = h => {
  const v = Number(h || 0)
  if (!v) return '—'
  if (v < 24) return `${v} 小时`
  return `${Math.floor(v / 24)} 天 ${Math.round(v % 24)} 小时`
}
