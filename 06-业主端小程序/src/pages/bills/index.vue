<!--
  家庭账单（**多房合并**）
  ------------------------------------------------------------
  2026-11-01 确认的口径：
    · 顶部合计 = 已绑全部房产 + 本人名下不挂房的车位费；
    · 下面按房分组小计（多房必须能看到"哪套房欠的"）；
    · 勾选后合并成一张待支付订单 —— 合并的是**付款动作**，后台入账仍一账单一条。
  三个 tab：待缴 / 历史 / 记录。
-->
<template>
  <view class="page">
    <NavBar title="家庭账单" :subtitle="houses.length > 1 ? `${houses.length} 套合并` : ''">
      <template #right>
        <text class="bl__rec" @tap="tab = 'record'">记录</text>
      </template>
    </NavBar>

    <view class="tabs">
      <view v-for="t in TABS" :key="t.key" :id="`btab-${t.key}`" class="tabs__i" :class="{ 'is-on': tab === t.key }" @tap="tab = t.key">
        <text>{{ t.label }}</text>
      </view>
    </view>

    <view class="body" :class="{ 'body--with-foot': tab === 'due' && picked.length }">
      <!-- 待缴 -->
      <template v-if="tab === 'due'">
        <view class="card sum" :class="{ 'is-clear': !debt.count }">
          <text class="sum__k">{{ debt.count ? '家庭待缴合计' : '账单状态' }}</text>
          <view v-if="debt.count" class="big">
            <text class="big__cur">¥</text>
            <text class="big__num">{{ amount(debt.unpaid) }}</text>
            <text class="big__suf">{{ debt.count }} 张 · {{ debt.periods.length }} 个账期</text>
          </view>
          <view v-else class="sum__clear"><text class="sum__clear-i">✓</text><text>所有账单已结清</text></view>
          <view v-if="debt.count" class="sum__acts">
            <view id="bills-all" class="btn btn--ghost btn--sm" @tap="selectAll"><text>全选</text></view>
            <view id="bills-pay-all" class="btn btn--primary btn--sm" @tap="paySelected">
              <text>缴清所选（{{ picked.length }}）</text>
            </view>
          </view>
        </view>

        <Empty v-if="!groups.length" text="没有要交的账单" sub="换一个筛选条件，或这套房的账单都已结清" />

        <view v-for="g in groups" :key="g.houseId || 'park'" class="card bh">
          <view class="bh__hd">
            <text class="bh__t">{{ g.houseName }}</text>
            <text class="bh__v" :class="{ danger: g.debt }">{{ money(g.debt ? g.unpaid : g.payable) }}</text>
          </view>
          <view
            v-for="b in g.items"
            :key="b.billId"
            class="row"
            :class="{ 'is-picked': picked.includes(b.billId) }"
            @tap="toggleBill(b)"
          >
            <view class="row__box" :class="{ 'is-on': picked.includes(b.billId), 'is-paid': !isDebt(b) }">
              <text v-if="picked.includes(b.billId) || !isDebt(b)">✓</text>
            </view>
            <view class="row__b">
              <view class="row__hd">
                <text class="row__n" :class="{ 'is-debt': isDebt(b) }">{{ b.itemName }}</text>
                <text class="row__v" :class="{ danger: isDebt(b) }">{{ money(isDebt(b) ? b.unpaid : b.payable) }}</text>
              </view>
              <view class="row__d">
                <text>{{ periodText(b.period) }}</text>
                <text class="dot">·</text>
                <text>{{ b.isPark ? '车位费' : `${b.quantity}${unitOf(b.unit)} × ${b.price} 元` }}</text>
                <text v-if="isDebt(b)" class="row__bad">{{ billStateText(b) }}</text>
              </view>
            </view>
          </view>
        </view>
      </template>

      <!-- 历史 -->
      <template v-else-if="tab === 'history'">
        <view v-for="y in years" :key="y.year" class="card hy">
          <view class="hy__hd" @tap="openYear(y.year)">
            <text class="hy__t">{{ y.year }} 年</text>
            <text class="hy__d">{{ y.count }} 张 · 应收 {{ money(y.payable) }}</text>
            <text class="hy__v" :class="{ danger: y.debt }">{{ y.debt ? '欠 ' + money(y.debt) : '已结清' }}</text>
          </view>
          <view v-if="openYearNo === y.year" class="hy__list">
            <view v-for="p in yearPeriods(y.year)" :key="p.period" class="hy__p" @tap="goDetail(p.items[0].billId)">
              <text class="hy__p-t">{{ periodText(p.period) }}</text>
              <text class="hy__p-v">{{ money(p.debt ? p.unpaid : p.payable) }}</text>
              <text class="hy__p-s" :class="{ danger: p.debt }">{{ p.debt ? '待缴' : '已缴' }}</text>
            </view>
          </view>
        </view>
        <Empty v-if="!years.length" text="暂无历史账单" />
      </template>

      <!-- 记录 -->
      <template v-else>
        <view v-for="r in records" :key="r.payId" class="card rc" @tap="goRecord(r)">
          <view class="rc__hd">
            <text class="rc__t">{{ r.title }}</text>
            <text class="rc__v">-{{ money(r.amount) }}</text>
          </view>
          <text class="rc__d">{{ r.paidAt || r.createdAt }} · {{ r.payMethod || '微信支付（模拟）' }}</text>
        </view>
        <Empty v-if="!records.length" text="还没有缴费记录" sub="缴费成功后会出现在这里" />
        <view class="bl__tip">
          <text class="demo-tip">演示</text>
          <text class="bl__tip-t">缴费只到「待支付订单 + 模拟支付成功」，不接真实支付通道。</text>
        </view>
      </template>
    </view>

    <Bar
      v-if="tab === 'due' && picked.length"
      label="已选 {{ picked.length }} 张"
      :amount="money(pickedAmount)"
      hint="跨房合并付款，后台按房拆分入账"
      okText="去缴费"
      btn-id="bills-go-pay"
      @submit="paySelected"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Empty from '@/components/Empty.vue'
import { app } from '@/store/app'
import {
  billsByHouse,
  billsByPeriod,
  billsByYear,
  createBillPay,
  debtSummary,
  isDebt,
  myBills,
  myHouses
} from '@/api/mp'
import { amount, billStateText, money, periodText } from '@/utils/format'
import { go, toast, toastErr } from '@/utils/ui'
import { gatePerm } from '@/utils/guard'

const TABS = [
  { key: 'due', label: '待缴' },
  { key: 'history', label: '历史账单' },
  { key: 'record', label: '缴费记录' }
]

const tab = ref('due')
const picked = ref([])
const openYearNo = ref('')
const ver = ref(0)

const houses = computed(() => {
  ver.value
  return myHouses()
})
const debt = computed(() => {
  ver.value
  return debtSummary()
})
const groups = computed(() => {
  ver.value
  return billsByHouse(myBills({ onlyDebt: true }))
})
const years = computed(() => {
  ver.value
  return billsByYear(myBills())
})
const pickedAmount = computed(() => {
  ver.value
  return myBills()
    .filter(b => picked.value.includes(b.billId))
    .reduce((s, b) => s + (b.unpaid || 0), 0)
})
const records = computed(() => {
  ver.value
  return app.payOrders.filter(p => p.status === '已支付').sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)))
})

onShow(() => {
  if (!gatePerm('bills', '账单缴费')) return
  ver.value++
  picked.value = picked.value.filter(id => {
    const b = myBills().find(x => x.billId === id)
    return b && isDebt(b)
  })
})

const unitOf = u => (String(u || '').includes('㎡') ? ' ㎡' : String(u || '').includes('月') ? ' 月' : '')

function toggleBill(b) {
  if (!isDebt(b)) return toast('这张已缴，不用再交')
  const i = picked.value.indexOf(b.billId)
  if (i >= 0) picked.value.splice(i, 1)
  else picked.value.push(b.billId)
}

function selectAll() {
  picked.value = myBills({ onlyDebt: true }).map(b => b.billId)
  if (!picked.value.length) toast('没有欠费账单')
}

async function paySelected() {
  if (!picked.value.length) return toastErr('先勾选要缴的账单')
  try {
    const pay = await createBillPay(picked.value)
    go('/pages/pay/index', { payId: pay.payId })
  } catch (e) {
    toastErr(e.message || '生成待支付订单失败')
  }
}

function openYear(y) {
  openYearNo.value = openYearNo.value === y ? '' : y
}

function yearPeriods(year) {
  const list = myBills().filter(b => String(b.period).startsWith(year))
  return billsByPeriod(list)
}

const goDetail = id => go('/pages/bills/detail', { id })
const goRecord = r => go('/pages/bills/record', { payId: r.payId })
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.bl__rec { font-size: 22rpx; color: var(--biz-primary); }
.tabs { display: flex; gap: 28rpx; padding: 0 28rpx; border-bottom: 2rpx solid var(--biz-border-light); background: var(--biz-bg-page); }
.tabs__i { padding: 14rpx 0 18rpx; font-size: 27rpx; color: var(--biz-text-3); position: relative; }
.tabs__i.is-on { color: var(--biz-text-1); font-weight: 700; }
.tabs__i.is-on::after { content: ''; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: 44rpx; height: 6rpx; border-radius: 4rpx; background: var(--biz-primary); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 220rpx; }

.sum__k { font-size: 23rpx; color: var(--biz-text-3); display: block; margin-bottom: 10rpx; }
.sum .big { color: var(--biz-danger); }
.sum.is-clear .big { color: var(--biz-accent-dark); }
.sum__clear { display: flex; align-items: center; gap: 12rpx; padding: 10rpx 0; font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.sum__clear-i { width: 40rpx; height: 40rpx; border-radius: 50%; background: var(--biz-accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 22rpx; }
.sum__acts { display: flex; gap: 16rpx; margin-top: 20rpx; }
.sum__acts .btn { flex: 1; }

.bh { padding: 0; overflow: hidden; }
.bh__hd { display: flex; align-items: center; justify-content: space-between; padding: 20rpx 24rpx; background: var(--biz-bg-fill); }
.bh__t { font-size: 26rpx; font-weight: 600; color: var(--biz-text-1); }
.bh__v { font-family: var(--biz-font-num); font-size: 27rpx; font-weight: 700; color: var(--biz-text-1); }

.row { display: flex; gap: 16rpx; align-items: flex-start; padding: 20rpx 24rpx; border-top: 2rpx solid var(--biz-border-light); }
.row.is-picked { background: var(--biz-primary-light-9); }
.row__box { flex: none; width: 34rpx; height: 34rpx; border-radius: 50%; border: 3rpx solid var(--biz-border); display: flex; align-items: center; justify-content: center; font-size: 19rpx; color: #fff; margin-top: 4rpx; }
.row__box.is-on { background: var(--biz-primary); border-color: var(--biz-primary); }
.row__box.is-paid { background: var(--biz-accent-light-9); border-color: var(--biz-accent); color: var(--biz-accent-dark); }
.row__b { flex: 1; min-width: 0; }
.row__hd { display: flex; align-items: baseline; justify-content: space-between; gap: 16rpx; }
.row__n { font-size: 26rpx; color: var(--biz-text-2); }
.row__n.is-debt { color: var(--biz-text-1); font-weight: 600; }
.row__v { flex: none; font-family: var(--biz-font-num); font-size: 27rpx; font-weight: 700; color: var(--biz-text-2); }
.row__d { display: flex; gap: 8rpx; flex-wrap: wrap; margin-top: 8rpx; font-size: 20rpx; color: var(--biz-text-4); }
.row__bad { color: var(--biz-danger); background: #fff0f1; border-radius: 4rpx; padding: 1rpx 8rpx; }
.dot { color: var(--biz-text-4); }

.hy { padding: 0; }
.hy__hd { display: flex; align-items: center; gap: 14rpx; padding: 24rpx; }
.hy__t { font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); font-family: var(--biz-font-num); }
.hy__d { flex: 1; font-size: 21rpx; color: var(--biz-text-3); }
.hy__v { font-size: 23rpx; font-weight: 600; color: var(--biz-accent-dark); }
.hy__list { border-top: 2rpx solid var(--biz-border-light); }
.hy__p { display: flex; align-items: center; gap: 14rpx; padding: 18rpx 24rpx; border-bottom: 2rpx solid var(--biz-border-light); }
.hy__p:last-child { border-bottom: none; }
.hy__p-t { flex: 1; font-size: 24rpx; color: var(--biz-text-2); }
.hy__p-v { font-family: var(--biz-font-num); font-size: 24rpx; color: var(--biz-text-1); }
.hy__p-s { width: 80rpx; text-align: right; font-size: 20rpx; color: var(--biz-accent-dark); }

.rc__hd { display: flex; align-items: baseline; justify-content: space-between; gap: 16rpx; }
.rc__t { font-size: 26rpx; font-weight: 500; color: var(--biz-text-1); }
.rc__v { font-family: var(--biz-font-num); font-size: 28rpx; font-weight: 700; color: var(--biz-text-1); }
.rc__d { display: block; margin-top: 8rpx; font-size: 21rpx; color: var(--biz-text-4); }

.bl__tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.bl__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
.danger { color: var(--biz-danger) !important; }
</style>
