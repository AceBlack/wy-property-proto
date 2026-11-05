/**
 * 计划模板适配层 —— 契约见《接口层契约.md》五、G 域 · 计划模板
 *
 * 口径提醒（后端实现时别丢）：
 *   - **模板是数据不是代码**：条目、单位、方向、评价标准都在页面上改；
 *   - **模板里没有权重**（2026-11-05 第 60 批）：权重由提报人在计划里逐项填，
 *     运营管理部审核可调；模板只管「考什么、怎么算分」，不管「各占多少」；
 *   - **监控段权重恒 0**，只扣分；
 *   - **停用不删除**：历史计划还引着它，删了追溯就断；
 *   - 提报时**整份拷贝**到计划里做快照，模板改动不影响已提报的计划。
 */
import { IS_MOCK, get, post, patch } from '@/api/client'
import * as mock from '@/utils/api'

/* ---------- 查询 ---------- */
export const queryPlanTpls = ({ kw = '', onlyEnabled = false } = {}) =>
  (IS_MOCK ? mock.planTplRows({ kw, onlyEnabled }) : get('/plan-templates', { kw, onlyEnabled }))

export const getPlanTplDetail = tplId =>
  (IS_MOCK ? mock.getPlanTpl(tplId) : get(`/plan-templates/${tplId}`))

export const planTplStats = () => (IS_MOCK ? mock.planTplSummary() : get('/plan-templates/stats'))

/** 按组织自动匹配模板（提报表单打开时先算一次，运营管理部可以改） */
export const planTplOfOrg = orgId =>
  (IS_MOCK ? mock.planTplForOrg(orgId) : get('/plan-templates/match', { orgId }))

/* ---------- 写 ---------- */
export const savePlanTpl = (payload, tplId = '') =>
  IS_MOCK
    ? mock.savePlanTpl(payload, tplId)
    : (tplId ? patch(`/plan-templates/${tplId}`, payload) : post('/plan-templates', payload))

export const togglePlanTpl = (tplId, enabled) =>
  (IS_MOCK ? mock.togglePlanTpl(tplId, enabled) : patch(`/plan-templates/${tplId}/enabled`, { enabled }))

/* ---------- 字典 / 派生 ---------- */
export {
  PLAN_DIRECTION_OPT, PLAN_SECTIONS,
  canEditPlanTpl, canViewPlanTpl, planTplCheck, planTplOpts
} from '@/utils/api'
