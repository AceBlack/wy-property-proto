<!--
  认证结果 · 审核中 / 已通过 / 被拒绝
  ------------------------------------------------------------
  审核只兜"信息与系统录入不一致"这一种情况（正常匹配是秒过的）。
  真实环境由物业后台审核，业主端只读状态；这里的"模拟通过/拒绝"是演示按钮。
-->
<template>
  <view class="page">
    <NavBar title="房产认证" :back="false" />

    <view class="body">
      <view class="ap__ico" :class="`is-${state}`">
        <text>{{ state === 'approved' ? '✓' : state === 'rejected' ? '!' : '…' }}</text>
      </view>

      <text class="ap__t">{{ title }}</text>
      <text class="ap__d">{{ desc }}</text>

      <view v-if="summary.house" class="card ap__house">
        <text class="ap__house-t">{{ summary.house.fullName }}</text>
        <text class="ap__house-d">
          {{ summary.house.communityName }} · {{ summary.house.houseType }} · {{ summary.house.area }}㎡
        </text>
        <view class="ap__house-tags">
          <Tag :text="summary.identity || '业主'" size="sm" color="var(--biz-primary)" />
          <Tag v-if="summary.applicant?.proof" text="已上传证明材料" size="sm" color="var(--biz-accent-dark)" />
        </view>
      </view>

      <view v-if="summary.status === 'pending' && summary.applicant?.mismatch" class="banner banner--offline">
        <view class="banner__ico"><text>!</text></view>
        <text class="banner__t">待核验原因：{{ summary.applicant.mismatch }}</text>
      </view>

      <view v-if="summary.status === 'rejected'" class="banner banner--offline">
        <view class="banner__ico"><text>!</text></view>
        <text class="banner__t">{{ summary.reason }}</text>
      </view>

      <view class="ap__acts">
        <view v-if="summary.status === 'pending'" id="sim-approve" class="btn btn--primary" @tap="simApprove">
          <text>模拟物业审核通过（演示）</text>
        </view>
        <view v-if="summary.status === 'pending'" id="sim-reject" class="btn btn--line" @tap="simReject">
          <text>模拟审核不通过（演示）</text>
        </view>
        <view v-if="summary.status === 'approved'" class="btn btn--primary" @tap="goHome"><text>进入首页</text></view>
        <view v-if="summary.status === 'rejected'" class="btn btn--primary" @tap="reapply"><text>重新认证</text></view>
        <view class="btn btn--line" @tap="goHome"><text>先逛逛</text></view>
      </view>

      <view class="ap__note">
        <text class="ap__note-t">审核期间能做什么</text>
        <text class="ap__note-d">
          公告、邻里、生活服务都能看，公共区域报修也能提；
          缴费、个人报修、门禁要等审核通过 —— 钱和门不能先给。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Tag from '@/components/Tag.vue'
import { authSummary, boundHouseIds } from '@/api/mp'
import { app, approveReview, rejectReview } from '@/store/app'
import { toastOk } from '@/utils/ui'
import { HOME } from '@/utils/guard'

const tick = ref(0)
const summary = computed(() => {
  tick.value
  const s = authSummary()
  /* 审核通过后 applicant 被清空，这里回填已绑房的首套，页面才不会突然空白 */
  if (s.status === 'approved' && !s.house && boundHouseIds().length) {
    return { ...s, house: null }
  }
  return s
})

const state = computed(() => (summary.value.status === 'approved' ? 'approved' : summary.value.status === 'rejected' ? 'rejected' : 'pending'))
const title = computed(() =>
  state.value === 'approved' ? '认证通过' : state.value === 'rejected' ? '认证未通过' : '身份审核中'
)
const desc = computed(() => {
  if (state.value === 'approved') return '这套房已绑定到您的账号，现在可以缴费、报修、开门。'
  if (state.value === 'rejected') return '资料与物业登记不一致，请联系管家或到服务中心核验后重试。'
  return '资料已提交，物业会在 1-3 个工作日内完成核验，结果通过微信消息通知。'
})

onShow(() => {
  tick.value++
})

function simApprove() {
  approveReview({ ownerId: app.bindings[0]?.ownerId || '' })
  tick.value++
  toastOk('已模拟审核通过')
}

function simReject() {
  rejectReview()
  tick.value++
}

function goHome() {
  uni.reLaunch({ url: HOME })
}

function reapply() {
  uni.redirectTo({ url: '/pages/auth/community' })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 40rpx 28rpx 60rpx; display: flex; flex-direction: column; align-items: center; }
.ap__ico {
  width: 128rpx; height: 128rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 52rpx; font-weight: 700; color: #fff;
}
.ap__ico.is-pending { background: var(--biz-warning); }
.ap__ico.is-approved { background: var(--biz-accent); }
.ap__ico.is-rejected { background: var(--biz-danger); }
.ap__t { margin-top: 26rpx; font-size: 36rpx; font-weight: 700; color: var(--biz-text-1); }
.ap__d { margin-top: 12rpx; font-size: 23rpx; color: var(--biz-text-3); line-height: 1.6; text-align: center; max-width: 560rpx; }
.ap__house { width: 100%; margin-top: 30rpx; text-align: left; }
.ap__house-t { font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); }
.ap__house-d { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--biz-text-3); }
.ap__house-tags { display: flex; gap: 10rpx; margin-top: 12rpx; }
.ap__acts { width: 100%; margin-top: 34rpx; display: flex; flex-direction: column; gap: 16rpx; }
.ap__note { width: 100%; margin-top: 30rpx; padding: 20rpx 22rpx; background: var(--biz-bg-fill); border-radius: 14rpx; }
.ap__note-t { font-size: 22rpx; font-weight: 600; color: var(--biz-text-2); }
.ap__note-d { display: block; margin-top: 8rpx; font-size: 21rpx; color: var(--biz-text-3); line-height: 1.65; }
</style>
