<!-- 页签：任务 / 工单 / 审批 / 整改 都用同一套，避免每页各写一遍 -->
<template>
  <view class="seg">
    <view
      v-for="it in items"
      :key="it.key"
      :id="`${idPrefix}${it.key}`"
      class="seg__i"
      :class="{ 'is-on': it.key === modelValue }"
      @tap="pick(it.key)"
    >
      <text class="seg__t">{{ it.label }}</text>
      <text v-if="it.count !== undefined && it.count !== null" class="seg__n num">{{ it.count }}</text>
    </view>
  </view>
</template>

<script setup>
const props = defineProps({
  modelValue: { type: String, default: '' },
  items: { type: Array, default: () => [] },
  idPrefix: { type: String, default: 'seg-' }
})
const emit = defineEmits(['update:modelValue', 'change'])

function pick(key) {
  if (key === props.modelValue) return
  emit('update:modelValue', key)
  emit('change', key)
}
</script>

<style scoped>
.seg {
  display: flex;
  gap: 10rpx;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 18rpx;
  padding: 8rpx;
  margin-bottom: 24rpx;
}

.seg__i {
  flex: 1;
  height: 68rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  border-radius: 14rpx;
}

.seg__i.is-on {
  background: #fff;
  box-shadow: 0 2rpx 10rpx rgba(31, 37, 64, 0.08);
}

.seg__t {
  font-size: 25rpx;
  color: var(--biz-text-3);
}

.seg__i.is-on .seg__t {
  color: var(--biz-primary);
  font-weight: 600;
}

.seg__n {
  font-size: 21rpx;
  color: var(--biz-text-4);
}

.seg__i.is-on .seg__n {
  color: var(--biz-primary);
}
</style>
