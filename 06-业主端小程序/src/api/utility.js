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

/** 本房的水电账户（余额把本地充值也加上） */
export function accountsOf(houseId) {
  const list = meters.filter(m => m.houseId === houseId)
  return list.map(m => {
    const meta = TYPE_META[m.type] || { key: m.type, label: m.type, unit: m.unit, icon: '表', color: 'var(--biz-text-3)' }
    const readings = meterReadings
      .filter(r => r.meterId === m.meterId)
      .sort((a, b) => String(b.period).localeCompare(String(a.period)))
    const latest = readings[0] || null
    const prepay = prepayAccounts.find(p => p.houseId === houseId && p.ownerId === m.ownerId) || null
    const localPaid = app.utilityPays.filter(p => p.houseId === houseId && p.type === m.type).reduce((s, p) => s + p.amount, 0)
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
      balance: r2((prepay?.balance || 0) + localPaid),
      autoDeduct: !!prepay?.autoDeduct,
      readDate: latest?.readDate || m.lastReadDate
    }
  })
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
    balance: r2(list.reduce((s, a) => s + a.balance, 0)),
    count: list.length
  }
}

/** 充值（模拟支付）：记账 + 加余额，不接真通道 */
export function recharge({ houseId, accountId, amount, method = '微信支付（模拟）' }) {
  const acc = accountsOf(houseId).find(a => a.accountId === accountId)
  if (!acc) throw new Error('户号不存在')
  const amt = r2(amount)
  if (!amt || amt <= 0) throw new Error('充值金额需大于 0')
  if (amt > 5000) throw new Error('单笔充值上限 5000 元')
  return addUtilityPay({
    houseId,
    accountId,
    meterNo: acc.meterNo,
    type: acc.type,
    label: acc.label,
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
