// 页面级权限守卫：原型阶段用「角色视角切换」模拟登录身份
//
// 模型（与 E 域一致）：纯 RBAC —— 人 → 角色 → 权限码 → 页面。
// 权限码与页面的对应关系来自 mock/permissions.json 的 route 字段，不在本文件另建一份映射。
// 无权限码覆盖的页面（shell 模板页、错误页）是公共页，一律放行。
//
// 行为口径（评审确认）：
//   ① 菜单：无权限的页面直接隐藏（不在菜单里出现）
//   ② 直访：在地址栏输入 / 书签进入无权限页面 → 跳 /error/403，并说明所需权限码
//   ③ 切换角色：若停在无权限页面，同样跳 403（与直访行为一致，规则只有一条）
//   ④ 行级数据过滤不在守卫里做：数据范围六档在 api.js 的 scopeFilter 内生效（P5 起含「责任范围」）

import { computed, reactive } from 'vue'
// 只依赖 rbac 内核：这里不能 import '@/utils/api'，否则首屏主包会带上整个 mock
import {
  isRoleOverridden, permCodeOfPath, permCodesOfRole, resetRolePerms as _resetRolePerms,
  roleNameOf, roleSwitchOpts, setRolePerms as _setRolePerms
} from '@/utils/rbac'

const KEY = 'wy_proto_role'
const DEFAULT_ROLE = 'R-GM'   // 默认集团总经理：首轮演示全部可见，不会被权限挡住

// permVersion：E2 保存权限矩阵后自增，让依赖 hasPerm / canVisit 的 computed 重新求值
const state = reactive({ roleId: localStorage.getItem(KEY) || DEFAULT_ROLE, permVersion: 0 })

/**
 * 只让守卫 / 菜单失效重算，不写数据。
 * 用在「数据已经被别处改过」的场景：比如审批通过时由 api 层写入了角色权限，
 * 页面只需要通知守卫重新求值——再调一次 saveRolePerms 会把同一份数据写两遍。
 */
export function invalidatePerms() {
  state.permVersion++
}

/** 保存角色权限位并让守卫 / 菜单立即生效 */
export function saveRolePerms(roleId, codes) {
  _setRolePerms(roleId, codes)
  state.permVersion++
}
export function resetRolePerms(roleId) {
  _resetRolePerms(roleId)
  state.permVersion++
}
export const rolePermsDirty = roleId => isRoleOverridden(roleId)

export const currentRoleId = computed(() => state.roleId)
/** 角色 / 权限变化时用作页面 key 的后缀：切角色后列表按新数据范围重新取数（E4） */
export const roleViewKey = computed(() => `${state.roleId}-${state.permVersion}`)
export const currentRoleName = computed(() => roleNameOf(state.roleId))
export const currentRole = computed(() => roleSwitchOpts().find(r => r.value === state.roleId))

export function setRole(roleId) {
  state.roleId = roleId
  localStorage.setItem(KEY, roleId)
}

/** 是否拥有某个权限码（读 permVersion，权限矩阵保存后自动失效重算） */
export function hasPerm(code) {
  if (!code) return true                       // 无权限码 = 公共页
  void state.permVersion
  return permCodesOfRole(state.roleId).has(code)
}

/** 是否可访问某页面 */
export function canVisit(path) {
  return hasPerm(permCodeOfPath(path))
}

/** 页面所需权限码（'' 表示公共页） */
export function needPermOf(path) {
  return permCodeOfPath(path)
}
