/**
 * 商业服务价目字典（员工端只读引用 PC 后台配置）
 *
 * PC 第 47 批把 `repairPrices.json` 升级成**服务项目字典**，结构变了，这里跟着改：
 *   - `items[]` 多了 `price` / `materialCost` / `laborCost` / `cost` / `enabled` / `sort` / `desc`
 *   - 新增 `publicCategories`（公共区域维修的设施部位，9 项）与 `serviceCategories`（商业服务分类，10 项）
 *   - `laborHourCost` 是师傅小时成本，只用于算 `laborCost`，**不影响对外报价**
 *
 * 最重要的一条口径变化（工单侧）：
 *   工单行自带 `priceCode` / `serviceName` / `serviceCost` **下单时快照**。
 *   页面展示必须读快照，不能用 `category` 反查字典 ——
 *   否则运营把角阀更换从 125 调到 135，所有历史单详情立刻变 135，而实际收款是 125。
 *   这里的字典只用于两件事：① 下单/加项时取价；② 详情页显示"当前价目"做对比。
 */
import repairPrices from '@pc/mock/repairPrices.json'

export const SERVICE_CATS = (repairPrices.serviceCategories || []).map(c => ({ ...c }))
export const PUBLIC_CATS = (repairPrices.publicCategories || []).map(c => ({ ...c }))
export const PRICE_ITEMS = (repairPrices.items || []).map(i => ({ ...i }))
export const ADDON_ITEMS = (repairPrices.addons || []).map(i => ({ ...i }))
export const TRADE_OPTS = repairPrices.tradeOpts || []
export const CHARGE_MODE = repairPrices.chargeMode || {}
export const LABOR_HOUR_COST = repairPrices.laborHourCost || 0

const PROJ = new Map((repairPrices.projects || []).map(p => [p.communityId, p]))
const BY_CATEGORY = new Map(PRICE_ITEMS.map(i => [i.category, i]))
const BY_CODE = new Map([...PRICE_ITEMS, ...ADDON_ITEMS].map(i => [i.code, i]))

/** 项目参数：提成比例、到场上限、弃单上限都在项目里配，不写在代码 */
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

export const priceOfCategory = category => BY_CATEGORY.get(category) || null
export const priceOfCode = code => BY_CODE.get(code) || null

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100

/** 服务项目对外报价 = 材料 + 人工（与后台同一个公式，页面不自己加） */
export const itemPrice = item => (item ? round2((item.material || 0) + (item.labor || 0)) : 0)

/**
 * 提成：**只按人工费计提**。
 * 材料费是成本（数据里材料占收费单一半以上），按总额提成等于把成本分给个人；
 * `laborCost` 是公司成本价，与提成无关，不参与计算。
 */
export function commissionOf({ labor = 0, communityId = 'P01' } = {}) {
  const p = projectParam(communityId)
  const raw = round2((Number(labor) || 0) * (p.commissionRate || 0))
  return Math.max(p.minCommission || 0, raw)
}

/** 增项计价：按价目 code + 数量，材料与人工分别累加 */
export function addonFee(item, qty = 1) {
  if (!item) return { material: 0, labor: 0, total: 0 }
  const n = Math.max(1, Number(qty) || 1)
  const material = round2((item.material || 0) * n)
  const labor = round2((item.labor || 0) * n)
  return { material, labor, total: round2(material + labor) }
}

/**
 * 工单的价目快照（详情页用这个，不要用 category 反查）。
 * 老数据可能没有 priceCode（第 47 批之前的单），此时用字典按 category 兜底并标 `fromDict`。
 */
export function snapshotOf(wo) {
  if (!wo) return null
  const code = wo.priceCode || ''
  const dict = code ? priceOfCode(code) : priceOfCategory(wo.category)
  return {
    code: code || (dict?.code || ''),
    name: wo.serviceName || dict?.name || wo.category || '',
    material: Number(wo.materialFee) || 0,
    labor: Number(wo.laborFee) || 0,
    total: Number(wo.totalFee) || 0,
    cost: Number(wo.serviceCost) || 0,
    /* 字典当前价：与快照不同说明后台调过价，页面上要提示"按下单时价格结算" */
    dictPrice: itemPrice(dict),
    fromDict: !code && !!dict
  }
}
