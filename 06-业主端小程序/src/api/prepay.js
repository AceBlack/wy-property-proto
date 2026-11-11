/**
 * 预存账户（2026-11-11）
 * ------------------------------------------------------------
 * 余额是**按房屋**的预收账款：业主提前交给物业的钱，只能抵本房账单
 * （物业费 / 水费 / 电费 / 车位费）。多房业主有两个账户，这里**不做汇总** ——
 * 汇总等于把 A 房的钱算到 B 房头上。
 *
 * 三种状态的来龙去脉：
 *   - 接口模式：`/mp/prepay` 给什么就是什么（服务端算好余额、待抵账单、流水）；
 *   - 本地模式：余额 = `prepayAccounts` 里的种子 + 本地充值（`app.utilityPays`）
 *     − 本地抵扣（`app.prepayDeducts`），流水同样由这两份拼出来。
 *
 * 与「商业平台账户」严格分开：那是 `/mp/commerce/account`，只读镜像、不能抵账单。
 */
import { bills } from '@pc/mock'
import { activeBinding, app, markBillDeducted, persist } from '@/store/app'
import { IS_API } from './client'
import { fetchPrepay, postPrepayDeduct, postPrepayRecharge } from './remote'
import { prepayOf, recharge as utilityRecharge } from './utility'
import { DEMO, stamp } from '@/config/demo'
import { money } from '@/utils/format'

const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const DEBT = ['未缴', '部分缴', '逾期']
const isDebt = b => DEBT.includes(b.status) && (Number(b.unpaid) || 0) > 0

const remote = { data: null }
export const prepayLoaded = () => !IS_API || remote.data !== null

/** 当前房屋：预存账户挂在房上，切房就是换账户 */
export const prepayHouseId = () => activeBinding.value?.houseId || ''

/** 拉一次（接口模式）；本地模式什么都不做 */
export async function loadPrepay(houseId) {
  if (!IS_API) return
  remote.data = await fetchPrepay(houseId || prepayHouseId())
}

const emptyAccount = () => ({
  accountId: '',
  houseId: prepayHouseId(),
  houseName: '',
  balance: 0,
  totalRecharge: 0,
  totalDeduct: 0,
  status: '未开通',
  autoDeduct: false,
  lastRechargeDate: '',
  lastDeductDate: ''
})

/* ============================ 一、账户 ============================ */

export function prepayAccount() {
  if (IS_API) return remote.data?.account || emptyAccount()
  const hid = prepayHouseId()
  const base = prepayOf(hid)
  const house = activeBinding.value || {}
  return {
    accountId: base.accountId,
    houseId: hid,
    houseName: house.fullName || '',
    balance: base.balance,
    totalRecharge: base.totalRecharge,
    totalDeduct: base.totalDeduct,
    /* 没有种子账户、也没充过，就是"未开通"；充过一次即视为已开通 */
    status: base.hasAccount || base.totalRecharge > 0 ? '正常' : '未开通',
    autoDeduct: base.autoDeduct,
    lastRechargeDate: '',
    lastDeductDate: ''
  }
}

export const prepayBalance = () => prepayAccount().balance

/* ============================ 二、待抵账单 ============================ */

export function prepayBills() {
  if (IS_API) return remote.data?.bills || { count: 0, unpaid: 0, rows: [] }
  const hid = prepayHouseId()
  const rows = bills
    .filter(b => b.houseId === hid && isDebt(b))
    .sort((a, b) => String(a.period).localeCompare(String(b.period)))
    .map(b => ({
      billId: b.billId,
      period: b.period,
      itemName: b.itemName || '物业费',
      unpaid: r2(b.unpaid),
      status: b.status
    }))
  return {
    count: rows.length,
    unpaid: r2(rows.reduce((s, b) => s + b.unpaid, 0)),
    rows
  }
}

/** 一句话说清"够不够抵" —— 页面上要能直接回答，而不是让业主自己做减法 */
export function deductHint() {
  const acc = prepayAccount()
  const b = prepayBills()
  if (acc.status === '未开通') return { kind: 'none', text: '还没有预存账户，先充一笔就开通了' }
  if (!b.count) return { kind: 'ok', text: '本房没有待缴账单' }
  if (acc.balance <= 0) return { kind: 'warn', text: `余额不足，待缴 ${money(b.unpaid)}` }
  if (acc.balance >= b.unpaid) return { kind: 'ok', text: `余额足够结清全部 ${money(b.unpaid)}` }
  return { kind: 'part', text: `余额可抵 ${money(acc.balance)}，还剩 ${money(b.unpaid - acc.balance)}` }
}

/* ============================ 三、流水 ============================ */

/**
 * 流水是**余额的唯一解释**：最后一条的 `balanceAfter` 必须等于账户余额。
 * 接口模式直接用服务端给的；本地模式把「充值」与「抵扣」两份拼起来。
 */
export function prepayFlows() {
  if (IS_API) return remote.data?.flows || []
  const hid = prepayHouseId()
  const recharges = app.utilityPays
    .filter(p => p.houseId === hid && p.kind !== 'deduct')
    .map((p, i) => ({
      logId: p.payId || `UT${i}`,
      type: '充值',
      amount: r2(p.amount),
      balanceAfter: null, // 本地这份没有逐笔余额，页面按"末条优先"展示金额即可
      method: p.method || '微信支付（模拟）',
      operator: app.session?.name || '本人',
      at: p.at,
      remark: `充值 ${money(p.amount)}`
    }))
  const deducts = (app.prepayDeducts || []).filter(x => !x.houseId || x.houseId === hid)
  return [...deducts, ...recharges].sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

/* ============================ 四、充值 / 抵扣 ============================ */

/**
 * 充值：**首次充值即开户**。
 * `campaignCode` 是营销位（本期不生效）：服务端会收下但忽略，返回的 `gift` 恒为 null。
 * 本地模式没有活动规则，直接不传。
 */
export async function rechargePrepay(amount, { method = '微信支付', campaignCode = '' } = {}) {
  const amt = r2(amount)
  if (!(amt > 0)) throw new Error('充值金额需大于 0')
  if (amt > 50000) throw new Error('单笔充值上限 50000 元')

  if (IS_API) {
    const r = await postPrepayRecharge({
      houseId: prepayHouseId(),
      amount: amt,
      method,
      ...(campaignCode ? { campaignCode } : {})
    })
    await loadPrepay()
    return r
  }

  const rec = utilityRecharge({ houseId: prepayHouseId(), amount: amt, method: `${method}（模拟）` })
  return { account: prepayAccount(), flow: null, gift: null, local: rec }
}

/**
 * 抵扣：按账期升序冲抵，余额用完为止。
 *
 * `billIds` 不传 = 尽量抵（允许最后一张只抵一部分）；
 * 传了 = 只抵这几张，余额必须够，否则报错 —— 与接口同一套规则。
 */
export async function deductPrepay(billIds) {
  if (IS_API) {
    const r = await postPrepayDeduct({
      houseId: prepayHouseId(),
      ...(Array.isArray(billIds) && billIds.length ? { billIds } : {})
    })
    await loadPrepay()
    return r
  }

  const hid = prepayHouseId()
  const acc = prepayAccount()
  if (acc.status === '未开通') throw new Error('还没有预存账户，先充值开通')
  const all = prepayBills()
  if (!all.count) throw new Error('本房没有待缴账单')

  const ids = Array.isArray(billIds) && billIds.length ? billIds : null
  const targets = ids ? all.rows.filter(b => ids.includes(b.billId)) : all.rows
  if (!targets.length) throw new Error('没有可抵扣的账单')

  const need = r2(targets.reduce((s, b) => s + b.unpaid, 0))
  if (acc.balance <= 0) throw new Error('预存余额为 0，先充值')
  if (ids && acc.balance < need - 0.009) {
    throw new Error(`预存余额不足：需要 ${money(need)}，可用 ${money(acc.balance)}`)
  }

  let rest = acc.balance
  const rows = []
  const detail = []
  for (const t of targets) {
    if (rest <= 0.009) break
    const use = r2(Math.min(rest, t.unpaid))
    if (use <= 0) continue
    rest = r2(rest - use)
    rows.push({ billId: t.billId, period: t.period, itemName: t.itemName, amount: use })
    detail.push({ billId: t.billId, period: t.period, itemName: t.itemName, amount: use })
  }
  const deducted = r2(rows.reduce((s, r) => s + r.amount, 0))
  if (!deducted) throw new Error('没有可抵扣的金额')

  /* 一条抵扣流水 + 逐张改账单（允许部分缴） */
  const flow = {
    logId: `PD${String((app.prepayDeducts || []).length + 1).padStart(4, '0')}`,
    houseId: hid,
    type: '抵扣',
    amount: deducted,
    balanceAfter: r2(acc.balance - deducted),
    method: '余额抵扣',
    operator: app.session?.name || '本人',
    at: stamp(),
    remark: `抵扣 ${rows.map(r => r.period).join(' / ')} 账单`,
    bills: detail
  }
  /* 逐张写回账单（允许部分缴），最后再落一条流水 */
  for (const r of rows) markBillDeducted(r.billId, r.amount, null)
  app.prepayDeducts.unshift(flow)
  persist()

  return {
    account: prepayAccount(),
    deducted,
    rows: rows.map(r => ({
      ...r,
      afterStatus: prepayBills().rows.find(b => b.billId === r.billId)?.status || '已缴',
      afterUnpaid: prepayBills().rows.find(b => b.billId === r.billId)?.unpaid || 0
    })),
    flow
  }
}

export const RECHARGE_AMOUNTS = [100, 300, 500, 1000, 2000]
export const PREPAY_TODAY = DEMO.today
