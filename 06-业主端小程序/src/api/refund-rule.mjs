/**
 * 活动退费分档（纯函数，不 import 任何东西）
 * ------------------------------------------------------------
 * 与后台 `utils/api.js` 的 `refundRatioOf(activityId, atDay)` **同一套口径**：
 *   · 分档写在活动上（`refundPolicy: [{days, ratio}]`），不写死在代码里 ——
 *     每场活动的成本结构不同（车费、门票、保险的退改规则都不一样）；
 *   · 按「提前天数从高到低」匹配，**命中即止**。
 *
 * 为什么必须降序：分档是「提前 7 天 100% / 3 天 50% / 当天 0%」。
 * 升序排第一个满足 `gap >= days` 的永远是 `days=0` 那一档 —— 提前一个月取消也只退 0%。
 * 后台踩过这个坑（退款一直按最低档算），业主端自助取消必须调同一个函数，
 * 否则同一场活动「业主自己退」和「客服帮退」金额不同，一截图就能对比出来。
 *
 * 放在 06 自己的 `.mjs` 里而不是引后台源码：后台那份挂了权限与当前登录人，
 * 业主端不需要那套；规则本身是纯算术，两边用同一组输入应当得到同一个输出。
 */

/**
 * @param {Array<{days:number, ratio:number}>} policy 分档（天数为「距开始至少提前 N 天」）
 * @param {string} startAt 活动开始时间（`2026-11-15 07:30` 或 `2026-11-15`）
 * @param {string} atDay 退订当天（`YYYY-MM-DD`）
 * @returns {number} 退费比例 0~100；没有分档规则时退全款
 */
export function refundRatioOf(policy, startAt, atDay) {
  const tiers = Array.isArray(policy) ? policy.filter(p => p && Number.isFinite(Number(p.days))) : []
  if (!tiers.length) return 100
  const start = String(startAt || '').slice(0, 10)
  const day = String(atDay || '').slice(0, 10)
  if (!start || !day) return 0
  const gap = Math.floor((new Date(`${start}T00:00:00`) - new Date(`${day}T00:00:00`)) / 86400000)
  const hit = [...tiers]
    .sort((a, b) => Number(b.days) - Number(a.days))
    .find(p => gap >= Number(p.days))
  return hit ? Number(hit.ratio) : 0
}

/** 退款金额 = 单价 × 人数 × 比例；四舍五入到分 */
export function refundAmountOf(fee, people, ratio) {
  const n = Math.round((Number(fee) || 0) * (Number(people) || 1) * (Number(ratio) || 0)) / 100
  return Math.round(n * 100) / 100
}

/** 分档表按天数降序，页面直接渲染（「提前 ≥7 天 退 100%」） */
export const policyRows = policy =>
  (Array.isArray(policy) ? [...policy] : [])
    .sort((a, b) => Number(b.days) - Number(a.days))
    .map(p => ({
      days: Number(p.days),
      ratio: Number(p.ratio),
      label: Number(p.days) > 0 ? `提前 ${p.days} 天及以上` : '开始当天及之后',
      amountText: `${Number(p.ratio)}%`
    }))
