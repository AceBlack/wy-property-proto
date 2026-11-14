<template>
  <view class="page">
    <NavBar title="抄表" back />

    <!-- 汇总：数字永远按"我的全部待办"算，切楼栋不会跳 -->
    <view class="sum">
      <view class="sum__i">
        <text class="sum__v num">{{ (s && s.pending) || 0 }}</text>
        <text class="sum__k">待抄</text>
      </view>
      <view class="sum__i">
        <text class="sum__v num">{{ (s && s.done) || 0 }}</text>
        <text class="sum__k">已抄待复核</text>
      </view>
      <view class="sum__i">
        <text class="sum__v num" :class="{ 'is-bad': s && s.abnormal }">{{ (s && s.abnormal) || 0 }}</text>
        <text class="sum__k">异常</text>
      </view>
      <view class="sum__p">{{ (s && s.period) || '' }}</view>
    </view>

    <view v-if="offlineTip" class="offline">
      <text class="offline__t">{{ offlineTip }}</text>
    </view>

    <view v-if="!groups.length" class="empty">
      <Empty text="本期的表都抄完了" sub="等后台复核后推单出账" />
    </view>

    <view v-for="g in groups" :key="g.name" class="grp">
      <view class="grp__h">
        <text class="grp__n">{{ g.name || '未分楼栋' }}</text>
        <text class="grp__c num">{{ g.done }} / {{ g.rows.length }}</text>
      </view>

      <view
        v-for="r in g.rows"
        :key="r.readingId"
        :id="'mt-' + r.readingId"
        class="row"
        :class="{ 'is-done': r.status !== '待录入', 'is-bad': r.abnormal }"
        @tap="open(r)"
      >
        <view class="row__l">
          <view class="row__t">
            <text class="row__house">{{ room(r.houseName) }}</text>
            <text class="tag" :class="r.type === '电表' ? 'tag--e' : 'tag--w'">{{ r.type }}</text>
            <text v-if="r.abnormal" class="tag tag--bad">异常</text>
          </view>
          <text class="row__m">
            {{ r.meterNo }} · 上期 <text class="num strong">{{ r.lastReading }}</text>
          </text>
        </view>
        <view class="row__r">
          <text v-if="r.status === '待录入' && isPending(r.readingId)" class="pending">待同步</text>
          <text v-else-if="r.status === '待录入'" class="btn btn--sm">录入</text>
          <view v-else class="done">
            <text class="done__v num">{{ r.usage }}</text>
            <text class="done__k">{{ r.unit }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="tip">只显示你责任楼栋的表；已推单出账的不在清单里</view>

    <!-- 录入面板 -->
    <Sheet
      v-model:show="sheet"
      :title="cur ? room(cur.houseName) : ''"
      :sub="cur ? `${cur.type} ${cur.meterNo}` : ''"
      max-height="62vh"
    >
      <view v-if="cur" class="panel">
        <view class="last">
          <text class="last__k">上期读数</text>
          <text class="last__v num">{{ cur.lastReading }}</text>
          <text class="last__u">{{ cur.unit }}</text>
        </view>

        <view class="inp">
          <text class="inp__k">本期读数</text>
          <input
            id="mt-input"
            v-model="input"
            class="inp__f num"
            type="digit"
            placeholder="抄表盘上的数字"
            :focus="true"
          />
        </view>

        <view class="usage">
          <text class="usage__k">用量</text>
          <text class="usage__v num" :class="{ 'is-bad': previewAbnormal }">
            {{ previewUsage === null ? '—' : previewUsage }}
          </text>
          <text class="usage__u">{{ cur.unit }}</text>
        </view>

        <view v-if="previewAbnormal" class="warn">
          <text class="warn__t">用量 {{ previewUsage }} {{ cur.unit }}，超过 {{ limit }} {{ cur.unit }} 阈值</text>
          <text class="warn__d">确认读数无误可以直接提交，这条会标成「异常」交后台复核 —— 漏水、换表都可能超</text>
        </view>

        <view v-if="inputErr" class="err">{{ inputErr }}</view>

        <view class="acts">
          <view id="mt-submit" class="btn btn--primary" :class="{ 'is-off': !canSubmit }" @tap="submit">
            确认
          </view>
          <view id="mt-next" class="btn btn--line" @tap="goNext">下一户 →</view>
        </view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Sheet from '@/components/Sheet.vue'
import Empty from '@/components/Empty.vue'
import { abnormalLimitOf, lastMeters, loadMeters, submitReading } from '@/api/meter'
import { app, isOffline, isPending, persona, stageMeterReading } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const data = ref(null)
const sheet = ref(false)
const cur = ref(null)
const input = ref('')
const inputErr = ref('')
const saving = ref(false)

const offlineTip = computed(() => {
  const n = app.pending.filter(p => (p.kind || 'inspect') === 'meter').length
  if (isOffline()) return n ? `当前离线 · ${n} 条读数存在本地，回网自动上传` : '当前离线 · 抄完会先存在本地'
  return n ? `${n} 条读数待上传` : ''
})

const s = computed(() => data.value?.summary || null)
const rows = computed(() => data.value?.rows || [])

/** 按楼栋分组；「待录入」排前面，已抄的沉到底 —— 现场要的是"还有哪几户没抄" */
const groups = computed(() => {
  const map = new Map()
  for (const r of rows.value) {
    const k = r.buildingName || ''
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return [...map.entries()]
    .map(([name, list]) => ({
      name,
      rows: [...list].sort((a, b) => {
        const pa = a.status === '待录入' ? 0 : 1
        const pb = b.status === '待录入' ? 0 : 1
        if (pa !== pb) return pa - pb
        return String(a.houseName).localeCompare(String(b.houseName), 'zh') ||
          String(a.type).localeCompare(String(b.type), 'zh')
      }),
      done: list.filter(r => r.status !== '待录入').length
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
})

/** 「翡翠城 1栋2单元0302」→「2单元0302」，房号才是现场认的 */
const room = name => {
  const t = String(name || '')
  const m = t.match(/(\d+单元\d+|\d{3,4})$/)
  return m ? m[1] : t
}

const limit = computed(() => (cur.value ? abnormalLimitOf(cur.value.type) : 0))

const previewUsage = computed(() => {
  if (!cur.value || input.value === '') return null
  const n = Number(input.value)
  if (Number.isNaN(n)) return null
  return Math.round((n - cur.value.lastReading) * 100) / 100
})

const previewAbnormal = computed(
  () => previewUsage.value !== null && previewUsage.value > limit.value
)

/** 端上只做"能不能提交"的预判；真正的校验在服务端 */
const canSubmit = computed(() => {
  if (!cur.value || input.value === '' || saving.value) return false
  const n = Number(input.value)
  if (Number.isNaN(n) || n < 0) return false
  return n >= cur.value.lastReading
})

function open(r) {
  if (isPending(r.readingId)) {
    toastOk('这条已经抄好了，等回网自动上传 —— 现在重复录会白跑一趟')
    return
  }
  if (r.status !== '待录入') {
    toastOk(`这户已抄过（用量 ${r.usage} ${r.unit}）`)
    return
  }
  cur.value = r
  input.value = ''
  inputErr.value = ''
  sheet.value = true
}

async function reload() {
  try {
    await loadMeters(persona.value)
    data.value = lastMeters()
  } catch (e) {
    toastErr(e?.message || '抄表清单加载失败')
  }
}

async function submit() {
  if (!cur.value || !canSubmit.value) {
    inputErr.value =
      input.value === ''
        ? '请输入本期读数'
        : `本期读数不得小于上期读数（${cur.value.lastReading}）`
    return
  }
  saving.value = true
  const n = Number(input.value)
  const target = cur.value

  /* 先入队，再决定要不要立刻上传 —— 断网直接等回网，在线失败也留在队列里 */
  const queue = () => {
    stageMeterReading({
      readingId: target.readingId,
      currentReading: n,
      houseName: target.houseName,
      type: target.type,
      unit: target.unit
    })
  }

  try {
    if (isOffline()) {
      queue()
      sheet.value = false
      await reload()
      toastOk(`已存到本地：用量 ${n - target.lastReading} ${target.unit}，回网后自动上传`)
      return
    }

    const r = await submitReading(persona.value, target.readingId, n)
    await reload()
    sheet.value = false
    toastOk(
      r.abnormal
        ? `已提交：用量 ${r.usage} ${target.unit}，标为异常待复核`
        : `已提交：用量 ${r.usage} ${target.unit}`
    )
  } catch (e) {
    /*
     * 在线但提交失败：网络抖动、服务端 5xx 都归这一类 —— 入队比让师傅重录好。
     * 但校验类错误（小于上期、超量程）不该入队，那是读数本身有问题，得当场改。
     */
    const msg = String(e?.message || '')
    const isValidation = /不得小于|量程|不能为负|请输入有效|不能再录入/.test(msg)
    if (isValidation) {
      inputErr.value = msg || '提交失败'
    } else {
      queue()
      sheet.value = false
      await reload()
      toastOk('网络不给力，已存到本地，回网后自动上传')
    }
  } finally {
    saving.value = false
  }
}

/** 下一户：按分组顺序找当前行之后第一条待抄 */
function goNext() {
  const flat = groups.value.flatMap(g => g.rows)
  const i = flat.findIndex(r => r.readingId === cur.value?.readingId)
  const next = flat.slice(i + 1).find(r => r.status === '待录入')
  if (!next) {
    sheet.value = false
    toastOk('这一栋抄完了')
    return
  }
  cur.value = next
  input.value = ''
  inputErr.value = ''
}

onLoad(async () => {
  await reload()
})
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: var(--bg);
  padding-bottom: 40rpx;
}
.sum {
  display: flex;
  align-items: flex-end;
  gap: 40rpx;
  margin: 16rpx 24rpx 8rpx;
  padding: 24rpx 28rpx;
  background: var(--card);
  border-radius: 20rpx;
  position: relative;
}
.sum__i {
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}
.sum__v {
  font-size: 44rpx;
  font-weight: 600;
  color: var(--ink);
  line-height: 1;
}
.sum__v.is-bad {
  color: #c0392b;
}
.sum__k {
  font-size: 22rpx;
  color: var(--muted);
}
.sum__p {
  position: absolute;
  right: 28rpx;
  bottom: 24rpx;
  font-size: 22rpx;
  color: var(--muted);
}
.grp {
  margin: 16rpx 24rpx 0;
  background: var(--card);
  border-radius: 20rpx;
  overflow: hidden;
}
.grp__h {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 28rpx;
  background: rgba(0, 0, 0, 0.02);
}
.grp__n {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--ink);
}
.grp__c {
  font-size: 22rpx;
  color: var(--muted);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 28rpx;
  border-top: 1rpx solid var(--line);
}
.row__l {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  min-width: 0;
}
.row__t {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.row__house {
  font-size: 28rpx;
  color: var(--ink);
  font-weight: 500;
}
.row__m {
  font-size: 22rpx;
  color: var(--muted);
}
.strong {
  color: var(--ink);
  font-weight: 600;
}
.tag {
  font-size: 20rpx;
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
}
.tag--e {
  color: #b8860b;
  background: rgba(184, 134, 11, 0.1);
}
.tag--w {
  color: #2d7dd2;
  background: rgba(45, 125, 210, 0.1);
}
.tag--bad {
  color: #c0392b;
  background: rgba(192, 57, 43, 0.1);
}
.row.is-done {
  opacity: 0.55;
}
.row.is-bad {
  background: rgba(192, 57, 43, 0.03);
}
.done {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}
.done__v {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--ink);
}
.done__k {
  font-size: 20rpx;
  color: var(--muted);
}
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 56rpx;
  padding: 0 24rpx;
  border-radius: 28rpx;
  font-size: 24rpx;
  background: var(--ink);
  color: #fff;
}
.btn--sm {
  height: 52rpx;
  padding: 0 22rpx;
  font-size: 22rpx;
}
.btn--line {
  background: transparent;
  color: var(--ink);
  border: 1rpx solid var(--line);
}
.btn--primary {
  flex: 1;
}
.btn.is-off {
  opacity: 0.4;
}
.pending {
  font-size: 22rpx;
  color: #b8860b;
  background: rgba(184, 134, 11, 0.1);
  padding: 6rpx 16rpx;
  border-radius: 6rpx;
}
.offline {
  margin: 12rpx 24rpx 0;
  padding: 16rpx 22rpx;
  background: rgba(184, 134, 11, 0.08);
  border-radius: 14rpx;
}
.offline__t {
  font-size: 22rpx;
  color: #8a6508;
}
.empty {
  margin-top: 120rpx;
}
.tip {
  margin: 24rpx 40rpx 0;
  font-size: 22rpx;
  color: var(--muted);
  line-height: 1.7;
}
.panel {
  padding: 8rpx 4rpx 24rpx;
}
.last {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
  padding: 20rpx 24rpx;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 16rpx;
}
.last__k {
  font-size: 24rpx;
  color: var(--muted);
}
.last__v {
  font-size: 48rpx;
  font-weight: 600;
  color: var(--ink);
  margin-left: auto;
}
.last__u {
  font-size: 22rpx;
  color: var(--muted);
}
.inp {
  margin-top: 20rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 0 24rpx;
  height: 108rpx;
  background: var(--bg);
  border-radius: 16rpx;
  border: 2rpx solid var(--line);
}
.inp__k {
  font-size: 26rpx;
  color: var(--muted);
  flex-shrink: 0;
}
.inp__f {
  flex: 1;
  font-size: 52rpx;
  font-weight: 600;
  color: var(--ink);
  text-align: right;
}
.usage {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  margin-top: 20rpx;
  padding: 0 24rpx;
}
.usage__k {
  font-size: 24rpx;
  color: var(--muted);
}
.usage__v {
  font-size: 40rpx;
  font-weight: 600;
  color: var(--ink);
  margin-left: auto;
}
.usage__v.is-bad {
  color: #c0392b;
}
.usage__u {
  font-size: 22rpx;
  color: var(--muted);
}
.warn {
  margin-top: 20rpx;
  padding: 18rpx 22rpx;
  background: rgba(184, 134, 11, 0.08);
  border-radius: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.warn__t {
  font-size: 24rpx;
  color: #8a6508;
  font-weight: 500;
}
.warn__d {
  font-size: 21rpx;
  color: #8a6508;
  line-height: 1.6;
}
.err {
  margin-top: 16rpx;
  font-size: 23rpx;
  color: #c0392b;
}
.acts {
  display: flex;
  gap: 20rpx;
  margin-top: 28rpx;
}
.acts .btn {
  height: 88rpx;
  font-size: 28rpx;
  border-radius: 44rpx;
}
</style>
