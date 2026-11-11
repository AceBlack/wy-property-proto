<!--
  便民缴费（水电燃气）
  ------------------------------------------------------------
  数据：meters（户号）+ meterReadings（本期用量）+ prepayAccounts（余额）
  燃气：mock 里没有表具，**如实标"未开通"**，不编一个燃气表出来。
  充值走模拟支付，只加余额，不接真实通道。
-->
<template>
  <view class="page">
    <NavBar title="生活缴费" :subtitle="house?.fullName || ''">
      <template #right>
        <text class="ut__nav" @tap="go('/pages/utility/accounts')">户号</text>
      </template>
    </NavBar>

    <view class="body">
      <view class="ut__hd">
        <view class="ut__hd-l">
          <text class="ut__hd-k">预存账户余额</text>
          <view class="big"><text class="big__cur">¥</text><text class="big__num">{{ amount(sum.prepay.balance) }}</text></view>
          <text class="ut__hd-d">可抵扣水费、电费与物业费 · 本期水电气应缴 {{ money(sum.due) }}</text>
          <text v-if="!sum.prepay.hasAccount" class="ut__hd-note">本房还未开通预存账户，充值后自动开通</text>
        </view>
        <view class="ut__sw" @tap="houseSheet = true"><text>切换房屋</text></view>
      </view>

      <view v-for="a in sum.accounts" :key="a.accountId" class="card ut">
        <view class="ut__top">
          <view class="ut__ico" :style="{ background: a.typeKey === 'power' ? '#fff4e6' : 'var(--biz-primary-light-9)', color: a.color }">
            <text>{{ a.icon }}</text>
          </view>
          <view class="ut__b">
            <text class="ut__t">{{ a.label }}</text>
            <text class="ut__d">户号 {{ a.meterNo }} · {{ a.price }} 元/{{ a.unit }}</text>
          </view>
          <Tag :text="a.due > 0 ? '本期待缴' : '本期已结清'" size="sm" :color="a.due > 0 ? 'var(--biz-warning)' : 'var(--biz-text-3)'" />
        </view>
        <view class="ut__rows">
          <view class="ut__r"><text class="ut__k">本期用量</text><text class="ut__v">{{ a.usage }} {{ a.unit }}</text></view>
          <view class="ut__r"><text class="ut__k">本期应缴</text><text class="ut__v danger">{{ money(a.due) }}</text></view>
          <view class="ut__r"><text class="ut__k">单价</text><text class="ut__v">{{ a.price }} 元/{{ a.unit }}</text></view>
          <view class="ut__r"><text class="ut__k">抄表日</text><text class="ut__v">{{ a.readDate || '—' }}</text></view>
        </view>
        <view class="ut__acts">
          <view :id="`ut-recharge-${a.accountId}`" class="btn btn--primary btn--sm" @tap="goRecharge()"><text>充值</text></view>
          <view class="btn btn--line btn--sm" @tap="tab = 'record'"><text>缴费记录</text></view>
        </view>
      </view>

      <!-- 燃气未开通 -->
      <view class="card ut ut--off">
        <view class="ut__top">
          <view class="ut__ico"><text>{{ gas.icon }}</text></view>
          <view class="ut__b">
            <text class="ut__t">{{ gas.label }}</text>
            <text class="ut__d">{{ gas.note }}</text>
          </view>
          <Tag :text="gas.status" size="sm" color="var(--biz-text-3)" />
        </view>
      </view>

      <Empty v-if="!sum.count" text="本房未安装远传表" sub="水电气仍按账单缴纳；户号可联系管家登记" />

      <view v-if="records.length" class="sec-hd ut__sec">
        <text class="sec-hd__t">最近充值</text>
        <text class="sec-hd__d">{{ records.length }} 笔</text>
      </view>
      <view v-for="r in records.slice(0, 5)" :key="r.payId" class="card ut__rec">
        <view class="ut__rec-b">
          <text class="ut__rec-t">{{ r.label }} 充值</text>
          <text class="ut__rec-d">{{ r.at }} · {{ r.meterNo || '预存账户' }}</text>
        </view>
        <text class="ut__rec-v">+{{ money(r.amount) }}</text>
      </view>

      <view class="ut__tip">
        <text class="demo-tip">演示</text>
        <text class="ut__tip-t">充值是往本房预存账户存钱（模拟支付），到账后可抵扣水费、电费与物业费账单。真实接入要对接缴费平台或表厂，涉及销账对账，本轮不接。</text>
      </view>
    </view>

    <ActionSheet v-model:show="houseSheet" title="切换房屋" :actions="houseActions" @select="onPickHouse" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import { app, switchHouse } from '@/store/app'
import { activeHouse, myHouses } from '@/api/mp'
import { accountsOf, gasAccount, utilityRecords, utilitySummary } from '@/api/utility'
import { amount, money } from '@/utils/format'
import { go, toast } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const houseSheet = ref(false)
const tab = ref('due')
const ver = ref(0)

const houses = computed(() => {
  ver.value
  return myHouses()
})
const house = computed(() => {
  ver.value
  return activeHouse()
})
const sum = computed(() => {
  ver.value
  return house.value
    ? utilitySummary(house.value.houseId)
    : { accounts: [], due: 0, count: 0, prepay: { balance: 0, hasAccount: false } }
})
const gas = gasAccount()
const records = computed(() => {
  ver.value
  return utilityRecords({ houseId: house.value?.houseId || '' })
})
const houseActions = computed(() =>
  houses.value.map(h => ({ label: h.fullName, desc: `${h.identity} · ${h.area}㎡`, value: h.houseId, active: h.houseId === house.value?.houseId }))
)

onShow(() => {
  if (!gateOwner('水电燃气缴费')) return
  ver.value++
})

function onPickHouse(id) {
  switchHouse(id)
  ver.value++
}
const goRecharge = () => go('/pages/utility/recharge')
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.ut__nav { font-size: 22rpx; color: var(--biz-primary); }
.body { padding: 20rpx 28rpx 50rpx; }

.ut__hd { display: flex; align-items: flex-start; gap: 16rpx; padding: 26rpx; border-radius: 22rpx; background: linear-gradient(135deg, #eef1ff, #f7f8ff); }
.ut__hd-l { flex: 1; min-width: 0; }
.ut__hd-k { font-size: 22rpx; color: var(--biz-text-3); }
.ut__hd .big { margin-top: 6rpx; color: var(--biz-text-1); }
.ut__hd-d { display: block; margin-top: 6rpx; font-size: 21rpx; color: var(--biz-text-3); }
.ut__hd-note { display: block; margin-top: 8rpx; font-size: 20rpx; color: var(--biz-warning); }
.ut__sw { flex: none; font-size: 21rpx; color: var(--biz-primary); background: #fff; border-radius: 999rpx; padding: 8rpx 18rpx; }

.ut { margin-top: 20rpx; }
.ut__top { display: flex; align-items: center; gap: 16rpx; }
.ut__ico { flex: none; width: 72rpx; height: 72rpx; border-radius: 20rpx; display: flex; align-items: center; justify-content: center; font-size: 28rpx; font-weight: 700; background: var(--biz-bg-fill); color: var(--biz-text-3); }
.ut__b { flex: 1; min-width: 0; }
.ut__t { font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); }
.ut__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.ut__rows { display: flex; flex-wrap: wrap; margin-top: 16rpx; }
.ut__r { width: 50%; display: flex; gap: 10rpx; padding: 8rpx 0; }
.ut__k { font-size: 22rpx; color: var(--biz-text-3); }
.ut__v { font-size: 23rpx; color: var(--biz-text-1); font-family: var(--biz-font-num); }
.ut__acts { display: flex; gap: 16rpx; margin-top: 18rpx; }
.ut__acts .btn { flex: 1; }
.ut--off { opacity: 0.86; }

.ut__sec { margin: 30rpx 0 14rpx; }
.ut__rec { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 22rpx; }
.ut__rec-b { flex: 1; min-width: 0; }
.ut__rec-t { font-size: 25rpx; color: var(--biz-text-1); }
.ut__rec-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-4); }
.ut__rec-v { font-family: var(--biz-font-num); font-size: 26rpx; font-weight: 700; color: var(--biz-accent-dark); }

.ut__tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.ut__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
.danger { color: var(--biz-danger); }
</style>
