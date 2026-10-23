<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>办公工作台（L3 执行层）</b>：面向一线主管与内勤，只放「今天我要做的事」。
        待办按来源聚合（审批 / 工单 / 巡检 / 抄送），超时项置顶；右侧团队今日指标用于晨会。
      </div>
    </div>

    <!-- KPI -->
    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(6,minmax(0,1fr));">
      <KpiCard
        v-for="(k, i) in wb.kpi" :key="k.label"
        :label="k.label" :value="k.value" :unit="k.unit" :trend="k.trend"
        :icon="kpiIcons[i]" :gradient="i % 2 === 0"
      />
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1.5fr 1fr;">
      <!-- 待办 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>我的待办</h3>
          <span class="tag tag--danger">{{ overdueCount }} 项超时</span>
          <span class="spacer" />
          <el-radio-group v-model="todoType" size="small">
            <el-radio-button label="全部">全部</el-radio-button>
            <el-radio-button v-for="t in todoTypes" :key="t" :label="t">{{ t }}</el-radio-button>
          </el-radio-group>
        </div>

        <div class="todos">
          <div v-for="t in shownTodos" :key="t.id" class="todo" :class="{ 'is-over': t.overdue }">
            <span class="todo__type" :class="typeClass(t.type)">{{ t.type }}</span>
            <div class="todo__b">
              <div class="todo__t">{{ t.title }}</div>
              <div class="todo__m">{{ t.from }} · {{ t.time }}</div>
            </div>
            <span class="tag" :class="t.overdue ? 'tag--danger' : t.level === '紧急' ? 'tag--warning' : 'tag--muted'">{{ t.level }}</span>
            <el-button link type="primary" style="margin-left:8px;">处理</el-button>
          </div>
          <EmptyState v-if="!shownTodos.length" type="empty" desc="今日待办已清空" />
        </div>
      </div>

      <!-- 团队 + 快捷 -->
      <div>
        <div class="panel">
          <div class="panel__hd"><h3>团队今日</h3><span class="spacer" /><span class="desc">截至 10-21 12:00</span></div>
          <div class="team">
            <div v-for="t in wb.teamToday" :key="t.name" class="team__i">
              <div class="team__n">{{ t.name }}</div>
              <div class="team__v">{{ t.value }}<span>{{ t.unit }}</span></div>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd"><h3>快捷入口</h3></div>
          <div class="quick">
            <div v-for="q in quicks" :key="q.t" class="quick__i" @click="go(q.to)">
              <span class="quick__ico" :style="{ background: q.c }"><el-icon><component :is="q.i" /></el-icon></span>
              <span>{{ q.t }}</span>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd"><h3>公告</h3><span class="spacer" /><el-button link type="primary">全部</el-button></div>
          <div v-for="n in notices" :key="n.t" class="notice">
            <span class="tag tag--info">{{ n.tag }}</span>
            <span class="notice__t">{{ n.t }}</span>
            <span class="notice__d">{{ n.d }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:1fr 1fr;">
      <div class="panel">
        <div class="panel__hd"><h3>本周工单处理效率</h3><span class="spacer" /><span class="desc">单位：件 / 天</span></div>
        <EChart :option="optEff" :height="230" />
      </div>
      <div class="panel">
        <div class="panel__hd"><h3>工单来源分布</h3><span class="spacer" /><span class="desc">本月</span></div>
        <EChart :option="optSource" :height="230" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { metrics, woSourceCount } from '@/utils/api'
import EChart from '@/components/EChart.vue'
import KpiCard from '@/components/KpiCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import { palette } from '@/styles/echarts-theme'

const router = useRouter()
const wb = metrics.workbench
const kpiIcons = ['Tickets', 'Tools', 'Money', 'Aim', 'WarningFilled', 'Bell']

const todoType = ref('全部')
const todoTypes = [...new Set(wb.todo.map(t => t.type))]
const shownTodos = computed(() =>
  (todoType.value === '全部' ? wb.todo : wb.todo.filter(t => t.type === todoType.value))
    .slice().sort((a, b) => Number(b.overdue) - Number(a.overdue))
)
const overdueCount = wb.todo.filter(t => t.overdue).length

const typeClass = t => ({
  审批: 'tag--primary', 工单: 'tag--warning', 巡检: 'tag--success', 抄送: 'tag--muted'
}[t] || 'tag--muted')

const quicks = [
  { t: '新建工单', i: 'Plus', c: '#5B6CFF', to: '/f/wo-detail' },
  { t: '巡检任务', i: 'Aim', c: '#2ED9A3', to: '/f/inspect' },
  { t: '品质检查', i: 'Star', c: '#8A63F2', to: '/f/quality' },
  { t: '去收银', i: 'Money', c: '#FFB05C', to: '/b/cashier' },
  { t: '员工档案', i: 'UserFilled', c: '#4DC9FF', to: '/c/employee' },
  { t: '工资表', i: 'Coin', c: '#FF7DA0', to: '/c/payroll' }
]
function go(p) { if (p) router.push(p); else router.push('/c/workbench') }

const notices = [
  { tag: '通知', t: '关于冬季供暖设备检修的安排', d: '10-18' },
  { tag: '制度', t: '物业服务收费公示制度（修订版）', d: '10-15' },
  { tag: '提醒', t: '10 月物业费催缴进入第二阶段', d: '10-12' }
]

const optEff = computed(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
  xAxis: {
    type: 'category', data: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    axisTick: { show: false }
  },
  yAxis: { type: 'value' },
  series: [{
    type: 'bar', itemStyle: { color: palette[0] },
    data: wb.efficiency
  }]
}))

const optSource = computed(() => {
  const d = woSourceCount()
  return {
    tooltip: { trigger: 'item', formatter: '{b}：{c} 单（{d}%）' },
    legend: { bottom: 0, icon: 'circle', itemWidth: 8, itemHeight: 8 },
    series: [{
      type: 'pie', radius: ['50%', '70%'], center: ['50%', '44%'],
      itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 6 },
      label: { show: false },
      data: d.map((x, i) => ({ ...x, itemStyle: { color: palette[i] } }))
    }]
  }
})
</script>

<style scoped>
.todos { max-height: 400px; overflow-y: auto; }
.todo {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 12px; border-radius: 8px; margin-bottom: 6px;
  background: var(--biz-bg-fill);
}
.todo.is-over { background: rgba(255,107,107,.05); box-shadow: inset 0 0 0 1px rgba(255,107,107,.18); }
.todo__type {
  flex: 0 0 auto; font-size: 11px; padding: 1px 8px; border-radius: 999px;
}
.todo__b { flex: 1; min-width: 0; }
.todo__t { font-size: 13px; color: var(--biz-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.todo__m { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }

.team { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.team__i { background: var(--biz-bg-fill); border-radius: 10px; padding: 10px 12px; }
.team__n { font-size: 12px; color: var(--biz-text-3); }
.team__v { font-family: var(--biz-font-num); font-size: 18px; font-weight: 600; margin-top: 3px; }
.team__v span { font-size: 11.5px; color: var(--biz-text-3); margin-left: 2px; font-weight: 400; }

.quick { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.quick__i {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 12px 4px; border-radius: 10px; cursor: pointer; font-size: 12.5px; color: var(--biz-text-2);
}
.quick__i:hover { background: var(--biz-bg-hover); color: var(--el-color-primary); }
.quick__ico { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: #fff; font-size: 16px; }

.notice { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--biz-border-light); }
.notice:last-child { border-bottom: none; }
.notice__t { flex: 1; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notice__d { font-size: 11.5px; color: var(--biz-text-3); }
</style>
