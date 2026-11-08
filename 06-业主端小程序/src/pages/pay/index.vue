<!-- 待支付 / 模拟支付成功（账单缴费、报修预付、增项补付共用） -->
<template>
  <view class="page">
    <NavBar :title="paid ? '支付结果' : '待支付'" :back="!paid" />
    <view class="body" :class="{ 'body--with-foot': !paid }">
      <Empty v-if="!pay" text="订单不存在或已失效" sub="回账单 / 报修重新发起" />
      <template v-else>
        <view class="card py__amt">
          <text class="py__amt-k">{{ paid ? '实付金额' : '应付金额' }}</text>
          <view class="big" :class="{ 'is-ok': paid }">
            <text class="big__cur">¥</text>
            <text class="big__num">{{ amount(pay.amount) }}</text>
          </view>
          <view class="py__state" :class="paid ? 'is-ok' : 'is-wait'">
            <text class="py__state-i">{{ paid ? '✓' : '!' }}</text>
            <text>{{ paid ? `已于 ${pay.paidAt} 支付完成` : '订单待支付，30 分钟内有效' }}</text>
          </view>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">订单信息</text><text class="sec-hd__d">{{ typeText }}</text></view>
          <Cell label="项目" :value="pay.title" />
          <Cell label="说明" :value="pay.sub" />
          <Cell label="订单号" :value="pay.payId" />
          <Cell label="创建时间" :value="pay.createdAt" />
          <Cell :label="paid ? '支付时间' : '有效期至'" :value="paid ? pay.paidAt : pay.expireAt" :last="true" />
        </view>

        <view v-if="pay.type === 'bill'" class="card">
          <view class="sec-hd"><text class="sec-hd__t">缴费明细</text><text class="sec-hd__d">{{ billRows.length }} 项</text></view>
          <view v-for="b in billRows" :key="b.billId" class="py__row">
            <view class="py__b">
              <text class="py__row-t">{{ b.itemName }}</text>
              <text class="py__row-d">{{ b.houseName || '车位' }} · {{ b.period }}</text>
            </view>
            <text class="py__row-v">{{ money(b.amount ?? b.unpaid) }}</text>
          </view>
          <view class="sum-row sum-row--total"><text class="sum-row__k">合计</text><text class="sum-row__v">{{ money(pay.amount) }}</text></view>
        </view>

        <view v-else-if="pay.type === 'wo'" class="card">
          <view class="sec-hd"><text class="sec-hd__t">费用明细</text><text class="sec-hd__d">下单即见价</text></view>
          <view class="sum-row"><text class="sum-row__k">材料费</text><text class="sum-row__v">{{ money(wo?.materialFee) }}</text></view>
          <view class="sum-row"><text class="sum-row__k">人工费</text><text class="sum-row__v">{{ money(wo?.laborFee) }}</text></view>
          <view v-if="wo?.addonFee" class="sum-row sum-row--addon"><text class="sum-row__k">现场增项（已确认）</text><text class="sum-row__v">{{ money(wo.addonFee) }}</text></view>
          <view v-if="wo?.paidAmount" class="sum-row"><text class="sum-row__k">本单已预付</text><text class="sum-row__v">{{ money(wo.paidAmount) }}</text></view>
          <view class="sum-row sum-row--total">
            <text class="sum-row__k">{{ wo?.paidAmount ? '本次应付（增项差额）' : '合计' }}</text>
            <text class="sum-row__v">{{ money(pay.amount) }}</text>
          </view>
        </view>

        <view v-else class="card">
          <view class="sec-hd"><text class="sec-hd__t">报名费</text><text class="sec-hd__d">活动费用</text></view>
          <view class="sum-row"><text class="sum-row__k">活动</text><text class="sum-row__v">{{ pay.title.replace(' · 报名费', '') }}</text></view>
          <view class="sum-row"><text class="sum-row__k">人数</text><text class="sum-row__v">{{ enroll?.people || 1 }} 人</text></view>
          <view class="sum-row sum-row--total"><text class="sum-row__k">合计</text><text class="sum-row__v">{{ money(pay.amount) }}</text></view>
          <text v-if="enroll?.fee" class="py__tip">单价 ¥{{ enroll.fee }}/人。取消报名按活动退款分档计算，可在「邻里 → 我的 → 我报名的」里操作。</text>
        </view>

        <view v-if="!paid" class="card">
          <view class="sec-hd"><text class="sec-hd__t">支付方式</text><text class="sec-hd__d"><text class="demo-tip">演示</text></text></view>
          <view class="opt is-active">
            <view class="py__wx"><text>微</text></view>
            <view class="opt__body"><text class="opt__t">微信支付</text><text class="opt__d">演示环境直接置为已支付，不发起真实扣款</text></view>
            <view class="opt__check" />
          </view>
          <text class="py__tip">真实接入：服务端 JSAPI 下单 → wx.requestPayment → 微信回调验签+幂等 → 才置已支付；前端不判断成功。</text>
        </view>

        <view v-if="paid" class="py__done">
          <view class="py__done-acts">
            <view v-if="wo" class="btn btn--primary" @tap="goWo"><text>查看报修进度</text></view>
            <view v-else-if="pay.type === 'activity'" class="btn btn--primary" @tap="goEnroll"><text>查看我的报名</text></view>
            <view class="btn btn--line" @tap="goBack"><text>{{ wo ? '返回首页' : pay.type === 'activity' ? '返回活动' : '返回账单' }}</text></view>
          </view>
        </view>
      </template>
    </view>

    <Bar v-if="pay && !paid" label="应付" :amount="money(pay.amount)" :hint="`${pay.payId} · ${pay.expireAt}`" okText="模拟支付成功" btn-id="pay-sim" @submit="onPay" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Cell from '@/components/Cell.vue'
import Empty from '@/components/Empty.vue'
import { billsOf, orderOf, payOrderOf, simulatePay } from '@/api/mp'
import { app } from '@/store/app'
import { amount, money } from '@/utils/format'
import { toastOk, toastErr } from '@/utils/ui'
import { gateLogin, gateOwner } from '@/utils/guard'

const payId = ref('')
const woId = ref('')
const tick = ref(0)

onLoad(o => {
  payId.value = o?.payId ? decodeURIComponent(o.payId) : ''
  woId.value = o?.woId ? decodeURIComponent(o.woId) : ''
  /**
   * 门禁按订单类型分：
   *   · 账单 / 报修 → 需要业主认证（钱是房上的）；
   *   · 活动报名费 → 只要登录（活动是社区公共内容，租客也能报）。
   */
  const p = payId.value ? payOrderOf(payId.value) : null
  if (p?.type === 'activity') {
    if (!gateLogin()) return
  } else if (!gateOwner('支付')) return
})

const pay = computed(() => {
  tick.value
  return payOrderOf(payId.value)
})
const paid = computed(() => pay.value?.status === '已支付')
const wo = computed(() => {
  tick.value
  if (pay.value?.type !== 'wo') return null
  return orderOf(pay.value.refId)
})
const typeText = computed(() => {
  const t = pay.value?.type
  return t === 'bill' ? '账单缴费' : t === 'activity' ? '活动报名费' : '报修付费'
})
const enroll = computed(() => {
  tick.value
  if (pay.value?.type !== 'activity') return null
  return app.enrollments.find(e => e.enrollId === pay.value.refId) || null
})
const billRows = computed(() => {
  tick.value
  if (!pay.value || pay.value.type !== 'bill') return []
  return pay.value.lines || billsOf(pay.value.billIds || [])
})

async function onPay() {
  try {
    await simulatePay(payId.value)
    tick.value++
    toastOk('支付成功（模拟）')
  } catch (e) {
    toastErr(e.message || '支付失败')
  }
}

function goWo() {
  const id = woId.value || pay.value?.refId
  uni.redirectTo({ url: `/pages/repair/detail?woId=${encodeURIComponent(id)}` })
}
function goBack() {
  if (wo.value) uni.reLaunch({ url: '/pages/home/index' })
  else if (pay.value?.type === 'activity') uni.navigateBack()
  else uni.navigateBack()
}
function goEnroll() {
  uni.redirectTo({ url: '/pages/neighbor/my?tab=enroll' })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 220rpx; }
.py__amt { text-align: center; padding: 38rpx 24rpx 30rpx; }
.py__amt-k { font-size: 23rpx; color: var(--biz-text-3); }
.py__amt .big { justify-content: center; margin-top: 10rpx; color: var(--biz-text-1); }
.py__amt .big.is-ok { color: var(--biz-accent-dark); }
.py__state { margin-top: 16rpx; display: inline-flex; align-items: center; gap: 8rpx; font-size: 21rpx; padding: 8rpx 18rpx; border-radius: 999rpx; }
.py__state.is-wait { background: #fff8f0; color: #a35c13; }
.py__state.is-ok { background: var(--biz-accent-light-9); color: var(--biz-accent-dark); }
.py__state-i { width: 28rpx; height: 28rpx; border-radius: 50%; color: #fff; font-size: 17rpx; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.py__state.is-wait .py__state-i { background: var(--biz-warning); }
.py__state.is-ok .py__state-i { background: var(--biz-accent); }
.py__row { display: flex; align-items: center; gap: 16rpx; padding: 14rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.py__row:last-of-type { border-bottom: none; }
.py__b { flex: 1; min-width: 0; }
.py__row-t { font-size: 25rpx; color: var(--biz-text-1); }
.py__row-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-4); }
.py__row-v { font-family: var(--biz-font-num); font-size: 25rpx; font-weight: 600; color: var(--biz-text-1); }
.py__wx { flex: none; width: 64rpx; height: 64rpx; border-radius: 16rpx; background: #e8f8ee; color: #0aa84f; font-size: 28rpx; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.py__tip { display: block; margin-top: 16rpx; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
.py__done-acts { display: flex; gap: 18rpx; margin-top: 20rpx; }
.py__done-acts .btn { flex: 1; }
</style>
