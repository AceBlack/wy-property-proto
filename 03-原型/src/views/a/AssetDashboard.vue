<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>资产驾驶舱（L1 决策层）</b>：面向总经理/区域总监，只回答三件事——家底多少、结构是否健康、风险在哪。
        指标口径：空置率 = 空置房 / 总房；产权办理率 = 已办证 / 总房；车位健康度按 已售/已租/闲置/不可用 分档。
      </div>
    </div>

    <!-- KPI -->
    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(6,minmax(0,1fr));">
      <KpiCard
        v-for="(k, i) in m.kpi" :key="k.key"
        :label="k.label" :value="k.value" :unit="k.unit"
        :trend="k.trend" :higher-better="k.good !== 'down'"
        :icon="kpiIcons[i]" :gradient="i % 2 === 0"
      />
    </div>

    <!-- 项目对比 -->
    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd"><h3>项目资产概览</h3><span class="spacer" /><span class="desc">共 {{ communities.length }} 个在管项目</span></div>
      <el-table :data="communities" size="small">
        <el-table-column prop="name" label="项目" width="140" />
        <el-table-column prop="bizType" label="业态" width="90" />
        <el-table-column prop="houseCount" label="房屋" width="90" align="right" />
        <el-table-column prop="parkCount" label="车位" width="90" align="right" />
        <el-table-column prop="buildArea" label="建筑面积" width="120" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.buildArea) }}</span> ㎡</template>
        </el-table-column>
        <el-table-column prop="greenRate" label="绿化率" width="100" align="right">
          <template #default="{ row }">{{ pct(row.greenRate) }}</template>
        </el-table-column>
        <el-table-column label="物业费" width="130" align="right">
          <template #default="{ row }">{{ money(row.propertyFee) }} {{ row.feeUnit }}</template>
        </el-table-column>
        <el-table-column label="合同期" min-width="180">
          <template #default="{ row }">{{ row.contractStart }} ~ {{ row.contractEnd }}</template>
        </el-table-column>
        <el-table-column prop="manager" label="项目经理" width="110" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <span class="tag tag--success">{{ row.status }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1fr 1fr;">
      <div class="panel">
        <div class="panel__hd"><h3>房屋用途结构</h3><span class="spacer" /><span class="desc">{{ totalHouse }} 套</span></div>
        <EChart :option="optComposition" :height="240" />
      </div>
      <div class="panel">
        <div class="panel__hd"><h3>使用状态分布</h3></div>
        <EChart :option="optUseStatus" :height="240" />
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:2fr 1fr;">
      <div class="panel">
        <div class="panel__hd"><h3>各楼栋空置率</h3><span class="spacer" /><span class="desc">≥15% 视为预警</span></div>
        <EChart :option="optVacant" :height="260" />
      </div>
      <div class="panel">
        <div class="panel__hd"><h3>风险提示</h3><span class="spacer" /><span class="desc">{{ m.risks.length }} 条</span></div>
        <div v-for="r in m.risks" :key="r.type" class="risk">
          <span class="tag" :class="r.level === '高' ? 'tag--danger' : 'tag--warning'">{{ r.level }}</span>
          <div class="risk__b">
            <div class="risk__t">{{ r.type }} · {{ r.count }} 项</div>
            <div class="risk__d">{{ r.content }}</div>
            <div class="risk__a">建议：{{ r.action }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1fr 1fr;">
      <div class="panel">
        <div class="panel__hd"><h3>车位状态</h3><span class="spacer" /><span class="desc">{{ parkingTotal() }} 个</span></div>
        <EChart :option="optPark" :height="230" />
      </div>
      <div class="panel">
        <div class="panel__hd"><h3>车位管理费到期分布</h3><span class="spacer" /><span class="desc">用于提前续费触达</span></div>
        <EChart :option="optExpire" :height="230" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { communities, metrics, parkingExpireBuckets, parkingTotal } from '@/utils/api'
import EChart from '@/components/EChart.vue'
import KpiCard from '@/components/KpiCard.vue'
import { heatColor, palette } from '@/styles/echarts-theme'
import { bucketColor, statusColor } from '@/utils/dict'
import { money, pct } from '@/utils/format'

const m = metrics.asset
const kpiIcons = ['OfficeBuilding', 'House', 'Aim', 'User', 'WarnTriangleFilled', 'CircleCheck']
const totalHouse = m.composition.reduce((s, x) => s + x.value, 0)

const optComposition = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}：{c} 套（{d}%）' },
  legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
  series: [{
    type: 'pie', radius: ['52%', '72%'], center: ['50%', '44%'],
    itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
    label: { show: false },
    data: m.composition.map((x, i) => ({ ...x, itemStyle: { color: palette[i] } }))
  }]
}))

const optUseStatus = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}：{c} 套（{d}%）' },
  legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
  series: [{
    type: 'pie', radius: ['52%', '72%'], center: ['50%', '44%'],
    itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
    label: { show: false },
    data: m.useStatus.map(x => ({ name: x.name, value: x.value, itemStyle: { color: statusColor('house', x.name) } }))
  }]
}))

const optVacant = computed(() => ({
  tooltip: { trigger: 'axis', valueFormatter: v => `${v}%` },
  grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
  xAxis: {
    type: 'category', data: m.vacantByBuilding.map(x => x.name),
    axisTick: { show: false }
  },
  yAxis: {
    type: 'value', axisLabel: { formatter: '{value}%' }
  },
  series: [{
    type: 'bar', 
    data: m.vacantByBuilding.map(x => ({ value: x.rate, itemStyle: { color: heatColor(x.rate) } }))
  }]
}))

const optPark = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
  xAxis: { type: 'value' },
  yAxis: {
    type: 'category', data: m.parkHealth.map(x => x.name),
    axisTick: { show: false }
  },
  series: [{
    type: 'bar', itemStyle: { borderRadius: [0, 8, 8, 0] },
    data: m.parkHealth.map((x, i) => ({ value: x.value, itemStyle: { color: palette[i] } }))
  }]
}))

// 车位管理费到期分桶：已过期 / 30 天内 / 90 天内 / 半年内 / 一年以上
// 配色走 dict 的 expire 分桶，与图例、其他驾驶舱共用一套语义
const optExpire = computed(() => {
  const b = parkingExpireBuckets()
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => `${v} 个` },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: b.map(x => x.name),
      axisTick: { show: false }
    },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar', 
      data: b.map(x => ({ value: x.n, itemStyle: { color: bucketColor('expire', x.name) } }))
    }]
  }
})
</script>

<style scoped>
.risk { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--biz-border-light); }
.risk:last-child { border-bottom: none; }
.risk .tag { flex: 0 0 auto; height: 20px; }
.risk__b { min-width: 0; }
.risk__t { font-size: 13px; font-weight: 500; color: var(--biz-text-1); }
.risk__d { font-size: 12.5px; color: var(--biz-text-2); margin-top: 3px; }
.risk__a { font-size: 12px; color: var(--el-color-primary); margin-top: 3px; }
</style>
