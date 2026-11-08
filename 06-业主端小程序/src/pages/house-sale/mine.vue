<!--
  我的挂牌（§13.7）
  ------------------------------------------------------------
  六个状态：待审核 / 已发布 / 已驳回 / 已下架 / 已过期 / 已成交。
  三条要点：
    · **驳回理由原样展示**（PC 强制填写，业主看得到那句），否则业主只能来问客服；
    · 60 天过期后可「一键续挂」——内容没改**不走二次审核**（`contentVersion === auditedVersion`）；
    · 浏览 / 看房数是业主自己的经营数据，只在这里出现，**不进对外接口**。
-->
<template>
  <view class="page">
    <NavBar title="我的挂牌" subtitle="业主本人发布" />
    <view class="body">
      <Empty v-if="!list.length" text="还没有挂牌" sub="发布后由本房责任楼管审核，通过才展示给看房的人">
        <view class="ms__btn" @tap="goPublish"><text>去发布</text></view>
      </Empty>

      <view v-for="l in list" :key="l.listingId" class="card ml">
        <view class="ml__hd">
          <text class="ml__t">{{ l.houseName }}</text>
          <text class="ml__st" :style="{ color: l.statusTone }">{{ l.status }}</text>
        </view>
        <view class="ml__meta">
          <text>¥{{ l.price }}/月 · {{ l.payTerm }} · 押金 {{ l.deposit }}</text>
          <text>{{ l.availableFrom }} 起</text>
        </view>

        <!-- 待审核：给预计时长，不能只写"提交成功" -->
        <view v-if="l.status === '待审核'" class="ml__wait">
          <text class="ml__wait-t">审核中 · 通常 24 小时内出结果</text>
          <text class="ml__wait-d">审核人是本房责任楼管（不是"审核员"角色）；超 24 小时会升到上级。</text>
        </view>

        <!-- 驳回理由：原样展示 -->
        <view v-if="l.status === '已驳回'" class="banner banner--offline ml__rej">
          <view class="banner__ico"><text>!</text></view>
          <text class="banner__t">驳回理由：{{ l.rejectReason || '（未填写，请联系客服）' }}</text>
        </view>
        <view v-if="l.status === '已下架' && l.offlineReason" class="ml__off">
          <text class="ml__off-t">下架原因：{{ l.offlineReason }}</text>
        </view>

        <view class="ml__stat">
          <view class="ml__s"><text class="ml__s-n">{{ l.viewCount }}</text><text class="ml__s-t">浏览</text></view>
          <view class="ml__s"><text class="ml__s-n">{{ l.leadCount }}</text><text class="ml__s-t">看房请求</text></view>
          <view class="ml__s"><text class="ml__s-n">{{ l.status === '已发布' ? '在架' : l.status === '已过期' ? '已过期' : '—' }}</text><text class="ml__s-t">当前</text></view>
        </view>

        <view class="ml__acts">
          <view v-if="l.canOffline" class="btn btn--sm btn--line" @tap="offline(l)">
            <text>{{ l.status === '待审核' ? '撤回' : '下架' }}</text>
          </view>
          <view v-if="l.canRenew" class="btn btn--sm btn--primary" @tap="renew(l)"><text>一键续挂</text></view>
          <view v-if="l.canDeal" class="btn btn--sm btn--line" @tap="deal(l)"><text>标记已成交</text></view>
          <view v-if="l.status === '已发布'" class="btn btn--sm btn--ghost" @tap="preview(l)"><text>预览</text></view>
        </view>
      </view>

      <view class="ml__tip">
        <text class="demo-tip">口径</text>
        <text class="ml__tip-t">
          挂牌 60 天自动过期。内容没改就直接续挂、免二次审核；改过价格 / 描述 / 图 / 装修配套
          才会重新进「待审核」—— 否则每 60 天全量重审一遍，楼管会被这种重复劳动逼疯。
          平台不代收租金、不收佣金，成交由业主与租客自行完成。
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
import { markDeal, myListings, offlineListing, renewListing } from '@/api/listing'
import { go, toast, toastOk, toastErr } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const ver = ref(0)
const list = computed(() => {
  ver.value
  return myListings()
})

onShow(() => {
  if (!gateOwner('我的挂牌')) return
  ver.value++
})

const goPublish = () => go('/pages/house-sale/publish')

function offline(l) {
  uni.showModal({
    title: l.status === '待审核' ? '撤回挂牌' : '下架挂牌',
    content: l.status === '待审核'
      ? '撤回后这条不再等审核，改完可以重新提交。'
      : '下架后看房的人看不到这套房；随时可以重新上架（内容没改免审）。',
    success: res => {
      if (!res.confirm) return
      try {
        offlineListing(l.listingId)
        ver.value++
        toast('已下架')
      } catch (e) {
        toastErr(e.message || '下架失败')
      }
    }
  })
}

function renew(l) {
  try {
    const r = renewListing(l.listingId)
    ver.value++
    toastOk(r.reAudit ? '已重新提交审核（内容有改动）' : '已重新上架（内容未改，免审）')
  } catch (e) {
    toastErr(e.message || '续挂失败')
  }
}

function deal(l) {
  uni.showModal({
    title: '标记已成交',
    content: '标记后房源从频道下架。成交价与租约不在小程序里记录（平台不参与成交）。',
    success: res => {
      if (!res.confirm) return
      try {
        markDeal(l.listingId)
        ver.value++
        toast('已标记成交')
      } catch (e) {
        toastErr(e.message || '操作失败')
      }
    }
  })
}

function preview(l) {
  go('/pages/house-sale/detail', { id: l.listingId })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 50rpx; }

.ml__hd { display: flex; align-items: flex-start; gap: 14rpx; }
.ml__t { flex: 1; font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.ml__st { flex: none; font-size: 21rpx; font-weight: 600; }
.ml__meta { display: flex; justify-content: space-between; margin-top: 10rpx; font-size: 20rpx; color: var(--biz-text-3); }

.ml__wait { margin-top: 14rpx; padding: 14rpx 16rpx; background: #fff8f0; border-radius: 12rpx; }
.ml__wait-t { font-size: 22rpx; font-weight: 600; color: #a35c13; }
.ml__wait-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: #8a5a1e; line-height: 1.5; }

.ml__rej { margin-top: 14rpx; }
.ml__off { margin-top: 12rpx; }
.ml__off-t { font-size: 21rpx; color: var(--biz-text-3); line-height: 1.5; }

.ml__stat { display: flex; margin-top: 16rpx; padding: 14rpx 0; background: var(--biz-bg-fill); border-radius: 14rpx; }
.ml__s { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2rpx; }
.ml__s-n { font-family: var(--biz-font-num); font-size: 28rpx; font-weight: 700; color: var(--biz-text-1); }
.ml__s-t { font-size: 19rpx; color: var(--biz-text-4); }

.ml__acts { display: flex; gap: 12rpx; margin-top: 16rpx; flex-wrap: wrap; }
.ms__btn { margin-top: 16rpx; padding: 14rpx 34rpx; border-radius: 999rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); font-size: 24rpx; }
.ml__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.ml__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
