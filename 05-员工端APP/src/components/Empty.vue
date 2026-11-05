<template>
  <view class="empty">
    <view class="empty__ico">
      <view class="empty__line" />
      <view class="empty__line empty__line--short" />
    </view>
    <text class="empty__t">{{ text }}</text>
    <text v-if="sub" class="empty__s">{{ sub }}</text>
    <slot />
  </view>
</template>

<script setup>
defineProps({
  text: { type: String, default: '暂无数据' },
  sub: { type: String, default: '' }
})
</script>

<style scoped>
.empty {
  padding: 100rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
}

.empty__ico {
  width: 96rpx;
  height: 76rpx;
  border: 3rpx solid var(--biz-border);
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10rpx;
  margin-bottom: 6rpx;
}

.empty__line {
  width: 48rpx;
  height: 4rpx;
  border-radius: 4rpx;
  background: var(--biz-border);
}

.empty__line--short {
  width: 28rpx;
}

.empty__t {
  font-size: 28rpx;
  color: var(--biz-text-3);
}

.empty__s {
  font-size: 23rpx;
  color: var(--biz-text-4);
  text-align: center;
  line-height: 1.6;
  max-width: 460rpx;
}
</style>
