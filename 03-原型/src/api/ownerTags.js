/**
 * 业主标签适配层（契约见 04-契约/openapi.yaml › owners 域）
 *
 * 两件事两个权限位，别混：
 *   · 读字典 `GET /owner-tags` —— 只要 `a.owners.view`（楼管打标签的前置）
 *   · 维护字典 `POST/PATCH /owner-tags` —— 要 `e.ownerTags.edit`（楼管没有）
 *   · 打/去标签 `POST|DELETE /owners/{id}/tags` —— 要 `a.owners.edit`（楼管有，受范围约束）
 */
import { IS_MOCK, del, get, patch, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 字典 ---------- */
/** enabled 传 'all' 才是全部；不传只回启用中的（选择弹层用这个） */
export const queryOwnerTags = ({ enabled = '', category = '', kw = '' } = {}) => {
  /* 契约里 enabled 是三态：不传=只看启用 / 'all'=全部 / 'true'|'false'=精确 */
  const flag = enabled === 'all' ? '' : enabled === 'false' ? false : enabled === 'true' ? true : true
  return IS_MOCK
    ? Promise.resolve({ rows: mock.ownerTagRows({ category, kw, enabled: flag }) })
    : get('/owner-tags', { enabled, category, kw })
}

export const getOwnerTag = tagId =>
  IS_MOCK ? Promise.resolve(mock.ownerTagOf(tagId)) : get(`/owner-tags/${tagId}`)

export const ownerTagStats = () =>
  IS_MOCK ? Promise.resolve(mock.ownerTagStats()) : get('/owner-tags/stats')

/* ---------- 字典维护（e.ownerTags.edit） ---------- */
export const createOwnerTag = payload =>
  IS_MOCK ? Promise.resolve(mock.createOwnerTag(payload)) : post('/owner-tags', payload)

export const updateOwnerTag = (tagId, patchBody) =>
  IS_MOCK
    ? Promise.resolve(mock.updateOwnerTag(tagId, patchBody)).then(r => r.tag)
    : patch(`/owner-tags/${tagId}`, patchBody)

/* ---------- 打标签（a.owners.edit） ---------- */
/** 返回该业主变更后的**完整** tagIds：页面整体替换，不自己做加减 */
export const addOwnerTag = (ownerId, tagId) =>
  IS_MOCK
    ? Promise.resolve(mock.addOwnerTag(ownerId, tagId)).then(r => ({ ownerId: r.ownerId, tagIds: r.tagIds, tag: r.tag }))
    : post(`/owners/${ownerId}/tags`, { tagId })

export const removeOwnerTag = (ownerId, tagId) =>
  IS_MOCK
    ? Promise.resolve(mock.removeOwnerTag(ownerId, tagId))
    : del(`/owners/${ownerId}/tags/${tagId}`)

/* ---------- 字典与本地能力（不走接口） ---------- */
export const ownerTagsOf = owner => mock.ownerTagsOf(owner)
export const canEditOwnerTags = () => mock.canEditOwnerTags()
export const canViewOwnerTagDict = () => mock.canViewOwnerTagDict()
export { OWNER_TAG_CATEGORIES, OWNER_TAG_COLORS } from '@/utils/api'
