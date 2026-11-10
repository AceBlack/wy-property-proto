/**
 * 业主域适配层（契约见《接口层契约.md》三、A 域）
 * mock 模式复用 `@/utils/api` 的内存实现，http 模式走 REST。
 * 页面 import 本文件即可，不需要关心当前是哪种模式。
 */
import { IS_MOCK, get, patch, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryOwners = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryOwners({ pageNo, size, filters })
    : get('/owners', { pageNo, size, ...filters })

export const getOwnerDetail = ownerId =>
  IS_MOCK ? mock.getOwnerDetail(ownerId) : get(`/owners/${ownerId}`)

export const ownerProfile = ownerId =>
  IS_MOCK ? mock.ownerProfile(ownerId) : get(`/owners/${ownerId}/profile`)

export const ownerOptions = kw =>
  IS_MOCK ? mock.ownerOptions(kw) : get('/owners/options', { kw })

export const housesOfOwner = ownerId =>
  IS_MOCK ? mock.housesOfOwner(ownerId) : get(`/owners/${ownerId}/houses`)

/* ---------- 写 ---------- */
/** 内联改一个字段；ver 参与乐观锁，冲突时后端返 409 */
export const updateOwnerField = (ownerId, field, value, ver) =>
  IS_MOCK
    ? mock.updateOwnerField(ownerId, field, value, ver)
    : patch(`/owners/${ownerId}`, { field, value, ver })

export const checkMergeOwners = ids =>
  IS_MOCK ? mock.checkMergeOwners(ids) : post('/owners/merge/check', { ownerIds: ids })

export const mergeOwners = (ids, mainId) =>
  IS_MOCK ? mock.mergeOwners(ids, mainId) : post('/owners/merge', { ownerIds: ids, mainOwnerId: mainId })

export const splitOwnerHouses = (ownerId, houseIds) =>
  IS_MOCK
    ? mock.splitOwnerHouses(ownerId, houseIds)
    : post(`/owners/${ownerId}/split`, { houseIds })

/* ---------- 字典 ---------- */
export const ownerVirtualNodes = () => mock.ownerVirtualNodes()

/* ---------- 人脸核验（H4 / H5 · 2026-11-10） ----------
 * 契约还没落（批次 83 之后才接口化），现在**只有 mock 实现**。
 * 这里不写 http 分支：写了就会有人以为接口已经通了。
 */
export const canAuditFaces = () => mock.canAuditFaces()
export const queryFaceRequests = (params) => mock.queryFaceRequests(params)
export const faceRequestStats = () => mock.faceRequestStats()
export const auditFaceRequest = (reqId, opt) => mock.auditFaceRequest(reqId, opt)
export const submitFaceRequest = (rec) => mock.submitFaceRequest(rec)
export const faceRequestsOfOwner = (ownerId) => mock.faceRequestsOfOwner(ownerId)
export const facePendingOfOwner = (ownerId) => mock.facePendingOfOwner(ownerId)
export const facePendingOfTenant = (tenantId) => mock.facePendingOfTenant(tenantId)
