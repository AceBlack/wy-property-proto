<template>
  <div ref="box" class="chart" :style="{ height: `${height}px` }" />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { echarts } from '@/utils/chart'

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: [Number, String], default: 280 }
})
/** 图表点击事件：A 级交互的下钻入口（params.dataIndex / name / value） */
const emit = defineEmits(['click'])

const box = ref(null)
let inst = null
let ro = null

function render() {
  if (!box.value) return
  if (!inst) {
    inst = echarts.init(box.value, 'wy')
    inst.on('click', params => emit('click', params))
  }
  inst.setOption(props.option, true)
}

onMounted(() => {
  nextTick(render)
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => inst && inst.resize())
    ro.observe(box.value)
  }
})

watch(() => props.option, () => render(), { deep: true })

onBeforeUnmount(() => {
  ro && ro.disconnect()
  inst && inst.dispose()
  inst = null
})
</script>
