<!--
  活动详情（§12.2 第 6、7 条）
  ------------------------------------------------------------
  收费活动必须把三件事说清楚，缺一条就会在退款时吵架：
    1. **名额**（含成团下限：没到下限会流团，全额退）；
    2. **费用包含 / 不包含**（"为什么交了 180 还要买索道票"）；
    3. **退款分档**（提前几天退多少 —— 由活动自身配置，不是全局规则）。
  「待成行」是独立状态：已截止但没到成团下限，**不能报名、不能签到**。
-->
<template>
  <view class="page">
    <NavBar title="活动详情" :subtitle="a ? a.category : ''" />
    <view class="body" :class="{ 'body--with-foot': !!a }">
      <Empty v-if="!a" text="活动不存在" />

      <template v-else>
        <Cover :cover="a.cover" h="320rpx" :badge="a.feeType" :label="a.category" />

        <view class="card av">
          <view class="av__hd">
            <text class="av__t">{{ a.title }}</text>
            <text class="av__ph" :style="{ color: a.phaseTone }">{{ a.phase }}</text>
          </view>
          <view class="av__rows">
            <view class="av__r"><text class="av__k">时间</text><text class="av__v">{{ a.startAt }} ~ {{ a.endAt.slice(11) }}</text></view>
            <view class="av__r"><text class="av__k">地点</text><text class="av__v">{{ a.place }}</text></view>
            <view class="av__r"><text class="av__k">费用</text><text class="av__v">{{ a.fee > 0 ? `¥${a.fee}/人（成本分摊）` : '免费' }}</text></view>
            <view class="av__r"><text class="av__k">名额</text><text class="av__v">已报名 {{ a.enrolled }}/{{ a.capacity }}（剩 {{ a.left }}）</text></view>
            <view v-if="a.minCapacity" class="av__r">
              <text class="av__k">成团</text>
              <text class="av__v">
                {{ a.minCapacity }} 人成团
                <text v-if="a.phase === '待成行'" class="av__warn"> · 还差 {{ a.gap }} 人，未达下限</text>
                <text v-else-if="a.phase === '已成行'" class="av__ok"> · 已达成团人数</text>
                <text v-else-if="a.phase === '报名中'" class="av__ok"> · 还差 {{ a.gap }} 人成团，截止前都可报名</text>
              </text>
            </view>
            <view class="av__r"><text class="av__k">报名截止</text><text class="av__v">{{ a.enrollDeadline }}</text></view>
            <view class="av__r"><text class="av__k">发起</text><text class="av__v">{{ a.organizer }}</text></view>
          </view>
          <text class="av__d">{{ a.desc }}</text>
        </view>

        <!-- 收费活动：费用包含 / 不含 -->
        <view v-if="a.fee > 0" class="card">
          <view class="sec-hd"><text class="sec-hd__t">费用说明</text><text class="sec-hd__d">按成本分摊，不构成旅行社业务</text></view>
          <view class="av__fee-row">
            <text class="av__fee-k">已包含</text>
            <text class="av__fee-v">{{ a.feeInclude || '—' }}</text>
          </view>
          <view class="av__fee-row">
            <text class="av__fee-k">不包含</text>
            <text class="av__fee-v">{{ a.feeExclude || '—' }}</text>
          </view>
        </view>

        <!-- 退款分档 -->
        <view v-if="a.fee > 0" class="card">
          <view class="sec-hd"><text class="sec-hd__t">退款规则</text><text class="sec-hd__d">按取消当天距开始的天数</text></view>
          <view v-for="r in policy" :key="r.days" class="av__ref">
            <text class="av__ref-k">{{ r.label }}</text>
            <text class="av__ref-v">退 {{ r.ratio }}%</text>
          </view>
          <text v-if="!policy.length" class="av__note">本活动未配置分档：取消即全额退款。</text>
          <text class="av__note">流团（未达 {{ a.minCapacity || '—' }} 人下限）由物业确认后全额退款，不走上面分档。</text>
        </view>

        <!-- 报名须知 -->
        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">报名须知</text></view>
          <text class="av__note">· 每位报名人最多可带 {{ a.attendeeLimit }} 位出行人（含本人），需填姓名与手机号。</text>
          <text v-if="a.needInsurance" class="av__note">
            · 本活动为出行人购买当日意外险，需填身份证号；证件信息仅用于投保，活动结束后 30 天脱敏。
          </text>
          <text v-else class="av__note">· 本活动不投保，不收集证件号（少存一份就少一分风险）。</text>
          <text class="av__note">· 报名后可在「邻里 → 我的 → 我报名的」里取消，退款比例按上面的分档计算。</text>
          <text v-if="a.fee > 0" class="av__note">· 报名费在线支付（演示环境为模拟支付）；活动费开票走物业统一流程。</text>
        </view>

        <!-- 我的报名 -->
        <view v-if="a.myEnroll" class="card av__mine">
          <view class="sec-hd">
            <text class="sec-hd__t">我已报名</text>
            <text class="sec-hd__d">{{ a.myEnroll.people }} 人 · {{ a.myEnroll.at }}</text>
          </view>
          <view class="av__mr"><text class="av__mk">报名号</text><text class="av__mv">{{ a.myEnroll.enrollId }}</text></view>
          <view class="av__mr"><text class="av__mk">费用</text><text class="av__mv">{{ a.myEnroll.amount > 0 ? money(a.myEnroll.amount) : '免费' }}</text></view>
          <view class="av__mr">
            <text class="av__mk">支付</text>
            <text class="av__mv" :class="{ danger: a.myEnroll.payStatus === '待支付' }">{{ a.myEnroll.payStatus }}</text>
          </view>
          <view class="av__mr"><text class="av__mk">来源</text><text class="av__mv">{{ a.myEnroll.source || '业主自助' }}</text></view>
          <view v-if="a.myEnroll.payStatus === '待支付'" class="av__pay" @tap="payEnroll">
            <text>去支付 {{ money(a.myEnroll.amount) }}</text>
          </view>
        </view>
      </template>
    </view>

    <Bar
      v-if="a"
      :label="barLabel"
      :amount="barAmount"
      :hint="barHint"
      :okText="barOk"
      :disabled="barDisabled"
      btn-id="act-main"
      @submit="onMain"
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
import { activityOf, cancelActivityEnroll, myRefundOf } from '@/api/neighbor'
import { createActivityPay } from '@/api/mp'
import { policyRows } from '@/api/refund-rule.mjs'
import { money } from '@/utils/format'
import { go, toastErr } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const id = ref('')
const ver = ref(0)

const a = computed(() => {
  ver.value
  return id.value ? activityOf(id.value) : null
})
const policy = computed(() => policyRows(a.value?.refundPolicy || []))

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})
onShow(() => {
  ver.value++
})

const barLabel = computed(() => {
  const x = a.value
  if (!x) return ''
  if (x.mine) return x.myEnroll.payStatus === '待支付' ? '待支付' : '已报名'
  if (['待成行', '已成行', '已流团', '已结束'].includes(x.phase)) return x.phase
  return '名额'
})
const barAmount = computed(() => {
  const x = a.value
  if (!x) return ''
  if (x.mine) return x.myEnroll.amount > 0 ? money(x.myEnroll.amount) : '免费'
  if (x.phase === '报名中') return x.fee > 0 ? `¥${x.fee}/人` : '免费'
  return ''
})
const barHint = computed(() => {
  const x = a.value
  if (!x) return ''
  if (x.mine) return x.myEnroll.payStatus === '待支付' ? '报名费未付，名额先占着' : '可在「我报名的」里取消'
  if (x.phase === '报名中') return x.fee > 0 ? '按人数计费，报名后在线支付' : '免费活动，报名即可'
  if (x.phase === '待成行') return `已截止，还差 ${x.gap} 人成团`
  if (x.phase === '已成行') return '已达下限，报名已截止'
  if (x.phase === '已流团') return '未达成团人数，费用已全额退回'
  return '活动已结束'
})
const barOk = computed(() => {
  const x = a.value
  if (!x) return ''
  if (x.mine) return x.myEnroll.payStatus === '待支付' ? '去支付' : '取消报名'
  if (x.phase === '报名中') return x.left > 0 ? '立即报名' : '名额已满'
  if (x.phase === '待成行') return '等物业确认'
  if (x.phase === '已成行') return '报名已截止'
  if (x.phase === '已流团') return '已流团'
  return '已结束'
})
const barDisabled = computed(() => {
  const x = a.value
  if (!x) return true
  if (x.mine) return false
  return !(x.phase === '报名中' && x.left > 0)
})

function onMain() {
  const x = a.value
  if (!gateLogin()) return
  if (x.mine) {
    if (x.myEnroll.payStatus === '待支付') return payEnroll()
    return cancel()
  }
  if (x.phase !== '报名中' || x.left <= 0) return
  go('/pages/neighbor/activity-enroll', { id: x.activityId })
}

function payEnroll() {
  try {
    const p = createActivityPay(a.value.myEnroll.enrollId)
    go('/pages/pay/index', { payId: p.payId })
  } catch (e) {
    toastErr(e.message || '生成支付单失败')
  }
}

/** 取消：**先展示退款比例与金额**，再提交（§12.4） */
function cancel() {
  const x = a.value
  const { ratio, amount } = myRefundOf(x)
  if (x.fee <= 0) {
    uni.showModal({
      title: '取消报名',
      content: '取消后名额将释放给其他邻居。',
      confirmText: '取消报名',
      confirmColor: '#ec4d63',
      success: res => {
        if (!res.confirm) return
        doCancel()
      }
    })
    return
  }
  uni.showModal({
    title: '取消并退款',
    content: `按退款规则，当前可退 ${ratio}%，即 ${money(amount)}（已付 ${money(x.myEnroll.amount)}）。\n退款由物业按原路退回，演示环境不产生真实流水。`,
    confirmText: '确认取消',
    confirmColor: '#ec4d63',
    success: res => {
      if (!res.confirm) return
      doCancel()
    }
  })
}

async function doCancel() {
  try {
    const r = await cancelActivityEnroll(a.value.activityId)
    ver.value++
    uni.showToast({ title: r.refunded ? `已取消，按 ${r.ratio}% 可退 ¥${r.amount}` : '已取消报名', icon: 'none', duration: 2200 })
  } catch (e) {
    toastErr(e.message || '取消失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 210rpx; }

.av { margin-top: 20rpx; }
.av__hd { display: flex; align-items: flex-start; gap: 14rpx; }
.av__t { flex: 1; font-size: 32rpx; font-weight: 700; color: var(--biz-text-1); line-height: 1.4; }
.av__ph { flex: none; font-size: 22rpx; font-weight: 700; }
.av__rows { margin-top: 16rpx; }
.av__r { display: flex; gap: 16rpx; padding: 8rpx 0; }
.av__k { width: 130rpx; flex: none; font-size: 22rpx; color: var(--biz-text-3); }
.av__v { flex: 1; font-size: 23rpx; color: var(--biz-text-1); line-height: 1.5; }
.av__warn { color: var(--biz-warning); }
.av__ok { color: var(--biz-accent-dark); }
.av__d { display: block; margin-top: 16rpx; font-size: 24rpx; color: var(--biz-text-2); line-height: 1.7; }

.av__fee-row { display: flex; gap: 16rpx; padding: 8rpx 0; }
.av__fee-k { width: 110rpx; flex: none; font-size: 22rpx; color: var(--biz-text-3); }
.av__fee-v { flex: 1; font-size: 23rpx; color: var(--biz-text-1); line-height: 1.6; }

.av__ref { display: flex; align-items: center; justify-content: space-between; padding: 12rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.av__ref-k { font-size: 24rpx; color: var(--biz-text-2); }
.av__ref-v { font-family: var(--biz-font-num); font-size: 25rpx; font-weight: 700; color: var(--biz-text-1); }
.av__note { display: block; margin-top: 10rpx; font-size: 22rpx; color: var(--biz-text-3); line-height: 1.7; }

.av__mine { border: 2rpx solid var(--biz-primary-light-8); }
.av__mr { display: flex; gap: 16rpx; padding: 8rpx 0; }
.av__mk { width: 110rpx; font-size: 22rpx; color: var(--biz-text-3); }
.av__mv { flex: 1; font-size: 23rpx; color: var(--biz-text-1); }
.av__pay { margin-top: 16rpx; height: 76rpx; border-radius: 14rpx; background: var(--biz-primary); color: #fff; font-size: 25rpx; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.danger { color: var(--biz-danger) !important; }
</style>
