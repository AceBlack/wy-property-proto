/**
 * 首页「社区」信息流（批次 81）
 * ------------------------------------------------------------
 * 只做一件事：把四个频道的最新条目合成一条流，交给 `home-feed-rule.mjs` 排序。
 * 排序规则在纯函数里（可被 `check:data` 断言），这里不写任何 if/else 优先级 ——
 * 两处各写一遍，改的那天一定漏一处。
 *
 * 数据全部走既有选择器：公告 / 投票 / 活动 / 闲置各自已经有"服务端优先、本地回落"的分支，
 * 这一层不再关心接口模式。
 */
import { activityFeed, itemList, noticeList, voteList } from './neighbor'
import { FEED_LIMIT, buildFeed } from './home-feed-rule.mjs'

export { FEED_LIMIT }

/** 首页社区流：最多 5 条，按"要不要我动手"排 */
export function communityFeed(limit = FEED_LIMIT) {
  return buildFeed({
    notices: noticeList(),
    votes: voteList({ tab: 'doing' }),
    activities: activityFeed(8),
    items: itemList({ sort: 'new' }),
    limit
  })
}

/** 周边服务入口：只放分类代表服务，不放商品与下单（生活频道本轮不接交易） */
export const NEARBY_LIMIT = 4
