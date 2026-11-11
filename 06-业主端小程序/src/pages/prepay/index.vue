<!--
  我的预存账户
  ------------------------------------------------------------
  余额是**按房屋**的预收账款：能抵本房的物业费 / 水费 / 电费 / 车位费。
  多房业主有两个账户，所以页头永远带着房名 —— 不写房名，业主会以为是"总余额"。

  三个动作都在这一页完成：充值（首次即开户）、抵扣（按账期先还早的）、看流水。
  抵扣允许部分抵：余额只够一张的一部分时，账单变「部分缴」、差额留在账上，
  这是真实情况，不能装成"结清"。
-->
<template>
  <view class="page">
    <NavBar title="我的预存账户" :subtitle="acc.houseName || house?.fullName || ''" />

    <view class="body">
      <!-- 余额 -->
      <view class="card pp__hd">
        <view class="pp__hd-row">
          <text class="pp__k">可用余额</text>
          <Tag :text="acc.status" size="sm" :color="statusColor(acc.status)" />
        </view>
        <view class="big"><text class="big__cur">¥</text><text class="big__num">{{ amount(acc.balance) }}</text></view>
        <view class="pp__stats">
          <text class="pp__stat">累计充值 {{ money(acc.totalRecharge) }}</text>
          <text class="pp__stat">累计抵扣 {{ money(acc.totalDeduct) }}</text>
        </view>
        <text v-if="acc.status === '未开通'" class="pp__tip">
          还没有预存账户，充一笔就开通了 —— 以后每月账单可以直接从余额里抵
        </text>
      </view>

      <!-- 待抵账单 -->
      <view class="card pp__sec">
        <view class="sec-hd">
          <text class="sec-hd__t">待缴账单</text>
          <text class="sec-hd__d">{{ debt.count }} 张 · {{ money(debt.unpaid) }}</text>
        </view>
        <view v-for="(b, i) in debt.rows" :key="b.billId" class="pp__bill" :class="{ 'is-last': i === debt.rows.length - 1 }">
          <view class="pp__bill-b">
            <text class="pp__bill-t">{{ b.period }} · {{ b.itemName }}</text>
            <text class="pp__bill-d">{{ b.status }}</text>
          </view>
          <text class="pp__bill-v">{{ money(b.unpaid) }}</text>
        </view>
        <Empty v-if="!debt.count" text="本房没有待缴账单" sub="有账单时可以在这一页一键抵扣" />

        <view v-if="debt.count" class="pp__hint" :class="`is-${hint.kind}`">
          <text class="pp__hint-t">{{ hint.text }}</text>
        </view>
      </view>

      <!-- 充值 -->
      <view class="card pp__sec">
        <view class="sec-hd">
          <text class="sec-hd__t">充值</text>
          <text class="sec-hd__d">单笔上限 5000 元</text>
        </view>
        <view class="pp__amts">
          <view
            v-for="a in RECHARGE_AMOUNTS"
            :key="a"
            class="pp__amt"
            :class="{ 'is-on': !custom && amt === a }"
            @tap="pickAmount(a)"
          ><text>{{ a }} 元</text></view>
        </view>
        <view class="field">
          <view class="field__k"><text>其他金额</text></view>
          <input v-model="custom" class="field__input field__input--boxed" type="digit" placeholder="输入金额" placeholder-class="ph" />
        </view>
        <view class="pp__acts">
          <view id="prepay-recharge" class="btn btn--line" :class="{ 'is-disabled': !rechargeOk || busy }" @tap="doRecharge"><text>充值 {{ money(rechargeAmount) }}</text></view>
          <view
            id="prepay-deduct"
            class="btn btn--primary"
            :class="{ 'is-disabled': !deductEnabled || busy }"
            @tap="doDeduct"
          ><text>{{ deductLabel }}</text></view>
        </view>
        <text class="pp__note">
          充值走模拟支付，到账后即可抵扣账单。充值赠送、积分与礼包属于运营活动，
          规则确定后再上线（接口已预留，本期不产生任何赠送）。
        </text>
      </view>

      <!-- 流水 -->
      <view class="pp__sec">
        <view class="sec-hd">
          <text class="sec-hd__t">账户流水</text>
          <text class="sec-hd__d">{{ flows.length }} 笔</text>
        </view>
        <view v-for="f in flows" :key="f.logId" class="card pp__flow">
          <view class="pp__flow-b">
            <text class="pp__flow-t">{{ f.type }}<text v-if="f.remark"> · {{ f.remark }}</text></text>
            <text class="pp__flow-d">{{ f.at }}<text v-if="f.operator"> · {{ f.operator }}</text></text>
          </view>
          <view class="pp__flow-r">
            <text class="pp__flow-v" :class="{ 'is-out': f.type === '抵扣' }">
              {{ f.type === '抵扣' ? '-' : '+' }}{{ money(f.amount) }}
            </text>
            <text v-if="f.balanceAfter != null" class="pp__flow-a">余 {{ money(f.balanceAfter) }}</text>
          </view>
        </view>
        <Empty v-if="!flows.length" text="还没有流水" sub="充值或抵扣后会在这里留痕" />
      </view>

      <text class="pp__foot">
        预存余额只用于抵扣本房账单，不能提现、不能转给其他房屋；
        与商业平台的积分 / 优惠券是两套账户（后者在「我的 · 商业账户」里查看）。
      </text>
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
import {
  RECHARGE_AMOUNTS, deductHint, deductPrepay, loadPrepay,
  prepayAccount, prepayBills, prepayFlows, rechargePrepay
} from '@/api/prepay'
import { amount, money } from '@/utils/format'
import { confirm, toastErr, toastOk } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const ver = ref(0)
const busy = ref(false)
const amt = ref(500)
const custom = ref('')

const house = computed(() => {
  ver.value
  return activeHouse()
})
const acc = computed(() => {
  ver.value
  return prepayAccount()
})
const debt = computed(() => {
  ver.value
  return prepayBills()
})
const flows = computed(() => {
  ver.value
  return prepayFlows()
})
const hint = computed(() => {
  ver.value
  return deductHint()
})

const rechargeAmount = computed(() => {
  const c = Number(custom.value)
  return c > 0 ? c : amt.value
})
const rechargeOk = computed(() => rechargeAmount.value > 0 && rechargeAmount.value <= 5000)
const deductEnabled = computed(() => debt.value.count > 0 && acc.value.balance > 0 && acc.value.status !== '未开通')
const deductLabel = computed(() => {
  if (!debt.value.count) return '没有待缴账单'
  if (acc.value.status === '未开通') return '先充值开通'
  if (acc.value.balance <= 0) return '余额不足'
  return acc.value.balance >= debt.value.unpaid ? '用余额结清' : '用余额抵扣'
})

const statusColor = s =>
  s === '正常' ? 'var(--biz-accent-dark)'
    : s === '未开通' ? 'var(--biz-text-3)'
      : s === '冻结' ? 'var(--biz-warning)' : 'var(--biz-danger)'

onShow(async () => {
  if (!gateOwner('预存账户')) return
  try {
    await loadPrepay()
  } catch (e) {
    toastErr(e?.message || '账户信息加载失败')
  }
  ver.value++
})

function pickAmount(a) {
  amt.value = a
  custom.value = ''
}

async function doRecharge() {
  if (!rechargeOk.value || busy.value) return
  const v = rechargeAmount.value
  const ok = await confirm({
    title: '确认充值',
    content: `向本房预存账户充值 ${money(v)}（模拟支付，不发起真实扣款）`,
    okText: '确认充值'
  })
  if (!ok) return
  busy.value = true
  try {
    await rechargePrepay(v)
    custom.value = ''
    ver.value++
    toastOk(`已充值 ${money(v)}`)
  } catch (e) {
    toastErr(e?.message || '充值失败')
  } finally {
    busy.value = false
  }
}

async function doDeduct() {
  if (!deductEnabled.value || busy.value) return
  const bal = acc.value.balance
  const total = debt.value.unpaid
  const ok = await confirm({
    title: '用预存余额抵扣',
    content: bal >= total
      ? `余额 ${money(bal)} 足够结清本房待缴 ${money(total)}，按账期先还早的。`
      : `余额 ${money(bal)} 会按账期先还早的，抵到余额用完为止；剩下的 ${money(total - bal)} 仍需另行缴纳。`,
    okText: '确认抵扣'
  })
  if (!ok) return
  busy.value = true
  try {
    const r = await deductPrepay()
    ver.value++
    toastOk(`已抵扣 ${money(r.deducted)}`)
  } catch (e) {
    toastErr(e?.message || '抵扣失败')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.pp__hd { padding: 26rpx; }
.pp__hd-row { display: flex; align-items: center; justify-content: space-between; }
.pp__k { font-size: 22rpx; color: var(--biz-text-3); }
.pp__hd .big { margin-top: 8rpx; color: var(--biz-text-1); }
.pp__stats { display: flex; gap: 24rpx; margin-top: 10rpx; }
.pp__stat { font-size: 21rpx; color: var(--biz-text-4); }
.pp__tip { display: block; margin-top: 12rpx; font-size: 20rpx; color: var(--biz-warning); line-height: 1.6; }
.pp__sec { margin-top: 20rpx; padding: 22rpx 24rpx; }
.pp__bill { display: flex; align-items: center; justify-content: space-between; padding: 16rpx 0; border-bottom: 1rpx solid var(--biz-border-light); }
.pp__bill.is-last { border-bottom: none; }
.pp__bill-t { font-size: 25rpx; color: var(--biz-text-1); }
.pp__bill-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-4); }
.pp__bill-v { font-family: var(--biz-font-num); font-size: 25rpx; color: var(--biz-danger); }
.pp__hint { margin-top: 14rpx; padding: 12rpx 16rpx; border-radius: 12rpx; background: var(--biz-bg-fill); }
.pp__hint.is-ok { background: var(--biz-primary-light-9); }
.pp__hint.is-part { background: #fff6e8; }
.pp__hint.is-warn { background: #fff0f1; }
.pp__hint-t { font-size: 21rpx; color: var(--biz-text-2); }
.pp__amts { display: flex; flex-wrap: wrap; gap: 12rpx; margin-bottom: 16rpx; }
.pp__amt { padding: 14rpx 22rpx; border-radius: 14rpx; border: 2rpx solid var(--biz-border-light); background: #fff; font-size: 24rpx; color: var(--biz-text-2); }
.pp__amt.is-on { border-color: var(--biz-primary); background: var(--biz-primary-light-9); color: var(--biz-primary); font-weight: 600; }
.pp__acts { display: flex; gap: 16rpx; margin-top: 18rpx; }
.pp__acts .btn { flex: 1; }
.pp__note { display: block; margin-top: 14rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.65; }
.pp__flow { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 22rpx; margin-top: 12rpx; }
.pp__flow-b { flex: 1; min-width: 0; }
.pp__flow-t { font-size: 24rpx; color: var(--biz-text-1); }
.pp__flow-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-4); }
.pp__flow-r { text-align: right; }
.pp__flow-v { display: block; font-family: var(--biz-font-num); font-size: 26rpx; font-weight: 700; color: var(--biz-accent-dark); }
.pp__flow-v.is-out { color: var(--biz-danger); }
.pp__flow-a { display: block; margin-top: 2rpx; font-size: 19rpx; color: var(--biz-text-4); }
.pp__foot { display: block; margin-top: 26rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.7; }
.is-disabled { opacity: 0.45; }
</style>
