/**
 * 财务只读看板（移动端）
 *
 * 口径（已确认）：财务角色进移动端，但**只看不碰钱** ——
 * 没有收款、没有日结月结、没有导出，按钮只有"看"。
 * 数字一律取 PC 数据层的 feeSummary / debtRank（与全局费用驾驶舱同一套算法），
 * 页面不再自己 reduce，避免两个端各算一套。
 */
import { debtRank, feeSummary } from '@pc/utils/api'

export function dashboardOf(communityId) {
  const s = feeSummary(communityId)
  const top = debtRank(8, communityId)
  return {
    receivable: s.receivable,
    received: s.received,
    debt: s.debt,
    rate: s.rate,
    overdueAmount: s.overdueAmount,
    overdueCount: s.overdueCount,
    billCount: s.billCount,
    voidCount: s.voidCount,
    topDebt: top.map(x => ({
      ownerId: x.ownerId,
      name: x.name,
      debt: x.debt,
      count: x.count,
      maxOverdue: x.maxOverdue
    }))
  }
}

export const money = n =>
  `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const wan = n => {
  const v = Number(n || 0)
  return v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : `${Math.round(v)}`
}
