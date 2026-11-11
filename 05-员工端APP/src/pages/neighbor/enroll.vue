<template>
  <view class="page">
    <NavBar title="活动详情" :subtitle="d?.communityName || ''" />

    <view v-if="!d" class="body">
      <Empty text="活动不存在" sub="回到列表刷新一下" />
    </view>

    <view v-else class="body body--with-foot">
      <view class="card">
        <view class="hd">
          <text class="hd__t">{{ d.title }}</text>
          <text class="ph" :class="`ph--${d.phaseType || 'info'}`">{{ d.phase }}</text>
        </view>
        <view class="row">
          <text class="row__k">费用</text>
          <text class="row__v num">{{ d.feeText }}</text>
        </view>
        <view class="row"><text class="row__k">时间</text><text class="row__v num">{{ d.startAt }} 至 {{ String(d.endAt).slice(11) }}</text></view>
        <view class="row"><text class="row__k">地点</text><text class="row__v">{{ d.place }}</text></view>
        <view class="row"><text class="row__k">报名截止</text><text class="row__v num">{{ d.enrollDeadline }}</text></view>
        <view class="row"><text class="row__k">每户限</text><text class="row__v">{{ d.attendeeLimit }} 人</text></view>

        <view class="bar">
          <view class="bar__in" :style="{ width: d.fillRate + '%' }" />
        </view>
        <view class="bar__f">
          <text class="num">已报 {{ d.enrolled }}/{{ d.capacity }}</text>
          <text v-if="d.phase === '待成行'" class="gap">还差 {{ d.gap }} 人成团</text>
          <text v-else-if="d.over" class="gap">超出名额 {{ d.over }} 人</text>
          <text v-else-if="d.phase === '报名中'" class="ok">报名中 · 截止 {{ d.enrollDeadline }}</text>
          <text v-else class="ok">已成团</text>
        </view>
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">费用与退款</text>
          <text class="sec-hd__d">{{ d.fee > 0 ? '收费活动' : '公益活动' }}</text>
        </view>
        <text v-if="d.feeInclude" class="p">含：{{ d.feeInclude }}</text>
        <text v-if="d.feeExclude" class="p p--gray">不含：{{ d.feeExclude }}</text>
        <view v-if="d.refundPolicy.length" class="refund">
          <text class="refund__t">退款规则（金额按此计算，页面不可手改）</text>
          <view class="refund__list">
            <text v-for="(r, i) in d.refundPolicy" :key="i" class="refund__i">
              {{ r.days > 0 ? `提前 ${r.days} 天` : '当天及之后' }} 退 {{ r.ratio }}%
            </text>
          </view>
        </view>
        <text v-if="d.needInsurance" class="warn">需投保：每位出行人都要填实名与证件号，只有联系人买不了保险。</text>
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">报名名单</text>
          <text class="sec-hd__d">{{ active.length }} 条在册</text>
        </view>
        <view
          v-for="e in enrolls"
          :key="e.enrollId"
          :id="`nb-enr-${e.enrollId}`"
          class="enr"
          hover-class="enr--hover"
          @tap="openRow(e)"
        >
          <view class="enr__b">
            <view class="enr__top">
              <text class="enr__n">{{ e.name }}</text>
              <text class="enr__p num">{{ maskPhone(e.phone) }}</text>
              <text class="enr__s" :class="`is-${e.statusType || 'info'}`">{{ e.status }}</text>
            </view>
            <text class="enr__d">{{ e.people }} 人 · {{ e.houseShort || '未填房号' }} · {{ e.source }} · {{ String(e.at).slice(5, 16) }}</text>
          </view>
          <text class="enr__chev">›</text>
        </view>
        <Empty v-if="!enrolls.length" text="还没有人报名" sub="现场替业主报一个，名单会立刻出现" />
      </view>

      <view class="tail">
        <text v-if="d.phase === '待成行'">
          这场活动报名已截止但没到成团下限（{{ d.enrolled }}/{{ d.minCapacity }}），处于「待成行」：
          不能再报名，也不能签到 —— 人可能根本不成行。
        </text>
        <text v-else>报名、取消、退款、签到都记经办人，回 PC 能看到是谁办的。</text>
      </view>
    </view>

    <view v-if="d" class="footbar">
      <view v-if="d.phase !== '报名中'" id="nb-enroll-off" class="btn foot-btn btn--disabled">
        {{ d.phase }}，不能报名
      </view>
      <view v-else-if="!canEnroll" id="nb-enroll-off" class="btn foot-btn btn--disabled">当前账号不能代报名</view>
      <view v-else id="nb-enroll-btn" class="btn btn--primary foot-btn" @tap="openEnroll">代报名</view>
    </view>

    <!-- 报名表（与活动列表共用一个组件，规则只有一份） -->
    <EnrollSheet v-model:show="sheet" :activity="d" @done="load" />

    <!-- 名单行操作 -->
    <ActionSheet
      v-model:show="rowSheet"
      :title="cur?.name || ''"
      :sub="cur ? `${cur.people} 人 · ${cur.status}` : ''"
      :actions="rowActions"
      @select="onRowAction"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import EnrollSheet from '@/components/EnrollSheet.vue'
import { activityOf, cancel, checkin, enrollsOf, refund } from '@/api/neighbor'
import { CAP, can } from '@/config/personas'
import { persona } from '@/store/app'
import { maskPhone } from '@pc/utils/format'
import { toastErr, toastOk } from '@/utils/ui'

const activityId = ref('')
const d = ref(null)
const enrolls = ref([])
const sheet = ref(false)
const rowSheet = ref(false)
const cur = ref(null)

const canEnroll = computed(() => can(persona.value, CAP.neighborActEnroll))
const active = computed(() => enrolls.value.filter(e => !['已取消', '已退款'].includes(e.status)))

const rowActions = computed(() => {
  const e = cur.value
  if (!e) return []
  const list = []
  if (e.status === '已报名' && d.value?.phase === '已成行') {
    list.push({ label: '签到', desc: '活动当天到场确认', value: 'checkin' })
  }
  if (e.status === '已报名') {
    list.push({ label: d.value?.fee > 0 ? '取消并退款' : '取消报名', desc: '按退款分档自动算金额', value: 'cancel' })
  }
  return list
})

async function load() {
  d.value = await activityOf(activityId.value)
  enrolls.value = await enrollsOf(activityId.value)
}

function openEnroll() {
  sheet.value = true
}

function openRow(e) {
  cur.value = e
  if (!rowActions.value.length) {
    toastErr(`「${e.status}」的报名没有可执行的操作`)
    return
  }
  rowSheet.value = true
}

async function onRowAction(v) {
  rowSheet.value = false
  const e = cur.value
  if (!e) return
  try {
    if (v === 'checkin') {
      await checkin(persona.value, e.enrollId)
      toastOk('已签到')
    } else {
      /* 退款金额由服务端按活动档位算，页面只负责显示 —— 前端算一份会出现"显示 50% 实际 30%" */
      const r = d.value?.fee > 0
        ? await refund(persona.value, e.enrollId, '现场取消')
        : await cancel(persona.value, e.enrollId, '现场取消')
      if (d.value?.fee > 0 && r?.amount !== undefined) {
        toastOk(`已退款 ¥${r.amount}（按 ${r.ratio}% 档）`)
      } else {
        toastOk('已取消报名')
      }
    }
    await load()
  } catch (err) {
    toastErr(err.message || '操作失败')
  }
}

onLoad(o => {
  activityId.value = o.activityId || ''
  load()
})
</script>

<style scoped>
.hd {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
}

.hd__t {
  flex: 1;
  min-width: 0;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.4;
}

.ph {
  flex: none;
  font-size: 17rpx;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}

.ph--success {
  color: var(--biz-accent-dark);
  background: #e6faf3;
}

.ph--warning {
  color: #a35c13;
  background: #fff7ed;
}

.ph--danger {
  color: var(--biz-danger);
  background: #fff0f0;
}

.ph--info {
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
}

.row {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding: 8rpx 0;
}

.row__k {
  flex: none;
  width: 130rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.row__v {
  flex: 1;
  font-size: 23rpx;
  color: var(--biz-text-1);
}

.bar {
  height: 10rpx;
  border-radius: 999rpx;
  background: var(--biz-bg-fill);
  overflow: hidden;
  margin: 16rpx 0 8rpx;
}

.bar__in {
  height: 100%;
  background: var(--biz-gradient);
}

.bar__f {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 20rpx;
  color: var(--biz-text-2);
}

.gap {
  font-size: 19rpx;
  color: #a35c13;
}

.ok {
  font-size: 19rpx;
  color: var(--biz-accent-dark);
}

.p {
  display: block;
  font-size: 21rpx;
  color: var(--biz-text-2);
  line-height: 1.6;
}

.p--gray {
  color: var(--biz-text-4);
}

.refund {
  margin-top: 12rpx;
  padding-top: 12rpx;
  border-top: 2rpx solid var(--biz-border-light);
}

.refund__t {
  display: block;
  font-size: 20rpx;
  color: var(--biz-text-3);
  margin-bottom: 8rpx;
}

.refund__list {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.refund__i {
  font-size: 18rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
}

.warn {
  display: block;
  margin-top: 12rpx;
  font-size: 18rpx;
  color: #a35c13;
  background: #fff7ed;
  border-radius: 10rpx;
  padding: 10rpx 14rpx;
  line-height: 1.55;
}

.enr {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.enr:last-of-type {
  border-bottom: none;
}

.enr--hover {
  background: var(--biz-bg-hover);
}

.enr__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.enr__top {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
}

.enr__n {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.enr__p {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.enr__s {
  font-size: 17rpx;
  border-radius: 6rpx;
  padding: 1rpx 8rpx;
}

.enr__s.is-success {
  color: var(--biz-accent-dark);
  background: #e6faf3;
}

.enr__s.is-warning {
  color: #a35c13;
  background: #fff7ed;
}

.enr__s.is-info {
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
}

.enr__d {
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.enr__chev {
  flex: none;
  font-size: 30rpx;
  color: var(--biz-text-4);
}

.tail {
  padding: 10rpx 4rpx 20rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.foot-btn {
  flex: 1;
  height: 88rpx;
  font-size: 29rpx;
}
</style>
