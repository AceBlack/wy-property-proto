<!-- 服务详情（占位）：看得到、约不了 -->
<template>
  <view class="page">
    <NavBar title="服务详情" :subtitle="sv?.category || ''" />
    <view class="body">
      <Empty v-if="!sv" text="服务不存在" />
      <template v-else>
        <Cover :cover="sv.cover" h="300rpx" :label="sv.category" :badge="sv.status" />
        <view class="card lv">
          <text class="lv__t">{{ sv.name }}</text>
          <view class="lv__f">
            <text class="lv__p">¥{{ sv.price }}<text class="lv__u">/{{ sv.unit }}</text></text>
            <text class="lv__s">评分 {{ sv.rating }} · 月售 {{ sv.monthlySales }}</text>
          </view>
          <text class="lv__d">{{ sv.desc }}</text>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">服务商</text></view>
          <view class="lv__m">
            <Avatar :name="sv.provider" size="md" :tone="sv.provider.length" />
            <view class="lv__mb">
              <text class="lv__mn">{{ sv.provider }}</text>
              <text class="lv__md">{{ sv.merchant?.address || '' }}</text>
            </view>
            <Tag v-for="t in sv.merchant?.tags || []" :key="t" :text="t" size="sm" color="var(--biz-accent-dark)" />
          </view>
        </view>

        <view class="lv__tip">
          <text class="demo-tip">占位</text>
          <text class="lv__tip-t">
            生活服务是**占位页**：本轮没有下单、没有支付、没有售后。商业后台接入后，
            这里会变成「规格选择 → 预约时间 → 在线支付 → 服务评价」。
          </text>
        </view>
      </template>
    </view>

    <Bar v-if="sv" label="状态" :amount="sv.status" hint="商业后台接入后开放" okText="敬请期待" btn-id="life-soon" @submit="soon" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Cover from '@/components/Cover.vue'
import Tag from '@/components/Tag.vue'
import Avatar from '@/components/Avatar.vue'
import Empty from '@/components/Empty.vue'
import { serviceOf } from '@/api/life'
import { toast } from '@/utils/ui'

const id = ref('')
const sv = computed(() => (id.value ? serviceOf(id.value) : null))

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})

function soon() {
  toast('生活服务即将开放，敬请期待')
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 200rpx; }
.lv { margin-top: 20rpx; }
.lv__t { font-size: 31rpx; font-weight: 700; color: var(--biz-text-1); }
.lv__f { display: flex; align-items: baseline; justify-content: space-between; margin-top: 12rpx; }
.lv__p { font-family: var(--biz-font-num); font-size: 40rpx; font-weight: 700; color: var(--biz-danger); }
.lv__u { font-size: 20rpx; font-weight: 400; color: var(--biz-text-4); }
.lv__s { font-size: 21rpx; color: var(--biz-text-3); }
.lv__d { display: block; margin-top: 14rpx; font-size: 24rpx; color: var(--biz-text-2); line-height: 1.7; }
.lv__m { display: flex; align-items: center; gap: 14rpx; }
.lv__mb { flex: 1; min-width: 0; }
.lv__mn { font-size: 26rpx; font-weight: 600; color: var(--biz-text-1); }
.lv__md { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-3); }
.lv__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.lv__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
