/**
 * 人脸 / 门禁的**纯规则**（批次 80）
 * ------------------------------------------------------------
 * 与 `park-rule.mjs` 同一个理由：`check:data` 用 node 直接跑，不能 import 带 uni/store 的模块。
 * 这一份只管三件事：状态机、提交限次、谁能代录 —— 数据从哪来、存哪去不在这里。
 *
 * 一条产品底线：**人脸不是开关，是"申请 + 核验"**。
 * 所以这里不提供"直接置为已生效"的函数；生效只能由物业核验动作触发（后台 H4）。
 */

/** 五态。顺序就是流程顺序，别按字典序排 —— UI 上要按它讲流程 */
export const FACE_STATUS = ['未采集', '待核验', '已生效', '已驳回', '已冻结']

/** 每主体 24 小时内最多提交 3 次：够改两次照片，不够刷接口 */
export const FACE_LIMIT_24H = 3

/** 状态文案与色调（页面只挑颜色，不要各自写一套） */
export function statusMeta(status) {
  switch (status) {
    case '已生效':
      return { label: status, tone: 'ok', desc: '刷脸即可通行单元门与车库' }
    case '待核验':
      return { label: status, tone: 'warn', desc: '物业正在核验，通过后刷脸通行' }
    case '已驳回':
      return { label: status, tone: 'danger', desc: '照片不合格，按原因重拍后可再提交' }
    case '已冻结':
      return { label: status, tone: 'muted', desc: '已停用（租约结束 / 主动撤回 / 成员移除）' }
    default:
      return { label: '未采集', tone: 'muted', desc: '还没有录入人脸，录完等物业核验' }
  }
}

/**
 * 能不能提交采集。
 *
 * - 待核验期间**不允许重复提交**：审核的人正在看那张照片，这个时候换一张，
 *   他看到的和系统里的就不是同一张了（这是人脸录入最常见的一类扯皮）；
 * - 驳回 / 未采集 / 已冻结 可以提交；
 * - 已生效也可以提交（重新采集），但页面要提示"核验期间原人脸继续有效"。
 */
export function canSubmit({ status, submits24h = 0 }) {
  if (status === '待核验') return { ok: false, why: '物业正在核验，通过或驳回后才能重新提交' }
  if (submits24h >= FACE_LIMIT_24H) {
    return { ok: false, why: `24 小时内最多提交 ${FACE_LIMIT_24H} 次，请明天再试` }
  }
  return { ok: true, why: '' }
}

/**
 * 业主能不能替这个成员录人脸。
 *
 * 门槛是**成员关系已经核验**：没核验就录脸，等于让任何人填个名字就能给别人开门。
 * 这也正是"帮老人孩子录"必须先走成员登记的原因。
 */
export function canEnrollMember(member) {
  if (!member) return { ok: false, why: '成员不存在' }
  if (member.certified) return { ok: true, why: '' }
  return { ok: false, why: '成员资料待物业核验，核验后才能帮他录人脸' }
}

/** 提交后状态恒为「待核验」—— 不给"提交即生效"留后门 */
export const STATUS_AFTER_SUBMIT = '待核验'
