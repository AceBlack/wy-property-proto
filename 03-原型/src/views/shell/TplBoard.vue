<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>看板页模板 · A 级交互</b>：KPI 行（一行放满，指标 4–6 个）→ 图表栅格（主图占 2/3，次图/列表占 1/3）→ 明细排行。
        所有图表走 <code>wy</code> 主题，禁止页面内硬编码颜色；指标语义色保持「达标绿 / 未达标红」。
        ①点击图表区块可<b>下钻</b>到该分类的房屋明细（抽屉，走 <code>api.queryHouses</code>）；②风险条目可跳对应业务页。
      </div>
    </div>

    <!-- KPI 行 -->
    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(6,minmax(0,1fr));">
      <KpiCard
        v-for="(k, i) in m.kpi" :key="k.key"
        :label="k.label" :value="k.value" :unit="k.unit"
        :trend="k.trend" :higher-better="k.good !== 'down'"
        :icon="kpiIcons[i]" :gradient="i % 2 === 0"
      />
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:2fr 1fr;">
      <!-- 房屋用途结构 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>房屋用途结构</h3>
          <span class="spacer" />
          <span class="desc">共 {{ totalHouse }} 套 · 点扇区下钻</span>
        </div>
        <EChart :option="optComposition" :height="240" @click="onCompositionClick" />
      </div>

      <!-- 使用状态分布 -->
      <div class="panel">
        <div class="panel__hd"><h3>使用状态分布</h3><span class="spacer" /><span class="desc">点扇区下钻</span></div>
        <EChart :option="optUseStatus" :height="240" @click="onUseStatusClick" />
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:2fr 1fr;">
      <!-- 楼栋空置率 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>各楼栋空置率</h3>
          <span class="spacer" />
          <span class="desc">超过 15% 判定为预警</span>
        </div>
        <EChart :option="optVacant" :height="260" @click="onVacantClick" />
      </div>

      <!-- 风险清单 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>风险提示</h3>
          <span class="spacer" />
          <span class="desc">{{ m.risks.length }} 条</span>
        </div>
        <div v-for="r in m.risks" :key="r.type + r.content" class="risk" @click="onRisk(r)">
          <span class="tag" :class="r.level === '高' ? 'tag--danger' : 'tag--warning'">{{ r.level }}</span>
          <div class="risk__b">
            <div class="risk__t">{{ r.type }} · {{ r.count }} 项</div>
            <div class="risk__d">{{ r.content }}</div>
            <div class="risk__a">建议：{{ r.action }}</div>
          </div>
          <span class="risk__go">查看 →</span>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd"><h3>车位状态</h3><span class="spacer" /><span class="desc">更新于 {{ m.updateTime }}</span></div>
      <EChart :option="optPark" :height="220" />
    </div>

    <!-- 下钻抽屉 -->
    <DetailDrawer
      v-model="drill.visible" :loading="drill.loading"
      :title="drill.title" :subtitle="`共 ${drill.total} 套 · 展示前 ${drill.rows.length} 套`"
    >
      <el-table :data="drill.rows" size="small" max-height="480">
        <el-table-column prop="fullName" label="房屋" min-width="180" show-overflow-tooltip />
        <el-table-column prop="usage" label="用途" width="90" />
        <el-table-column prop="area" label="面积" width="100" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.area) }}</span> ㎡</template>
        </el-table-column>
        <el-table-column prop="useStatus" label="使用状态" width="110">
          <template #default="{ row }"><StatusTag domain="house" :value="row.useStatus" /></template>
        </el-table-column>
        <el-table-column prop="checkinDate" label="入住日期" width="120" />
      </el-table>
      <template #footer>
        <el-button @click="drill.visible = false">关闭</el-button>
        <el-button type="primary" @click="goList">在列表页查看全部</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { metrics, queryHouses } from '@/utils/api'
import EChart from '@/components/EChart.vue'
import KpiCard from '@/components/KpiCard.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import { heatColor, palette } from '@/styles/echarts-theme'
import { statusColor } from '@/utils/dict'
import { money } from '@/utils/format'

const router = useRouter()

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
    type: 'bar',
    itemStyle: { borderRadius: [0, 8, 8, 0] },
    data: m.parkHealth.map((x, i) => ({ value: x.value, itemStyle: { color: palette[i] } }))
  }]
}))

/* ---------------- 下钻（A 级交互） ---------------- */
const drill = reactive({ visible: false, loading: false, title: '', rows: [], total: 0, filters: {} })

async function openDrill(title, filters) {
  drill.title = title
  drill.filters = filters
  drill.visible = true
  drill.loading = true
  try {
    const res = await queryHouses({ pageNo: 1, size: 20, filters })
    drill.rows = res.rows
    drill.total = res.total
  } finally {
    drill.loading = false
  }
}
const onCompositionClick = p => openDrill(`用途 · ${p.name}`, { usage: p.name })
const onUseStatusClick = p => openDrill(`使用状态 · ${p.name}`, { useStatus: p.name })
const onVacantClick = p => openDrill(`${p.name} · 空置房屋`, { communityId: '', useStatus: '空置' })
function goList() { router.push('/shell/list') }

/** 风险条目：跳对应业务页（原型阶段按类型落到已有页面） */
function onRisk(r) {
  // 「车位到期」落到合并后的车位页，并直接选中「30 天内到期」虚拟节点
  const map = { '欠费催缴': '/b/dashboard', '设备告警': '/d/dashboard', '工单超时': '/f/wo-detail', '品质整改': '/f/quality', '车位到期': '/a/vehicles?vf=expiring' }
  const path = map[r.type] || '/a/dashboard'
  router.push(path)
}
</script>

<style scoped>
.risk { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--biz-border-light); cursor: pointer; }
.risk:last-child { border-bottom: none; }
.risk:hover .risk__t { color: var(--el-color-primary); }
.risk__go { margin-left: auto; flex: 0 0 auto; font-size: 12px; color: var(--el-color-primary); align-self: center; }
.risk .tag { flex: 0 0 auto; height: 20px; }
.risk__b { min-width: 0; }
.risk__t { font-size: 13px; font-weight: 500; color: var(--biz-text-1); }
.risk__d { font-size: 12.5px; color: var(--biz-text-2); margin-top: 3px; }
.risk__a { font-size: 12px; color: var(--el-color-primary); margin-top: 3px; }
</style>
