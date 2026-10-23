// 权限判定内核：只依赖 permissions / roles 两张字典表
//
// 为什么要独立成文件：路由守卫在首屏就要做权限判定，如果它 import api.js，
// 会把 4MB 的 mock 数据整体拖进主 chunk（实测首屏包 1.2MB → 5.4MB）。
// 权限判定只需要两张字典表，因此这里直接读 JSON，绕开 @/mock/index.js。
//
// 模型（与 E 域一致）：纯 RBAC —— 人 → 角色 → 权限码 → 页面。
// 权限码与页面的对应关系来自 permissions.json 的 route 字段，本文件不另建映射。

import { reactive } from 'vue'
import permissions from '@/mock/permissions.json'
import roles from '@/mock/roles.json'

const ROLE_OF = new Map(roles.map(r => [r.roleId, r]))

/**
 * 运行时覆盖表：E2「角色权限矩阵保存」的产物（内存态，刷新还原）
 * 用 reactive 是为了让菜单过滤、路由守卫在保存后立即重算 —— 保存后能看到菜单真的变了。
 */
const OVERRIDE = reactive({})

/** 某角色拥有的权限码集合（优先取覆盖表） */
export function permCodesOfRole(roleId) {
  const ov = OVERRIDE[roleId]
  if (ov) return new Set(ov)
  return new Set(ROLE_OF.get(roleId)?.perms || [])
}

/** 保存某角色的权限位 */
export function setRolePerms(roleId, codes) { OVERRIDE[roleId] = [...new Set(codes)] }
/** 还原某角色为初始权限 */
export function resetRolePerms(roleId) { delete OVERRIDE[roleId] }
/** 该角色是否被改过（页面显示「已修改未保存 / 已保存」） */
export const isRoleOverridden = roleId => !!OVERRIDE[roleId]
export const overriddenRoleIds = () => Object.keys(OVERRIDE)

/** 某角色的权限位数 */
export const permCountOfRole = roleId => (ROLE_OF.get(roleId)?.perms || []).length

/**
 * 页面路径 → 所需权限码。返回 '' 表示公共页（无需授权，一律放行）。
 * 规则：
 *   ① 精确命中 route；
 *   ② 子路径逐级上溯（/a/owners/new → /a/owners，/e/reports/:code → /e/reports）；
 *   ③ 新增 / 编辑页（/new、/edit 结尾）取「操作」权限位，只有查看权限的角色进不去；
 *      该页面若没有 edit 权限码（如缴费流水只有 view），则回退到 view。
 */
export function permCodeOfPath(path) {
  if (!path) return ''
  const write = /(^|\/)(new|edit)$/.test(path)
  const pick = route => {
    const list = permissions.filter(p => p.route === route)
    if (!list.length) return ''
    const edit = list.find(p => p.op === 'edit')
    if (write && edit) return edit.code
    return (list.find(p => p.op === 'view') || list[0]).code
  }
  const hit = pick(path)
  if (hit) return hit
  const seg = String(path).split('/').filter(Boolean)
  while (seg.length > 1) {
    seg.pop()
    const c = pick(`/${seg.join('/')}`)
    if (c) return c
  }
  return ''
}

/** 权限码的可读说明（403 页显示「需要哪个权限」） */
export function permLabel(code) {
  const p = permissions.find(x => x.code === code)
  return p ? `${p.domainName} · ${p.funcName} · ${p.opName}` : code
}

/** 顶栏「以某角色查看」的候选项 */
export const roleSwitchOpts = () => roles.map(r => ({
  value: r.roleId, label: r.name, scope: r.scope,
  dataScope: r.dataScope, permCount: (r.perms || []).length
}))

/** 角色名（403 页显示用） */
export const roleNameOf = roleId => ROLE_OF.get(roleId)?.name || roleId
