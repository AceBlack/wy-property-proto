<!--
  预存账户充值（模拟支付）：选金额 → 确认 → 账户余额增加
  ------------------------------------------------------------
  为什么不是"给某块表充值"：数据里一个房只有一个预存账户（`prepayAccounts`），
  水、电、物业费都从这个账户抵扣。按表充值会让流水与账面各说各话。
-->
<template>
  <view class="page">
    <NavBar title="预存账户充值" :subtitle="house?.fullName || ''" />
    <view class="body">
      <Empty v-if="!house" text="未选择房屋" sub="先完成业主认证并绑定房产" />
      <template v-else>
        <view class="card rc__hd">
          <text class="rc__k">当前预存余额</text>
          <view class="big"><text class="big__cur">¥</text><text class="big__num">{{ amount(account.balance) }}</text></view>
          <text class="rc__d">可抵扣水费、电费与物业费账单 · 本期水电气应缴 {{ money(due) }}</text>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">充值金额</text><text class="sec-hd__d">单笔上限 5000 元</text></view>
          <view class="rc__amts">
            <view v-for="a in QUICK_AMOUNTS" :key="a" class="rc__amt" :class="{ 'is-on': amountVal === a }" @tap="amountVal = a">
              <text>{{ a }} 元</text>
            </view>
          </view>
          <view class="field">
            <view class="field__k"><text>其他金额</text></view>
            <input v-model="custom" class="field__input field__input--boxed" type="digit" placeholder="输入金额" placeholder-class="ph" />
          </view>
        </view>

        <view class="card">
          <Cell label="支付方式" value="微信支付（模拟）" :last="true" />
        </view>

        <view class="rc__tip">
          <text class="demo-tip">演示</text>
          <text class="rc__tip-t">点「确认充值」直接置为已支付并入预存账户，不发起真实扣款。真接入要对接缴费平台与表厂销账。</text>
        </view>
      </template>
    </view>

    <Bar v-if="house" label="充值" :amount="money(finalAmount)" hint="即时到账（模拟）" okText="确认充值" :disabled="finalAmount <= 0" btn-id="ut-pay" @submit="pay" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Cell from '@/components/Cell.vue'
import Empty from '@/components/Empty.vue'
import { activeHouse } from '@/api/mp'
import { QUICK_AMOUNTS, prepayOf, recharge, utilitySummary } from '@/api/utility'
import { amount, money } from '@/utils/format'
import { toastOk, toastErr } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const amountVal = ref(100)
const custom = ref('')
const ver = ref(0)

const house = computed(() => {
  ver.value
  return activeHouse()
})
const account = computed(() => {
  ver.value
  return house.value ? prepayOf(house.value.houseId) : { balance: 0, hasAccount: false }
})
const due = computed(() => {
  ver.value
  return house.value ? utilitySummary(house.value.houseId).due : 0
})
const finalAmount = computed(() => {
  const c = Number(custom.value)
  return c > 0 ? c : amountVal.value
})

onLoad(() => {
  gateOwner('水电燃气缴费')
})

function pay() {
  try {
    recharge({ houseId: house.value.houseId, amount: finalAmount.value })
    ver.value++
    toastOk(`充值成功 ${money(finalAmount.value)}`)
    setTimeout(() => uni.navigateBack(), 600)
  } catch (e) {
    toastErr(e.message || '充值失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); display: flex; flex-direction: column; }
.body { flex: 1; padding: 20rpx 28rpx 200rpx; }
.rc__hd { text-align: center; padding: 32rpx 24rpx 26rpx; }
.rc__k { font-size: 23rpx; color: var(--biz-text-3); }
.rc__hd .big { justify-content: center; margin-top: 8rpx; color: var(--biz-text-1); }
.rc__d { display: block; margin-top: 10rpx; font-size: 21rpx; color: var(--biz-text-4); }
.rc__amts { display: flex; flex-wrap: wrap; gap: 14rpx; }
.rc__amt { width: calc((100% - 28rpx) / 3); text-align: center; padding: 22rpx 0; border-radius: 16rpx; background: var(--biz-bg-fill); font-size: 27rpx; color: var(--biz-text-1); font-family: var(--biz-font-num); border: 2rpx solid transparent; }
.rc__amt.is-on { border-color: var(--biz-primary); background: var(--biz-primary-light-9); color: var(--biz-primary); font-weight: 700; }
.rc__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.rc__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
