<template>
  <view class="page">
    <NavBar title="租户档案" :subtitle="d?.house?.fullName || ''" />

    <view v-if="!d" class="body">
      <Empty text="租户不存在或已删除" sub="从房屋页重新进入" />
    </view>

    <view v-else class="body body--with-foot">
      <!-- 租户主体 -->
      <view class="card">
        <view class="hd">
          <view class="hd__b">
            <view class="hd__top">
              <text class="hd__n">{{ t.name }}</text>
              <text class="hd__type">{{ t.tenantType === '公司' ? '企业承租' : '个人承租' }}</text>
            </view>
            <text class="hd__d">{{ t.relation }} · {{ t.residents }} 人居住 · 租期 {{ t.leaseStart }} 至 {{ t.leaseEnd }}</text>
            <text class="hd__d num">{{ maskPhone(t.phone) }} · {{ maskId(t.idCard) }}</text>
          </view>
          <text class="badge" :class="verifyTone">{{ t.verifyStatus }}</text>
        </view>

        <view class="tags">
          <text class="tg" :class="{ 'is-ok': t.certified }">{{ t.certified ? '已实名' : '未实名' }}</text>
          <text class="tg" :class="{ 'is-ok': t.faceRegistered }">{{ t.faceRegistered ? '已录人脸' : '未录人脸' }}</text>
          <text class="tg" :class="{ 'is-warn': leftDays < 90 }">{{ leftDays >= 0 ? `租期剩 ${leftDays} 天` : `已届满 ${-leftDays} 天` }}</text>
          <text class="tg">登记来源：{{ t.source }}</text>
        </view>
      </view>

      <!-- 核验门槛：5 项基础信息 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">核验门槛</text>
          <text class="sec-hd__d">基础信息 {{ fill.basicFilled }}/{{ fill.basicTotal }}</text>
        </view>
        <view class="bar">
          <view class="bar__in" :style="{ width: fill.rate + '%' }" />
        </view>
        <text class="bar__t">完整度 {{ fill.rate }}%（{{ fill.filled }}/{{ fill.total }} 项）</text>

        <view class="gates">
          <view v-for="g in gates" :key="g.label" class="gate">
            <text class="gate__i" :class="{ 'is-miss': !g.ok }">{{ g.ok ? '✓' : '!' }}</text>
            <text class="gate__t">{{ g.label }}</text>
            <text class="gate__s" :class="{ 'is-miss': !g.ok }">{{ g.ok ? '已填' : '缺' }}</text>
          </view>
        </view>

        <text v-if="fill.missingBasic.length" class="note note--warn">
          还差 {{ fill.missingBasic.join('、') }} —— 这 5 项是物业能补齐、且决定“这套房住的是谁”的字段，补全才能核验。
        </text>
        <text v-else class="note">基础信息齐了，可以核验。实名与人脸是核验结果，不在这道门槛里。</text>
      </view>

      <!-- 本房情况 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">本房情况</text>
          <text class="sec-hd__d">承租 {{ d.house?.fullName || '—' }}</text>
        </view>
        <view class="kv"><text class="kv__k">业主</text><text class="kv__v">{{ d.owner?.name || '—' }} · {{ d.owner ? maskPhone(d.owner.phone) : '' }}</text></view>
        <view class="kv"><text class="kv__k">欠费</text><text class="kv__v num" :class="{ 'is-od': d.debt > 0 }">{{ d.debt > 0 ? money(d.debt) : '无' }}</text></view>
        <view class="kv"><text class="kv__k">备注</text><text class="kv__v">{{ t.remark || '—' }}</text></view>
      </view>

      <!-- 处理记录 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">处理记录</text>
          <text class="sec-hd__d">{{ history.length }} 条</text>
        </view>
        <view v-for="(h, i) in history" :key="i" class="hs">
          <view class="hs__dot" :class="{ 'is-done': h.done }" />
          <view class="hs__b">
            <view class="hs__top">
              <text class="hs__a">{{ h.action }}</text>
              <text class="hs__t num">{{ h.at }}</text>
            </view>
            <text class="hs__m">{{ h.by }} · {{ h.memo }}</text>
          </view>
        </view>
        <text v-if="!history.length" class="note">还没有处理记录</text>
      </view>
    </view>

    <view v-if="d" class="footbar">
      <view id="tn-more" class="btn btn--line foot-btn" @tap="moreSheet = true">更多</view>
      <view id="tn-verify" class="btn btn--primary foot-btn" :class="{ 'btn--disabled': !canVerify }" @tap="verifyNow">
        {{ t.verifyStatus === '已核验' ? '已核验' : '核验通过' }}
      </view>
    </view>

    <!-- 更多操作 -->
    <Sheet v-model:show="moreSheet" title="租户操作" sub="现场能做的四件事" max-height="60vh">
      <view id="tn-fill" class="op" @tap="openFill">
        <view class="op__b"><text class="op__t">补充基础信息</text><text class="op__d">关系 / 居住人数 / 紧急联系人 / 备注</text></view>
        <text class="op__chev">›</text>
      </view>
      <view id="tn-face" class="op" :class="{ 'is-off': !canFace }" @tap="faceNow">
        <view class="op__b">
          <text class="op__t">录入人脸 · 门禁授权</text>
          <text class="op__d">{{ canFace ? '采集后本人可刷脸通行' : '需先完成核验与实名认证' }}</text>
        </view>
        <text class="op__chev">›</text>
      </view>
      <view id="tn-reject" class="op" @tap="rejectNow">
        <view class="op__b"><text class="op__t">退回补充</text><text class="op__d">标记为「信息不全」，通知业主补资料</text></view>
        <text class="op__chev">›</text>
      </view>
      <view id="tn-moveout" class="op op--danger" @tap="openMoveOut">
        <view class="op__b"><text class="op__t">标记搬离</text><text class="op__d">释放房屋在住关系、停用人脸，记录保留</text></view>
        <text class="op__chev">›</text>
      </view>
    </Sheet>

    <!-- 补资料 -->
    <Sheet v-model:show="fillSheet" title="补充基础信息" sub="只补现场能核实的字段，证件号仍回 PC 改" max-height="76vh">
      <view v-for="f in patchFields" :key="f.key" class="fld">
        <text class="fld__k">{{ f.label }}</text>
        <view v-if="f.type === 'select'" class="chips">
          <view
            v-for="o in relations"
            :key="o"
            :id="`rel-${o}`"
            class="chip"
            :class="{ 'is-on': form[f.key] === o }"
            @tap="form[f.key] = o"
          >
            {{ o }}
          </view>
        </view>
        <input
          v-else
          :id="`tf-${f.key}`"
          v-model="form[f.key]"
          class="input"
          :type="f.type === 'number' ? 'number' : 'text'"
          :placeholder="`请输入${f.label}`"
          placeholder-class="ph-txt"
        />
      </view>
      <view id="tf-save" class="btn btn--primary foot-full" @tap="saveFill">保存</view>
    </Sheet>

    <!-- 搬离 -->
    <Sheet v-model:show="outSheet" title="标记搬离" sub="退回「已搬离」并释放房屋在住关系" max-height="64vh">
      <text class="fld__k">搬离原因</text>
      <view class="chips">
        <view
          v-for="r in OUT_REASONS"
          :key="r"
          :id="`out-${r}`"
          class="chip"
          :class="{ 'is-on': outReason === r }"
          @tap="outReason = r"
        >
          {{ r }}
        </view>
      </view>
      <text class="note note--warn">搬离后该租户不再出现在「在住」，人脸立即停用，历史记录保留可回溯。</text>
      <view id="tn-moveout-confirm" class="btn btn--primary foot-full" @tap="moveOutNow">确认搬离</view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Sheet from '@/components/Sheet.vue'
import Empty from '@/components/Empty.vue'
import { TENANT_PATCH_FIELDS, moveOutBy, registerFaceBy, saveTenantFields, tenantDetailOf, verifyTenantBy } from '@/api/building'
import { persona } from '@/store/app'
import { money } from '@/utils/format'
import { toast, toastErr, toastOk } from '@/utils/ui'
import { maskId, maskPhone } from '@pc/utils/format'
import { TENANT_RELATIONS } from '@pc/utils/api'

const OUT_REASONS = ['租期届满退租', '提前退租', '换租他处', '业主收回自住']
const relations = TENANT_RELATIONS

const tenantId = ref('')
const ver = ref(0)
const moreSheet = ref(false)
const fillSheet = ref(false)
const outSheet = ref(false)
const outReason = ref(OUT_REASONS[0])
const form = reactive({})

/**
 * 详情接口是异步的（PC 的 getTenantDetail 走 delay 包装，模拟网络）。
 * 第一版当成同步直接取值，页面渲染出「个人承租 · · 人居住」一串空字段 —— 异步数据必须 await。
 */
const raw = ref(null)
const d = computed(() => (ver.value, raw.value))

async function load() {
  if (!tenantId.value) return
  raw.value = (await tenantDetailOf(tenantId.value)) || null
  ver.value++
}
const t = computed(() => d.value?.tenant || {})
const fill = computed(() => (ver.value, t.value?.completeness || { total: 0, filled: 0, rate: 0, basicTotal: 0, basicFilled: 0, missingBasic: [] }))
const history = computed(() => (ver.value, (d.value?.history || []).slice(0, 8)))
const patchFields = computed(() => TENANT_PATCH_FIELDS)

const leftDays = computed(() => {
  const end = t.value?.leaseEnd
  if (!end) return 999
  const a = new Date(String(end).replace(/-/g, '/'))
  const now = new Date('2026/10/20')
  return Math.round((a - now) / 86400000)
})

const verifyTone = computed(() =>
  t.value?.verifyStatus === '已核验' ? 'is-ok' : t.value?.verifyStatus === '信息不全' ? 'is-ng' : 'is-wait'
)

/** 5 项门槛：用完整度返回的 missingBasic 反推，规则仍在 PC 那一份 */
const gates = computed(() => {
  const miss = new Set(fill.value.missingBasic || [])
  const labels = { 姓名: '姓名', 手机号: '手机', 证件号: '证件号', 与业主关系: '与业主关系', 居住人数: '居住人数' }
  return Object.entries(labels).map(([k, label]) => ({ label, ok: !miss.has(k) }))
})

const canVerify = computed(
  () => t.value?.verifyStatus !== '已核验' && (fill.value.missingBasic || []).length === 0
)
const canFace = computed(() => t.value?.verifyStatus === '已核验' && !!t.value?.certified && !t.value?.faceRegistered)

/* ---------- 动作：失败就如实报错（门槛不满足时 PC 的文案更细） ---------- */
function verifyNow() {
  if (t.value?.verifyStatus === '已核验') {
    toast('该租户已核验')
    return
  }
  if (!canVerify.value) {
    toastErr(`还差 ${(fill.value.missingBasic || []).join('、')}，补全后再核验`)
    return
  }
  try {
    verifyTenantBy(persona.value, tenantId.value, { pass: true })
    load()
    toastOk('已核验')
  } catch (e) {
    toastErr(e.message || '核验失败')
  }
}

function rejectNow() {
  moreSheet.value = false
  try {
    verifyTenantBy(persona.value, tenantId.value, { pass: false, note: '现场核实信息不全，已告知补资料' })
    load()
    toastOk('已标记为「信息不全」')
  } catch (e) {
    toastErr(e.message || '操作失败')
  }
}

function faceNow() {
  if (!canFace.value) {
    toastErr('需先完成核验与实名认证')
    return
  }
  moreSheet.value = false
  try {
    registerFaceBy(persona.value, tenantId.value)
    load()
    toastOk('人脸已录入，门禁生效')
  } catch (e) {
    toastErr(e.message || '录入失败')
  }
}

function openFill() {
  moreSheet.value = false
  const row = t.value || {}
  patchFields.value.forEach(f => {
    form[f.key] = row[f.key] ?? ''
  })
  fillSheet.value = true
}

function saveFill() {
  const patch = {}
  patchFields.value.forEach(f => {
    if (form[f.key] !== '' && form[f.key] !== undefined) patch[f.key] = f.type === 'number' ? Number(form[f.key]) : form[f.key]
  })
  try {
    saveTenantFields(persona.value, tenantId.value, patch)
    fillSheet.value = false
    load()
    toastOk('已保存')
  } catch (e) {
    toastErr(e.message || '保存失败')
  }
}

function openMoveOut() {
  moreSheet.value = false
  outSheet.value = true
}

function moveOutNow() {
  try {
    moveOutBy(persona.value, tenantId.value, { reason: outReason.value })
    outSheet.value = false
    load()
    toastOk('已标记搬离')
    setTimeout(() => uni.navigateBack(), 700)
  } catch (e) {
    toastErr(e.message || '操作失败')
  }
}

onLoad(o => {
  tenantId.value = o.tenantId || ''
  load()
})

onShow(() => {
  if (tenantId.value) load()
})
</script>

<style scoped>
.hd {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
}

.hd__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.hd__top {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.hd__n {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.hd__type {
  font-size: 17rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.hd__d {
  font-size: 20rpx;
  color: var(--biz-text-3);
  line-height: 1.5;
}

.badge {
  flex: none;
  font-size: 19rpx;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
}

.badge.is-ok {
  color: var(--biz-accent-dark);
  background: #e6faf3;
}

.badge.is-wait {
  color: #a35c13;
  background: #fff7ed;
}

.badge.is-ng {
  color: var(--biz-danger);
  background: #fff0f0;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 16rpx;
}

.tg {
  font-size: 18rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 8rpx;
  padding: 4rpx 10rpx;
}

.tg.is-ok {
  color: var(--biz-accent-dark);
  background: #e6faf3;
}

.tg.is-warn {
  color: #a35c13;
  background: #fff7ed;
}

.bar {
  height: 12rpx;
  border-radius: 999rpx;
  background: var(--biz-bg-fill);
  overflow: hidden;
}

.bar__in {
  height: 100%;
  border-radius: 999rpx;
  background: var(--biz-gradient);
}

.bar__t {
  display: block;
  margin: 8rpx 0 6rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.gates {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 8rpx;
}

.gate {
  display: flex;
  align-items: center;
  gap: 8rpx;
  background: var(--biz-bg-fill);
  border-radius: 10rpx;
  padding: 10rpx 14rpx;
}

.gate__i {
  width: 26rpx;
  height: 26rpx;
  border-radius: 50%;
  background: var(--biz-accent);
  color: #fff;
  font-size: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gate__i.is-miss {
  background: var(--biz-warning);
}

.gate__t {
  font-size: 20rpx;
  color: var(--biz-text-2);
}

.gate__s {
  font-size: 17rpx;
  color: var(--biz-accent-dark);
}

.gate__s.is-miss {
  color: #a35c13;
}

.note {
  display: block;
  margin-top: 14rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.note--warn {
  color: #a35c13;
  background: #fff7ed;
  border-radius: 10rpx;
  padding: 12rpx 14rpx;
}

.kv {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding: 10rpx 0;
}

.kv__k {
  flex: none;
  width: 110rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.kv__v {
  flex: 1;
  font-size: 24rpx;
  color: var(--biz-text-1);
}

.kv__v.is-od {
  color: var(--biz-danger);
}

.hs {
  display: flex;
  gap: 14rpx;
  padding: 12rpx 0;
}

.hs__dot {
  flex: none;
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: var(--biz-border);
  margin-top: 10rpx;
}

.hs__dot.is-done {
  background: var(--biz-accent);
}

.hs__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.hs__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
}

.hs__a {
  font-size: 23rpx;
  color: var(--biz-text-1);
}

.hs__t {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.hs__m {
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.op {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 22rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.op:last-of-type {
  border-bottom: none;
}

.op.is-off {
  opacity: 0.5;
}

.op__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.op__t {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.op--danger .op__t {
  color: var(--biz-danger);
}

.op__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.op__chev {
  font-size: 30rpx;
  color: var(--biz-text-4);
}

.fld {
  padding: 14rpx 0;
}

.fld__k {
  display: block;
  font-size: 22rpx;
  color: var(--biz-text-3);
  margin-bottom: 10rpx;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.chip {
  height: 60rpx;
  padding: 0 20rpx;
  border-radius: 12rpx;
  background: var(--biz-bg-fill);
  font-size: 23rpx;
  color: var(--biz-text-2);
  display: flex;
  align-items: center;
}

.foot-btn {
  flex: 1;
  height: 88rpx;
  font-size: 28rpx;
}

.foot-full {
  width: 100%;
  height: 88rpx;
  margin-top: 22rpx;
  font-size: 28rpx;
}

.chip.is-on {
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 2rpx var(--biz-primary);
}
</style>
