/**
 * 便民缴费（水 / 电）
 * ------------------------------------------------------------
 * 数据来源（都是现成的，不新造）：
 *   `meters`        397 条 —— 每套房的水表 / 电表（户号 = meterNo），单价在 `feeItems`
 *   `meterReadings` 1191 条 —— 每月抄表读数与用量
 *   `prepayAccounts` 140 条 —— 预存余额（没有账户的房，余额按 0 处理并提示先充值）
 *
 * **燃气本轮不接**：mock 里只有水/电两类表，界面如实标"未开通"，不编一个燃气表出来。
 */
import { feeItems, meterReadings, meters, prepayAccounts } from '@pc/mock'
import { addUtilityPay, app } from '@/store/app'

const PRICE_OF = new Map([
  ['水表', feeItems.find(f => f.name === '水费')?.price ?? 4.2],
  ['电表', feeItems.find(f => f.name === '电费')?.price ?? 0.62]
])
const TYPE_META = {
  水表: { key: 'water', label: '水费', unit: '吨', icon: '水', color: 'var(--biz-primary)' },
  电表: { key: 'power', label: '电费', unit: '度', icon: '电', color: 'var(--biz-warning)' }
}

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/** 本房的水电账户（**只回答"哪个户号、用了多少、应缴多少"**，不承载余额） */
export function accountsOf(houseId) {
  const list = meters.filter(m => m.houseId === houseId)
  return list.map(m => {
    const meta = TYPE_META[m.type] || { key: m.type, label: m.type, unit: m.unit, icon: '表', color: 'var(--biz-text-3)' }
    const readings = meterReadings
      .filter(r => r.meterId === m.meterId)
      .sort((a, b) => String(b.period).localeCompare(String(a.period)))
    const latest = readings[0] || null
    const price = PRICE_OF[m.type] || 0
    const usage = latest?.usage || 0
    return {
      accountId: m.meterId,
      meterNo: m.meterNo,
      houseId,
      type: m.type,
      typeKey: meta.key,
      label: meta.label,
      unit: meta.unit,
      icon: meta.icon,
      color: meta.color,
      price,
      lastReading: latest?.currentReading ?? m.lastReading,
      lastPeriod: latest?.period || '',
      usage,
      due: r2(usage * price),
      readDate: latest?.readDate || m.lastReadDate
    }
  })
}

/**
 * 本房的**预存账户**（一个房一个账户）。
 *
 * 这一条是 2026-11-11 修的一处口径错用：`prepayAccounts` 是「业主预存账户」，
 * 后台 `/b/prepay` 用它抵扣**各项账单**（物业费、水费、电费、车位费都走 `bills`，
 * 1327 条水电账单同样在内），不是"水表余额"。
 *
 * 旧实现把它挂在每个户号上（`accountsOf` 里 `balance`），于是：
 *   ① 水表和电表显示同一个数字；
 *   ② 顶部"本房水费+电费余额"把同一个余额**加了两遍**（¥4809 变成 ¥9618）。
 * 现在余额只有一个来源、只展示一次，户号只留用量与应缴。
 */
export function prepayOf(houseId) {
  const p = prepayAccounts.find(x => x.houseId === houseId) || null
  /* 本地模拟充值记在同一账户上：它是"往账户里存钱"，不是"给某个表充值" */
  const localPaid = app.utilityPays
    .filter(x => x.houseId === houseId && x.kind !== 'deduct')
    .reduce((s, x) => s + (Number(x.amount) || 0), 0)
  /* 本地抵扣也要从余额里扣掉 —— 否则抵扣完再进缴费页，余额又变回原样 */
  const localDeducted = (app.prepayDeducts || [])
    .filter(x => !x.houseId || x.houseId === houseId)
    .reduce((s, x) => s + (Number(x.amount) || 0), 0)
  return {
    accountId: p?.accountId || '',
    hasAccount: !!p || localPaid > 0,
    balance: r2((p?.balance || 0) + localPaid - localDeducted),
    autoDeduct: !!p?.autoDeduct,
    totalRecharge: r2((p?.totalRecharge || 0) + localPaid),
    totalDeduct: r2((p?.totalDeduct || 0) + localDeducted)
  }
}

/** 燃气：数据里没有表具，如实返回 null（页面标"未开通"） */
export const gasAccount = () => ({
  type: '燃气表',
  typeKey: 'gas',
  label: '燃气费',
  unit: 'm³',
  icon: '燃',
  color: 'var(--biz-text-3)',
  status: '未开通',
  note: '本小区燃气由燃气公司直抄直收，物业端暂未接入'
})

/** 本房本期合计（电 + 水），首页与缴费页顶部用 */
export function utilitySummary(houseId) {
  const list = accountsOf(houseId)
  return {
    accounts: list,
    due: r2(list.reduce((s, a) => s + a.due, 0)),
    /* 余额是**账户级**的，不能按户号求和 —— 求出来的就是同一个数加两遍 */
    prepay: prepayOf(houseId),
    count: list.length
  }
}

/**
 * 充值（模拟支付）：往**预存账户**里存钱，不按户号。
 *
 * 数据模型里一个房只有一个预存账户（`prepayAccounts`），按户号充值会让
 * "水表充 100、电表充 100"变成"账户只多 100"，账面与流水对不上。
 */
export function recharge({ houseId, amount, method = '微信支付（模拟）' }) {
  const amt = r2(amount)
  if (!amt || amt <= 0) throw new Error('充值金额需大于 0')
  if (amt > 5000) throw new Error('单笔充值上限 5000 元')
  return addUtilityPay({
    houseId,
    kind: 'recharge',
    label: '预存账户',
    amount: amt,
    method
  })
}

/** 充值 / 缴费记录（本地流水，按时间倒序） */
export function utilityRecords({ houseId = '' } = {}) {
  return app.utilityPays
    .filter(p => !houseId || p.houseId === houseId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

export const QUICK_AMOUNTS = [50, 100, 200, 300, 500]
