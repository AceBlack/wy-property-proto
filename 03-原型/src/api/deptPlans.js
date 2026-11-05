/**
 * 部门计划管理适配层 —— 契约见《接口层契约.md》五、G 域 · 部门计划
 *
 * 口径提醒（后端实现时别丢）：
 *   - **一个部门一个月一份计划**：`(planMonth, orgId)` 唯一，已驳回的可以重提；
 *   - **提报主体 = 该组织负责人**，不是人事归属；一人多部门时前端给选择器，
 *     服务端仍要校验 `leadsOf(empId).includes(orgId)`，不能只信前端下拉；
 *   - **权重由提报人在新建计划时逐项填**（模板里没有权重），
 *     **每一项必须是 5 的倍数**、且**各项合计必须正好 100%**：
 *     草稿不卡（写到一半要能存），提交时卡；审核阶段运营管理部可以调权重，
 *     但「通过并下发」前也必须合规；
 *   - **审批走统一 OA 引擎**（bizType='计划审批'），审批链按**提报部门**解析，
 *     不按人事归属 —— 一人管两个部门时，两个部门的项目经理不是同一个人；
 *   - **评分按任务录、按权重汇总**，不接收单一总分；
 *   - 本期只记录评分，**不换算绩效工资**（PLAN_PERF_RESERVE 里写了预留口径）。
 */
import { IS_MOCK, get, post, patch } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryDeptPlans = ({ planMonth = '', orgId = '', projectId = '', status = '', kw = '' } = {}) =>
  IS_MOCK
    ? mock.deptPlanRows({ planMonth, orgId, projectId, status, kw })
    : get('/dept-plans', { planMonth, orgId, projectId, status, kw })

export const getDeptPlanDetail = planId =>
  (IS_MOCK ? mock.getDeptPlan(planId) : get(`/dept-plans/${planId}`))

export const deptPlanStats = params => (IS_MOCK ? mock.deptPlanStats(params) : get('/dept-plans/stats', params))

/** 某部门某月是否已有计划（提报表单打开时先查一次，别填完才发现重复） */
export const planOfMonth = (planMonth, orgId) =>
  (IS_MOCK ? mock.planOfMonth(planMonth, orgId) : get('/dept-plans/exists', { planMonth, orgId }))

/* ---------- 写 ---------- */
export const saveDeptPlan = (payload, planId = '') =>
  IS_MOCK
    ? mock.saveDeptPlan(payload, planId)
    : (planId ? patch(`/dept-plans/${planId}`, payload) : post('/dept-plans', payload))

export const submitDeptPlan = planId =>
  (IS_MOCK ? mock.submitDeptPlan(planId) : post(`/dept-plans/${planId}/submit`))

export const withdrawDeptPlan = planId =>
  (IS_MOCK ? mock.withdrawDeptPlan(planId) : post(`/dept-plans/${planId}/withdraw`))

/** 单条考核项的执行填报（量化填实际值，监控填情况+扣分，重点填文字+自评） */
export const savePlanProgress = (planId, taskId, patchBody) =>
  (IS_MOCK ? mock.savePlanProgress(planId, taskId, patchBody) : patch(`/dept-plans/${planId}/items/${taskId}`, patchBody))

/** 提交完成情况 → 进入待复评。**复评必须等这一步**，服务端按状态卡 */
export const submitPlanResult = planId =>
  (IS_MOCK ? mock.submitPlanResult(planId) : post(`/dept-plans/${planId}/result`))

/** 审核阶段运营管理部直接改考核项（不走驳回），改动记进 reviseLog */
export const revisePlanItems = (planId, items) =>
  (IS_MOCK ? mock.revisePlanItems(planId, items) : patch(`/dept-plans/${planId}/items`, { items }))

/** 审核通过并下发：改完直接进执行，不用再走一轮 */
export const approvePlanToRun = (planId, body = {}) =>
  (IS_MOCK ? mock.approvePlanToRun(planId, body) : post(`/dept-plans/${planId}/approve`, body))

/** 复评 + 归档：scores 是 { taskId: 1–5 分 }，deductions 是监控项的 { taskId: 扣分 } */
export const closeDeptPlan = (planId, body) =>
  (IS_MOCK ? mock.closeDeptPlan(planId, body) : post(`/dept-plans/${planId}/review`, body))

/* ---------- 字典 / 派生（同步，纯前端口径） ----------
 * 算分只有一处实现：`planTargetOf` / `planSelfScoreOf` / `planItemCalc` / `planTotalsOf`。
 * 页面不许自己再算一遍 —— 两处实现迟早对不上，而分数对不上没人能判断哪边对。 */
export {
  PLAN_GRADE_RULE, PLAN_PERF_RESERVE, PLAN_SCORE_RULE, PLAN_STATUS, PLAN_TASK_STATUS,
  PLAN_WEIGHT_STEP, PLAN_WEIGHT_TOTAL,
  canEditDeptPlans, canEvalDeptPlans, canViewDeptPlans,
  deptPlanTaskTpl, leadsOf, orgLeaderOf, planCurrentMonth, planEvenWeights, planIdentity,
  planGradeOf, planItemCalc, planMonthOpts, planProjectOpts, planSelfScoreOf,
  planTargetOf, planTplBundle, planTotalsOf, planWeightCheck, planWeightOnStep
} from '@/utils/api'
