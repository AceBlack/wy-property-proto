<!--
  生活缴费（水电）—— 抄表出账 → 待缴账单 → 缴费
  ------------------------------------------------------------
  2026-11-13 改口径：预存账户下线，没有"余额"，也没有"充值"。
  页面按**项目模式**分三种长相（模式由 `communityUtility` 配，不是由有没有账单决定）：

    meter 抄表出账 → 用量 / 单价 / 应缴 / 账期 / 账单号 + 「去缴费」
    card  插卡买量 → 「插卡表 · 到物业服务中心买量」（无金额、无按钮）
    none  业主自缴 → 「由自来水公司 / 国家电网直接收取」（无金额、无按钮）

  把 card 当"待缴"，业主会在小程序里找不到缴费入口；给 none 加支付按钮，
  等于替国网代收 —— 这两种错都不会报错，只会被业主当成"系统坏了"。
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
          <text class="ut__hd-k">本期应缴</text>
          <view class="big"><text class="big__cur">¥</text><text class="big__num">{{ amount(u.dueTotal) }}</text></view>
          <text class="ut__hd-d">{{ payableText(u) }}</text>
          <text v-if="!u.payableCount" class="ut__hd-d">水电按抄表账单缴纳，缴费后不影响其他账单</text>
        </view>
        <view class="ut__sw" @tap="houseSheet = true"><text>切换房屋</text></view>
      </view>

      <view v-for="a in u.accounts" :key="a.itemId" class="card ut" :class="{ 'ut--off': !a.canPay }">
        <view class="ut__top">
          <view class="ut__ico" :style="{ background: a.canPay ? 'var(--biz-primary-light-9)' : 'var(--biz-bg-fill)', color: a.color }">
            <text>{{ a.icon }}</text>
          </view>
          <view class="ut__b">
            <text class="ut__t">{{ a.label }}</text>
            <text class="ut__d">{{ a.meterNo ? `户号 ${a.meterNo}` : '未登记远传表' }} · {{ a.modeLabel }}</text>
          </view>
          <Tag
            :text="a.canPay ? (a.billStatus || '待缴') : modeTag(a)"
            size="sm"
            :color="a.canPay ? 'var(--biz-warning)' : 'var(--biz-text-3)'"
          />
        </view>

        <!-- meter：把"这个数怎么来的"摆出来 -->
        <template v-if="a.canPay">
          <view class="ut__rows">
            <view class="ut__r"><text class="ut__k">本期用量</text><text class="ut__v">{{ a.usage }} {{ a.unit }}</text></view>
            <view class="ut__r"><text class="ut__k">单价</text><text class="ut__v">{{ a.price }} 元/{{ a.unit }}</text></view>
            <view class="ut__r"><text class="ut__k">应缴</text><text class="ut__v danger">{{ money(a.amount) }}</text></view>
            <view class="ut__r"><text class="ut__k">账期</text><text class="ut__v">{{ a.period }}</text></view>
          </view>
          <text v-if="a.readingText" class="ut__rd">读数 {{ a.readingText }}</text>
          <text class="ut__rd">账单号 {{ a.billId }}{{ a.unpaidCount > 1 ? ` · 还有 ${a.unpaidCount - 1} 期未缴` : '' }}</text>
          <!-- 用量 × 单价 与应缴**本应相等**（单价存的是该单实际执行的阶梯价）。
               不相等只有两种来由：挂了滞纳金，或已经减免 / 缴过一部分。
               这时才解释一句，其余情况不要挂着一行免责声明 —— 那是在替数据背锅。 -->
          <text v-if="gapNote(a)" class="ut__rd">{{ gapNote(a) }}</text>
          <view class="ut__acts">
            <view :id="`ut-pay-${a.itemId}`" class="btn btn--primary btn--sm" @tap="goPay(a)"><text>去缴费</text></view>
            <view class="btn btn--line btn--sm" @tap="go('/pages/bills/index', { tab: 'record' })"><text>缴费记录</text></view>
          </view>
        </template>

        <!-- card / none：说明白"这钱不在这儿交" -->
        <view v-else class="ut__note">
          <text class="ut__note-t">{{ modeNote(a) }}</text>
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

      <Empty v-if="loaded && !u.accounts.length" text="本房没有登记水电表" sub="户号可联系管家登记；账单仍按抄表出账" />

      <view class="ut__tip">
        <text class="demo-tip">演示</text>
        <text class="ut__tip-t">水电按抄表账单缴纳，缴费后不影响其他账单。真实接入要对接缴费平台或表厂，涉及销账对账，本轮不接。</text>
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
import { switchHouse } from '@/store/app'
import { activeHouse, myHouses } from '@/api/mp'
import { gasAccount, loadUtility, payableText, utilityLoaded, utilityOf } from '@/api/utility'
import { amount, money } from '@/utils/format'
import { go } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const houseSheet = ref(false)
const ver = ref(0)
const loaded = ref(false)

const houses = computed(() => {
  ver.value
  return myHouses()
})
const house = computed(() => {
  ver.value
  return activeHouse()
})
const u = computed(() => {
  ver.value
  return house.value ? utilityOf(house.value.houseId) : { dueTotal: 0, payableCount: 0, accounts: [] }
})
const gas = gasAccount()

const houseActions = computed(() =>
  houses.value.map(h => ({ label: h.fullName, desc: `${h.identity} · ${h.area}㎡`, value: h.houseId, active: h.houseId === house.value?.houseId }))
)

/**
 * 模式标签。三种"不可缴"要分开说，不能都写「待缴」：
 *   card → 插卡表（去物业买量）
 *   none → 自缴（国网/水司直收）
 *   meter 但没账单 → 已结清（这时写"待缴"却不给金额，业主会以为页面坏了）
 */
const modeTag = a => (a.mode === 'card' ? '插卡表' : a.mode === 'none' ? '自缴' : '已结清')
/* 说明文字直接用接口给的 modeLabel 起头，不再自己写死"自来水公司 / 国家电网" ——
   写死的话，电费卡上会出现"由自来水公司…"，一句话挂在两种表上总有一种是错的 */
const modeNote = a => {
  if (a.mode === 'card') return `${a.modeLabel}：系统不记录金额，物业不代收，小程序里无需缴费`
  if (a.mode === 'none') return `${a.modeLabel}，物业不代收，无需在小程序缴费`
  /* meter 且没有未缴账单 —— 不是"不在这儿交"，而是"现在没得交" */
  return '本期没有待缴账单；物业抄表出账后，这里会显示用量与应缴'
}

/**
 * 待缴与「用量 × 单价」为何不等 —— 只在真不等时才说一句。
 *
 * 数据侧已保证 `账单金额 = 用量 × 单价`（1327/1327），所以剩下的差额只有三种来由：
 * 滞纳金（加钱）、减免（减钱）、已缴一部分（待缴变小）。以前这里挂的是一句
 * 「单价为基准价，应缴含附加费或阶梯价，以账单金额为准」—— 那是替数据问题背锅，
 * 数据修好后它就是彻头彻尾的误导。
 */
const gapNote = a => {
  if (a.billAmount == null) return ''
  const gap = Math.round((Number(a.amount || 0) - Number(a.billAmount || 0)) * 100) / 100
  if (Math.abs(gap) <= 0.02) return ''
  if (gap > 0) return a.lateFee > 0 ? `含滞纳金 ${money(a.lateFee)}，应缴以账单为准` : `另有 ${money(gap)}，应缴以账单为准`
  return `已减免 ${money(-gap)}，应缴以账单为准`
}

onShow(async () => {
  if (!gateOwner('水电燃气缴费')) return
  try {
    if (house.value) await loadUtility(house.value.houseId)
  } catch (e) {
    /* 拉不到就让页面按空数据渲染，不弹错：这一屏挂了不该挡住"切换房屋" */
  }
  loaded.value = utilityLoaded()
  ver.value++
})

function onPickHouse(id) {
  switchHouse(id)
  ver.value++
}

const goPay = a => go('/pages/bills/detail', { id: a.billId })
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
.ut__sw { flex: none; font-size: 21rpx; color: var(--biz-primary); background: #fff; border-radius: 999rpx; padding: 8rpx 18rpx; }

.ut { margin-top: 20rpx; }
.ut__top { display: flex; align-items: center; gap: 16rpx; }
.ut__ico { flex: none; width: 72rpx; height: 72rpx; border-radius: 20rpx; display: flex; align-items: center; justify-content: center; font-size: 28rpx; font-weight: 700; color: var(--biz-text-3); }
.ut__b { flex: 1; min-width: 0; }
.ut__t { font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); }
.ut__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.ut__rows { display: flex; flex-wrap: wrap; margin-top: 16rpx; }
.ut__r { width: 50%; display: flex; gap: 10rpx; padding: 8rpx 0; }
.ut__k { font-size: 22rpx; color: var(--biz-text-3); }
.ut__v { font-size: 23rpx; color: var(--biz-text-1); font-family: var(--biz-font-num); }
.ut__rd { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-4); }
.ut__acts { display: flex; gap: 16rpx; margin-top: 18rpx; }
.ut__acts .btn { flex: 1; }
.ut__note { margin-top: 16rpx; padding: 16rpx 18rpx; border-radius: 14rpx; background: var(--biz-bg-fill); }
.ut__note-t { font-size: 21rpx; line-height: 1.6; color: var(--biz-text-3); }
.ut--off { opacity: 0.9; }

.ut__tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.ut__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
.danger { color: var(--biz-danger); }
</style>
