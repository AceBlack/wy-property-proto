<!-- 底部弹层容器（ActionSheet / 责任员工选择 / 演示开关都用它） -->
<template>
  <view v-if="show" class="sheet-root">
    <view class="sheet__mask" @tap="close" />
    <view class="sheet">
      <view class="sheet__hd">
        <text class="sheet__t">{{ title }}</text>
        <text v-if="sub" class="sheet__s">{{ sub }}</text>
        <view class="sheet__x" @tap="close"><text>✕</text></view>
      </view>
      <scroll-view scroll-y class="sheet__bd" :style="{ maxHeight: maxHeight }">
        <slot />
      </scroll-view>
    </view>
  </view>
</template>

<script setup>
const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  maxHeight: { type: String, default: '62vh' },
  closeOnMask: { type: Boolean, default: true }
})
const emit = defineEmits(['update:show', 'close'])

function close() {
  if (!props.closeOnMask) return
  emit('update:show', false)
  emit('close')
}
</script>

<style scoped>
.sheet-root {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.sheet__mask {
  position: absolute;
  inset: 0;
  background: rgba(16, 31, 66, 0.42);
}

.sheet {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  border-radius: 32rpx 32rpx 0 0;
  padding: 8rpx 0 calc(16rpx + env(safe-area-inset-bottom));
  animation: sheet-in 0.22s ease;
  overflow: hidden;
}

@keyframes sheet-in {
  from {
    transform: translateY(24px);
    opacity: 0.6;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.sheet__hd {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 26rpx 40rpx 12rpx;
  position: relative;
}

.sheet__t {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.sheet__s {
  font-size: 22rpx;
  color: var(--biz-text-3);
  margin-top: 6rpx;
  text-align: center;
}

.sheet__x {
  position: absolute;
  right: 20rpx;
  top: 18rpx;
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--biz-text-4);
  font-size: 26rpx;
}

.sheet__bd {
  padding: 8rpx 28rpx 20rpx;
}
</style>
