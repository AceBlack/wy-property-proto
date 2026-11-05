<template>
  <view class="page">
    <NavBar title="费用看板" :subtitle="communityLabel" />

    <view class="body">
      <NoPerm v-if="!allowed" title="费用看板只对管理岗开放" sub="只有项目经理与财务能看到金额。一线、管家、班组长的移动端不显示钱。" perm="e.reports.view" />

      <template v-else>
      <view class="hero">
        <view class="hero__top">
          <text class="hero__k">本月收缴率</text>
          <text class="hero__badge">只读</text>
        </view>
        <view class="hero__row">
          <text class="hero__n num">{{ d.rate.toFixed(1) }}</text>
          <text class="hero__u">%</text>
        </view>
        <view class="hero__bar"><view class="hero__in" :style="{ width: Math.min(100, d.rate) + '%' }" /></view>
        <view class="hero__grid">
          <view class="hg"><text class="hg__k">应收</text><text class="hg__v num">{{ wan(d.receivable) }}</text></view>
          <view class="hg"><text class="hg__k">实收</text><text class="hg__v num">{{ wan(d.received) }}</text></view>
          <view class="hg"><text class="hg__k">欠费</text><text class="hg__v num is-out">{{ wan(d.debt) }}</text></view>
        </view>
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">超期账单</text>
          <text class="sec-hd__d">逾期口径与 PC 一致</text>
        </view>
        <view class="od">
          <view class="od__i">
            <text class="od__n num">{{ d.overdueCount }}</text>
            <text class="od__k">张逾期</text>
          </view>
          <view class="od__i">
            <text class="od__n num danger">{{ money(d.overdueAmount) }}</text>
            <text class="od__k">逾期金额</text>
          </view>
          <view class="od__i">
            <text class="od__n num">{{ d.billCount }}</text>
            <text class="od__k">账单总数</text>
          </view>
        </view>
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">欠费 TOP 8</text>
          <text class="sec-hd__d">按户聚合</text>
        </view>
        <view v-for="(x, i) in d.topDebt" :key="x.ownerId" class="top">
          <text class="top__i num" :class="{ 'is-first': i < 3 }">{{ i + 1 }}</text>
          <view class="top__b">
            <text class="top__n">{{ x.name }}</text>
            <text class="top__d">{{ x.count }} 张 · 最长逾期 {{ x.maxOverdue }} 天</text>
          </view>
          <text class="top__v num">{{ money(x.debt) }}</text>
        </view>
      </view>

      <view class="banner banner--info">
        <text class="banner__ico"><text>i</text></text>
        <view class="banner__bd">
          <text class="banner__t">移动端不碰钱</text>
          <text class="banner__d">
            没有收款、没有日结月结、没有导出。财务在手机上只回答一个问题：这个项目现在收得怎么样。
            数字全部取自 PC 的费用驾驶舱，两边口径一致。
          </text>
        </view>
      </view>
      </template>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import NoPerm from '@/components/NoPerm.vue'
import { dashboardOf, money, wan } from '@/api/finance'
import { communityNameOf } from '@/api/mobile'
import { app, persona } from '@/store/app'
import { CAP, can } from '@/config/personas'

const allowed = computed(() => can(persona.value, CAP.finance))
const d = computed(() => dashboardOf(persona.value?.communityId || ''))
const communityLabel = computed(() => communityNameOf(persona.value?.communityId))

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
})
</script>

<style scoped>
.hero {
  background: linear-gradient(150deg, #5b6cff 0%, #4553d6 100%);
  border-radius: 24rpx;
  padding: 28rpx;
  color: #fff;
  margin-bottom: 24rpx;
  box-shadow: var(--biz-shadow-primary);
}

.hero__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.hero__k {
  font-size: 22rpx;
  opacity: 0.86;
}

.hero__badge {
  font-size: 18rpx;
  padding: 3rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.2);
}

.hero__row {
  display: flex;
  align-items: baseline;
  gap: 6rpx;
  margin-top: 8rpx;
}

.hero__n {
  font-size: 78rpx;
  line-height: 1;
  color: #fff;
}

.hero__u {
  font-size: 24rpx;
  opacity: 0.85;
}

.hero__bar {
  margin-top: 18rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.24);
  overflow: hidden;
}

.hero__in {
  height: 100%;
  border-radius: 999rpx;
  background: #fff;
}

.hero__grid {
  margin-top: 22rpx;
  display: flex;
  gap: 10rpx;
}

.hg {
  flex: 1;
  background: rgba(255, 255, 255, 0.14);
  border-radius: 12rpx;
  padding: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.hg__k {
  font-size: 18rpx;
  opacity: 0.82;
}

.hg__v {
  font-size: 24rpx;
  color: #fff;
}

.hg__v.is-out {
  color: #ffd9d9;
}

.od {
  display: flex;
  gap: 12rpx;
}

.od__i {
  flex: 1;
  background: var(--biz-bg-fill);
  border-radius: 14rpx;
  padding: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.od__n {
  font-size: 30rpx;
  color: var(--biz-text-1);
}

.od__n.danger {
  color: var(--biz-danger);
}

.od__k {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.top {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.top:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.top__i {
  width: 40rpx;
  flex: none;
  font-size: 24rpx;
  color: var(--biz-text-4);
  text-align: center;
}

.top__i.is-first {
  color: var(--biz-danger);
  font-weight: 700;
}

.top__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.top__n {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.top__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.top__v {
  font-size: 25rpx;
  color: var(--biz-danger);
}

.banner__bd {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.banner__t {
  font-size: 24rpx;
  font-weight: 600;
}

.banner__d {
  font-size: 21rpx;
  opacity: 0.9;
  line-height: 1.6;
}
</style>
