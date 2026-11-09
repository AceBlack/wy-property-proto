/**
 * 首页「社区」信息流的**纯规则**（批次 81）
 * ------------------------------------------------------------
 * 为什么要有这条流：原来首页是"社区活动横滑 + 社区公告三张"两个独立区块。
 * 活动多时好看，活动少时那块就是一条空轨道 —— 而真实小区的活动密度本来就是波动的。
 * 合成一条流之后，**活动少的时候由公告 / 投票 / 闲置自动补位**，不存在"空位"。
 *
 * 排序不是按时间，而是按"这件事需不需要我动手"：
 *   1 待签收公告（停水停电 / 安全提示）—— 要签，不签物业会追；
 *   2 未投的投票 —— 有时效，过期作废；
 *   3 报名中的活动 —— 有时效；
 *   4 置顶公告；
 *   5 其余公告；
 *   6 在售闲置 —— 有时间就看。
 *
 * 纯函数：不读时钟、不读 store —— 排序只依赖传入的行本身（`deadlineText` 等文案由调用方算好），
 * 所以 `check:data` 可以直接造几行数据断言优先级。
 */

export const FEED_LIMIT = 5

/**
 * 哪几类公告需要签收。
 *
 * 与 `04-契约` 的服务端口径一致：只有停水停电与安全提示开放签收，其余 422。
 * **不要读 `signRequired` 字段** —— 列表接口不返回它（详情才返回），
 * 拿它做过滤的结果是一条"待签收"都出不来（批次 81 实测：首页第一条一直是投票）。
 */
export const SIGN_TYPES = ['停水停电', '安全提示']
export const needsSign = n => !!n && SIGN_TYPES.includes(n.type) && !n.signed

const s = v => String(v || '')
const byTimeDesc = (a, b) => s(b).localeCompare(s(a))

/**
 * @param {object} p
 * @param {Array}  p.notices     公告（noticeList 的形状）
 * @param {Array}  p.votes       进行中的投票（voteList({tab:'doing'})）
 * @param {Array}  p.activities  活动（activityFeed 的形状，含 phase）
 * @param {Array}  p.items       在售闲置（itemList 的形状）
 * @param {number} p.limit       条数上限，默认 5
 */
export function buildFeed({ notices = [], votes = [], activities = [], items = [], limit = FEED_LIMIT } = {}) {
  const out = []
  const seen = new Set()
  const push = row => {
    if (!row || seen.has(row.key)) return
    seen.add(row.key)
    out.push(row)
  }

  /* 1 待签收：signed 尚未为 true。接口模式与服务端同口径（只对停水停电/安全提示开放签收） */
  notices
    .filter(needsSign)
    .sort((a, b) => byTimeDesc(a.publishTime, b.publishTime))
    .forEach(n =>
      push({
        key: `notice:${n.noticeId}`,
        kind: 'notice',
        id: n.noticeId,
        tag: n.type,
        title: n.title,
        badge: '待签收',
        badgeTone: 'danger',
        meta: `${n.publisher || '物业'} · 需要签收后才算送达`,
        atText: s(n.publishTime).slice(5, 10)
      })
    )

  /* 2 未投的投票：投过的沉到"全部"里，首页不重复占位 */
  votes
    .filter(v => v.status !== '已结束' && !v.voted)
    .sort((a, b) => s(a.endAt).localeCompare(s(b.endAt)))
    .forEach(v =>
      push({
        key: `vote:${v.voteId || v.surveyId}`,
        kind: 'vote',
        id: v.voteId || v.surveyId,
        tag: '投票',
        title: v.title,
        badge: '未投',
        badgeTone: 'warn',
        meta: `${v.deadlineText || '进行中'} · 一人一票，可改`,
        atText: s(v.endAt).slice(5, 10)
      })
    )

  /* 3 报名中的活动：只有"能报名"的才上首页，待成行 / 已成行去频道里看 */
  activities
    .filter(a => a.phase === '报名中')
    .sort((a, b) => s(a.startAt).localeCompare(s(b.startAt)))
    .forEach(a =>
      push({
        key: `activity:${a.activityId}`,
        kind: 'activity',
        id: a.activityId,
        tag: a.category || '活动',
        title: a.title,
        badge: '报名中',
        badgeTone: 'primary',
        meta: `${s(a.startAt).slice(5, 10)} · 已报 ${Number(a.enrolled) || 0}/${Number(a.capacity) || 0} 人`,
        atText: s(a.startAt).slice(5, 10)
      })
    )

  /* 4 置顶公告 —— 不置顶的公告在第 5 步进来，靠 seen 去重 */
  notices
    .filter(n => n.top)
    .sort((a, b) => byTimeDesc(a.publishTime, b.publishTime))
    .forEach(n => push(noticeRow(n, n.read ? '' : '未读')))

  /* 5 其余公告：按发布时间倒序 */
  notices
    .slice()
    .sort((a, b) => byTimeDesc(a.publishTime, b.publishTime))
    .forEach(n => push(noticeRow(n, n.read ? '' : '未读')))

  /* 6 在售闲置：已经够多了就不再补，首页不是频道页 */
  items
    .filter(i => i.status === '已上架')
    .sort((a, b) => byTimeDesc(a.publishAt, b.publishAt))
    .forEach(i =>
      push({
        key: `item:${i.itemId}`,
        kind: 'item',
        id: i.itemId,
        tag: '闲置',
        title: i.title,
        badge: '',
        badgeTone: '',
        meta: `¥${Number(i.price) || 0} · ${i.buildingName || '同小区'} · ${Number(i.wantCount) || 0} 人想要`,
        atText: s(i.publishAt).slice(5, 10)
      })
    )

  return selectMixed(out, limit)
}

/**
 * 每类最多占几条 —— 这是"合成一条流"能否成立的关键。
 *
 * 样例里 P01 有 10 条没签收的停水/安全公告，不设上限时它们会把 5 个位置全占满，
 * 首页就变成一面"催签墙"，活动与投票一条都看不见 —— 那正是这一批要解决的问题，
 * 只是换了个方向复发。所以：**先按配额混排，不够再按优先级回填**。
 */
export const KIND_CAP = { notice: 2, vote: 1, activity: 1, item: 1 }

function selectMixed(rows, limit) {
  const picked = []
  const used = {}
  const overflow = []
  for (const row of rows) {
    const cap = KIND_CAP[row.kind] ?? limit
    if ((used[row.kind] || 0) < cap) {
      used[row.kind] = (used[row.kind] || 0) + 1
      picked.push(row)
    } else {
      overflow.push(row)
    }
  }
  /* 某个频道本来就少（比如只有 1 场活动），空位按原优先级回填，不留白 */
  for (const row of overflow) {
    if (picked.length >= limit) break
    picked.push(row)
  }
  return picked.slice(0, limit)
}

function noticeRow(n, badge) {
  return {
    key: `notice:${n.noticeId}`,
    kind: 'notice',
    id: n.noticeId,
    tag: n.type,
    title: n.title,
    badge: badge || (n.top ? '置顶' : ''),
    badgeTone: n.top ? 'primary' : 'primary',
    meta: `${n.publisher || '物业'} · 阅读 ${Number(n.readCount) || 0}/${Number(n.targetHouses) || 0} 户`,
    atText: s(n.publishTime).slice(5, 10)
  }
}

/**
 * 首页还要不要单独展示"活动"块？
 *
 * 不要。合成流之后，活动少于 2 场时由公告/投票/闲置补位，
 * 这就是当初"活动少时难看"的正解 —— 不是把块藏起来，是不给它独占一块。
 */
export const NEEDS_SEPARATE_ACTIVITY_BLOCK = false
