<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>物联驾驶舱</b>：不做「设备列表」，做「接入平台」——统一设备影子、协议适配、告警收敛。
        在线率按子系统分列，告警按等级与闭环时长考核；联动场景用于消防/电梯/门禁的自动处置。
      </div>
    </div>

    <!-- KPI -->
    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(6,minmax(0,1fr));">
      <KpiCard
        v-for="(k, i) in im.kpi" :key="k.key"
        :label="k.label" :value="k.value" :unit="k.unit" :trend="k.trend"
        :higher-better="k.good === 'up' || k.key === 'deviceTotal' || k.key === 'doorPass' || k.key === 'carInOut'"
        :icon="kpiIcons[i]" :gradient="i % 2 === 0"
      />
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1.2fr 1fr;">
      <div class="panel">
        <div class="panel__hd"><h3>子系统在线率</h3><span class="spacer" /><span class="desc">低于 90% 视为异常</span></div>
        <EChart :option="optSub" :height="250" />
      </div>
      <div class="panel">
        <div class="panel__hd"><h3>设备类型分布</h3><span class="spacer" /><span class="desc">{{ im.kpi[0].value }} 台</span></div>
        <EChart :option="optType" :height="250" />
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1fr 1fr;">
      <div class="panel">
        <div class="panel__hd"><h3>7 日告警趋势</h3><span class="spacer" /><span class="desc">单位：条</span></div>
        <EChart :option="optAlarmTrend" :height="230" />
      </div>
      <div class="panel">
        <div class="panel__hd"><h3>能耗趋势</h3><span class="spacer" /><RangeFilter default-days="180" @change="onRange" /></div>
        <div class="panel__sub">水 t · 电 kWh</div>
        <EChart :option="optEnergy" :height="230" />
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1.4fr 1fr;">
      <div class="panel">
        <div class="panel__hd">
          <h3>未处理告警</h3><span class="spacer" />
          <span class="desc">按等级排序</span>
          <el-button link type="primary">全部告警</el-button>
        </div>
        <el-table :data="openAlarms" size="small" :height="300">
          <el-table-column label="等级" width="80">
            <template #default="{ row }"><StatusTag domain="alarmLevel" :value="row.level" /></template>
          </el-table-column>
          <el-table-column prop="deviceName" label="设备" width="120" />
          <el-table-column prop="type" label="告警类型" width="130" show-overflow-tooltip />
          <el-table-column prop="content" label="内容" min-width="150" show-overflow-tooltip />
          <el-table-column prop="occurTime" label="发生时间" width="130" />
          <el-table-column label="操作" width="100">
            <template #default><el-button link type="primary">派单</el-button></template>
          </el-table-column>
          <template #empty><EmptyState type="empty" desc="暂无未处理告警" /></template>
        </el-table>
      </div>

      <div class="panel">
        <div class="panel__hd"><h3>联动场景</h3><span class="spacer" /><span class="desc">本月触发</span></div>
        <div v-for="s in im.scenes" :key="s.name" class="scene">
          <div class="scene__hd">
            <span class="scene__n">{{ s.name }}</span>
            <span class="tag" :class="s.status === '启用' ? 'tag--success' : 'tag--muted'">{{ s.status }}</span>
            <span class="spacer" />
            <span class="muted" style="font-size:11.5px;">{{ s.times }} 次</span>
          </div>
          <div class="scene__d">
            <span class="scene__k">触发</span>{{ s.trigger }}
          </div>
          <div class="scene__d">
            <span class="scene__k">动作</span>{{ s.action }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { deviceTypeCount, metrics, openAlarmList } from '@/utils/api'
import EChart from '@/components/EChart.vue'
import KpiCard from '@/components/KpiCard.vue'
import RangeFilter from '@/components/RangeFilter.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { palette } from '@/styles/echarts-theme'
import { monthsInRange } from '@/utils/range'

const im = metrics.iot
const kpiIcons = ['Cpu', 'Connection', 'WarningFilled', 'BellFilled', 'User', 'Van']

// 未处理告警的筛选与排序收归 api
const openAlarms = computed(() => openAlarmList(8))

const optSub = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => `${v}%` },
  grid: { left: 8, right: 20, top: 20, bottom: 8, containLabel: true },
  xAxis: { type: 'value', min: 60, max: 106, axisLabel: { formatter: '{value}%' } },
  yAxis: {
    type: 'category', data: im.subsystemOnline.map(x => x.name).reverse(),
    axisTick: { show: false }
  },
  series: [{
    type: 'bar',
    itemStyle: { borderRadius: [0, 8, 8, 0] },
    data: im.subsystemOnline.slice().reverse().map(x => ({
      value: x.rate,
      itemStyle: { color: x.rate >= 95 ? '#2ED9A3' : x.rate >= 90 ? '#5B6CFF' : '#FF9F40' }
    })),
    label: { show: true, position: 'right', formatter: '{c}%', fontSize: 11 }
  }]
}))

const optType = computed(() => {
  const d = deviceTypeCount()
  return {
    tooltip: { trigger: 'item', formatter: '{b}：{c} 台（{d}%）' },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 11 } },
    series: [{
      type: 'pie', radius: ['48%', '68%'], center: ['50%', '42%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
      label: { show: false },
      data: d.map((x, i) => ({ ...x, itemStyle: { color: palette[i % palette.length] } }))
    }]
  }
})

const optAlarmTrend = computed(() => ({
  tooltip: { trigger: 'axis', valueFormatter: v => `${v} 条` },
  grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
  xAxis: {
    type: 'category', data: ['10-15', '10-16', '10-17', '10-18', '10-19', '10-20', '10-21'],
    axisTick: { show: false }
  },
  yAxis: { type: 'value' },
  series: [{
    type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
    lineStyle: { width: 2.5, color: palette[2] }, itemStyle: { color: palette[2] },
    areaStyle: { color: 'rgba(138,99,242,.12)' },
    data: im.alarmTrend
  }]
}))

// 时间范围只作用于按月聚合的能耗趋势（7 日告警趋势是日粒度，不跟随）
const range = ref(null)
const onRange = r => { range.value = r }
const energySeries = computed(() => monthsInRange(im.energyTrend, range.value))

const optEnergy = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
  grid: { left: 8, right: 16, top: 24, bottom: 30, containLabel: true },
  xAxis: {
    type: 'category', data: energySeries.value.map(x => x.month),
    axisTick: { show: false }
  },
  yAxis: [
    { type: 'value', name: '电', nameTextStyle: { color: '#8A94B0' } },
    { type: 'value', name: '水', splitLine: { show: false }, nameTextStyle: { color: '#8A94B0' } }
  ],
  series: [
    { name: '用电', type: 'bar', itemStyle: { color: palette[0] }, data: energySeries.value.map(x => x.power) },
    { name: '用水', type: 'line', yAxisIndex: 1, smooth: true, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2.5, color: palette[1] }, itemStyle: { color: palette[1] }, data: energySeries.value.map(x => x.water) }
  ]
}))
</script>

<style scoped>
.scene { padding: 10px 0; border-bottom: 1px solid var(--biz-border-light); }
.scene:last-child { border-bottom: none; }
.scene__hd { display: flex; align-items: center; gap: 8px; }
.scene__hd .spacer { flex: 1; }
.scene__n { font-size: 13px; font-weight: 500; }
.scene__d { font-size: 12px; color: var(--biz-text-2); margin-top: 4px; }
.scene__k { display: inline-block; width: 34px; color: var(--biz-text-3); }
</style>
