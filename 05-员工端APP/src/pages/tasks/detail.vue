<template>
  <view class="page">
    <NavBar title="任务详情" :subtitle="task?.taskId || ''" />

    <view v-if="task" class="body body--with-foot">
      <view v-if="app.net === 'offline'" class="banner banner--offline">
        <text class="banner__ico"><text>!</text></text>
        <view class="banner__bd">
          <text class="banner__t">当前离线</text>
          <text class="banner__d">可以打卡与作业，提交会先存本机，联网后自动上传。</text>
        </view>
      </view>

      <!-- 任务头 -->
      <view class="card head" :class="{ 'is-od': isOverdue }">
        <view class="head__tags">
          <Tag :text="task.taskType === '监督' ? '监督' : '执行'" :color="task.taskType === '监督' ? 'var(--biz-warning)' : 'var(--biz-primary)'" :plain="false" />
          <Tag :text="task.status" :color="STATUS_COLOR[task.status]" />
          <text v-if="template?.version" class="head__ver">{{ template.version }}</text>
        </view>
        <text class="head__t">{{ task.planName }}</text>

        <view class="head__time">
          <text class="head__clock num">{{ task.scheduledDate }} {{ task.scheduledTime }}</text>
          <text v-if="timeText" class="head__remain" :class="timeClass">{{ timeText }}</text>
        </view>

        <view v-if="task.status === '已完成'" class="head__done">
          <text class="head__done-i">✓</text>
          <text>已完成 {{ task.doneTime }}</text>
          <text v-if="task.score" class="head__score num">{{ task.score }} 分</text>
        </view>
        <view v-else-if="task.status === '已转工单'" class="head__done">
          <text class="head__done-i is-warn">↗</text>
          <text>巡检发现问题，已转工单 {{ task.refWoId }}</text>
        </view>
      </view>

      <!-- 基本信息 -->
      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">任务信息</text></view>
        <Cell label="任务号" :value="task.taskId" />
        <Cell label="所属项目" :value="communityLabel" />
        <Cell label="执行人" :value="task.executor" />
        <Cell v-if="isSup" label="被检班组" :value="targetDeptName" strong />
        <Cell v-if="isSup" label="被检岗位" :value="task.targetPost || '—'" />
        <Cell label="到位方式" :value="checkinLabel" />
        <Cell label="检查项" :value="`${items.length} 项 · 模板 ${template?.name || '—'}`" />
        <Cell label="来源计划" :value="planLabel" :last="true" />
      </view>

      <!-- 位置 -->
      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">作业位置</text></view>
        <view class="loc">
          <view class="loc__pin"><text>◎</text></view>
          <view class="loc__txt">
            <text class="loc__t">{{ communityLabel }}</text>
            <text class="loc__d">{{ communityAddr || '项目公区' }}</text>
            <text v-if="task.gps" class="loc__gps">上次定位 {{ task.gps }}</text>
          </view>
        </view>
      </view>

      <!-- 检查项预览 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">检查项（{{ items.length }}）</text>
          <text class="sec-hd__d">{{ isSup ? '现场核验，发现问题要点名' : '按标准逐项判定' }}</text>
        </view>
        <view v-for="(it, i) in items" :key="it.label" class="item">
          <text class="item__idx num">{{ String(i + 1).padStart(2, '0') }}</text>
          <view class="item__b">
            <view class="item__t">
              <text class="item__label">{{ it.label }}</text>
              <text v-if="it.required" class="item__req">*</text>
              <text class="item__type">{{ it.type }}</text>
            </view>
            <text class="item__std">标准：{{ it.standard || (it.options || []).join(' / ') || '按现场情况判定' }}</text>
          </view>
        </view>
      </view>

      <view class="note">
        <text class="note__t">为什么这里不能代填</text>
        <text class="note__d">
          作业必须在现场完成，后台只做监管（完成率 / 异常 / 超时），不提供执行入口。
          手机端同理：只能做自己的任务，没有「帮他人提交」。
        </text>
      </view>
    </view>

    <!-- 底部操作 -->
    <view v-if="task && canAct" class="footbar">
      <view class="foot-info">
        <text class="foot-info__k">{{ task.checkedIn ? '已打卡' : '未打卡' }}</text>
        <text class="foot-info__v">{{ task.checkinType || '—' }}</text>
      </view>
      <view id="act-btn" class="btn btn--primary foot-btn" hover-class="none" @tap="onAct">
        {{ actText }}
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Tag from '@/components/Tag.vue'
import Cell from '@/components/Cell.vue'
import { STATUS_COLOR, communityAddressOf, communityNameOf, getInspectTaskDetail, orgNameOf } from '@/api/mobile'
import { app, getCheckin } from '@/store/app'
import { timeState } from '@/utils/deadline'
import { toast } from '@/utils/ui'

const taskId = ref('')
const task = ref(null)
const template = ref(null)
const plan = ref(null)
const community = ref(null)

onLoad(async options => {
  taskId.value = options.taskId || ''
  const d = await getInspectTaskDetail(taskId.value)
  if (!d?.task) {
    toast('任务不存在')
    return
  }
  task.value = d.task
  template.value = d.template
  plan.value = d.plan
  community.value = d.community
})

const items = computed(() => template.value?.fields || [])
const isSup = computed(() => task.value?.taskType === '监督')
const communityLabel = computed(() => communityNameOf(task.value?.communityId))
const communityAddr = computed(() => communityAddressOf(task.value?.communityId))
const targetDeptName = computed(() => (task.value?.targetDept ? orgNameOf(task.value.targetDept) : '—'))
const planLabel = computed(() => {
  const p = plan.value
  if (!p) return '—'
  return `${p.planName || p.name || p.planId}${p.cycle ? ' · ' + p.cycle : ''}`
})

const time = computed(() => timeState(task.value))
const timeText = computed(() => time.value.text)
const timeClass = computed(() => (time.value.key === 'overdue' ? 'danger' : time.value.key === 'soon' ? 'warn' : 'muted'))
const isOverdue = computed(() => task.value?.status === '逾期' || time.value.key === 'overdue')

/** 打卡记录以本地记录为准（无后端，打卡是移动端写操作） */
const localCheckin = computed(() => getCheckin(taskId.value))
const checkinLabel = computed(() => {
  const t = task.value
  if (!t) return '—'
  if (localCheckin.value) return `${localCheckin.value.type} · 已打卡 ${String(localCheckin.value.at).slice(11)}`
  if (t.checkedIn) return `${t.checkinType} · 已打卡`
  return `${t.checkinType || 'GPS围栏'} · 未打卡`
})

const canAct = computed(() => task.value && !['已完成', '已转工单'].includes(task.value.status))
const actText = computed(() => {
  if (!task.value) return ''
  if (task.value.checkedIn || localCheckin.value) return '继续执行'
  return task.value.status === '逾期' ? '补打卡，继续作业' : '开工打卡'
})

function onAct() {
  const checked = task.value.checkedIn || localCheckin.value
  const url = checked
    ? `/pages/tasks/exec?taskId=${taskId.value}`
    : `/pages/tasks/checkin?taskId=${taskId.value}`
  uni.navigateTo({ url })
}
</script>

<style scoped>
.head.is-od {
  border: 2rpx solid rgba(255, 107, 107, 0.32);
  background: linear-gradient(180deg, #fff6f6 0%, #ffffff 60%);
}

.head__tags {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.head__ver {
  font-size: 20rpx;
  color: var(--biz-text-4);
  font-family: var(--biz-font-mono);
}

.head__t {
  display: block;
  margin-top: 16rpx;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.3;
  color: var(--biz-text-1);
}

.head__time {
  margin-top: 18rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head__clock {
  font-size: 26rpx;
  color: var(--biz-text-2);
}

.head__remain {
  font-size: 24rpx;
  font-weight: 600;
}

.head__done {
  margin-top: 18rpx;
  padding-top: 18rpx;
  border-top: 2rpx dashed var(--biz-border);
  display: flex;
  align-items: center;
  gap: 10rpx;
  font-size: 24rpx;
  color: var(--biz-text-2);
}

.head__done-i {
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: var(--biz-accent);
  color: #fff;
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.head__done-i.is-warn {
  background: var(--biz-warning);
}

.head__score {
  margin-left: auto;
  color: var(--biz-success);
  font-size: 28rpx;
}

.sec-hd__d {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.loc {
  display: flex;
  gap: 18rpx;
  align-items: flex-start;
}

.loc__pin {
  width: 64rpx;
  height: 64rpx;
  border-radius: 18rpx;
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30rpx;
  flex: none;
}

.loc__txt {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.loc__t {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.loc__d {
  font-size: 23rpx;
  color: var(--biz-text-3);
  line-height: 1.5;
}

.loc__gps {
  font-size: 20rpx;
  color: var(--biz-text-4);
  font-family: var(--biz-font-mono);
}

.item {
  display: flex;
  gap: 16rpx;
  padding: 18rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.item__idx {
  width: 44rpx;
  flex: none;
  font-size: 24rpx;
  color: var(--biz-text-4);
  padding-top: 2rpx;
}

.item__b {
  flex: 1;
  min-width: 0;
}

.item__t {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-wrap: wrap;
}

.item__label {
  font-size: 27rpx;
  color: var(--biz-text-1);
  font-weight: 500;
}

.item__req {
  color: var(--biz-danger);
  font-size: 24rpx;
}

.item__type {
  font-size: 19rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 999rpx;
  padding: 2rpx 12rpx;
}

.item__std {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.5;
}

.note {
  margin-top: 24rpx;
  padding: 24rpx;
  background: var(--biz-bg-fill);
  border-radius: 20rpx;
}

.note__t {
  display: block;
  font-size: 23rpx;
  font-weight: 600;
  color: var(--biz-text-2);
  margin-bottom: 8rpx;
}

.note__d {
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
}

.foot-info {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.foot-info__k {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.foot-info__v {
  font-size: 22rpx;
  color: var(--biz-text-2);
  font-weight: 500;
}

.foot-btn {
  flex: 1;
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
</style>
