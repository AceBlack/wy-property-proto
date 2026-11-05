<template>
  <view class="tc" :class="{ 'is-od': row.time.key === 'overdue' }" hover-class="tc--hover" @tap="$emit('pick', row)">
    <view class="tc__top">
      <text v-if="row.taskType === '监督'" class="tc__type">监督</text>
      <text class="tc__name">{{ row.planName }}</text>
      <Tag :text="row.status" :color="row.statusColor" />
    </view>

    <view class="tc__meta">
      <!-- 超时卡片跨了很多天：只写 09:00 会看不出是哪天，所以带上日期 -->
      <text class="tc__time">{{ showDate ? `${row.dayLabel} ${row.scheduledTime}` : row.scheduledTime }}</text>
      <text class="tc__sep">·</text>
      <text>{{ row.communityName }}</text>
      <text class="tc__sep">·</text>
      <text>{{ row.post }}</text>
      <text v-if="row.targetDeptName" class="tc__sep">·</text>
      <text v-if="row.targetDeptName">被检 {{ row.targetDeptName }}</text>
    </view>

    <view class="tc__foot">
      <!-- 超时/剩余直接在卡片上给出来，不只写状态（交接单 §六） -->
      <text class="tc__state" :class="stateClass">{{ stateText }}</text>
      <view class="tc__right">
        <text v-if="pending" class="tc__pend">待同步</text>
        <text class="tc__items">{{ row.itemCount }} 项</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import Tag from './Tag.vue'

const props = defineProps({
  row: { type: Object, required: true },
  pending: { type: Boolean, default: false }
})
/* 事件名不能叫 tap：uni-app 里 tap 是原生事件，组件上写 @tap 会被当成 DOM 事件，自定义参数传不出来 */
defineEmits(['pick'])

const stateClass = computed(() => {
  if (props.pending) return 'is-pend'
  if (props.row.time.key === 'overdue') return 'is-od'
  if (props.row.time.key === 'soon') return 'is-soon'
  if (props.row.status === '已完成') return 'is-done'
  return ''
})

const stateText = computed(() => {
  const r = props.row
  if (r.status === '已完成') return `已完成${r.doneTime ? ' · ' + String(r.doneTime).slice(11) : ''}${r.score ? ' · ' + r.score + ' 分' : ''}`
  if (r.status === '已转工单') return `已转工单${r.refWoId ? ' · ' + r.refWoId : ''}`
  return r.time.text
})

const showDate = computed(() => props.row.time.key === 'overdue' || props.row.status === '逾期')
</script>

<style scoped>
.tc {
  background: #fff;
  border-radius: 22rpx;
  padding: 24rpx 24rpx 20rpx;
  margin-bottom: 16rpx;
  box-shadow: var(--biz-shadow-card);
  border-left: 6rpx solid transparent;
}

.tc.is-od {
  border-left-color: var(--biz-ins-overdue);
}

.tc--hover {
  background: var(--biz-bg-hover);
}

.tc__top {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.tc__type {
  flex: none;
  font-size: 19rpx;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  color: var(--biz-warning);
  background: #fff8f0;
  border: 2rpx solid rgba(255, 159, 64, 0.3);
  line-height: 1.2;
}

.tc__name {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tc__meta {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8rpx;
  font-size: 23rpx;
  color: var(--biz-text-3);
}

.tc__time {
  font-family: var(--biz-font-num);
  color: var(--biz-text-2);
  font-weight: 600;
}

.tc__sep {
  color: var(--biz-text-4);
}

.tc__foot {
  margin-top: 16rpx;
  padding-top: 14rpx;
  border-top: 2rpx dashed var(--biz-border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tc__state {
  font-size: 23rpx;
  color: var(--biz-text-3);
  font-weight: 500;
}

.tc__state.is-od {
  color: var(--biz-ins-overdue);
  font-weight: 600;
}

.tc__state.is-soon {
  color: var(--biz-warning);
}

.tc__state.is-done {
  color: var(--biz-text-3);
}

.tc__state.is-pend {
  color: var(--biz-primary);
}

.tc__right {
  display: flex;
  align-items: center;
  gap: 14rpx;
}

.tc__pend {
  font-size: 20rpx;
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border: 2rpx solid var(--biz-primary-light-8);
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
}

.tc__items {
  font-size: 22rpx;
  color: var(--biz-text-4);
}
</style>
