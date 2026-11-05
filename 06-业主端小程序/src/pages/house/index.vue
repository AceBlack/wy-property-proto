<!-- 我的房屋：房卡 + 房屋信息（只读）+ 住户（业主可见租金）+ 成员入口 -->
<template>
  <view class="page">
    <NavBar title="我的房屋" :subtitle="`${houses.length} 套已绑定`" />
    <view class="body">
      <view v-for="h in houses" :key="h.houseId" class="card hi" :class="{ 'is-active': h.houseId === activeId }">
        <view class="hi__hd">
          <text class="hi__name">{{ h.fullName }}</text>
          <Tag :text="h.identity" size="sm" color="var(--biz-primary)" />
          <text v-if="h.verifyStatus" class="hi__st">{{ h.verifyStatus }}</text>
        </view>
        <view class="hi__rows">
          <view class="hi__r"><text class="hi__k">建筑面积</text><text class="hi__v">{{ h.area }} ㎡</text></view>
          <view class="hi__r"><text class="hi__k">户型</text><text class="hi__v">{{ h.houseType }}</text></view>
          <view class="hi__r"><text class="hi__k">交付</text><text class="hi__v">{{ h.deliverStatus }}</text></view>
          <view class="hi__r"><text class="hi__k">使用状态</text><text class="hi__v">{{ h.useStatus }}</text></view>
          <view class="hi__r"><text class="hi__k">产权证</text><text class="hi__v">{{ h.certNo || '—' }}</text></view>
          <view class="hi__r"><text class="hi__k">楼栋管家</text><text class="hi__v">{{ h.steward?.name || '—' }}</text></view>
        </view>
        <view class="hi__acts">
          <view class="btn btn--sm btn--line" @tap="setActive(h.houseId)"><text>{{ h.houseId === activeId ? '当前房屋' : '设为当前' }}</text></view>
          <view class="btn btn--sm btn--ghost" @tap="goMembers(h.houseId)"><text>家庭成员</text></view>
        </view>
      </view>

      <!-- 住户 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">本房住户</text>
          <text class="sec-hd__d">{{ can.member ? '业主可添加成员' : '仅业主可管理成员' }}</text>
        </view>

        <view v-if="res.owner" class="row">
          <Avatar :name="res.owner.name" size="sm" :tone="1" />
          <view class="row__b">
            <text class="row__n">{{ res.owner.name }}</text>
            <text class="row__d">{{ maskPhone(res.owner.phone) }}</text>
          </view>
          <Tag text="业主" size="sm" color="var(--biz-primary)" />
        </view>

        <view v-for="m in res.members" :key="m.memberId" class="row">
          <Avatar :name="m.name" size="sm" :tone="m.name.length" />
          <view class="row__b">
            <text class="row__n">{{ m.name }}</text>
            <text class="row__d">{{ maskPhone(m.phone) }}</text>
          </view>
          <Tag :text="m.relation" size="sm" color="var(--biz-accent-dark)" />
        </view>

        <view v-for="t in res.tenants" :key="t.tenantId" class="row">
          <Avatar :name="t.name" size="sm" :tone="4" />
          <view class="row__b">
            <text class="row__n">{{ t.name }}<text class="row__tag">租客</text></text>
            <text class="row__d">{{ t.leaseStart }} ~ {{ t.leaseEnd }}</text>
            <text v-if="can.lease" class="row__rent">月租 ¥{{ t.rent }} · 押付方式见合同</text>
          </view>
          <Tag :text="t.verifyStatus" size="sm" :color="t.verifyStatus === '已核验' ? 'var(--biz-accent-dark)' : 'var(--biz-warning)'" />
        </view>

        <Empty v-if="!res.owner && !res.members.length && !res.tenants.length" text="暂无住户信息" />

        <view v-if="can.member" id="add-member" class="btn btn--ghost" @tap="goMembers(activeId)"><text>+ 添加家庭成员</text></view>
        <text v-if="!can.lease" class="hi__note">租金金额仅业主可见（与楼管口径相反：楼管看不到租金）。</text>
      </view>

      <view class="hi__tip">
        <text class="demo-tip">说明</text>
        <text class="hi__tip-t">
          房屋基础信息来自产权与交付资料，业主端只读；改房号 / 过户要走后台并留痕。
          解绑后不再看到该房账单与工单。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Avatar from '@/components/Avatar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import { app, switchHouse } from '@/store/app'
import { myHouses, residentsOf } from '@/api/mp'
import { maskPhone } from '@/utils/format'
import { go, toast } from '@/utils/ui'
import { can, gateOwner } from '@/utils/guard'

const ver = ref(0)
const houses = computed(() => {
  ver.value
  return myHouses()
})
const activeId = computed(() => app.activeHouseId || app.bindings[0]?.houseId || '')
const res = computed(() => {
  ver.value
  return activeId.value ? residentsOf(activeId.value) : { owner: null, members: [], tenants: [] }
})

onShow(() => {
  ver.value++
  if (!gateOwner('我的房屋')) return
})

function setActive(id) {
  switchHouse(id)
  ver.value++
  toast('已切换当前房屋')
}
const goMembers = id => go('/pages/house/member-manage', { houseId: id })
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 50rpx; }
.hi { border: 2rpx solid transparent; }
.hi.is-active { border-color: var(--biz-primary-light-8); }
.hi__hd { display: flex; align-items: center; gap: 12rpx; }
.hi__name { font-size: 29rpx; font-weight: 600; color: var(--biz-text-1); }
.hi__st { font-size: 19rpx; color: var(--biz-warning); background: #fff8f0; border-radius: 4rpx; padding: 2rpx 8rpx; }
.hi__rows { margin-top: 16rpx; display: flex; flex-wrap: wrap; }
.hi__r { width: 50%; display: flex; gap: 10rpx; padding: 8rpx 0; }
.hi__k { font-size: 22rpx; color: var(--biz-text-3); width: 140rpx; }
.hi__v { flex: 1; font-size: 23rpx; color: var(--biz-text-1); }
.hi__acts { display: flex; gap: 14rpx; margin-top: 18rpx; }
.hi__note { display: block; margin-top: 16rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.6; }
.hi__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.hi__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }

.row { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.row:last-of-type { border-bottom: none; }
.row__b { flex: 1; min-width: 0; }
.row__n { font-size: 26rpx; font-weight: 500; color: var(--biz-text-1); display: flex; align-items: center; gap: 10rpx; }
.row__tag { font-size: 18rpx; color: var(--biz-text-3); background: var(--biz-bg-fill); border-radius: 4rpx; padding: 1rpx 8rpx; }
.row__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.row__rent { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-warning); }
</style>
