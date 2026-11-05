<template>
  <view class="page">
    <NavBar title="我的任务" :back="false" :subtitle="`演示日 ${DEMO.today}`">
      <template #right>
        <view id="switch-identity" class="who" hover-class="who--hover" @tap="switchSheet = true">
          <text class="who__n">{{ persona?.name }}</text>
          <view class="who__chev" />
        </view>
      </template>
    </NavBar>

    <view class="body body--tab">
      <!-- 身份 + 今日概览 -->
      <view class="hd">
        <view class="hd__l">
          <view class="hd__row">
            <text class="hd__name">{{ persona?.name }}</text>
            <text class="hd__role" :class="{ 'is-lead': persona?.lead }">{{ roleBadge(persona) }}</text>
          </view>
          <text class="hd__meta">{{ persona?.post }} · {{ persona?.orgName }}</text>
        </view>
        <view class="hd__kpi">
          <text class="hd__kpi-n num">{{ kpi.todayOpen }}</text>
          <text class="hd__kpi-k">今日待办</text>
        </view>
      </view>

      <!-- 三态：断网 / 待同步 -->
      <view v-if="app.net === 'offline'" class="banner banner--offline">
        <text class="banner__ico"><text>!</text></text>
        <view class="banner__bd">
          <text class="banner__t">当前离线</text>
          <text class="banner__d">任务清单来自本地缓存，打卡与提交会先存手机，联网后自动上传。</text>
        </view>
      </view>
      <view v-else-if="app.net === 'weak'" class="banner banner--info">
        <text class="banner__ico"><text>~</text></text>
        <view class="banner__bd">
          <text class="banner__t">信号弱</text>
          <text class="banner__d">定位精度可能不足，打卡将按人工打卡记录。</text>
        </view>
      </view>

      <view v-if="app.pending.length" id="sync-banner" class="banner banner--pending" @tap="onSync">
        <text class="banner__ico"><text>↑</text></text>
        <view class="banner__bd">
          <text class="banner__t">{{ app.pending.length }} 条记录待同步</text>
          <text class="banner__d">已存在本机，点这里立即上传（恢复网络后也会自动传）。</text>
        </view>
        <text class="banner__act">{{ app.syncing ? '同步中' : '同步' }}</text>
      </view>

      <!-- 页签 -->
      <view class="tabs">
        <view
          v-for="t in TASK_TABS"
          :key="t.key"
          :id="'tab-' + t.key"
          class="tabs__i"
          :class="{ 'is-on': tab === t.key }"
          @tap="tab = t.key"
        >
          <text class="tabs__t">{{ t.label }}</text>
          <text class="tabs__n num">{{ counts[t.key] }}</text>
        </view>
      </view>

      <!-- 已超时：整段置顶 -->
      <view v-if="pinned.length" class="grp">
        <view class="grp__hd">
          <view class="grp__l">
            <text class="grp__t danger">已超时</text>
            <text class="grp__c num">{{ pinned.length }}</text>
          </view>
          <text class="grp__hint">不管计划在哪天，先处理</text>
        </view>
        <TaskCard
          v-for="r in pinned"
          :key="r.taskId"
          :row="r"
          :pending="isPending(r.taskId)"
          @pick="goDetail"
        />
      </view>

      <!-- 按日期分组 -->
      <view v-for="g in groups" :key="g.date" class="grp">
        <view class="grp__hd">
          <view class="grp__l">
            <text class="grp__t">{{ g.label }}</text>
            <text class="grp__date num">{{ g.date.slice(5).replace('-', '/') }}</text>
          </view>
          <text class="grp__hint">{{ g.tasks.length }} 单</text>
        </view>
        <TaskCard
          v-for="r in g.tasks"
          :key="r.taskId"
          :row="r"
          :pending="isPending(r.taskId)"
          @pick="goDetail"
        />
      </view>

      <Empty
        v-if="!total"
        :text="emptyText"
        sub="换一个页签看看，或点右上角切换身份"
      />
    </view>

    <ActionSheet
      v-model:show="switchSheet"
      title="切换身份"
      sub="原型用：换人即换视角，数据按登录人过滤"
      :actions="switchActions"
      @select="onSwitch"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import TaskCard from '@/components/TaskCard.vue'
import Empty from '@/components/Empty.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import { DEMO, PERSONAS, roleBadge } from '@/config/personas'
import { TASK_TABS, kpiOf, listForTab, tabCounts } from '@/api/mobile'
import { app, isPending, login, persona, syncPending } from '@/store/app'
import { toast, toastErr, toastOk } from '@/utils/ui'

const tab = ref('todo')
const switchSheet = ref(false)
/** 自增版本号：mock 数据是普通数组（非响应式），提交/打卡后靠它触发重算 */
const ver = ref(0)

const name = computed(() => persona.value?.name || '')
const counts = computed(() => (ver.value, tabCounts(name.value)))
const kpi = computed(() => (ver.value, kpiOf(name.value)))
const data = computed(() => (ver.value, listForTab(name.value, tab.value)))
const pinned = computed(() => data.value.pinned)
const groups = computed(() => data.value.groups)
const total = computed(() => data.value.count)

const emptyText = computed(() => {
  const t = TASK_TABS.find(x => x.key === tab.value)
  return `没有「${t?.label}」的任务`
})

const switchActions = computed(() =>
  PERSONAS.map(p => ({
    label: `${p.name} · ${p.post}`,
    desc: p.desc,
    value: p.id,
    active: p.id === app.personaId
  }))
)

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  ver.value++
})

function goDetail(row) {
  uni.navigateTo({ url: `/pages/tasks/detail?taskId=${row.taskId}` })
}

function onSwitch(id) {
  if (id === app.personaId) return
  login(id)
  ver.value++
  toast('已切换身份')
}

async function onSync() {
  if (app.net === 'offline') {
    toastErr('仍是断网状态，先切回在线')
    return
  }
  if (app.syncing) return
  const r = await syncPending()
  ver.value++
  if (r.ok) toastOk(`已同步 ${r.ok} 条`)
  else if (r.skipped) toast('这些任务已提交过，已从队列移除')
  else toastErr('同步失败，稍后再试')
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

.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6rpx 4rpx 20rpx;
}

.hd__row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.hd__name {
  font-size: 38rpx;
  font-weight: 700;
  color: var(--biz-text-1);
  letter-spacing: 0.5rpx;
}

.hd__role {
  font-size: 19rpx;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border: 2rpx solid var(--biz-primary-light-8);
}

.hd__role.is-lead {
  color: var(--biz-warning);
  background: #fff8f0;
  border-color: rgba(255, 159, 64, 0.32);
}

.hd__meta {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  color: var(--biz-text-3);
}

.hd__kpi {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  padding-left: 20rpx;
}

.hd__kpi-n {
  font-size: 46rpx;
  line-height: 1;
  color: var(--biz-primary);
}

.hd__kpi-k {
  font-size: 20rpx;
  color: var(--biz-text-3);
  margin-top: 6rpx;
}

.banner__bd {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.banner__t {
  font-size: 25rpx;
  font-weight: 600;
}

.banner__d {
  font-size: 21rpx;
  opacity: 0.85;
  line-height: 1.5;
}

.banner__act {
  flex: none;
  align-self: center;
  font-size: 22rpx;
  font-weight: 600;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: var(--biz-primary);
  color: #fff;
}

.tabs {
  display: flex;
  gap: 10rpx;
  background: rgba(255, 255, 255, 0.7);
  border-radius: 18rpx;
  padding: 8rpx;
  margin-bottom: 26rpx;
}

.tabs__i {
  flex: 1;
  height: 68rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  border-radius: 14rpx;
}

.tabs__i.is-on {
  background: #fff;
  box-shadow: 0 2rpx 10rpx rgba(31, 37, 64, 0.08);
}

.tabs__t {
  font-size: 25rpx;
  color: var(--biz-text-3);
}

.tabs__i.is-on .tabs__t {
  color: var(--biz-primary);
  font-weight: 600;
}

.tabs__n {
  font-size: 22rpx;
  color: var(--biz-text-4);
}

.tabs__i.is-on .tabs__n {
  color: var(--biz-primary);
}

.grp {
  margin-bottom: 30rpx;
}

.grp__hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 6rpx 14rpx;
}

.grp__l {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
}

.grp__t {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-2);
}

.grp__c {
  font-size: 22rpx;
  color: var(--biz-ins-overdue);
}

.grp__date {
  font-size: 21rpx;
  color: var(--biz-text-4);
}

.grp__hint {
  font-size: 20rpx;
  color: var(--biz-text-4);
}
</style>
