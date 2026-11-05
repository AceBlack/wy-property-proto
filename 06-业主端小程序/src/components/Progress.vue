<!-- 报修三段进度：待受理 → 处理中 → 已完成（列表卡片与详情页共用） -->
<template>
  <view class="prog">
    <view v-for="(s, i) in stages" :key="s" class="prog__item">
      <view class="prog__mark">
        <view class="prog__dot" :class="{ 'is-done': i <= current, 'is-now': i === current }">
          <text v-if="i < current" class="prog__chk">✓</text>
        </view>
        <view v-if="i < stages.length - 1" class="prog__line" :class="{ 'is-done': i < current }" />
      </view>
      <text class="prog__t" :class="{ 'is-done': i <= current }">{{ s }}</text>
    </view>
  </view>
</template>

<script setup>
import { STAGES } from '@/api/mp'
defineProps({
  current: { type: Number, default: 0 },
  stages: { type: Array, default: () => STAGES }
})
</script>

<style scoped>
.prog { display: flex; align-items: flex-start; }
.prog__item { flex: 1; display: flex; flex-direction: column; align-items: center; }
.prog__mark { width: 100%; display: flex; align-items: center; justify-content: center; position: relative; }
.prog__dot {
  width: 32rpx; height: 32rpx; border-radius: 50%; background: #fff;
  border: 3rpx solid var(--biz-border); display: flex; align-items: center; justify-content: center; z-index: 1;
}
.prog__dot.is-done { background: var(--biz-primary); border-color: var(--biz-primary); }
.prog__dot.is-now { box-shadow: 0 0 0 8rpx rgba(91, 108, 255, 0.12); }
.prog__chk { font-size: 18rpx; color: #fff; line-height: 1; }
.prog__line { position: absolute; top: 50%; left: 50%; width: 100%; height: 4rpx; background: var(--biz-border-light); z-index: 0; }
.prog__line.is-done { background: var(--biz-primary); opacity: 0.45; }
.prog__t { margin-top: 10rpx; font-size: 20rpx; color: var(--biz-text-4); }
.prog__t.is-done { color: var(--biz-primary); }
</style>
