<template>
  <view class="page">
    <NavBar title="提交结果" :back="false" :subtitle="taskId" />

    <view class="body body--with-foot">
      <!-- 结果头 -->
      <view class="card res" :class="isPending ? 'is-pend' : 'is-done'">
        <view class="res__ico">
          <text v-if="isPending">↻</text>
          <text v-else>✓</text>
        </view>
        <text class="res__t">{{ isPending ? '已存本机，待同步' : '提交成功' }}</text>
        <text class="res__d">{{ subtitle }}</text>
        <view class="res__tags">
          <text class="res__tag">{{ isSup ? '监督核验' : '执行巡检' }}</text>
          <text class="res__tag">{{ planName }}</text>
        </view>
      </view>

      <!-- 断网说明 -->
      <view v-if="isPending" class="banner banner--pending">
        <text class="banner__ico"><text>↑</text></text>
        <view class="banner__bd">
          <text class="banner__t">为什么不是「提交成功」</text>
          <text class="banner__d">
            当前断网，结果只写进了手机本地队列，任务状态还没改。恢复网络后会自动上传；
            也可以点下面「立即同步」。
          </text>
        </view>
      </view>

      <!-- 数字 -->
      <view class="stats">
        <view class="stat">
          <text class="stat__n num">{{ normalCount }}</text>
          <text class="stat__k">达标项</text>
        </view>
        <view class="stat">
          <text class="stat__n num" :class="{ danger: issueCount > 0 }">{{ issueCount }}</text>
          <text class="stat__k">{{ isSup ? '发现问题' : '异常项' }}</text>
        </view>
        <view class="stat">
          <text class="stat__n num" :class="{ ok: score >= 90 }">{{ score }}</text>
          <text class="stat__k">本次得分</text>
        </view>
        <view class="stat">
          <text class="stat__n num">{{ photos }}</text>
          <text class="stat__k">{{ placeholders ? `照片·${placeholders} 张占位` : '照片' }}</text>
        </view>
      </view>

      <!-- 明细 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">逐项结果</text>
          <text class="sec-hd__d">共 {{ items.length }} 项</text>
        </view>
        <view v-for="(it, i) in items" :key="it.label" class="ri">
          <text class="ri__i num">{{ String(i + 1).padStart(2, '0') }}</text>
          <view class="ri__b">
            <text class="ri__l">{{ it.label }}</text>
            <text v-if="it.state === 'ng'" class="ri__d">
              {{ it.reason || '未填类型' }}<template v-if="it.note"> · {{ it.note }}</template>
              <template v-if="it.responsibleName"> · 责任人 {{ it.responsibleName }}</template>
            </text>
          </view>
          <text class="ri__s" :class="it.state === 'ng' ? 'is-ng' : 'is-ok'">
            {{ it.state === 'ng' ? (isSup ? '不达标' : '异常') : '达标' }}
          </text>
        </view>
      </view>

      <!-- 监督专属：责任人与冲突 -->
      <view v-if="isSup" class="card">
        <view class="sec-hd"><text class="sec-hd__t">考核归口</text></view>
        <template v-if="hitEmployees.length">
          <view class="hit">
            <text class="hit__k">问题记到</text>
            <view class="hit__chips">
              <text v-for="n in hitEmployees" :key="n" class="hit__c">{{ n }}</text>
            </view>
          </view>
          <view v-if="conflictFlag" class="banner banner--offline" style="margin-top: 16rpx">
            <text class="banner__ico"><text>!</text></text>
            <view class="banner__bd">
              <text class="banner__t">已标记冲突</text>
              <text class="banner__d">
                本班组当日有员工申报「零异常」，而本次现场查出问题 —— 后台会把这两条并排展示。
              </text>
            </view>
          </view>
        </template>
        <text v-else class="muted-text">本次抽查全部达标，未产生问题项，不涉及责任人。</text>
      </view>

      <view v-if="placeholders" class="banner banner--offline" style="margin-top: 4rpx">
        <text class="banner__ico"><text>!</text></text>
        <view class="banner__bd">
          <text class="banner__t">{{ placeholders }} 张照片是占位（相机不可用）</text>
          <text class="banner__d">占位会作为「缺证」随结果一起提交，主管复核时能看到哪一项没留到照片。</text>
        </view>
      </view>

      <view class="tail">
        <text>
          {{ isSup
            ? '监督结果会进入部门达标率与主管「发现问题数」，不直接扣一线分。'
            : '异常项会进入整改闭环；未完成项提交后按逾期计。' }}
        </text>
      </view>
    </view>

    <view class="footbar">
      <view v-if="isPending" id="sync-btn" class="btn btn--ghost foot-btn" @tap="sync">立即同步</view>
      <view id="back-list" class="btn btn--primary foot-btn" @tap="goList">返回任务列表</view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import { getInspectTaskDetail } from '@/api/mobile'
import { app, syncPending } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const taskId = ref('')
const fallback = ref(null)

onLoad(async options => {
  taskId.value = options.taskId || ''
  if (!app.lastSubmit || app.lastSubmit.taskId !== taskId.value) {
    /* 刷新或直链进入：用任务自身的落库结果兜底，不编数字 */
    const d = await getInspectTaskDetail(taskId.value)
    if (d?.task) fallback.value = d.task
  }
})

const src = computed(() => (app.lastSubmit?.taskId === taskId.value ? app.lastSubmit : null))
const task = computed(() => fallback.value)
const isSup = computed(() => !!(src.value?.isSup ?? task.value?.taskType === '监督'))
const isPending = computed(() => !!src.value?.pending)

const planName = computed(() => src.value?.planName || task.value?.planName || '—')
const normalCount = computed(() => src.value?.normalCount ?? task.value?.normalCount ?? 0)
const issueCount = computed(() => src.value?.issueCount ?? task.value?.issueCount ?? 0)
const score = computed(() => src.value?.score ?? task.value?.score ?? 0)
const photos = computed(() => src.value?.photos ?? task.value?.photos ?? 0)
const placeholders = computed(() => src.value?.placeholders ?? 0)
const items = computed(() => {
  if (src.value?.items?.length) return src.value.items
  return (task.value?.issueItems || []).map(x => ({ label: x.item, state: 'ng', reason: x.reason, note: x.note, responsibleName: x.responsibleName }))
})
const hitEmployees = computed(() => src.value?.hitEmployees || task.value?.hitEmployees || [])
const conflictFlag = computed(() => !!(src.value?.conflictFlag || task.value?.conflictFlag))

const subtitle = computed(() => {
  if (isPending.value) return `${src.value.at} · 待上传，任务尚未置为已完成`
  const t = src.value?.at || task.value?.doneTime || ''
  return t ? `${t} · 结果已写回任务` : '结果已写回任务'
})

async function sync() {
  const r = await syncPending()
  if (r.fail) {
    toastErr(`${r.fail} 条同步失败，稍后再试`)
    return
  }
  if (app.lastSubmit) app.lastSubmit.pending = false
  toastOk('已同步，任务已置为已完成')
}

function goList() {
  uni.switchTab({ url: '/pages/tasks/list' })
}
</script>

<style scoped>
.res {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 46rpx 28rpx 38rpx;
}

.res.is-done {
  background: linear-gradient(180deg, #eafaf4 0%, #ffffff 62%);
}

.res.is-pend {
  background: linear-gradient(180deg, #eff0ff 0%, #ffffff 62%);
}

.res__ico {
  width: 116rpx;
  height: 116rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 54rpx;
  color: #fff;
  background: var(--biz-accent);
  box-shadow: var(--biz-shadow-accent);
}

.res.is-pend .res__ico {
  background: var(--biz-primary);
  box-shadow: var(--biz-shadow-primary);
}

.res__t {
  margin-top: 22rpx;
  font-size: 38rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.res__d {
  margin-top: 10rpx;
  font-size: 23rpx;
  color: var(--biz-text-3);
  text-align: center;
}

.res__tags {
  margin-top: 20rpx;
  display: flex;
  gap: 10rpx;
  flex-wrap: wrap;
  justify-content: center;
}

.res__tag {
  font-size: 20rpx;
  color: var(--biz-text-2);
  background: rgba(255, 255, 255, 0.86);
  border: 2rpx solid var(--biz-border);
  border-radius: 999rpx;
  padding: 5rpx 16rpx;
}

.stats {
  display: flex;
  gap: 12rpx;
  margin-bottom: 24rpx;
}

.stat {
  flex: 1;
  background: #fff;
  border-radius: 18rpx;
  padding: 20rpx 10rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
  box-shadow: var(--biz-shadow-card);
}

.stat__n {
  font-size: 44rpx;
  line-height: 1;
  color: var(--biz-text-1);
}

.stat__k {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.ri {
  display: flex;
  gap: 14rpx;
  padding: 16rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.ri:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.ri__i {
  width: 40rpx;
  flex: none;
  font-size: 22rpx;
  color: var(--biz-text-4);
}

.ri__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.ri__l {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.ri__d {
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.5;
}

.ri__s {
  flex: none;
  font-size: 21rpx;
  align-self: center;
}

.ri__s.is-ok {
  color: var(--biz-success);
}

.ri__s.is-ng {
  color: var(--biz-ins-overdue);
  font-weight: 600;
}

.hit {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.hit__k {
  font-size: 24rpx;
  color: var(--biz-text-3);
  flex: none;
}

.hit__chips {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  justify-content: flex-end;
}

.hit__c {
  font-size: 23rpx;
  color: var(--biz-ins-overdue);
  background: #fff0f0;
  border: 2rpx solid rgba(255, 107, 107, 0.32);
  border-radius: 999rpx;
  padding: 5rpx 16rpx;
}

.muted-text {
  font-size: 23rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.sec-hd__d {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.tail {
  margin-top: 22rpx;
  font-size: 21rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
  padding: 0 8rpx;
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
  line-height: 1.55;
}
</style>
