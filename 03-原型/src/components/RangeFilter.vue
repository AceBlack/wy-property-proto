<template>
  <div class="range-filter">
    <el-radio-group v-model="quick" @change="onQuick">
      <el-radio-button v-for="p in RANGE_PRESETS" :key="p.value" :value="p.value">
        {{ p.label }}
      </el-radio-button>
    </el-radio-group>

    <el-date-picker
      v-model="dates"
      type="daterange"
      unlink-panels
      :clearable="false"
      range-separator="至"
      start-placeholder="开始日期"
      end-placeholder="结束日期"
      style="width: 250px"
      @change="onDates"
    />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { RANGE_PRESETS, presetRange } from '@/utils/range'

const emit = defineEmits(['change'])

// 默认「近 30 天」；驾驶舱按月度聚合时可传 default-days="180"
const props = defineProps({
  defaultDays: { type: Number, default: 30 }
})

const quick = ref(String(props.defaultDays))
const dates = ref([])

function apply (days) {
  const r = presetRange(days)
  dates.value = [r.start, r.end]
  emit('change', { ...r, quick: quick.value })
}

function onQuick (v) {
  apply(Number(v))
}

function onDates (v) {
  if (!v || v.length !== 2) return
  const [start, end] = v
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1)
  // 手动改日期后取消预设高亮，但仍把区间交给上层
  if (!RANGE_PRESETS.some(p => p.days === days)) quick.value = ''
  emit('change', { start, end, days, quick: 'custom' })
}

onMounted(() => apply(props.defaultDays))
</script>

<style scoped>
.range-filter {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* 分段按钮：胶囊分组，选中态用主色（与组件规范的分段控件一致） */
.range-filter :deep(.el-radio-group) {
  background: var(--biz-bg-fill);
  border-radius: var(--biz-radius-btn);
  padding: 2px;
}
.range-filter :deep(.el-radio-button__inner) {
  border: none;
  background: transparent;
  box-shadow: none !important;
  border-radius: 4px;
  height: 28px;
  line-height: 28px;
  padding: 0 12px;
  font-size: 12.5px;
  color: var(--biz-text-2);
}
.range-filter :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: #fff;
  color: var(--el-color-primary);
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(31, 37, 64, .08) !important;
}
</style>
