<!--
  Tab 3 · 邻里（公告 / 投票 / 活动 / 闲置）
  ------------------------------------------------------------
  按交接单 §12.2 改版：原来的「邻里动态」下掉了 —— 后台不再产生"帖子"内容，
  公告复用 C 域同一张表；「话题广场 / 跟帖 / 公开评论墙」属微信【社交-社区/论坛】类目，
  物业没有常态化审核编制，这是类目红线，不是产品取舍。

  四条频道各自的口径（都在 api/neighbor.js 里写死）：
    · 公告：只同步「已发布」，阅读数用公告自带的，业主端不另算一套；
    · 投票：只做意见征询，结果里没有「通过 / 未通过」；参与率按户算；
    · 活动：5 个阶段，**待成行不能报名**（已截止但没到成团下限）；
    · 闲置：全站唯一 UGC，先审后发，展示只到楼栋。
-->
<template>
  <view class="page">
    <view class="hd">
      <view class="hd__l">
        <text class="hd__t">邻里</text>
        <text class="hd__s">{{ communityName }}</text>
      </view>
      <view id="neighbor-mine" class="hd__mine" @tap="goMine">
        <text>我的</text>
        <text v-if="myBadge" class="hd__dot">{{ myBadge }}</text>
      </view>
    </view>

    <view class="tabs">
      <view
        v-for="t in TABS"
        :key="t.key"
        :id="`ntab-${t.key}`"
        class="tabs__i"
        :class="{ 'is-on': tab === t.key }"
        @tap="tab = t.key"
      >
        <text>{{ t.label }}</text>
      </view>
    </view>

    <view class="body">
      <!-- ============ 公告 ============ -->
      <template v-if="tab === 'notice'">
        <view class="chips-row">
          <view
            v-for="t in NOTICE_TYPES"
            :key="t"
            class="chip"
            :class="{ 'is-on': ntype === t }"
            @tap="ntype = t; noticeLimit = 12"
          >
            <text>{{ t }}</text>
          </view>
        </view>

        <Empty v-if="!notices.length" text="这个分类下没有公告" sub="物业发布后会出现在这里" />

        <view v-for="n in notices.slice(0, noticeLimit)" :key="n.noticeId" class="card nt" @tap="goNotice(n.noticeId)">
          <view class="nt__hd">
            <text v-if="n.top" class="nt__top">置顶</text>
            <Tag :text="n.type" size="sm" color="var(--biz-primary)" />
            <text v-if="n.signed" class="nt__signed">已签收</text>
            <text class="nt__at">{{ n.publishTime.slice(5, 16) }}</text>
          </view>
          <view class="nt__row">
            <view class="nt__b">
              <text class="nt__t" :class="{ 'is-unread': !n.read }">{{ n.title }}</text>
              <text class="nt__d">
                阅读 {{ n.readCount }}/{{ n.targetHouses }} 户
                <text v-if="n.attachmentCount"> · 附件 {{ n.attachmentCount }} 个</text>
              </text>
            </view>
            <view v-if="!n.read" class="nt__dot" />
          </view>
        </view>

        <view v-if="notices.length > noticeLimit" id="notice-more" class="more-btn" @tap="noticeLimit += 12">
          <text>加载更多（{{ noticeLimit }}/{{ notices.length }}）</text>
        </view>

        <view class="tip">
          <text class="demo-tip">口径</text>
          <text class="tip__t">
            公告与 PC 后台是同一张表：只同步「已发布」，草稿 / 待审核 / 已撤回都不出现在业主端。
            阅读数与对象户数直接用公告自带的数，业主端不另做一套。
          </text>
        </view>
      </template>

      <!-- ============ 投票 ============ -->
      <template v-else-if="tab === 'vote'">
        <view class="chips-row">
          <view v-for="t in VOTE_TABS" :key="t.key" class="chip" :class="{ 'is-on': vtab === t.key }" @tap="vtab = t.key">
            <text>{{ t.label }}</text>
          </view>
        </view>

        <Empty v-if="!votes.length" text="暂时没有投票" sub="物业发起的意见征询会出现在这里" />

        <view v-for="v in votes" :key="v.surveyId" class="card vt" @tap="goVote(v.surveyId)">
          <view class="vt__hd">
            <Tag :text="v.multi ? '多选' : '单选'" size="sm" color="var(--biz-primary)" />
            <Tag v-if="v.type" :text="v.type" size="sm" color="var(--biz-text-3)" />
            <text class="vt__st" :class="{ 'is-end': v.status === '已结束' }">
              {{ v.status === '已结束' ? '已结束' : v.deadlineText }}
            </text>
          </view>
          <text class="vt__t">{{ v.title }}</text>
          <view class="vt__foot">
            <text class="vt__m">
              {{ v.voted || v.status === '已结束' ? v.partRateText : `${v.options.length} 个选项 · ${v.multi ? `最多选 ${v.maxPick} 项` : '单选'}` }}
            </text>
            <text class="vt__a">{{ v.voted ? '看结果' : v.status === '已结束' ? '已结束' : '去投票' }}</text>
          </view>
        </view>

        <view class="tip">
          <text class="demo-tip">说明</text>
          <text class="tip__t">
            这里是**意见征询**，结果用于改进服务，不构成《民法典》意义上的业主共同决定。
            参与率按户算（租户不计，征询的是产权人意见）。
          </text>
        </view>
      </template>

      <!-- ============ 活动 ============ -->
      <template v-else-if="tab === 'activity'">
        <view class="chips-row">
          <view v-for="t in ACTIVITY_TABS" :key="t.key" class="chip" :class="{ 'is-on': atab === t.key }" @tap="atab = t.key">
            <text>{{ t.label }}</text>
          </view>
        </view>

        <Empty v-if="!acts.length" text="暂时没有活动" sub="换个分类看看，或等物业发布" />

        <view v-for="a in acts" :key="a.activityId" class="card ac" @tap="goActivity(a.activityId)">
          <Cover :cover="a.cover" h="230rpx" :badge="a.fee > 0 ? `¥${a.fee}/人` : '免费'" :label="a.category" />
          <view class="ac__b">
            <view class="ac__hd">
              <text class="ac__t">{{ a.title }}</text>
              <text class="ac__ph" :style="{ color: a.phaseTone }">{{ a.phase }}</text>
            </view>
            <text class="ac__d">{{ a.startAt }} · {{ a.place }}</text>
            <view class="ac__bar">
              <view class="ac__bar-in" :style="{ width: a.fillRate + '%' }" />
            </view>
            <view class="ac__f">
              <text class="ac__m">
                {{ a.fee > 0 ? `¥${a.fee}/人 · ` : '免费 · ' }}已报名 {{ a.enrolled }}/{{ a.capacity }}
                <text v-if="a.phase === '待成行'" class="ac__gap"> · 还差 {{ a.gap }} 人成团</text>
              </text>
              <text class="ac__a">{{ a.mine ? '已报名' : a.canEnroll ? '去报名' : a.phase }}</text>
            </view>
          </view>
        </view>

        <view class="tip">
          <text class="demo-tip">口径</text>
          <text class="tip__t">
            「待成行」是独立状态：报名已截止但没到成团下限，**这时候不能再报名**，
            等物业确认成行或流团（流团全额退款）。
          </text>
        </view>
      </template>

      <!-- ============ 闲置 ============ -->
      <template v-else>
        <view class="chips-row">
          <view v-for="c in ITEM_CATS" :key="c" class="chip" :class="{ 'is-on': icate === c }" @tap="icate = c">
            <text>{{ c }}</text>
          </view>
          <view id="item-publish" class="chip chip--act" @tap="toPublish"><text>+ 发布</text></view>
        </view>

        <Empty v-if="!items.length" text="还没有在架的闲置" sub="发一条试试，审核通过后邻居就能看到" />

        <view class="sh-grid">
          <view v-for="i in items" :key="i.itemId" class="sh" @tap="goItem(i.itemId)">
            <Cover :cover="i.cover" h="200rpx" :badge="i.condition" />
            <text class="sh__t">{{ i.title }}</text>
            <view class="sh__f">
              <text class="sh__p">{{ i.price > 0 ? `¥${i.price}` : '免费送' }}</text>
              <text v-if="i.originPrice" class="sh__o">¥{{ i.originPrice }}</text>
            </view>
            <text class="sh__d">{{ i.buildingText }} · {{ i.wantCount }} 人想要</text>
          </view>
        </view>

        <view class="tip">
          <text class="demo-tip">说明</text>
          <text class="tip__t">
            闲置是全站唯一的业主发布内容，**先审后发**（审核在员工端，通常 24 小时内）。
            展示只到楼栋、不显示门牌；手机号默认不公开，走站内私信。
          </text>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import Tag from '@/components/Tag.vue'
import Cover from '@/components/Cover.vue'
import Empty from '@/components/Empty.vue'
import {
  ACTIVITY_TABS,
  ITEM_CATS,
  NOTICE_TYPES,
  VOTE_TABS,
  activityList,
  itemList,
  myCommunityIds,
  noticeList,
  unreadNoticeCount,
  voteList
} from '@/api/neighbor'
import { app } from '@/store/app'
import { go } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const TABS = [
  { key: 'notice', label: '公告' },
  { key: 'vote', label: '投票' },
  { key: 'activity', label: '活动' },
  { key: 'sh', label: '闲置' }
]

const tab = ref('notice')
const ntype = ref('全部')
const vtab = ref('doing')
const atab = ref('open')
const icate = ref('全部')
const noticeLimit = ref(12)
const ver = ref(0)

const communityName = computed(() => {
  ver.value
  const ids = myCommunityIds()
  return ids.length ? `${ids.length} 个项目 · 已按认证房产筛选` : '未认证 · 浏览社区内容'
})
const notices = computed(() => {
  ver.value
  return noticeList({ type: ntype.value })
})
const votes = computed(() => {
  ver.value
  return voteList({ tab: vtab.value })
})
const acts = computed(() => {
  ver.value
  return activityList(atab.value)
})
const items = computed(() => {
  ver.value
  return itemList({ cat: icate.value })
})
const myBadge = computed(() => {
  ver.value
  const n = app.itemPosts.filter(i => i.status === '待审核').length
  const e = app.enrollments.filter(x => x.payStatus === '待支付').length
  return n + e || unreadNoticeCount() || ''
})

/* tabBar 页不能带 query：首页点「全部公告 / 查看全部」用事件传频道，进来后再切 tab */
onLoad(() => {
  uni.$on('neighbor-tab', t => {
    const keys = TABS.map(x => x.key)
    if (keys.includes(t)) tab.value = t
    else if (t === 'notice' || t === 'vote' || t === 'activity' || t === 'sh') tab.value = t
  })
})
onShow(() => {
  ver.value++
})

const goNotice = id => go('/pages/neighbor/notice', { id })
const goVote = id => go('/pages/neighbor/vote', { id })
const goActivity = id => go('/pages/neighbor/activity', { id })
const goItem = id => go('/pages/neighbor/secondhand', { id })
const goMine = () => go('/pages/neighbor/my')

function toPublish() {
  if (!gateLogin()) return
  go('/pages/neighbor/item-publish')
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }

.hd {
  padding: calc(env(safe-area-inset-top) + 26rpx) 28rpx 22rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hd__l { display: flex; align-items: baseline; gap: 14rpx; min-width: 0; }
.hd__t { font-size: 38rpx; font-weight: 700; color: var(--biz-text-1); }
.hd__s { font-size: 20rpx; color: var(--biz-text-3); }
.hd__mine {
  position: relative;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: #fff;
  font-size: 22rpx;
  color: var(--biz-text-2);
  box-shadow: var(--biz-shadow-card);
}
.hd__dot {
  position: absolute; top: -6rpx; right: -6rpx;
  min-width: 26rpx; height: 26rpx; line-height: 26rpx;
  border-radius: 999rpx; background: var(--biz-danger); color: #fff;
  font-size: 17rpx; text-align: center; padding: 0 6rpx;
}

.tabs { display: flex; gap: 34rpx; padding: 0 28rpx; border-bottom: 2rpx solid var(--biz-border-light); }
.tabs__i { padding: 12rpx 0 18rpx; font-size: 27rpx; color: var(--biz-text-3); position: relative; }
.tabs__i.is-on { color: var(--biz-text-1); font-weight: 700; }
.tabs__i.is-on::after {
  content: ''; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: 44rpx; height: 6rpx; border-radius: 4rpx; background: var(--biz-primary);
}

.body { padding: 22rpx 28rpx 40rpx; }
.chips-row { display: flex; gap: 12rpx; flex-wrap: wrap; margin-bottom: 18rpx; }
.chip--act { background: var(--biz-primary); color: #fff; font-weight: 600; }

/* 公告 */
.nt__hd { display: flex; align-items: center; gap: 10rpx; }
.nt__top { font-size: 18rpx; color: var(--biz-danger); background: #fff0f1; border-radius: 4rpx; padding: 1rpx 8rpx; }
.nt__signed { font-size: 18rpx; color: var(--biz-accent-dark); background: var(--biz-accent-light-9); border-radius: 4rpx; padding: 1rpx 8rpx; }
.nt__at { margin-left: auto; font-size: 20rpx; color: var(--biz-text-4); }
.nt__row { display: flex; align-items: flex-start; gap: 14rpx; margin-top: 12rpx; }
.nt__b { flex: 1; min-width: 0; }
.nt__t { font-size: 27rpx; color: var(--biz-text-2); line-height: 1.45; }
.nt__t.is-unread { color: var(--biz-text-1); font-weight: 600; }
.nt__d { display: block; margin-top: 8rpx; font-size: 20rpx; color: var(--biz-text-4); }
.nt__dot { flex: none; width: 14rpx; height: 14rpx; border-radius: 50%; background: var(--biz-danger); margin-top: 12rpx; }

/* 投票 */
.vt__hd { display: flex; align-items: center; gap: 10rpx; }
.vt__st { margin-left: auto; font-size: 20rpx; color: var(--biz-warning); }
.vt__st.is-end { color: var(--biz-text-4); }
.vt__t { display: block; margin-top: 12rpx; font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.45; }
.vt__foot { display: flex; align-items: center; justify-content: space-between; margin-top: 14rpx; }
.vt__m { font-size: 20rpx; color: var(--biz-text-4); }
.vt__a { font-size: 22rpx; color: var(--biz-primary); font-weight: 600; }

/* 活动 */
.ac { padding: 0; overflow: hidden; }
.ac__b { padding: 18rpx 22rpx 22rpx; }
.ac__hd { display: flex; align-items: flex-start; gap: 12rpx; }
.ac__t { flex: 1; font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.ac__ph { flex: none; font-size: 21rpx; font-weight: 600; }
.ac__d { display: block; margin-top: 8rpx; font-size: 21rpx; color: var(--biz-text-3); }
.ac__bar { height: 8rpx; border-radius: 6rpx; background: var(--biz-bg-fill); overflow: hidden; margin-top: 14rpx; }
.ac__bar-in { height: 100%; background: var(--biz-primary); border-radius: 6rpx; }
.ac__f { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; }
.ac__m { font-size: 20rpx; color: var(--biz-text-3); }
.ac__gap { color: var(--biz-warning); }
.ac__a { font-size: 22rpx; color: var(--biz-primary); font-weight: 600; }

/* 闲置 */
.sh-grid { display: flex; flex-wrap: wrap; gap: 18rpx; }
.sh { width: calc((100% - 18rpx) / 2); background: #fff; border-radius: 18rpx; padding: 14rpx; box-shadow: var(--biz-shadow-card); }
.sh__t { display: block; margin-top: 12rpx; font-size: 24rpx; color: var(--biz-text-1); font-weight: 500; line-height: 1.4; height: 68rpx; overflow: hidden; }
.sh__f { display: flex; align-items: baseline; gap: 8rpx; margin-top: 6rpx; }
.sh__p { font-family: var(--biz-font-num); font-size: 30rpx; font-weight: 700; color: var(--biz-danger); }
.sh__o { font-size: 19rpx; color: var(--biz-text-4); text-decoration: line-through; }
.sh__d { display: block; margin-top: 4rpx; font-size: 19rpx; color: var(--biz-text-4); }

.more-btn {
  margin-top: 18rpx; height: 76rpx; border-radius: 16rpx; background: #fff;
  color: var(--biz-primary); font-size: 24rpx; display: flex; align-items: center; justify-content: center;
  box-shadow: var(--biz-shadow-card);
}

.tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.tip__t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
