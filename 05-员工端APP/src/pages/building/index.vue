<template>
  <view class="page">
    <NavBar title="我的楼栋" :subtitle="persona?.orgName || ''" />

    <view class="body">
      <NoPerm
        v-if="!allowed"
        title="楼栋工作台只对楼栋管家开放"
        sub="数据范围是「责任范围」：只有 buildingStewards 里挂了自己名字的楼栋才可见。班组长与项目经理看的是部门/项目视图。"
        perm="a.stewards.view"
      />

      <template v-else>
      <!-- 责任范围汇总 -->
      <view class="card sum">
        <view class="sum__row">
          <view class="sum__i">
            <text class="sum__n num">{{ s.buildings.length }}</text>
            <text class="sum__k">责任楼栋</text>
          </view>
          <view class="sum__i">
            <text class="sum__n num">{{ s.houseCount }}</text>
            <text class="sum__k">房屋</text>
          </view>
          <view class="sum__i">
            <text class="sum__n num danger">{{ s.debtHouses }}</text>
            <text class="sum__k">欠费户</text>
          </view>
          <view class="sum__i">
            <text class="sum__n num">{{ s.rate.toFixed(1) }}</text>
            <text class="sum__k">收缴率 %</text>
          </view>
        </view>
        <view class="sum__debt">
          <text class="sum__debt-k">责任范围欠费</text>
          <text class="sum__debt-v num">{{ money(s.debtAmount) }}</text>
          <text class="sum__debt-d">{{ s.debtCount }} 张账单 · 只催不收</text>
        </view>
      </view>

      <!-- 一键催缴：按筛选批量生成催缴单（照 PC 催缴工作台的口径） -->
      <view id="batch-entry" class="batch" hover-class="batch--hover" @tap="goBatch">
        <view class="batch__l">
          <text class="batch__t">批量催缴</text>
          <text class="batch__d">按账龄 / 费项筛选，勾选后生成同一批次；7 天内催过的默认不重复</text>
        </view>
        <view class="batch__r">
          <text class="batch__n num">{{ s.debtHouses }}</text>
          <text class="batch__k">户待催</text>
        </view>
        <view class="batch__chev" />
      </view>

      <!-- 一键催缴：按筛选批量生成催缴单（照 PC 催缴工作台的口径） -->
      <view id="batch-entry" class="batch" hover-class="batch--hover" @tap="goBatch">
        <view class="batch__l">
          <text class="batch__t">批量催缴</text>
          <text class="batch__d">按账龄 / 费项筛选，勾选后生成同一批次；7 天内催过的默认不重复</text>
        </view>
        <view class="batch__r">
          <text class="batch__n num">{{ s.debtHouses }}</text>
          <text class="batch__k">户待催</text>
        </view>
        <view class="batch__chev" />
      </view>

      <!-- 楼栋筛选 -->
      <scroll-view scroll-x class="bld">
        <view class="bld__i" :class="{ 'is-on': !buildingId }" @tap="buildingId = ''">全部</view>
        <view
          v-for="b in s.buildings"
          :key="b.buildingId"
          class="bld__i"
          :class="{ 'is-on': buildingId === b.buildingId }"
          @tap="buildingId = b.buildingId"
        >
          {{ b.name }}<text class="bld__n">{{ b.houses }}</text>
        </view>
      </scroll-view>

      <view class="sec-hd" style="margin: 6rpx 4rpx 16rpx">
        <text class="sec-hd__t">欠费户</text>
        <text class="sec-hd__d">{{ rows.length }} 户 · 按欠费额排序</text>
      </view>

      <view v-for="h in rows" :key="h.houseId" class="hh" hover-class="hh--hover" @tap="openHouse(h)">
        <view class="hh__l">
          <text class="hh__room">{{ h.houseName }}</text>
          <text class="hh__owner">{{ h.ownerName }} · {{ maskPhone(h.ownerPhone) }}</text>
          <view class="hh__tags">
            <text class="hh__tag">{{ h.count }} 张账</text>
            <text class="hh__tag" :class="{ 'is-od': h.maxOverdue > 30 }">最长逾期 {{ h.maxOverdue }} 天</text>
            <text class="hh__tag is-from">起 {{ h.oldestPeriod }}</text>
          </view>
        </view>
        <view class="hh__r">
          <text class="hh__amt num">{{ money(h.debt) }}</text>
          <text v-if="lastOf(h.houseId)" class="hh__last">上次 {{ lastOf(h.houseId).method }} · {{ lastOf(h.houseId).result }}</text>
          <text v-else class="hh__last is-none">未跟进</text>
        </view>
      </view>

      <Empty v-if="!rows.length" text="责任范围没有欠费户" sub="换栋楼看看，或这栋确实已经收齐" />
      </template>
    </view>

    <!-- 一户详情 + 催收 -->
    <Sheet v-model:show="sheet" :title="cur?.houseName || ''" :sub="`${cur?.ownerName || ''} · ${cur?.count || 0} 张欠费账单`" max-height="72vh">
      <template v-if="cur">
        <view class="dbt">
          <text class="dbt__k">合计欠费</text>
          <text class="dbt__v num">{{ money(cur.debt) }}</text>
        </view>

        <view v-for="b in cur.items" :key="b.billId" class="bill">
          <view class="bill__l">
            <text class="bill__t">{{ b.itemName }}</text>
            <text class="bill__d">账期 {{ b.period }} · 应缴 {{ b.dueDate }}</text>
          </view>
          <view class="bill__r">
            <text class="bill__amt num">{{ money(b.unpaid) }}</text>
            <text class="bill__s" :class="{ 'is-od': b.overdueDays > 0 }">{{ b.overdueDays > 0 ? `逾期 ${b.overdueDays} 天` : b.status }}</text>
          </view>
        </view>

        <view class="follow">
          <view class="sec-hd">
            <text class="sec-hd__t">催收跟进</text>
            <text class="sec-hd__d">{{ logs.length }} 条</text>
          </view>
          <view v-for="l in logs" :key="l.id" class="log">
            <text class="log__h">{{ l.method }} · {{ l.result }}</text>
            <text class="log__d">{{ l.at }} · {{ l.by }}</text>
            <text v-if="l.note" class="log__n">{{ l.note }}</text>
            <text v-if="l.nextAt" class="log__next">下次跟进 {{ l.nextAt }}</text>
          </view>
          <text v-if="!logs.length" class="log__none">还没跟进过。第一次上门前先打个电话，能省一趟腿。</text>
        </view>

        <view class="row2">
          <view id="open-house" class="btn btn--line" @tap="openHouseDetail">业主与房屋</view>
          <view id="add-follow" class="btn btn--primary" @tap="openFollow">记录一次跟进</view>
        </view>
        <text class="note">管家只催不收：移动端没有收款动作，谈成了请引导业主在小程序缴费或到收银台。</text>
      </template>
    </Sheet>

    <!-- 跟进表单 -->
    <Sheet v-model:show="followSheet" title="记录催收" :sub="cur?.houseName || ''" max-height="66vh">
      <text class="fk">方式</text>
      <view class="chips">
        <text v-for="m in COLLECT_METHODS" :key="m" class="chip" :class="{ 'is-on': method === m }" @tap="method = m">{{ m }}</text>
      </view>
      <text class="fk" style="margin-top: 16rpx">结果</text>
      <view class="chips">
        <text v-for="r in COLLECT_RESULTS" :key="r" class="chip" :class="{ 'is-on': result === r }" @tap="result = r">{{ r }}</text>
      </view>
      <textarea v-model="note" class="textarea" style="margin-top: 18rpx" :maxlength="100" placeholder="业主怎么说的（选填）" placeholder-class="ph-txt" />
      <view class="fk" style="margin-top: 12rpx">下次跟进</view>
      <view class="chips">
        <text v-for="d in nextOpts" :key="d.value" class="chip" :class="{ 'is-on': nextAt === d.value }" @tap="nextAt = d.value">{{ d.label }}</text>
      </view>
      <view class="sheet__act">
        <view class="btn btn--line" @tap="followSheet = false">取消</view>
        <view id="save-follow" class="btn btn--primary" @tap="saveFollow">保存</view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Sheet from '@/components/Sheet.vue'
import Empty from '@/components/Empty.vue'
import NoPerm from '@/components/NoPerm.vue'
import { COLLECT_METHODS, COLLECT_RESULTS, debtHouseholds, maskPhone, scopeRowsCount, scopeSummary } from '@/api/building'
import { money } from '@/utils/format'
import { DEMO, CAP, can } from '@/config/personas'
import { addCollection, app, collectionsOf, persona } from '@/store/app'
import { toast, toastErr } from '@/utils/ui'

const buildingId = ref('')
const sheet = ref(false)
const followSheet = ref(false)
const curId = ref('')
const ver = ref(0)
const method = ref('电话')
const result = ref('承诺还款')
const note = ref('')
const nextAt = ref('')

const nextOpts = [
  { label: '3 天后', value: '3 天后' },
  { label: '1 周后', value: '1 周后' },
  { label: '月底', value: '月底' },
  { label: '暂不设', value: '' }
]

const allowed = computed(() => can(persona.value, CAP.building) && !!persona.value?.empId && scopeRowsCount(persona.value.empId) > 0)
const s = computed(() => (ver.value, persona.value?.empId ? scopeSummary(persona.value.empId) : { buildings: [], houseCount: 0, debtHouses: 0, rate: 0, debtAmount: 0, debtCount: 0 }))
const rows = computed(() => (ver.value, persona.value?.empId ? debtHouseholds(persona.value.empId, { buildingId: buildingId.value }) : []))
const cur = computed(() => rows.value.find(r => r.houseId === curId.value) || null)
const logs = computed(() => (ver.value, curId.value ? collectionsOf(curId.value) : []))

const lastOf = houseId => collectionsOf(houseId)[0] || null

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  ver.value++
})

function openHouse(h) {
  curId.value = h.houseId
  sheet.value = true
}

function goBatch() {
  uni.navigateTo({ url: '/pages/building/collect' })
}

function openHouseDetail() {
  if (!cur.value) return
  uni.navigateTo({ url: `/pages/building/house?houseId=${cur.value.houseId}` })
}

function openFollow() {
  method.value = '电话'
  result.value = '承诺还款'
  note.value = ''
  nextAt.value = '3 天后'
  followSheet.value = true
}

function saveFollow() {
  if (!cur.value) return
  addCollection({
    houseId: cur.value.houseId,
    houseName: cur.value.houseName,
    ownerName: cur.value.ownerName,
    method: method.value,
    result: result.value,
    note: note.value.trim(),
    nextAt: nextAt.value,
    by: persona.value?.name || '',
    demoDate: DEMO.today
  })
  followSheet.value = false
  ver.value++
  toast('已记录本次跟进')
}
</script>

<style scoped>
.sum {
  padding-bottom: 12rpx;
}

.sum__row {
  display: flex;
}

.sum__i {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}

.sum__n {
  font-size: 40rpx;
  line-height: 1;
  color: var(--biz-text-1);
}

.sum__n.danger {
  color: var(--biz-danger);
}

.sum__k {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.sum__debt {
  margin-top: 22rpx;
  padding-top: 18rpx;
  border-top: 2rpx dashed var(--biz-border-light);
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.sum__debt-k {
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.sum__debt-v {
  font-size: 34rpx;
  color: var(--biz-danger);
}

.sum__debt-d {
  margin-left: auto;
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.batch {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx;
  margin: 16rpx 0;
  box-shadow: var(--biz-shadow-card);
}

.batch--hover {
  background: var(--biz-bg-hover);
}

.batch__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.batch__t {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.batch__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.batch__r {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.batch__n {
  font-size: 32rpx;
  color: var(--biz-danger);
  line-height: 1.1;
}

.batch__k {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.batch__chev {
  flex: none;
  width: 14rpx;
  height: 14rpx;
  border-top: 3rpx solid var(--biz-text-4);
  border-right: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
}

.batch {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx;
  margin: 16rpx 0;
  box-shadow: var(--biz-shadow-card);
}

.batch--hover {
  background: var(--biz-bg-hover);
}

.batch__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.batch__t {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.batch__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.batch__r {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.batch__n {
  font-size: 32rpx;
  color: var(--biz-danger);
  line-height: 1.1;
}

.batch__k {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.batch__chev {
  flex: none;
  width: 14rpx;
  height: 14rpx;
  border-top: 3rpx solid var(--biz-text-4);
  border-right: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
}

.bld {
  white-space: nowrap;
  margin: 22rpx 0 6rpx;
}

.bld__i {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  padding: 12rpx 24rpx;
  margin-right: 12rpx;
  border-radius: 999rpx;
  background: #fff;
  font-size: 24rpx;
  color: var(--biz-text-2);
  box-shadow: var(--biz-shadow-card);
}

.bld__i.is-on {
  background: var(--biz-primary);
  color: #fff;
}

.bld__n {
  font-size: 19rpx;
  opacity: 0.7;
}

.hh {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx;
  margin-bottom: 14rpx;
  box-shadow: var(--biz-shadow-card);
}

.hh--hover {
  background: var(--biz-bg-hover);
}

.hh__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.hh__room {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.hh__owner {
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.hh__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 4rpx;
}

.hh__tag {
  font-size: 18rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 999rpx;
  padding: 3rpx 10rpx;
}

.hh__tag.is-od {
  color: var(--biz-danger);
  background: #fff0f0;
}

.hh__tag.is-from {
  font-family: var(--biz-font-num);
}

.hh__r {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6rpx;
}

.hh__amt {
  font-size: 30rpx;
  color: var(--biz-danger);
}

.hh__last {
  font-size: 18rpx;
  color: var(--biz-success);
}

.hh__last.is-none {
  color: var(--biz-text-4);
}

.dbt {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 6rpx 0 16rpx;
}

.dbt__k {
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.dbt__v {
  font-size: 40rpx;
  color: var(--biz-danger);
}

.bill {
  display: flex;
  align-items: center;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.bill__l {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.bill__t {
  font-size: 25rpx;
  color: var(--biz-text-1);
}

.bill__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.bill__r {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
}

.bill__amt {
  font-size: 25rpx;
  color: var(--biz-text-1);
}

.bill__s {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.bill__s.is-od {
  color: var(--biz-danger);
}

.follow {
  margin-top: 20rpx;
}

.log {
  background: var(--biz-bg-fill);
  border-radius: 14rpx;
  padding: 14rpx 16rpx;
  margin-bottom: 10rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.log__h {
  font-size: 23rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.log__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.log__n {
  font-size: 21rpx;
  color: var(--biz-text-2);
}

.log__next {
  font-size: 19rpx;
  color: var(--biz-primary);
}

.log__none {
  font-size: 21rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.row2 {
  margin-top: 18rpx;
  display: flex;
  gap: 14rpx;
}

.row2 .btn {
  flex: 1;
  height: 84rpx;
  font-size: 26rpx;
}

.note {
  display: block;
  margin-top: 14rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.fk {
  display: block;
  font-size: 22rpx;
  font-weight: 600;
  color: var(--biz-text-2);
  margin-bottom: 10rpx;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
}

.chip {
  font-size: 22rpx;
  padding: 10rpx 18rpx;
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

.ph-txt {
  color: var(--biz-text-4);
}

.sheet__act {
  display: flex;
  gap: 16rpx;
  margin-top: 22rpx;
}

.sheet__act .btn {
  flex: 1;
  height: 84rpx;
  font-size: 27rpx;
}
</style>
