/** 格式化小工具（只留业主端用得到的几条，与员工端同名同义） */

/** 金额：¥1,234.00 */
export const money = n =>
  `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** 金额（不带符号，用于大号数字旁边单独放 ¥） */
export const amount = n =>
  Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 手机号脱敏：138****8001 */
export const maskPhone = p => (p ? String(p).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '—')

/** 证件号脱敏：只留后四位 */
export const maskIdTail = tail => (tail ? `**** **** **** ${tail}` : '—')

/** 面积：115.14 ㎡（去掉无意义的小数 0） */
export const areaText = n => `${Number(n || 0).toFixed(2).replace(/\.?0+$/, '')} ㎡`

/** 账期：2026-09 → 2026年09月 */
export const periodText = p => (p ? String(p).replace(/^(\d{4})-(\d{2})$/, '$1年$2月') : '—')

/** 日期时间截断到分钟：2026-10-21 09:12 → 10-21 09:12 */
export const mdTime = s => (s ? String(s).slice(5) : '—')

/** 逾期天数 → 文案 */
export const overdueText = d => {
  const n = Number(d || 0)
  if (!n) return ''
  if (n >= 90) return `已逾期 ${n} 天`
  if (n >= 30) return `逾期 ${n} 天`
  return `逾期 ${n} 天`
}

/** 账单状态一句话：避免出现「逾期 · 逾期 6 天」这种把状态和天数说两遍的写法 */
export const billStateText = b => {
  const st = String(b?.status || '')
  const d = Number(b?.overdueDays || 0)
  if (!d) return st
  return st === '逾期' ? `${st} ${d} 天` : `${st} · 逾期 ${d} 天`
}
