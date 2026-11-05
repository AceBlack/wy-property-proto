<!--
  Tab 3 · 邻里
  ------------------------------------------------------------
  四个子 tab（对齐设计稿）：邻里动态 / 闲置转让 / 投票问卷 / 社区活动。
  本期内容全部由**物业发布**，业主只参与（评论 / 报名 / 投票 / 点赞 / 想要）——
  自主发布留到下一版（要接内容安全审核 + 人工审核队列）。
  闲置转让的存量数据标「物业代发」，不假装是业主发的。
-->
<template>
  <view class="page">
    <view class="hd">
      <text class="hd__t">邻里</text>
      <text class="hd__s">{{ communityName }}</text>
    </view>

    <view class="tabs">
      <view v-for="t in TABS" :key="t.key" :id="`ntab-${t.key}`" class="tabs__i" :class="{ 'is-on': tab === t.key }" @tap="tab = t.key">
        <text>{{ t.label }}</text>
      </view>
    </view>

    <view class="body">
      <!-- 邻里动态 -->
      <template v-if="tab === 'post'">
        <view class="filters">
          <view v-for="s in POST_SORTS" :key="s.key" class="chip" :class="{ 'is-on': sort === s.key }" @tap="sort = s.key">
            <text>{{ s.label }}</text>
          </view>
        </view>
        <view v-for="p in posts" :key="p.postId" class="card pc" @tap="goPost(p.postId)">
          <view class="pc__hd">
            <Tag :text="p.category" size="sm" color="var(--biz-primary)" />
            <text v-if="p.top" class="pc__top">置顶</text>
            <text class="pc__at">{{ p.publishTime }}</text>
          </view>
          <text class="pc__t">{{ p.title }}</text>
          <text class="pc__d">{{ p.content }}</text>
          <view v-if="p.images" class="pc__imgs">
            <Cover v-for="i in p.images" :key="i" :cover="(p.cover || 0) + i" h="130rpx" />
          </view>
          <view class="pc__foot">
            <text class="pc__m">{{ p.author }} · {{ p.authorRole }}</text>
            <view class="pc__acts">
              <text class="pc__a" :class="{ 'is-on': p.liked }" @tap.stop="like(p.postId)">赞 {{ p.likeCount }}</text>
              <text class="pc__a">评论 {{ p.commentCount }}</text>
            </view>
          </view>
        </view>
      </template>

      <!-- 闲置转让 -->
      <template v-else-if="tab === 'sh'">
        <view class="filters">
          <view v-for="c in SH_CATS" :key="c" class="chip" :class="{ 'is-on': shCat === c }" @tap="shCat = c">
            <text>{{ c }}</text>
          </view>
        </view>
        <view class="sh-grid">
          <view v-for="i in items" :key="i.itemId" class="sh" @tap="goSh(i.itemId)">
            <Cover :cover="i.cover" h="200rpx" :badge="i.condition" />
            <text class="sh__t">{{ i.title }}</text>
            <view class="sh__f">
              <text class="sh__p">¥{{ i.price }}</text>
              <text class="sh__o">¥{{ i.originPrice }}</text>
            </view>
            <text class="sh__d">{{ i.sellerHouse }} · {{ i.wantCount }} 人想要</text>
          </view>
        </view>
        <view class="tip">
          <text class="demo-tip">演示</text>
          <text class="tip__t">本期不开放业主发布：内容为存量数据（物业代发），只能看与联系。发布要接内容安全审核，留到下一版。</text>
        </view>
      </template>

      <!-- 投票问卷 -->
      <template v-else-if="tab === 'survey'">
        <view class="filters">
          <view v-for="s in SURVEY_TABS" :key="s.key" class="chip" :class="{ 'is-on': svTab === s.key }" @tap="svTab = s.key">
            <text>{{ s.label }}</text>
          </view>
        </view>
        <view v-for="s in surveys" :key="s.surveyId" class="card sv" @tap="goSurvey(s.surveyId)">
          <view class="sv__hd">
            <Tag :text="s.type" size="sm" color="var(--biz-accent-dark)" />
            <text class="sv__st" :class="{ 'is-end': s.status === '已结束' }">{{ s.status }}</text>
          </view>
          <text class="sv__t">{{ s.title }}</text>
          <view class="sv__foot">
            <text class="sv__m">{{ s.totalVotes }} 人参与 · 截至 {{ s.endAt }}</text>
            <text class="sv__a">{{ s.voted ? '已参与' : '去参与' }}</text>
          </view>
        </view>
        <view class="tip">
          <text class="demo-tip">说明</text>
          <text class="tip__t">这里是**意见征集**，结果用于改进服务，不构成《民法典》意义上的业主共同决定（法定表决需面积+人数双过半、实名留痕，另立项目）。</text>
        </view>
      </template>

      <!-- 社区活动 -->
      <template v-else>
        <view class="filters">
          <view v-for="t in ACTIVITY_TABS" :key="t.key" class="chip" :class="{ 'is-on': actTab === t.key }" @tap="actTab = t.key">
            <text>{{ t.label }}</text>
          </view>
        </view>
        <view v-for="a in acts" :key="a.activityId" class="card act" @tap="goAct(a.activityId)">
          <Cover :cover="a.cover" h="230rpx" :badge="a.status" :label="a.type" />
          <view class="act__body">
            <text class="act__t">{{ a.title }}</text>
            <text class="act__d">{{ a.startAt }} · {{ a.place }}</text>
            <view class="act__f">
              <text class="act__m">已报名 {{ a.enrolledCount }}/{{ a.capacity }}</text>
              <text class="act__a" :class="{ 'is-mine': a.mine }">{{ a.mine ? '已报名' : a.full ? '已满' : '去报名' }}</text>
            </view>
          </view>
        </view>
        <Empty v-if="!acts.length" text="暂时没有活动" sub="物业发布后会出现在这里" />
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
  POST_SORTS,
  SH_CATS,
  SURVEY_TABS,
  activityList,
  posts as postList,
  secondhandList,
  surveyList
} from '@/api/neighbor'
import { activeHouse } from '@/api/mp'
import { toggleLike } from '@/store/app'
import { go, toast } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const TABS = [
  { key: 'post', label: '邻里动态' },
  { key: 'sh', label: '闲置转让' },
  { key: 'survey', label: '投票问卷' },
  { key: 'activity', label: '社区活动' }
]

const tab = ref('post')
const sort = ref('new')
const shCat = ref('全部')
const svTab = ref('all')
const actTab = ref('doing')
const ver = ref(0)

const communityName = computed(() => activeHouse()?.communityName || '未认证 · 浏览社区内容')
const posts = computed(() => {
  ver.value
  return postList({ sort: sort.value })
})
const items = computed(() => {
  ver.value
  return secondhandList({ cat: shCat.value })
})
const surveys = computed(() => {
  ver.value
  return surveyList(svTab.value)
})
const acts = computed(() => {
  ver.value
  return activityList(actTab.value)
})

onLoad(() => {
  uni.$on('neighbor-tab', t => {
    const map = { post: 'post', activity: 'activity', sh: 'sh', survey: 'survey' }
    if (map[t]) tab.value = map[t]
  })
})
onShow(() => {
  ver.value++
})

function like(id) {
  if (!gateLogin()) return
  toggleLike(id)
  ver.value++
}

const goPost = id => go('/pages/neighbor/post', { id })
const goSh = id => go('/pages/neighbor/secondhand', { id })
const goSurvey = id => go('/pages/neighbor/survey', { id })
const goAct = id => go('/pages/neighbor/activity', { id })
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }

.hd { padding: calc(env(safe-area-inset-top) + 26rpx) 28rpx 22rpx; display: flex; align-items: baseline; gap: 14rpx; }
.hd__t { font-size: 38rpx; font-weight: 700; color: var(--biz-text-1); }
.hd__s { font-size: 21rpx; color: var(--biz-text-3); }

.tabs { display: flex; gap: 28rpx; padding: 0 28rpx; border-bottom: 2rpx solid var(--biz-border-light); }
.tabs__i { padding: 12rpx 0 18rpx; font-size: 27rpx; color: var(--biz-text-3); position: relative; }
.tabs__i.is-on { color: var(--biz-text-1); font-weight: 700; }
.tabs__i.is-on::after {
  content: ''; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: 44rpx; height: 6rpx; border-radius: 4rpx; background: var(--biz-primary);
}

.body { padding: 22rpx 28rpx 40rpx; }
.filters { display: flex; gap: 12rpx; flex-wrap: wrap; margin-bottom: 18rpx; }

.pc__hd { display: flex; align-items: center; gap: 12rpx; }
.pc__top { font-size: 19rpx; color: var(--biz-danger); background: #fff0f1; border-radius: 4rpx; padding: 1rpx 8rpx; }
.pc__at { margin-left: auto; font-size: 20rpx; color: var(--biz-text-4); }
.pc__t { display: block; margin-top: 12rpx; font-size: 29rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.pc__d { display: block; margin-top: 8rpx; font-size: 23rpx; color: var(--biz-text-3); line-height: 1.55; }
.pc__imgs { display: flex; gap: 10rpx; margin-top: 14rpx; }
.pc__imgs > * { flex: 1; }
.pc__foot { display: flex; align-items: center; justify-content: space-between; margin-top: 16rpx; }
.pc__m { font-size: 20rpx; color: var(--biz-text-4); }
.pc__acts { display: flex; gap: 20rpx; }
.pc__a { font-size: 21rpx; color: var(--biz-text-3); }
.pc__a.is-on { color: var(--biz-primary); font-weight: 600; }

.sh-grid { display: flex; flex-wrap: wrap; gap: 18rpx; }
.sh { width: calc((100% - 18rpx) / 2); background: #fff; border-radius: 18rpx; padding: 14rpx; box-shadow: var(--biz-shadow-card); }
.sh__t { display: block; margin-top: 12rpx; font-size: 24rpx; color: var(--biz-text-1); font-weight: 500; line-height: 1.4; height: 68rpx; overflow: hidden; }
.sh__f { display: flex; align-items: baseline; gap: 8rpx; margin-top: 6rpx; }
.sh__p { font-family: var(--biz-font-num); font-size: 30rpx; font-weight: 700; color: var(--biz-danger); }
.sh__o { font-size: 19rpx; color: var(--biz-text-4); text-decoration: line-through; }
.sh__d { display: block; margin-top: 4rpx; font-size: 19rpx; color: var(--biz-text-4); }

.sv__hd { display: flex; align-items: center; justify-content: space-between; }
.sv__st { font-size: 20rpx; color: var(--biz-accent-dark); }
.sv__st.is-end { color: var(--biz-text-4); }
.sv__t { display: block; margin-top: 12rpx; font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.sv__foot { display: flex; align-items: center; justify-content: space-between; margin-top: 14rpx; }
.sv__m { font-size: 20rpx; color: var(--biz-text-4); }
.sv__a { font-size: 22rpx; color: var(--biz-primary); font-weight: 600; }

.act { padding: 0; overflow: hidden; }
.act__body { padding: 18rpx 22rpx 22rpx; }
.act__t { font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); }
.act__d { display: block; margin-top: 6rpx; font-size: 21rpx; color: var(--biz-text-3); }
.act__f { display: flex; align-items: center; justify-content: space-between; margin-top: 14rpx; }
.act__m { font-size: 20rpx; color: var(--biz-text-4); }
.act__a { font-size: 22rpx; color: var(--biz-primary); font-weight: 600; }
.act__a.is-mine { color: var(--biz-accent-dark); }

.tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.tip__t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
