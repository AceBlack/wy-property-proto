<!--
  房源频道（§13.2 第 1 屏）
  ------------------------------------------------------------
  **不挂任何门禁**：这是给"想租的人"看的，他们绝大多数不是业主。
  加了登录就退回"只有业主能看"，而这批客源基本不是业主（§13.9 第 2 条）。

  列表只回公开字段：小区 / 楼栋 / 户型 / 面积 / 朝向 / 楼层 / 租金 / 押付 / 可入住。
  **没有房号、没有业主信息、没有楼管手机号** —— 字段层面就不给（§13.4）。
-->
<template>
  <view class="page">
    <NavBar title="租售信息" subtitle="业主发布 · 楼管审核" />

    <view class="body">
      <view class="hs__hero">
        <text class="hs__hero-t">业主自己发的出租信息</text>
        <text class="hs__hero-d">物业只代为展示，不参与交易与议价；看房由楼管带看。</text>
      </view>

      <!-- 筛选 -->
      <view class="chips-row">
        <view v-for="c in communityOpts" :key="c.key" class="chip" :class="{ 'is-on': communityId === c.key }" @tap="communityId = c.key">
          <text>{{ c.label }}</text>
        </view>
      </view>
      <view class="chips-row">
        <view v-for="t in typeOpts" :key="t" class="chip" :class="{ 'is-on': houseType === t }" @tap="houseType = houseType === t ? '' : t">
          <text>{{ t }}</text>
        </view>
      </view>
      <view class="chips-row">
        <view v-for="b in PRICE_BANDS" :key="b.key" class="chip" :class="{ 'is-on': band === b.key }" @tap="band = b.key">
          <text>{{ b.label }}</text>
        </view>
      </view>

      <view class="hs__bar">
        <text class="hs__count">{{ list.length }} 套在租</text>
        <view class="hs__sorts">
          <text v-for="s in LISTING_SORTS" :key="s.key" class="hs__sort" :class="{ 'is-on': sort === s.key }" @tap="sort = s.key">
            {{ s.label }}
          </text>
        </view>
      </view>

      <Empty v-if="!list.length" text="没有符合条件的房源" sub="换个筛选条件，或看看其他小区" />

      <view v-for="l in list" :key="l.listingId" class="card li" @tap="goDetail(l.listingId)">
        <Cover :cover="l.listingId.length + l.price" h="260rpx" badge="业主发布" :label="l.communityName" />
        <view class="li__b">
          <view class="li__hd">
            <text class="li__t">{{ l.communityName }} {{ l.buildingName }}</text>
            <text class="li__p">¥{{ l.price }}<text class="li__u">/月</text></text>
          </view>
          <text class="li__d">{{ l.houseType }} · {{ l.area }}㎡ · {{ l.orientation }} · {{ l.floor }} 层</text>
          <view class="li__tags">
            <Tag :text="l.decorate || '简装'" size="sm" color="var(--biz-text-3)" />
            <Tag :text="l.payTerm" size="sm" color="var(--biz-text-3)" />
            <Tag v-if="l.availableFrom" :text="`${l.availableFrom.slice(5)} 可入住`" size="sm" color="var(--biz-accent-dark)" />
          </view>
        </view>
      </view>

      <view class="hs__entry">
        <view class="hs__entry-b" @tap="goPublish">
          <text class="hs__entry-t">我有房要出租</text>
          <text class="hs__entry-d">业主本人发布，楼管审核后展示；面积户型从档案带出，改不了</text>
        </view>
        <view id="my-listings" class="hs__entry-a" @tap="goMine"><text>我的挂牌</text></view>
      </view>

      <view class="hs__tip">
        <text class="demo-tip">口径</text>
        <text class="hs__tip-t">
          平台只做信息发布：不代收租金、不收佣金、不做在线带看排期。
          想联系就点「我要看房」留自己的号码，由楼管回拨 —— 页面上不会出现任何员工手机号。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Cover from '@/components/Cover.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import { LISTING_SORTS, PRICE_BANDS, listingList } from '@/api/listing'
import { go } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const communityId = ref('')
const houseType = ref('')
const band = ref('all')
const sort = ref('new')
const ver = ref(0)

const all = computed(() => {
  ver.value
  return listingList({})
})
const communityOpts = computed(() => {
  const map = new Map()
  all.value.forEach(l => map.set(l.communityId, l.communityName))
  return [{ key: '', label: '全部小区' }, ...[...map.entries()].map(([key, label]) => ({ key, label }))]
})
const typeOpts = computed(() => [...new Set(all.value.map(l => l.houseType))])
const list = computed(() => {
  ver.value
  return listingList({ communityId: communityId.value, houseType: houseType.value, priceBand: band.value, sort: sort.value })
})

onShow(() => {
  ver.value++
})

const goDetail = id => go('/pages/house-sale/detail', { id })
const goPublish = () => (gateOwner('发布租售') ? go('/pages/house-sale/publish') : null)
const goMine = () => (gateOwner('我的挂牌') ? go('/pages/house-sale/mine') : null)
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 16rpx 28rpx 50rpx; }

.hs__hero { padding: 22rpx 24rpx; border-radius: 18rpx; background: linear-gradient(135deg, #eef1ff, #f7f8ff); }
.hs__hero-t { font-size: 26rpx; font-weight: 700; color: var(--biz-text-1); }
.hs__hero-d { display: block; margin-top: 6rpx; font-size: 20rpx; color: var(--biz-text-3); line-height: 1.6; }

.chips-row { display: flex; gap: 12rpx; margin-top: 16rpx; }

.hs__bar { display: flex; align-items: center; justify-content: space-between; margin: 22rpx 0 12rpx; }
.hs__count { font-size: 21rpx; color: var(--biz-text-3); }
.hs__sorts { display: flex; gap: 16rpx; }
.hs__sort { font-size: 20rpx; color: var(--biz-text-3); }
.hs__sort.is-on { color: var(--biz-primary); font-weight: 600; }

.li { padding: 0; overflow: hidden; }
.li__b { padding: 18rpx 22rpx 22rpx; }
.li__hd { display: flex; align-items: baseline; gap: 14rpx; }
.li__t { flex: 1; font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.li__p { font-family: var(--biz-font-num); font-size: 32rpx; font-weight: 700; color: var(--biz-danger); }
.li__u { font-size: 18rpx; font-weight: 400; color: var(--biz-text-4); }
.li__d { display: block; margin-top: 8rpx; font-size: 21rpx; color: var(--biz-text-3); }
.li__tags { display: flex; gap: 10rpx; margin-top: 12rpx; flex-wrap: wrap; }

.hs__entry { margin-top: 24rpx; display: flex; align-items: center; gap: 16rpx; padding: 22rpx 24rpx; background: #fff; border-radius: 18rpx; box-shadow: var(--biz-shadow-card); }
.hs__entry-b { flex: 1; min-width: 0; }
.hs__entry-t { font-size: 26rpx; font-weight: 600; color: var(--biz-text-1); }
.hs__entry-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-3); line-height: 1.5; }
.hs__entry-a { flex: none; font-size: 22rpx; color: var(--biz-primary); font-weight: 600; }

.hs__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.hs__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
