<!-- 信息行：label 左、value 右，可选备注与箭头。整页只用这一种行，避免各页排版各写一套 -->
<template>
  <view class="cell" :class="{ 'cell--last': last }" @tap="$emit('tap')">
    <text class="cell__k">{{ label }}</text>
    <view class="cell__v">
      <slot>
        <text class="cell__t" :class="strong ? 'is-strong' : ''">{{ value }}</text>
      </slot>
    </view>
    <view v-if="arrow" class="cell__chev" />
  </view>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
  value: { type: [String, Number], default: '' },
  strong: { type: Boolean, default: false },
  arrow: { type: Boolean, default: false },
  last: { type: Boolean, default: false }
})
defineEmits(['tap'])
</script>

<style scoped>
.cell {
  display: flex;
  align-items: flex-start;
  gap: 24rpx;
  padding: 22rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.cell--last {
  border-bottom: none;
  padding-bottom: 0;
}

.cell__k {
  flex: none;
  width: 160rpx;
  font-size: 26rpx;
  color: var(--biz-text-3);
  line-height: 1.5;
}

.cell__v {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
}

.cell__t {
  font-size: 27rpx;
  color: var(--biz-text-2);
  text-align: right;
  line-height: 1.5;
  word-break: break-all;
}

.cell__t.is-strong {
  color: var(--biz-text-1);
  font-weight: 600;
}

.cell__chev {
  width: 14rpx;
  height: 14rpx;
  border-top: 3rpx solid var(--biz-text-4);
  border-right: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
  margin-top: 12rpx;
  flex: none;
}
</style>
