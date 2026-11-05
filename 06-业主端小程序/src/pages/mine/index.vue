<!--
  Tab 4 · 我的
  ------------------------------------------------------------
  这一页是"身份与资产"的总入口：认证状态、房屋、家庭成员、车位、客服。
  未登录 / 未认证也要能进来 —— 否则用户找不到"从哪认证"，
  上一版把认证塞在启动流程里，就是这个毛病。
-->
<template>
  <view class="page">
    <view class="hd">
      <view v-if="logged" class="hd__user">
        <Avatar :name="name" size="lg" :tone="3" />
        <view class="hd__info">
          <view class="hd__row">
            <text class="hd__n">{{ name }}</text>
            <Tag v-if="approved" :text="role" size="sm" color="var(--biz-accent-dark)" />
            <Tag v-else-if="pending" text="审核中" size="sm" color="var(--biz-warning)" />
            <Tag v-else text="未认证" size="sm" color="var(--biz-text-3)" />
          </view>
          <text class="hd__addr">{{ approved ? house?.fullName : maskPhone(session?.phone) }}</text>
        </view>
      </view>
      <view v-else class="hd__user" @tap="goLogin">
        <Avatar name="未" size="lg" :tone="5" />
        <view class="hd__info">
          <text class="hd__n">未登录</text>
          <text class="hd__addr">登录后可评论、报名、缴费</text>
        </view>
        <text class="hd__login">去登录</text>
      </view>
    </view>

    <view class="body">
      <!-- 认证引导 -->
      <view v-if="logged && !approved" id="mine-auth" class="auth" @tap="toAuth">
        <view class="auth__body">
          <text class="auth__t">{{ pending ? '房产资料审核中' : '完成业主认证' }}</text>
          <text class="auth__d">{{ pending ? '1-3 个工作日出结果，期间可浏览社区内容' : '认证后可用缴费 / 报修 / 门禁 / 车位' }}</text>
        </view>
        <text class="auth__a">{{ pending ? '查看' : '去认证' }}</text>
      </view>

      <!-- 数据行 -->
      <view class="stats">
        <view class="stats__i" @tap="goRepair">
          <text class="stats__n">{{ stats.repairs }}</text>
          <text class="stats__t">报修</text>
        </view>
        <view class="stats__i" @tap="goNeighbor">
          <text class="stats__n">{{ stats.comments }}</text>
          <text class="stats__t">评论</text>
        </view>
        <view class="stats__i" @tap="goNeighbor">
          <text class="stats__n">{{ stats.enroll }}</text>
          <text class="stats__t">报名</text>
        </view>
        <view class="stats__i" @tap="goNeighbor">
          <text class="stats__n">{{ stats.wants }}</text>
          <text class="stats__t">想要</text>
        </view>
      </view>

      <!-- 七格 -->
      <view class="grid">
        <view v-for="g in grids" :key="g.key" class="grid__i" @tap="g.run">
          <view class="grid__ico"><text>{{ g.icon }}</text></view>
          <text class="grid__t">{{ g.label }}</text>
        </view>
      </view>

      <!-- 列表 -->
      <view class="card list">
        <Cell label="个人认证" :value="authText" arrow @tap="toAuth" />
        <Cell label="房屋管理" :value="approved ? `${houses.length} 套` : '未认证'" arrow @tap="goHouse" />
        <Cell label="家庭绑定" :value="approved ? `${memberCount} 人` : '未认证'" arrow @tap="goHouse" />
        <Cell label="停车绑定" value="P1" arrow @tap="toast('停车绑定 P1，本轮只做只读展示')" />
        <Cell label="设置" value="" arrow @tap="toast('设置 P1')" />
        <Cell label="客服 / 反馈 / 投诉" value="" arrow :last="true" @tap="goFeedback" />
      </view>

      <view class="acts">
        <view v-if="logged" class="btn btn--line" @tap="onLogout"><text>退出登录</text></view>
        <view class="btn btn--line" @tap="onReset"><text>重置演示数据</text></view>
      </view>

      <text class="ver">智慧物业 · 业主端 v0.2.0（原型）</text>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Avatar from '@/components/Avatar.vue'
import Tag from '@/components/Tag.vue'
import Cell from '@/components/Cell.vue'
import { app, isApproved, isLogged, isPending, logout, resetAll } from '@/store/app'
import { activeHouse, authSummary, myHouses, myOrders, residentsOf } from '@/api/mp'
import { maskPhone } from '@/utils/format'
import { go, toast } from '@/utils/ui'
import { gateOwner, gatePerm } from '@/utils/guard'

const ver = ref(0)
const logged = computed(() => {
  ver.value
  return isLogged.value
})
const approved = computed(() => {
  ver.value
  return isApproved.value
})
const pending = computed(() => {
  ver.value
  return isPending.value
})
const session = computed(() => app.session)
const name = computed(() => app.session?.name || '业主')
const role = computed(() => app.bindings[0]?.identity || '')
const house = computed(() => {
  ver.value
  return activeHouse()
})
const houses = computed(() => {
  ver.value
  return myHouses()
})
const memberCount = computed(() => {
  ver.value
  if (!house.value) return 0
  const r = residentsOf(house.value.houseId)
  return (r.members?.length || 0) + (r.tenants?.length || 0)
})
const stats = computed(() => {
  ver.value
  return {
    repairs: myOrders().length,
    comments: app.comments.length,
    enroll: app.enrollments.filter(e => e.status !== '已取消').length,
    wants: app.wants.length
  }
})
const authText = computed(() => {
  const s = authSummary()
  if (s.status === 'approved') return '已认证'
  if (s.status === 'pending') return '审核中'
  if (s.status === 'rejected') return '未通过'
  return '未认证'
})

const grids = computed(() => [
  { key: 'bill', icon: '费', label: '物业缴费', run: () => (gatePerm('bills', '物业缴费') ? go('/pages/bills/index') : null) },
  { key: 'repair', icon: '修', label: '报事报修', run: goRepair },
  { key: 'house', icon: '房', label: '我的房产', run: () => (gateOwner('我的房产') ? go('/pages/house/index') : null) },
  { key: 'util', icon: '水', label: '便民缴费', run: () => (gateOwner('便民缴费') ? go('/pages/utility/index') : null) },
  { key: 'park', icon: '车', label: '我的车位', run: () => (gateOwner('车位信息') ? toast('车位详情在首页四宫格') : null) },
  { key: 'door', icon: '门', label: '门禁钥匙', run: () => (gateOwner('门禁钥匙') ? toast('门禁钥匙在首页四宫格') : null) },
  { key: 'family', icon: '家', label: '家庭账单', run: () => (gatePerm('bills', '家庭账单') ? go('/pages/bills/index') : null) }
])

onShow(() => {
  ver.value++
})

function goLogin() {
  uni.navigateTo({ url: '/pages/login/index' })
}
function toAuth() {
  if (!logged.value) return goLogin()
  uni.navigateTo({ url: pending.value ? '/pages/auth/pending' : '/pages/auth/community' })
}
function goHouse() {
  if (!gateOwner('房屋与家庭成员')) return
  go('/pages/house/index')
}
const goRepair = () => go('/pages/repair/list')
const goFeedback = () => go('/pages/mine/feedback')
function goNeighbor() {
  uni.switchTab({ url: '/pages/neighbor/index' })
}

async function onLogout() {
  const ok = await new Promise(r =>
    uni.showModal({
      title: '退出登录',
      content: '退出后需重新登录；房产认证记录会保留，再次登录后需要重新认证。',
      success: res => r(!!res.confirm)
    })
  )
  if (!ok) return
  logout()
  ver.value++
  uni.reLaunch({ url: '/pages/home/index' })
}

async function onReset() {
  const ok = await new Promise(r =>
    uni.showModal({ title: '重置演示数据', content: '将清空本次演示产生的登录、认证、账单支付、报修、评论等记录。', success: res => r(!!res.confirm) })
  )
  if (!ok) return
  resetAll()
  ver.value++
  uni.reLaunch({ url: '/pages/home/index' })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.hd {
  padding: calc(env(safe-area-inset-top) + 40rpx) 28rpx 100rpx;
  background: linear-gradient(160deg, #5b6cff 0%, #7c8bff 60%, #93a0ff 100%);
}
.hd__user { display: flex; align-items: center; gap: 20rpx; }
.hd__info { flex: 1; min-width: 0; }
.hd__row { display: flex; align-items: center; gap: 12rpx; }
.hd__n { font-size: 34rpx; font-weight: 700; color: #fff; }
.hd__addr { display: block; margin-top: 8rpx; font-size: 22rpx; color: rgba(255,255,255,0.86); }
.hd__login { font-size: 24rpx; color: #fff; background: rgba(255,255,255,0.22); border-radius: 999rpx; padding: 8rpx 22rpx; }

.body { padding: 0 28rpx 50rpx; margin-top: -70rpx; }

.auth {
  display: flex; align-items: center; gap: 16rpx;
  background: #fff; border-radius: 20rpx; padding: 24rpx; box-shadow: var(--biz-shadow-card);
}
.auth__body { flex: 1; min-width: 0; }
.auth__t { font-size: 28rpx; font-weight: 600; color: var(--biz-text-1); }
.auth__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.auth__a { flex: none; font-size: 23rpx; color: var(--biz-primary); font-weight: 600; }

.stats { display: flex; background: #fff; border-radius: 20rpx; margin-top: 20rpx; padding: 24rpx 0; box-shadow: var(--biz-shadow-card); }
.stats__i { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4rpx; }
.stats__n { font-family: var(--biz-font-num); font-size: 34rpx; font-weight: 700; color: var(--biz-text-1); }
.stats__t { font-size: 20rpx; color: var(--biz-text-3); }

.grid { display: flex; flex-wrap: wrap; background: #fff; border-radius: 20rpx; margin-top: 20rpx; padding: 26rpx 0 6rpx; box-shadow: var(--biz-shadow-card); }
.grid__i { width: 25%; display: flex; flex-direction: column; align-items: center; gap: 10rpx; margin-bottom: 22rpx; }
.grid__ico { width: 72rpx; height: 72rpx; border-radius: 20rpx; background: var(--biz-bg-fill); color: var(--biz-text-2); display: flex; align-items: center; justify-content: center; font-size: 28rpx; font-weight: 600; }
.grid__t { font-size: 21rpx; color: var(--biz-text-2); }

.list { margin-top: 20rpx; }
.acts { margin-top: 26rpx; display: flex; flex-direction: column; gap: 16rpx; }
.ver { display: block; margin-top: 28rpx; text-align: center; font-size: 19rpx; color: var(--biz-text-4); }
</style>
