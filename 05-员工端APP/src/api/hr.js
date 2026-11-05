/**
 * 人事自助：考勤 / 工资条（移动端，只看自己）
 *
 * 两条口径（已确认）：
 *   ① 考勤只做「月度查询 + 本人确认/申诉」，**不做通用打卡**。
 *      现场到岗留证已经有巡检打卡了，再造一套日常打卡只会让两处时间对不上。
 *   ② 工资条走「本人」规则（新增 c.payroll.self），不给一线 c.payroll.view 的全表权限。
 *
 * 确认/申诉是移动端新增的写操作（PC 没有），契约待补：
 *   POST /attendance/{attId}/confirm | /appeal
 * 申诉**不自动改考勤结果** —— 否则等于让员工自己改考勤，申诉只进 HR 的待办。
 */
import { attendance } from '@pc/mock'
import { payrollPeriods, queryPayrolls, payrollDetailOf } from '@pc/utils/api'
import { stamp } from '@/config/personas'

/* ---------------- 考勤 ---------------- */

export const ATT_TONE = {
  正常: 'var(--biz-success)',
  待确认: 'var(--biz-warning)',
  异常: 'var(--biz-danger)'
}

export function attendanceOf(empId) {
  if (!empId) return []
  return attendance
    .filter(a => a.empId === empId)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)))
    .map(a => ({
      id: a.attId,
      month: a.month,
      shift: a.shift,
      should: a.shouldDays,
      actual: a.actualDays,
      late: a.late,
      early: a.earlyLeave,
      absent: a.absent,
      leave: a.leaveDays,
      overtime: a.overtimeHours,
      rate: a.attRate,
      status: a.status,
      statusTone: ATT_TONE[a.status] || 'var(--biz-text-3)',
      appealCount: a.appealCount || 0,
      appealResult: a.appealResult || '',
      confirmed: !!a.confirmedAt
    }))
}

export function attendanceYearSummary(empId) {
  const rows = attendanceOf(empId)
  return {
    months: rows.length,
    late: rows.reduce((s, r) => s + r.late, 0),
    leave: rows.reduce((s, r) => s + r.leave, 0),
    overtime: rows.reduce((s, r) => s + r.overtime, 0),
    pending: rows.filter(r => r.status === '待确认').length
  }
}

function attOf(id) {
  const a = attendance.find(x => x.attId === id)
  if (!a) throw new Error('考勤记录不存在')
  return a
}

/** 本人确认：待确认 → 正常 */
export function confirmAttendance(attId) {
  const a = attOf(attId)
  if (a.status !== '待确认') throw new Error(`当前「${a.status}」，无需确认`)
  a.status = '正常'
  a.confirmedAt = stamp()
  return { ...a }
}

/** 本人申诉：不动结果，只记一笔待 HR 处理 */
export function appealAttendance(attId, reason) {
  const a = attOf(attId)
  if (!String(reason || '').trim()) throw new Error('申诉要写清原因')
  a.appealCount = (a.appealCount || 0) + 1
  a.appealResult = `待处理 · ${stamp()} · ${String(reason).trim()}`
  a.appealedAt = stamp()
  return { ...a }
}

/* ---------------- 工资条 ---------------- */

export const periods = () => payrollPeriods()

/** 我的工资条列表（按姓名精确匹配，避免取到同名） */
export async function myPayrolls(persona) {
  const ps = await periods()
  const out = []
  for (const p of ps) {
    const page = await queryPayrolls({ period: p.period, pageNo: 1, size: 200, filters: { kw: persona?.name || '' } })
    const row = (page.rows || []).find(r => r.empName === persona?.name)
    if (row) out.push({ ...row, periodStatus: p.status })
  }
  return out.sort((a, b) => String(b.period).localeCompare(String(a.period)))
}

export async function payrollDetail(persona, payrollId) {
  const d = payrollDetailOf(payrollId)
  if (d.payroll.empName !== persona?.name && persona?.roleId !== 'R-FINM') {
    throw new Error('只能查看本人工资条')
  }
  return d
}
