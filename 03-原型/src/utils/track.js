// 轻量埋点（2026-10-30）
//
// 原型不是生产，但"哪些动作真的被用过"对下一轮取舍很关键（例如批量减免有没有人点、
// 揭示明文集中在哪些页面）。这里只做三件事：本地环形缓冲、可导出、不阻塞主流程。
// 正式实现换成后端上报（sendBeacon + 采样），调用点不变。

const KEY = 'wy_track_events'
const MAX = 300

const buf = []

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) buf.push(...JSON.parse(raw))
  } catch { /* 配额/隐私模式：只保留内存 */ }
}
load()

const nowText = () => {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(buf.slice(-MAX))) } catch { /* 忽略 */ }
}

/**
 * 记一个动作
 * @param {string} event 事件名，如 export / reveal / batch_reduce
 * @param {object} payload 关键字段（不要放敏感明文，只放 id 与数量）
 */
export function track(event, payload = {}) {
  const row = { at: nowText(), event, ...payload }
  buf.push(row)
  if (buf.length > MAX) buf.splice(0, buf.length - MAX)
  persist()
  return row
}

/** 全部事件（自检页 / 导出用） */
export const trackEvents = () => [...buf]

/** 按事件聚合：次数 + 最近一次时间 */
export function trackSummary() {
  const map = new Map()
  for (const e of buf) {
    const cur = map.get(e.event) || { event: e.event, count: 0, last: '' }
    cur.count++
    cur.last = e.at
    map.set(e.event, cur)
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

export function clearTrack() {
  buf.length = 0
  persist()
}
