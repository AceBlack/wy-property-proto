<!--
  报事报修列表
  ------------------------------------------------------------
  两条线分开看：个人（入户，要业主认证）/ 公共（楼道、电梯、地库，登录即可报）。
  公共报修不校验产权 —— 这是"按需认证"的落地：公共区域跟房本无关。
-->
<template>
  <view class="page">
    <NavBar title="报事报修" :subtitle="house?.fullName || ''" />

    <view class="seg">
      <view v-for="t in TYPES" :key="t.key" class="seg__i" :class="{ 'is-on': scope === t.key }" @tap="scope = t.key">
        <text>{{ t.label }}</text>
      </view>
    </view>

    <view class="tabs">
      <view v-for="t in TABS" :key="t.key" class="tabs__i" :class="{ 'is-on': tab === t.key }" @tap="tab = t.key">
        <text>{{ t.label }}</text>
      </view>
    </view>

    <view class="body">
      <Empty v-if="!list.length" :text="scope === 'public' ? '暂无公共区域报修' : '还没有报修记录'" :sub="scope === 'public' ? '发现楼道、电梯、地库问题可以报一单' : '坏了别自己修，下单后师傅上门'" />

      <view v-for="w in list" :key="w.woId" class="card wo" @tap="goDetail(w.woId)">
        <view class="wo__hd">
          <Tag :text="w.isPublic ? '公共区域' : w.category" size="sm" :color="w.isPublic ? 'var(--biz-primary)' : 'var(--biz-text-3)'" />
          <text class="wo__status" :style="{ color: STATUS_TONE[w.status] || 'var(--biz-text-3)' }">{{ STATUS_TEXT[w.status] || w.status }}</text>
        </view>
        <text class="wo__t">{{ w.title }}</text>
        <text class="wo__d">{{ w.isPublic ? w.houseName : w.houseName }} · {{ w.createTime }}</text>

        <Progress :current="stageOf(w)" />

        <view class="wo__ft">
          <text class="wo__no">{{ w.woNo }}</text>
          <text v-if="w.totalFee" class="wo__fee">{{ money(w.totalFee) }}</text>
          <text v-if="w.pendingAddons?.length" class="wo__flag">待确认 {{ w.pendingAddons.length }} 项</text>
          <text v-else-if="w.dueFee > 0" class="wo__flag wo__flag--pay">待支付</text>
          <text v-else-if="w.status === '已完工' && !w.score" class="wo__flag">待评价</text>
        </view>
      </view>

      <view class="wo__tip">
        <text class="demo-tip">说明</text>
        <text class="wo__tip-t">
          个人报修与公共报修的差别在"钱"和"权"：个人入户按价目收费（下单即见价），
          公共区域免费、由物业指派，与产权无关，所以登录即可提。
        </text>
      </view>
    </view>

    <Bar :okText="scope === 'public' ? '报公共区域' : '我要报修'" btn-id="repair-new" @submit="newOrder" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import Progress from '@/components/Progress.vue'
import { activeHouse, myOrders, stageOf, STATUS_TEXT, STATUS_TONE } from '@/api/mp'
import { money } from '@/utils/format'
import { go } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const TYPES = [
  { key: 'personal', label: '个人报修' },
  { key: 'public', label: '公共区域' }
]
const TABS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待处理' },
  { key: 'doing', label: '处理中' },
  { key: 'done', label: '已完成' }
]

const scope = ref('personal')
const tab = ref('all')
const ver = ref(0)

const house = computed(() => {
  ver.value
  return activeHouse()
})
const list = computed(() => {
  ver.value
  let arr = myOrders({ scope: scope.value })
  if (tab.value === 'todo') arr = arr.filter(w => ['待派单', '已派单'].includes(w.status))
  if (tab.value === 'doing') arr = arr.filter(w => ['处理中', '待确认'].includes(w.status))
  if (tab.value === 'done') arr = arr.filter(w => ['已完工', '已评价', '已关闭', '已取消'].includes(w.status))
  return arr
})

onShow(() => {
  ver.value++
})

function newOrder() {
  if (scope.value === 'personal' && !gateOwner('个人报修')) return
  go('/pages/repair/create', { scope: scope.value })
}

const goDetail = woId => go('/pages/repair/detail', { woId })
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); display: flex; flex-direction: column; }
.seg { display: flex; margin: 10rpx 28rpx 0; background: var(--biz-bg-fill); border-radius: 14rpx; padding: 6rpx; }
.seg__i { flex: 1; text-align: center; padding: 14rpx 0; border-radius: 10rpx; font-size: 25rpx; color: var(--biz-text-3); }
.seg__i.is-on { background: #fff; color: var(--biz-text-1); font-weight: 600; box-shadow: var(--biz-shadow-card); }
.tabs { display: flex; gap: 26rpx; padding: 18rpx 28rpx 0; }
.tabs__i { padding: 8rpx 0 14rpx; font-size: 25rpx; color: var(--biz-text-3); position: relative; }
.tabs__i.is-on { color: var(--biz-text-1); font-weight: 700; }
.tabs__i.is-on::after { content: ''; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: 36rpx; height: 5rpx; border-radius: 3rpx; background: var(--biz-primary); }
.body { flex: 1; padding: 14rpx 28rpx 200rpx; }

.wo__hd { display: flex; align-items: center; gap: 12rpx; }
.wo__status { margin-left: auto; font-size: 21rpx; }
.wo__t { display: block; margin-top: 12rpx; font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.wo__d { display: block; margin-top: 6rpx; font-size: 21rpx; color: var(--biz-text-3); }
.wo :deep(.prog) { margin-top: 20rpx; }
.wo__ft { display: flex; align-items: center; gap: 14rpx; margin-top: 16rpx; flex-wrap: wrap; }
.wo__no { font-size: 20rpx; color: var(--biz-text-4); font-family: var(--biz-font-mono); }
.wo__fee { font-family: var(--biz-font-num); font-size: 24rpx; font-weight: 700; color: var(--biz-text-1); }
.wo__flag { font-size: 19rpx; color: var(--biz-warning); background: #fff8f0; border-radius: 6rpx; padding: 2rpx 10rpx; }
.wo__flag--pay { color: var(--biz-danger); background: #fff0f1; }
.wo__tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.wo__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
