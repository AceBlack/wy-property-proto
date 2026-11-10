<template>
  <view class="page">
    <NavBar title="审批" :subtitle="persona?.post || ''" />

    <view class="body">
      <!-- 发起入口：一线也要能请假 / 报销 / 用车，不能因为没有审批权就整页挡住 -->
      <view id="oa-apply" class="apply" hover-class="apply--hover" @tap="goApply">
        <view class="apply__l">
          <text class="apply__t">发起申请</text>
          <text class="apply__d">请假 / 报销 / 用车 / 采购 / 用印 / 加班 · 表单与路径取自后台配置</text>
        </view>
        <text class="apply__go">＋</text>
      </view>

      <view class="hint">
        <text class="hint__t">{{ canApprove ? '谁能审，是按节点算的' : '你可以发起申请，但没有审批节点' }}</text>
        <text class="hint__d">
          <template v-if="canApprove">
            本单当前节点决定处理人：客服主管节点 → 客服组组长；项目经理节点 → 项目经理；财务节点 → 财务主管。
            申请人不能审自己那一单。会签节点要全部同意才推进。
          </template>
          <template v-else>
            审批权按节点派给部门负责人（f.approval.handle）。一线可以提交申请并跟踪进度，
            通过或驳回由节点负责人处理。
          </template>
        </text>
      </view>

      <Segmented v-model="tab" :items="tabs" id-prefix="oa-" />

      <view v-for="r in rows" :key="r.id" class="card" hover-class="card--hover" @tap="open(r)">
        <view class="row__top">
          <text class="biz" :style="{ color: BIZ_TYPE_TONE[r.bizType] || 'var(--biz-text-3)' }">{{ r.bizType }}</text>
          <text class="status" :class="statusClass(r.status)">{{ r.status }}</text>
        </view>
        <text class="title">{{ r.title }}</text>
        <view class="meta">
          <text>{{ r.applicant }} · {{ r.applicantRole }}</text>
          <text class="dot">·</text>
          <text class="num">{{ r.applyTime.slice(5, 16) }}</text>
          <text v-if="r.amount" class="amount num">¥{{ r.amount.toFixed(2) }}</text>
        </view>
        <text class="no num">{{ r.no }}</text>
        <view class="foot">
          <view class="node">
            <text class="node__k">{{ tab === 'todo' ? '待你处理' : '当前节点' }}</text>
            <text class="node__v">{{ r.node }}</text>
          </view>
          <text v-if="r.waitHours" class="wait" :class="{ 'is-long': r.waitHours >= 48 }">已等 {{ r.waitHours }} 小时</text>
        </view>
      </view>

      <Empty v-if="!rows.length" :text="emptyText" :sub="emptySub" />
    </view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Segmented from '@/components/Segmented.vue'
import Empty from '@/components/Empty.vue'
import { BIZ_TYPE_TONE, countsOf, listFor, loadApprovals } from '@/api/oa'
import { app, persona } from '@/store/app'
import { CAP, can } from '@/config/personas'

const canApprove = computed(() => can(persona.value, CAP.approve))
/* 没有审批权的人默认落在「我发起」，否则一进来就是空的 */
const tab = ref(canApprove.value ? 'todo' : 'applied')
const ver = ref(0)

const counts = computed(() => (ver.value, countsOf(persona.value)))
const tabs = computed(() => {
  const list = [{ key: 'applied', label: '我发起', count: counts.value.applied }]
  if (canApprove.value) {
    list.unshift({ key: 'todo', label: '待我处理', count: counts.value.todo })
    list.push({ key: 'done', label: '我办过', count: counts.value.done })
  }
  return list
})
const rows = computed(() => (ver.value, listFor(persona.value, tab.value)))

const emptyText = computed(() =>
  tab.value === 'todo' ? '当前没有待你处理的单据' : tab.value === 'applied' ? '还没有发起过单据' : '还没有处理过单据'
)
const emptySub = computed(() => {
  if (tab.value === 'todo') {
    /* 项目经理这个空不是页面没做，是数据里本项目确实没有项目经理节点的单 —— 如实写出来 */
    if (persona.value?.roleId === 'R-PM') {
      return '演示数据里 5 张「项目经理审批」的单都在锦绣家园 / 星光天地，且这两个项目没有在职项目经理 —— 本项目确实为 0。这是数据缺口，不是页面缺失。'
    }
    return '审批按节点派活：换个身份（如客服主管 / 项目经理）能看到各自节点上的单'
  }
  if (tab.value === 'done') return '在「待我处理」里通过或驳回一单，这里就会出现'
  return '点上面的「发起申请」，提交后会出现在这里'
})

function goApply() {
  uni.navigateTo({ url: '/pages/oa/apply' })
}

/**
 * 先拉当前页签的数据再重算。HTTP 模式下 listFor/countsOf 读缓存，
 * 不 await 这一下，ver++ 触发的是空数组 —— 页面会闪一下"没有待办"。
 */
async function loadList(tabKey) {
  if (!tabKey) return
  try {
    await loadApprovals(persona.value, tabKey)
  } catch (e) {
    toastErr(e?.message || '审批加载失败')
  }
  ver.value++
}

onShow(async () => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  await loadList(tab.value || 'todo')
})

/* 三个页签各自一份数据（计数与行同一次快照） */
watch(tab, (v, o) => {
  if (v && v !== o) loadList(v)
})

const statusClass = s => (s === '已通过' ? 'is-ok' : s === '已驳回' ? 'is-ng' : s === '审批中' ? 'is-doing' : '')

function open(r) {
  uni.navigateTo({ url: `/pages/oa/detail?id=${r.id}` })
}
</script>

<style scoped>
.apply {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: linear-gradient(120deg, var(--biz-primary) 0%, #7b86ff 100%);
  border-radius: 22rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 10rpx 24rpx rgba(91, 108, 255, 0.28);
}

.apply--hover {
  opacity: 0.92;
}

.apply__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.apply__t {
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
}

.apply__d {
  font-size: 19rpx;
  color: rgba(255, 255, 255, 0.88);
  line-height: 1.5;
}

.apply__go {
  flex: none;
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: 34rpx;
  line-height: 52rpx;
  text-align: center;
}

.hint {
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.hint__t {
  display: block;
  font-size: 24rpx;
  font-weight: 600;
  color: var(--biz-text-2);
  margin-bottom: 8rpx;
}

.hint__d {
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
}

.card {
  background: #fff;
  border-radius: 22rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: var(--biz-shadow-card);
}

.card--hover {
  background: var(--biz-bg-hover);
}

.row__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.biz {
  font-size: 20rpx;
  border: 2rpx solid currentColor;
  border-radius: 999rpx;
  padding: 4rpx 14rpx;
}

.status {
  font-size: 21rpx;
  color: var(--biz-warning);
  font-weight: 600;
}

.status.is-ok {
  color: var(--biz-success);
}

.status.is-ng {
  color: var(--biz-danger);
}

.status.is-doing {
  color: var(--biz-primary);
}

.title {
  display: block;
  margin-top: 14rpx;
  font-size: 29rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.4;
}

.no {
  display: block;
  margin-top: 6rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  letter-spacing: 0.5rpx;
}

.meta {
  margin-top: 10rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.dot {
  color: var(--biz-text-4);
}

.amount {
  margin-left: auto;
  color: var(--biz-text-1);
  font-size: 24rpx;
}

.foot {
  margin-top: 16rpx;
  padding-top: 14rpx;
  border-top: 2rpx dashed var(--biz-border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.node {
  display: flex;
  align-items: center;
  gap: 10rpx;
  min-width: 0;
}

.node__k {
  font-size: 19rpx;
  color: var(--biz-text-4);
  flex: none;
}

.node__v {
  font-size: 22rpx;
  color: var(--biz-text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.wait {
  flex: none;
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.wait.is-long {
  color: var(--biz-danger);
  font-weight: 600;
}
</style>
