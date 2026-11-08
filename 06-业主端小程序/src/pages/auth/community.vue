<!-- 认证 1/4 · 选择社区（设计稿：定位 + 搜索 + 附近社区） -->
<template>
  <view class="page">
    <NavBar title="选择小区" />
    <view class="body">
      <view class="ac__search">
        <input v-model="kw" class="ac__input" placeholder="搜索小区名称" placeholder-class="ph" />
      </view>

      <view class="ac__loc" @tap="toast('演示环境不取真实定位，默认成都')">
        <text class="ac__loc-k">当前位置</text>
        <text class="ac__loc-v">成都市 · 高新区</text>
        <text class="ac__loc-a">重新定位</text>
      </view>

      <text class="ac__sec">附近小区</text>
      <view
        v-for="c in list"
        :key="c.communityId"
        class="opt"
        :class="{ 'is-active': flow.communityId === c.communityId }"
        @tap="pick(c)"
      >
        <view class="opt__body">
          <text class="opt__t">{{ c.name }}</text>
          <text class="opt__d">{{ c.address }} · {{ c.houseCount }} 户</text>
        </view>
        <view class="opt__check" />
      </view>

      <view class="ac__tip">
        <text class="demo-tip">演示</text>
        <text class="ac__tip-t">在管项目共 3 个；正式环境按定位与城市检索。</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import { communityList } from '@/api/mp'
import { flow, resetFlow } from '@/store/auth-flow'
import { gateLogin } from '@/utils/guard'
import { toast } from '@/utils/ui'

const kw = ref('')
const all = ref([])
const list = computed(() => (kw.value ? all.value.filter(c => c.name.includes(kw.value)) : all.value))

onLoad(async () => {
  if (!gateLogin()) return
  resetFlow()
  /* 只有 3 条，但它是网络请求 —— 搜索框在这期间是可用的（筛空数组），
     等数据回来 computed 会自己重算，不需要 loading 遮挡 */
  all.value = await communityList()
})

function pick(c) {
  flow.communityId = c.communityId
  flow.communityName = c.name
  uni.navigateTo({ url: '/pages/auth/building' })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.ac__search { background: var(--biz-bg-card); border-radius: 16rpx; padding: 0 24rpx; height: 84rpx; display: flex; align-items: center; box-shadow: var(--biz-shadow-card); }
.ac__input { flex: 1; font-size: 27rpx; }
.ac__loc { display: flex; align-items: center; gap: 12rpx; padding: 26rpx 4rpx; }
.ac__loc-k { font-size: 22rpx; color: var(--biz-text-3); }
.ac__loc-v { flex: 1; font-size: 25rpx; color: var(--biz-text-1); font-weight: 500; }
.ac__loc-a { font-size: 22rpx; color: var(--biz-primary); }
.ac__sec { display: block; font-size: 22rpx; color: var(--biz-text-3); margin: 10rpx 0 14rpx; }
.ac__tip { margin-top: 28rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.ac__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
