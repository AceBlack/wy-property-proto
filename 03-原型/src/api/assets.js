/**
 * 办公资产适配层 —— 契约见 openapi.yaml 的 `assets` / `asset-categories` / `public` 段
 *
 * 口径提醒（后端实现时别丢）：
 *   - `assetNo` 由服务端生成且**永不可改**：标签已经贴在实物上，改号等于让日志、报修、纸标签全部对不上；
 *   - 分类改名**不回写资产**：资产上存 `catName` / `catPath` 快照，历史要能解释"当时叫什么"；
 *   - `status` 是**描述性字段**（闲置 / 在用 / 报废），本期没有单据流，不能拿它推断"资产在哪"；
 *   - **设备图片存在 `files` 里**（`kind: 'image'`），不单独开表：图片是资产的附件，
 *     脱离资产没有意义。最多 6 张、单张 ≤ 5MB、只收 jpeg/png/webp/gif；
 *   - 扫码页走 `/public/assets/{token}`，**不需要登录**，只返回白名单字段，
 *     使用部门可以给，**使用人姓名、原值、供应商、序列号、备注、设备图片一律不给**。
 */
import { IS_MOCK, get, patch, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 分类 ---------- */
export const assetCatTree = (opt = {}) => (IS_MOCK ? mock.assetCatTree(opt) : get('/asset-categories/tree', opt))

export const assetCatFlat = () => (IS_MOCK ? mock.assetCatFlat() : get('/asset-categories'))

export const assetCatOptions = (opt = {}) => (IS_MOCK ? mock.assetCatOpts(opt) : get('/asset-categories/options', opt))

export const getAssetCategory = catId => (IS_MOCK ? mock.getAssetCategory(catId) : get(`/asset-categories/${catId}`))

export const saveAssetCategory = (payload, catId = '') =>
  (IS_MOCK
    ? mock.saveAssetCategory({ ...payload, catId })
    : (catId ? patch(`/asset-categories/${catId}`, payload) : post('/asset-categories', payload)))

export const toggleAssetCategory = catId =>
  (IS_MOCK ? mock.toggleAssetCategory(catId) : post(`/asset-categories/${catId}/toggle`))

/* 删除走 POST /remove 而不是 DELETE：DELETE 没有请求体，「为什么删」这个理由无处可放 */
export const removeAssetCategory = catId =>
  (IS_MOCK ? mock.removeAssetCategory(catId) : post(`/asset-categories/${catId}/remove`))

export { ASSET_CAT_MAX_DEPTH, canEditAssetCats, canViewAssetCats } from '@/utils/api'

/* ---------- 资产 ---------- */
export const queryAssets = ({ pageNo = 1, size = 15, catId = '', status = '', orgId = '', kw = '' } = {}) =>
  (IS_MOCK ? mock.assetRows({ pageNo, size, catId, status, orgId, kw }) : get('/assets', { pageNo, size, catId, status, orgId, kw }))

export const getAsset = assetId => (IS_MOCK ? mock.getAsset(assetId) : get(`/assets/${assetId}`))

export const assetSummary = () => (IS_MOCK ? mock.assetSummary() : get('/assets/summary'))

export const assetByCategory = () => (IS_MOCK ? mock.assetByCategory() : get('/assets/by-category'))

export const saveAsset = (payload, assetId = '') =>
  (IS_MOCK
    ? mock.saveAsset({ ...payload, assetId })
    : (assetId ? patch(`/assets/${assetId}`, payload) : post('/assets', payload)))

/* ---------- 二维码 / 标签 ---------- */
export const assetLabelRows = ids => (IS_MOCK ? mock.assetLabelRows(ids) : post('/assets/labels', { assetIds: ids }))

/** 扫码页唯一入口：免登录，只回公开字段 */
export const assetPublicView = token =>
  (IS_MOCK ? mock.assetPublicView(token) : get(`/public/assets/${token}`, null, { auth: false }))

export { ASSET_PUBLIC_FIELDS, canEditAssets, canViewAssets, ASSET_STATUS } from '@/utils/api'

/* 图片限额是「页面提示 + 后端校验」两处都要用的数字，从这里出，别在页面里再写一遍 */
export { ASSET_FILE_MAX, ASSET_FILE_MAX_SIZE, ASSET_FILE_MIME } from '@/utils/api'
