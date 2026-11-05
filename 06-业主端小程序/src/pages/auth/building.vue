<!-- 认证 2/4 · 选择楼栋 -->
<template>
  <view class="page">
    <NavBar title="选择楼栋" :subtitle="flow.communityName" />
    <view class="body">
      <view class="ab__crumb">
        <text class="ab__crumb-t">{{ flow.communityName }}</text>
        <text class="ab__crumb-a" @tap="back2">切换小区</text>
      </view>

      <view v-for="b in list" :key="b.buildingId" class="opt" @tap="pick(b)">
        <view class="opt__body">
          <text class="opt__t">{{ b.name }}</text>
          <text class="opt__d">{{ b.unitList.length }} 个单元 · {{ b.floorCount }} 层 · {{ b.houseCount }} 户</text>
        </view>
        <view class="opt__check" />
      </view>

      <Empty v-if="!list.length" text="该小区暂无可选楼栋" />
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import { buildingList } from '@/api/mp'
import { flow } from '@/store/auth-flow'

const list = ref([])

onLoad(() => {
  if (!flow.communityId) {
    uni.redirectTo({ url: '/pages/auth/community' })
    return
  }
  list.value = buildingList(flow.communityId)
})

function pick(b) {
  flow.buildingId = b.buildingId
  flow.buildingName = b.name
  uni.navigateTo({ url: '/pages/auth/room' })
}

function back2() {
  uni.navigateBack()
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.ab__crumb { display: flex; align-items: center; justify-content: space-between; padding: 8rpx 4rpx 20rpx; }
.ab__crumb-t { font-size: 25rpx; color: var(--biz-text-2); font-weight: 600; }
.ab__crumb-a { font-size: 22rpx; color: var(--biz-primary); }
</style>
