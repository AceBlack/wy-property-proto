/**
 * 通讯录适配层 —— 契约见 openapi.yaml 的 `/contacts` 段（第 66 批）
 *
 * 口径提醒（后端实现时别丢）：
 *   - **只取在职**（含试用，排除离职）：给离职同事打电话是这类工具最常见的错误；
 *   - **手机号不脱敏**：同事之间看全号。与员工档案的「脱敏 + 揭示留痕」刻意相反 ——
 *     在档案里看手机是"查个人信息"，在通讯录里看手机就是它的用途本身；
 *   - **字段白名单在服务端**：只回 `empId / name / position / orgId / orgName / phone / gender`。
 *     薪资、身份证、银行卡、紧急联系人**根本不出现在返回里**（不是页面不显示）；
 *   - 独立权限位 `c.contacts.view`，**所有角色默认都有** —— 不建议按岗位开，
 *     真要收只能收在"员工档案"那一侧；
 *   - 部门树**0 人节点不返回**：组织树按管理口径建，班组层面不一定有直属员工。
 */
import * as mock from '@/utils/api'
import { get } from './client'

const IS_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

export const queryContacts = (opt = {}) =>
  (IS_MOCK ? mock.queryContacts(opt) : get('/contacts', opt))

export const contactTree = () =>
  (IS_MOCK ? mock.contactTree() : get('/contacts/tree'))

export const contactStats = () =>
  (IS_MOCK ? mock.contactStats() : get('/contacts/stats'))

/** 当前登录人（页面高亮"我"用） */
export const contactMe = () =>
  (IS_MOCK ? mock.contactMe() : get('/contacts/me'))

export { CONTACT_FIELDS, canViewContacts } from '@/utils/api'
