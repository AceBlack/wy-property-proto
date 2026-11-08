<!-- 账单详情：费用明细（收费标准 × 数量 = 应收，优惠 / 违约金单列） -->
<template>
  <view class="page">
    <NavBar title="账单详情" :subtitle="bill?.period || ''" />
    <view class="body">
      <Empty v-if="!bill" text="账单不存在" />

      <template v-else>
        <view class="card bd__hd">
          <text class="bd__item">{{ bill.itemName }}</text>
          <view class="big" :class="{ danger: isDebt(bill) }">
            <text class="big__cur">¥</text>
            <text class="big__num">{{ amount(isDebt(bill) ? bill.unpaid : bill.payable) }}</text>
          </view>
          <view class="bd__tags">
            <Tag :text="billStateText(bill)" size="sm" :color="isDebt(bill) ? 'var(--biz-danger)' : 'var(--biz-accent-dark)'" />
            <Tag v-if="bill.isPark" text="车位费" size="sm" color="var(--biz-primary)" />
            <Tag :text="bill.period" size="sm" color="var(--biz-text-3)" />
          </view>
        </view>

        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">费用明细</text>
            <text class="sec-hd__d">计费规则由后台维护</text>
          </view>
          <Cell label="收费项目" :value="bill.itemName" />
          <Cell label="收费标准" :value="`${bill.price} ${bill.unit || ''}`" />
          <Cell label="计费数量" :value="`${bill.quantity}`" />
          <Cell label="应收金额" :value="money(bill.amount)" />
          <Cell v-if="bill.discount" label="优惠" :value="`-${money(bill.discount)}`" />
          <Cell v-if="bill.lateFee" label="违约金" :value="money(bill.lateFee)" />
          <Cell label="已缴" :value="money(bill.paidAmount)" />
          <Cell label="待缴" :value="money(bill.unpaid)" :strong="true" />
          <Cell label="应缴日" :value="bill.dueDate" :last="!bill.payTime" />
          <Cell v-if="bill.payTime" label="缴费时间" :value="`${bill.payTime} ${bill.payMethod || ''}`" :last="true" />
        </view>

        <view class="card">
          <Cell label="所属房屋" :value="bill.houseName || '车位（不挂房）'" />
          <Cell label="账期" :value="bill.period" />
          <Cell label="账单编号" :value="bill.billId" :last="true" />
        </view>

        <view class="bd__tip">
          <text class="demo-tip">说明</text>
          <text class="bd__tip-t">
            业主端只读与缴费，减免 / 作废 / 开票 / 退款都在后台与财务侧，业主端不提供入口。
            金额取 unpaid（部分缴过的只补差额），不是应收原值。
          </text>
        </view>
      </template>
    </view>

    <Bar v-if="bill && isDebt(bill)" label="待缴" :amount="money(bill.unpaid)" hint="生成待支付订单" okText="立即缴费" btn-id="bill-pay" @submit="pay" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Cell from '@/components/Cell.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import { createBillPay, isDebt, myBills } from '@/api/mp'
import { amount, billStateText, money } from '@/utils/format'
import { go, toastErr } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const id = ref('')
const ver = ref(0)
const bill = computed(() => {
  ver.value
  return myBills().find(b => b.billId === id.value) || null
})

onLoad(o => {
  if (!gateOwner('账单缴费')) return
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})
onShow(() => {
  ver.value++
})

async function pay() {
  try {
    const p = await createBillPay([id.value])
    go('/pages/pay/index', { payId: p.payId })
  } catch (e) {
    toastErr(e.message || '生成订单失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); display: flex; flex-direction: column; }
.body { flex: 1; padding: 20rpx 28rpx 200rpx; }
.bd__hd { text-align: center; padding: 34rpx 24rpx 28rpx; }
.bd__item { font-size: 25rpx; color: var(--biz-text-3); }
.bd__hd .big { justify-content: center; margin-top: 10rpx; color: var(--biz-text-1); }
.bd__tags { display: flex; justify-content: center; gap: 10rpx; margin-top: 16rpx; }
.bd__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.bd__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
.danger { color: var(--biz-danger) !important; }
</style>
