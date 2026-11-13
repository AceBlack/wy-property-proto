<!--
  户号管理：本房的水电户号（只读 + 可解除本地绑定，真实解除需物业核验）
  2026-11-13：这里**不再有余额**。预存账户体系已下线，水电按抄表账单缴纳，
  所以这一屏只回答"哪个户号、本期多少、单价多少、什么时候抄的表"。
-->
<template>
  <view class="page">
    <NavBar title="户号管理" :subtitle="house?.fullName" />
    <view class="body">
      <view v-for="a in accounts" :key="a.itemId" class="card ua">
        <view class="ua__hd">
          <view class="ua__ico"><text>{{ a.icon }}</text></view>
          <view class="ua__b">
            <text class="ua__t">{{ a.label }}</text>
            <text class="ua__d">户号 {{ a.meterNo }}</text>
          </view>
          <text class="ua__del" @tap="remove(a)">解除</text>
        </view>
        <view class="ua__rows">
          <text class="ua__r">{{ a.modeLabel }}</text>
          <text v-if="a.usage != null" class="ua__r">用量 {{ a.usage }} {{ a.unit }}</text>
          <text v-if="a.price != null" class="ua__r">{{ a.price }} 元/{{ a.unit }}</text>
          <text v-if="a.amount != null" class="ua__r">应缴 {{ money(a.amount) }}</text>
          <text v-if="a.period" class="ua__r">账期 {{ a.period }}</text>
        </view>
      </view>

      <Empty v-if="!accounts.length" text="本房没有登记远传表" sub="水电气仍按账单缴纳；需要登记户号请联系楼栋管家" />

      <view class="card ua__gas">
        <view class="ua__hd">
          <view class="ua__ico"><text>燃</text></view>
          <view class="ua__b">
            <text class="ua__t">燃气费</text>
            <text class="ua__d">{{ gas.note }}</text>
          </view>
          <Tag :text="gas.status" size="sm" color="var(--biz-text-3)" />
        </view>
      </view>

      <view class="ua__tip">
        <text class="demo-tip">说明</text>
        <text class="ua__tip-t">户号与表具按房绑定，只能由物业登记与解除；业主端解除只是本地隐藏，真实解绑要走后台（避免业主误删后重复缴费）。水电按抄表账单缴纳，这一屏不显示余额。</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import { activeHouse } from '@/api/mp'
import { gasAccount, loadUtility, utilityOf } from '@/api/utility'
import { money } from '@/utils/format'
import { toast } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const hidden = ref([])
const ver = ref(0)
const gas = gasAccount()
const house = computed(() => {
  ver.value
  return activeHouse()
})
const accounts = computed(() => {
  ver.value
  if (!house.value) return []
  return utilityOf(house.value.houseId).accounts.filter(a => !hidden.value.includes(a.meterNo))
})

onShow(async () => {
  if (!gateOwner('户号管理')) return
  try {
    if (house.value) await loadUtility(house.value.houseId)
  } catch (e) { /* 拉不到就按空渲染 */ }
  ver.value++
})

function remove(a) {
  uni.showModal({
    title: '解除户号',
    content: `确定解除「${a.label} ${a.meterNo}」？解除后本房不再显示该户号。`,
    success: res => {
      if (!res.confirm) return
      hidden.value.push(a.meterNo)
      toast('已解除（演示态：真实环境需物业复核）')
    }
  })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 50rpx; }
.ua { padding: 22rpx 24rpx; }
.ua__hd { display: flex; align-items: center; gap: 16rpx; }
.ua__ico { flex: none; width: 68rpx; height: 68rpx; border-radius: 18rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); display: flex; align-items: center; justify-content: center; font-size: 26rpx; font-weight: 700; }
.ua__b { flex: 1; min-width: 0; }
.ua__t { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.ua__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.ua__del { font-size: 21rpx; color: var(--biz-danger); }
.ua__rows { display: flex; gap: 20rpx; margin-top: 14rpx; flex-wrap: wrap; }
.ua__r { font-size: 21rpx; color: var(--biz-text-3); }
.ua__gas { margin-top: 20rpx; padding: 22rpx 24rpx; }
.ua__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.ua__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
