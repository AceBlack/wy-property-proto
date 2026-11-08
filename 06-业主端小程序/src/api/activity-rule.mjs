/**
 * 活动阶段与报名人数（纯函数，业主端与自检共用）
 * ------------------------------------------------------------
 * 五个阶段（交接单 §12.4）：
 *   报名中  → 未到截止日
 *   待成行  → 已截止但**没到成团下限**（不能报名、不能签到，唯一出口是确认流团并全额退款）
 *   已成行  → 已截止且达到下限
 *   已流团  → 后台确认流团（flowedAt），已批量退款
 *   已结束  → 活动结束
 *
 * 顺序很关键：**先判流团再判结束**。后台 `confirmFlow` 会把 status 一并置成「已结束」，
 * 反过来写会把刚流团的活动显示成"正常结束"，退款记录就看不出来了。
 */

/** 已报名人数（含同行人，不含已取消 / 已退款） */
export function enrolledCount(enrolls, activityId) {
  return (enrolls || [])
    .filter(e => e.activityId === activityId && !['已取消', '已退款'].includes(e.status))
    .reduce((s, e) => s + (Number(e.people) || 1), 0)
}

/**
 * @param {object} a 活动（需要 status / enrollDeadline / startAt / minCapacity / flowedAt）
 * @param {number} enrolled 已报名人数
 * @param {string} today `YYYY-MM-DD`
 */
export function phaseOf(a, enrolled, today) {
  if (!a) return ''
  if (a.status === '草稿') return '草稿'
  if (a.flowedAt) return '已流团'
  if (a.status === '已结束') return '已结束'
  const deadline = a.enrollDeadline || String(a.startAt || '').slice(0, 10)
  if (deadline >= today) return '报名中'
  const min = Number(a.minCapacity) || 0
  if (!min) return '已成行'
  return (Number(enrolled) || 0) >= min ? '已成行' : '待成行'
}

/** 能不能报名：只有「报名中」且还有名额 */
export const canEnroll = (phase, enrolled, capacity) =>
  phase === '报名中' && (Number(enrolled) || 0) < (Number(capacity) || 0)
