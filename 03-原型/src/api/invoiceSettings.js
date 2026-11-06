/**
 * 开票设置适配层 —— 契约见 openapi.yaml 的 `invoice-settings` 段
 *
 * 三块内容，对应三个独立资源：
 *   `invoice-profiles`  开票信息（抬头档案）
 *   `invoice-items`     费用项目（票据上的「项目名称」词条）
 *   `invoice-template`  票据模板（单例，1 套通用版式 + 参数）
 *
 * 口径提醒（后端实现时别丢）：
 *   - 档案存的是**抬头快照**。业主改名不回写已存的抬头 —— 票据一旦开出，
 *     抬头就不能变（税务要求），改了档案会让"当时开的什么"说不清。
 *     要跟着改，走 `POST /invoice-profiles/{id}/refresh`（显式覆盖，留痕）；
 *   - **带入 ≠ 建档**：`/from-owner`、`/from-tenant` 只返回草稿，不落库。
 *     682 个业主如果都自动建档，真正的常用抬头会被淹没；
 *   - `taxNo` 企业必填（15–20 位），个人可空 —— 个人开票凭姓名即可，
 *     身份证号不当税号用；
 *   - **押金 / 赔偿款税率 0**：前者是代收不是收入，后者不征增值税；
 *   - 模板是**单例**（只有一套）：多套的代价是每张票据都要选版式，
 *     而现在只有一种纸（241×140 连续纸）；
 *   - 页面上的金额要同时给**小写与大写**，`rmbUpper()` 是唯一实现。
 */
import { IS_MOCK, get, patch, post, put } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 费用项目 ---------- */
export const invoiceItemRows = (opt = {}) => (IS_MOCK ? mock.invoiceItemRows(opt) : get('/invoice-items', opt))

export const invoiceItemOpts = () => (IS_MOCK ? mock.invoiceItemOpts() : get('/invoice-items/options'))

/** 开票时项目名的全部候选：收费科目 + 费用项目（两个场景共用一张下拉） */
export const invoiceItemNameOpts = () => (IS_MOCK ? mock.invoiceItemNameOpts() : get('/invoice-items/name-options'))

export const saveInvoiceItem = (payload, itemId = '') =>
  (IS_MOCK
    ? mock.saveInvoiceItem({ ...payload, itemId })
    : (itemId ? patch(`/invoice-items/${itemId}`, payload) : post('/invoice-items', payload)))

export const toggleInvoiceItem = (itemId, enabled) =>
  (IS_MOCK ? mock.toggleInvoiceItem(itemId, enabled) : post(`/invoice-items/${itemId}/toggle`, { enabled }))

/* ---------- 开票信息 ---------- */

/** 带入用的人选（业主 682 人只回前 50，关键字可缩） */
export const invoiceOwnerOpts = (kw = '') => (IS_MOCK ? mock.invoiceOwnerOpts(kw) : get('/invoice-profiles/owner-options', { kw }))

export const invoiceTenantOpts = (kw = '') => (IS_MOCK ? mock.invoiceTenantOpts(kw) : get('/invoice-profiles/tenant-options', { kw }))

export const queryInvoiceProfiles = (opt = {}) =>
  (IS_MOCK ? mock.invoiceProfileRows(opt) : get('/invoice-profiles', opt))

export const getInvoiceProfile = profileId =>
  (IS_MOCK ? mock.invoiceProfileOf(profileId) : get(`/invoice-profiles/${profileId}`))

export const invoiceProfileStats = () =>
  (IS_MOCK ? mock.invoiceProfileStats() : get('/invoice-profiles/stats'))

/** 带入：只回草稿，不落库 */
export const invoiceProfileFromOwner = ownerId =>
  (IS_MOCK ? mock.invoiceProfileFromOwner(ownerId) : get(`/invoice-profiles/from-owner/${ownerId}`))

export const invoiceProfileFromTenant = tenantId =>
  (IS_MOCK ? mock.invoiceProfileFromTenant(tenantId) : get(`/invoice-profiles/from-tenant/${tenantId}`))

/** 某房屋的可选抬头：房主在前、在住租户在后（「默认开给房主」就是靠这个顺序） */
export const invoiceProfilesOfHouse = houseId =>
  (IS_MOCK ? mock.invoiceProfilesOfHouse(houseId) : get(`/invoice-profiles/of-house/${houseId}`))

export const saveInvoiceProfile = (payload, profileId = '') =>
  (IS_MOCK
    ? mock.saveInvoiceProfile({ ...payload, profileId })
    : (profileId ? patch(`/invoice-profiles/${profileId}`, payload) : post('/invoice-profiles', payload)))

export const setDefaultInvoiceProfile = profileId =>
  (IS_MOCK ? mock.setDefaultInvoiceProfile(profileId) : post(`/invoice-profiles/${profileId}/default`))

export const toggleInvoiceProfile = (profileId, enabled) =>
  (IS_MOCK ? mock.toggleInvoiceProfile(profileId, enabled) : post(`/invoice-profiles/${profileId}/toggle`, { enabled }))

export const refreshProfileFromSource = profileId =>
  (IS_MOCK ? mock.refreshProfileFromSource(profileId) : post(`/invoice-profiles/${profileId}/refresh`))

/* ---------- 票据模板（单例） ---------- */
export const invoiceTplGet = () => (IS_MOCK ? mock.invoiceTplGet() : get('/invoice-template'))

export const saveInvoiceTpl = body =>
  (IS_MOCK ? mock.saveInvoiceTpl(body) : put('/invoice-template', body))

export const resetInvoiceTpl = () =>
  (IS_MOCK ? mock.resetInvoiceTpl() : post('/invoice-template/reset'))

export const invoiceTplCheck = (body = {}) =>
  (IS_MOCK ? mock.invoiceTplCheck(body) : post('/invoice-template/check', body))

/* 金额大写：票据与预览共用同一实现，别在页面里再写一份 */
export { rmbUpper } from '@/utils/api'
export {
  canEditInvoiceSet, INVOICE_SET_PERM, INVOICE_TITLE_TYPES, INVOICE_SOURCES,
  INVOICE_FONT_FAMILIES, INVOICE_PAPER_PRESETS, INVOICE_TPL_DEFAULT
} from '@/utils/api'
