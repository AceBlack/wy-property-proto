<!-- 三步流程指示：打卡 → 逐项 → 提交 -->
<template>
  <view class="steps">
    <view v-for="(s, i) in steps" :key="s" class="step">
      <view class="step__mark">
        <view class="step__dot" :class="{ 'is-done': i < current, 'is-now': i === current }">
          <text v-if="i < current" class="step__chk">✓</text>
          <text v-else class="step__n">{{ i + 1 }}</text>
        </view>
        <view v-if="i < steps.length - 1" class="step__line" :class="{ 'is-done': i < current }" />
      </view>
      <text class="step__t" :class="{ 'is-now': i === current, 'is-done': i < current }">{{ s }}</text>
    </view>
  </view>
</template>

<script setup>
defineProps({
  steps: { type: Array, default: () => ['打卡', '逐项判定', '提交'] },
  current: { type: Number, default: 0 }
})
</script>

<style scoped>
.steps {
  display: flex;
  align-items: flex-start;
  padding: 4rpx 0 8rpx;
}

.step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
}

.step__mark {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.step__dot {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  background: #fff;
  border: 2rpx solid var(--biz-border);
  color: var(--biz-text-4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  font-weight: 600;
  z-index: 1;
}

.step__dot.is-now {
  border-color: var(--biz-primary);
  color: #fff;
  background: var(--biz-primary);
  box-shadow: 0 0 0 8rpx rgba(91, 108, 255, 0.12);
}

.step__dot.is-done {
  border-color: var(--biz-accent);
  background: var(--biz-accent);
  color: #fff;
}

.step__chk {
  font-size: 22rpx;
  line-height: 1;
}

.step__n {
  font-family: var(--biz-font-num);
  line-height: 1;
}

.step__line {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100%;
  height: 4rpx;
  background: var(--biz-border-light);
  z-index: 0;
}

.step__line.is-done {
  background: var(--biz-accent);
}

.step__t {
  margin-top: 12rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.step__t.is-now {
  color: var(--biz-primary);
  font-weight: 600;
}

.step__t.is-done {
  color: var(--biz-accent-dark);
}
</style>
