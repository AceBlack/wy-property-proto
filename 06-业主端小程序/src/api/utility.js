/**
 * 便民缴费（水 / 电）—— 抄表出账 → 待缴账单 → 缴费
 * ------------------------------------------------------------
 * 2026-11-13 改口径：**预存账户下线**。原来是「先存钱、再扣费」，
 * 业主交的钱进"余额"，而余额在财务上是负债不是收入 —— 客户一句话就把这条路否了：
 * 「预存的钱算公司收入不合理」。
 *
 * 现在只有一条链：**物业抄表 → 出账单（`bills` 里 FI05 / FI06）→ 业主缴**。
 * 钱和账期一一对应，交多少、交哪一期，账单上写得清清楚楚，没有中间物。
 *
 * 三种模式（由**项目**配置，不是由有没有账单决定）：
 *   meter 抄表出账 → 本期用量 / 单价 / 应缴 + 去缴费
 *   card  插卡买量 → 到物业服务中心买量后插表，系统不记余额（没有金额、没有按钮）
 *   none  业主自缴 → 国网 / 水司直接收（物业一分钱都不碰）
 *
 * **金额以账单为准，不用 用量 × 单价 现算**：账单里可能有滞纳金、阶梯价；
 * 端上自己乘一遍，就会和账单对不上（数据里就有这种单）。
 * 用量与单价只用来解释"这个数怎么来的"。
 */
import { bills, communityUtility, houses, meters } from '@pc/mock'
import { IS_API } from './client'
import { fetchUtility } from './remote'

/** 两块表：科目与表类型的对应关系在后台也是这一套（`feeItemCategoryMap.meterType`） */
const UTIL = [
  { type: '水表', itemId: 'FI05', itemName: '水费', key: 'water', icon: '水', color: 'var(--biz-primary)' },
  { type: '电表', itemId: 'FI06', itemName: '电费', key: 'elec', icon: '电', color: 'var(--biz-warning)' }
]
const MODE_LABEL = {
  meter: '抄表出账',
  card: '插卡表 · 到物业服务中心买量',
  none: '由自来水公司 / 国家电网直接收取'
}
/** 电说"国家电网"、水说"自来水公司" —— 一句话挂在两种表上，总有一种是错的 */
const modeLabelOf = (mode, type) => {
  if (mode === 'none') return type === '电表' ? '由国家电网直接收取' : '由自来水公司直接收取'
  return MODE_LABEL[mode]
}
const DEBT = ['未缴', '部分缴', '逾期']
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/* 燃气：数据里没有表具，如实标未开通，不编一个燃气表出来 */
export const gasAccount = () => ({
  key: 'gas',
  label: '燃气',
  icon: '气',
  color: 'var(--biz-text-3)',
  status: '未开通',
  note: '本小区燃气由燃气公司直抄直收，物业端暂未接入'
})

/* ============================ 接口模式：进页面拉一次，不缓存 ============================ */

const remote = { data: null }

/** 没拉过 ≠ 没有。页面用这个区分"还没回来"与"真的没有待缴" */
export const utilityLoaded = () => !IS_API || remote.data !== null

export async function loadUtility(houseId) {
  if (!IS_API) return
  remote.data = await fetchUtility(houseId)
}

/* ============================ 本地模式：同一套规则从 fixtures 现算 ============================ */

const modeOf = (communityId, key) =>
  (communityUtility.find(u => u.communityId === communityId) || {})[key] || 'none'

/** 账单里的 `unit` 是「元/吨」，端上要的是计价单位「吨」 */
const unitOf = u => String(u || '').replace(/^元\//, '')

function localUtility(houseId) {
  /* 项目从**房屋**取，不从表具取：插卡表（card）压根没有远传表记录，
     从表具反推会拿到空串、模式落 none —— P02 的水就会被当成"业主自缴" */
  const communityId = (houses.find(h => h.houseId === houseId) || {}).communityId || ''
  const rows = UTIL.map(t => {
    const meter = meters.find(m => m.houseId === houseId && m.type === t.type) || null
    const mode = modeOf(communityId, t.key)
    const debt = bills
      .filter(b => b.houseId === houseId && b.itemId === t.itemId && DEBT.includes(b.status) && (b.unpaid || 0) > 0)
      .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    /* 只有抄表出账才把账单摆出来；其它两种模式下这些账单不是物业能收的钱 */
    const first = mode === 'meter' ? debt[0] || null : null
    const open = mode === 'meter' ? debt : []
    const row = {
      meterType: t.type,
      meterNo: meter ? meter.meterNo : '',
      itemId: t.itemId,
      itemName: t.itemName,
      mode,
      modeLabel: modeLabelOf(mode, t.type),
      unit: first ? unitOf(first.unit) : (meter ? meter.unit : ''),
      unpaidCount: open.length,
      unpaidTotal: r2(open.reduce((s, b) => s + (b.unpaid || 0), 0)),
      canPay: mode === 'meter' && !!first
    }
    if (first) {
      row.price = r2(first.price)
      row.usage = r2(first.quantity)
      row.amount = r2(first.unpaid)
      row.period = first.period
      row.billId = first.billId
      row.billStatus = first.status
      if (first.lastReading != null) row.prevReading = Number(first.lastReading)
      if (first.meterReading != null) row.currReading = Number(first.meterReading)
    }
    return row
  })
  const payable = rows.filter(r => r.canPay)
  return {
    houseId,
    communityId,
    dueTotal: r2(payable.reduce((s, r) => s + (r.amount || 0), 0)),
    payableCount: payable.length,
    accounts: rows
  }
}

/* ============================ 对外 ============================ */

/** 本房水电。接口模式只认服务端；本地模式按同一套规则现算 */
export function utilityOf(houseId) {
  const base = IS_API ? remote.data : localUtility(houseId)
  if (!base) return { houseId, dueTotal: 0, payableCount: 0, accounts: [] }
  return {
    ...base,
    accounts: (base.accounts || []).map(r => {
      const meta = UTIL.find(t => t.itemId === r.itemId) || {}
      return {
        ...r,
        key: meta.key || r.itemId,
        label: r.itemName,
        icon: meta.icon || '表',
        color: meta.color || 'var(--biz-text-3)',
        /**
         * 读数的一句话说明：业主质疑"这个月怎么用了 244 度"时，这行就是答案。
         *
         * 但只在**读数自洽**时才显示：`本期读数 − 上期读数` 应当约等于本期用量。
         * 样例数据里有一批账单把"本期读数"直接存成了 `quantity`，
         * 于是页面上会出现「用量 30.7 · 读数 7.4 → 30.7」这种自相矛盾的两行。
         * 与其硬着头皮解释，不如不显示 —— 读数是用来佐证的，不能自己先打起来。
         */
        readingText: r.prevReading != null && r.currReading != null
          && Math.abs((r.currReading - r.prevReading) - (r.usage || 0)) <= 0.5
          ? `${r.prevReading} → ${r.currReading}`
          : ''
      }
    })
  }
}

/** 顶部那句：有几块表待缴 */
export function payableText(u) {
  const names = (u.accounts || []).filter(a => a.canPay).map(a => a.label)
  if (!names.length) return '本期无待缴'
  return `${names.join(' + ')} ${u.payableCount} 笔待缴`
}
