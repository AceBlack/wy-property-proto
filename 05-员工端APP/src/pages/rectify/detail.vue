<template>
  <view class="page">
    <NavBar title="整改详情" :subtitle="row?.no || ''" />

    <view v-if="d" class="body body--with-foot">
      <!-- 头 -->
      <view class="card head">
        <view class="head__top">
          <text class="status" :style="{ color: row.statusTone }">{{ row.status }}</text>
          <text class="lvl" :class="{ 'is-major': row.level === '重大' }">{{ row.level }}</text>
          <text v-if="row.overdue" class="od">超期 {{ row.overdueDays }} 天</text>
          <text v-else-if="row.status !== '已闭环'" class="remain">剩余 {{ Math.max(0, row.remainDays) }} 天</text>
        </view>
        <text class="head__t">{{ row.issueDesc }}</text>
        <view class="head__meta">
          <text>{{ row.deptName }}</text>
          <text class="dot">·</text>
          <text>责任人 {{ row.owner }}</text>
          <text class="dot">·</text>
          <text>期限 {{ row.dueDate }}</text>
        </view>
        <view class="prog">
          <view class="bar prog__bar"><view class="bar__in" :style="{ width: row.progress + '%' }" /></view>
          <text class="prog__t num">{{ row.doneItems }}/{{ row.totalItems }} 项</text>
        </view>
        <text class="head__src">来源 {{ row.source }}{{ row.source === '现场抽查' ? ' · 品质抽查开单' : '' }}</text>
      </view>

      <!-- 整改项 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">整改项（{{ row.totalItems }}）</text>
          <text class="sec-hd__d">全部处理完才能提交复核</text>
        </view>
        <view v-for="it in row.items" :key="it.no" class="it">
          <text class="it__no num">{{ String(it.no).padStart(2, '0') }}</text>
          <view class="it__b">
            <text class="it__d">{{ it.desc }}</text>
            <text class="it__r">要求：{{ it.require }}</text>
          </view>
          <text class="it__s" :class="it.done ? 'is-done' : ''">{{ it.done ? '已改' : '未改' }}</text>
        </view>
      </view>

      <!-- 提交记录 -->
      <view v-if="row.submitAt" class="card">
        <view class="sec-hd"><text class="sec-hd__t">整改提交</text></view>
        <Cell label="提交人" :value="row.submitBy || '—'" />
        <Cell label="提交时间" :value="row.submitAt" />
        <Cell label="照片" :value="`${row.photos || 0} 张`" />
        <view class="remark">{{ row.submitRemark || '—' }}</view>
      </view>

      <!-- 时间线 -->
      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">流程</text></view>
        <view v-for="(n, i) in d.timeline" :key="i" class="tl">
          <view class="tl__l">
            <view class="tl__dot" :class="{ 'is-done': n.done }" />
            <view v-if="i < d.timeline.length - 1" class="tl__line" :class="{ 'is-done': n.done }" />
          </view>
          <view class="tl__b">
            <text class="tl__t">{{ n.title }}</text>
            <text class="tl__m">{{ n.at || n.memo }}</text>
            <text v-if="n.at && n.memo" class="tl__m">{{ n.memo }}</text>
          </view>
        </view>
      </view>

      <view v-if="!row.canSubmit && !row.canRecheck" class="banner banner--info">
        <text class="banner__ico"><text>i</text></text>
        <view class="banner__bd">
          <text class="banner__t">这单不归你出手</text>
          <text class="banner__d">
            提交整改归责任人与本部门组长；复核归项目经理 / 品质督导。当前状态「{{ row.status }}」。
          </text>
        </view>
      </view>
    </view>

    <view v-if="d && (row.canSubmit || row.canRecheck || row.canReassign)" class="footbar">
      <view v-if="row.canReassign" id="rc-reassign" class="btn btn--line foot-btn" @tap="openReassign">改派</view>
      <view v-if="row.canSubmit" id="rc-submit" class="btn btn--primary foot-btn" @tap="openSubmit">提交整改</view>
      <template v-if="row.canRecheck">
        <view id="rc-reject" class="btn btn--line foot-btn" @tap="openRecheck(false)">退回</view>
        <view id="rc-pass" class="btn btn--primary foot-btn" @tap="openRecheck(true)">复核通过</view>
      </template>
    </view>

    <!-- 提交整改 -->
    <Sheet v-model:show="submitSheet" title="提交整改" sub="勾选已处理完的项，全部勾完才能提交" max-height="70vh">
      <view v-for="it in picked" :key="it.no" class="pick" @tap="toggle(it.no)">
        <view class="pick__box" :class="{ 'is-on': checked.includes(it.no) }">
          <text v-if="checked.includes(it.no)">✓</text>
        </view>
        <text class="pick__t">{{ it.desc }}</text>
      </view>
      <textarea
        v-model="submitRemark"
        class="textarea"
        style="margin-top: 16rpx"
        :maxlength="120"
        placeholder="整改说明：怎么改的、改成什么样"
        placeholder-class="ph-txt"
      />
      <view class="ng__row">
        <text class="fk">整改后照片</text>
        <text class="fd">{{ photos.length }}/3</text>
      </view>
      <PhotoPicker v-model="photos" :max="3" />
      <view class="sheet__act">
        <view class="btn btn--line" @tap="submitSheet = false">取消</view>
        <view id="rc-submit-confirm" class="btn btn--primary" @tap="doSubmit">提交</view>
      </view>
    </Sheet>

    <!-- 复核 -->
    <Sheet v-model:show="recheckSheet" :title="pass ? '复核通过' : '退回重做'" :sub="pass ? '通过后即闭环' : '退回会把整改进度清零，需重做'" max-height="50vh">
      <textarea
        v-model="recheckRemark"
        class="textarea"
        :maxlength="120"
        :placeholder="pass ? '复核意见（选填）' : '退回原因（必填）'"
        placeholder-class="ph-txt"
      />
      <view class="sheet__act">
        <view class="btn btn--line" @tap="recheckSheet = false">取消</view>
        <view id="rc-recheck-confirm" class="btn" :class="pass ? 'btn--primary' : 'btn--danger'" @tap="doRecheck">
          {{ pass ? '确认通过' : '确认退回' }}
        </view>
      </view>
    </Sheet>

    <ActionSheet v-model:show="reassignSheet" title="改派给谁" sub="只换责任人，单据与期限保留" :actions="cands" @select="doReassign" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Cell from '@/components/Cell.vue'
import Sheet from '@/components/Sheet.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { candidatesOf, detailOf, reassign, recheck, rowOf, submit } from '@/api/rectify'
import { app, persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const id = ref('')
const d = ref(null)
const ver = ref(0)
const submitSheet = ref(false)
const submitRemark = ref('')
const checked = ref([])
const photos = ref([])
const recheckSheet = ref(false)
const pass = ref(true)
const recheckRemark = ref('')
const reassignSheet = ref(false)

const row = computed(() => {
  const raw = d.value?.row
  if (!raw) return {}
  return (ver.value, rowOf(raw, persona.value))
})
const picked = computed(() => d.value?.row?.items || [])
const cands = computed(() => (d.value?.row ? candidatesOf(d.value.row) : []))

async function load() {
  d.value = await detailOf(id.value)
  ver.value++
}

onLoad(async o => {
  id.value = o.id || ''
  await load()
})

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
})

function openSubmit() {
  const items = picked.value
  checked.value = items.map(i => i.no)
  submitRemark.value = ''
  photos.value = []
  submitSheet.value = true
}

function toggle(no) {
  const i = checked.value.indexOf(no)
  if (i >= 0) checked.value.splice(i, 1)
  else checked.value.push(no)
}

async function doSubmit() {
  if (checked.value.length !== picked.value.length) {
    toastErr('还有整改项没勾，全部处理完才能提交复核')
    return
  }
  try {
    submit(persona.value, id.value, { remark: submitRemark.value, photos: photos.value.length, itemNos: checked.value })
    submitSheet.value = false
    await load()
    toastOk('已提交，等复核')
  } catch (e) {
    toastErr(e?.message || '提交失败')
  }
}

function openRecheck(ok) {
  pass.value = ok
  recheckRemark.value = ''
  recheckSheet.value = true
}

async function doRecheck() {
  if (!pass.value && !recheckRemark.value.trim()) {
    toastErr('退回要写原因')
    return
  }
  try {
    recheck(persona.value, id.value, { pass: pass.value, remark: recheckRemark.value.trim() })
    recheckSheet.value = false
    await load()
    toastOk(pass.value ? '已闭环' : '已退回')
  } catch (e) {
    toastErr(e?.message || '复核失败')
  }
}

function openReassign() {
  if (!cands.value.length) {
    toastErr('责任部门没有可选的人')
    return
  }
  reassignSheet.value = true
}

async function doReassign(name) {
  try {
    reassign(persona.value, id.value, { owner: name })
    await load()
    toastOk(`已改派给 ${name}`)
  } catch (e) {
    toastErr(e?.message || '改派失败')
  }
}
</script>

<style scoped>
.head__top {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.status {
  font-size: 22rpx;
  font-weight: 600;
}

.lvl {
  font-size: 18rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 999rpx;
  padding: 3rpx 10rpx;
}

.lvl.is-major {
  color: var(--biz-danger);
  background: #fff0f0;
}

.od {
  font-size: 18rpx;
  color: #fff;
  background: var(--biz-danger);
  border-radius: 999rpx;
  padding: 3rpx 10rpx;
}

.remain {
  margin-left: auto;
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.head__t {
  display: block;
  margin-top: 14rpx;
  font-size: 31rpx;
  font-weight: 700;
  line-height: 1.4;
  color: var(--biz-text-1);
}

.head__meta {
  margin-top: 12rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.dot {
  color: var(--biz-text-4);
}

.prog {
  margin-top: 16rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.prog__bar {
  flex: 1;
}

.prog__t {
  flex: none;
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.head__src {
  display: block;
  margin-top: 12rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.it {
  display: flex;
  gap: 14rpx;
  padding: 16rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.it:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.it__no {
  width: 40rpx;
  flex: none;
  font-size: 22rpx;
  color: var(--biz-text-4);
}

.it__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.it__d {
  font-size: 26rpx;
  color: var(--biz-text-1);
  line-height: 1.45;
}

.it__r {
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.it__s {
  flex: none;
  font-size: 20rpx;
  color: var(--biz-text-4);
  align-self: center;
}

.it__s.is-done {
  color: var(--biz-success);
  font-weight: 600;
}

.remark {
  margin-top: 14rpx;
  padding: 14rpx 16rpx;
  background: var(--biz-bg-fill);
  border-radius: 12rpx;
  font-size: 22rpx;
  color: var(--biz-text-2);
  line-height: 1.6;
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

.tl__line {
  width: 3rpx;
  flex: 1;
  background: var(--biz-border-light);
  margin: 6rpx 0;
  min-height: 36rpx;
}

.tl__line.is-done {
  background: var(--biz-accent);
}

.tl__b {
  flex: 1;
  min-width: 0;
  padding-bottom: 22rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.tl__t {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.tl__m {
  font-size: 20rpx;
  color: var(--biz-text-3);
  line-height: 1.5;
}

.pick {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  padding: 12rpx 0;
}

.pick__box {
  width: 36rpx;
  height: 36rpx;
  border-radius: 10rpx;
  border: 2rpx solid var(--biz-border);
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  color: #fff;
  flex: none;
  margin-top: 2rpx;
}

.pick__box.is-on {
  background: var(--biz-primary);
  border-color: var(--biz-primary);
}

.pick__t {
  flex: 1;
  font-size: 23rpx;
  color: var(--biz-text-2);
  line-height: 1.5;
}

.ng__row {
  display: flex;
  align-items: center;
  margin: 18rpx 0 10rpx;
}

.fk {
  font-size: 23rpx;
  color: var(--biz-text-2);
  font-weight: 600;
}

.fd {
  margin-left: auto;
  font-size: 21rpx;
  color: var(--biz-text-4);
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

.ph-txt {
  color: var(--biz-text-4);
}

.foot-btn {
  flex: 1;
}

.banner__bd {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
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
