<template>
  <view class="page">
    <NavBar title="工单" :back="false" :subtitle="`${persona?.post || ''} · ${DEMO.today}`">
      <template #right>
        <view id="switch-identity" class="who" hover-class="who--hover" @tap="openSwitch">
          <text class="who__n">{{ persona?.name }}</text>
          <view class="who__chev" />
        </view>
      </template>
    </NavBar>

    <view class="body body--tab">
      <NoPerm v-if="!allowed" title="工单只对现场岗开放" sub="财务、人事这类不接单的角色看不到工单入口。" perm="f.workorders.view" />

      <template v-else>
        <view class="hd">
          <view class="hd__l">
            <text class="hd__t">工单</text>
            <text class="hd__d">{{ headline }}</text>
          </view>
          <view class="hd__kpi">
            <text class="hd__n num">{{ hero }}</text>
            <text class="hd__k">{{ heroLabel }}</text>
          </view>
        </view>

        <!-- 本月提成：抢单的唯一动机，必须在列表页就看得见 -->
        <view v-if="canGrabSelf" id="commission" class="comm" hover-class="comm--hover" @tap="openCommission">
          <view class="comm__l">
            <text class="comm__k">本月抢单提成</text>
            <text class="comm__d">{{ comm.settledCount }}/{{ comm.count }} 单已收款 · 按人工费 {{ rateText }} 计提</text>
          </view>
          <view class="comm__r">
            <text class="comm__v num">{{ money(comm.settled) }}</text>
            <text v-if="comm.pending" class="comm__p num">在途 {{ money(comm.pending) }}</text>
          </view>
        </view>

        <Segmented v-model="tab" :items="tabs" id-prefix="wo-" />

        <view v-for="w in rows" :key="w.id" :id="`wo-card-${w.id}`" class="card" hover-class="card--hover" @tap="open(w)">
          <view class="row__top">
            <text class="pri" :style="{ color: w.priorityTone, borderColor: w.priorityTone }">{{ w.priority }}</text>
            <text class="title">{{ w.title }}</text>
            <text class="status" :style="{ color: w.statusTone }">{{ w.status }}</text>
          </view>
          <view class="meta">
            <text class="meta__loc">{{ w.houseName }}</text>
            <text class="dot">·</text>
            <text>{{ w.serviceName }}</text>
            <text class="dot">·</text>
            <text class="num">{{ w.createTime.slice(5, 16) }}</text>
          </view>

          <view class="foot">
            <view class="foot__l">
              <text class="foot__no num">{{ w.no }}</text>
              <text v-if="w.mode === '抢单'" class="mode">抢单</text>
            </view>
            <view class="foot__r">
              <text v-if="w.addonPending" class="warn">增项待确认</text>
              <text v-else-if="w.isOverdue" class="overdue">SLA 超时</text>
              <text v-else-if="w.slaLeft" class="sla">{{ w.slaLeft }}</text>
              <text v-if="w.assignee" class="assignee">{{ w.mine ? '我' : w.assignee }}</text>
            </view>
          </view>

          <!-- 付费单：金额与提成就是决策依据 -->
          <view v-if="w.feeType === '收费'" class="pay">
            <text class="pay__amt num">{{ money(w.total) }}</text>
            <text class="pay__st" :class="{ 'is-paid': w.paid }">{{ w.payStatus }}</text>
            <view class="spacer" />
            <text class="pay__c">提成 <text class="pay__cv num">{{ money(w.commission) }}</text></text>
            <view
              v-if="tab === 'grab'"
              :id="`grab-${w.id}`"
              class="grab"
              hover-class="grab--hover"
              @tap.stop="doGrab(w)"
            >抢单</view>
          </view>
        </view>

        <Empty v-if="!rows.length" :text="emptyText" :sub="emptySub" />
      </template>
    </view>

    <ActionSheet v-model:show="switchSheet" title="切换身份" :actions="switchActions" @select="onSwitch" />
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Segmented from '@/components/Segmented.vue'
import Empty from '@/components/Empty.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import NoPerm from '@/components/NoPerm.vue'
import { CAP, DEMO, PERSONAS, can } from '@/config/personas'
import { canGrab, claim, commissionSummary, countsOf, listFor, loadWorkOrders, tabsFor } from '@/api/wo'
import { projectParam } from '@/api/pricing'
import { money } from '@/utils/format'
import { app, login, persona } from '@/store/app'
import { toast, toastErr, toastOk } from '@/utils/ui'

const allowed = computed(() => can(persona.value, CAP.woView))
const tab = ref('')
const switchSheet = ref(false)
const ver = ref(0)

const canGrabSelf = computed(() => canGrab(persona.value))
const tabs = computed(() => (ver.value, tabsFor(persona.value)))
const counts = computed(() => (ver.value, countsOf(persona.value)))
const comm = computed(() => (ver.value, commissionSummary(persona.value)))
const rateText = computed(() => `${Math.round((projectParam(persona.value?.communityId).commissionRate || 0) * 100)}%`)

const headline = computed(() => {
  if (canGrabSelf.value) return '付费入户单先到先得；公区单在「我的」里等派工'
  if (can(persona.value, CAP.woDispatch)) return '公区单由你指派；付费入户单进抢单池，不派'
  return '只看得到派给我的单'
})
const hero = computed(() =>
  tab.value === 'grab'
    ? counts.value.grab
    : tab.value === 'dispatch'
      ? counts.value.dispatch
      : tab.value === 'mine'
        ? counts.value.mine
        : counts.value.done
)
const heroLabel = computed(() =>
  tab.value === 'grab' ? '可抢' : tab.value === 'dispatch' ? '待派' : tab.value === 'mine' ? '在办' : '已完成'
)
const rows = computed(() => (ver.value, listFor(persona.value, tab.value || fallbackTab.value)))

/** 页签是算出来的（不同身份数量不同），所以 tab 不能写死初值 */
const fallbackTab = computed(() => tabs.value[0]?.key || 'mine')

const emptyText = computed(() => {
  const t = tab.value || fallbackTab.value
  if (t === 'grab') return '现在没有可抢的付费单'
  if (t === 'dispatch') return '没有待派的单'
  if (t === 'mine') return '手上没有在办的单'
  return '还没有完成的单'
})
const emptySub = computed(() => {
  const t = tab.value || fallbackTab.value
  if (t === 'grab') return '抢单池只放付费入户维修（有提成）。公区维修不进池，由班组长/客服指派'
  if (t === 'dispatch') return '付费单默认进抢单池；只有业主点名或超时升级时，项目经理才指派'
  if (t === 'mine') return '抢一单或等我被派单，这里就有了'
  return '完工的单会归档到这里，可回评业主配合度'
})

const switchActions = computed(() =>
  PERSONAS.map(p => ({ label: `${p.name} · ${p.post}`, desc: p.desc, value: p.id, active: p.id === app.personaId }))
)

/**
 * 拉当前页签的数据再重算。
 * HTTP 模式下 `listFor` / `tabsFor` 读的是缓存，所以必须先 await 这一次请求，
 * 否则 ver++ 触发的重算读到的是空数组 —— 页面会闪一下空白。
 */
async function loadList(tabKey) {
  if (!tabKey) return
  try {
    await loadWorkOrders(persona.value, tabKey)
  } catch (e) {
    toastErr(e?.message || '工单加载失败')
  }
  ver.value++
}

onShow(async () => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  /*
   * 顺序不能反：HTTP 模式下 `tabs` 只有拉过一次才有内容，
   * 拿空数组去判断"当前页签是否还有效"，结论永远是 false ——
   * 会被回落到写死的 mine，而一线根本没有"我的"单，页面就空着。
   * 先拉一次拿到真实页签，再决定要不要换。
   */
  await loadList(tab.value || fallbackTab.value)
  if (!tabs.value.some(t => t.key === tab.value)) {
    const first = tabs.value[0]?.key
    if (first) tab.value = first   /* 改 tab 会触发下面的 watch 再拉一次 */
  }
})

/* 切页签要换一份数据：每个 tab 的行是独立拉的（页签计数与行同一次快照） */
watch(tab, (v, old) => {
  if (v && v !== old) loadList(v)
})

function openSwitch() {
  switchSheet.value = true
}

function onSwitch(id) {
  if (id === app.personaId) return
  login(id)
  tab.value = ''
  ver.value++
  tab.value = fallbackTab.value
  toast('已切换身份')
}

function openCommission() {
  uni.navigateTo({ url: '/pages/payroll/commission' })
}

function open(w) {
  uni.navigateTo({ url: `/pages/wo/detail?id=${w.id}` })
}

/** 抢单：失败文案直接来自数据层（409 语义），并刷新池子 */
async function doGrab(w) {
  try {
    await claim(w.id, persona.value)
    tab.value = 'mine'
    await loadList('mine')
    toastOk(`抢到了 · ${w.no}，15 分钟内到场`)
  } catch (e) {
    await loadList(tab.value || 'grab')
    /* 抢失败多半是被别人抢走了：重新拉一次池子，那张单会自己消失 */
    toastErr(e?.message || '抢单失败')
  }
}
</script>

<style scoped>
.who {
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 8rpx 14rpx;
  border-radius: 999rpx;
  background: #fff;
  border: 2rpx solid var(--biz-border-light);
}

.who--hover {
  background: var(--biz-bg-hover);
}

.who__n {
  font-size: 22rpx;
  color: var(--biz-text-2);
  font-weight: 500;
}

.who__chev {
  width: 10rpx;
  height: 10rpx;
  border-right: 2rpx solid var(--biz-text-3);
  border-bottom: 2rpx solid var(--biz-text-3);
  transform: rotate(45deg) translateY(-2rpx);
}

.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4rpx 4rpx 16rpx;
}

.hd__l {
  flex: 1;
  min-width: 0;
  padding-right: 16rpx;
}

.hd__t {
  display: block;
  font-size: 38rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.hd__d {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--biz-text-3);
  line-height: 1.45;
}

.hd__kpi {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.hd__n {
  font-size: 46rpx;
  line-height: 1;
  color: var(--biz-primary);
}

.hd__k {
  font-size: 20rpx;
  color: var(--biz-text-3);
  margin-top: 6rpx;
}

.comm {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 22rpx;
  margin-bottom: 16rpx;
  border-radius: 20rpx;
  background: linear-gradient(135deg, #fff7ed 0%, #fff 78%);
  border: 2rpx solid #ffe2bd;
}

.comm--hover {
  background: var(--biz-bg-hover);
}

.comm__l {
  flex: 1;
  min-width: 0;
}

.comm__k {
  display: block;
  font-size: 23rpx;
  color: #a35c13;
  font-weight: 600;
}

.comm__d {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: #b8814a;
  line-height: 1.45;
}

.comm__r {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
}

.comm__v {
  font-size: 36rpx;
  color: #d97706;
  line-height: 1.1;
}

.comm__p {
  font-size: 19rpx;
  color: #b8814a;
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
  gap: 12rpx;
}

.pri {
  flex: none;
  font-size: 19rpx;
  border: 2rpx solid currentColor;
  border-radius: 8rpx;
  padding: 3rpx 10rpx;
  line-height: 1.2;
}

.title {
  flex: 1;
  min-width: 0;
  font-size: 29rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.status {
  flex: none;
  font-size: 21rpx;
  font-weight: 600;
}

.meta {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.dot {
  color: var(--biz-text-4);
}

.meta__loc {
  color: var(--biz-text-2);
}

.foot {
  margin-top: 16rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.foot__l {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.foot__no {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.mode {
  font-size: 18rpx;
  color: var(--biz-warning);
  background: #fff7ed;
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.foot__r {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.overdue {
  font-size: 20rpx;
  color: var(--biz-danger);
  font-weight: 600;
}

.warn {
  font-size: 19rpx;
  color: #fff;
  background: var(--biz-warning);
  border-radius: 999rpx;
  padding: 2rpx 10rpx;
}

.sla {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.assignee {
  font-size: 20rpx;
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
}

.pay {
  margin-top: 14rpx;
  padding-top: 14rpx;
  border-top: 2rpx dashed var(--biz-border-light);
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.pay__amt {
  font-size: 28rpx;
  color: var(--biz-text-1);
  font-weight: 600;
}

.pay__st {
  font-size: 18rpx;
  color: var(--biz-danger);
  background: #fff0f0;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}

.pay__st.is-paid {
  color: var(--biz-accent);
  background: var(--biz-accent-light-9, #eefbf4);
}

.spacer {
  flex: 1;
}

.pay__c {
  font-size: 20rpx;
  color: #a35c13;
}

.pay__cv {
  font-size: 24rpx;
  color: #d97706;
  font-weight: 600;
}

.grab {
  flex: none;
  padding: 10rpx 26rpx;
  border-radius: 999rpx;
  background: var(--biz-primary);
  color: #fff;
  font-size: 22rpx;
  font-weight: 600;
}

.grab--hover {
  opacity: 0.85;
}
</style>
