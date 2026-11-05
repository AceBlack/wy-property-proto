<template>
  <view class="page">
    <NavBar title="我的提成" :subtitle="`${s.month} · ${persona?.name || ''}`" />

    <view class="body">
      <!-- 口径先讲清楚：提成怎么算、什么时候发 -->
      <view class="hint">
        <text class="hint__t">只算人工费，收款后才结</text>
        <text class="hint__d">
          提成 = 人工费 × {{ Math.round(s.rate * 100) }}%（材料费是成本，不计提）。
          完工不算结，业主付了钱才算；未收款的部分挂在「在途」。
          返修、退单、挂账超期会冲减。
        </text>
      </view>

      <!-- 结算单：与工资表分开，避免"工资表已锁定、钱才到账"记不进去 -->
      <view class="card sheet-card">
        <view class="sheet-hd">
          <view class="sheet-hd__l">
            <text class="sheet-hd__t">{{ s.settleNo }}</text>
            <text class="sheet-hd__d">{{ s.month }} 结算单 · {{ s.settleDay }}</text>
          </view>
          <text class="sheet-hd__s">待并表</text>
        </view>

        <view class="nums">
          <view class="nums__i">
            <text class="nums__v num is-in">{{ money(s.settled) }}</text>
            <text class="nums__k">已结（{{ s.settledCount }} 单）</text>
          </view>
          <view class="nums__i">
            <text class="nums__v num is-wait">{{ money(s.pending) }}</text>
            <text class="nums__k">在途（{{ s.pendingCount }} 单）</text>
          </view>
          <view class="nums__i">
            <text class="nums__v num">{{ s.count }}</text>
            <text class="nums__k">本月完工</text>
          </view>
        </view>
      </view>

      <view class="sec-hd" style="margin: 6rpx 4rpx 14rpx">
        <text class="sec-hd__t">明细</text>
        <text class="sec-hd__d">按完工时间倒序 · 只列本人的单</text>
      </view>

      <view v-for="r in s.rows" :key="r.woId" :id="`cm-${r.woNo}`" class="row" @tap="openWo(r)">
        <view class="row__l">
          <view class="row__top">
            <text class="row__no num">{{ r.woNo }}</text>
            <text class="row__tag" :class="{ 'is-wait': !r.settled }">{{ r.settled ? '已结' : '在途' }}</text>
            <text v-if="r.addonTotal" class="row__tag is-ad">含增项 {{ money(r.addonTotal) }}</text>
          </view>
          <text class="row__c">{{ r.category }} · {{ r.doneAt ? r.doneAt.slice(5, 16) : '待确认' }}</text>
          <text class="row__d">人工费 {{ money(r.labor) }} × {{ Math.round(s.rate * 100) }}% · 单额 {{ money(r.total) }} · {{ r.payStatus }}</text>
        </view>
        <text class="row__v num" :class="{ 'is-wait': !r.settled }">{{ money(r.commission) }}</text>
      </view>

      <Empty v-if="!s.rows.length" text="本月还没有完工的收费单" sub="抢一单付费入户维修、完工并收款后，这里就会出现结算记录" />

      <view class="tail">
        <text>
          这张单是结算单，不是工资条：工资表是期间锁定的快照，发出去之后才收到的钱没处记，
          所以提成单独结算、次月随工资并入（工资表里会有一行「工单提成」）。
          金额有疑问找客服主管核对工单收款状态，不在手机上改数。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import { commissionSheet } from '@/api/wo'
import { money } from '@/utils/format'
import { app, persona } from '@/store/app'

const ver = ref(0)
const s = computed(() => (ver.value, commissionSheet(persona.value, '2026-10')))

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  ver.value++
})

function openWo(r) {
  uni.navigateTo({ url: `/pages/wo/detail?id=${r.woId}` })
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
  color: #a35c13;
  margin-bottom: 8rpx;
}

.hint__d {
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
}

.sheet-card {
  background: linear-gradient(135deg, #fff7ed 0%, #fff 72%);
  border: 2rpx solid #ffe2bd;
}

.sheet-hd {
  display: flex;
  align-items: flex-start;
  gap: 12rpx;
}

.sheet-hd__l {
  flex: 1;
  min-width: 0;
}

.sheet-hd__t {
  display: block;
  font-size: 30rpx;
  color: #a35c13;
  font-weight: 700;
}

.sheet-hd__d {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: #b8814a;
}

.sheet-hd__s {
  flex: none;
  font-size: 18rpx;
  color: #fff;
  background: var(--biz-warning);
  border-radius: 999rpx;
  padding: 3rpx 14rpx;
}

.nums {
  margin-top: 18rpx;
  display: flex;
  gap: 10rpx;
}

.nums__i {
  flex: 1;
  background: #fff;
  border-radius: 12rpx;
  padding: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.nums__v {
  font-size: 30rpx;
  color: var(--biz-text-1);
}

.nums__v.is-in {
  color: var(--biz-accent);
}

.nums__v.is-wait {
  color: #d97706;
}

.nums__k {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  background: #fff;
  border-radius: 18rpx;
  padding: 20rpx 22rpx;
  margin-bottom: 12rpx;
  box-shadow: var(--biz-shadow-card);
}

.row__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.row__top {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
}

.row__no {
  font-size: 22rpx;
  color: var(--biz-text-2);
}

.row__tag {
  font-size: 17rpx;
  color: var(--biz-accent);
  background: #eefbf4;
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.row__tag.is-wait {
  color: #a35c13;
  background: #fff7ed;
}

.row__tag.is-ad {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
}

.row__c {
  font-size: 24rpx;
  color: var(--biz-text-1);
}

.row__d {
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.row__v {
  flex: none;
  font-size: 30rpx;
  color: var(--biz-accent);
}

.row__v.is-wait {
  color: #d97706;
}

.tail {
  margin-top: 18rpx;
  padding: 0 8rpx 20rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
}
</style>
