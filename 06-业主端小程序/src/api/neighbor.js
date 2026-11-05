/**
 * 邻里（内容侧）
 * ------------------------------------------------------------
 * 本期口径（2026-11-01 确认）：**物业发布 + 业主评论**。
 *   · 动态、活动、投票问卷 都是物业发起，业主只能参与（评论 / 报名 / 投票 / 点赞）；
 *   · 闲置转让本期内容为**存量数据（物业代发）**，业主只能看与联系，不开放发布 ——
 *     开放发布要接内容安全审核 + 人工审核队列，留到下一版。
 *
 * 所有写操作都是内存 + localStorage（store/app.js），与 mock 只读数据合并后返回。
 */
import { activities, activityEnrollments, neighborPosts, postComments, secondhandItems, surveys, surveyVotes } from '@pc/mock'
import { app } from '@/store/app'
import { stamp } from '@/config/demo'

const r2 = n => Math.round((Number(n) || 0) * 100) / 100

/* ---------------- 邻里动态 ---------------- */
export const POST_SORTS = [
  { key: 'new', label: '最新发布' },
  { key: 'hot', label: '最多点赞' },
  { key: 'comment', label: '最多评论' }
]

export function posts({ sort = 'new', category = '', communityId = '' } = {}) {
  const likes = app.postLikes
  const mine = app.comments.filter(c => c.status === '待审核').length
  return neighborPosts
    .filter(p => p.status === '已发布')
    .filter(p => !category || p.category === category)
    .filter(p => !communityId || p.communityId === communityId)
    .map(p => ({
      ...p,
      liked: !!likes[p.postId],
      likeCount: p.likeCount + (likes[p.postId] ? 1 : 0),
      commentCount: p.commentCount + app.comments.filter(c => c.postId === p.postId).length
    }))
    .sort((a, b) => {
      if (a.top !== b.top) return a.top ? -1 : 1
      if (sort === 'hot') return b.likeCount - a.likeCount
      if (sort === 'comment') return b.commentCount - a.commentCount
      return String(b.publishTime).localeCompare(String(a.publishTime))
    })
}

export const postCategories = () => [...new Set(neighborPosts.filter(p => p.status === '已发布').map(p => p.category))]

export const postOf = postId => posts().find(p => p.postId === postId) || null

/** 评论：已发布的直接展示；自己刚发的标"审核中"（先审后发） */
export function commentsOf(postId) {
  const seed = postComments
    .filter(c => c.postId === postId && c.status === '已发布')
    .map(c => ({ ...c, mine: false }))
  const mine = app.comments.filter(c => c.postId === postId).map(c => ({ ...c, mine: true }))
  return [...mine, ...seed].sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

/* ---------------- 社区活动 ---------------- */
export const ACTIVITY_TABS = [
  { key: 'doing', label: '进行中' },
  { key: 'past', label: '往期活动' },
  { key: 'mine', label: '我的活动' }
]

const myEnroll = activityId => app.enrollments.find(e => e.activityId === activityId && e.status !== '已取消') || null

export function activityList(tab = 'doing') {
  const list = activities.map(a => ({
    ...a,
    enrolledCount: activityEnrollments.filter(e => e.activityId === a.activityId).length + (myEnroll(a.activityId) ? 1 : 0),
    mine: !!myEnroll(a.activityId),
    full: activityEnrollments.filter(e => e.activityId === a.activityId).length >= a.capacity
  }))
  if (tab === 'past') return list.filter(a => a.status === '已结束')
  if (tab === 'mine') return list.filter(a => a.mine)
  return list.filter(a => a.status !== '已结束')
}

export function activityOf(id) {
  const a = activities.find(x => x.activityId === id)
  if (!a) return null
  const base = activityEnrollments.filter(e => e.activityId === id).length
  return {
    ...a,
    enrolledCount: base + (myEnroll(id) ? 1 : 0),
    mine: !!myEnroll(id),
    myEnroll: myEnroll(id),
    full: base >= a.capacity,
    left: Math.max(0, a.capacity - base - (myEnroll(id) ? 1 : 0))
  }
}

/* ---------------- 投票 / 问卷 ---------------- */
export const SURVEY_TABS = [
  { key: 'all', label: '全部' },
  { key: '投票', label: '投票' },
  { key: '问卷', label: '问卷' }
]

export function surveyList(tab = 'all') {
  return surveys
    .filter(s => tab === 'all' || s.type === tab)
    .map(s => ({ ...s, myVote: app.votes[s.surveyId] || null, voted: !!app.votes[s.surveyId] }))
    .sort((a, b) => (a.status === b.status ? String(b.startAt).localeCompare(String(a.startAt)) : a.status === '进行中' ? -1 : 1))
}

export function surveyOf(id) {
  const s = surveys.find(x => x.surveyId === id)
  if (!s) return null
  const mine = app.votes[id] || []
  /* 我的这一票要计入票数，否则投完数字不动会被当成没生效 */
  const options = s.options.map(o => ({
    ...o,
    votes: o.votes + (mine.includes(o.key) ? 1 : 0),
    pct: 0
  }))
  const total = options.reduce((n, o) => n + o.votes, 0) || 1
  options.forEach(o => (o.pct = r2((o.votes / total) * 100)))
  return { ...s, options, totalVotes: total + surveyVotes.filter(v => v.surveyId === id && !app.votes[id]).length * 0, myVote: mine, voted: mine.length > 0 }
}

/* ---------------- 闲置转让 ---------------- */
export const SH_CATS = ['全部', '家电', '家具', '母婴', '数码', '图书', '其他']
export const SH_SORTS = [
  { key: 'new', label: '最新' },
  { key: 'cheap', label: '价格低' },
  { key: 'want', label: '想要最多' }
]

export function secondhandList({ cat = '全部', sort = 'new' } = {}) {
  return secondhandItems
    .filter(i => i.status !== '已下架')
    .filter(i => cat === '全部' || i.category === cat)
    .map(i => ({ ...i, wanted: app.wants.includes(i.itemId), wantCount: i.wants + (app.wants.includes(i.itemId) ? 1 : 0) }))
    .sort((a, b) => {
      if ((a.status === '在售') !== (b.status === '在售')) return a.status === '在售' ? -1 : 1
      if (sort === 'cheap') return a.price - b.price
      if (sort === 'want') return b.wantCount - a.wantCount
      return String(b.publishAt).localeCompare(String(a.publishAt))
    })
}

export const secondhandOf = id => secondhandList().find(i => i.itemId === id) || null

export function shCommentsOf(itemId) {
  return app.secondhandComments.filter(c => c.itemId === itemId).map(c => ({ ...c, mine: true }))
}

/** 邻里首页聚合：一次拿齐四个子 tab 的入口数据（列表页首屏别闪四次） */
export function neighborSummary() {
  return {
    posts: posts({ sort: 'new' }).slice(0, 6),
    activities: activityList('doing').slice(0, 3),
    surveys: surveyList('all').filter(s => s.status === '进行中').slice(0, 3),
    items: secondhandList({ sort: 'new' }).slice(0, 8),
    myCounts: {
      enroll: app.enrollments.filter(e => e.status !== '已取消').length,
      vote: Object.keys(app.votes).length,
      comment: app.comments.length
    },
    at: stamp()
  }
}
