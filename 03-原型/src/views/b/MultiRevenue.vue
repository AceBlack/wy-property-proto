<template>
  <div class="page">
    <EmptyState
      v-if="!canView"
      type="denied"
      desc="多种经营收入属财务经营数据，需要「多种经营收入 · 查看」权限"
    />
    <template v-else>
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>多种经营收入</b>：与「主营业务收入（物业费）」并列的一类公司收入，由两个分项构成 ——
        <b>商业服务</b>（收费工单）与<b>商业合作</b>（经营性合同）。
        <br />
        两个分项的时间口径<b>不一样</b>，这是不能合成一张明细表的原因：
        工单按<b>完工确认</b>（服务没做完不产生收入），合同按<b>年化</b>（合同金额 − 归业主的公共收益，
        ÷ 期间月数 × 12，再乘当年覆盖月数 ÷ 12）。
      </div>
    </div>

    <!-- 收入结构：让人一眼看出"多种经营占几成" -->
    <div class="rev-band">
      <div class="rev-band__hd">
        <span class="rev-band__t">公司收入结构 · {{ year }} 年度</span>
        <span class="rev-band__s">主营业务取账单实收；多种经营 = 商业服务 + 商业合作</span>
      </div>
      <div class="rev-band__body">
        <div class="rev-band__i">
          <span>主营业务收入</span>
          <b>¥ {{ wan(company.main) }}</b>
          <em>物业费 / 车位 / 能耗等账单实收</em>
        </div>
        <div class="rev-band__plus">+</div>
        <div class="rev-band__i is-multi">
          <span>多种经营收入</span>
          <b>¥ {{ wan(company.multi) }}</b>
          <em>商业服务 {{ multi.share.service }}% · 商业合作 {{ multi.share.cooperation }}%</em>
        </div>
        <div class="rev-band__eq">=</div>
        <div class="rev-band__i is-total">
          <span>公司收入合计</span>
          <b>¥ {{ wan(company.total) }}</b>
          <em>多种经营占 {{ company.multiRatio }}%</em>
        </div>
        <span class="spacer" />
        <div class="rev-band__pick">
          <el-select v-model="communityId" placeholder="全部项目" clearable size="small" style="width:132px">
            <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </div>
      </div>
      <!-- 占比条：一条带子把结构说清楚，比再放一张饼更省地方 -->
      <div class="rev-bar">
        <i class="rev-bar__i is-main" :style="{ width: mainPct + '%' }" :title="`主营业务 ${mainPct}%`" />
        <i class="rev-bar__i is-service" :style="{ width: servicePct + '%' }" :title="`商业服务 ${servicePct}%`" />
        <i class="rev-bar__i is-coop" :style="{ width: coopPct + '%' }" :title="`商业合作 ${coopPct}%`" />
      </div>
      <div class="rev-bar__lg">
        <span><i class="dot is-main" />主营业务 {{ mainPct }}%</span>
        <span><i class="dot is-service" />商业服务 {{ servicePct }}%</span>
        <span><i class="dot is-coop" />商业合作 {{ coopPct }}%</span>
      </div>
    </div>

    <!-- KPI 四张 -->
    <div class="grid g4" style="margin-top:16px;">
      <KpiCard label="多种经营收入" :value="multi.total" unit="元"
        icon="TrendCharts" :gradient="true" />
      <KpiCard label="商业服务收入" :value="multi.service.income" unit="元"
        icon="Tools" />
      <KpiCard label="商业合作收入" :value="multi.cooperation.income" unit="元"
        icon="Document" />
      <KpiCard label="多种经营占比" :value="company.multiRatio" unit="%"
        icon="PieChart" />
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1fr 1.8fr;">
      <div class="panel">
        <div class="panel__hd"><h3>分项构成</h3><span class="spacer" /><span class="desc">按收入</span></div>
        <EChart :option="optPie" :height="260" />
      </div>
      <div class="panel">
        <div class="panel__hd">
          <h3>月度趋势</h3><span class="spacer" />
          <span class="desc">商业服务按完工月 · 商业合作按合同期内每月摊</span>
        </div>
        <EChart :option="optTrend" :height="260" />
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1fr 1fr;">
      <div class="panel">
        <div class="panel__hd"><h3>项目排行</h3><span class="spacer" /><span class="desc">按合计</span></div>
        <EChart :option="optProject" :height="260" />
      </div>
      <div class="panel">
        <div class="panel__hd">
          <h3>口径对照</h3><span class="spacer" />
          <span class="desc">为什么两个数不能混着看</span>
        </div>
        <div class="cmp">
          <div class="cmp__row">
            <span class="cmp__k">入账时点</span>
            <span class="cmp__v">工单：<b>完工那一刻</b>（未完工不产生应收）</span>
            <span class="cmp__v">合同：<b>合同期内每月摊</b>（年化 ÷ 12）</span>
          </div>
          <div class="cmp__row">
            <span class="cmp__k">计量单位</span>
            <span class="cmp__v">{{ multi.service.count }} 张工单</span>
            <span class="cmp__v">{{ multi.cooperation.count }} 份合同</span>
          </div>
          <div class="cmp__row">
            <span class="cmp__k">成本</span>
            <span class="cmp__v">有（材料 + 人工成本快照）<br />毛利 ¥{{ money(multi.service.profit) }}</span>
            <span class="cmp__v is-muted">暂无（合同成本未纳入核算）</span>
          </div>
          <div class="cmp__row">
            <span class="cmp__k">公共收益</span>
            <span class="cmp__v is-muted">不涉及</span>
            <span class="cmp__v">
              归业主 ¥{{ money(multi.cooperation.publicRevenue) }}<br />已在收入中扣除
              <el-button link type="primary" size="small" @click="$router.push('/b/public-revenue')">看台账</el-button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 明细双表：两个分项的粒度差一个数量级，分表才看得清 -->
    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>收入明细</h3>
        <span class="spacer" />
        <el-radio-group v-model="tab" size="small">
          <el-radio-button value="service">商业服务（{{ serviceRows.length }} 张）</el-radio-button>
          <el-radio-button value="coop">商业合作（{{ coopRows.length }} 份）</el-radio-button>
        </el-radio-group>
      </div>

      <el-table v-if="tab === 'service'" :data="serviceRows" size="small" max-height="380">
        <el-table-column prop="woNo" label="工单号" width="126">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/f/workorders?kw=${row.woNo}`)">{{ row.woNo }}</el-button>
          </template>
        </el-table-column>
        <el-table-column prop="serviceName" label="服务项目" min-width="150" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="104" />
        <el-table-column prop="customer" label="业主" width="90" />
        <el-table-column prop="communityName" label="项目" width="104" show-overflow-tooltip />
        <el-table-column prop="finishTime" label="完工时间" width="132" />
        <el-table-column label="收入" width="96" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.income) }}</span></template>
        </el-table-column>
        <el-table-column label="成本" width="90" align="right">
          <template #default="{ row }"><span class="muted">{{ money(row.cost) }}</span></template>
        </el-table-column>
        <el-table-column label="毛利" width="96" align="right">
          <template #default="{ row }"><span class="money money--in">{{ money(row.profit) }}</span></template>
        </el-table-column>
        <el-table-column prop="payStatus" label="收款" width="86">
          <template #default="{ row }">
            <el-tag size="small" :type="row.payStatus === '未支付' ? 'warning' : 'success'" effect="plain">
              {{ row.payStatus }}
            </el-tag>
          </template>
        </el-table-column>
        <template #empty><EmptyState type="search" desc="当前筛选下没有已完工的收费工单" /></template>
      </el-table>

      <el-table v-else :data="coopRows" size="small" max-height="380">
        <el-table-column prop="contractNo" label="合同号" width="128">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/c/contracts?open=${row.contractId}`)">{{ row.contractNo }}</el-button>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="合同名称" min-width="170" show-overflow-tooltip />
        <el-table-column prop="subtype" label="子类" width="104" />
        <el-table-column prop="partyB" label="相对方" width="90" show-overflow-tooltip />
        <el-table-column label="合同金额" width="100" align="right">
          <template #default="{ row }"><span class="num">¥{{ wan(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column label="公共收益" width="100" align="right">
          <template #default="{ row }">
            <span class="num muted">¥{{ wan(row.publicRevenue) }}</span>
            <div class="ps-sub">{{ row.publicRevenueNote || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="年化" width="94" align="right">
          <template #default="{ row }"><span class="num">¥{{ wan(row.annualRevenue) }}</span></template>
        </el-table-column>
        <el-table-column label="当年覆盖" width="88" align="right">
          <template #default="{ row }">{{ row.coverMonths }} 月</template>
        </el-table-column>
        <el-table-column label="计入收入" width="100" align="right">
          <template #default="{ row }"><span class="money money--in">{{ money(row.income) }}</span></template>
        </el-table-column>
        <template #empty><EmptyState type="search" desc="当前筛选下没有计入当年的经营合同" /></template>
      </el-table>
    </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  canViewMultiRevenue, companyRevenue, communityOpts, multiRevenue, multiRevenueByProject, multiRevenueContracts,
  multiRevenueMonthly, multiRevenueServiceOrders
} from '@/api'
import EChart from '@/components/EChart.vue'
import KpiCard from '@/components/KpiCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import { palette } from '@/styles/echarts-theme'
import { money, wan } from '@/utils/format'

/* 数据基准年份：与 seed 的 TODAY 同一年，跨年会由接口层的 year 参数接管 */
const year = new Date().getFullYear()
/* 无权限时不发取数请求，也不渲染金额 —— 只在前端隐藏数字而照样请求，等于数据已经到手 */
const canView = canViewMultiRevenue()
const communityId = ref('')
const tab = ref('service')

const filters = computed(() => ({ communityId: communityId.value || '', year }))
const company = computed(() => companyRevenue(filters.value))
const multi = computed(() => multiRevenue(filters.value))
const monthly = computed(() => multiRevenueMonthly(filters.value, 12))
const byProject = computed(() => multiRevenueByProject(filters.value))
const serviceRows = computed(() => multiRevenueServiceOrders(filters.value))
const coopRows = computed(() => multiRevenueContracts(filters.value))

/* 结构条：三个百分比加起来必须 100，除不尽时把余数给主营业务（最大项） */
const mainPct = computed(() => {
  const t = company.value.total
  if (!t) return 0
  return Math.max(0, Math.round((company.value.main / t) * 1000) / 10)
})
const servicePct = computed(() => {
  const t = company.value.total
  if (!t) return 0
  return Math.round((multi.value.service.income / t) * 1000) / 10
})
const coopPct = computed(() => {
  const t = company.value.total
  if (!t) return 0
  return Math.round((multi.value.cooperation.income / t) * 1000) / 10
})

const optPie = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: p => `${p.name}：¥${money(p.value)}（${p.percent}%）`
  },
  legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
  series: [{
    type: 'pie', radius: ['52%', '72%'], center: ['50%', '44%'],
    itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
    label: { show: false },
    data: [
      { name: '商业服务', value: multi.value.service.income, itemStyle: { color: palette[0] } },
      { name: '商业合作', value: multi.value.cooperation.income, itemStyle: { color: palette[1] } }
    ]
  }]
}))

const optTrend = computed(() => ({
  tooltip: {
    trigger: 'axis', axisPointer: { type: 'shadow' },
    valueFormatter: v => `¥${money(v)}`
  },
  legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
  grid: { left: 8, right: 16, top: 20, bottom: 34, containLabel: true },
  xAxis: { type: 'category', data: monthly.value.map(x => x.month), axisTick: { show: false } },
  yAxis: { type: 'value', axisLabel: { formatter: v => (v >= 10000 ? `${v / 10000}万` : v) } },
  series: [
    {
      name: '商业服务', type: 'bar', stack: 'rev', barMaxWidth: 26,
      itemStyle: { color: palette[0], borderRadius: [0, 0, 3, 3] },
      data: monthly.value.map(x => x.service)
    },
    {
      name: '商业合作', type: 'bar', stack: 'rev', barMaxWidth: 26,
      itemStyle: { color: palette[1] },
      data: monthly.value.map(x => x.cooperation)
    }
  ]
}))

const optProject = computed(() => {
  const rows = byProject.value.slice(0, 8)
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => `¥${money(v)}` },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
    grid: { left: 8, right: 24, top: 12, bottom: 34, containLabel: true },
    xAxis: { type: 'value', axisLabel: { formatter: v => (v >= 10000 ? `${v / 10000}万` : v) } },
    yAxis: {
      type: 'category',
      data: rows.map(x => x.communityName).reverse(),
      axisTick: { show: false },
      axisLabel: { fontSize: 11 }
    },
    series: [
      {
        name: '商业服务', type: 'bar', stack: 'p', barMaxWidth: 18,
        itemStyle: { color: palette[0] },
        data: rows.map(x => x.service).reverse()
      },
      {
        name: '商业合作', type: 'bar', stack: 'p', barMaxWidth: 18,
        itemStyle: { color: palette[1], borderRadius: [0, 3, 3, 0] },
        data: rows.map(x => x.cooperation).reverse()
      }
    ]
  }
})
</script>

<style scoped>
/* 收入结构带：三块数字 + 一条占比条，比三张独立 KPI 更能说明"结构" */
.rev-band {
  margin-top: 16px; padding: 14px 16px 10px; border-radius: 10px;
  background: linear-gradient(180deg, rgba(91, 108, 255, .06), rgba(91, 108, 255, .01));
  border: 1px solid rgba(91, 108, 255, .14);
}
.rev-band__hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.rev-band__t { font-size: 13.5px; font-weight: 600; }
.rev-band__s { font-size: 11.5px; color: var(--biz-text-3); }
.rev-band__body { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
.rev-band__i { display: flex; flex-direction: column; gap: 2px; min-width: 130px; }
.rev-band__i span { font-size: 12px; color: var(--biz-text-3); }
.rev-band__i b { font-family: var(--biz-font-num); font-size: 22px; line-height: 1.15; color: var(--biz-text-1); }
.rev-band__i em { font-style: normal; font-size: 11px; color: var(--biz-text-4, #a6adc1); }
.rev-band__i.is-multi b { color: var(--biz-primary, #5b6cff); }
.rev-band__i.is-total b { color: #12b98a; }
.rev-band__plus, .rev-band__eq { font-size: 18px; color: var(--biz-text-4, #a6adc1); padding-bottom: 18px; }
.rev-band__pick { margin-left: auto; }

.rev-bar { display: flex; height: 9px; margin-top: 14px; border-radius: 999px; overflow: hidden; background: var(--biz-bg-fill); }
.rev-bar__i { display: block; height: 9px; transition: width .3s; }
.rev-bar__i.is-main, .dot.is-main { background: #c9d2e3; }
.rev-bar__i.is-service, .dot.is-service { background: var(--biz-primary, #5b6cff); }
.rev-bar__i.is-coop, .dot.is-coop { background: #12b98a; }
.rev-bar__lg { display: flex; gap: 18px; margin-top: 7px; font-size: 11.5px; color: var(--biz-text-3); }
.rev-bar__lg .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }

/* 口径对照表 */
.cmp { padding-top: 4px; }
.cmp__row {
  display: grid; grid-template-columns: 78px 1fr 1fr; gap: 10px;
  padding: 8px 0; border-bottom: 1px dashed var(--biz-border, #eef0f6); font-size: 12px;
}
.cmp__row:last-child { border-bottom: 0; }
.cmp__k { color: var(--biz-text-3); }
.cmp__v { color: var(--biz-text-2); line-height: 1.7; }
.cmp__v b { color: var(--biz-text-1); }
.cmp__v.is-muted { color: var(--biz-text-4, #a6adc1); }
.money--in { color: #12b98a; }
</style>
