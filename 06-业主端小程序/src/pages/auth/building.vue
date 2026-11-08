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
          <text class="opt__d">{{ b.unitCount }} 个单元 · {{ b.floorCount }} 层 · {{ b.houseCount }} 户</text>
        </view>
        <view class="opt__check" />
      </view>

      <Empty v-if="loaded && !list.length" text="该小区暂无可选楼栋" />
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
/* 接口模式下"空数组"有两种含义：还没回来 / 真的没有楼栋。
   不分开就会先闪一句"暂无可选楼栋"，再被数据填上 —— 用户看到的第一眼是假的 */
const loaded = ref(false)

onLoad(async () => {
  if (!flow.communityId) {
    uni.redirectTo({ url: '/pages/auth/community' })
    return
  }
  list.value = await buildingList(flow.communityId)
  loaded.value = true
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
