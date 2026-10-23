<template>
  <div class="kpi">
    <span class="kpi__ico" :style="{ background: icoBg }">
      <el-icon><component :is="icon || 'DataLine'" /></el-icon>
    </span>
    <div class="kpi__label">{{ label }}</div>
    <div class="kpi__val">
      {{ display }}<span v-if="displayUnit" class="unit">{{ displayUnit }}</span>
    </div>
    <div v-if="trend !== undefined && trend !== null" class="kpi__trend" :class="trendClass">
      <el-icon><component :is="trendIcon" /></el-icon>
      {{ trendText }}<span style="color:#b3bad0;margin-left:4px;">较上期</span>
    </div>
    <div v-else-if="hint" class="kpi__trend flat">{{ hint }}</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { money, trendText as fmtTrend } from '@/utils/format'

const props = defineProps({
  label: { type: String, required: true },
  value: { type: [Number, String], default: 0 },
  unit: { type: String, default: '' },
  /** 千分位格式化；false 用于已格式化好的字符串（如比率保留 1 位） */
  format: { type: Boolean, default: true },
  trend: { type: [Number, String], default: null },
  /** true=上升为佳（收缴率），false=下降为佳（空置率、欠费率） */
  higherBetter: { type: Boolean, default: true },
  hint: { type: String, default: '' },
  icon: { type: String, default: 'DataLine' },
  color: { type: String, default: '#5B6CFF' },
  gradient: { type: Boolean, default: false }
})

// 金额超过 10 万折成万元：6 列 KPI 下 516,734.62 会撑破卡片
const isWan = computed(() =>
  props.unit === '元' && typeof props.value === 'number' && Math.abs(props.value) >= 50000
)
const displayUnit = computed(() => (isWan.value ? '万元' : props.unit))
const display = computed(() => {
  let v = props.value
  if (isWan.value) v = v / 10000
  if (!props.format || typeof v !== 'number') return v
  if (Number.isInteger(v)) return money(v, 0)
  const one = Math.round(v * 10) / 10
  return money(v, Math.abs(v - one) < 1e-9 ? 1 : 2)
})
const icoBg = computed(() =>
  props.gradient ? 'linear-gradient(135deg,#5b6cff 0%,#2ed9a3 100%)' : props.color
)
const trendText = computed(() => fmtTrend(props.trend))
const trendUp = computed(() => Number(props.trend) > 0)
const trendClass = computed(() => {
  const n = Number(props.trend)
  if (!n) return 'flat'
  const good = props.higherBetter ? n > 0 : n < 0
  return good ? 'up' : 'down'
})
const trendIcon = computed(() => {
  const n = Number(props.trend)
  if (!n) return 'Minus'
  return n > 0 ? 'Top' : 'Bottom'
})
</script>
