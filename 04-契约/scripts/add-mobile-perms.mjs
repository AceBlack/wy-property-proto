/**
 * 把员工端自己发明的 6 条能力码补进权限字典。
 *
 * 为什么要有这个脚本
 * ------------------------------------------------------------
 * `05-员工端APP/src/config/personas.js` 从第一天起就用 6 条 PC 字典里不存在的码做判断
 * （前端 `can()` 只查本地 perms 数组，所以一直没报错）。这是**隐患**不是"设计"：
 * 一旦员工端改走 HTTP，假服务的 `requirePerm` 查的是 `fixtures/permissions.json`，
 * 这 6 条不在里面 → 每个请求 403，而且报错信息是"缺少权限位 xxx"，看着像前端传错参数。
 *
 * 所以接假服务之前必须先补字典。语义按"谁该有"给，不按"能跑通"给：
 *
 *   自助三条（公告阅读 / 考勤本人 / 工资条本人）→ 所有角色。
 *     它们描述的是"每个登录员工对自己数据的权利"，不是管理动作。
 *   审批处理 → 总经理 / 项目经理 / 客服主管（这三个在 PC 端本来就点了审批节点）
 *   工单指派 → 总经理 / 项目经理（客服主管只接单不派单，personas 里也没给他）
 *   整改复核 → 总经理 / 项目经理（品质督导在 PC 侧做，移动端不开放）
 *
 * 用法：node scripts/add-mobile-perms.mjs
 * 幂等：已存在就跳过，可以反复跑。
 */
import fs from 'node:fs'
import path from 'node:path'

/* 本脚本住在 04-契约/scripts/，而下面的路径都相对仓库根（WYDoc）写的 —— 上两级 */
const ROOT = path.resolve(import.meta.dirname, '../..')

/* 6 条新码。`func` 决定它在权限矩阵里落在哪一行 —— 复用一个已有 func 就不新增行，
   `f.wo.dispatch` 因此被规范成 `f.workorders.dispatch`（同一行：工单列表）。 */
const NEW_PERMS = [
  {
    code: 'c.payroll.self', domain: 'c', domainName: 'C 办公协同',
    func: 'payroll', funcName: '工资表', op: 'self', opName: '本人', route: '/c/payroll'
  },
  {
    code: 'c.notices.read', domain: 'c', domainName: 'C 办公协同',
    func: 'notices', funcName: '公告通知', op: 'read', opName: '阅读', route: '/c/notices'
  },
  {
    code: 'c.attendance.self', domain: 'c', domainName: 'C 办公协同',
    func: 'attendance', funcName: '考勤', op: 'self', opName: '本人', route: '/c/attendance'
  },
  {
    code: 'f.workorders.dispatch', domain: 'f', domainName: 'F 现场运营',
    func: 'workorders', funcName: '工单列表', op: 'dispatch', opName: '指派', route: '/f/work-orders'
  },
  {
    code: 'f.rectify.recheck', domain: 'f', domainName: 'F 现场运营',
    func: 'rectify', funcName: '整改闭环', op: 'recheck', opName: '复核', route: '/f/rectify'
  },
  {
    code: 'f.approval.handle', domain: 'f', domainName: 'F 现场运营',
    func: 'approval', funcName: '业务审批', op: 'handle', opName: '处理', route: '/f/approval'
  }
]

/** 插在哪条之后，保持文件原有排序（域 → func 首现顺序 → view/edit/其他） */
const AFTER = {
  'c.payroll.self': 'c.payroll.edit',
  'c.notices.read': 'c.notices.edit',
  'c.attendance.self': null,          // c 域末尾
  'f.workorders.dispatch': 'f.workorders.edit',
  'f.rectify.recheck': 'f.rectify.edit',
  'f.approval.handle': null           // 文件末尾（f 是最后一个域）
}

/* 哪些角色拿哪几条。自助三条给全部角色 —— 包括一线的 R-ENG 与 R-CLN。 */
const SELF_THREE = ['c.notices.read', 'c.attendance.self', 'c.payroll.self']
const GRANT = {
  'R-GM': [...SELF_THREE, 'f.approval.handle', 'f.workorders.dispatch', 'f.rectify.recheck'],
  'R-PM': [...SELF_THREE, 'f.approval.handle', 'f.workorders.dispatch', 'f.rectify.recheck'],
  'R-SEC': [...SELF_THREE, 'f.approval.handle'],
  'R-VIEW': [...SELF_THREE, 'f.approval.handle']   // 只读管理视角，审批要看得到
}
const SELF_ONLY = [
  'R-CS', 'R-CHG', 'R-FIN', 'R-FINM', 'R-ENG', 'R-QS',
  'R-HR', 'R-STW', 'R-CLN', 'R-GRD', 'R-HRA'
]

const PERM_FILES = [
  '03-原型/src/mock/permissions.json',
  '02-原型设计/mock/permissions.json',
  '04-契约/fixtures/permissions.json'
]
const ROLE_FILES = [
  '03-原型/src/mock/roles.json',
  '02-原型设计/mock/roles.json',
  '04-契约/fixtures/roles.json'
]

/* ---------------- 权限字典 ---------------- */

for (const rel of PERM_FILES) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    console.log(`跳过（不存在）${rel}`)
    continue
  }
  const list = JSON.parse(fs.readFileSync(abs, 'utf8'))
  const have = new Set(list.map(x => x.code))
  let added = 0

  for (const p of NEW_PERMS) {
    if (have.has(p.code)) continue
    const anchor = AFTER[p.code]
    if (anchor) {
      const i = list.findIndex(x => x.code === anchor)
      if (i < 0) throw new Error(`${rel} 里找不到锚点 ${anchor}`)
      list.splice(i + 1, 0, p)
    } else if (p.domain === 'c') {
      /* c 域末尾：插在最后一个 c 条之后 */
      const last = list.map(x => x.domain).lastIndexOf('c')
      list.splice(last + 1, 0, p)
    } else {
      list.push(p)
    }
    have.add(p.code)
    added += 1
  }
  fs.writeFileSync(abs, JSON.stringify(list, null, 2) + '\n')
  console.log(`✓ ${rel}  +${added} → ${list.length} 条`)
}

/* ---------------- 角色授权 ---------------- */

for (const rel of ROLE_FILES) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) {
    console.log(`跳过（不存在）${rel}`)
    continue
  }
  const roles = JSON.parse(fs.readFileSync(abs, 'utf8'))
  let touched = 0

  for (const r of roles) {
    const want = GRANT[r.roleId] || (SELF_ONLY.includes(r.roleId) ? SELF_THREE : [])
    if (!want.length) continue
    r.perms = r.perms || []
    const before = r.perms.length
    for (const c of want) if (!r.perms.includes(c)) r.perms.push(c)
    if (r.perms.length !== before) {
      r.perms.sort()
      /* permCount 是"已授权条数"，跟着真实数走 —— 别让它和 perms 脱钩 */
      if ('permCount' in r) r.permCount = r.perms.length
      touched += 1
    }
  }
  fs.writeFileSync(abs, JSON.stringify(roles, null, 2) + '\n')
  console.log(`✓ ${rel}  改动 ${touched} 个角色`)
}

/* ---------------- 自检 ---------------- */

const perms = JSON.parse(fs.readFileSync(path.join(ROOT, PERM_FILES[0]), 'utf8'))
const roleList = JSON.parse(fs.readFileSync(path.join(ROOT, ROLE_FILES[0]), 'utf8'))
const codes = new Set(perms.map(x => x.code))

let bad = 0
for (const r of roleList) {
  for (const c of r.perms || []) {
    if (!codes.has(c)) {
      console.log(`✗ ${r.roleId} 带了字典里没有的码 ${c}`)
      bad += 1
    }
  }
}
const gm = roleList.find(r => r.roleId === 'R-GM')
const execCount = perms.filter(x => x.op === 'exec').length
console.log(
  `\n字典 ${perms.length} 条（exec ${execCount}）· GM ${gm.perms.length} 条 · ` +
  `孤儿授权 ${bad}`
)
if (gm.perms.length !== perms.length - execCount) {
  console.log('⚠️ GM 覆盖度不再等于「全部 - exec」，契约的覆盖度断言会红，需先确认是否漏授')
}
