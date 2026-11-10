<!--
  车位详情（批次 79）
  ------------------------------------------------------------
  车位 → 车辆 → 月租，三层一次给全：这一页回答的是"这个车位现在什么状态、下一步该做什么"。
  底部只有一个主动作（换绑车牌）；预缴在月租段就地发起，不抢主按钮。
-->
<template>
  <view class="page">
    <NavBar title="车位详情" :subtitle="park?.parkNo || ''" />
    <view class="body" :class="{ 'body--with-foot': park }">
      <Empty
        v-if="loaded && !park"
        :text="loadErr ? '车位信息加载失败' : '车位不存在'"
        :sub="loadErr ? '退出重进可重试' : '可能已过户或被物业收回'"
      />

      <template v-if="park">
        <!-- 车位本身 -->
        <view class="card pdk__hd">
          <view class="pdk__top">
            <text class="pdk__no">{{ park.parkNo }}</text>
            <Tag :text="exp.text" size="sm" :color="toneColor(exp.tone)" />
          </view>
          <text class="pdk__meta">{{ park.zone }} 区 · {{ park.parkType }} · {{ park.category }} · {{ park.area }}㎡</text>
          <view class="pdk__tags">
            <Tag v-if="park.chargePile" text="充电桩" size="sm" color="var(--biz-accent-dark)" />
            <Tag :text="park.status" size="sm" color="var(--biz-text-3)" />
            <Tag :text="park.bindStatus" size="sm" color="var(--biz-primary)" />
          </view>
        </view>

        <!-- 车辆 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">绑定车辆</text>
            <text class="sec-hd__d">{{ cars.length }} 辆</text>
          </view>
          <view v-for="(v, i) in cars" :key="v.vehicleId" class="pdk__car" :class="{ 'is-last': i === cars.length - 1 }">
            <view class="pdk__car-hd">
              <text class="pdk__plate">{{ v.plateNo }}</text>
              <Tag :text="v.authStatus" size="sm" :color="v.authStatus === '正常' ? 'var(--biz-accent-dark)' : 'var(--biz-danger)'" />
            </view>
            <text class="pdk__car-d">{{ v.color }} · {{ v.brand }} · {{ v.vehicleType }} · {{ v.inOutType }}</text>
            <text class="pdk__car-d">IC 卡 ****{{ v.cardNoTail }}</text>
          </view>
          <Empty v-if="!cars.length" text="这个车位还没绑车牌" sub="换绑一次即可绑定，道闸 5 分钟内同步" />
        </view>

        <!-- 月租 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">车位管理费</text>
            <text class="sec-hd__d">¥{{ park.feeStandard }} / 月</text>
          </view>
          <Cell label="已缴至" :value="exp.date || '—'" />
          <Cell label="剩余" :value="exp.text" :strong="exp.tone === 'danger'" />
          <Cell label="预缴月数" value="3 / 6 / 12 个月" :last="!pays.length" />
          <Cell v-if="pays.length" label="最近预缴" :value="`${pays[0].at.slice(0, 10)} · ${pays[0].months} 个月 · ¥${pays[0].amount}`" :last="true" />

          <view class="pdk__renew">
            <view id="park-renew" class="btn btn--ghost" @tap="renewSheet = true"><text>预缴管理费</text></view>
          </view>
        </view>

        <!-- 换绑记录 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">换绑记录</text>
            <text class="sec-hd__d">本月已用 {{ quota.used }}/{{ quota.limit }} 次</text>
          </view>
          <view v-for="(l, i) in logs" :key="l.logId" class="pdk__log" :class="{ 'is-last': i === logs.length - 1 }">
            <view class="pdk__log-hd">
              <text class="pdk__log-t">{{ l.fromPlate }} → {{ l.toPlate }}</text>
              <Tag :text="l.vendorStatus" size="sm" :color="l.vendorStatus === '已同步' ? 'var(--biz-accent-dark)' : 'var(--biz-warning)'" />
            </view>
            <text class="pdk__log-d">{{ l.at }} · {{ l.source }}{{ l.operatorName ? ' · ' + l.operatorName : '' }}</text>
            <text v-if="l.reason" class="pdk__log-d">原因：{{ l.reason }}</text>
          </view>
          <Empty v-if="!logs.length" text="还没有换绑记录" />
        </view>

        <!-- 管理费账单（按业主归集） -->
        <view v-if="parkBills.length" class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">管理费账单</text>
            <text class="sec-hd__d">{{ parkBills.length }} 期</text>
          </view>
          <Cell
            v-for="(b, i) in parkBills.slice(0, 4)"
            :key="b.billId"
            :label="b.period"
            :value="`${b.status} ¥${b.unpaid || b.payable}`"
            :strong="b.isDebt"
            :last="i === Math.min(parkBills.length, 4) - 1"
          />
          <text class="pdk__note">
            以上均为「{{ parkBills[0].itemName }}」，按本车位归集；缴费在「家庭账单」里一起付。
          </text>
        </view>

        <view class="pdk__tip">
          <text class="demo-tip">说明</text>
          <text class="pdk__tip-t">
            换绑不需要物业审核，但会留一条记录并同步给车牌识别系统（原型未接，状态停在「待同步」）。
            管理费到期后才能换绑；每月每车位 {{ quota.limit }} 次，下月自动恢复。
          </text>
        </view>
      </template>
    </view>

    <!-- 预缴月数 -->
    <ActionSheet
      v-model:show="renewSheet"
      title="预缴车位管理费"
      :sub="`¥${park?.feeStandard || 0} / 月`"
      :actions="renewActions"
      @select="onRenew"
    />

    <Bar
      v-if="park"
      label="换绑车牌"
      :hint="barHint"
      okText="换绑"
      btn-id="park-change"
      :disabled="!guard.ok"
      @submit="toChange"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Cell from '@/components/Cell.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import {
  RENEW_MONTHS, changeGuard, changeLogsOf, expiryOf, loadParking, myParkings,
  parkBillsOf, paysOf, quotaOf, renew, renewAmount, renewPreview, vehiclesOf
} from '@/api/park'
import { go, confirm, toastErr, toastOk } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const parkId = ref('')
const renewSheet = ref(false)
const loaded = ref(false)
const loadErr = ref(false)
const ver = ref(0)

const park = computed(() => {
  ver.value
  return myParkings().find(p => p.parkId === parkId.value) || null
})
/* 这三处都要显式读 `ver`：接口模式下数据是 loadParking 异步塞进 remote 的，
   而 remote 是普通对象（不是 ref），computed 追踪不到它 —— 只读 park 的话，
   park 的引用没变，车辆与记录就永远是首次渲染时的空数组（"0 辆 · 还没有换绑记录"）。 */
const cars = computed(() => {
  ver.value
  return park.value ? vehiclesOf(park.value.parkId) : []
})
const exp = computed(() => (park.value ? expiryOf(park.value) : { date: '', days: null, tone: 'muted', text: '' }))
const guard = computed(() => (park.value ? changeGuard(park.value.parkId) : { ok: false, quota: { used: 0, limit: 1, left: 0 }, reasons: [] }))
const quota = computed(() => (park.value ? quotaOf(park.value.parkId) : { used: 0, limit: 1, left: 0 }))
const logs = computed(() => {
  ver.value
  return park.value ? changeLogsOf(park.value.parkId) : []
})
const pays = computed(() => (park.value ? paysOf(park.value.parkId) : []))
const parkBills = computed(() => {
  ver.value
  return park.value ? parkBillsOf(park.value.parkId) : []
})

const barHint = computed(() => {
  if (guard.value.ok) return `本月还可换绑 ${quota.value.left} 次`
  return guard.value.reasons[0]?.text || ''
})

const renewActions = computed(() =>
  RENEW_MONTHS.map(m => ({
    label: `${m} 个月`,
    desc: `¥${renewAmount(park.value, m)} · 至 ${exp.value.date || ''}`,
    value: m
  }))
)

const toneColor = tone =>
  tone === 'danger' ? 'var(--biz-danger)' : tone === 'warn' ? 'var(--biz-warning)' : 'var(--biz-text-3)'

onLoad(opts => {
  parkId.value = String(opts?.parkId || '')
  gateOwner('车位信息')
})

onShow(async () => {
  try {
    if (parkId.value) await loadParking(parkId.value)
    loadErr.value = false
  } catch (e) {
    loadErr.value = true
  }
  ver.value++
  loaded.value = true
})

function toChange() {
  if (!guard.value.ok) return
  go('/pages/park/change', { parkId: parkId.value })
}

async function onRenew(months) {
  renewSheet.value = false
  const ok = await confirm({
    title: '确认预缴',
    content: `预缴 ${months} 个月车位管理费 ¥${renewAmount(park.value, months)}，到期日顺延至 ${renewPreview(park.value, months)}`,
    okText: '确认支付'
  })
  if (!ok) return
  try {
    const rec = renew(parkId.value, months)
    ver.value++
    toastOk(`已预缴 ${rec.months} 个月，到期 ${rec.to}`)
  } catch (e) {
    toastErr(e?.message || '预缴失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 40rpx; }
.body--with-foot { padding-bottom: 240rpx; }
.card + .card { margin-top: 20rpx; }
.pdk__hd { }
.pdk__top { display: flex; align-items: center; justify-content: space-between; }
.pdk__no { font-size: 40rpx; font-weight: 700; color: var(--biz-text-1); font-family: var(--biz-font-num); }
.pdk__meta { display: block; margin-top: 10rpx; font-size: 22rpx; color: var(--biz-text-3); }
.pdk__tags { margin-top: 16rpx; display: flex; gap: 10rpx; flex-wrap: wrap; }
.pdk__car { padding: 18rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.pdk__car.is-last { border-bottom: none; padding-bottom: 0; }
.pdk__car-hd { display: flex; align-items: center; justify-content: space-between; }
.pdk__plate { font-size: 30rpx; font-weight: 700; color: var(--biz-text-1); letter-spacing: 1rpx; }
.pdk__car-d { display: block; margin-top: 6rpx; font-size: 21rpx; color: var(--biz-text-3); }
.pdk__renew { margin-top: 22rpx; }
.pdk__log { padding: 18rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.pdk__log.is-last { border-bottom: none; padding-bottom: 0; }
.pdk__log-hd { display: flex; align-items: center; justify-content: space-between; }
.pdk__log-t { font-size: 25rpx; font-weight: 600; color: var(--biz-text-1); }
.pdk__log-d { display: block; margin-top: 6rpx; font-size: 21rpx; color: var(--biz-text-3); }
.pdk__note { display: block; margin-top: 14rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.6; }
.pdk__tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.pdk__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.7; }
</style>
