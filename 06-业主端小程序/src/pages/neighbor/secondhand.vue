<!-- 闲置详情：看图、想要、联系卖家（复制微信号）、举报；不开放发布与私聊 -->
<template>
  <view class="page">
    <NavBar title="闲置详情" :subtitle="item?.category || ''" />
    <view class="body" :class="{ 'body--with-foot': !!item }">
      <Empty v-if="!item" text="宝贝不存在或已下架" />
      <template v-else>
        <Cover :cover="item.cover" h="360rpx" :badge="item.condition" :label="item.category" />

        <view class="card sh">
          <view class="sh__f">
            <text class="sh__p">¥{{ item.price }}</text>
            <text class="sh__o">原价 ¥{{ item.originPrice }}</text>
            <Tag :text="item.status" size="sm" :color="item.status === '在售' ? 'var(--biz-accent-dark)' : 'var(--biz-text-3)'" />
          </view>
          <text class="sh__t">{{ item.title }}</text>
          <text class="sh__d">{{ item.desc }}</text>
          <view class="sh__meta">
            <text>卖家 {{ item.sellerName }} · {{ item.sellerHouse }}</text>
            <text>{{ item.views }} 浏览 · {{ item.wantCount }} 想要</text>
          </view>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">交易方式</text><text class="sec-hd__d">小区自提</text></view>
          <text class="sh__note">· 平台不代收、不担保：看好物品当面交易，先验货再付款。</text>
          <text class="sh__note">· 联系卖家会显示微信号，复制后微信添加；平台不做私聊。</text>
          <text class="sh__note">· 遇虚假信息可举报，物业核实后下架。</text>
        </view>

        <view id="sh-contact" class="sh__contact" @tap="contact"><text>联系卖家（复制微信号）</text></view>

        <view class="sh__tip">
          <text class="demo-tip">演示</text>
          <text class="sh__tip-t">本期不开放业主发布：内容为存量数据（物业代发），只能看与联系。发布要接内容安全审核 + 人工审核队列。</text>
        </view>
      </template>
    </view>

    <Bar
      v-if="item"
      :label="item.wanted ? '已收藏' : '想要'"
      :amount="''"
      :hint="`${item.wantCount} 人想要 · 线下交易`"
      :okText="item.wanted ? '取消想要' : '想要'"
      btn-id="sh-want"
      @submit="want"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Tag from '@/components/Tag.vue'
import Cover from '@/components/Cover.vue'
import Empty from '@/components/Empty.vue'
import { secondhandOf } from '@/api/neighbor'
import { toggleWant } from '@/store/app'
import { toast, toastOk } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const id = ref('')
const ver = ref(0)
const item = computed(() => {
  ver.value
  return id.value ? secondhandOf(id.value) : null
})

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})
onShow(() => {
  ver.value++
})

function want() {
  if (!gateLogin()) return
  toggleWant(id.value)
  ver.value++
  toastOk(item.value.wanted ? '已收藏' : '已取消')
}

function contact() {
  if (!gateLogin()) return
  uni.showModal({
    title: '联系卖家',
    content: `微信号：${item.value.wechat}\n长按复制后到微信添加，交易请当面验货。`,
    confirmText: '复制',
    success: res => {
      if (!res.confirm) return
      uni.setClipboardData({ data: item.value.wechat, success: () => toast('微信号已复制') })
    }
  })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 210rpx; }
.sh { margin-top: 20rpx; }
.sh__f { display: flex; align-items: baseline; gap: 12rpx; }
.sh__p { font-family: var(--biz-font-num); font-size: 44rpx; font-weight: 700; color: var(--biz-danger); }
.sh__o { font-size: 20rpx; color: var(--biz-text-4); text-decoration: line-through; }
.sh__t { display: block; margin-top: 12rpx; font-size: 29rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.sh__d { display: block; margin-top: 10rpx; font-size: 24rpx; color: var(--biz-text-2); line-height: 1.65; }
.sh__meta { display: flex; justify-content: space-between; margin-top: 16rpx; font-size: 20rpx; color: var(--biz-text-4); }
.sh__note { display: block; font-size: 22rpx; color: var(--biz-text-3); line-height: 1.8; }
.sh__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.sh__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
.sh__contact {
  margin-top: 20rpx; height: 88rpx; border-radius: var(--biz-radius-btn);
  background: #fff; border: 2rpx solid var(--biz-border); color: var(--biz-text-1);
  font-size: 27rpx; font-weight: 600; display: flex; align-items: center; justify-content: center;
}
</style>
