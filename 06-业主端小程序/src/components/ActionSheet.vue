<template>
  <Sheet :show="show" :title="title" :sub="sub" max-height="58vh" @update:show="v => emit('update:show', v)">
    <view v-if="needFilter" class="as__filter">
      <input v-model="kw" class="as__input" :placeholder="filterPlaceholder" placeholder-class="ph" />
    </view>

    <view
      v-for="a in shown"
      :key="String(a.value)"
      class="as__item"
      :class="{ 'is-active': a.active, 'is-danger': a.danger }"
      hover-class="as__item--hover"
      @tap="pick(a)"
    >
      <view class="as__txt">
        <text class="as__label">{{ a.label }}</text>
        <text v-if="a.desc" class="as__desc">{{ a.desc }}</text>
      </view>
      <text v-if="a.active" class="as__chk">✓</text>
    </view>

    <view v-if="!shown.length" class="as__empty">{{ emptyText }}</view>

    <view class="as__cancel" hover-class="as__item--hover" @tap="close">取消</view>
  </Sheet>
</template>

<script setup>
import { computed, ref } from 'vue'
import Sheet from './Sheet.vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '请选择' },
  sub: { type: String, default: '' },
  actions: { type: Array, default: () => [] },
  emptyText: { type: String, default: '没有可选内容' },
  filterPlaceholder: { type: String, default: '搜索' }
})
const emit = defineEmits(['update:show', 'select'])

const kw = ref('')
const needFilter = computed(() => props.actions.length > 8)
const shown = computed(() => {
  const k = kw.value.trim()
  if (!k) return props.actions
  return props.actions.filter(a => `${a.label}${a.desc || ''}`.includes(k))
})

function pick(a) {
  emit('select', a.value, a)
  emit('update:show', false)
  kw.value = ''
}

function close() {
  emit('update:show', false)
}
</script>

<style scoped>
.as__filter {
  padding: 4rpx 0 16rpx;
}

.as__input {
  height: 72rpx;
  background: var(--biz-bg-fill);
  border-radius: 14rpx;
  padding: 0 20rpx;
  font-size: 26rpx;
}

.ph {
  color: var(--biz-text-4);
}

.as__item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 20rpx;
  border-radius: 16rpx;
  margin-bottom: 8rpx;
  background: var(--biz-bg-fill);
}

.as__item--hover {
  background: var(--biz-primary-light-9);
}

.as__item.is-active {
  background: var(--biz-primary-light-9);
}

.as__txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.as__label {
  font-size: 28rpx;
  color: var(--biz-text-1);
  font-weight: 500;
}

.as__item.is-danger .as__label {
  color: var(--biz-danger);
}

.as__desc {
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.4;
}

.as__chk {
  color: var(--biz-primary);
  font-size: 28rpx;
  font-weight: 700;
}

.as__empty {
  padding: 60rpx 0;
  text-align: center;
  font-size: 26rpx;
  color: var(--biz-text-4);
}

.as__cancel {
  margin-top: 16rpx;
  height: 92rpx;
  border-radius: 16rpx;
  background: #fff;
  border: 2rpx solid var(--biz-border-light);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: var(--biz-text-2);
}
</style>
