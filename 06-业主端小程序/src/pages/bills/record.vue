<!-- 缴费记录详情：订单 + 逐账单明细（含房号，后台按房拆分入账） -->
<template>
  <view class="page">
    <NavBar title="缴费详情" />
    <view class="body">
      <Empty v-if="!pay" text="订单不存在" />
      <template v-else>
        <view class="card rr__hd">
          <text class="rr__t">{{ pay.status === '已支付' ? '缴费成功' : '待支付' }}</text>
          <view class="big"><text class="big__cur">¥</text><text class="big__num">{{ amount(pay.amount) }}</text></view>
          <text class="rr__d">{{ pay.payMethod || '微信支付（模拟）' }}</text>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">缴费明细</text><text class="sec-hd__d">{{ lines.length }} 项</text></view>
          <view v-for="l in lines" :key="l.billId" class="rr__row">
            <view class="rr__b">
              <text class="rr__n">{{ l.itemName }}</text>
              <text class="rr__d">{{ l.houseName }} · {{ periodText(l.period) }}</text>
            </view>
            <text class="rr__v">{{ money(l.amount) }}</text>
          </view>
        </view>

        <view class="card">
          <Cell label="订单编号" :value="pay.payId" />
          <Cell label="创建时间" :value="pay.createdAt" />
          <Cell label="支付时间" :value="pay.paidAt || '—'" />
          <Cell label="支付方式" :value="pay.payMethod || '微信支付（模拟）'" :last="true" />
        </view>

        <view class="rr__tip">
          <text class="demo-tip">演示</text>
          <text class="rr__tip-t">
            多房合并缴费时，一张订单对多张账单，每条明细都带房号 —— 后台按房拆分入账，
            对账 / 催缴 / 退费才不会串房。
          </text>
        </view>
      </template>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Cell from '@/components/Cell.vue'
import Empty from '@/components/Empty.vue'
import { billsOf, payOrderOf } from '@/api/mp'
import { amount, money, periodText } from '@/utils/format'

const payId = ref('')
const ver = ref(0)
const pay = computed(() => {
  ver.value
  return payOrderOf(payId.value)
})
const lines = computed(() => {
  ver.value
  if (!pay.value) return []
  if (pay.value.lines?.length) return pay.value.lines
  return billsOf(pay.value.billIds || []).map(b => ({
    billId: b.billId,
    itemName: b.itemName,
    houseName: b.houseName || '车位',
    period: b.period,
    amount: b.unpaid || b.payable
  }))
})

onLoad(o => {
  payId.value = o?.payId ? decodeURIComponent(o.payId) : ''
})
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 50rpx; }
.rr__hd { text-align: center; padding: 36rpx 24rpx 26rpx; }
.rr__t { font-size: 25rpx; color: var(--biz-text-3); }
.rr__hd .big { justify-content: center; margin-top: 10rpx; color: var(--biz-accent-dark); }
.rr__d { display: block; margin-top: 10rpx; font-size: 21rpx; color: var(--biz-text-4); }
.rr__row { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.rr__row:last-child { border-bottom: none; }
.rr__b { flex: 1; min-width: 0; }
.rr__n { font-size: 25rpx; color: var(--biz-text-1); }
.rr__d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-4); }
.rr__v { font-family: var(--biz-font-num); font-size: 25rpx; font-weight: 600; color: var(--biz-text-1); }
.rr__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.rr__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
