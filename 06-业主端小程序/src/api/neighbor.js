/**
 * 邻里（内容侧）· 四频道：公告 / 投票 / 活动 / 闲置
 * ------------------------------------------------------------
 * 口径来源：`02-原型设计/交接单-业主端小程序.md` §12（第 68 批，后台已完成，业主端按此接）。
 *
 * 五条不能自己发明的规矩（原文见 §12.3）：
 *  1. **公告 = 同一张表**（`notices`）。只同步「已发布」，草稿 / 待审核 / 已撤回都不同步；
 *     阅读数与对象户数直接用公告自带的 `readCount / targetHouses`，业主端不另算一套。
 *  2. **投票只做意见征询**，结果里**不能出现「通过 / 未通过」** —— 它不产生《民法典》278 条的效力；
 *     参与率按**户**算（租户不计）。比例用**选项票数求和**当分子，不用 `totalVotes`
 *     （后台已对票数做过上限归一，种子票数会出现「310 票 / 189 户」这种硬伤）。
 *  3. **收费活动三条硬约束**：成团下限、退款分档、投保开关。
 *     证件号**只在 needInsurance 时收集**，且用途只写"购买当日意外险"。
 *  4. **闲置先审后发**，驳回必带理由（业主看得到那句）；展示只到**楼栋**，不显示门牌；
 *     手机号默认不公开，走站内私信。
 *  5. **不做话题广场、不做跟帖、不做公开评论墙** —— 这是类目红线，不是产品取舍。
 *     所以本文件里没有 `commentsOf` / `postOf`：上一版的「邻里动态」已按 §12.2 废弃。
 *
 * 数据来自 `04-契约/fixtures`（后台种子导出的同一批数据），不另造一份：
 *   neighbor-activities.json 17 场（含 5 场收费，状态覆盖 报名中/待成行/已成行）
 *   neighbor-items.json      34 条（已上架 20 / 待审核 8 / 已驳回 3 / 已下架 2 / 已过期 1）
 *   neighbor-enrolls.json   268 条报名（用来算"已报名人数"与成团进度）
 *   neighbor-votes.json       6 条投票（第 70 批从 surveys 投影出来，含 multi / maxPick）
 *
 * 第 76 批起，接口模式下这四类**公共列表**（公告 / 投票 / 活动 / 闲置）走
 * `/mp/neighbor/{notices,votes,activities,items}`，读不到时才回落到上面这些本地数据。
 * 写操作（已读 / 签收 / 投票 / 报名 / 发布 / 想要 / 私信）在批 D 就已经切走了。
 */
import { buildings, communities, houses, notices, surveys } from '@pc/mock'
import rawActivities from '@contract/neighbor-activities.json'
import rawItems from '@contract/neighbor-items.json'
import rawEnrolls from '@contract/neighbor-enrolls.json'
import { app, persist } from '@/store/app'
import { DEMO, stamp } from '@/config/demo'
import { canEnroll, phaseOf as phaseRule } from './activity-rule.mjs'
import { refundAmountOf, refundRatioOf } from './refund-rule.mjs'
import { IS_API, post } from './client'
import { refreshNeighbor, remoteNeighbor, remoteNeighborLists, remoteReady } from './remote'

/**
 * 批 D：把"我的状态"从本地换成服务端快照。
 *
 * 只换**状态**（读过 / 签收 / 投了 / 想要 / 报名 / 我发布的），**不换公共列表** ——
 * 公告列表、投票列表、闲置列表仍读本地数据。这样：
 *   ① 页面里 `notice.read`、`item.wanted` 这些判断一行都不用改；
 *   ② 写操作（投票、报名、发布）立刻能在"我的"里看到；
 *   ③ 公共列表什么时候切，是另一批的事，不会把这一批拖成"全站改造"。
 */
const NB = () => (remoteReady() ? remoteNeighbor() : null)
const readMap = () => NB()?.noticeReads || app.noticeReads
const signMap = () => NB()?.noticeSigns || app.noticeSigns
const voteMap = () => NB()?.votes || app.votes
const wantList = () => NB()?.wants || app.wants
/** 我发布的闲置：服务端优先（本地那份只在没开接口时用） */
const myItemRows = () => (NB() ? NB().items || [] : app.itemPosts)
/** 我的报名：同上 */
const myEnrollRows = () => (NB() ? NB().enrolls || [] : app.enrollments)
/** 四类公共内容（第 76 批）：接口模式下由快照提供，读不到回落本地 */
const NVL = () => (remoteReady() ? remoteNeighborLists() : null)

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/* ============================ 一、公告 ============================ */

export const NOTICE_TYPES = ['全部', '停水停电', '收费通知', '安全提示', '维修施工', '政策公告', '社区活动']

/** 已认证时按已绑项目收敛；游客看全部（演示环境只有 3 个项目） */
function myCommunityIds() {
  const ids = app.bindings.map(b => houses.find(h => h.houseId === b.houseId)?.communityId).filter(Boolean)
  return [...new Set(ids)]
}

export function noticeList({ type = '全部', communityId = '' } = {}) {
  const rows = NVL()?.notices
  if (rows) {
    /* 服务端已经按「已发布 + 可见范围」筛好并排好序（置顶在前），
       这里只做频道筛选，**不重排** —— 两边各排一次，顺序迟早不一样 */
    return rows
      .filter(n => !communityId || n.communityId === communityId)
      .filter(n => type === '全部' || n.type === type)
      .map(noticeRemoteView)
  }
  const mine = communityId ? [communityId] : myCommunityIds()
  return notices
    /* 只同步「已发布」：草稿 / 待审核 / 已撤回不该出现在业主端（§12.3 第 1 条） */
    .filter(n => n.status === '已发布')
    .filter(n => !mine.length || mine.includes(n.communityId))
    .filter(n => type === '全部' || n.type === type)
    .map(n => ({
      ...n,
      read: !!readMap()[n.noticeId],
      signed: !!signMap()[n.noticeId],
      /* 自己看过的那一次也算一次阅读：否则点进去数字不动，像没生效 */
      readCount: (n.readCount || 0) + (readMap()[n.noticeId] ? 1 : 0),
      expireText: n.publishTime
    }))
    .sort((a, b) => {
      if (a.top !== b.top) return a.top ? -1 : 1
      return String(b.publishTime).localeCompare(String(a.publishTime))
    })
}

export function noticeOf(noticeId) {
  const rows = NVL()?.notices
  if (rows) {
    const hit = rows.find(x => x.noticeId === noticeId)
    return hit ? noticeRemoteView(hit) : null
  }
  const n = notices.find(x => x.noticeId === noticeId && x.status === '已发布')
  if (!n) return null
  return {
    ...n,
    read: !!readMap()[noticeId],
    signed: !!signMap()[noticeId],
    signedAt: signMap()[noticeId] || '',
    readCount: (n.readCount || 0) + (readMap()[noticeId] ? 1 : 0),
    /* 附件只有一个数量字段：没有文件名就不假装能下载，页面写"附件 N 个（演示环境不提供下载）" */
    attachmentCount: Number(n.attachments) || 0
  }
}

/** 打开即记已读（幂等）；签收是业主主动动作，单独记 */
export async function markNoticeRead(noticeId) {
  if (!noticeId) return
  if (IS_API) {
    /* 服务端是幂等的（重复已读不刷时间），所以这里不用先判"读过没有" */
    await post(`/mp/neighbor/notices/${noticeId}/read`)
    /* 只会改"已读 / 未读"：不必把四个列表一起重拉 */
    await refreshNeighbor(['mine', 'notices'])
    return
  }
  if (app.noticeReads[noticeId]) return
  app.noticeReads[noticeId] = stamp()
  persist()
}

export async function signNotice(noticeId) {
  if (!noticeId) return false
  if (IS_API) {
    await post(`/mp/neighbor/notices/${noticeId}/sign`)
    await refreshNeighbor(['mine', 'notices'])
    return true
  }
  app.noticeSigns[noticeId] = stamp()
  app.noticeReads[noticeId] = app.noticeReads[noticeId] || stamp()
  persist()
  return true
}

/** 未读条数（首页/我的角标用） */
export const unreadNoticeCount = () => noticeList().filter(n => !n.read).length

/* ============================ 二、投票（意见征询） ============================ */

export const VOTE_TABS = [
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已结束' },
  { key: 'mine', label: '我参与过' }
]

/** 应投户数：该项目下有房号的业主去重数。租户不计 —— 征询的是产权人意见 */
function targetHouseholds(communityId) {
  return new Set(houses.filter(h => h.communityId === communityId && h.ownerId).map(h => h.ownerId)).size
}

function voteBase(s) {
  const mine = voteMap()[s.surveyId] || []
  /* 我投的那一票要算进去，否则投完数字不动会被当成没生效 */
  const options = s.options.map(o => ({
    ...o,
    votes: (Number(o.votes) || 0) + (mine.includes(o.key) ? 1 : 0)
  }))
  /* §12.5：比例用**选项票数求和**，不要用 survey.totalVotes（种子里两者能差出 100+ 票） */
  const total = options.reduce((n, o) => n + o.votes, 0)
  const target = targetHouseholds(s.communityId)
  /* 分母兜底：参与率不可能超过 100%，种子里出现过 310 票 / 189 户 */
  const base = Math.max(target, total, 1)
  /* 选项占比按**票数**算（合计 100%）；参与率另算（票数/应投户数）。
     两者混用会让"饼图加起来 46%"这种页面出现 —— 一眼就不可信。 */
  options.forEach(o => (o.pct = total ? r2((o.votes / total) * 100) : 0))
  const gap = Math.round((new Date(`${s.endAt}T00:00:00`) - new Date(`${DEMO.today}T00:00:00`)) / 86400000)
  return {
    ...s,
    multi: !!s.multi,
    maxPick: Number(s.maxPick) || (s.multi ? 2 : 1),
    anonymous: s.anonymous !== false,
    resultVisibility: s.resultVisibility || '投票后可见',
    options,
    target,
    totalVotes: total,
    /* 单选：参与率 = 票数 / 应投户数；多选：一票多选，票数会超过户数，只说"共 N 票" */
    partRate: r2((total / base) * 100),
    partRateText: s.multi ? `共 ${total} 票（多选，按人次）` : `参与率 ${r2((total / base) * 100)}% · ${total}/${target} 户`,
    myVote: mine,
    voted: mine.length > 0,
    daysLeft: gap,
    deadlineText: gap > 0 ? `剩 ${gap} 天` : gap === 0 ? '今天截止' : '已截止',
    /* 投完才看结果：未投且未结束 → 只看题目与选项，不给票数（避免从众） */
    canSeeResult: mine.length > 0 || s.status === '已结束' || (s.resultVisibility || '') === '公开'
  }
}

export function voteList({ tab = 'doing' } = {}) {
  const rows = NVL()?.votes
  if (rows) {
    const list = rows.map(voteRemoteView)
    if (tab === 'done') return list.filter(s => s.status === '已结束')
    if (tab === 'mine') return list.filter(s => s.voted)
    return list.filter(s => s.status !== '已结束')
  }
  const list = surveys.map(voteBase)
  if (tab === 'done') return list.filter(s => s.status === '已结束')
  if (tab === 'mine') return list.filter(s => s.voted)
  return list.filter(s => s.status !== '已结束')
}

export const voteOf = id => {
  const rows = NVL()?.votes
  if (rows) {
    const hit = rows.find(x => x.voteId === id)
    return hit ? voteRemoteView(hit) : null
  }
  const s = surveys.find(x => x.surveyId === id)
  return s ? voteBase(s) : null
}

/**
 * 投票提交。
 * 单选最多 1 项、多选最多 maxPick 项；已结束不能投；重复投票覆盖旧票（演示态允许改票）。
 */
/**
 * 我投过哪些（投票 id 列表）。
 * 页面不要直接 `Object.keys(app.votes)` —— 接口模式下票在服务端快照里，
 * 读本地那份永远是空的（批 D 差点漏掉：列表页显示"我投的 0 条"）。
 */
export const myVoteIds = () => Object.keys(voteMap())

export async function castVote(surveyId, keys = []) {
  if (IS_API) {
    /* 选项合法性、单选上限、改票差额都交给服务端 —— 客户端再判一遍是两套规则 */
    const r = await post(`/mp/neighbor/votes/${surveyId}/submit`, { keys })
    /* 票数变了，我的投票状态也变了；活动与闲置不受影响 */
    await refreshNeighbor(['mine', 'votes'])
    return voteOf(surveyId) || r
  }
  const s = voteOf(surveyId)
  if (!s) throw new Error('投票不存在')
  if (s.status === '已结束') throw new Error('该投票已结束')
  const picked = [...new Set((keys || []).filter(Boolean))]
  if (!picked.length) throw new Error('请至少选择一项')
  const limit = s.multi ? s.maxPick : 1
  if (picked.length > limit) throw new Error(`最多选 ${limit} 项`)
  if (picked.some(k => !s.options.some(o => o.key === k))) throw new Error('选项不存在')
  app.votes[surveyId] = picked
  persist()
  return voteOf(surveyId)
}

/* ============================ 三、社区活动 ============================ */

export const ACTIVITY_TABS = [
  { key: 'open', label: '报名中' },
  { key: 'wait', label: '待成行' },
  { key: 'ready', label: '已成行' },
  { key: 'past', label: '往期' }
]

const PHASE_TONE = {
  报名中: 'var(--biz-primary)',
  待成行: 'var(--biz-warning)',
  已成行: 'var(--biz-accent-dark)',
  已流团: 'var(--biz-danger)',
  已结束: 'var(--biz-text-3)'
}
export const phaseTone = p => PHASE_TONE[p] || 'var(--biz-text-3)'

/** 已报名人数（含同行人，不含已取消/已退款）；本地报名也算 */
function enrolledOf(activityId) {
  const base = rawEnrolls
    .filter(e => e.activityId === activityId && !['已取消', '已退款'].includes(e.status))
    .reduce((s, e) => s + (Number(e.people) || 1), 0)
  const mine = myEnrollRows()
    .filter(e => e.activityId === activityId && !['已取消', '已退款'].includes(e.status))
    .reduce((s, e) => s + (Number(e.people) || 1), 0)
  return base + mine
}

/* 阶段判定在 activity-rule.mjs（纯函数）：业主端与 check:data 用同一份，
   否则"页面说待成行、自检说报名中"这种分歧永远发现不了。 */

const mineEnrollOf = activityId =>
  myEnrollRows().find(e => e.activityId === activityId && !['已取消', '已退款'].includes(e.status)) || null

function activityView(a) {
  const enrolled = enrolledOf(a.activityId)
  const min = Number(a.minCapacity) || 0
  const phase = phaseRule(a, enrolled, DEMO.today)
  const mine = mineEnrollOf(a.activityId)
  return {
    ...a,
    fee: Number(a.fee) || 0,
    /* 与契约同一口径：免费 / 收费。类别在 a.category 里，两者正交 */
    feeType: Number(a.fee) > 0 ? '收费' : '免费',
    feeText: Number(a.fee) > 0 ? `¥${r2(a.fee)}/人` : '免费',
    enrolled,
    left: Math.max(0, (Number(a.capacity) || 0) - enrolled),
    fillRate: a.capacity ? Math.min(100, r2((enrolled / a.capacity) * 100)) : 0,
    gap: min ? Math.max(0, min - enrolled) : 0,
    phase,
    phaseTone: phaseTone(phase),
    /* 待成行 / 已成行 / 已流团 / 已结束 都不能再报名 —— 这是 §12.6 第一个坑 */
    canEnroll: canEnroll(phase, enrolled, a.capacity),
    needInsurance: !!a.needInsurance,
    attendeeLimit: Number(a.attendeeLimit) || 2,
    refundPolicy: a.refundPolicy || [],
    myEnroll: mine,
    mine: !!mine
  }
}

export function activityList(tab = 'open') {
  const map = { open: '报名中', wait: '待成行', ready: '已成行' }
  const rows = NVL()?.activities
  const list = rows ? rows.map(activityRemoteView) : rawActivities.map(activityView)
  if (tab === 'past') return list.filter(a => ['已结束', '已流团'].includes(a.phase))
  return list.filter(a => a.phase === map[tab])
}

export function activityOf(id) {
  const rows = NVL()?.activities
  if (rows) {
    const hit = rows.find(x => x.activityId === id)
    return hit ? activityRemoteView(hit) : null
  }
  const a = rawActivities.find(x => x.activityId === id)
  return a ? activityView(a) : null
}

/** 全部（首页横滑用）：报名中优先，其次待成行/已成行 */
export function activityFeed(limit = 4) {
  const order = { 报名中: 0, 待成行: 1, 已成行: 2 }
  const rows = NVL()?.activities
  return (rows || rawActivities)
    .map(rows ? activityRemoteView : activityView)
    .filter(a => order[a.phase] !== undefined)
    .sort((a, b) => (order[a.phase] - order[b.phase]) || String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, limit)
}

/** 某场活动在我这个时点取消的退款比例（与后台同一函数，§12.7 第 4 条） */
export function myRefundOf(activity) {
  if (!activity) return { ratio: 0, amount: 0 }
  const ratio = refundRatioOf(activity.refundPolicy, activity.startAt, DEMO.today)
  const people = Number(activity.myEnroll?.people) || 1
  return { ratio, amount: refundAmountOf(activity.fee, people, ratio) }
}

/**
 * 报名。
 * @param {string} activityId
 * @param {{attendees:Array, agreeTerms:boolean, agreeInsurance:boolean}} payload
 * @returns 报名记录（收费活动带 payStatus='待支付'，由 pay 页模拟支付）
 */
export async function enrollActivity(activityId, { attendees = [], agreeTerms = false, agreeInsurance = false } = {}) {
  if (IS_API) {
    const row = await post(`/mp/neighbor/activities/${activityId}/enroll`, { attendees, agreeTerms, agreeInsurance })
    /* 名额与成团进度都在活动列表里，必须刷它 */
    await refreshNeighbor(['mine', 'activities'])
    return row
  }
  const a = activityOf(activityId)
  if (!a) throw new Error('活动不存在')
  if (a.phase === '待成行') throw new Error('报名已截止且未达成团人数，暂不能报名')
  if (a.phase === '已成行') throw new Error('报名已截止，活动已成行')
  if (a.phase === '已流团') throw new Error('活动已流团，费用已全额退回')
  if (a.phase !== '报名中') throw new Error('该活动不在报名中')
  if (a.mine) throw new Error('您已经报过名了')
  if (a.left <= 0) throw new Error('名额已满')
  const list = (attendees || []).filter(x => x && String(x.name || '').trim())
  if (!list.length) throw new Error('至少填一位出行人')
  if (list.length > a.attendeeLimit) throw new Error(`最多 ${a.attendeeLimit} 位出行人`)
  for (const p of list) {
    if (!/^[\u4e00-\u9fa5·]{2,12}$/.test(String(p.name || '').trim())) throw new Error('出行人姓名需为 2~12 个汉字')
    if (!/^1\d{10}$/.test(String(p.phone || '').trim())) throw new Error('出行人手机号格式不正确')
    /* 证件号只在投保时需要：不投保的活动不收，收了就是多余的个人信息（§12.3 第 3 条） */
    if (a.needInsurance && !/^\d{17}[\dXx]$/.test(String(p.idNo || '').trim())) {
      throw new Error('本活动为出行人投保，需填 18 位身份证号')
    }
  }
  if (!agreeTerms) throw new Error('请先阅读并同意活动条款')
  if (a.needInsurance && !agreeInsurance) throw new Error('需同意为出行人购买当日意外险')

  const people = list.length
  const amount = r2(a.fee * people)
  const row = {
    enrollId: `AE${String(9000 + app.enrollments.length + 1)}`,
    activityId,
    activityTitle: a.title,
    activityStart: a.startAt,
    communityId: a.communityId,
    name: list[0].name,
    phone: list[0].phone,
    people,
    attendees: list.map(p => ({
      name: String(p.name).trim(),
      phone: String(p.phone).trim(),
      /* 不投保就不落证件号 —— 存了就是白担风险 */
      idNo: a.needInsurance ? String(p.idNo || '').trim().toUpperCase() : '',
      ageType: p.ageType || '成人',
      emergencyName: String(p.emergencyName || '').trim(),
      emergencyPhone: String(p.emergencyPhone || '').trim()
    })),
    /* 后台代报名会标「前台代报」；业主自己报的标「业主自助」，两边在「我的活动」里要能区分 */
    source: '业主自助',
    at: stamp(),
    status: '已报名',
    fee: a.fee,
    amount,
    payStatus: a.fee > 0 ? '待支付' : '无需支付'
  }
  app.enrollments.unshift(row)
  persist()
  return row
}

/**
 * 取消报名。
 * 收费活动要同时算退款：页面**先展示比例与金额**再提交（§12.4），
 * 这里只算、不产生真实退款流水（演示态）。
 */
export async function cancelActivityEnroll(activityId) {
  if (IS_API) {
    const e = mineEnrollOf(activityId)
    if (!e) throw new Error('没有可取消的报名')
    const r = await post(`/mp/neighbor/enrolls/${e.enrollId}/cancel`)
    await refreshNeighbor(['mine', 'activities'])
    return { ratio: r.ratio, amount: r.refundAmount, full: Number(e.amount) || 0, refunded: r.refunded }
  }
  const a = activityOf(activityId)
  const e = mineEnrollOf(activityId)
  if (!a || !e) throw new Error('没有可取消的报名')
  if (e.status === '已签到') throw new Error('已签到的报名不能自助取消，请联系客服')
  const { ratio, amount } = myRefundOf(a)
  app.enrollments = app.enrollments.map(x =>
    x.enrollId === e.enrollId
      ? { ...x, status: a.fee > 0 ? '已退款' : '已取消', refundRatio: ratio, refundAmount: amount, cancelledAt: stamp() }
      : x
  )
  persist()
  return { ratio, amount, full: a.fee, refunded: a.fee > 0 }
}

/** 读「我的报名」（含本地新增），按时间倒序 */
export function myEnrollments() {
  return myEnrollRows()
    .slice()
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .map(e => {
      const a = activityOf(e.activityId)
      return {
        ...e,
        activity: a,
        canCancel: ['已报名', '待支付'].includes(e.status) && !!a && ['报名中', '待成行'].includes(a.phase)
      }
    })
}

/* ============================ 四、闲置（先审后发） ============================ */

export const ITEM_CATS = ['全部', '家电', '家具', '母婴', '数码', '图书', '其他']
export const ITEM_SORTS = [
  { key: 'new', label: '最新' },
  { key: 'cheap', label: '价格低' },
  { key: 'want', label: '想要最多' }
]

/** 展示只到楼栋：把 `P01-012-0302` 这样的房号串还原成「1栋」，绝不带门牌（§12.3 第 4 条） */
const BUILDING_OF_SHORT = new Map(houses.map(h => [h.shortName, h.buildingId]))
/* 楼栋名只能取 buildings.name（"1栋"）。**不能**从 fullName 里切 ——
   fullName 是「翡翠城 1栋2单元1102」，切出来直接把单元和门牌带出去（真踩过）。 */
const BUILDING_NAME = new Map(buildings.map(b => [b.buildingId, b.name]))
export function buildingOnly(sellerHouse) {
  const bid = BUILDING_OF_SHORT.get(sellerHouse)
  if (bid && BUILDING_NAME.get(bid)) return BUILDING_NAME.get(bid)
  /* 对不上就只说小区：宁可模糊，也不能把门牌漏出去 */
  return '同小区'
}

const itemView = i => ({
  ...i,
  buildingText: buildingOnly(i.sellerHouse),
  wanted: wantList().includes(i.itemId),
  wantCount: (Number(i.wants) || 0) + (wantList().includes(i.itemId) ? 1 : 0),
  contactMode: i.contactMode || '站内私信'
})

/** 公开列表：只给「已上架」。待审核 / 已驳回 / 已下架 / 已过期 都不该被邻居看到 */
export function itemList({ cat = '全部', sort = 'new' } = {}) {
  const rows = NVL()?.items
  if (rows) {
    /* 服务端只回「已上架 + 可见范围」，排序与分类在客户端做（一次拉全，切分类不打请求） */
    return rows
      .map(itemRemoteView)
      .filter(i => cat === '全部' || i.category === cat)
      .sort((a, b) => {
        if (sort === 'cheap') return a.price - b.price
        if (sort === 'want') return b.wantCount - a.wantCount
        return String(b.publishAt).localeCompare(String(a.publishAt))
      })
  }
  const mine = myCommunityIds()
  return rawItems
    .filter(i => i.status === '已上架')
    .filter(i => !mine.length || mine.includes(i.communityId))
    .filter(i => cat === '全部' || i.category === cat)
    .map(itemView)
    .sort((a, b) => {
      if (sort === 'cheap') return a.price - b.price
      if (sort === 'want') return b.wantCount - a.wantCount
      return String(b.publishAt).localeCompare(String(a.publishAt))
    })
}

export function itemOf(id) {
  const rows = NVL()?.items
  if (rows) {
    /* 自己的待审 / 已驳回 在 `myItems()` 里（服务端只把已上架的放进公共列表）；
       所以先查公共列表，再查"我发布的" */
    const hit = rows.find(x => x.itemId === id) || myItemRows().find(x => x.itemId === id)
    return hit ? itemRemoteView(hit) : null
  }
  const i = rawItems.find(x => x.itemId === id) || myItemRows().find(x => x.itemId === id)
  if (!i) return null
  /* 自己的待审内容自己能看；别人的待审内容一律当不存在（避免"换个 id 看未审"） */
  if (i.status !== '已上架' && !isMyItem(i)) return null
  return itemView(i)
}

const isMyItem = i => {
  if (i.mine) return true
  const ownerIds = app.bindings.map(b => b.ownerId).filter(Boolean)
  return !!i.ownerId && ownerIds.includes(i.ownerId)
}

/* ---- 发布（先审后发） ---- */
/** 敏感词只做"明显违规"的第一道闸；真实环境要接微信 msgSecCheck（这里写明，不假装做了） */
const BLOCK_WORDS = ['茅台', '香烟', '发票', '贷款', '枪支', '管制刀具', '活体', '代购', '药酒']

export function checkItemText(title, desc = '') {
  const text = `${title} ${desc}`
  const hit = BLOCK_WORDS.find(w => text.includes(w))
  if (hit) return { ok: false, reason: `内容含「${hit}」，属平台禁售范围，请修改后再发` }
  if (String(title).trim().length < 4) return { ok: false, reason: '标题至少 4 个字，邻居才知道是什么' }
  return { ok: true, reason: '' }
}

/**
 * 发布闲置。
 * @param {{title:string, category:string, condition:string, price:number, images:number, buildingId:string, contactMode:string, desc?:string}} p
 * 状态一律「待审核」：审核在员工端（客服/楼管），业主端只提交与看状态。
 */
export async function publishItem(p = {}) {
  if (IS_API) {
    const row = await post('/mp/neighbor/items', {
      title: String(p.title || '').trim(),
      category: p.category || '其他',
      price: Number(p.price) || 0,
      originPrice: Number(p.originPrice) || 0,
      condition: p.condition || '九成新',
      images: Number(p.images) || 0,
      buildingId: p.buildingId,
      desc: String(p.desc || '').trim(),
      contactMode: p.contactMode === '公开' ? '公开' : '站内私信'
    })
    /* 新发的是「待审核」，进不了公共列表 —— 只有"我发布的"会变 */
    await refreshNeighbor(['mine'])
    return { ...row, mine: true }
  }
  const title = String(p.title || '').trim()
  const desc = String(p.desc || '').trim()
  const check = checkItemText(title, desc)
  if (!check.ok) throw new Error(check.reason)
  const price = Number(p.price)
  if (!Number.isFinite(price) || price < 0) throw new Error('价格填一个数字，送人可以填 0')
  if (String(desc).length > 300) throw new Error('描述最多 300 字')
  const images = Number(p.images) || 0
  if (images > 9) throw new Error('图片最多 9 张')
  if (!p.buildingId) throw new Error('请选择所在楼栋')

  const h = houses.find(x => x.buildingId === p.buildingId)
  const communityId = p.communityId || h?.communityId || ''
  const ownerId = app.bindings.find(b => houses.find(x => x.houseId === b.houseId)?.communityId === communityId)?.ownerId || ''
  const row = {
    itemId: `SH${String(9000 + app.itemPosts.length + 1)}`,
    title,
    category: p.category || '其他',
    price,
    originPrice: Number(p.originPrice) || 0,
    condition: p.condition || '九成新',
    images,
    desc,
    communityId,
    sellerName: `${(app.session?.name || '业主').slice(0, 1)}**`,
    /* 存的是房号串，**展示时只取楼栋**（buildingOnly），不把门牌漏给邻居 */
    sellerHouse: h ? h.shortName : '',
    publishAt: stamp(),
    status: '待审核',
    views: 0,
    wants: 0,
    source: '业主发布',
    sellerType: app.bindings[0]?.identity === '租客' ? '租户' : '业主',
    contactMode: p.contactMode === '公开' ? '公开' : '站内私信',
    rejectReason: '',
    expireAt: '',
    reportCount: 0,
    reviewer: '',
    reviewedAt: '',
    mine: true,
    ownerId
  }
  app.itemPosts.unshift(row)
  persist()
  return row
}

/** 我能选的楼栋：只在自己已绑房产所在楼栋里选（发布闲置用，展示也只到这一级） */
export function myBuildings() {
  const ids = [...new Set(app.bindings.map(b => houses.find(h => h.houseId === b.houseId)?.buildingId).filter(Boolean))]
  return ids.map(id => {
    const b = buildings.find(x => x.buildingId === id)
    const c = houses.find(h => h.buildingId === id)
    return {
      buildingId: id,
      name: b?.name || '',
      communityId: c?.communityId || '',
      communityName: communities.find(x => x.communityId === c?.communityId)?.name || ''
    }
  })
}

export const myItems = () =>
  myItemRows().slice().sort((a, b) => String(b.publishAt).localeCompare(String(a.publishAt)))

export async function offlineMyItem(itemId) {
  if (IS_API) {
    await post(`/mp/neighbor/items/${itemId}/offline`)
    await refreshNeighbor(['mine', 'items'])
    return
  }
  app.itemPosts = app.itemPosts.map(i => (i.itemId === itemId ? { ...i, status: '已下架', offlineAt: stamp() } : i))
  persist()
}

/** 已下架/已过期可以重新上架：内容没改，直接回「待审核」等物业复核 */
export async function renewMyItem(itemId) {
  if (IS_API) {
    await post(`/mp/neighbor/items/${itemId}/renew`)
    await refreshNeighbor(['mine', 'items'])
    return
  }
  app.itemPosts = app.itemPosts.map(i =>
    i.itemId === itemId ? { ...i, status: '待审核', renewAt: stamp(), rejectReason: '' } : i
  )
  persist()
}

export async function toggleWant(itemId) {
  if (IS_API) {
    const r = await post(`/mp/neighbor/items/${itemId}/want`)
    await refreshNeighbor(['mine', 'items'])
    return r.want
  }
  const i = app.wants.indexOf(itemId)
  if (i >= 0) app.wants.splice(i, 1)
  else app.wants.push(itemId)
  persist()
  return i < 0
}

/** 站内私信：只留"发送过"这条事实，不做 IM（类目与运维都不允许，见 §12.3 第 5 条） */
export async function sendMessage(itemId, text, quick = '') {
  if (IS_API) {
    const content = String(text || quick || '').trim()
    if (!content) throw new Error('写一句话再发')
    const r = await post(`/mp/neighbor/items/${itemId}/messages`, { content })
    return { ...r, itemId, content }
  }
  const content = String(text || quick || '').trim()
  if (!content) throw new Error('写一句话再发')
  if (content.length > 200) throw new Error('消息最多 200 字')
  const row = { msgId: `MS${Date.now()}`, itemId, content, at: stamp() }
  app.messages.unshift(row)
  persist()
  return row
}

/* ============================ 四·五、服务端投影 ============================ */
/*
 * 接口模式下四个列表/详情都走这里整形，**页面不用改**。
 * 分工是刻意的：
 *   - 服务端负责「能不能看见」（社区范围、未投不给票数、闲置只到楼栋）；
 *   - 客户端负责「怎么显示」（占比、倒计时、阶段、色调）。
 * 两边都做一遍的后果是，规则迟早会在某一处改漏。
 */

function noticeRemoteView(n) {
  return {
    ...n,
    /* 服务端返回的 readCount **已含自己这一次**，这里再加 1 就多了一条 */
    attachmentCount: Number(n.attachments) || 0,
    expireText: n.publishTime
  }
}

function voteRemoteView(r) {
  const options = (r.options || []).map(o => ({ ...o }))
  const total = options.reduce((n, o) => n + (Number(o.votes) || 0), 0)
  /* 分母兜底与服务端一致：参与率不可能超过 100% */
  const target = Math.max(Number(r.target) || 0, total)
  const base = Math.max(target, total, 1)
  options.forEach(o => (o.pct = total ? r2((o.votes / total) * 100) : 0))
  const gap = Math.round((new Date(`${r.endAt}T00:00:00`) - new Date(`${DEMO.today}T00:00:00`)) / 86400000)
  const rate = r2((total / base) * 100)
  return {
    ...r,
    /* 接口层主键叫 voteId，页面到处是 surveyId —— 映射一次，别去改页面 */
    surveyId: r.voteId,
    multi: !!r.multi,
    maxPick: Number(r.maxPick) || (r.multi ? 2 : 1),
    anonymous: r.anonymous !== false,
    options,
    target,
    totalVotes: total,
    partRate: rate,
    partRateText: r.multi ? `共 ${total} 票（多选，按人次）` : `参与率 ${rate}% · ${total}/${target} 户`,
    voted: !!r.voted,
    myVote: r.myVote || [],
    daysLeft: gap,
    deadlineText: gap > 0 ? `剩 ${gap} 天` : gap === 0 ? '今天截止' : '已截止',
    canSeeResult: !!r.canSeeResult
  }
}

function activityRemoteView(r) {
  const enrolled = Number(r.enrolled) || 0
  const capacity = Number(r.capacity) || 0
  const min = Number(r.minCapacity) || 0
  /* 阶段在客户端算：服务端数据日是 10-21、演示时钟是 10-20，
     两边各算一份会在临界那天打架（样例 AC0015 的截止日正好是 10-20） */
  const phase = phaseRule(r, enrolled, DEMO.today)
  return {
    ...r,
    fee: Number(r.fee) || 0,
    feeType: Number(r.fee) > 0 ? '收费' : '免费',
    feeText: Number(r.fee) > 0 ? `¥${r2(r.fee)}/人` : '免费',
    enrolled,
    left: Math.max(0, capacity - enrolled),
    fillRate: capacity ? Math.min(100, r2((enrolled / capacity) * 100)) : 0,
    gap: min ? Math.max(0, min - enrolled) : 0,
    phase,
    phaseTone: phaseTone(phase),
    canEnroll: canEnroll(phase, enrolled, capacity),
    mine: !!r.mine,
    myEnroll: r.myEnroll || null
  }
}

function itemRemoteView(r) {
  return {
    ...r,
    /* 只到楼栋。服务端没解析出来时回「同小区」—— 宁可模糊，也不能把门牌漏出去 */
    buildingText: r.buildingName || '同小区',
    /* wantCount 服务端已含自己那一次，不要再加 */
    wanted: !!r.wanted
  }
}

/** 邻里角标（待审发布 / 待支付报名 / 已投票 / 在架闲置）：接口模式读服务端 counts */
export const myNeighborCounts = () => (NB()
  ? NB().counts
  : {
      enroll: app.enrollments.filter(e => !['已取消', '已退款'].includes(e.status)).length,
      vote: Object.keys(app.votes).length,
      item: app.itemPosts.length,
      want: app.wants.length
    })

/* ============================ 五、聚合 ============================ */

/** 邻里首页聚合：一次拿齐四个频道的前几条（列表首屏别闪四次） */
export function neighborSummary() {
  return {
    notices: noticeList().slice(0, 3),
    votes: voteList({ tab: 'doing' }).slice(0, 2),
    activities: activityFeed(3),
    items: itemList({ sort: 'new' }).slice(0, 6),
    /* 角标取服务端的 counts：本地那份在接口模式下是空的（写操作都落在服务端） */
    myCounts: myNeighborCounts(),
    unreadNotice: unreadNoticeCount(),
    at: stamp()
  }
}

export { myCommunityIds }
