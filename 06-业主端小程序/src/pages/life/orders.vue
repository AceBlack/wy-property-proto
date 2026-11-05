<!-- 我的订单（占位空态）：生活服务交易未开放 -->
<template>
  <view class="page">
    <NavBar title="我的订单" />
    <view class="body">
      <Empty text="还没有服务订单" sub="生活服务开通后，家政保洁、家电清洗等订单会出现在这里">
        <view class="lo__btn" @tap="goLife"><text>去看看服务</text></view>
      </Empty>
      <view class="lo__tip">
        <text class="demo-tip">占位</text>
        <text class="lo__tip-t">本轮只做骨架：下单、支付、售后、退款、评价都依赖商业后台，未开发前不产生订单。</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'

function goLife() {
  uni.switchTab({ url: '/pages/life/index' })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 50rpx; }
.lo__btn { margin-top: 20rpx; padding: 16rpx 36rpx; border-radius: 999rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); font-size: 24rpx; }
.lo__tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.lo__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
