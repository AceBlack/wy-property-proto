<!--
  工单时间线（竖向）。
  节点由 api/mp.js 的 timelineOf() 从工单字段推导，不另存一份节点表 ——
  业主端和员工端各存一份，早晚会一个说"已完成"、一个说"待确认"。
-->
<template>
  <view class="tl">
    <view v-for="(n, i) in nodes" :key="n.key" class="tl__row" :class="{ 'is-done': n.done }">
      <view class="tl__mark">
        <view class="tl__dot" :style="n.done ? { background: n.tone || 'var(--biz-accent)', borderColor: n.tone || 'var(--biz-accent)' } : {}">
          <text v-if="n.done" class="tl__chk">✓</text>
        </view>
        <view v-if="i < nodes.length - 1" class="tl__line" :class="{ 'is-done': n.done && nodes[i + 1].done }" />
      </view>
      <view class="tl__body">
        <view class="tl__hd">
          <text class="tl__t" :class="{ 'is-done': n.done }">{{ n.label }}</text>
          <text v-if="n.at" class="tl__at">{{ shortAt(n.at) }}</text>
        </view>
        <text v-if="n.note" class="tl__note" :style="n.tone ? { color: n.tone } : {}">{{ n.note }}</text>
      </view>
    </view>
  </view>
</template>

<script setup>
defineProps({
  nodes: { type: Array, default: () => [] }
})

/* 2026-10-21 09:12 → 10-21 09:12 */
const shortAt = s => (s ? String(s).replace(/^\d{4}-/, '') : '')
</script>

<style scoped>
.tl {
  padding: 4rpx 0;
}

.tl__row {
  display: flex;
  gap: 20rpx;
}

.tl__mark {
  flex: none;
  width: 34rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.tl__dot {
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  background: #fff;
  border: 3rpx solid var(--biz-border);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 6rpx;
  z-index: 1;
}

.tl__chk {
  font-size: 16rpx;
  color: #fff;
  line-height: 1;
  font-weight: 700;
}

.tl__line {
  flex: 1;
  width: 3rpx;
  background: var(--biz-border-light);
  margin: 4rpx 0;
  min-height: 40rpx;
}

.tl__line.is-done {
  background: var(--biz-accent);
  opacity: 0.5;
}

.tl__body {
  flex: 1;
  min-width: 0;
  padding-bottom: 26rpx;
}

.tl__hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16rpx;
}

.tl__t {
  font-size: 27rpx;
  color: var(--biz-text-4);
  font-weight: 500;
}

.tl__t.is-done {
  color: var(--biz-text-1);
  font-weight: 600;
}

.tl__at {
  flex: none;
  font-size: 22rpx;
  color: var(--biz-text-4);
  font-family: var(--biz-font-num);
}

.tl__note {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.5;
}
</style>
