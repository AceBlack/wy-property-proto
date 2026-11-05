<template>
  <text class="tag" :class="[`tag--${size}`, plain ? 'is-plain' : '']" :style="styleObj">
    <text v-if="dot" class="tag__dot" :style="{ background: color }" />
    {{ text }}
  </text>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  text: { type: [String, Number], default: '' },
  color: { type: String, default: 'var(--biz-text-3)' },
  bg: { type: String, default: '' },
  dot: { type: Boolean, default: false },
  plain: { type: Boolean, default: true },
  size: { type: String, default: 'md' } // sm | md
})

const styleObj = computed(() => {
  if (!props.plain) return { color: '#fff', background: props.color }
  return {
    color: props.color,
    background: props.bg || 'transparent',
    borderColor: props.color
  }
})
</script>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  border-radius: 999rpx;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.tag--md {
  font-size: 22rpx;
  padding: 8rpx 16rpx;
}

.tag--sm {
  font-size: 20rpx;
  padding: 6rpx 12rpx;
}

.is-plain {
  border: 2rpx solid currentColor;
}

.tag__dot {
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
}
</style>
