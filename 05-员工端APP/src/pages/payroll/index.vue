<template>
  <view class="page">
    <NavBar title="我的工资条" :subtitle="persona?.name || ''" />

    <view class="body">
      <view class="hint">
        <text class="hint__t">只看本人，看不到别人的</text>
        <text class="hint__d">
          工资条是「核算快照」不是实时查询：金额在核算锁定那一刻就冻住了。
          移动端不提供全表权限（PC 的 c.payroll.view 只给财务与人事），这里走「本人」规则。
        </text>
      </view>

      <!-- 提成不进这张表：工资表是期间锁定快照，提成按收款状态结算，次月并表 -->
      <view id="pay-commission" class="entry" hover-class="entry--hover" @tap="goCommission">
        <view class="entry__l">
          <text class="entry__t">工单提成（独立结算）</text>
          <text class="entry__d">只算人工费，业主付了钱才结；次月随工资并入，不在这张工资条里</text>
        </view>
        <view class="entry__chev" />
      </view>

      <view v-if="loading" class="card"><text class="muted">加载中…</text></view>

      <view v-else-if="!rows.length" class="card">
        <Empty text="没有你的工资条" sub="这个账号不在员工名册（一线执行人是计划设定值），没有工资数据。切到「汪磊 / 莫瑞 / 徐悦」可看" />
      </view>

      <view v-for="r in rows" :key="r.payrollId" :id="`pay-${r.period}`" class="card" hover-class="card--hover" @tap="open(r)">
        <view class="row__top">
          <text class="mon num">{{ r.period }}</text>
          <text class="status">{{ r.status }}</text>
          <view class="row__r">
            <text class="row__k">实发</text>
            <text class="row__v num">{{ money(r.netPay) }}</text>
          </view>
        </view>
        <view class="row__meta">
          <text>应发 {{ money(r.grossPay) }}</text>
          <text class="dot">·</text>
          <text>代扣 {{ money(r.deductionTotal) }}</text>
          <text class="dot">·</text>
          <text>{{ r.position }}</text>
        </view>
      </view>

      <view class="note">
        <text>发放审批由财务走流程；工资条只读，改不了也确认不了 —— 有异议找人事，不在手机上改数。</text>
      </view>
    </view>

    <Sheet v-model:show="sheet" :title="cur ? `${cur.period} 工资条` : ''" :sub="cur ? `${cur.empName} · ${cur.position}` : ''" max-height="72vh">
      <template v-if="det">
        <view class="total">
          <view class="total__i">
            <text class="total__k">应发合计</text>
            <text class="total__v num">{{ money(det.payroll.grossPay) }}</text>
          </view>
          <view class="total__i">
            <text class="total__k">代扣合计</text>
            <text class="total__v num is-out">-{{ money(det.payroll.deductionTotal) }}</text>
          </view>
          <view class="total__i">
            <text class="total__k">实发</text>
            <text class="total__v num is-net">{{ money(det.payroll.netPay) }}</text>
          </view>
        </view>

        <text class="fk">应发明细</text>
        <view v-for="g in det.calc.gross" :key="g.label" class="line">
          <text class="line__k">{{ g.label }}<text v-if="g.note" class="line__n">{{ g.note }}</text></text>
          <text class="line__v num">{{ money(g.amount) }}</text>
        </view>

        <text class="fk" style="margin-top: 20rpx">代扣明细</text>
        <view v-for="g in det.calc.deductions" :key="g.label" class="line">
          <text class="line__k">{{ g.label }}<text v-if="g.note" class="line__n">{{ g.note }}</text></text>
          <text class="line__v num is-out">{{ money(g.amount) }}</text>
        </view>

        <text class="tip">金额由数据层按公式算出，页面不加总；核算锁定后不再变动。</text>
      </template>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Sheet from '@/components/Sheet.vue'
import Empty from '@/components/Empty.vue'
import { myPayrolls, payrollDetail } from '@/api/hr'
import { money } from '@/utils/format'
import { app, persona } from '@/store/app'
import { toastErr } from '@/utils/ui'

const rows = ref([])
const loading = ref(true)
const sheet = ref(false)
const cur = ref(null)
const det = ref(null)

async function load() {
  loading.value = true
  try {
    rows.value = persona.value?.name ? await myPayrolls(persona.value) : []
  } catch (e) {
    rows.value = []
  }
  loading.value = false
}

function goCommission() {
  uni.navigateTo({ url: '/pages/payroll/commission' })
}

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  load()
})

async function open(r) {
  cur.value = r
  try {
    det.value = await payrollDetail(persona.value, r.payrollId)
    sheet.value = true
  } catch (e) {
    toastErr(e?.message || '读取失败')
  }
}
</script>

<style scoped>
.hint {
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.hint__t {
  display: block;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--biz-text-2);
  margin-bottom: 8rpx;
}

.hint__d {
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
}

.card--hover {
  background: var(--biz-bg-hover);
}

.row__top {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.mon {
  font-size: 30rpx;
  color: var(--biz-text-1);
}

.status {
  font-size: 20rpx;
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-radius: 999rpx;
  padding: 4rpx 12rpx;
}

.row__r {
  margin-left: auto;
  display: flex;
  align-items: baseline;
  gap: 8rpx;
}

.row__k {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.row__v {
  font-size: 32rpx;
  color: var(--biz-text-1);
}

.row__meta {
  margin-top: 10rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.dot {
  color: var(--biz-text-4);
}

.note {
  margin-top: 20rpx;
  padding: 0 8rpx;
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
}

.entry {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.entry--hover {
  background: var(--biz-bg-hover);
}

.entry__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.entry__t {
  font-size: 25rpx;
  font-weight: 600;
  color: #a35c13;
}

.entry__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.entry__chev {
  flex: none;
  width: 14rpx;
  height: 14rpx;
  border-top: 3rpx solid var(--biz-text-4);
  border-right: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
}

.muted {
  font-size: 24rpx;
  color: var(--biz-text-3);
}

.total {
  display: flex;
  gap: 10rpx;
  margin-bottom: 20rpx;
}

.total__i {
  flex: 1;
  background: var(--biz-bg-fill);
  border-radius: 12rpx;
  padding: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.total__k {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.total__v {
  font-size: 24rpx;
  color: var(--biz-text-1);
}

.total__v.is-out {
  color: var(--biz-danger);
}

.total__v.is-net {
  color: var(--biz-success);
}

.fk {
  display: block;
  font-size: 22rpx;
  font-weight: 600;
  color: var(--biz-text-2);
  margin-bottom: 8rpx;
}

.line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.line__k {
  flex: 1;
  font-size: 24rpx;
  color: var(--biz-text-2);
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.line__n {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.line__v {
  font-size: 25rpx;
  color: var(--biz-text-1);
}

.line__v.is-out {
  color: var(--biz-danger);
}

.tip {
  display: block;
  margin-top: 18rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}
</style>
