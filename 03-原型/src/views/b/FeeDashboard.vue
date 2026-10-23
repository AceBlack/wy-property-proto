<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>费用驾驶舱</b>：应收 → 实收 → 欠费 → 收缴率四段口径。欠费按账龄分桶（30/90/180 天），
        账龄比总额更重要——超过 180 天基本要走法务，不再计入催缴有效率。
      </div>
    </div>

    <!-- KPI -->
    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(6,minmax(0,1fr));">
      <KpiCard
        v-for="(k, i) in fm.kpi" :key="k.key"
        :label="k.label" :value="k.value" :unit="k.unit" :trend="k.trend"
        :higher-better="k.good !== 'down'"
        :icon="kpiIcons[i]" :gradient="i % 2 === 0"
      />
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:2fr 1fr;">
      <div class="panel">
        <div class="panel__hd">
          <h3>收缴率趋势</h3><span class="spacer" />
          <RangeFilter default-days="180" @change="onRange" />
        </div>
        <div class="panel__sub">目标线 {{ target }}% · 10 月为截至 10-21 的进行中数据</div>
        <EChart :option="optRate" :height="260" />
      </div>
      <div class="panel">
        <div class="panel__hd"><h3>应收构成</h3><span class="spacer" /><span class="desc">按科目</span></div>
        <EChart :option="optComposition" :height="260" />
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1fr 1.4fr;">
      <div class="panel">
        <div class="panel__hd">
          <h3>欠费账龄分布</h3><span class="spacer" />
          <span class="desc">按笔数</span>
        </div>
        <EChart :option="optAging" :height="250" />
      </div>

      <div class="panel">
        <div class="panel__hd">
          <h3>欠费 TOP 10</h3><span class="spacer" />
          <span class="desc">点击可进入业主 360</span>
        </div>
        <el-table :data="top" size="small" :height="250" @row-click="goOwner">
          <el-table-column type="index" label="#" width="46" />
          <el-table-column prop="name" label="业主" width="100" />
          <el-table-column prop="debt" label="欠费金额" width="130" align="right">
            <template #default="{ row }">
              <span class="money money--out">{{ money(row.debt) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="count" label="笔数" width="80" align="right" />
          <el-table-column label="最长逾期" width="110" align="right">
            <template #default="{ row }">
              <span :class="{ 'is-danger': row.maxOverdue > 180 }">{{ row.maxOverdue }} 天</span>
            </template>
          </el-table-column>
          <el-table-column label="风险" min-width="110">
            <template #default="{ row }">
              <span class="tag" :class="row.maxOverdue > 180 ? 'tag--danger' : row.maxOverdue > 90 ? 'tag--warning' : 'tag--primary'">
                {{ row.maxOverdue > 180 ? '法务' : row.maxOverdue > 90 ? '重点催缴' : '常规' }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd"><h3>项目收缴对比</h3><span class="spacer" /><span class="desc">更新于 {{ fm.updateTime }}</span></div>
      <el-table :data="byProject" size="small">
        <el-table-column prop="name" label="项目" width="140" />
        <el-table-column prop="receivable" label="应收" width="150" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.receivable) }}</span></template>
        </el-table-column>
        <el-table-column prop="received" label="实收" width="150" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.received) }}</span></template>
        </el-table-column>
        <el-table-column prop="debt" label="欠费" width="140" align="right">
          <template #default="{ row }"><span class="money money--out">{{ money(row.debt) }}</span></template>
        </el-table-column>
        <el-table-column label="收缴率" min-width="220">
          <template #default="{ row }">
            <div class="rate">
              <div class="rate__bar"><i :style="{ width: Math.min(row.rate, 100) + '%' }" /></div>
              <span class="rate__n">{{ pct(row.rate) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span class="tag" :class="row.rate >= target ? 'tag--success' : 'tag--danger'">
              {{ row.rate >= target ? '达标' : '未达标' }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { agingBuckets, feeByProject, metrics } from '@/utils/api'
import EChart from '@/components/EChart.vue'
import KpiCard from '@/components/KpiCard.vue'
import RangeFilter from '@/components/RangeFilter.vue'
import { palette } from '@/styles/echarts-theme'
import { debtRank, feeSummary } from '@/utils/api'
import { bucketColor } from '@/utils/dict'
import { money, pct } from '@/utils/format'
import { monthsInRange } from '@/utils/range'

const router = useRouter()
const fm = metrics.fee
const target = 90
const kpiIcons = ['Money', 'Wallet', 'WarningFilled', 'TrendCharts', 'Tickets', 'Discount']

const summary = feeSummary()
const top = debtRank(10)

// 时间范围：默认近半年（本体指标按月聚合，7 天粒度无数据可切）
const range = ref(null)
const onRange = r => { range.value = r }
const rateSeries = computed(() => monthsInRange(fm.monthlyRate, range.value))
const rateMin = computed(() => {
  const min = Math.min(...rateSeries.value.map(x => x.rate), target)
  return Math.max(0, Math.floor(min / 5) * 5 - 5)
})

// 项目维度汇总收归 api，页面不再遍历原始账单
const byProject = computed(() => feeByProject())

const optRate = computed(() => ({
  tooltip: { trigger: 'axis', valueFormatter: v => `${v}%` },
  grid: { left: 8, right: 20, top: 30, bottom: 8, containLabel: true },
  xAxis: {
    type: 'category', data: rateSeries.value.map(x => x.month), boundaryGap: false,
    axisTick: { show: false }
  },
  yAxis: {
    type: 'value', min: rateMin.value, max: 100, axisLabel: { formatter: '{value}%' }
  },
  series: [{
    type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
    lineStyle: { width: 2.5, color: palette[0] },
    itemStyle: { color: palette[0] },
    areaStyle: { color: 'rgba(91,108,255,.12)' },
    data: rateSeries.value.map(x => x.rate),
    markLine: {
      silent: true, symbol: 'none',
      lineStyle: { color: '#FF6B6B', type: 'dashed', width: 1 },
      // 贴在线上方内侧，避免长标签被图区右边缘裁掉
      label: { formatter: `目标 ${target}%`, color: '#EC4D63', fontSize: 11, position: 'insideStartTop' },
      data: [{ yAxis: target }]
    }
  }]
}))

const optComposition = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}：{c}%' },
  legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
  series: [{
    type: 'pie', radius: ['52%', '72%'], center: ['50%', '44%'],
    itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
    label: { show: false },
    data: fm.feeComposition.map((x, i) => ({ ...x, itemStyle: { color: palette[i] } }))
  }]
}))

// 账龄分桶：以所有欠费账单的 overdueDays 为准
const optAging = computed(() => {
  const buckets = agingBuckets()
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => `${v} 笔` },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category', data: buckets.map(x => x.name),
      axisTick: { show: false },
      axisLabel: { fontSize: 11 }
    },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar', 
      data: buckets.map(x => ({ value: x.n, itemStyle: { color: bucketColor('aging', x.name) } }))
    }]
  }
})

function goOwner(row) {
  router.push('/a/owner360')
}
</script>

<style scoped>
.is-danger { color: var(--biz-danger); font-weight: 600; }
.rate { display: flex; align-items: center; gap: 10px; }
.rate__bar { flex: 1; height: 7px; border-radius: 999px; background: var(--biz-bg-fill); overflow: hidden; }
.rate__bar i { display: block; height: 7px; border-radius: 999px; background: var(--biz-gradient); }
.rate__n { font-family: var(--biz-font-num); font-size: 12.5px; width: 46px; text-align: right; }
</style>
