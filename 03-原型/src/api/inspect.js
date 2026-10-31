/**
 * 巡检域适配层（契约见《接口层契约.md》· inspect）
 *
 * 口径提醒：
 *   - 两类任务：执行（一线自查）/ 监督（部门经理查下属计划落地）；
 *   - **监督任务的不合格项必须指定责任员工**，否则考核归不到人（服务端 422）。
 */
import { IS_MOCK, get, post } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryInspectTasks = ({ pageNo = 1, size = 20, filters = {} } = {}) =>
  IS_MOCK
    ? mock.queryInspectTasks({ pageNo, size, filters })
    : get('/inspect-tasks', { pageNo, size, ...filters })

export const getInspectTaskDetail = taskId =>
  IS_MOCK ? mock.getInspectTaskDetail(taskId) : get(`/inspect-tasks/${taskId}`)

/* ---------- 执行 ---------- */
export const submitInspectResult = (taskId, payload = {}) =>
  IS_MOCK ? mock.submitInspectResult(taskId, payload) : post(`/inspect-tasks/${taskId}/submit`, payload)

/** 移动端执行页的聚合数据（模板 + 任务 + 责任员工候选）——聚合接口尚未进契约，暫按原实现 */
export const inspectExecData = id => mock.inspectExecData(id)

/* ---------- 字典 / 统计 ---------- */
export {
  INSPECT_ISSUE_REASONS, INSPECT_TASK_TYPES, inspectSummary, responsibilityOpts,
  taskPostOpts, taskStatusOpts
} from '@/utils/api'
