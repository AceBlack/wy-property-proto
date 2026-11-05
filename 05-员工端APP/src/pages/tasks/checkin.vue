<template>
  <view class="page">
    <NavBar title="开工打卡" :subtitle="task?.planName || ''" />

    <view class="body body--with-foot">
      <view class="card">
        <Steps :current="0" />
      </view>

      <!-- 时间 -->
      <view class="card clock">
        <view class="clock__row">
          <view class="clock__l">
            <text class="clock__t num">{{ clock }}</text>
            <text class="clock__d">{{ weekday }} · {{ DEMO.today }}</text>
          </view>
          <view class="clock__r">
            <text class="clock__k">计划时间</text>
            <text class="clock__v num">{{ task?.scheduledTime || '—' }}</text>
            <text v-if="timeText" class="clock__s" :class="timeClass">{{ timeText }}</text>
          </view>
        </view>
        <view class="clock__hint">
          <text>演示时钟固定在 {{ DEMO.nowTime }}，真实运行时取手机时间。</text>
        </view>
      </view>

      <!-- 打卡 already done -->
      <view v-if="doneCheckin" class="card">
        <view class="sec-hd"><text class="sec-hd__t">本次打卡</text></view>
        <view class="done">
          <text class="done__i">✓</text>
          <view class="done__b">
            <text class="done__t">已打卡 · {{ doneCheckin.type }}</text>
            <text class="done__d">{{ doneCheckin.at }}<template v-if="doneCheckin.manual">（人工打卡，需主管复核）</template></text>
          </view>
        </view>
      </view>

      <template v-else>
        <!-- 定位 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">到位定位</text>
            <text class="sec-hd__d">阈值 50 米内算到位</text>
          </view>

          <view v-if="locState === 'idle'" class="loc loc--idle">
            <text class="loc__t">尚未获取定位</text>
            <text class="loc__d">点下方按钮，把当前位置作为到岗证据。</text>
            <view class="btn btn--ghost btn--sm loc__btn" @tap="locate">获取定位</view>
          </view>

          <view v-else-if="locState === 'locating'" class="loc loc--ing">
            <view class="spinner" />
            <text class="loc__t">正在定位…</text>
            <text class="loc__d">室内信号弱时会比较慢，最多等 8 秒。</text>
          </view>

          <view v-else-if="locState === 'ok'" class="loc loc--ok">
            <view class="loc__row">
              <text class="loc__ok">✓ 定位成功</text>
              <text class="tag-ok">在围栏内</text>
            </view>
            <text class="loc__gps">{{ locText }}</text>
            <view class="loc__grid">
              <view class="lg"><text class="lg__k">定位精度</text><text class="lg__v num">{{ accuracy }} 米</text></view>
              <view class="lg"><text class="lg__k">与点位偏差</text><text class="lg__v num ok">8 米</text></view>
              <view class="lg"><text class="lg__k">打卡方式</text><text class="lg__v">{{ mode }}</text></view>
            </view>
          </view>

          <!-- 降级：这是 P0 必须体现的一屏 -->
          <view v-else class="loc loc--fail">
            <view class="loc__row">
              <text class="loc__fail">! 无法定位</text>
              <text class="tag-warn">将记为人工打卡</text>
            </view>
            <text class="loc__d">{{ failReason }}</text>
            <text class="loc__tip">人工打卡会写进记录并标记「需主管复核」，不静默通过 —— 否则定位这道防线等于没有。</text>
            <view class="loc__acts">
              <view id="locate-retry" class="btn btn--line btn--sm" @tap="locate">重试定位</view>
              <view id="locate-manual" class="btn btn--ghost btn--sm" @tap="useManual">按人工打卡继续</view>
            </view>
          </view>
        </view>

        <!-- 到位方式 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">到位方式</text>
            <text class="sec-hd__d">取自任务计划的设定</text>
          </view>
          <view class="chips">
            <view
              v-for="m in modes"
              :key="m"
              class="chip"
              :class="{ 'is-on': mode === m }"
              @tap="pickMode(m)"
            >
              {{ m }}
            </view>
          </view>

          <view v-if="mode === '扫码'" class="scan">
            <text class="scan__t">H5 不支持摄像头扫码（`uni.scanCode` 仅 App / 小程序有实现）</text>
            <text class="scan__d">按降级方案：手动输入点位编号，编号会随打卡记录上传。</text>
            <input v-model="pointCode" class="input scan__input" placeholder="例：P-1F-018" placeholder-class="ph" />
          </view>
          <view v-if="mode === 'NFC'" class="scan">
            <text class="scan__d">贴一次点位 NFC 标签即可；H5 演示里按「已读卡」处理。</text>
          </view>
        </view>
      </template>

      <!-- 任务摘要 -->
      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">本次作业</text></view>
        <Cell label="任务" :value="task?.planName || '—'" />
        <Cell label="检查项" :value="`${itemCount} 项`" />
        <Cell label="位置" :value="communityLabel" :last="true" />
      </view>

      <view class="hint">
        <text>打卡后任务进入「执行中」；超过计划时间仍可提交，但会计入逾期（交接单 §八：逾期率进考核）。</text>
      </view>
    </view>

    <view class="footbar">
      <view v-if="doneCheckin" id="checkin-continue" class="btn btn--primary foot-full" @tap="goExec">继续执行</view>
      <view v-else id="checkin-confirm" class="btn btn--primary foot-full" :class="{ 'btn--disabled': !canConfirm }" @tap="confirmCheckin">
        {{ confirmText }}
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Steps from '@/components/Steps.vue'
import Cell from '@/components/Cell.vue'
import { DEMO } from '@/config/personas'
import { checkIn, communityNameOf, execData } from '@/api/mobile'
import { app, getCheckin, saveCheckin } from '@/store/app'
import { clockText, timeState } from '@/utils/deadline'
import { toast, toastErr, toastOk } from '@/utils/ui'

const taskId = ref('')
const task = ref(null)
const itemCount = ref(0)

const clock = clockText()
const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${DEMO.today}T00:00:00`).getDay()]

const modes = ['GPS围栏', 'NFC', '扫码']
const mode = ref('GPS围栏')
const pointCode = ref('')

const locState = ref('idle')
const failReason = ref('')
const loc = ref(null)

onLoad(options => {
  taskId.value = options.taskId || ''
  const d = execData(taskId.value)
  task.value = d.task
  itemCount.value = (d.template?.fields || []).length
  mode.value = d.task?.checkinType || 'GPS围栏'
  if (!modes.includes(mode.value)) mode.value = 'GPS围栏'
  /* 一进来就尝试定位：真实场景里员工走到点位才打开页面，多半已有信号 */
  locate()
})

const doneCheckin = computed(() => getCheckin(taskId.value) || (task.value?.checkedIn ? { type: task.value.checkinType || 'GPS围栏', at: '已打卡' } : null))
const communityLabel = computed(() => communityNameOf(task.value?.communityId))
const time = computed(() => timeState(task.value))
const timeText = computed(() => time.value.text)
const timeClass = computed(() => (time.value.key === 'overdue' ? 'danger' : time.value.key === 'soon' ? 'warn' : 'muted'))
const accuracy = computed(() => Math.round(loc.value?.accuracy || 25))
const locText = computed(() => (loc.value ? `${loc.value.lat.toFixed(6)}, ${loc.value.lng.toFixed(6)}` : ''))

/* 定位失败时必须显式选「按人工打卡继续」才能提交 —— 不允许一点就悄悄记成人工打卡 */
const canConfirm = computed(() => locState.value === 'ok' || locState.value === 'manual')
const confirmText = computed(() => {
  if (locState.value === 'locating') return '定位中…'
  if (locState.value === 'manual') return '确认人工打卡'
  if (locState.value === 'fail') return '请先选择人工打卡'
  if (locState.value === 'ok') return '确认打卡，开始作业'
  return '先获取定位'
})

/**
 * 定位：H5 走浏览器 geolocation，App 走原生。
 * 断网 → 直接降级；8 秒没回音 → 按超时降级。降级不是失败，是记「人工打卡」。
 */
function locate() {
  if (app.net === 'offline') {
    locState.value = 'fail'
    failReason.value = '当前断网，无法请求定位服务。'
    return
  }
  locState.value = 'locating'
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    locState.value = 'fail'
    failReason.value = '定位超时（8 秒无响应），可能在地下室或信号盲区。'
  }, 8000)

  uni.getLocation({
    type: 'gcj02',
    isHighAccuracy: true,
    success: res => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      loc.value = { lat: res.latitude, lng: res.longitude, accuracy: res.accuracy }
      locState.value = 'ok'
    },
    fail: err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      locState.value = 'fail'
      failReason.value = `无法定位（${err?.errMsg || '未授权定位'}）`
    }
  })
}

function useManual() {
  locState.value = 'manual'
  toast('已切换为人工打卡')
}

function pickMode(m) {
  mode.value = m
}

function confirmCheckin() {
  if (locState.value === 'locating') return
  if (!canConfirm.value) {
    toastErr(locState.value === 'fail' ? '请先点「按人工打卡继续」' : '请先获取定位')
    return
  }
  const manual = locState.value !== 'ok'
  if (mode.value === '扫码' && !pointCode.value.trim()) {
    toastErr('请填写点位编号')
    return
  }
  try {
    checkIn(taskId.value, {
      type: mode.value,
      gps: loc.value ? `${loc.value.lng.toFixed(6)},${loc.value.lat.toFixed(6)}` : '',
      manual
    })
    saveCheckin(taskId.value, {
      type: manual ? '人工打卡' : mode.value,
      gps: loc.value ? `${loc.value.lng.toFixed(6)},${loc.value.lat.toFixed(6)}` : '',
      manual,
      reason: manual ? failReason.value || '人工打卡' : '',
      point: pointCode.value.trim()
    })
    toastOk(manual ? '已记录人工打卡' : '打卡成功')
    setTimeout(goExec, 320)
  } catch (e) {
    toastErr(e?.message || '打卡失败')
  }
}

function goExec() {
  uni.redirectTo({ url: `/pages/tasks/exec?taskId=${taskId.value}` })
}
</script>

<style scoped>
.clock__row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.clock__t {
  display: block;
  font-size: 84rpx;
  line-height: 1;
  color: var(--biz-text-1);
  letter-spacing: 2rpx;
}

.clock__d {
  display: block;
  margin-top: 10rpx;
  font-size: 23rpx;
  color: var(--biz-text-3);
}

.clock__r {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
}

.clock__k {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.clock__v {
  font-size: 38rpx;
  color: var(--biz-text-2);
  line-height: 1.1;
}

.clock__s {
  font-size: 21rpx;
}

.clock__hint {
  margin-top: 20rpx;
  padding-top: 16rpx;
  border-top: 2rpx dashed var(--biz-border-light);
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.loc {
  border-radius: 18rpx;
  padding: 22rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.loc--idle {
  background: var(--biz-bg-fill);
}

.loc--ing {
  background: var(--biz-bg-fill);
  align-items: center;
}

.loc--ok {
  background: rgba(46, 217, 163, 0.07);
  border: 2rpx solid rgba(46, 217, 163, 0.32);
}

.loc--fail {
  background: #fff8f0;
  border: 2rpx solid rgba(255, 159, 64, 0.34);
}

.loc__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.loc__t {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.loc__d {
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.loc__ok {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-success);
}

.loc__fail {
  font-size: 27rpx;
  font-weight: 600;
  color: #a35c13;
}

.tag-ok {
  font-size: 19rpx;
  color: var(--biz-success);
  border: 2rpx solid rgba(18, 185, 138, 0.3);
  background: #fff;
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
}

.tag-warn {
  font-size: 19rpx;
  color: #a35c13;
  border: 2rpx solid rgba(255, 159, 64, 0.4);
  background: #fff;
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
}

.loc__gps {
  font-size: 21rpx;
  color: var(--biz-text-3);
  font-family: var(--biz-font-mono);
}

.loc__grid {
  display: flex;
  gap: 12rpx;
  margin-top: 6rpx;
}

.lg {
  flex: 1;
  background: #fff;
  border-radius: 12rpx;
  padding: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.lg__k {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.lg__v {
  font-size: 24rpx;
  color: var(--biz-text-1);
  font-weight: 600;
}

.loc__tip {
  font-size: 20rpx;
  color: #a35c13;
  line-height: 1.6;
  opacity: 0.9;
}

.loc__acts {
  display: flex;
  gap: 14rpx;
  margin-top: 6rpx;
}

.loc__btn {
  align-self: flex-start;
  margin-top: 4rpx;
}

.spinner {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  border: 5rpx solid var(--biz-primary-light-8);
  border-top-color: var(--biz-primary);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.chips {
  display: flex;
  gap: 14rpx;
}

.chip {
  padding: 14rpx 28rpx;
  border-radius: 999rpx;
  font-size: 25rpx;
  color: var(--biz-text-2);
  background: var(--biz-bg-fill);
  border: 2rpx solid transparent;
}

.chip.is-on {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-color: var(--biz-primary);
  font-weight: 600;
}

.scan {
  margin-top: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.scan__t {
  font-size: 21rpx;
  color: #a35c13;
  background: #fff8f0;
  padding: 12rpx 16rpx;
  border-radius: 12rpx;
  line-height: 1.5;
}

.scan__d {
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.scan__input {
  height: 76rpx;
}

.ph {
  color: var(--biz-text-4);
}

.done {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.done__i {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: var(--biz-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  flex: none;
}

.done__b {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.done__t {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.done__d {
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.hint {
  margin-top: 20rpx;
  font-size: 21rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
  padding: 0 8rpx;
}

.foot-full {
  flex: 1;
}

.sec-hd__d {
  font-size: 20rpx;
  color: var(--biz-text-4);
}
</style>
