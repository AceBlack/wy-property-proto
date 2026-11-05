<template>
  <view class="page">
    <NavBar title="审批详情" :subtitle="d?.row?.no || ''" />

    <view v-if="d" class="body body--with-foot">
      <view class="card head">
        <view class="head__top">
          <text class="biz" :style="{ color: BIZ_TYPE_TONE[d.row.bizType] || 'var(--biz-text-3)' }">{{ d.row.bizType }}</text>
          <text class="status" :class="statusClass">{{ d.row.status }}</text>
        </view>
        <text class="head__t">{{ d.row.title }}</text>
        <view v-if="d.row.amount" class="head__amount">
          <text class="head__k">涉及金额</text>
          <text class="head__v num">¥{{ d.row.amount.toFixed(2) }}</text>
        </view>
        <view class="head__node">
          <text class="head__node-k">当前节点</text>
          <text class="head__node-v">{{ d.row.node }}</text>
          <text v-if="d.sign" id="oa-sign-progress" class="head__node-d">
            {{ d.sign.mode === 'all' ? '会签' : d.sign.mode === 'any' ? '或签' : '单签' }}
            {{ d.sign.progress.done }}/{{ d.sign.progress.total }} · {{ signModeHint }}
          </text>
          <text v-else-if="d.actor && d.target?.kind === 'leader' && d.target.signer" class="head__node-d">
            由 {{ d.target.signer.name }}（{{ d.target.signer.duty }}）处理
          </text>
          <text v-else-if="d.actor && d.target?.kind === 'unsupported'" class="head__node-d">{{ d.target.why }}</text>
        </view>
      </view>

      <!-- 会签名单：不显示的话，用户点完"同意"发现单子没动，会以为坏了 -->
      <view v-if="d.sign" id="oa-sign-list" class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">会签名单</text>
          <text class="sec-hd__d">{{ d.sign.progress.done }}/{{ d.sign.progress.total }} 已签 · {{ signModeHint }}</text>
        </view>
        <view v-for="p in d.sign.approvers" :key="p.name" class="sg" :class="{ 'is-wait': p.action === '待处理' }">
          <view class="sg__l">
            <text class="sg__n">{{ p.name }}</text>
            <text v-if="p.duty" class="sg__d">{{ p.duty }}</text>
          </view>
          <text class="sg__s" :class="{ 'is-wait': p.action === '待处理', 'is-no': p.action === '驳回' }">
            {{ p.action }}{{ p.time ? ' · ' + p.time.slice(5, 16) : '' }}
          </text>
        </view>
        <text class="sg__note">
          会签要全部同意才推进；任一人驳回则整单驳回（其余未签的标「已跳过」）。副职只在会签节点参与，单签节点轮不到。
        </text>
      </view>

      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">单据信息</text></view>
        <Cell label="单号" :value="d.row.no" />
        <Cell label="申请人" :value="`${d.row.applicant} · ${d.row.applicantRole}`" />
        <Cell label="申请时间" :value="d.row.applyTime" />
        <Cell label="紧急度" :value="d.row.urgency" />
        <Cell label="已等待" :value="d.row.waitHours ? `${d.row.waitHours} 小时` : '—'" :last="true" />
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">审批流</text>
          <text class="sec-hd__d">节点处理人按岗位派，不是按人指定</text>
        </view>
        <view v-for="n in d.timeline" :key="n.index" class="tl">
          <view class="tl__l">
            <view class="tl__dot" :class="{ 'is-done': n.done, 'is-now': !n.done && n.index === nowIndex }" />
            <view v-if="n.index < d.timeline.length" class="tl__line" :class="{ 'is-done': n.done }" />
          </view>
          <view class="tl__b">
            <text class="tl__t">{{ n.node }}</text>
            <text class="tl__m">
              {{ n.done ? `${n.handler || '系统'} · ${n.action}${n.time ? ' · ' + n.time : ''}` : '待处理' }}
            </text>
            <text v-if="n.approvers.length" class="tl__c">
              会签 {{ n.approvers.filter(p => p.action !== '待处理').length }}/{{ n.approvers.length }}：
              {{ n.approvers.map(p => p.name + (p.duty ? '(' + p.duty + ')' : '') + '·' + p.action).join('，') }}
            </text>
            <text v-if="n.comment" class="tl__c">{{ n.comment }}</text>
          </view>
        </view>
      </view>

      <view v-if="!guard.ok" class="banner banner--info">
        <text class="banner__ico"><text>i</text></text>
        <view class="banner__bd">
          <text class="banner__t">这单不进你的待办</text>
          <text class="banner__d">{{ guard.why }}。审批人按部门负责人关系表判定，换到对应负责人身份才出现操作按钮。</text>
        </view>
      </view>

      <view v-else class="banner banner--pending">
        <text class="banner__ico"><text>✓</text></text>
        <view class="banner__bd">
          <text class="banner__t">这单归你处理</text>
          <text class="banner__d">通过会推进到下一节点；驳回直接结束；转办只换处理人，不改变流程。</text>
        </view>
      </view>
    </view>

    <view v-if="d && guard.ok" class="footbar">
      <view id="oa-reject" class="btn btn--line foot-btn" @tap="openSheet('reject')">驳回</view>
      <view v-if="!d.sign" id="oa-transfer" class="btn btn--line foot-btn" @tap="openTransfer">转办</view>
      <view id="oa-approve" class="btn btn--primary foot-btn" @tap="openSheet('approve')">
        {{ d.sign ? '签署同意' : '通过' }}
      </view>
    </view>

    <Sheet
      v-model:show="sheet"
      :title="mode === 'reject' ? '驳回原因' : '审批意见'"
      :sub="mode === 'reject' ? '必须写清原因，申请人要知道为什么被退' : '可留空，默认记「同意」'"
      max-height="50vh"
    >
      <textarea
        v-model="comment"
        class="textarea"
        :maxlength="120"
        :placeholder="mode === 'reject' ? '例：现场照片与报修内容不符，请补充' : '补充说明（选填）'"
        placeholder-class="ph"
      />
      <view class="sheet__act">
        <view class="btn btn--line" @tap="sheet = false">取消</view>
        <view id="oa-confirm" class="btn btn--primary" :class="{ 'btn--disabled': mode === 'reject' && !comment.trim() }" @tap="doAct">
          {{ mode === 'reject' ? '确认驳回' : '确认通过' }}
        </view>
      </view>
    </Sheet>

    <ActionSheet
      v-model:show="transferSheet"
      title="转办给谁"
      sub="只换处理人，流程节点不变"
      :actions="candidates"
      @select="pickTransfer"
    />
  </view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Cell from '@/components/Cell.vue'
import Sheet from '@/components/Sheet.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import { BIZ_TYPE_TONE, act, canHandle, detailOf, transferCandidates } from '@/api/oa'
import { app, persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const id = ref('')
const ver = ref(0)
const sheet = ref(false)
const mode = ref('approve')
const comment = ref('')
const transferSheet = ref(false)
const transferTo = ref('')

const d = computed(() => (ver.value, id.value ? detailOf(id.value) : null))
const SIGN_HINT = {
  all: '全部同意才通过',
  any: '任一同意即通过',
  single: '一人签完即过'
}
const signModeHint = computed(() => SIGN_HINT[d.value?.sign?.mode || 'single'])

const guard = computed(() => {
  if (!d.value) return { ok: false, why: '' }
  return canHandle(persona.value, d.value.raw)
})
const statusClass = computed(() => {
  const s = d.value?.row?.status
  return s === '已通过' ? 'is-ok' : s === '已驳回' ? 'is-ng' : s === '审批中' ? 'is-doing' : ''
})
const nowIndex = computed(() => (d.value?.timeline || []).find(n => !n.done)?.index || 0)
const candidates = computed(() => (d.value ? transferCandidates(d.value.raw) : []))

onLoad(o => {
  id.value = o.id || ''
})

/**
 * 同一路由换 id 时 uni 的 H5 路由复用组件、不再触发 onLoad（员工端在「业主与房屋」踩过一次）。
 * 审批列表点不同单据会走到这里，所以直接监听 hash 同步，否则永远显示第一张单。
 */
onMounted(() => {
  // #ifdef H5
  const syncFromHash = () => {
    const m = String(location.hash || '').match(/[?&]id=([^&]+)/)
    if (!m) return
    const next = decodeURIComponent(m[1])
    if (next !== id.value) {
      id.value = next
      ver.value++
    }
  }
  syncFromHash()
  window.addEventListener('hashchange', syncFromHash)
  onUnmounted(() => window.removeEventListener('hashchange', syncFromHash))
  // #endif
})

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  ver.value++
})

function openSheet(m) {
  mode.value = m
  comment.value = ''
  sheet.value = true
}

function openTransfer() {
  if (!candidates.value.length) {
    toastErr('没有可转办的人选')
    return
  }
  transferSheet.value = true
}

function pickTransfer(name) {
  transferTo.value = name
  mode.value = 'transfer'
  comment.value = ''
  sheet.value = true
}

function doAct() {
  const isReject = mode.value === 'reject'
  if (isReject && !comment.value.trim()) {
    toastErr('驳回要写原因')
    return
  }
  try {
    act(persona.value, id.value, mode.value, { comment: comment.value.trim(), to: transferTo.value })
    sheet.value = false
    ver.value++
    toastOk(isReject ? '已驳回' : mode.value === 'transfer' ? `已转办给 ${transferTo.value}` : '已通过')
    setTimeout(() => uni.navigateBack(), 700)
  } catch (e) {
    toastErr(e?.message || '操作失败')
  }
}
</script>

<style scoped>
.head__top {
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
  font-size: 22rpx;
  font-weight: 600;
  color: var(--biz-warning);
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

.head__t {
  display: block;
  margin-top: 16rpx;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.35;
  color: var(--biz-text-1);
}

.head__amount {
  margin-top: 18rpx;
  padding: 16rpx 20rpx;
  background: var(--biz-bg-fill);
  border-radius: 14rpx;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.head__k {
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.head__v {
  font-size: 34rpx;
  color: var(--biz-text-1);
}

.head__node {
  margin-top: 16rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
}

.head__node-k {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.head__node-v {
  font-size: 24rpx;
  color: var(--biz-primary);
  font-weight: 600;
}

.head__node-d {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.tl {
  display: flex;
  gap: 16rpx;
}

.tl__l {
  width: 24rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8rpx;
}

.tl__dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: #fff;
  border: 3rpx solid var(--biz-border);
  flex: none;
}

.tl__dot.is-done {
  background: var(--biz-accent);
  border-color: var(--biz-accent);
}

.tl__dot.is-now {
  background: var(--biz-primary);
  border-color: var(--biz-primary);
  box-shadow: 0 0 0 6rpx rgba(91, 108, 255, 0.14);
}

.tl__line {
  width: 3rpx;
  flex: 1;
  background: var(--biz-border-light);
  margin: 6rpx 0;
  min-height: 40rpx;
}

.tl__line.is-done {
  background: var(--biz-accent);
}

.tl__b {
  flex: 1;
  min-width: 0;
  padding-bottom: 26rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.tl__t {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.tl__m {
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.tl__c {
  margin-top: 4rpx;
  font-size: 21rpx;
  color: var(--biz-text-2);
  background: var(--biz-bg-fill);
  border-radius: 10rpx;
  padding: 10rpx 14rpx;
  line-height: 1.5;
}

.foot-btn {
  flex: 1;
}

.sheet__act {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.sheet__act .btn {
  flex: 1;
  height: 84rpx;
  font-size: 27rpx;
}

.ph {
  color: var(--biz-text-4);
}

.banner__bd {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.sg {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.sg:last-of-type {
  border-bottom: none;
}

.sg.is-wait {
  background: transparent;
}

.sg__l {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.sg__n {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.sg__d {
  font-size: 18rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.sg__s {
  font-size: 22rpx;
  color: var(--biz-accent);
}

.sg__s.is-wait {
  color: #a35c13;
}

.sg__s.is-no {
  color: var(--biz-danger);
}

.sg__note {
  display: block;
  margin-top: 12rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.banner__t {
  font-size: 25rpx;
  font-weight: 600;
}

.banner__d {
  font-size: 21rpx;
  opacity: 0.9;
  line-height: 1.6;
}
</style>
