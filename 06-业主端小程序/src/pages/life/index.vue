<!--
  Tab 2 · 生活（占位）
  ------------------------------------------------------------
  商业后台未开发，这里只立骨架：分类 + 商家 + 服务卡，全部标「即将开放」，
  点进去是服务详情 + 敬请期待，**不产生订单、不接支付**。
  等商业部分接入时，这页的卡片结构、分类、商家字段都能直接复用。
-->
<template>
  <view class="page">
    <view class="hd">
      <text class="hd__t">生活</text>
      <view class="hd__soon"><text class="demo-tip">即将开放</text></view>
    </view>

    <view class="body">
      <view class="banner-card">
        <text class="banner-card__t">社区好服务，就在楼下</text>
        <text class="banner-card__d">家政保洁 / 家电清洗 / 上门维修 / 搬家，认证商家，物业把关</text>
      </view>

      <view class="cats">
        <view v-for="c in LIFE_CATS" :key="c.key" class="cats__i" @tap="pickCat(c)">
          <view class="cats__ico"><text>{{ c.icon }}</text></view>
          <text class="cats__t">{{ c.label }}</text>
          <text v-if="c.soon" class="cats__soon">待接入</text>
        </view>
      </view>

      <view class="sec-hd life-sec">
        <text class="sec-hd__t">{{ cat === '全部' ? '热门服务' : cat }}</text>
        <text class="sec-hd__d">{{ list.length }} 项</text>
      </view>

      <view v-for="s in list" :key="s.serviceId" class="card sv" @tap="goService(s.serviceId)">
        <view class="sv__thumb"><Cover :cover="s.cover" h="100%" /></view>
        <view class="sv__body">
          <text class="sv__t">{{ s.name }}</text>
          <text class="sv__d">{{ s.provider }} · 评分 {{ s.rating }} · 月售 {{ s.monthlySales }}</text>
          <view class="sv__f">
            <text class="sv__p">¥{{ s.price }}<text class="sv__u">/{{ s.unit }}</text></text>
            <text class="sv__a" :class="{ 'is-soon': s.status !== '可预约' }">{{ s.status === '可预约' ? '去看看' : '即将开放' }}</text>
          </view>
        </view>
      </view>

      <view class="sec-hd life-sec">
        <text class="sec-hd__t">认证商家</text>
        <text class="sec-hd__d">{{ merchants.length }} 家</text>
      </view>
      <view v-for="m in merchants" :key="m.merchantId" class="card mc">
        <Avatar :name="m.name" size="md" :tone="m.name.length" />
        <view class="mc__body">
          <view class="mc__hd">
            <text class="mc__n">{{ m.name }}</text>
            <Tag v-for="t in m.tags" :key="t" :text="t" size="sm" color="var(--biz-accent-dark)" />
          </view>
          <text class="mc__d">{{ m.category }} · {{ m.address }}</text>
        </view>
        <text class="mc__r">{{ m.rating }}</text>
      </view>

      <view class="tip">
        <text class="demo-tip">演示</text>
        <text class="tip__t">
          本页是**占位**：没有购物车、没有下单、没有支付。真实交易要接商户资质、
          库存、支付分账、售后与结算对账 —— 那是独立项目，不在本轮范围内。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import Cover from '@/components/Cover.vue'
import Avatar from '@/components/Avatar.vue'
import Tag from '@/components/Tag.vue'
import { LIFE_CATS, lifeHome, serviceList } from '@/api/life'
import { go, toast } from '@/utils/ui'

const cat = ref('全部')
const ver = ref(0)
const home = computed(() => lifeHome())
const merchants = computed(() => home.value.merchants)
const list = computed(() => {
  ver.value
  return serviceList({ category: cat.value === '全部' ? '' : cat.value })
})

onShow(() => {
  ver.value++
})

function pickCat(c) {
  if (c.soon) {
    toast(`${c.label} 待商业后台接入`)
    return
  }
  cat.value = cat.value === c.key ? '全部' : c.key
}

const goService = id => go('/pages/life/service', { id })
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.hd { padding: calc(env(safe-area-inset-top) + 26rpx) 28rpx 18rpx; display: flex; align-items: center; justify-content: space-between; }
.hd__t { font-size: 38rpx; font-weight: 700; color: var(--biz-text-1); }
.body { padding: 0 28rpx 40rpx; }

.banner-card {
  margin-top: 10rpx; padding: 28rpx; border-radius: 22rpx;
  background: linear-gradient(135deg, #5b6cff 0%, #7c8bff 100%);
  color: #fff;
}
.banner-card__t { font-size: 32rpx; font-weight: 700; }
.banner-card__d { display: block; margin-top: 10rpx; font-size: 21rpx; opacity: 0.9; line-height: 1.5; }

.cats { display: flex; flex-wrap: wrap; background: #fff; border-radius: 20rpx; margin-top: 20rpx; padding: 24rpx 0 8rpx; box-shadow: var(--biz-shadow-card); }
.cats__i { width: 25%; display: flex; flex-direction: column; align-items: center; gap: 8rpx; margin-bottom: 20rpx; position: relative; }
.cats__ico { width: 76rpx; height: 76rpx; border-radius: 22rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); display: flex; align-items: center; justify-content: center; font-size: 30rpx; font-weight: 700; }
.cats__t { font-size: 21rpx; color: var(--biz-text-2); }
.cats__soon { font-size: 17rpx; color: var(--biz-text-4); }

.life-sec { margin: 30rpx 0 16rpx; }
.sv { display: flex; gap: 18rpx; padding: 18rpx; align-items: center; }
.sv__thumb { flex: none; width: 190rpx; height: 132rpx; }
.sv__body { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
.sv__t { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.sv__d { display: block; margin-top: 6rpx; font-size: 20rpx; color: var(--biz-text-3); }
.sv__f { display: flex; align-items: baseline; justify-content: space-between; margin-top: 10rpx; }
.sv__p { font-family: var(--biz-font-num); font-size: 30rpx; font-weight: 700; color: var(--biz-danger); }
.sv__u { font-size: 19rpx; font-weight: 400; color: var(--biz-text-4); }
.sv__a { font-size: 21rpx; color: var(--biz-primary); font-weight: 600; }
.sv__a.is-soon { color: var(--biz-text-4); }

.mc { display: flex; align-items: center; gap: 18rpx; padding: 20rpx 22rpx; }
.mc__body { flex: 1; min-width: 0; }
.mc__hd { display: flex; align-items: center; gap: 10rpx; flex-wrap: wrap; }
.mc__n { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.mc__d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-3); }
.mc__r { font-family: var(--biz-font-num); font-size: 26rpx; font-weight: 700; color: var(--biz-warning); }

.tip { margin-top: 28rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.tip__t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
