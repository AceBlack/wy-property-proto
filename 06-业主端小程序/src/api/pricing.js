/**
 * 维修价目 —— 只读引用 PC 后台「收费项目 → 维修服务价目」。
 *
 * 为什么不在业主端硬编码：同一份价目要供三处使用（业主端下单页 / 员工端现场增项 / 提成核算），
 * 各写一份必然对不上。唯一源：`03-原型/src/mock/repairPrices.json`。
 *
 * 交接单 §8.3 的验收项「金额三处一致」就靠它：下单页、工单详情合计、支付金额
 * 全部走本文件的 `orderFee()` / `addonFee()`，页面里不许再出现 `material + labor` 这种自己算的写法。
 */
import repairPrices from '@pc/mock/repairPrices.json'

export const PRICE_ITEMS = repairPrices.items || []
export const ADDON_ITEMS = repairPrices.addons || []
export const TRADE_OPTS = repairPrices.tradeOpts || []
export const CHARGE_MODE = repairPrices.chargeMode || {}

const PROJ = new Map((repairPrices.projects || []).map(p => [p.communityId, p]))
const BY_CODE = new Map([...PRICE_ITEMS, ...ADDON_ITEMS].map(i => [i.code, i]))
const BY_CATEGORY = new Map(PRICE_ITEMS.map(i => [i.category, i]))

export const priceOfCode = code => BY_CODE.get(code) || null
export const priceOfCategory = c => BY_CATEGORY.get(c) || null

export function projectParam(communityId) {
  return (
    PROJ.get(communityId) || {
      communityId,
      commissionRate: 0.3,
      minCommission: 8,
      grabArriveMinutes: 20,
      abandonLimit: 3
    }
  )
}

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100

/**
 * 下单计价：材料 + 人工，数量只对"次/处/盏/台"这类可数单位有意义。
 * `prepayWhenOrder=true`（项目配置）表示下单即预付这一笔，所以业主在提交前就必须看到总价。
 */
export function orderFee(item, qty = 1) {
  if (!item) return { material: 0, labor: 0, total: 0, minutes: 0 }
  const n = Math.max(1, Number(qty) || 1)
  const material = round2((item.material || 0) * n)
  const labor = round2((item.labor || 0) * n)
  return {
    material,
    labor,
    total: round2(material + labor),
    minutes: (item.minutes || 0) * n
  }
}

/** 增项计价：与 orderFee 同一套算法（增项也是价目表里的一项） */
export const addonFee = (item, qty = 1) => orderFee(item, qty)

/** 按品类分组，下单页按"维修类型"分组展示；同组内保留价目表原顺序 */
export function priceGroups() {
  const map = new Map()
  for (const it of PRICE_ITEMS) {
    if (!map.has(it.category)) map.set(it.category, [])
    map.get(it.category).push(it)
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }))
}
