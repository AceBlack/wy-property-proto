<!--
  Tab 1 · 首页（我的家）
  ------------------------------------------------------------
  双态是这一屏的关键（登录 ≠ 认证）：
    未认证 / 审核中 → 顶部「请绑定房屋」引导 + 公告与活动 + 服务入口（可点，点了才拦）
    已认证          → 房卡 + 待办（待缴 / 在修 / 待确认增项）+ 五宫格 + 管家 + 社区活动 + 公告
  首页不是后台：认证之后也要保留公告与活动，别做成一屏待办。
-->
<template>
  <view class="page">
    <view class="hd">
      <view class="hd__l">
        <text class="hd__addr">{{ headerAddr }}</text>
        <text class="hd__sub">{{ headerSub }}</text>
      </view>
      <view class="hd__bell" @tap="toast('消息中心 P1')"><text>◦</text></view>
    </view>

    <view class="body">
      <!-- 未认证 / 审核中 -->
      <view v-if="!approved" id="bind-banner" class="bind" @tap="toAuth">
        <view class="bind__ico"><text>房</text></view>
        <view class="bind__body">
          <text class="bind__t">{{ pending ? '房产资料审核中' : '请绑定房屋' }}</text>
          <text class="bind__d">
            {{ pending ? '物业会在 1-3 个工作日内完成核验' : '认证后即可缴费、报修、开门' }}
          </text>
        </view>
        <text class="bind__a">{{ pending ? '查看' : '去认证' }}</text>
      </view>

      <!-- 已认证：房卡 -->
      <view v-else class="house-card" @tap="houseSheet = true">
        <view class="house-card__top">
          <text class="house-card__name">{{ house?.fullName }}</text>
          <view class="house-card__role">
            <text>{{ house?.identity }}</text>
          </view>
        </view>
        <text class="house-card__meta">
          {{ house?.communityName }} · {{ house?.houseType }} · {{ house?.area }}㎡
          <text v-if="houses.length > 1" class="house-card__sw"> · {{ houses.length }} 套可切换</text>
        </text>
        <view class="house-card__rows">
          <view class="house-card__cell">
            <text class="house-card__k">待缴</text>
            <text class="house-card__v">{{ can.bills && debt.count ? '¥' + amount(debt.unpaid) : '—' }}</text>
          </view>
          <view class="house-card__cell">
            <text class="house-card__k">在修</text>
            <text class="house-card__v">{{ doing.length }} 单</text>
          </view>
          <view class="house-card__cell">
            <text class="house-card__k">待确认</text>
            <text class="house-card__v">{{ pendingCount }} 项</text>
          </view>
        </view>
      </view>

      <!-- 还有房没绑（逐套绑的必然结果，不提示业主就永远看不到另一套的账） -->
      <view v-if="approved && unbound.length" id="bind-more" class="more" @tap="bindMore">
        <text class="more__t">名下还有 {{ unbound.length }} 套房产未绑定</text>
        <text class="more__d">{{ unbound[0].fullName }}{{ unbound.length > 1 ? ' 等' : '' }} · 绑定后可合并缴费</text>
        <text class="more__a">去绑定</text>
      </view>

      <!-- 家庭成员 / 家庭账单 -->
      <view v-if="approved" class="hm__duo">
        <view class="hm__duo-c" @tap="goHouse">
          <text class="hm__duo-t">家庭成员</text>
          <text class="hm__duo-d">{{ memberCount }} 人</text>
        </view>
        <view class="hm__duo-c" @tap="goBills">
          <text class="hm__duo-t">家庭账单</text>
          <text class="hm__duo-d">{{ debt.count ? '待缴 ' + debt.count + ' 张' : '已结清' }}</text>
        </view>
      </view>

      <!-- 待确认增项：业主端最该被看见的一条 -->
      <view v-if="approved && pendingOrders.length" id="addon-alert" class="alert" @tap="goRepairDetail(pendingOrders[0].woId)">
        <text class="alert__t">有 {{ pendingCount }} 项增项待您确认</text>
        <text class="alert__v">{{ money(pendingAmount) }}</text>
      </view>

      <!-- 四宫格 -->
      <view class="grid">
        <view v-for="s in services" :key="s.key" class="grid__i" @tap="s.run">
          <view class="grid__ico" :style="{ background: s.bg, color: s.color }"><text>{{ s.icon }}</text></view>
          <text class="grid__t">{{ s.label }}</text>
        </view>
      </view>

      <!-- 管家 -->
      <view v-if="steward" class="card steward">
        <Avatar :name="steward.name" size="md" :tone="2" />
        <view class="steward__body">
          <text class="steward__n">{{ steward.name }} · {{ steward.position }}</text>
          <text class="steward__d">有事随时找我，工作时间 8:30-18:00</text>
        </view>
        <view class="steward__act" @tap.stop="callSteward"><text>电话</text></view>
        <view class="steward__act" @tap.stop="toast('在线咨询 P1')"><text>消息</text></view>
      </view>

      <!-- 社区活动 -->
      <view class="sec-hd home-sec">
        <text class="sec-hd__t">社区活动</text>
        <text class="sec-hd__d" @tap="goNeighbor('activity')">查看全部</text>
      </view>
      <scroll-view scroll-x class="acts">
        <view v-for="a in activities" :key="a.activityId" class="act" @tap="goActivity(a.activityId)">
          <Cover :cover="a.cover" h="150rpx" :badge="a.feeType" :label="a.category" />
          <text class="act__t">{{ a.title }}</text>
          <text class="act__d">{{ a.startAt.slice(5, 10) }} · {{ a.phase }}</text>
        </view>
      </scroll-view>

      <!-- 社区公告（邻里频道） -->
      <view class="sec-hd home-sec">
        <text class="sec-hd__t">社区公告</text>
        <text class="sec-hd__d" @tap="goNeighbor('notice')">全部公告</text>
      </view>
      <view v-for="n in notices" :key="n.noticeId" class="pc" @tap="goNotice(n.noticeId)">
        <view class="pc__hd">
          <Tag :text="n.type" size="sm" color="var(--biz-primary)" />
          <text v-if="!n.read" class="pc__unread">未读</text>
          <text class="pc__at">{{ n.publishTime.slice(5, 10) }}</text>
        </view>
        <text class="pc__t">{{ n.title }}</text>
        <text class="pc__d">{{ n.content }}</text>
        <view class="pc__foot">
          <text class="pc__m">{{ n.publisher }}</text>
          <text class="pc__m">阅读 {{ n.readCount }}/{{ n.targetHouses }} 户</text>
        </view>
      </view>

      <view class="hm__demo">
        <text class="demo-tip">演示</text>
        <text class="hm__demo-d">
          演示时钟 2026-10-20 10:00；数据来自 03-原型 的 mock，业主端只做取数与写回，
          跨端不联动（员工端与本工程不共享内存）。
        </text>
      </view>
    </view>

    <!-- 切换房屋 -->
    <ActionSheet v-model:show="houseSheet" title="切换房屋" :sub="`共 ${houses.length} 套`" :actions="houseActions" @select="onPickHouse" />

    <!-- 门禁钥匙（演示） -->
    <Sheet v-model:show="doorSheet" title="门禁钥匙" sub="演示态：不出真实开门指令">
      <view class="door">
        <view class="door__qr">
          <view v-for="i in 25" :key="i" class="door__px" :class="{ 'is-on': (i * 7) % 3 === 0 }" />
        </view>
        <text class="door__t">单元门 · {{ house?.fullName || '—' }}</text>
        <text class="door__d">真实接入需对接门禁厂商（蓝牙/二维码/人脸），本轮只出占位码</text>
        <view v-if="!can.door" class="banner banner--offline door__warn">
          <view class="banner__ico"><text>!</text></view>
          <text class="banner__t">您的租住资料尚未核验，门禁暂不可用</text>
        </view>
      </view>
    </Sheet>

    <!-- 我的车位（数据现成，先做只读） -->
    <Sheet v-model:show="parkSheet" title="我的车位" sub="只读展示，续费与月卡在 P1">
      <view v-for="p in parks" :key="p.parkId" class="park">
        <text class="park__no">{{ p.parkNo }}</text>
        <text class="park__d">{{ p.zone }} 区 · {{ p.category }} · 月租 ¥{{ p.feeStandard }}</text>
        <text class="park__e">到期 {{ p.expireDate }}</text>
      </view>
      <Empty v-if="!parks.length" text="这套房没有绑定车位" />
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Avatar from '@/components/Avatar.vue'
import Cover from '@/components/Cover.vue'
import Tag from '@/components/Tag.vue'
import Sheet from '@/components/Sheet.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import Empty from '@/components/Empty.vue'
import { parkings, vehicles } from '@pc/mock'
import { app, isApproved, isPending, switchHouse } from '@/store/app'
import {
  activeHouse,
  boundHouseIds,
  debtSummary,
  myHouses,
  myOrders,
  pendingAddonOrders,
  residentsOf,
  unboundHouses
} from '@/api/mp'
import { activityFeed, noticeList } from '@/api/neighbor'
import { utilitySummary } from '@/api/utility'
import { amount, money } from '@/utils/format'
import { go, toast } from '@/utils/ui'
import { can, gateLogin, gateOwner, gatePerm } from '@/utils/guard'

const houseSheet = ref(false)
const doorSheet = ref(false)
const parkSheet = ref(false)
const ver = ref(0)

const approved = computed(() => {
  ver.value
  return isApproved.value
})
const pending = computed(() => {
  ver.value
  return isPending.value
})
const houses = computed(() => {
  ver.value
  return myHouses()
})
const house = computed(() => {
  ver.value
  return activeHouse()
})
const steward = computed(() => house.value?.steward || null)
const debt = computed(() => {
  ver.value
  return debtSummary()
})
const allOrders = computed(() => {
  ver.value
  return myOrders()
})
const doing = computed(() => allOrders.value.filter(w => ['待派单', '已派单', '处理中', '待确认'].includes(w.status)))
const pendingOrders = computed(() => {
  ver.value
  return pendingAddonOrders()
})
const pendingCount = computed(() => pendingOrders.value.reduce((s, w) => s + w.pendingAddons.length, 0))
const pendingAmount = computed(() => pendingOrders.value.reduce((s, w) => s + w.pendingAddonFee, 0))
const memberCount = computed(() => {
  ver.value
  if (!house.value) return 0
  const r = residentsOf(house.value.houseId)
  return (r.members?.length || 0) + (r.tenants?.length || 0)
})
const unbound = computed(() => {
  ver.value
  return unboundHouses()
})
const activities = computed(() => activityFeed(4))
const notices = computed(() => noticeList().slice(0, 3))
const parks = computed(() => {
  const vid = new Set(vehicles.filter(v => v.ownerId && boundHouseIds().length && v.communityId === house.value?.communityId).map(v => v.parkId))
  return parkings.filter(p => p.ownerId && (p.ownerId === app.bindings[0]?.ownerId || vid.has(p.parkId))).slice(0, 3)
})

const headerAddr = computed(() => (approved.value && house.value ? house.value.communityName : '智慧物业 · 业主服务'))
const headerSub = computed(() => (approved.value ? `${app.session?.name || ''}，欢迎回家` : '未认证也可浏览社区内容'))

const houseActions = computed(() =>
  houses.value.map(h => ({
    label: h.fullName,
    desc: `${h.identity} · ${h.houseType} · ${h.area}㎡${h.verifyStatus ? ' · ' + h.verifyStatus : ''}`,
    value: h.houseId,
    active: h.houseId === house.value?.houseId
  }))
)

const services = computed(() => [
  {
    key: 'utility',
    icon: '水',
    label: '生活缴费',
    bg: 'var(--biz-primary-light-9)',
    color: 'var(--biz-primary)',
    run: () => (gateOwner('水电燃气缴费') ? go('/pages/utility/index') : null)
  },
  {
    key: 'repair',
    icon: '修',
    label: '报事报修',
    bg: 'var(--biz-accent-light-9)',
    color: 'var(--biz-accent-dark)',
    run: () => go('/pages/repair/list')
  },
  {
    key: 'door',
    icon: '门',
    label: '手机开门',
    bg: '#fff4e6',
    color: 'var(--biz-warning)',
    run: () => (gateOwner('手机开门') ? (doorSheet.value = true) : null)
  },
  {
    key: 'park',
    icon: '车',
    label: '我的车位',
    bg: '#eef1ff',
    color: 'var(--biz-primary)',
    run: () => (gateOwner('车位信息') ? (parkSheet.value = true) : null)
  },
  {
    /* 租售信息：游客也能看列表与详情，所以**不挂门禁**（§13.3） */
    key: 'sale',
    icon: '租',
    label: '租售信息',
    bg: '#e8f8ee',
    color: '#0aa84f',
    run: () => go('/pages/house-sale/list')
  }
])

onShow(() => {
  ver.value++
})

function toAuth() {
  if (!gateLogin()) return
  uni.navigateTo({ url: pending.value ? '/pages/auth/pending' : '/pages/auth/community' })
}
function bindMore() {
  uni.navigateTo({ url: '/pages/auth/community' })
}
function goBills() {
  if (!gatePerm('bills', '账单缴费')) return
  go('/pages/bills/index')
}
function goHouse() {
  if (!gateOwner('房屋与家庭成员')) return
  go('/pages/house/index')
}
function goRepairDetail(id) {
  go('/pages/repair/detail', { woId: id })
}
function goActivity(id) {
  go('/pages/neighbor/activity', { id })
}
function goNotice(id) {
  go('/pages/neighbor/notice', { id })
}
function goNeighbor(tab) {
  uni.switchTab({ url: '/pages/neighbor/index' })
  setTimeout(() => uni.$emit('neighbor-tab', tab), 120)
}
function onPickHouse(id) {
  switchHouse(id)
  ver.value++
  houseSheet.value = false
}
function callSteward() {
  uni.makePhoneCall({ phoneNumber: steward.value.phone, fail: () => toast('演示环境不能拨号') })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); padding-bottom: 40rpx; }

.hd {
  padding: calc(env(safe-area-inset-top) + 30rpx) 28rpx 96rpx;
  background: linear-gradient(160deg, #eef1ff 0%, #f4f6ff 60%, #f1f2fa 100%);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.hd__l { flex: 1; min-width: 0; }
.hd__addr { font-size: 34rpx; font-weight: 700; color: var(--biz-text-1); }
.hd__sub { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--biz-text-3); }
.hd__bell {
  width: 64rpx; height: 64rpx; border-radius: 50%; background: rgba(255,255,255,0.8);
  display: flex; align-items: center; justify-content: center; color: var(--biz-text-3); font-size: 28rpx;
}

.body { padding: 0 28rpx; margin-top: -70rpx; }

/* 未认证引导 */
.bind {
  display: flex; align-items: center; gap: 18rpx;
  background: #fff; border-radius: 22rpx; padding: 24rpx;
  box-shadow: var(--biz-shadow-card);
}
.bind__ico {
  flex: none; width: 76rpx; height: 76rpx; border-radius: 20rpx;
  background: var(--biz-primary-light-9); color: var(--biz-primary);
  display: flex; align-items: center; justify-content: center; font-size: 30rpx; font-weight: 700;
}
.bind__body { flex: 1; min-width: 0; }
.bind__t { font-size: 29rpx; font-weight: 600; color: var(--biz-text-1); }
.bind__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.bind__a { flex: none; font-size: 24rpx; color: var(--biz-primary); font-weight: 600; }

/* 房卡 */
.house-card__top { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.house-card__role { background: rgba(255,255,255,0.22); border-radius: 999rpx; padding: 4rpx 16rpx; font-size: 20rpx; }
.house-card__sw { font-size: 21rpx; opacity: 0.9; }

.more {
  margin-top: 18rpx; display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap;
  padding: 20rpx 22rpx; border-radius: 18rpx; background: #fff; box-shadow: var(--biz-shadow-card);
}
.more__t { font-size: 25rpx; font-weight: 600; color: var(--biz-text-1); }
.more__d { flex: 1; min-width: 260rpx; font-size: 20rpx; color: var(--biz-text-3); }
.more__a { font-size: 22rpx; color: var(--biz-primary); font-weight: 600; }

.hm__duo { display: flex; gap: 18rpx; margin-top: 20rpx; }
.hm__duo-c { flex: 1; background: #fff; border-radius: 18rpx; padding: 20rpx 22rpx; box-shadow: var(--biz-shadow-card); }
.hm__duo-t { font-size: 24rpx; color: var(--biz-text-2); }
.hm__duo-d { display: block; margin-top: 6rpx; font-size: 30rpx; font-weight: 700; color: var(--biz-text-1); font-family: var(--biz-font-num); }

.alert {
  margin-top: 18rpx; display: flex; align-items: center; justify-content: space-between;
  background: #fff6f7; border: 2rpx solid rgba(236,77,99,0.22); border-radius: 18rpx; padding: 22rpx 24rpx;
}
.alert__t { font-size: 27rpx; font-weight: 600; color: var(--biz-danger); }
.alert__v { font-family: var(--biz-font-num); font-size: 30rpx; font-weight: 700; color: var(--biz-danger); }

.grid { display: flex; background: #fff; border-radius: 20rpx; padding: 28rpx 0; margin-top: 20rpx; box-shadow: var(--biz-shadow-card); }
.grid__i { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 12rpx; }
.grid__ico { width: 76rpx; height: 76rpx; border-radius: 22rpx; display: flex; align-items: center; justify-content: center; font-size: 30rpx; font-weight: 700; }
.grid__t { font-size: 20rpx; color: var(--biz-text-2); }

.steward { display: flex; align-items: center; gap: 18rpx; margin-top: 20rpx; }
.steward__body { flex: 1; min-width: 0; }
.steward__n { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.steward__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.steward__act { padding: 8rpx 18rpx; border-radius: 999rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); font-size: 21rpx; }

.home-sec { margin: 32rpx 0 16rpx; }
.acts { white-space: nowrap; }
.act { display: inline-block; width: 300rpx; margin-right: 18rpx; vertical-align: top; }
.act__t { display: block; margin-top: 12rpx; font-size: 25rpx; font-weight: 600; color: var(--biz-text-1); white-space: normal; line-height: 1.4; }
.act__d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-3); }

.pc { background: #fff; border-radius: 18rpx; padding: 22rpx 24rpx; box-shadow: var(--biz-shadow-card); }
.pc + .pc { margin-top: 16rpx; }
.pc__hd { display: flex; align-items: center; justify-content: space-between; }
.pc__at { font-size: 20rpx; color: var(--biz-text-4); }
.pc__unread { font-size: 18rpx; color: var(--biz-danger); background: #fff0f1; border-radius: 4rpx; padding: 1rpx 8rpx; }
.pc__t { display: block; margin-top: 12rpx; font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.pc__d { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--biz-text-3); line-height: 1.55; }
.pc__foot { display: flex; justify-content: space-between; margin-top: 12rpx; }
.pc__m { font-size: 20rpx; color: var(--biz-text-4); }

.hm__demo { margin-top: 30rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.hm__demo-d { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }

.door { display: flex; flex-direction: column; align-items: center; }
.door__qr { width: 300rpx; height: 300rpx; display: flex; flex-wrap: wrap; background: #fff; border: 2rpx solid var(--biz-border); border-radius: 16rpx; padding: 20rpx; }
.door__px { width: 20%; height: 20%; }
.door__px.is-on { background: var(--biz-text-1); }
.door__t { margin-top: 20rpx; font-size: 26rpx; font-weight: 600; color: var(--biz-text-1); }
.door__d { margin-top: 8rpx; font-size: 21rpx; color: var(--biz-text-4); text-align: center; line-height: 1.6; }
.door__warn { width: 100%; margin-top: 18rpx; }

.park { padding: 20rpx; border-radius: 16rpx; background: var(--biz-bg-fill); margin-bottom: 12rpx; }
.park__no { font-size: 30rpx; font-weight: 700; color: var(--biz-text-1); font-family: var(--biz-font-num); }
.park__d { display: block; margin-top: 4rpx; font-size: 22rpx; color: var(--biz-text-3); }
.park__e { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-4); }
</style>
