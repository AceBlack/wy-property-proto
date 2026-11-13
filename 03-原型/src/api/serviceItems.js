/**
 * 商业服务项目（价目字典）适配层 —— 契约见《接口层契约.md》三、F 域 · 商业服务项目
 *
 * 口径提醒（后端实现时别丢）：
 *   - 服务价格 = 材料费 + 人工费、成本价 = 材料成本 + 人工成本，**两个合计由服务端算**，
 *     不接受前端传 —— 否则必出现「列表 125 / 详情 124.99」；
 *   - 停用不删：历史工单还引着它；有在途工单时不给停用（40924）；
 *   - 改价不回溯：已完工工单按下单时的快照结算；
 *   - 字段只增不改：`code / material / labor / unit / minutes` 被业主端与员工端按名索引。
 */
import { IS_MOCK, get, patch, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryServiceItems = ({ category = '', enabled = null, kw = '' } = {}) =>
  IS_MOCK
    ? mock.serviceItemRows({ category, enabled, kw })
    : get('/service-items', { category, enabled, kw })

export const getServiceItem = code => (IS_MOCK ? mock.getServiceItem(code) : get(`/service-items/${code}`))

export const serviceItemSummary = () => (IS_MOCK ? mock.serviceItemSummary() : get('/service-items/summary'))

/* ---------- 写 ---------- */
export const saveServiceItem = (payload, code = '') =>
  IS_MOCK
    ? mock.saveServiceItem(payload, code)
    : (code ? patch(`/service-items/${code}`, payload) : post('/service-items', payload))

export const toggleServiceItem = (code, enabled) =>
  IS_MOCK ? mock.toggleServiceItem(code, enabled) : post(`/service-items/${code}/toggle`, { enabled })

/* ---------- 字典（同步，纯前端口径） ----------
 * 这些是下拉与展示用的静态字典：放在 utils/api 里由 mock 数据派生，
 * 接后端后由 /service-items/categories 下发也不影响页面（页面只认这些函数）。 */
export {
  LABOR_HOUR_COST, WO_REPAIR_TYPES, WO_TYPES,
  canEditServiceItems, canViewServiceItems, getServiceItem as getServiceItemLocal,
  isEmptyWoType, publicCategoryOpts, serviceCategoryRows, serviceItemHistory,
  serviceItemOptions, serviceItemRows, woCategoryOpts, woTypeOpts
} from '@/utils/api'

/* 批 6：三率报表要按「有月度应收的收费项」切，需要收费项列表（纯派生，不走接口） */
export { feeItemRows } from '@/utils/api'
