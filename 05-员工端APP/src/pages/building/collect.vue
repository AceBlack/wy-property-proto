<template>
  <view class="page">
    <NavBar title="批量催缴" :subtitle="s ? `${s.debtHouses} 户欠费 · ${money(s.debtAmount)}` : ''" />

    <view class="body body--with-foot">
      <NoPerm
        v-if="!allowed"
        title="催缴只对楼栋管家开放"
        sub="数据范围是「责任范围」：只能催自己名下楼栋的欠费户。"
        perm="a.stewards.view"
      />

      <template v-else>
        <!-- 口径说明：和 PC 的催缴工作台同一套 -->
        <view class="hint">
          <text class="hint__t">按房屋聚合，不按账单逐条催</text>
          <text class="hint__d">
            一户挂了三个月账也只出现一行；勾选后生成一个催缴批次，可按批次追溯。
            只管催、不管收 —— 谈成了引导业主到小程序缴费。
          </text>
        </view>

        <!-- 快捷筛选 -->
        <view class="filters">
          <view class="filters__row">
            <text class="filters__k">账龄</text>
            <view class="chips">
              <text
                v-for="a in AGING_OPTS"
                :key="'a' + a.key"
                :id="`aging-${a.key || 'all'}`"
                class="chip"
                :class="{ 'is-on': aging === a.key }"
                @tap="setAging(a.key)"
              >{{ a.label }}</text>
            </view>
          </view>
          <view class="filters__row">
            <text class="filters__k">费项</text>
            <view class="chips">
              <text
                id="item-all"
                class="chip"
                :class="{ 'is-on': !item }"
                @tap="setItem('')"
              >全部</text>
              <text
                v-for="it in ITEM_OPTS"
                :key="'i' + it"
                :id="`item-${it}`"
                class="chip"
                :class="{ 'is-on': item === it }"
                @tap="setItem(it)"
              >{{ it }}</text>
            </view>
          </view>
          <view class="filters__row">
            <text class="filters__k">去重</text>
            <view class="chips">
              <text id="skip-recent" class="chip" :class="{ 'is-on': skipRecent }" @tap="toggleSkip">
                {{ skipRecent ? '7 天内催过的不再勾选' : '包含 7 天内催过的户' }}
              </text>
            </view>
          </view>
        </view>

        <!-- 汇总 -->
        <view class="pick">
          <view class="pick__i">
            <text class="pick__n num">{{ pickedRows.length }}</text>
            <text class="pick__k">已选户</text>
          </view>
          <view class="pick__i">
            <text class="pick__n num danger">{{ money(pickedTotal) }}</text>
            <text class="pick__k">催缴金额</text>
          </view>
          <view class="pick__i">
            <text class="pick__n num">{{ rows.length - pickedRows.length }}</text>
            <text class="pick__k">未选</text>
          </view>
          <view class="pick__act">
            <text id="pick-all" class="pick__btn" @tap="pickAll">全选可催</text>
            <text id="pick-none" class="pick__btn" @tap="pickNone">清空</text>
          </view>
        </view>

        <!-- 列表 -->
        <view
          v-for="r in rows"
          :key="r.houseId"
          :id="`row-${r.houseId}`"
          class="row"
          :class="{ 'is-off': !r.canPick, 'is-picked': picked[r.houseId] }"
          @tap="toggle(r)"
        >
          <view class="row__box" :class="{ 'is-on': picked[r.houseId] }">
            <text v-if="picked[r.houseId]" class="row__tick">✓</text>
          </view>
          <view class="row__l">
            <view class="row__top">
              <text class="row__room">{{ r.houseName }}</text>
              <text v-if="r.recent" class="row__tag">7 天内已催</text>
              <text v-else-if="r.maxOverdue > 30" class="row__tag is-od">逾期 {{ r.maxOverdue }} 天</text>
            </view>
            <text class="row__o">{{ r.ownerName }} · {{ maskPhone(r.ownerPhone) }}</text>
            <text class="row__d">{{ r.count }} 张账 · 起 {{ r.oldestPeriod }}{{ r.lastAt ? ` · 上次 ${r.lastMethod} ${r.lastAt.slice(5, 10)}` : ' · 从未催过' }}</text>
          </view>
          <text class="row__amt num">{{ money(r.debt) }}</text>
        </view>

        <Empty v-if="!rows.length" text="这个筛选下没有欠费户" sub="换账龄或费项试试 —— 演示数据里逾期 60 天以上的户是 0" />
      </template>
    </view>

    <view v-if="allowed" class="footbar">
      <view class="foot__l">
        <text class="foot__n num">{{ pickedRows.length }}</text>
        <text class="foot__k">户 · {{ money(pickedTotal) }}</text>
      </view>
      <view id="batch-create" class="btn btn--primary foot-btn" :class="{ 'btn--disabled': !pickedRows.length }" @tap="openSheet">
        生成催缴单
      </view>
    </view>

    <!-- 选方式并生成 -->
    <Sheet v-model:show="sheet" title="生成催缴单" :sub="`${pickedRows.length} 户 · ${money(pickedTotal)}`" max-height="62vh">
      <view class="chips">
        <text
          v-for="m in METHODS"
          :key="m"
          :id="`method-${m}`"
          class="chip"
          :class="{ 'is-on': method === m }"
          @tap="method = m"
        >{{ m }}</text>
      </view>
      <textarea
        v-model="note"
        class="textarea"
        style="margin-top: 16rpx"
        :maxlength="60"
        placeholder="备注（选填）：如「本月第三次提醒，业主承诺月底前缴」"
        placeholder-class="ph-txt"
      />
      <text class="sheet__hint">
        短信 / 微信由后台短信通道发送并落催缴记录；选「电话」只登记"我今天逐个打"，不会自动发消息。
        生成后这批带同一个批次号，PC 的催缴历史里能按批次查到。
      </text>
      <view class="sheet__act">
        <view class="btn btn--line" @tap="sheet = false">取消</view>
        <view id="batch-confirm" class="btn btn--primary" @tap="doCreate">确认生成</view>
      </view>
    </Sheet>

    <!-- 结果 -->
    <Sheet v-model:show="doneSheet" title="催缴单已生成" sub="只发提醒，不收款" max-height="58vh">
      <view class="done">
        <text class="done__no num">{{ lastBatch.batchNo }}</text>
        <view class="done__row">
          <text class="done__k">户数</text>
          <text class="done__v num">{{ lastBatch.count }} 户</text>
        </view>
        <view class="done__row">
          <text class="done__k">金额</text>
          <text class="done__v num">{{ money(lastBatch.amount) }}</text>
        </view>
        <view class="done__row">
          <text class="done__k">方式</text>
          <text class="done__v">{{ lastBatch.method }}</text>
        </view>
      </view>
      <text class="done__d">
        这 {{ lastBatch.count }} 户 7 天内不会再被默认勾选。业主缴费后账单自动销账，催缴记录保留。
      </text>
      <view class="sheet__act">
        <view id="batch-back" class="btn btn--primary" @tap="back">回楼栋页</view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import { DEMO } from '@/config/personas'
import Sheet from '@/components/Sheet.vue'
import Empty from '@/components/Empty.vue'
import NoPerm from '@/components/NoPerm.vue'
import { AGING_OPTS, ITEM_OPTS, collectWorkSet, makeBatchNo, maskPhone, scopeSummary } from '@/api/building'
import { CAP, can } from '@/config/personas'
import { money } from '@/utils/format'
import { addCollection, app, persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const METHODS = ['短信', '微信', '电话']

const ver = ref(0)
const aging = ref('')
const item = ref('')
const skipRecent = ref(true)
const picked = ref({})
const sheet = ref(false)
const doneSheet = ref(false)
const method = ref('短信')
const note = ref('')
const lastBatch = ref({ batchNo: '', count: 0, amount: 0, method: '' })

const allowed = computed(() => can(persona.value, CAP.building) && !!persona.value?.empId)
const empId = computed(() => persona.value?.empId || '')
const s = computed(() => (ver.value, empId.value ? scopeSummary(empId.value) : null))
const rows = computed(() =>
  (ver.value,
  empId.value
    ? collectWorkSet(empId.value, {
        aging: aging.value,
        item: item.value,
        skipRecent: skipRecent.value,
        localRecords: app.collections
      })
    : [])
)

/* 默认勾上所有"可催"的户：一键催缴的语义是"按筛选全选"，不是让管家点 106 下 */
function pickable() {
  const map = {}
  rows.value.forEach(r => {
    if (r.canPick) map[r.houseId] = true
  })
  return map
}
picked.value = {}

const pickedRows = computed(() => rows.value.filter(r => picked.value[r.houseId]))
const pickedTotal = computed(() => pickedRows.value.reduce((sum, r) => sum + r.debt, 0))

onShow(() => {
  ver.value++
  if (!Object.keys(picked.value).length) picked.value = pickable()
})

function setAging(k) {
  aging.value = k
  ver.value++
  picked.value = pickable()
}
function setItem(k) {
  item.value = k
  ver.value++
  picked.value = pickable()
}
function toggleSkip() {
  skipRecent.value = !skipRecent.value
  ver.value++
  picked.value = pickable()
}
function pickAll() {
  picked.value = pickable()
}
function pickNone() {
  picked.value = {}
}
function toggle(r) {
  if (!r.canPick) {
    toastErr('7 天内已催过，默认不再勾选（可关掉「去重」再催）')
    return
  }
  const next = { ...picked.value }
  if (next[r.houseId]) delete next[r.houseId]
  else next[r.houseId] = true
  picked.value = next
}

function openSheet() {
  if (!pickedRows.value.length) {
    toastErr('先勾几户')
    return
  }
  sheet.value = true
}

function doCreate() {
  const list = pickedRows.value
  if (!list.length) return
  const batchNo = makeBatchNo(app.collections, DEMO.today)
  list.forEach(r => {
    addCollection({
      houseId: r.houseId,
      houseName: r.houseName,
      ownerName: r.ownerName,
      method: method.value,
      result: method.value === '电话' ? '电话催缴（已联系）' : '已发送提醒',
      note: note.value.trim(),
      amount: r.debt,
      batchNo,
      by: persona.value?.name || ''
    })
  })
  lastBatch.value = { batchNo, count: list.length, amount: pickedTotal.value, method: method.value }
  sheet.value = false
  doneSheet.value = true
  ver.value++
  picked.value = pickable()
  toastOk(`已生成 ${batchNo}`)
}

function back() {
  doneSheet.value = false
  uni.navigateBack()
}
</script>

<style scoped>
.hint {
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  background: var(--biz-primary-light-9);
  margin-bottom: 16rpx;
}

.hint__t {
  display: block;
  font-size: 23rpx;
  font-weight: 600;
  color: var(--biz-primary);
}

.hint__d {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.filters {
  background: #fff;
  border-radius: 18rpx;
  padding: 8rpx 18rpx 16rpx;
  margin-bottom: 16rpx;
  box-shadow: var(--biz-shadow-card);
}

.filters__row {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  padding-top: 14rpx;
}

.filters__k {
  flex: none;
  width: 60rpx;
  font-size: 21rpx;
  color: var(--biz-text-4);
  padding-top: 8rpx;
}

.chips {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.chip {
  font-size: 21rpx;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: var(--biz-bg-fill);
  color: var(--biz-text-2);
  border: 2rpx solid transparent;
}

.chip.is-on {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-color: var(--biz-primary);
  font-weight: 600;
}

.pick {
  display: flex;
  align-items: center;
  gap: 8rpx;
  background: #fff;
  border-radius: 18rpx;
  padding: 16rpx 18rpx;
  margin-bottom: 16rpx;
  box-shadow: var(--biz-shadow-card);
}

.pick__i {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.pick__n {
  font-size: 30rpx;
  color: var(--biz-text-1);
}

.pick__n.danger {
  color: var(--biz-danger);
  font-size: 26rpx;
}

.pick__k {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.pick__act {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  align-items: flex-end;
}

.pick__btn {
  font-size: 19rpx;
  color: var(--biz-primary);
}

.row {
  display: flex;
  align-items: center;
  gap: 14rpx;
  background: #fff;
  border-radius: 18rpx;
  padding: 20rpx 18rpx;
  margin-bottom: 12rpx;
  box-shadow: var(--biz-shadow-card);
  border: 2rpx solid transparent;
}

.row.is-picked {
  border-color: var(--biz-primary);
}

.row.is-off {
  opacity: 0.62;
}

.row__box {
  flex: none;
  width: 36rpx;
  height: 36rpx;
  border-radius: 8rpx;
  border: 2rpx solid var(--biz-border);
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}

.row__box.is-on {
  background: var(--biz-primary);
  border-color: var(--biz-primary);
}

.row__tick {
  font-size: 22rpx;
  color: #fff;
  line-height: 1;
}

.row__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.row__top {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
}

.row__room {
  font-size: 25rpx;
  color: var(--biz-text-1);
  font-weight: 600;
}

.row__tag {
  font-size: 17rpx;
  color: #a35c13;
  background: #fff7ed;
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.row__tag.is-od {
  color: var(--biz-danger);
  background: #fff0f0;
}

.row__o {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.row__d {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.row__amt {
  flex: none;
  font-size: 26rpx;
  color: var(--biz-danger);
}

.footbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 28rpx;
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 2rpx solid var(--biz-border-light);
}

.foot__l {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}

.foot__n {
  font-size: 34rpx;
  color: var(--biz-text-1);
}

.foot__k {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.foot-btn {
  flex: 1;
}

.sheet__hint {
  display: block;
  margin-top: 14rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
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

.done {
  padding: 6rpx 0 4rpx;
}

.done__no {
  display: block;
  font-size: 34rpx;
  color: var(--biz-primary);
  margin-bottom: 14rpx;
}

.done__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.done__k {
  font-size: 23rpx;
  color: var(--biz-text-3);
}

.done__v {
  font-size: 25rpx;
  color: var(--biz-text-1);
}

.done__d {
  display: block;
  margin-top: 14rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.ph-txt {
  color: var(--biz-text-4);
}
</style>
