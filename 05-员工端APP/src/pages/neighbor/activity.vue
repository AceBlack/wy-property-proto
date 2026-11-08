<template>
  <view class="page">
    <NavBar title="邻里活动" :subtitle="`本项目 · 未结束 ${rows.length} 场`" />

    <view class="body">
      <view class="hint">
        <text class="hint__t">现场只做三件事</text>
        <text class="hint__d">看还能不能报、替业主报名（报名中的卡片上直接办）、活动当天签到。建活动、改价格、确认流团都在 PC。</text>
      </view>

      <view
        v-for="a in rows"
        :key="a.activityId"
        :id="`nb-activity-${a.activityId}`"
        class="card ac"
        hover-class="card--hover"
        @tap="open(a)"
      >
        <view class="ac__top">
          <text class="ac__t">{{ a.title }}</text>
          <text class="ph" :class="`ph--${a.phaseType || 'info'}`">{{ a.phase }}</text>
        </view>
        <view class="ac__meta">
          <text class="ac__fee num">{{ a.feeText }}</text>
          <text class="dot">·</text>
          <text>{{ String(a.startAt).slice(5, 16) }}</text>
          <text class="dot">·</text>
          <text>{{ a.place }}</text>
        </view>

        <view class="bar">
          <view class="bar__in" :style="{ width: a.fillRate + '%' }" />
        </view>
        <view class="ac__foot">
          <text class="ac__n num">已报 {{ a.enrolled }}/{{ a.capacity }}</text>
          <text v-if="a.phase === '待成行'" class="ac__gap">还差 {{ a.gap }} 人成团</text>
          <text v-else-if="a.phase === '报名中'" class="ac__dl">截止 {{ a.enrollDeadline }}</text>
          <text v-else class="ac__ok">已成团</text>
        </view>

        <!-- 只有「报名中」能代报：待成行是报名已截止没成团，已成行也一样不能再收人 -->
        <view v-if="enrollable(a)" class="ac__ops">
          <text v-if="a.left <= 0" class="mini mini--off">名额已满</text>
          <view v-else :id="`nb-ac-enroll-${a.activityId}`" class="mini mini--on" hover-class="mini--hover" @tap.stop="openEnroll(a)">
            ＋ 代报名
          </view>
        </view>
      </view>

      <Empty v-if="!rows.length" text="本项目没有进行中的活动" sub="已结束的活动留在 PC，方便导出与归档" />

      <view class="tail">
        <text>
          「待成行」不在列表里显示成"报名中"：报名截止后人数没到下限，是独立状态 ——
          钱收了团没成，退款要有入口。所以它也不再接受代报名。
        </text>
      </view>
    </view>

    <!-- 列表内直接代客报名：现场只关心"给谁报、报几个、收没收到钱" -->
    <EnrollSheet v-model:show="sheet" :activity="cur" @done="load" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import EnrollSheet from '@/components/EnrollSheet.vue'
import { activitiesOf } from '@/api/neighbor'
import { CAP, can } from '@/config/personas'
import { persona } from '@/store/app'
import { toastErr } from '@/utils/ui'

const rows = ref([])
const sheet = ref(false)
const cur = ref(null)

const canEnroll = computed(() => can(persona.value, CAP.neighborActEnroll))

function enrollable(a) {
  return canEnroll.value && a.phase === '报名中'
}

async function load() {
  try {
    rows.value = await activitiesOf()
  } catch (e) {
    rows.value = []
    toastErr(e.message || '活动加载失败')
  }
}

function open(a) {
  uni.navigateTo({ url: `/pages/neighbor/enroll?activityId=${a.activityId}` })
}

/** 列表行本身就是 _nvActRow 的产物，字段够开表单，不必再拉一次详情 */
function openEnroll(a) {
  cur.value = a
  sheet.value = true
}

onShow(() => load())
</script>

<style scoped>
.hint {
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.hint__t {
  display: block;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  margin-bottom: 8rpx;
}

.hint__d {
  display: block;
  font-size: 19rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.ac__top {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
}

.ac__t {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.4;
}

.ph {
  flex: none;
  font-size: 17rpx;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}

.ph--success {
  color: var(--biz-accent-dark);
  background: #e6faf3;
}

.ph--warning {
  color: #a35c13;
  background: #fff7ed;
}

.ph--danger {
  color: var(--biz-danger);
  background: #fff0f0;
}

.ph--info {
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
}

.ac__meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 8rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  flex-wrap: wrap;
}

.ac__fee {
  color: var(--biz-danger);
  font-size: 22rpx;
}

.dot {
  color: var(--biz-border);
}

.bar {
  height: 10rpx;
  border-radius: 999rpx;
  background: var(--biz-bg-fill);
  overflow: hidden;
  margin: 16rpx 0 8rpx;
}

.bar__in {
  height: 100%;
  background: var(--biz-gradient);
}

.ac__foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.ac__n {
  font-size: 20rpx;
  color: var(--biz-text-2);
}

.ac__gap {
  font-size: 19rpx;
  color: #a35c13;
}

.ac__dl {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.ac__ok {
  font-size: 19rpx;
  color: var(--biz-accent-dark);
}

/* 代报名入口：只在报名中的卡片上出现，单独一行不挤"已报 X/Y" */
.ac__ops {
  display: flex;
  justify-content: flex-end;
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 2rpx solid var(--biz-border-light);
}

.mini {
  height: 56rpx;
  padding: 0 26rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  display: flex;
  align-items: center;
}

.mini--on {
  color: var(--biz-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 2rpx var(--biz-primary);
}

.mini--hover {
  background: var(--biz-primary-light-9);
}

.mini--off {
  color: var(--biz-text-4);
  background: var(--biz-bg-fill);
}

.tail {
  padding: 10rpx 4rpx 20rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}
</style>
