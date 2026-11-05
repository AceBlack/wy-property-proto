/**
 * 生活（本地生活服务）· 本轮为**占位**
 * ------------------------------------------------------------
 * 为什么占位而不是空着：商业后台还没开发，这里先按设计稿把"分类 + 商家 + 服务卡"的骨架立起来，
 * 数据来自 `lifeServices` / `merchants`（12 + 6 条），**只能看不能下单**：
 * 卡片上标「即将开放」，点进去是服务详情 + "敬请期待"，不接支付、不产生订单。
 *
 * 真正接入时要补的是：商户资质、商品/库存、下单与支付分账、售后与退款、结算对账 —— 那是一个独立项目。
 */
import { lifeServices, merchants } from '@pc/mock'

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

export const LIFE_CATS = [
  { key: '家政保洁', icon: '+', label: '家政保洁' },
  { key: '家电清洗', icon: '◎', label: '家电清洗' },
  { key: '维修安装', icon: '⚒', label: '维修安装' },
  { key: '搬家服务', icon: '⇄', label: '搬家服务' },
  { key: '绿植养护', icon: '❀', label: '绿植养护' },
  { key: '消杀服务', icon: '✚', label: '消杀服务' },
  { key: '洗衣服务', icon: '≡', label: '洗衣洗护' },
  { key: '社区团购', icon: '◫', label: '社区团购', soon: true }
]

export const merchantOf = id => merchants.find(m => m.merchantId === id) || null

export function serviceList({ category = '' } = {}) {
  return lifeServices
    .filter(s => !category || s.category === category)
    .map(s => ({ ...s, merchant: merchantOf(s.merchantId) }))
    .sort((a, b) => (a.status === b.status ? b.monthlySales - a.monthlySales : a.status === '可预约' ? -1 : 1))
}

export const serviceOf = id => serviceList().find(s => s.serviceId === id) || null

export const merchantList = () => merchants.slice()

/** 生活首页聚合：每个分类挑一条代表服务 + 商家列表 */
export function lifeHome() {
  const all = serviceList()
  const featured = LIFE_CATS.map(c => all.find(s => s.category === c.key)).filter(Boolean)
  return {
    featured,
    hot: all.slice(0, 4),
    merchants,
    total: all.length,
    open: all.filter(s => s.status === '可预约').length
  }
}

export { r2 }
