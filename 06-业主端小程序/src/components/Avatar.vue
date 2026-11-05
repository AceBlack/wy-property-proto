<template>
  <view class="ava" :class="[`ava--${size}`]" :style="{ background: bg }">
    <text class="ava__t">{{ ch }}</text>
  </view>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  name: { type: String, default: '' },
  size: { type: String, default: 'md' },
  tone: { type: [Number, String], default: 0 }
})
const ch = computed(() => (props.name || '业').slice(0, 1))
const bg = computed(() => {
  const pal = ['#e8ebff', '#e2f7ef', '#fff0e2', '#e6f1ff', '#ffe9ee', '#f0e9ff']
  return pal[Math.abs(Number(props.tone) || 0) % 6]
})
</script>

<style scoped>
.ava {
  flex: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--biz-text-1);
  font-weight: 700;
}
.ava--sm { width: 56rpx; height: 56rpx; font-size: 24rpx; }
.ava--md { width: 76rpx; height: 76rpx; font-size: 30rpx; }
.ava--lg { width: 108rpx; height: 108rpx; font-size: 40rpx; }
.ava__t { line-height: 1; }
</style>
