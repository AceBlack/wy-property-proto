<template>
  <view class="page">
    <NavBar title="工作台" :back="false" :subtitle="`演示日 ${DEMO.today}`">
      <template #right>
        <view id="switch-identity" class="who" hover-class="who--hover" @tap="switchSheet = true">
          <text class="who__n">{{ persona?.name }}</text>
          <view class="who__chev" />
        </view>
      </template>
    </NavBar>

    <view class="body body--tab">
      <!-- 问候 + 今日焦点：不同角色一句话不同 -->
      <view class="hero">
        <view class="hero__top">
          <view class="hero__ava" :class="{ 'is-lead': persona?.lead }">{{ persona?.name?.slice(0, 1) }}</view>
          <view class="hero__b">
            <text class="hero__hi">{{ greeting }}，{{ persona?.name }}</text>
            <text class="hero__role">{{ persona?.post }} · {{ persona?.orgName }}</text>
          </view>
        </view>
        <text class="hero__focus">{{ focusText }}</text>
      </view>

      <!-- 关键数字：按能力出现，没权限的模块连数字都不给 -->
      <view v-if="kpis.length" class="kpis">
        <view
          v-for="k in kpis"
          :key="k.key"
          :id="`kpi-${k.key}`"
          class="kpi"
          hover-class="kpi--hover"
          @tap="go(k)"
        >
          <text class="kpi__n num" :class="{ danger: k.danger }">{{ k.value }}</text>
          <text class="kpi__k">{{ k.label }}</text>
        </view>
      </view>

      <!-- 今天要做 -->
      <view class="sec">
        <view class="sec-hd">
          <text class="sec-hd__t">今天要做</text>
          <text class="sec-hd__d">{{ todos.length ? `${todos.length} 条` : '没有待办' }}</text>
        </view>

        <view v-if="!todos.length" class="none">
          <text>手上没有待办。演示数据里这个角色今天确实空 —— 换一手身份能看到别的活儿。</text>
        </view>

        <view
          v-for="t in todos"
          :key="t.key"
          :id="`todo-${t.key}`"
          class="todo"
          hover-class="todo--hover"
          @tap="open(t)"
        >
          <view class="todo__tag" :style="{ color: t.tone, borderColor: t.tone }">{{ t.tag }}</view>
          <view class="todo__b">
            <text class="todo__t">{{ t.title }}</text>
            <text class="todo__d">{{ t.desc }}</text>
          </view>
          <view class="todo__chev" />
        </view>
      </view>

      <!-- 模块入口 -->
      <view class="sec">
        <view class="sec-hd">
          <text class="sec-hd__t">我的模块</text>
          <text class="sec-hd__d">按角色权限显示，没权限的不出现</text>
        </view>
        <view class="mods">
          <view
            v-for="m in modules"
            :key="m.key"
            :id="`mod-${m.key}`"
            class="mod"
            hover-class="mod--hover"
            @tap="openModule(m)"
          >
            <view class="mod__ico" :style="{ background: m.bg, color: m.fg }">{{ m.icon }}</view>
            <view class="mod__b">
              <text class="mod__t">{{ m.label }}</text>
              <text v-if="m.desc" class="mod__d">{{ m.desc }}</text>
            </view>
          </view>
        </view>
      </view>

      <view class="tail">
        <text>
          工作台按「角色 + 数据范围」装配：一线只有自己的任务与工单；班组长多出审批与整改；
          楼管家多出责任楼栋的欠费；项目经理多出复核与费用看板。
        </text>
      </view>
    </view>

    <ActionSheet
      v-model:show="switchSheet"
      title="切换身份"
      sub="换人即换视角，模块与数字会跟着权限变"
      :actions="switchActions"
      @select="onSwitch"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import { DEMO, PERSONAS, CAP, can } from '@/config/personas'
import { kpiOf, todayRows } from '@/api/mobile'
import { countsOf as oaCounts, listFor as oaList } from '@/api/oa'
import { countsOf as woCounts, listFor as woList } from '@/api/wo'
import { scopeSummary } from '@/api/building'
import { countsOf as rcCounts } from '@/api/rectify'
import { app, login, persona } from '@/store/app'
import { money } from '@/utils/format'
import { todoOf } from '@/api/neighbor'
import { listingAuditQueueOf, viewingsOf } from '@/api/listing'
import { lastMeters, loadMeters } from '@/api/meter'
import { toast } from '@/utils/ui'

const switchSheet = ref(false)
const ver = ref(0)

const greeting = '上午好'

const focusText = computed(() => {
  switch (persona.value?.roleId) {
    case 'R-ENG':
      return '先接单再跑现场；巡检单别拖到超时——超时会直接进逾期率。'
    case 'R-SEC':
      return '客服主管节点的审批先清掉，再去责任区做监督核验：查出的问题要点名到人。'
    case 'R-STW':
      return '4 栋 176 户的欠费先过一遍，能电话解决的别拖到上门。'
    case 'R-PM':
      return '审批、整改复核、指派工单，都是十分钟内能出手的事。'
    default:
      return '按角色装配的工作台。'
  }
})

const kpiInsp = computed(() => (ver.value, kpiOf(persona.value?.name || '')))
const oaN = computed(() => (ver.value, oaCounts(persona.value)))
const woN = computed(() => (ver.value, woCounts(persona.value)))
const bld = computed(() => (ver.value, persona.value?.empId ? scopeSummary(persona.value.empId) : null))
const rcN = computed(() => (ver.value, rcCounts(persona.value)))

const kpis = computed(() => {
  const p = persona.value
  const out = []
  if (can(p, CAP.approve)) out.push({ key: 'approve', label: '待我审批', value: oaN.value.todo, to: 'oa', danger: oaN.value.todo > 0 })
  if (can(p, CAP.inspExec)) out.push({ key: 'insp', label: '今日巡检', value: kpiInsp.value.todayOpen, to: 'tasks' })
  if (can(p, CAP.woView)) out.push({ key: 'wo', label: '可接工单', value: woN.value.pool, to: 'wo' })
  if (p?.roleId === 'R-STW' && bld.value) out.push({ key: 'debt', label: '欠费户', value: bld.value.debtHouses, to: 'building', danger: bld.value.debtHouses > 0 })
  if (can(p, CAP.rectify)) out.push({ key: 'rectify', label: '待办整改', value: rcN.value.todo, to: 'rectify', danger: rcN.value.todo > 0 })
  return out
})

const todos = computed(() => {
  const p = persona.value
  const out = []

  if (can(p, CAP.approve)) {
    oaList(p, 'todo').slice(0, 3).forEach(a => {
      out.push({
        key: `oa-${a.id}`,
        tag: '审批',
        tone: 'var(--biz-warning)',
        title: a.title,
        desc: `${a.bizType} · ${a.applicant} · 已等 ${a.waitHours} 小时`,
        to: { page: '/pages/oa/detail', query: `id=${a.id}` }
      })
    })
  }

  if (can(p, CAP.inspExec)) {
    todayRows(p.name)
      .filter(r => ['待执行', '执行中', '逾期'].includes(r.status))
      .slice(0, 2)
      .forEach(r => {
        out.push({
          key: `insp-${r.taskId}`,
          tag: r.status === '逾期' ? '超时' : '巡检',
          tone: r.status === '逾期' ? 'var(--biz-ins-overdue)' : 'var(--biz-primary)',
          title: r.planName,
          desc: `${r.scheduledTime} · ${r.time.text || r.status} · ${r.itemCount} 项`,
          to: { page: '/pages/tasks/detail', query: `taskId=${r.taskId}` }
        })
      })
  }

  if (can(p, CAP.woView)) {
    woList(p, 'pool').slice(0, 2).forEach(w => {
      out.push({
        key: `wo-${w.id}`,
        tag: '工单',
        tone: w.priority === '普通' ? 'var(--biz-text-3)' : 'var(--biz-danger)',
        title: w.title,
        desc: `${w.houseName} · ${w.priority} · ${w.createTime.slice(5, 16)}`,
        to: { page: '/pages/wo/detail', query: `id=${w.id}` }
      })
    })
  }

  if (p?.roleId === 'R-STW' && bld.value?.debtHouses) {
    out.push({
      key: 'debt',
      tag: '欠费',
      tone: 'var(--biz-danger)',
      title: `${bld.value.debtHouses} 户欠费，合计 ${money(bld.value.debtAmount)}`,
      desc: '先电话后上门；只催不收，谈成了引导到小程序缴费',
      to: { page: '/pages/building/index', query: '' }
    })
  }

  if (can(p, CAP.rectify)) {
    rcN.value.todo &&
      out.push({
        key: 'rc-entry',
        tag: '整改',
        tone: 'var(--biz-primary)',
        title: `${rcN.value.todo} 张整改单等你处理`,
        desc: '待整改 / 待复核 / 本部门退回单',
        to: { page: '/pages/rectify/list', query: '' }
      })
  }

  return out
})

const nb = ref({ total: 0, items: 0, reports: 0, listings: 0 })
const vw = ref({ pending: 0, overdue: 0 })
/* 抄表：只关心"还剩多少户"，明细在 /pages/meter/list */
const mt = ref({ pending: 0, abnormal: 0 })

/**
 * 邻里待办只数数，不拉列表：工作台不该因为它变慢。
 * 数字按**能办的**算：楼管没有 items.audit / reports.handle，就不该给他算闲置与举报 ——
 * 算了也点不动，数字只会变成假消息。
 */
async function loadNeighbor() {
  const p = persona.value
  const canItem = can(p, CAP.neighborItemAudit)
  const canReport = can(p, CAP.neighborReportHandle)
  const canLst = can(p, CAP.listingAudit)
  if (!canItem && !canReport && !canLst) return
  try {
    const r = await todoOf({ items: canItem, reports: canReport })
    const lst = canLst ? (await listingAuditQueueOf(p)).length : 0
    nb.value = {
      items: r.items.length,
      reports: r.reports.length,
      listings: lst,
      total: r.items.length + r.reports.length + lst
    }
  } catch (e) {
    nb.value = { total: 0, items: 0, reports: 0, listings: 0 }
  }
}

/** 抄表：本期还剩多少户没抄。拿不到就归零，不影响工作台其它卡片 */
async function loadMeter() {
  const p = persona.value
  if (!can(p, CAP.metersView)) return
  try {
    await loadMeters(p)
    const s2 = lastMeters()?.summary || {}
    mt.value = { pending: s2.pending || 0, abnormal: s2.abnormal || 0 }
  } catch {
    mt.value = { pending: 0, abnormal: 0 }
  }
}

/** 看房请求：这条线只有"回了没有"，数字要突出超时的 */
async function loadViewing() {
  const p = persona.value
  if (!can(p, CAP.listViewing)) return
  try {
    const rows = await viewingsOf(p, { status: '待联系' })
    vw.value = { pending: rows.length, overdue: rows.filter(v => v.overdue).length }
  } catch (e) {
    vw.value = { pending: 0, overdue: 0 }
  }
}

const modules = computed(() => {
  const p = persona.value
  const all = [
    { key: 'tasks', label: '巡检任务', icon: '巡', desc: '执行 / 监督核验', bg: 'var(--biz-primary-light-9)', fg: 'var(--biz-primary)', show: can(p, CAP.inspView), to: { tab: '/pages/tasks/list' } },
    { key: 'wo', label: '工单', icon: '单', desc: '接单 / 转单 / 完工', bg: '#e6faf3', fg: 'var(--biz-accent-dark)', show: can(p, CAP.woView), to: { tab: '/pages/wo/list' } },
    { key: 'oa', label: '审批', icon: '审', desc: can(p, CAP.approve) ? '待办 / 发起' : '发起 / 跟踪', bg: '#fff5eb', fg: 'var(--biz-warning)', show: true, to: { page: '/pages/oa/list' } },
    {
      key: 'neighbor',
      label: '邻里待办',
      icon: '邻',
      desc: nb.value.total
        ? `待审 ${nb.value.items + nb.value.listings} · 待处理 ${nb.value.reports}`
        : '暂无待办',
      bg: '#fff7ed',
      fg: '#a35c13',
      show: can(p, CAP.neighborItemAudit) || can(p, CAP.neighborReportHandle) || can(p, CAP.listingAudit),
      to: { page: '/pages/neighbor/todo' }
    },
    {
      key: 'meter',
      label: '抄表',
      icon: '表',
      desc: mt.value.pending
        ? `还有 ${mt.value.pending} 户没抄${mt.value.abnormal ? ` · ${mt.value.abnormal} 户异常` : ''}`
        : '本期都抄完了',
      bg: '#fef9e7',
      fg: '#8a6508',
      show: can(p, CAP.metersView),
      to: { page: '/pages/meter/list' }
    },
    {
      key: 'viewing',
      label: '看房请求',
      icon: '看',
      desc: vw.value.overdue
        ? `${vw.value.pending} 条待回 · 超时 ${vw.value.overdue}`
        : vw.value.pending ? `${vw.value.pending} 条待回电话` : '没有待回的请求',
      bg: '#eef2ff',
      fg: '#4f5bd5',
      show: can(p, CAP.listViewing),
      to: { page: '/pages/listing/viewing' }
    },
    { key: 'contacts', label: '通讯录', icon: '通', desc: '找同事 / 打电话', bg: 'var(--biz-bg-fill)', fg: 'var(--biz-text-2)', show: can(p, CAP.contactsView), to: { page: '/pages/contacts/index' } },
    { key: 'rectify', label: '整改闭环', icon: '改', desc: '提交 / 复核 / 改派', bg: '#fff0f0', fg: 'var(--biz-danger)', show: can(p, CAP.rectify), to: { page: '/pages/rectify/list' } },
    { key: 'building', label: '我的楼栋', icon: '楼', desc: '欠费 / 催收', bg: 'var(--biz-primary-light-9)', fg: 'var(--biz-primary)', show: p?.roleId === 'R-STW', to: { page: '/pages/building/index' } },
    { key: 'attendance', label: '我的考勤', icon: '勤', desc: '月度确认 / 申诉', bg: 'var(--biz-bg-fill)', fg: 'var(--biz-text-2)', show: can(p, CAP.attendanceSelf), to: { page: '/pages/attendance/index' } },
    { key: 'payroll', label: '工资条', icon: '薪', desc: '只看本人', bg: 'var(--biz-bg-fill)', fg: 'var(--biz-text-2)', show: can(p, CAP.payrollSelf), to: { page: '/pages/payroll/index' } },
    { key: 'finance', label: '费用看板', icon: '费', desc: '只读', bg: '#e6faf3', fg: 'var(--biz-accent-dark)', show: can(p, CAP.finance), to: { page: '/pages/finance/index' } },
    { key: 'msg', label: '公告', icon: '告', desc: '项目公告', bg: 'var(--biz-bg-fill)', fg: 'var(--biz-text-2)', show: can(p, CAP.noticeRead), to: { tab: '/pages/msg/list' } }
  ]
  return all.filter(m => m.show)
})

const switchActions = computed(() =>
  PERSONAS.map(p => ({ label: `${p.name} · ${p.post}`, desc: p.desc, value: p.id, active: p.id === app.personaId }))
)

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  ver.value++
  loadNeighbor()
  loadViewing()
  loadMeter()
})

function onSwitch(id) {
  if (id === app.personaId) return
  login(id)
  ver.value++
  toast('已切换身份')
}

function go(k) {
  if (k.to === 'oa') uni.navigateTo({ url: '/pages/oa/list' })
  else if (k.to === 'wo') uni.switchTab({ url: '/pages/wo/list' })
  else if (k.to === 'tasks') uni.switchTab({ url: '/pages/tasks/list' })
  else if (k.to === 'building') uni.navigateTo({ url: '/pages/building/index' })
  else if (k.to === 'rectify') uni.navigateTo({ url: '/pages/rectify/list' })
}

function open(t) {
  const url = t.to.query ? `${t.to.page}?${t.to.query}` : t.to.page
  uni.navigateTo({ url })
}

function openModule(m) {
  if (m.to.tab) uni.switchTab({ url: m.to.tab })
  else uni.navigateTo({ url: m.to.page })
}
</script>

<style scoped>
.who {
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  background: #fff;
  border: 2rpx solid var(--biz-border-light);
}

.who--hover {
  background: var(--biz-bg-hover);
}

.who__n {
  font-size: 22rpx;
  color: var(--biz-text-2);
  font-weight: 500;
}

.who__chev {
  width: 10rpx;
  height: 10rpx;
  border-right: 2rpx solid var(--biz-text-3);
  border-bottom: 2rpx solid var(--biz-text-3);
  transform: rotate(45deg) translateY(-2rpx);
}

.body--tab {
  padding-bottom: 40rpx;
}

.hero {
  background: #fff;
  border-radius: 24rpx;
  padding: 28rpx;
  box-shadow: var(--biz-shadow-card);
  margin-bottom: 24rpx;
}

.hero__top {
  display: flex;
  align-items: center;
  gap: 18rpx;
}

.hero__ava {
  width: 84rpx;
  height: 84rpx;
  border-radius: 24rpx;
  background: var(--biz-gradient);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  font-weight: 600;
  flex: none;
}

.hero__ava.is-lead {
  background: linear-gradient(135deg, #ff9f40 0%, #ffcf9b 100%);
}

.hero__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.hero__hi {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.hero__role {
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.hero__focus {
  display: block;
  margin-top: 18rpx;
  padding-top: 16rpx;
  border-top: 2rpx dashed var(--biz-border-light);
  font-size: 22rpx;
  color: var(--biz-text-2);
  line-height: 1.6;
}

.kpis {
  display: flex;
  gap: 12rpx;
  margin-bottom: 26rpx;
}

.kpi {
  flex: 1;
  background: #fff;
  border-radius: 20rpx;
  padding: 20rpx 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  box-shadow: var(--biz-shadow-card);
}

.kpi--hover {
  box-shadow: var(--biz-shadow-card-hover);
}

.kpi__n {
  font-size: 44rpx;
  line-height: 1;
  color: var(--biz-text-1);
}

.kpi__n.danger {
  color: var(--biz-danger);
}

.kpi__k {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.sec {
  margin-bottom: 30rpx;
}

.none {
  background: #fff;
  border-radius: 20rpx;
  padding: 30rpx 24rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
}

.todo {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 22rpx;
  margin-bottom: 14rpx;
  box-shadow: var(--biz-shadow-card);
}

.todo--hover {
  background: var(--biz-bg-hover);
}

.todo__tag {
  flex: none;
  font-size: 19rpx;
  border: 2rpx solid currentColor;
  border-radius: 10rpx;
  padding: 6rpx 10rpx;
  line-height: 1;
}

.todo__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.todo__t {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.todo__d {
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.todo__chev {
  width: 14rpx;
  height: 14rpx;
  border-top: 3rpx solid var(--biz-text-4);
  border-right: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
  flex: none;
}

.mods {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}

.mod {
  width: calc((100% - 14rpx) / 2);
  background: #fff;
  border-radius: 20rpx;
  padding: 20rpx;
  display: flex;
  align-items: center;
  gap: 14rpx;
  box-shadow: var(--biz-shadow-card);
}

.mod--hover {
  background: var(--biz-bg-hover);
}

.mod__ico {
  width: 68rpx;
  height: 68rpx;
  border-radius: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;
  flex: none;
}

.mod__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.mod__t {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.mod__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tail {
  padding: 8rpx 10rpx;
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
}
</style>
