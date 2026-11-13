<!--
  商业账户（2026-11-11）
  ------------------------------------------------------------
  **只读镜像**：积分与优惠券来自商业平台，物业这边只展示、不写它的账。
  刻意**不显示余额** —— 商业平台储值与物业预存是两笔钱，
  放一起业主就会问"能不能交物业费"，而答案是不能。
  券的领取与核销都在商业平台，这里的按钮只做引导。
-->
<template>
  <view class="page">
    <NavBar title="商业账户" :subtitle="acc ? `来自商业平台 · 更新于 ${acc.syncedAt.slice(5, 16)}` : '来自商业平台'" />

    <view class="body">
      <Empty v-if="!acc && !err" text="还没有开通商业账户" sub="在商业平台注册后，积分与优惠券会同步到这里" />
      <Empty v-else-if="err" text="商业账户加载失败" sub="退出重进可重试；不影响物业缴费与报修" />

      <template v-else>
        <!-- 积分与等级 -->
        <view class="cm__hd card">
          <view class="cm__hd-row">
            <text class="cm__k">可用积分</text>
            <Tag :text="acc.level" size="sm" color="var(--biz-warning)" />
          </view>
          <view class="big"><text class="big__num">{{ acc.points }}</text><text class="cm__unit">分</text></view>
          <view class="cm__bar">
            <view class="cm__bar-in" :style="{ width: progressPct + '%' }" />
          </view>
          <text class="cm__bar-d">
            距 {{ acc.levelNext }} 还差 {{ Math.max(0, acc.levelProgress.next - acc.levelProgress.current) }} 分
          </text>
          <text v-if="acc.pointsExpiring" class="cm__expire">
            {{ acc.pointsExpiring }} 分将于 {{ acc.pointsExpireAt }} 过期，记得先用
          </text>
        </view>

        <!-- 优惠券 -->
        <view class="sec-hd cm__sec">
          <text class="sec-hd__t">优惠券</text>
          <text class="sec-hd__d">{{ claimable }} 张可领 · {{ coupons.length }} 张</text>
        </view>

        <view v-for="c in coupons" :key="c.couponId" class="card cm__cp" :class="{ 'is-dead': c.status === '已过期' }">
          <view class="cm__cp-l">
            <view class="big"><text class="cm__cp-v">{{ cpFace(c) }}</text></view>
            <text class="cm__cp-th">{{ c.threshold > 0 ? `满 ${c.threshold} 可用` : '无门槛' }}</text>
          </view>
          <view class="cm__cp-b">
            <text class="cm__cp-t">{{ c.title }}</text>
            <text class="cm__cp-d">{{ c.scope }}</text>
            <text class="cm__cp-d">有效期 {{ c.validFrom.slice(5, 10) }} 至 {{ c.validTo.slice(5, 10) }}</text>
          </view>
          <view class="cm__cp-r">
            <view
              v-if="c.status === '可领取'"
              :id="`cp-${c.couponId}`"
              class="btn btn--primary btn--sm"
              @tap="claim(c)"
            ><text>去领取</text></view>
            <Tag v-else :text="c.status" size="sm" color="var(--biz-text-3)" />
          </view>
        </view>

        <Empty v-if="!coupons.length" text="暂时没有优惠券" sub="商业平台发券后会同步过来" />

        <text class="cm__foot">
          积分与优惠券由商业平台提供，仅供查看与领取引导：领取、使用与售后都在商业平台完成。
          这里的数字不能抵扣物业费、水费或车位费 —— 物业这边已经**没有余额**这回事了：
          水电按抄表账单缴，物业费按账期缴。
        </text>
      </template>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import { commerceAccount, commerceCoupons, commerceError, loadCommerce } from '@/api/commerce'
import { toastErr, toast } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const ver = ref(0)
const err = ref('')

const acc = computed(() => {
  ver.value
  return commerceAccount()
})
const coupons = computed(() => {
  ver.value
  return commerceCoupons()
})
const claimable = computed(() => coupons.value.filter(c => c.status === '可领取').length)
const progressPct = computed(() => {
  const p = acc.value?.levelProgress
  if (!p || !p.next) return 0
  return Math.min(100, Math.round((p.current / p.next) * 100))
})

/* 满减/免邮券显示金额，折扣券直接显示标题里的折扣 */
const cpFace = c => (c.type === '折扣' ? '折扣' : `¥${c.faceValue}`)

onShow(async () => {
  if (!gateOwner('商业账户')) return
  try {
    await loadCommerce()
    err.value = ''
  } catch (e) {
    err.value = commerceError() === 'err' ? 'err' : ''
  }
  ver.value++
})

/**
 * 领取在商业平台完成，物业端只做引导 ——
 * 这里不写任何状态：写了就等于替另一家公司记账，而且明天它对不上。
 */
function claim(c) {
  uni.showModal({
    title: '去商业平台领取',
    content: `${c.title}\n\n领取与使用都在商业平台，物业端只做展示。原型不打开外部链接。`,
    showCancel: false,
    confirmText: '知道了'
  })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.cm__hd { padding: 26rpx; }
.cm__hd-row { display: flex; align-items: center; justify-content: space-between; }
.cm__k { font-size: 22rpx; color: var(--biz-text-3); }
.cm__hd .big { margin-top: 8rpx; color: var(--biz-text-1); }
.cm__unit { font-size: 24rpx; color: var(--biz-text-3); margin-left: 6rpx; }
.cm__bar { height: 12rpx; border-radius: 999rpx; background: var(--biz-bg-fill); margin-top: 16rpx; overflow: hidden; }
.cm__bar-in { height: 100%; border-radius: 999rpx; background: linear-gradient(90deg, #ffcf6b, var(--biz-warning)); }
.cm__bar-d { display: block; margin-top: 8rpx; font-size: 20rpx; color: var(--biz-text-4); }
.cm__expire { display: block; margin-top: 10rpx; font-size: 20rpx; color: var(--biz-warning); }
.cm__sec { margin: 26rpx 0 14rpx; }
.cm__cp { display: flex; align-items: center; gap: 18rpx; padding: 20rpx 22rpx; margin-top: 14rpx; }
.cm__cp.is-dead { opacity: 0.6; }
.cm__cp-l { flex: none; width: 150rpx; text-align: center; }
.cm__cp-v { font-family: var(--biz-font-num); font-size: 34rpx; font-weight: 700; color: var(--biz-danger); }
.cm__cp-th { display: block; margin-top: 2rpx; font-size: 19rpx; color: var(--biz-text-4); }
.cm__cp-b { flex: 1; min-width: 0; }
.cm__cp-t { font-size: 26rpx; font-weight: 600; color: var(--biz-text-1); }
.cm__cp-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-4); }
.cm__cp-r { flex: none; }
.cm__foot { display: block; margin-top: 28rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.7; }
</style>
