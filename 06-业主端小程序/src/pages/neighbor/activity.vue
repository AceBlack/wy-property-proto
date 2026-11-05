<!-- 活动详情 + 报名（报名需要实名，取消可自助） -->
<template>
  <view class="page">
    <NavBar title="活动详情" :subtitle="act?.type || ''" />
    <view class="body" :class="{ 'body--with-foot': !!act }">
      <Empty v-if="!act" text="活动不存在" />
      <template v-else>
        <Cover :cover="act.cover" h="320rpx" :badge="act.status" :label="act.type" />

        <view class="card av">
          <text class="av__t">{{ act.title }}</text>
          <view class="av__rows">
            <view class="av__r"><text class="av__k">时间</text><text class="av__v">{{ act.startAt }} ~ {{ act.endAt.slice(11) }}</text></view>
            <view class="av__r"><text class="av__k">地点</text><text class="av__v">{{ act.place }}</text></view>
            <view class="av__r"><text class="av__k">名额</text><text class="av__v">{{ act.enrolledCount }}/{{ act.capacity }}（剩 {{ act.left }}）</text></view>
            <view class="av__r"><text class="av__k">费用</text><text class="av__v">{{ act.fee > 0 ? `¥${act.fee}（线下收取）` : '免费' }}</text></view>
            <view class="av__r"><text class="av__k">发起</text><text class="av__v">{{ act.organizer }}</text></view>
          </view>
          <text class="av__d">{{ act.desc }}</text>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">报名须知</text></view>
          <text class="av__note">· 报名需实名（业主认证后自动带出姓名与房号），现场签到核对。</text>
          <text class="av__note">· 名额有限，报名后如不能参加请在「我的活动」里取消，把名额让给邻居。</text>
          <text class="av__note">· 收费活动由物业线下收取，小程序不做代收。</text>
        </view>
      </template>
    </view>

    <Bar
      v-if="act"
      :label="act.mine ? '已报名' : act.full ? '名额已满' : '名额'"
      :amount="act.mine ? '' : `剩 ${act.left} 位`"
      :hint="act.mine ? `报名时间 ${act.myEnroll?.at || ''}` : '报名需实名'"
      :okText="act.mine ? '取消报名' : act.full ? '已满' : '立即报名'"
      :disabled="!act.mine && (act.full || act.status === '已结束')"
      btn-id="act-enroll"
      @submit="toggle"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Cover from '@/components/Cover.vue'
import Empty from '@/components/Empty.vue'
import { activityOf } from '@/api/neighbor'
import { activeHouse } from '@/api/mp'
import { cancelEnroll, enroll } from '@/store/app'
import { toast, toastOk } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const id = ref('')
const ver = ref(0)
const act = computed(() => {
  ver.value
  return id.value ? activityOf(id.value) : null
})

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})
onShow(() => {
  ver.value++
})

function toggle() {
  if (!gateLogin()) return
  if (act.value.mine) {
    uni.showModal({
      title: '取消报名',
      content: '取消后名额将释放给其他邻居。',
      success: res => {
        if (!res.confirm) return
        cancelEnroll(id.value)
        ver.value++
        toast('已取消报名')
      }
    })
    return
  }
  const h = activeHouse()
  enroll(id.value, {
    ownerId: h ? '' : '',
    name: '',
    phone: '',
    houseShort: h?.shortName || '',
    people: 1
  })
  ver.value++
  toastOk('报名成功')
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 210rpx; }
.av { margin-top: 20rpx; }
.av__t { font-size: 32rpx; font-weight: 700; color: var(--biz-text-1); line-height: 1.4; }
.av__rows { margin-top: 16rpx; }
.av__r { display: flex; gap: 16rpx; padding: 8rpx 0; }
.av__k { width: 90rpx; font-size: 22rpx; color: var(--biz-text-3); }
.av__v { flex: 1; font-size: 23rpx; color: var(--biz-text-1); }
.av__d { display: block; margin-top: 16rpx; font-size: 24rpx; color: var(--biz-text-2); line-height: 1.7; }
.av__note { display: block; font-size: 22rpx; color: var(--biz-text-3); line-height: 1.75; }
</style>
