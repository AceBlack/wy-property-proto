<template>
  <view class="page">
    <NavBar title="逐项执行" :subtitle="`${doneCount}/${items.length} 项已判定`">
      <template #right>
        <text id="all-ok" class="allok" @tap="allNormal">全部正常</text>
      </template>
    </NavBar>

    <view class="body body--with-foot">
      <view class="card">
        <Steps :current="1" />
      </view>

      <!-- 断网 -->
      <view v-if="app.net === 'offline'" class="banner banner--offline">
        <text class="banner__ico"><text>!</text></text>
        <view class="banner__bd">
          <text class="banner__t">当前离线</text>
          <text class="banner__d">判定照常做，提交会先存本机（标「待同步」），联网后自动上传。</text>
        </view>
      </view>
      <view v-if="restoredAt" class="banner banner--info">
        <text class="banner__ico"><text>↺</text></text>
        <view class="banner__bd">
          <text class="banner__t">已恢复本地草稿</text>
          <text class="banner__d">{{ restoredAt }} 的判定结果（照片与草稿分开存，需重新拍）。</text>
        </view>
      </view>

      <!-- 任务头 -->
      <view class="card head">
        <view class="head__tags">
          <Tag :text="isSup ? '监督核验' : '执行巡检'" :color="isSup ? 'var(--biz-warning)' : 'var(--biz-primary)'" :plain="false" />
          <Tag :text="task?.status || ''" :color="statusColor" />
        </view>
        <text class="head__t">{{ task?.planName }}</text>
        <view class="head__meta">
          <text>{{ task?.scheduledDate }} {{ task?.scheduledTime }} · {{ communityLabel }}</text>
          <text v-if="timeText" :class="timeClass">{{ timeText }}</text>
        </view>
        <view class="bar head__bar">
          <view class="bar__in" :style="{ width: pct + '%' }" />
        </view>
        <view class="head__foot">
          <text class="head__hint">
            {{ isSup ? '按达标标准抽查，发现问题要指定责任员工' : '默认未判定；正常项可点「全部正常」一次过' }}
          </text>
          <text class="head__num num">{{ pct }}%</text>
        </view>
      </view>

      <view v-if="isSup" class="banner banner--info">
        <text class="banner__ico"><text>i</text></text>
        <view class="banner__bd">
          <text class="banner__t">监督任务：{{ targetDeptName }}</text>
          <text class="banner__d">
            到下属责任区实地核验，不是看员工提交的表单。不达标项必须指定责任员工 —— 不指定，问题归不到人，考核扣不到谁头上。
          </text>
        </view>
      </view>

      <!-- 检查项 -->
      <view
        v-for="(it, i) in items"
        :key="it.label"
        class="ic"
        :class="it.state === 'ok' ? 'is-ok' : it.state === 'ng' ? 'is-ng' : ''"
      >
        <view class="ic__hd">
          <text class="ic__i num">{{ String(i + 1).padStart(2, '0') }}</text>
          <view class="ic__b">
            <view class="ic__t">
              <text class="ic__label">{{ it.label }}</text>
              <text v-if="it.required" class="req">*</text>
              <text class="ic__type">{{ it.type }}</text>
            </view>
            <text class="ic__std">标准：{{ stdOf(it) }}</text>
          </view>
        </view>

        <view class="sw">
          <view :id="'judge-' + i + '-ok'" class="sw__i" :class="{ 'is-ok': it.state === 'ok' }" @tap="judge(it, 'ok')">
            {{ isSup ? '达标' : '合格' }}
          </view>
          <view :id="'judge-' + i + '-ng'" class="sw__i" :class="{ 'is-ng': it.state === 'ng' }" @tap="judge(it, 'ng')">
            {{ isSup ? '不达标' : '异常' }}
          </view>
        </view>

        <!-- 不达标才展开：类型 + 说明 + 照片 + 责任人 -->
        <view v-if="it.state === 'ng'" class="ng">
          <text class="ng__k">问题类型</text>
          <view class="chips">
            <text
              v-for="r in reasons"
              :key="r"
              class="chip"
              :class="{ 'is-on': it.reason === r }"
              @tap="pickReason(it, r)"
            >{{ r }}</text>
          </view>

          <text class="ng__k">现场说明<text class="req"> 必填</text></text>
          <textarea
            v-model="it.note"
            class="textarea"
            :maxlength="200"
            :placeholder="isSup ? '现场情况，例：楼道扶手有明显积尘，已当面指出' : '写清位置与现象，例：3 号楼大堂地砖有油渍未清'"
            placeholder-class="ph"
            @blur="saveDraftNow"
          />

          <view class="ng__row">
            <text class="ng__k">现场照片</text>
            <text class="ng__d">{{ photoCount(it) }}/3</text>
          </view>
          <PhotoPicker v-model="it.photos" :max="3" @update:model-value="saveDraftNow" />

          <!-- 监督任务专属：责任员工 -->
          <view v-if="isSup" :id="'resp-' + i" class="resp" :class="{ 'is-empty': !it.responsibleName }" @tap="openResp(i)">
            <text class="resp__k">责任员工</text>
            <text class="resp__v" :class="{ 'is-empty': !it.responsibleName }">
              {{ it.responsibleName || '必选 · 点此从被检班组里选' }}
            </text>
            <view class="resp__chev" />
          </view>

          <view v-if="!isSup" class="wo">
            <view v-if="it.woNo" class="wo__done">
              <text class="wo__done-i">✓</text>
              <text class="wo__done-t">已转工单</text>
              <text class="wo__done-no num">{{ it.woNo }}</text>
            </view>
            <view v-else :id="`to-wo-${i}`" class="btn btn--line btn--sm wo__btn" @tap="toWo(it)">转工单</view>
            <text class="wo__d">{{ it.woNo ? '任务提交后，这张单会挂在工单池里派给工程组' : '设备损坏、需专业处理的，转工单可免二次录入' }}</text>
          </view>
        </view>

        <view v-else-if="it.state === 'ok'" class="okline">
          <text class="okline__i">✓</text>
          <text>已确认{{ isSup ? '达标' : '合格' }}</text>
        </view>
        <view v-else class="waitline">未判定</view>
      </view>

      <view class="hint">
        <text v-if="isSup">
          监督口径：本班组当日若有「零异常」申报，而这里查出问题，提交后会自动标记冲突（后台防作弊要看这条）。
        </text>
        <text v-else>
          未判定项提交会被拦下；「全部正常」是一次性把剩余项判为合格，适合确实没问题的常规巡检。
        </text>
      </view>
    </view>

    <view class="footbar">
      <view class="foot-num">
        <text class="foot-num__n num">{{ doneCount }}</text>
        <text class="foot-num__d">/{{ items.length }}</text>
      </view>
      <view id="submit-btn" class="btn btn--primary foot-btn" hover-class="none" @tap="submit">
        {{ submitting ? '提交中…' : isSup ? '提交核验' : '提交巡检' }}
      </view>
    </view>

    <ActionSheet
      v-model:show="respSheet"
      :title="`指定责任员工 · ${respTitle}`"
      :sub="`候选来自被检班组「${targetDeptName}」，已排除本人`"
      :actions="respActions"
      @select="onResp"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Steps from '@/components/Steps.vue'
import Tag from '@/components/Tag.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import { INSPECT_ISSUE_REASONS, STATUS_COLOR, communityNameOf, execData, loadTaskExec, orgNameOf, respCandidates, submitInspectResult } from '@/api/mobile'
import { app, clearDraft, getDraft, inspectWoOf, isPending, persona, saveDraft, stageSubmission } from '@/store/app'
import { demoNow } from '@/config/personas'
import { fullTimeText, timeState } from '@/utils/deadline'
import { toast, toastErr, toastOk } from '@/utils/ui'

const taskId = ref('')
const task = ref(null)
const template = ref(null)
const items = ref([])
const reasons = INSPECT_ISSUE_REASONS
const submitting = ref(false)
const restoredAt = ref('')
const respSheet = ref(false)
const respIdx = ref(-1)

onLoad(async options => {
  taskId.value = options.taskId || ''
  /* HTTP 模式下先把这一屏的数据拉下来，下面的 execData 才读得到（mock 模式是空操作） */
  await loadTaskExec(taskId.value, persona.value)
  const d = execData(taskId.value)
  task.value = d.task
  template.value = d.template
  items.value = buildItems(d.template, d.task)

  /* 已转出的工单号（从本地关联表恢复，返回本页时还能看到） */
  const applyWoNos = () => {
    items.value.forEach(it => {
      const wo = inspectWoOf(taskId.value, it.label)
      it.woNo = wo?.woNo || ''
    })
  }

  const draft = getDraft(taskId.value)
  if (draft?.items?.length) {
    const map = new Map(draft.items.map(x => [x.label, x]))
    items.value.forEach(it => {
      const old = map.get(it.label)
      if (!old) return
      it.state = old.state || ''
      it.reason = old.reason || ''
      it.note = old.note || ''
      it.responsibleName = old.responsibleName || ''
    })
    restoredAt.value = draft.at
  }
  applyWoNos()
})

onShow(() => {
  /* 从转单页回来：把新生成的工单号补到对应项上 */
  if (items.value.length) {
    items.value.forEach(it => {
      const wo = inspectWoOf(taskId.value, it.label)
      it.woNo = wo?.woNo || ''
    })
  }
})

/** 异常项一键转工单：带上任务、检查项与现场说明，转单页不用重填 */
function toWo(it) {
  uni.navigateTo({
    url: `/pages/tasks/wo-create?taskId=${taskId.value}&item=${encodeURIComponent(it.label)}`
  })
}

/**
 * 判定项默认「未判定」。
 * 与 PC 执行页的区别：PC 默认合格（为了批量顺手），移动端改成显式判定 + 一键「全部正常」，
 * 避免员工没看就提交一份全合格的表 —— 这在一线是真实风险。
 */
function buildItems(tpl, t) {
  return (tpl?.fields || []).map(f => ({
    label: f.label,
    type: f.type,
    required: f.required,
    standard: f.standard,
    options: f.options || [],
    state: '',
    reason: '',
    note: '',
    photos: [],
    responsibleName: ''
  }))
}

const isSup = computed(() => task.value?.taskType === '监督')
const statusColor = computed(() => STATUS_COLOR[task.value?.status] || 'var(--biz-text-3)')
const communityLabel = computed(() => communityNameOf(task.value?.communityId))
const targetDeptName = computed(() => (task.value?.targetDept ? orgNameOf(task.value.targetDept) : '—'))
const time = computed(() => timeState(task.value))
const timeText = computed(() => time.value.text)
const timeClass = computed(() => (time.value.key === 'overdue' ? 'danger' : time.value.key === 'soon' ? 'warn' : 'muted'))

const doneCount = computed(() => items.value.filter(i => i.state).length)
const ngCount = computed(() => items.value.filter(i => i.state === 'ng').length)
const pct = computed(() => (items.value.length ? Math.round((doneCount.value / items.value.length) * 100) : 0))

const stdOf = it => it.standard || (it.options || []).join(' / ') || '按现场情况判定'
const photoCount = it => (it.photos || []).length

/* ---------- 责任员工 ---------- */
const respTitle = computed(() => items.value[respIdx.value]?.label || '')
const respActions = computed(() => {
  const t = task.value
  if (!t) return []
  return respCandidates(t).map(e => ({
    label: e.label,
    desc: '被检班组在职员工',
    value: e.name,
    active: items.value[respIdx.value]?.responsibleName === e.name
  }))
})

function openResp(i) {
  respIdx.value = i
  if (!respActions.value.length) {
    toastErr('被检班组没有可选员工，检查 targetDept 数据')
    return
  }
  respSheet.value = true
}

function onResp(name) {
  const it = items.value[respIdx.value]
  if (it) it.responsibleName = name
  saveDraftNow()
}

/* ---------- 判定 ---------- */
function judge(it, state) {
  it.state = state
  if (state === 'ok') {
    it.reason = ''
    it.note = ''
    it.photos = []
    it.responsibleName = ''
  }
  saveDraftNow()
}

function pickReason(it, r) {
  it.reason = r
  saveDraftNow()
}

function allNormal() {
  const left = items.value.filter(i => !i.state)
  if (!left.length) {
    toast('所有项都已判定')
    return
  }
  left.forEach(i => judge(i, 'ok'))
  toastOk(`${left.length} 项已判为${isSup.value ? '达标' : '合格'}`)
}

/* ---------- 草稿 ---------- */
let draftTimer = null
function saveDraftNow() {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    saveDraft(taskId.value, {
      items: items.value.map(i => ({
        label: i.label,
        state: i.state,
        reason: i.reason,
        note: i.note,
        responsibleName: i.responsibleName
      }))
    })
  }, 300)
}

/* ---------- 提交 ---------- */
function payloadOf() {
  const photos = items.value.reduce((s, i) => s + (i.photos || []).length, 0)
  /* 占位照片要单独计数：它是「缺证」，不能和真照片混成一个数 */
  const placeholders = items.value.reduce(
    (s, i) => s + (i.photos || []).filter(p => p.kind === 'placeholder').length,
    0
  )
  return {
    items: items.value.map(i => ({
      label: i.label,
      state: i.state,
      reason: i.reason,
      note: i.note,
      responsibleName: i.responsibleName
    })),
    remark: '',
    photos,
    placeholders
  }
}

function validate() {
  const left = items.value.filter(i => !i.state)
  if (left.length) {
    toastErr(`还有 ${left.length} 项未判定（可点右上角「全部正常」）`)
    return false
  }
  const hasNg = items.value.some(i => i.state === 'ng')
  if (!hasNg && !isSup.value) {
    /* 允许全合格，但提示一句，防止误提交 */
  }
  const noNote = items.value.find(i => i.state === 'ng' && !String(i.note || '').trim())
  if (noNote) {
    toastErr(`「${noNote.label}」不达标，需要写现场说明`)
    return false
  }
  if (isSup.value) {
    const noResp = items.value.find(i => i.state === 'ng' && !String(i.responsibleName || '').trim())
    if (noResp) {
      toastErr(`问题项「${noResp.label}」必须指定责任员工`)
      return false
    }
  }
  return true
}

async function submit() {
  if (submitting.value) return
  if (!validate()) return
  submitting.value = true

  const payload = payloadOf()
  const ng = items.value.filter(i => i.state === 'ng').length
  const normal = items.value.length - ng
  const score = Math.max(0, 100 - ng * (isSup.value ? 5 : 3))
  const base = {
    taskId: taskId.value,
    planName: task.value.planName,
    isSup: isSup.value,
    normalCount: normal,
    issueCount: ng,
    score,
    photos: payload.photos,
    placeholders: payload.placeholders,
    items: payload.items,
    at: fullTimeText(demoNow())
  }

  /* 断网：不假装成功，进本地队列并明确标「待同步」 */
  if (app.net === 'offline') {
    stageSubmission({ taskId: taskId.value, planName: task.value.planName, payload })
    clearDraft(taskId.value)
    app.lastSubmit = {
      ...base,
      pending: true,
      hitEmployees: [...new Set(payload.items.filter(i => i.state === 'ng').map(i => i.responsibleName).filter(Boolean))],
      conflictFlag: false
    }
    submitting.value = false
    uni.redirectTo({ url: `/pages/tasks/submit?taskId=${taskId.value}` })
    return
  }

  try {
    const r = submitInspectResult(taskId.value, payload)
    clearDraft(taskId.value)
    app.lastSubmit = {
      ...base,
      pending: false,
      normalCount: r.normalCount ?? normal,
      issueCount: r.issueCount ?? ng,
      score: r.score ?? score,
      conflictFlag: !!r.conflictFlag,
      hitEmployees: r.hitEmployees || [...new Set(payload.items.filter(i => i.state === 'ng').map(i => i.responsibleName).filter(Boolean))]
    }
    uni.redirectTo({ url: `/pages/tasks/submit?taskId=${taskId.value}` })
  } catch (e) {
    toastErr(e?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.allok {
  font-size: 24rpx;
  color: var(--biz-primary);
  font-weight: 600;
  padding: 6rpx 0 6rpx 10rpx;
}

.head__tags {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.head__t {
  display: block;
  margin-top: 14rpx;
  font-size: 36rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.head__meta {
  margin-top: 10rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.head__bar {
  margin-top: 18rpx;
}

.head__foot {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.head__hint {
  font-size: 20rpx;
  color: var(--biz-text-4);
  flex: 1;
  padding-right: 16rpx;
  line-height: 1.5;
}

.head__num {
  font-size: 24rpx;
  color: var(--biz-primary);
}

.ic {
  background: #fff;
  border-radius: 22rpx;
  padding: 24rpx;
  margin-bottom: 18rpx;
  box-shadow: var(--biz-shadow-card);
  border: 2rpx solid transparent;
}

.ic.is-ok {
  border-color: rgba(46, 217, 163, 0.36);
}

.ic.is-ng {
  border-color: rgba(255, 107, 107, 0.36);
}

.ic__hd {
  display: flex;
  gap: 16rpx;
}

.ic__i {
  width: 46rpx;
  flex: none;
  font-size: 24rpx;
  color: var(--biz-text-4);
  padding-top: 2rpx;
}

.ic__b {
  flex: 1;
  min-width: 0;
}

.ic__t {
  display: flex;
  align-items: center;
  gap: 8rpx;
  flex-wrap: wrap;
}

.ic__label {
  font-size: 29rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.req {
  color: var(--biz-danger);
  font-size: 24rpx;
}

.ic__type {
  font-size: 19rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 999rpx;
  padding: 2rpx 12rpx;
}

.ic__std {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.5;
}

.sw {
  margin-top: 18rpx;
  display: flex;
  gap: 10rpx;
  background: var(--biz-bg-fill);
  border-radius: 16rpx;
  padding: 8rpx;
}

.sw__i {
  flex: 1;
  height: 76rpx;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 27rpx;
  color: var(--biz-text-3);
  font-weight: 500;
}

.sw__i.is-ok {
  background: var(--biz-accent);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 4rpx 12rpx rgba(46, 217, 163, 0.28);
}

.sw__i.is-ng {
  background: var(--biz-ins-overdue);
  color: #fff;
  font-weight: 600;
  box-shadow: 0 4rpx 12rpx rgba(255, 107, 107, 0.26);
}

.ng {
  margin-top: 22rpx;
  padding-top: 20rpx;
  border-top: 2rpx dashed var(--biz-border);
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.ng__k {
  font-size: 23rpx;
  color: var(--biz-text-2);
  font-weight: 600;
}

.ng__d {
  font-size: 21rpx;
  color: var(--biz-text-4);
  margin-left: auto;
}

.ng__row {
  display: flex;
  align-items: center;
  margin-top: 6rpx;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.chip {
  font-size: 23rpx;
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background: var(--biz-bg-fill);
  color: var(--biz-text-2);
  border: 2rpx solid transparent;
}

.chip.is-on {
  color: var(--biz-ins-overdue);
  background: #fff0f0;
  border-color: rgba(255, 107, 107, 0.4);
  font-weight: 600;
}

.ph {
  color: var(--biz-text-4);
}

.resp {
  margin-top: 8rpx;
  height: 88rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 0 20rpx;
}

.resp.is-empty {
  background: #fff0f0;
  border: 2rpx solid rgba(255, 107, 107, 0.36);
}

.resp__k {
  font-size: 24rpx;
  color: var(--biz-text-3);
}

.resp__v {
  flex: 1;
  text-align: right;
  font-size: 26rpx;
  color: var(--biz-text-1);
  font-weight: 500;
}

.resp__v.is-empty {
  color: var(--biz-ins-overdue);
  font-weight: 600;
}

.resp__chev {
  width: 14rpx;
  height: 14rpx;
  border-top: 3rpx solid var(--biz-text-4);
  border-right: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
}

.wo {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  gap: 14rpx;
  flex-wrap: wrap;
}

.wo__btn {
  flex: none;
}

.wo__done {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.wo__done-i {
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  background: var(--biz-warning);
  color: #fff;
  font-size: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wo__done-t {
  font-size: 21rpx;
  color: #a35c13;
}

.wo__done-no {
  font-size: 21rpx;
  color: var(--biz-text-2);
}

.wo__d {
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
  flex: 1;
  min-width: 240rpx;
}

.okline {
  margin-top: 16rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
  font-size: 23rpx;
  color: var(--biz-success);
}

.okline__i {
  width: 30rpx;
  height: 30rpx;
  border-radius: 50%;
  background: var(--biz-accent);
  color: #fff;
  font-size: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.waitline {
  margin-top: 14rpx;
  font-size: 21rpx;
  color: var(--biz-text-4);
}

.hint {
  font-size: 21rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
  padding: 8rpx 8rpx 0;
}

.foot-num {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 4rpx;
  padding-right: 8rpx;
}

.foot-num__n {
  font-size: 40rpx;
  color: var(--biz-text-1);
}

.foot-num__d {
  font-size: 22rpx;
  color: var(--biz-text-4);
}

.foot-btn {
  flex: 1;
}

.banner__bd {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.banner__t {
  font-size: 25rpx;
  font-weight: 600;
}

.banner__d {
  font-size: 21rpx;
  opacity: 0.85;
  line-height: 1.55;
}
</style>
