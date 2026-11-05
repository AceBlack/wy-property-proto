<template>
  <view class="page">
    <NavBar title="我的考勤" :subtitle="persona?.name || ''" />

    <view class="body">
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">近三个月</text>
          <text class="sec-hd__d">月度汇总，不是逐日打卡</text>
        </view>
        <view class="kpis">
          <view class="kpi"><text class="kpi__n num">{{ sum.months }}</text><text class="kpi__k">月份</text></view>
          <view class="kpi"><text class="kpi__n num">{{ sum.late }}</text><text class="kpi__k">迟到次数</text></view>
          <view class="kpi"><text class="kpi__n num">{{ sum.leave }}</text><text class="kpi__k">请假天数</text></view>
          <view class="kpi"><text class="kpi__n num">{{ sum.overtime }}</text><text class="kpi__k">加班小时</text></view>
        </view>
        <view class="note">
          <text>考勤只做「月度确认 + 申诉」：现场到岗留证已经由巡检打卡承担，不再单独做每日打卡，
            否则两处时间对不上，谁也说不清。</text>
        </view>
      </view>

      <view v-if="!rows.length" class="card">
        <Empty text="这个账号没有考勤记录" sub="当前身份是计划上的执行人、不在员工名册，因此没有考勤与工资数据 —— 切到「汪磊 / 莫瑞 / 徐悦」可看" />
      </view>

      <view v-for="r in rows" :key="r.id" class="card">
        <view class="row__top">
          <text class="mon num">{{ r.month }}</text>
          <text class="status" :style="{ color: r.statusTone }">{{ r.status }}</text>
          <text class="rate num">{{ r.rate }}%</text>
        </view>

        <view class="grid">
          <view class="g"><text class="g__k">应出勤</text><text class="g__v num">{{ r.should }}</text></view>
          <view class="g"><text class="g__k">实出勤</text><text class="g__v num">{{ r.actual }}</text></view>
          <view class="g"><text class="g__k">迟到</text><text class="g__v num" :class="{ warn: r.late > 0 }">{{ r.late }}</text></view>
          <view class="g"><text class="g__k">早退</text><text class="g__v num">{{ r.early }}</text></view>
          <view class="g"><text class="g__k">缺勤</text><text class="g__v num" :class="{ danger: r.absent > 0 }">{{ r.absent }}</text></view>
          <view class="g"><text class="g__k">加班</text><text class="g__v num">{{ r.overtime }}h</text></view>
        </view>

        <view v-if="r.appealResult" class="appeal">
          <text class="appeal__k">申诉记录</text>
          <text class="appeal__v">{{ r.appealResult }}</text>
        </view>

        <view v-if="r.status === '待确认'" class="acts">
          <view :id="`att-appeal-${r.id}`" class="btn btn--line btn--sm" @tap="openAppeal(r)">有异议，申诉</view>
          <view :id="`att-confirm-${r.id}`" class="btn btn--primary btn--sm" @tap="doConfirm(r)">确认无误</view>
        </view>
        <view v-else-if="r.status === '异常'" class="acts">
          <view :id="`att-appeal-${r.id}`" class="btn btn--line btn--sm" @tap="openAppeal(r)">有异议，申诉</view>
        </view>
      </view>
    </view>

    <Sheet v-model:show="appealSheet" title="考勤申诉" :sub="cur ? `${cur.month} · ${cur.status}` : ''" max-height="50vh">
      <textarea
        v-model="reason"
        class="textarea"
        :maxlength="120"
        placeholder="例：10 月 8 日是替班，系统记成了迟到"
        placeholder-class="ph-txt"
      />
      <text class="tip">申诉不会自动修改考勤结果，会进人事待办由人工核实。</text>
      <view class="sheet__act">
        <view class="btn btn--line" @tap="appealSheet = false">取消</view>
        <view id="att-appeal-confirm" class="btn btn--primary" @tap="doAppeal">提交申诉</view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Sheet from '@/components/Sheet.vue'
import Empty from '@/components/Empty.vue'
import { appealAttendance, attendanceOf, attendanceYearSummary, confirmAttendance } from '@/api/hr'
import { app, persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const ver = ref(0)
const appealSheet = ref(false)
const cur = ref(null)
const reason = ref('')

const empId = computed(() => persona.value?.empId || '')
const rows = computed(() => (ver.value, empId.value ? attendanceOf(empId.value) : []))
const sum = computed(() => (ver.value, empId.value ? attendanceYearSummary(empId.value) : { months: 0, late: 0, leave: 0, overtime: 0, pending: 0 }))

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  ver.value++
})

function doConfirm(r) {
  try {
    confirmAttendance(r.id)
    ver.value++
    toastOk('已确认')
  } catch (e) {
    toastErr(e?.message || '确认失败')
  }
}

function openAppeal(r) {
  cur.value = r
  reason.value = ''
  appealSheet.value = true
}

function doAppeal() {
  if (!reason.value.trim()) {
    toastErr('写清异议原因')
    return
  }
  try {
    appealAttendance(cur.value.id, reason.value.trim())
    appealSheet.value = false
    ver.value++
    toastOk('已提交，等人事核实')
  } catch (e) {
    toastErr(e?.message || '申诉失败')
  }
}
</script>

<style scoped>
.kpis {
  display: flex;
  gap: 12rpx;
}

.kpi {
  flex: 1;
  background: var(--biz-bg-fill);
  border-radius: 14rpx;
  padding: 16rpx 10rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
}

.kpi__n {
  font-size: 34rpx;
  line-height: 1;
  color: var(--biz-text-1);
}

.kpi__k {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.note {
  margin-top: 18rpx;
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.65;
}

.row__top {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.mon {
  font-size: 32rpx;
  color: var(--biz-text-1);
}

.status {
  font-size: 21rpx;
  font-weight: 600;
}

.rate {
  margin-left: auto;
  font-size: 26rpx;
  color: var(--biz-text-2);
}

.grid {
  margin-top: 16rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.g {
  width: calc((100% - 20rpx) / 3);
  background: var(--biz-bg-fill);
  border-radius: 12rpx;
  padding: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.g__k {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.g__v {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.g__v.warn {
  color: var(--biz-warning);
}

.g__v.danger {
  color: var(--biz-danger);
}

.appeal {
  margin-top: 14rpx;
  padding: 12rpx 14rpx;
  background: var(--biz-primary-light-9);
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.appeal__k {
  font-size: 19rpx;
  color: var(--biz-primary);
}

.appeal__v {
  font-size: 21rpx;
  color: var(--biz-text-2);
  line-height: 1.5;
}

.acts {
  margin-top: 18rpx;
  display: flex;
  gap: 14rpx;
  justify-content: flex-end;
}

.tip {
  display: block;
  margin-top: 12rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.sheet__act {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.sheet__act .btn {
  flex: 1;
  height: 84rpx;
  font-size: 27rpx;
}

.ph-txt {
  color: var(--biz-text-4);
}
</style>
