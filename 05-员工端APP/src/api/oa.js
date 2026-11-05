/**
 * OA · 业务审批（移动端）
 *
 * 口径（2026-11-04 对齐 PC 第 52/53 批）：
 *   ① **审批人读负责人关系表**，不再按"岗位名猜班组"。
 *      `leadersOf(orgId)` → 在期正职；正职空缺落到在期代理；**副职不参与单签**（副职是分工不是授权）。
 *      原来那套 `TEAM_OF_LABEL` 推测法已删：同一个部门到底谁签，只有关系表说了算。
 *   ② **会签**：节点带 `approvers[]` + `signMode`（single/all/any）。
 *      会签全部签完才推进；一人驳回即整单驳回（PC 的 approvalAction 已实现，员工端只负责把进度显示出来）。
 *   ③ 移动端不办**合同初审**这类纯后台节点：明确告诉用户去 PC 办，不要做成"点了没反应"。
 *   ④ 项目范围与"不能审自己"两条纪律保留。
 */
import { approvals, employees } from '@pc/mock'
import { OA_FORM_DEFS } from '@pc/utils/oa'
import {
  activeLeadersOf,
  approvalAction,
  createOaRequest,
  oaFormCheck,
  oaPreviewFlow
} from '@pc/utils/api'
import { currentRoleId, setRole } from '@pc/utils/auth'
import { CAP, can } from '@/config/personas'

export const OPEN_STATUS = ['待审批', '审批中']

/** 班组节点 → 组织后缀。工程/客服/环境/安保四个主管岗对应四个班组 */
const TEAM_OF_LABEL = { 工程主管: 'T2', 客服主管: 'T1', 环境主管: 'T4', 安保主管: 'T3' }

/** 移动端明确不办的节点（合同审批整套走 PC） */
const MOBILE_UNSUPPORTED = [
  { key: '合同初审', why: '合同审批在 PC 端办理（含合同正文与附件），移动端只处理业务单据' }
]

/** 当前待处理节点（会签名单挂在这里） */
function pendingNode(a) {
  return (a?.flow || []).find(n => n.action === '待处理') || null
}

/**
 * 这一单"该谁办"。
 * kind: done（已结束）/ unsupported（移动端不办）/ sign（会签节点，看名单）/
 *       leader（单人节点，看部门在期正职）/ role（按岗位，移动端无对应身份）
 */
export function targetOf(a) {
  if (!a) return { kind: 'none', why: '单据不存在' }
  if (!OPEN_STATUS.includes(a.status)) return { kind: 'done', why: `单据已${a.status}` }

  const cur = String(a.currentNode || '')
  const unsupported = MOBILE_UNSUPPORTED.find(x => cur.includes(x.key))
  if (unsupported) return { kind: 'unsupported', label: unsupported.key, why: unsupported.why }

  const node = pendingNode(a)
  const approvers = node?.approvers || []
  const signMode = node?.signMode || 'single'
  const progress = {
    done: approvers.filter(p => p.action !== '待处理').length,
    total: approvers.length
  }

  /* 组织：班组节点 → O-{项目}-T{n}；项目经理 / 部门负责人 → 项目组织 */
  let orgId = ''
  for (const [label, team] of Object.entries(TEAM_OF_LABEL)) {
    if (cur.includes(label)) {
      orgId = `O-${a.communityId}-${team}`
      break
    }
  }
  if (!orgId && /项目经理|部门负责人/.test(cur)) orgId = `O-${a.communityId}`

  const leaders = orgId ? activeLeadersOf(orgId) : []
  const signer = leaders.find(l => l.duty === '正职') || leaders.find(l => l.duty === '代理') || null

  if (approvers.length) return { kind: 'sign', label: cur, orgId, leaders, signer, approvers, signMode, progress }
  if (orgId) return { kind: 'leader', label: cur, orgId, leaders, signer, approvers, signMode, progress }
  return { kind: 'role', label: cur, orgId, leaders, signer, approvers, signMode, progress }
}

/** 兼容旧调用：节点名 → 处理角色标签（页面只用它的 label） */
export function nodeActor(a) {
  const t = targetOf(typeof a === 'string' ? { currentNode: a, status: '待审批' } : a)
  return { label: t.label || '', kind: t.kind, signer: t.signer || null, orgId: t.orgId || '' }
}

/** 我能不能处理这一单 */
export function canHandle(persona, a) {
  if (!persona || !a) return { ok: false, why: '未登录' }
  const t = targetOf(a)
  if (t.kind === 'none' || t.kind === 'done') return { ok: false, why: t.why }
  if (t.kind === 'unsupported') return { ok: false, why: t.why }
  if (!can(persona, CAP.approve)) return { ok: false, why: '该角色没有审批权' }
  if (a.applicant === persona.name) return { ok: false, why: '不能审批自己提交的单据' }
  if (a.communityId && persona.communityId && a.communityId !== persona.communityId) {
    return { ok: false, why: '不在本项目范围' }
  }

  if (t.kind === 'sign') {
    const mine = t.approvers.find(p => p.name === persona.name)
    if (!mine) return { ok: false, why: `会签名单：${t.approvers.map(p => p.name).join('、')}` }
    if (mine.action !== '待处理') {
      const waiting = t.approvers.filter(p => p.action === '待处理').map(p => p.name).join('、')
      return { ok: false, why: `你在本节点已${mine.action}${waiting ? `，等 ${waiting}` : ''}` }
    }
    return { ok: true, why: '', sign: true }
  }

  if (t.kind === 'leader') {
    if (!t.signer) return { ok: false, why: `${t.orgId} 没有在期负责人，需先在 PC 补负责人` }
    if (t.signer.name !== persona.name) {
      return { ok: false, why: `当前节点由 ${t.signer.name}（${t.signer.duty}）处理` }
    }
    return { ok: true, why: '' }
  }

  return { ok: false, why: '该节点按岗位处理，当前账号没有对应权限' }
}

export function rowOf(a) {
  const actor = nodeActor(a)
  const t = targetOf(a)
  return {
    id: a.approvalId,
    no: a.approvalNo,
    title: a.title,
    bizType: a.bizType,
    amount: a.amount || 0,
    applicant: a.applicant,
    applicantRole: a.applicantRole,
    applyTime: a.applyTime,
    status: a.status,
    node: a.currentNode,
    nodeLabel: actor?.label || a.currentNode,
    signMode: t.signMode || 'single',
    signDone: t.progress?.done || 0,
    signTotal: t.progress?.total || 0,
    urgency: a.urgency || '普通',
    waitHours: a.waitHours || 0,
    communityId: a.communityId
  }
}

/**
 * 待我处理 / 我发起 / 我办过
 * 「我办过」用 flow（含会签名单）里的处理人反查。
 */
export function listFor(persona, tab = 'todo') {
  const all = approvals
  if (tab === 'todo') {
    return all
      .filter(a => canHandle(persona, a).ok)
      .map(rowOf)
      .sort((a, b) => b.waitHours - a.waitHours)
  }
  if (tab === 'applied') {
    return all.filter(a => a.applicant === persona?.name).map(rowOf)
  }
  return all
    .filter(a =>
      (a.flow || []).some(
        n => (n.handler && n.handler === persona?.name) || (n.approvers || []).some(p => p.name === persona?.name && p.action !== '待处理')
      )
    )
    .map(rowOf)
    .sort((a, b) => String(b.applyTime).localeCompare(String(a.applyTime)))
}

export const countsOf = persona => ({
  todo: listFor(persona, 'todo').length,
  applied: listFor(persona, 'applied').length,
  done: listFor(persona, 'done').length
})

export function detailOf(id) {
  const a = approvals.find(x => x.approvalId === id)
  if (!a) return null
  const actor = nodeActor(a)
  const t = targetOf(a)
  return {
    raw: a,
    row: rowOf(a),
    actor,
    target: t,
    /* 会签块：只有节点带名单时才出现，单人节点不显示空壳 */
    sign: t.kind === 'sign' ? { mode: t.signMode, progress: t.progress, approvers: t.approvers } : null,
    timeline: (a.flow || []).map((n, i) => ({
      index: i + 1,
      node: n.node,
      handler: n.handler || '',
      action: n.action || '待处理',
      time: n.time || '',
      comment: n.comment || '',
      done: n.action && n.action !== '待处理',
      signMode: n.signMode || 'single',
      approvers: n.approvers || []
    }))
  }
}

/** 转办 / 加签的候选人：优先当前部门在期负责人，其次同岗位 */
export function transferCandidates(a) {
  const t = targetOf(a)
  const byLeader = (t.leaders || []).map(l => ({
    name: l.name,
    label: `${l.name} · ${l.position || l.duty}`,
    value: l.name
  }))
  if (byLeader.length) return byLeader.slice(0, 12)
  if (!t.orgId) return []
  return employees
    .filter(e => e.status !== '离职' && e.orgId === t.orgId)
    .slice(0, 12)
    .map(e => ({ name: e.name, label: `${e.name} · ${e.position}`, value: e.name }))
}

/**
 * 处理审批。
 * 会签节点不能覆盖 handler：approvalAction 已按"我签的那一份"写好了处理人，
 * 覆盖会把名单第一个人的名字写上去，看起来像别人签的。
 */
export function act(persona, approvalId, action, { comment = '', to = '' } = {}) {
  const a = approvals.find(x => x.approvalId === approvalId)
  if (!a) throw new Error('审批单不存在')
  const guard = canHandle(persona, a)
  if (!guard.ok) throw new Error(guard.why)
  const t = targetOf(a)
  const idx = (a.flow || []).findIndex(n => n.action === '待处理')
  const verb = action === 'approve' ? '同意' : action === 'reject' ? '驳回' : action === 'transfer' ? '转办' : '加签'
  approvalAction(approvalId, verb, { comment, to })
  if (idx >= 0 && a.flow[idx] && verb !== '加签' && t.kind !== 'sign') a.flow[idx].handler = persona.name
  return detailOf(approvalId)
}

export const BIZ_TYPE_TONE = {
  报修验收: 'var(--biz-primary)',
  公告发布: 'var(--biz-text-3)',
  费用减免: 'var(--biz-warning)',
  押金退还: 'var(--biz-accent-dark)'
}

/* ================= 发起申请（2026-11-04 补） =================
 * 后台第 50 批给 OA 做了「6 类单据 + 配置驱动表单」，员工端一直只有审批、没有发起入口 ——
 * 一线最常见的事（请假、报销、用车）反而只能回 PC 提，这是这条链上最大的一个缺口。
 *
 * 表单不硬编码：字段来自 PC 的 `OA_FORM_DEFS`（text/textarea/number/money/date/datetime/select/file），
 * 加第七种单据时员工端不用改代码。校验也复用 `oaFormCheck`，避免两端规则不一致。
 */
export const APPLY_DEFS = OA_FORM_DEFS.filter(d => !d.noForm && (d.fields || []).length)

export const applyDefOf = bizType => APPLY_DEFS.find(d => d.bizType === bizType) || null

/** 表单校验：返回空串表示通过（与 PC 同一个函数，错误文案也一致） */
export const checkApplyForm = (bizType, formData) => oaFormCheck(bizType, formData)

/**
 * 审批路径预览：金额变了路径可能从两级变三级，填表时就要看得见。
 *
 * 必须在**本人角色**下预览：`oaPreviewFlow` 内部用 `currentOperator()` 解析审批人，
 * 不切角色就会拿 PC 当前角色（原型默认集团总经理）的上级去算，
 * 结果是「预览写周建国、提交后变陈瑞」—— 这种不一致比不显示更糟。
 */
export function previewFlowOf(persona, bizType, amount = 0) {
  const prevRole = currentRoleId.value
  setRole(persona?.roleId || prevRole)
  try {
    return oaPreviewFlow(bizType, amount)
  } finally {
    setRole(prevRole)
  }
}

/** 金额字段（参与条件分支），没有就返回 null */
export const amountFieldOf = bizType => (applyDefOf(bizType)?.fields || []).find(f => f.role === 'amount') || null

/**
 * 提交申请
 *
 * 两个必须处理的点：
 *   ① PC 的 `createOaRequest` 用 `currentOperator()` 取提报人（按 PC 的「当前角色」），
 *      员工端登录的是自己的身份，所以先临时切到该身份的角色，建完立刻切回 ——
 *      不切会出现「周明提交的请假，提报人写着集团总经理」。
 *   ② 名册里一线执行人可能不在册（周明就不在），角色 → 岗位 → 第一个人不一定是他，
 *      所以建完把提报人字段回填成登录人。审批人解析仍按 PC 规则走，不改。
 */
export function submitApply(persona, { bizType, formData = {}, files = [] } = {}) {
  if (!applyDefOf(bizType)) throw new Error('不支持的单据类型')
  const prevRole = currentRoleId.value
  setRole(persona.roleId || prevRole)
  let created
  try {
    created = createOaRequest({ bizType, formData, files })
  } finally {
    setRole(prevRole)
  }
  const ap = approvals.find(x => x.approvalId === created.approvalId)
  if (ap) {
    ap.applicant = persona.name
    ap.applicantRole = persona.post
    ap.applicantEmpId = persona.empId || ''
    ap.applicantOrgId = persona.orgId
    ap.applicantOrgName = persona.orgName
    if (persona.communityId) ap.communityId = persona.communityId
  }
  return ap || created
}

/** 发起后告诉用户「下一站是谁」：审批人解析不出来时如实写待指派，不编人名 */
export function nextHandlerOf(ap) {
  const n = (ap?.flow || [])[0]
  if (!n) return { node: '', name: '待指派' }
  return { node: n.node || '', name: n.handler || '待指派' }
}
