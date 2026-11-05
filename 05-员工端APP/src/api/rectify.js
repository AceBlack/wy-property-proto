/**
 * 整改闭环（移动端）
 *
 * 规则全部复用 PC 的数据层：submitRectify / recheckRectify / reassignRectify / getRectifyDetail。
 * 移动端只决定「谁能在这三个动作上出手」：
 *   提交整改 → 责任人本人；本部门组长可代提交（会标注代提交人，不静默冒名）
 *   复核     → 项目经理 / 品质督导（PC 的 f.rectify.edit 给到 PM）
 *   改派     → 部门经理（把问题给到具体责任人）
 */
import { employees } from '@pc/mock'
import { getRectifyDetail, rectifyRows, reassignRectify, recheckRectify, submitRectify } from '@pc/utils/api'
import { CAP, can } from '@/config/personas'

export const STATUS_TONE = {
  待整改: 'var(--biz-warning)',
  已退回: 'var(--biz-danger)',
  待复核: 'var(--biz-primary)',
  已闭环: 'var(--biz-ins-done)'
}

const isOwner = (persona, r) => !!persona?.name && r.owner === persona.name
/**
 * 「本部门」只在**班组长**这一层成立（orgId 是班组，如 O-P01-T1）。
 * 项目经理的 orgId 是项目部（O-P01），若也按前缀匹配，就等于让他替全项目代提交整改 —— 越权。
 * 项目经理该做的是复核，不是替人交作业。
 */
const isDept = (persona, r) => persona?.roleId === 'R-SEC' && !!persona?.orgId && r?.deptId === persona.orgId
const inOrg = (persona, r) => !!persona?.orgId && String(r?.deptId || '').startsWith(persona.orgId)

/** 我该处理的整改单 */
export function listFor(persona, tab = 'todo') {
  if (!persona) return []
  const all = rectifyRows({})
  if (tab === 'todo') {
    /* 责任人：待整改/已退回；组长：本部门同类单；项目经理：待复核 */
    return all
      .filter(r => {
        if (['待整改', '已退回'].includes(r.status)) return isOwner(persona, r) || (can(persona, CAP.rectify) && isDept(persona, r))
        if (r.status === '待复核') return can(persona, CAP.recheck)
        return false
      })
      .map(r => rowOf(r, persona))
  }
  if (tab === 'mine') return all.filter(r => isOwner(persona, r)).map(r => rowOf(r, persona))
  return all.filter(r => inOrg(persona, r)).map(r => rowOf(r, persona))
}

export function rowOf(r, persona) {
  return {
    /* 原样带上明细与提交记录：详情页要展示整改项、提交人、说明、照片 */
    items: r.items || [],
    submitAt: r.submitAt || '',
    submitBy: r.submitBy || '',
    submitRemark: r.submitRemark || '',
    photos: r.photos || 0,
    submittedAt: r.submittedAt || '',
    id: r.rectifyId,
    no: r.rectifyNo,
    status: r.status,
    statusTone: STATUS_TONE[r.status] || 'var(--biz-text-3)',
    deptName: r.deptName,
    deptId: r.deptId,
    owner: r.owner,
    ownerEmpId: r.ownerEmpId,
    level: r.level,
    source: r.sourceType,
    issueDesc: r.issueDesc,
    dueDate: r.dueDate,
    createdAt: r.createdAt,
    progress: r.progress,
    doneItems: r.doneItems,
    totalItems: r.totalItems,
    overdue: r.overdue,
    overdueDays: r.overdueDays,
    remainDays: r.remainDays,
    recheckOverdue: r.recheckOverdue,
    canSubmit: ['待整改', '已退回'].includes(r.status) && (r.owner === persona?.name || (can(persona, CAP.rectify) && isDept(persona, r))),
    canRecheck: r.status === '待复核' && can(persona, CAP.recheck),
    canReassign: ['待整改', '已退回'].includes(r.status) && can(persona, CAP.rectify)
  }
}

export const countsOf = persona => ({
  todo: listFor(persona, 'todo').length,
  mine: listFor(persona, 'mine').length,
  dept: listFor(persona, 'dept').length
})

/** 详情（含时间线），PC 侧是异步的 */
export const detailOf = rectifyId => getRectifyDetail(rectifyId)

export function submit(persona, rectifyId, { remark = '', photos = 0, itemNos = null } = {}) {
  const r = rectifyRows({}).find(x => x.rectifyId === rectifyId)
  if (!r) throw new Error('整改单不存在')
  const row = rowOf(r, persona)
  if (!row.canSubmit) throw new Error('这单不该由你提交整改')
  if (!String(remark).trim()) throw new Error('提交整改要写整改说明')
  const by = isOwner(persona, r) ? '' : persona.name
  return submitRectify(rectifyId, { applicant: by, remark: String(remark).trim(), photos, itemNos })
}

export function recheck(persona, rectifyId, { pass = true, remark = '' } = {}) {
  const r = rectifyRows({}).find(x => x.rectifyId === rectifyId)
  if (!r) throw new Error('整改单不存在')
  if (!can(persona, CAP.recheck)) throw new Error('该角色没有复核权')
  if (r.status !== '待复核') throw new Error(`当前「${r.status}」，不在待复核状态`)
  if (!pass && !String(remark).trim()) throw new Error('退回要写清原因')
  return recheckRectify(rectifyId, { pass, checker: persona.name, remark: String(remark).trim() })
}

/** 改派候选人：责任部门里的一线岗位（组长不接整改项，只派人） */
const TEAM_POS = { T1: ['客服专员'], T2: ['维修工'], T3: ['保安'], T4: ['保洁员', '绿化员'] }

export function candidatesOf(row) {
  const team = String(row?.deptId || '').split('-')[2]
  const pos = TEAM_POS[team] || []
  return employees
    .filter(e => e.status !== '离职' && e.orgId === row?.deptId && pos.includes(e.position))
    .map(e => ({ value: e.name, label: `${e.name} · ${e.position}`, desc: '本部门' }))
}

export function reassign(persona, rectifyId, { owner = '', dueDate = '' } = {}) {
  const r = rectifyRows({}).find(x => x.rectifyId === rectifyId)
  if (!r) throw new Error('整改单不存在')
  if (!can(persona, CAP.rectify)) throw new Error('该角色没有改派权')
  if (!owner) throw new Error('请选择责任人')
  return reassignRectify(rectifyId, { deptId: r.deptId, owner, dueDate: dueDate || r.dueDate })
}
