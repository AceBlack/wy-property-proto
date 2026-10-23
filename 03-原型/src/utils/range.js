// 时间范围工具：驾驶舱的「近 7 / 30 / 90 天 · 半年 · 自定义」共用一套口径
// 约定：range = { start: Date, end: Date, days: number, quick: string }

/** 预设档位（与组件规范「时间筛选」一致，另加半年度以适配月度指标） */
export const RANGE_PRESETS = [
  { value: '7', label: '近 7 天', days: 7 },
  { value: '30', label: '近 30 天', days: 30 },
  { value: '90', label: '近 90 天', days: 90 },
  { value: '180', label: '近半年', days: 180 }
]

/** 按天数回溯，返回 { start, end }，end 为今天 23:59:59 */
export function presetRange (days, today = new Date()) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  return { start, end, days }
}

/** 月份字符串 '2026-10' 与范围的交集判断（整月口径） */
export function monthInRange (month, start, end) {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return true
  const first = new Date(y, m - 1, 1)
  const last = new Date(y, m, 0, 23, 59, 59)
  return last >= start && first <= end
}

/** 过滤 [{ month, ... }] 序列，保持原顺序 */
export function monthsInRange (list, range) {
  if (!range || !range.start || !range.end) return list
  return list.filter(x => monthInRange(x.month, range.start, range.end))
}

/** 中文短标签：2026-05-01 ~ 2026-10-21 → 05-01 至 10-21 */
export function rangeLabel (range) {
  if (!range || !range.start || !range.end) return ''
  const f = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${f(range.start)} 至 ${f(range.end)}`
}
