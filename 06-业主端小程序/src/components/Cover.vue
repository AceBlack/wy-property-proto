<!--
  占位封面。
  设计稿用实景照片，但工程里没有图片资源，也不该塞假图：这里用 6 组渐变 + 首字，
  保证列表有节奏、又一眼能看出"这是占位"（评审不会误以为是成品图）。
  真图到位后把 cover 换成 image src 即可，class 名不用改。
-->
<template>
  <view class="cover" :class="`cover--${idx}`" :style="{ height: h }">
    <text v-if="label" class="cover__t">{{ label }}</text>
    <view v-if="badge" class="cover__badge"><text>{{ badge }}</text></view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  /* 数据里的 cover 是 0..5 的色板索引 */
  cover: { type: [Number, String], default: 0 },
  label: { type: String, default: '' },
  badge: { type: String, default: '' },
  h: { type: String, default: '220rpx' }
})
const idx = computed(() => Math.abs(Number(props.cover) || 0) % 6)
</script>

<style scoped>
.cover {
  position: relative;
  flex: none;
  width: 100%;
  border-radius: 14rpx;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
  padding: 16rpx;
}

.cover--0 { background: linear-gradient(135deg, #dfe2ff, #c9d0ff); }
.cover--1 { background: linear-gradient(135deg, #d8f5ea, #bfeede); }
.cover--2 { background: linear-gradient(135deg, #ffe7d4, #ffd6b8); }
.cover--3 { background: linear-gradient(135deg, #d9ecff, #bfe0ff); }
.cover--4 { background: linear-gradient(135deg, #ffe0e6, #ffcbd6); }
.cover--5 { background: linear-gradient(135deg, #efe6ff, #ddd0ff); }

.cover__t {
  font-size: 22rpx;
  color: rgba(31, 37, 64, 0.55);
  font-weight: 600;
}

.cover__badge {
  position: absolute;
  top: 12rpx;
  left: 12rpx;
  background: rgba(255, 255, 255, 0.86);
  border-radius: 999rpx;
  padding: 2rpx 12rpx;
  font-size: 19rpx;
  color: var(--biz-text-2);
}
</style>
