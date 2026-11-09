<!--
  Tab 1 · 我的车位（批次 79）
  ------------------------------------------------------------
  为什么从首页 Sheet 升级成一页：车位要往下看两层（车辆 / 月租 / 换绑记录），
  Sheet 放不下，而且它是"资产"不是"快捷入口"——和账单一样值得有独立地址。
  入口仍在首页宫格与「我的」，两处都跳这里。
-->
<template>
  <view class="page">
    <NavBar title="我的车位" :subtitle="subtitle" />
    <view class="body">
      <Empty
        v-if="loaded && !list.length"
        text="名下暂无车位"
        sub="已购 / 已租车位由物业在车位台账登记，业主端不提供自助认领"
      />

      <view
        v-for="p in list"
        :key="p.parkId"
        :id="`park-${p.parkId}`"
        class="card pk"
        @tap="open(p)"
      >
        <view class="pk__hd">
          <text class="pk__no">{{ p.parkNo }}</text>
          <Tag :text="expOf(p).text" size="sm" :color="toneColor(expOf(p).tone)" />
        </view>
        <text class="pk__meta">
          {{ p.zone }} 区 · {{ p.category }} · {{ p.area }}㎡{{ p.chargePile ? ' · 充电桩' : '' }}
        </text>
        <view class="pk__ft">
          <text class="pk__plate">{{ plateOf(p) || '未绑车牌' }}</text>
          <text class="pk__v">{{ vehiclesOf(p.parkId).length }} 辆车 · 管理费 ¥{{ p.feeStandard }}/月</text>
        </view>
      </view>

      <view v-if="list.length" class="pk__tip">
        <text class="demo-tip">说明</text>
        <text class="pk__tip-t">
          车位归属以物业车位台账为准。换绑车牌每月每车位 {{ limit }} 次，业主可自助办理，
          不需要物业审核；第二辆车起请找管家登记。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import Tag from '@/components/Tag.vue'
import { PLATE_LIMIT, expiryOf, myParkings, plateOf, vehiclesOf } from '@/api/park'
import { identity } from '@/store/app'
import { go } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const loaded = ref(false)
const ver = ref(0)

const list = computed(() => {
  ver.value
  return myParkings()
})
const subtitle = computed(() => `${identity.value || '业主'} · ${list.value.length} 个车位`)
const limit = PLATE_LIMIT

const expOf = p => expiryOf(p)
const toneColor = tone =>
  tone === 'danger' ? 'var(--biz-danger)' : tone === 'warn' ? 'var(--biz-warning)' : 'var(--biz-text-3)'

function open(p) {
  go('/pages/park/detail', { parkId: p.parkId })
}

onLoad(() => {
  /* 直接输网址进来也要拦一道：车位信息只对已认证业主开放 */
  gateOwner('车位信息')
})

onShow(() => {
  /* 从换绑 / 预缴页回来要重算：两者都会改车牌与到期日 */
  ver.value++
  loaded.value = true
})
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.pk + .pk { margin-top: 20rpx; }
.pk__hd { display: flex; align-items: center; justify-content: space-between; }
.pk__no { font-size: 36rpx; font-weight: 700; color: var(--biz-text-1); font-family: var(--biz-font-num); }
.pk__meta { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--biz-text-3); }
.pk__ft { margin-top: 18rpx; padding-top: 18rpx; border-top: 2rpx solid var(--biz-border-light); display: flex; align-items: center; justify-content: space-between; }
.pk__plate { font-size: 26rpx; font-weight: 600; color: var(--biz-text-1); letter-spacing: 1rpx; }
.pk__v { font-size: 21rpx; color: var(--biz-text-3); }
.pk__tip { margin-top: 28rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.pk__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.7; }
</style>
