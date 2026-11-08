<!--
  邻里 · 我的（§12.2 第 8 条）
  ------------------------------------------------------------
  三块：我发布的 / 我报名的 / 我投的。
  对应后台按"户"统计的工作台，业主侧也要有同样的入口 —— 否则业主发完就找不到了。

  三处必须照口径做：
    · 「审核中」= 员工端还没审，要给**预计时长**，不能只写"提交成功"（业主第二天看不到会以为发丢了）；
    · **驳回理由原样展示**（员工端接口强制必填），否则业主只能来问客服；
    · 取消收费活动报名时，**先展示分档比例与金额**再提交，与客服帮退用同一个函数。
-->
<template>
  <view class="page">
    <NavBar title="我的邻里" />
    <view class="tabs">
      <view v-for="t in TABS" :key="t.key" :id="`mytab-${t.key}`" class="tabs__i" :class="{ 'is-on': tab === t.key }" @tap="tab = t.key">
        <text>{{ t.label }}</text>
        <text v-if="countOf(t.key)" class="tabs__n">{{ countOf(t.key) }}</text>
      </view>
    </view>

    <view class="body">
      <!-- 我发布的 -->
      <template v-if="tab === 'item'">
        <Empty v-if="!items.length" text="还没有发布过闲置" sub="发一条试试，审核通过后邻居就能看到">
          <view class="my__btn" @tap="goPublish"><text>去发布</text></view>
        </Empty>

        <view v-for="i in items" :key="i.itemId" class="card it">
          <view class="it__hd">
            <text class="it__t">{{ i.title }}</text>
            <text class="it__st" :style="{ color: statusTone(i.status) }">{{ i.status }}</text>
          </view>
          <view class="it__meta">
            <text>{{ i.category }} · {{ i.condition }} · {{ i.price > 0 ? `¥${i.price}` : '免费送' }}</text>
            <text>{{ i.views }} 浏览 · {{ i.wantCount }} 想要</text>
          </view>

          <view v-if="i.status === '待审核'" class="it__wait">
            <text class="it__wait-t">审核中 · 通常 24 小时内出结果</text>
            <text class="it__wait-d">由员工端（客服 / 楼管）审核，不是发完就上架。</text>
          </view>

          <view v-if="i.status === '已驳回'" class="banner banner--offline it__rej">
            <view class="banner__ico"><text>!</text></view>
            <text class="banner__t">驳回理由：{{ i.rejectReason || '（未填写，请联系客服）' }}</text>
          </view>

          <view class="it__acts">
            <view v-if="i.status === '待审核'" class="btn btn--sm btn--line" @tap="simAudit(i, true)"><text>模拟通过（演示）</text></view>
            <view v-if="i.status === '待审核'" class="btn btn--sm btn--line" @tap="openReject(i)"><text>模拟驳回（演示）</text></view>
            <view v-if="i.status === '已上架'" class="btn btn--sm btn--line" @tap="offline(i)"><text>下架</text></view>
            <view v-if="['已驳回', '已下架'].includes(i.status)" class="btn btn--sm btn--primary" @tap="renew(i)"><text>重新提交</text></view>
            <view class="btn btn--sm btn--ghost" @tap="goItem(i.itemId)"><text>查看</text></view>
          </view>
        </view>
      </template>

      <!-- 我报名的 -->
      <template v-else-if="tab === 'enroll'">
        <Empty v-if="!enrolls.length" text="还没有报名活动" sub="去「活动」看看，报名后可在这里取消">
          <view class="my__btn" @tap="goActivityTab"><text>去看活动</text></view>
        </Empty>

        <view v-for="e in enrolls" :key="e.enrollId" class="card en">
          <view class="en__hd">
            <text class="en__t">{{ e.activityTitle || e.activity?.title }}</text>
            <text class="en__st">{{ e.status }}</text>
          </view>
          <view class="en__meta">
            <text>{{ (e.activityStart || '').slice(0, 16) }} · {{ e.people }} 人</text>
            <text v-if="e.amount > 0">{{ money(e.amount) }} · {{ e.payStatus }}</text>
            <text v-else>免费</text>
          </view>
          <view class="en__tag">
            <!-- 别人帮报的会标「前台代报」，业主才不会以为系统被人动了（§12.7 第 3 条） -->
            <Tag :text="e.source || '业主自助'" size="sm" :color="e.source === '前台代报' ? 'var(--biz-warning)' : 'var(--biz-accent-dark)'" />
            <Tag v-if="e.activity" :text="e.activity.phase" size="sm" color="var(--biz-text-3)" />
            <text v-if="e.refundRatio != null" class="en__ref">按 {{ e.refundRatio }}% 可退 {{ money(e.refundAmount) }}</text>
          </view>
          <view class="en__acts">
            <view v-if="e.payStatus === '待支付' && e.amount > 0" class="btn btn--sm btn--primary" @tap="payEnroll(e)"><text>去支付</text></view>
            <view v-if="e.canCancel" class="btn btn--sm btn--line" @tap="cancelEnroll(e)"><text>取消报名</text></view>
            <view class="btn btn--sm btn--ghost" @tap="goActivity(e.activityId)"><text>活动详情</text></view>
          </view>
        </view>
      </template>

      <!-- 我投的 -->
      <template v-else>
        <Empty v-if="!myVotes.length" text="还没有参与过投票" sub="投票只做意见征询，不构成业主共同决定">
          <view class="my__btn" @tap="goVoteTab"><text>去投票</text></view>
        </Empty>

        <view v-for="v in myVotes" :key="v.surveyId" class="card vo" @tap="goVote(v.surveyId)">
          <view class="vo__hd">
            <text class="vo__t">{{ v.title }}</text>
            <text class="vo__st" :class="{ 'is-end': v.status === '已结束' }">{{ v.status }}</text>
          </view>
          <view class="vo__my">
            <text class="vo__k">我的选择</text>
            <text class="vo__v">{{ labelsOf(v) }}</text>
          </view>
          <view class="vo__foot">
            <text>{{ v.partRateText }}</text>
            <text class="vo__a">看结果</text>
          </view>
        </view>

        <view class="my__note">
          <text class="demo-tip">说明</text>
          <text class="my__note-t">投票结果是意见征询，用于改进服务；不产生《民法典》278 条的效力，页面不出现「通过 / 未通过」。</text>
        </view>
      </template>
    </view>

    <!-- 驳回理由 -->
    <Sheet v-model:show="rejectSheet" title="模拟驳回" sub="员工端驳回必须写理由，业主端原样展示">
      <textarea v-model="rejectReason" class="textarea my__text" maxlength="60" placeholder="例如：照片拍到了门牌号，请重拍室内" placeholder-class="ph" />
      <view id="reject-submit" class="btn btn--primary my__submit" @tap="doReject"><text>确认驳回</text></view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import Sheet from '@/components/Sheet.vue'
import {
  cancelActivityEnroll,
  demoAuditItem,
  myEnrollments,
  myItems,
  myRefundOf,
  myVoteIds,
  offlineMyItem,
  renewMyItem,
  voteOf
} from '@/api/neighbor'
import { createActivityPay } from '@/api/mp'
import { app } from '@/store/app'
import { money } from '@/utils/format'
import { go, toast, toastOk, toastErr } from '@/utils/ui'

const TABS = [
  { key: 'item', label: '我发布的' },
  { key: 'enroll', label: '我报名的' },
  { key: 'vote', label: '我投的' }
]

const tab = ref('item')
const ver = ref(0)
const rejectSheet = ref(false)
const rejectReason = ref('')
const rejectTarget = ref('')

const items = computed(() => {
  ver.value
  return myItems()
})
const enrolls = computed(() => {
  ver.value
  return myEnrollments()
})
const myVotes = computed(() => {
  ver.value
  return myVoteIds().map(id => voteOf(id)).filter(Boolean)
})

const countOf = key => {
  if (key === 'item') return items.value.length
  if (key === 'enroll') return enrolls.value.length
  return myVotes.value.length
}

const statusTone = s =>
  s === '已上架' ? 'var(--biz-accent-dark)'
    : s === '待审核' ? 'var(--biz-warning)'
      : s === '已驳回' ? 'var(--biz-danger)' : 'var(--biz-text-3)'

const labelsOf = v => {
  const picked = v.myVote || []
  return picked.map(k => v.options.find(o => o.key === k)?.label || k).join('；') || '—'
}

onLoad(o => {
  if (o?.tab && TABS.some(t => t.key === o.tab)) tab.value = o.tab
})
onShow(() => {
  ver.value++
})

const goPublish = () => go('/pages/neighbor/item-publish')
const goItem = id => go('/pages/neighbor/secondhand', { id })
const goActivity = id => go('/pages/neighbor/activity', { id })
const goVote = id => go('/pages/neighbor/vote', { id })
/* 从「我的邻里」直接进来时没有上一页：回邻里频道，不要留在一个点了没反应的按钮上 */
const backToNeighbor = tab => {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else {
    uni.switchTab({ url: '/pages/neighbor/index' })
    setTimeout(() => uni.$emit('neighbor-tab', tab), 150)
  }
}
const goActivityTab = () => backToNeighbor('activity')
const goVoteTab = () => backToNeighbor('vote')

function simAudit(i, pass) {
  try {
    demoAuditItem(i.itemId, pass)
    ver.value++
    toastOk(pass ? '已模拟通过，内容已上架' : '已驳回')
  } catch (e) {
    toastErr(e.message || '操作失败')
  }
}

function openReject(i) {
  rejectTarget.value = i.itemId
  rejectReason.value = ''
  rejectSheet.value = true
}

function doReject() {
  const why = rejectReason.value.trim()
  if (!why) return toast('驳回必须写理由')
  try {
    demoAuditItem(rejectTarget.value, false, why)
    rejectSheet.value = false
    ver.value++
    toastOk('已驳回，理由会展示给业主')
  } catch (e) {
    toastErr(e.message || '操作失败')
  }
}

function offline(i) {
  uni.showModal({
    title: '下架闲置',
    content: '下架后邻居看不到，可以随时重新提交（内容未改仍需复核）。',
    success: async res => {
      if (!res.confirm) return
      try {
        await offlineMyItem(i.itemId)
        ver.value++
        toast('已下架')
      } catch (e) {
        toastErr(e.message || '下架失败')
      }
    }
  })
}

async function renew(i) {
  try {
    await renewMyItem(i.itemId)
    ver.value++
    toastOk('已重新提交审核')
  } catch (e) {
    toastErr(e.message || '续挂失败')
  }
}

async function payEnroll(e) {
  try {
    const p = await createActivityPay(e.enrollId)
    go('/pages/pay/index', { payId: p.payId })
  } catch (err) {
    toastErr(err.message || '生成支付单失败')
  }
}

function cancelEnroll(e) {
  const a = e.activity
  const { ratio, amount } = myRefundOf(a)
  const content =
    e.amount > 0
      ? `按退款规则当前可退 ${ratio}%，即 ${money(amount)}（已付 ${money(e.amount)}）。演示环境不产生真实流水。`
      : '取消后名额将释放给其他邻居。'
  uni.showModal({
    title: e.amount > 0 ? '取消并退款' : '取消报名',
    content,
    confirmText: '确认取消',
    confirmColor: '#ec4d63',
    success: async res => {
      if (!res.confirm) return
      try {
        await cancelActivityEnroll(e.activityId)
        ver.value++
        toast('已取消')
      } catch (err) {
        toastErr(err.message || '取消失败')
      }
    }
  })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }

.tabs { display: flex; gap: 30rpx; padding: 6rpx 28rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.tabs__i { padding: 12rpx 0 18rpx; font-size: 26rpx; color: var(--biz-text-3); position: relative; display: flex; align-items: center; gap: 8rpx; }
.tabs__i.is-on { color: var(--biz-text-1); font-weight: 700; }
.tabs__i.is-on::after {
  content: ''; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
  width: 44rpx; height: 6rpx; border-radius: 4rpx; background: var(--biz-primary);
}
.tabs__n { font-size: 18rpx; color: var(--biz-text-4); }

.body { padding: 20rpx 28rpx 50rpx; }

.it__hd { display: flex; align-items: flex-start; gap: 14rpx; }
.it__t { flex: 1; font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.it__st { flex: none; font-size: 21rpx; font-weight: 600; }
.it__meta { display: flex; justify-content: space-between; margin-top: 10rpx; font-size: 20rpx; color: var(--biz-text-4); }
.it__wait { margin-top: 14rpx; padding: 14rpx 16rpx; background: #fff8f0; border-radius: 12rpx; }
.it__wait-t { font-size: 22rpx; font-weight: 600; color: #a35c13; }
.it__wait-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: #8a5a1e; }
.it__rej { margin-top: 14rpx; }
.it__acts { display: flex; gap: 12rpx; margin-top: 16rpx; flex-wrap: wrap; }
.it__acts .btn { flex: none; }

.en__hd { display: flex; align-items: flex-start; gap: 14rpx; }
.en__t { flex: 1; font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.en__st { flex: none; font-size: 21rpx; color: var(--biz-accent-dark); }
.en__meta { display: flex; justify-content: space-between; margin-top: 10rpx; font-size: 20rpx; color: var(--biz-text-4); }
.en__tag { display: flex; align-items: center; gap: 10rpx; margin-top: 12rpx; flex-wrap: wrap; }
.en__ref { font-size: 19rpx; color: var(--biz-warning); }
.en__acts { display: flex; gap: 12rpx; margin-top: 16rpx; flex-wrap: wrap; }

.vo__hd { display: flex; align-items: flex-start; gap: 14rpx; }
.vo__t { flex: 1; font-size: 26rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.vo__st { flex: none; font-size: 20rpx; color: var(--biz-accent-dark); }
.vo__st.is-end { color: var(--biz-text-4); }
.vo__my { display: flex; gap: 14rpx; margin-top: 12rpx; }
.vo__k { flex: none; font-size: 21rpx; color: var(--biz-text-3); }
.vo__v { flex: 1; font-size: 22rpx; color: var(--biz-primary); line-height: 1.5; }
.vo__foot { display: flex; align-items: center; justify-content: space-between; margin-top: 12rpx; font-size: 20rpx; color: var(--biz-text-4); }
.vo__a { color: var(--biz-primary); font-weight: 600; }

.my__btn { margin-top: 16rpx; padding: 14rpx 34rpx; border-radius: 999rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); font-size: 24rpx; }
.my__note { margin-top: 22rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.my__note-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
.my__text { height: 150rpx; }
.my__submit { margin-top: 18rpx; }
</style>
