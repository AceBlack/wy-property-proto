<!-- 认证 3/4 · 选择房间（按单元分组） -->
<template>
  <view class="page">
    <NavBar title="选择房间" :subtitle="`${flow.communityName} ${flow.buildingName}`" />
    <view class="body">
      <view v-for="g in groups" :key="g.unitId" class="ar__group">
        <text class="ar__unit">{{ g.unitName }}</text>
        <view class="ar__grid">
          <view
            v-for="r in g.rooms"
            :key="r.houseId"
            :id="`room-${r.houseId}`"
            class="ar__room"
            :class="{ 'is-on': flow.houseId === r.houseId }"
            @tap="pick(r)"
          >
            <text class="ar__room-t">{{ r.room }}</text>
            <text class="ar__room-d">{{ r.area }}㎡ · {{ r.houseType }}</text>
          </view>
        </view>
      </view>

      <Empty v-if="!groups.length" text="该楼栋暂无房号" />
    </view>

    <Bar :okText="flow.houseId ? '下一步' : '请选择房间'" :disabled="!flow.houseId" btn-id="room-next" @submit="next" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Empty from '@/components/Empty.vue'
import { roomList } from '@/api/mp'
import { flow } from '@/store/auth-flow'

const groups = ref([])

onLoad(() => {
  if (!flow.buildingId) {
    uni.redirectTo({ url: '/pages/auth/community' })
    return
  }
  groups.value = roomList(flow.buildingId)
})

function pick(r) {
  flow.houseId = r.houseId
  flow.houseName = r.fullName
}

function next() {
  if (!flow.houseId) return
  uni.navigateTo({ url: '/pages/auth/identity' })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); display: flex; flex-direction: column; }
.body { flex: 1; padding: 20rpx 28rpx 200rpx; }
.ar__group + .ar__group { margin-top: 28rpx; }
.ar__unit { display: block; font-size: 22rpx; color: var(--biz-text-3); margin-bottom: 14rpx; }
.ar__grid { display: flex; flex-wrap: wrap; gap: 14rpx; }
.ar__room {
  width: calc((100% - 28rpx) / 3);
  background: var(--biz-bg-card);
  border: 2rpx solid var(--biz-border-light);
  border-radius: 16rpx;
  padding: 18rpx 12rpx;
  text-align: center;
}
.ar__room.is-on { border-color: var(--biz-primary); background: var(--biz-primary-light-9); }
.ar__room-t { display: block; font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); font-family: var(--biz-font-num); }
.ar__room.is-on .ar__room-t { color: var(--biz-primary); }
.ar__room-d { display: block; margin-top: 4rpx; font-size: 18rpx; color: var(--biz-text-4); }
</style>
