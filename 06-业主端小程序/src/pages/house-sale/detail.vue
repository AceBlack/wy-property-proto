<!--
  房源详情（§13.2 第 2 屏）
  ------------------------------------------------------------
  公开页，**不挂门禁**。页面里刻意没有这几样东西：
    · 房号 / 单元 —— 连登录也不给（看房不需要知道房号，楼管带过去自然知道）；
    · 业主姓名 / 电话 —— 业主是出租方，不是商品；
    · 楼管手机号 —— 只给姓名、微信号、二维码；
    · 浏览量 / 看房请求数 —— 那是业主自己的经营数据，不对外。
  底线一句话：**这张页会被截图、被爬，少一个字段就少一分被踩点的可能。**
-->
<template>
  <view class="page">
    <NavBar title="房源详情" :subtitle="l ? l.communityName : ''" />
    <view class="body" :class="{ 'body--with-foot': !!l }">
      <Empty v-if="!l" text="房源不存在或已下架" sub="下架 / 待审核的房源一律当它不存在" />

      <template v-else>
        <Cover :cover="l.price % 6" h="360rpx" :badge="`${l.images} 张图`" :label="l.communityName" />

        <view class="card ld">
          <view class="ld__hd">
            <text class="ld__p">¥{{ l.price }}<text class="ld__u">/月</text></text>
            <text class="ld__dep">押金 {{ l.deposit }} · {{ l.payTerm }}</text>
          </view>
          <text class="ld__t">{{ l.communityName }} {{ l.buildingName }}</text>
          <text class="ld__d">{{ l.houseType }} · {{ l.area }}㎡ · {{ l.orientation }} · 第 {{ l.floor }} 层</text>
          <view class="ld__tags">
            <Tag :text="l.decorate || '简装'" size="sm" color="var(--biz-primary)" />
            <Tag :text="l.type" size="sm" color="var(--biz-text-3)" />
            <Tag v-if="l.availableFrom" :text="`${l.availableFrom} 起可入住`" size="sm" color="var(--biz-accent-dark)" />
          </view>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">房屋信息</text><text class="sec-hd__d">来自物业档案，未经业主填写</text></view>
          <view class="ld__rows">
            <view class="ld__r"><text class="ld__k">户型</text><text class="ld__v">{{ l.houseType }}</text></view>
            <view class="ld__r"><text class="ld__k">建筑面积</text><text class="ld__v">{{ l.area }} ㎡</text></view>
            <view class="ld__r"><text class="ld__k">朝向</text><text class="ld__v">{{ l.orientation }}</text></view>
            <view class="ld__r"><text class="ld__k">楼层</text><text class="ld__v">第 {{ l.floor }} 层</text></view>
            <view class="ld__r"><text class="ld__k">装修</text><text class="ld__v">{{ l.decorate || '—' }}</text></view>
            <view class="ld__r"><text class="ld__k">可入住</text><text class="ld__v">{{ l.availableFrom || '随时' }}</text></view>
          </view>
          <text class="ld__note">面积、户型、朝向、楼层由房屋档案带出，业主不可修改 —— 从设计上消灭"虚标面积"。</text>
        </view>

        <view v-if="l.facilities.length" class="card">
          <view class="sec-hd"><text class="sec-hd__t">配套</text><text class="sec-hd__d">{{ l.facilities.length }} 项</text></view>
          <view class="chips">
            <text v-for="f in l.facilities" :key="f" class="chip">{{ f }}</text>
          </view>
        </view>

        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">房源描述</text><text class="sec-hd__d">业主提供</text></view>
          <text class="ld__desc">{{ l.desc || '业主未填写描述' }}</text>
        </view>

        <!-- 责任楼管：只给姓名 + 微信，不给手机号 -->
        <view v-if="l.steward" class="card ld__st">
          <Avatar :name="l.steward.name" size="md" :tone="2" />
          <view class="ld__st-b">
            <text class="ld__st-n">{{ l.steward.name }} · {{ l.steward.position }}</text>
            <text class="ld__st-d">本房责任楼管，带看与答疑都由他负责</text>
          </view>
          <view v-if="l.canWechat" class="ld__st-a" @tap="contactWechat"><text>加微信</text></view>
        </view>

        <!-- 二维码：有就显示，没有就只留「我要看房」 -->
        <view v-if="l.canWechat && l.steward.qrUrl" class="card ld__qr">
          <text class="ld__qr-t">物业服务联系</text>
          <view class="ld__qr-box"><text>二维码</text></view>
          <text v-if="l.steward.wechatId" class="ld__qr-d">或搜索微信号 {{ l.steward.wechatId }}</text>
        </view>

        <view class="ld__tip">
          <text class="demo-tip">隐私</text>
          <text class="ld__tip-t">
            页面不展示任何员工手机号；「我要看房」留的是**您自己的号码**，只提供给本房责任楼管，
            用于本次看房联系，90 天后自动删除，不进入任何营销名单。
          </text>
        </view>
      </template>
    </view>

    <Bar
      v-if="l"
      label="看房"
      :amount="''"
      hint="楼管 24 小时内联系你"
      okText="我要看房"
      btn-id="viewing-entry"
      @submit="goViewing"
    >
      <template #left>
        <view v-if="l.canWechat" class="ld__wx" @tap="contactWechat"><text>加楼管微信</text></view>
        <text v-else class="ld__wxhint">楼管未填微信，留电话由他回拨</text>
      </template>
    </Bar>
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
import { listingDetail } from '@/api/listing'
import { go, toast } from '@/utils/ui'

const id = ref('')
const l = computed(() => (id.value ? listingDetail(id.value) : null))

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})

const goViewing = () => go('/pages/house-sale/viewing', { id: id.value })

function contactWechat() {
  const wx = l.value?.steward?.wechatId
  if (!wx) return toast('楼管未填微信号，请用「我要看房」留言')
  uni.setClipboardData({
    data: wx,
    success: () => toast('微信号已复制，去微信添加')
  })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 220rpx; }

.ld { margin-top: 20rpx; }
.ld__hd { display: flex; align-items: baseline; gap: 14rpx; }
.ld__p { font-family: var(--biz-font-num); font-size: 46rpx; font-weight: 700; color: var(--biz-danger); }
.ld__u { font-size: 20rpx; font-weight: 400; color: var(--biz-text-4); }
.ld__dep { font-size: 20rpx; color: var(--biz-text-3); }
.ld__t { display: block; margin-top: 10rpx; font-size: 30rpx; font-weight: 700; color: var(--biz-text-1); }
.ld__d { display: block; margin-top: 8rpx; font-size: 22rpx; color: var(--biz-text-3); }
.ld__tags { display: flex; gap: 10rpx; margin-top: 14rpx; flex-wrap: wrap; }

.ld__rows { display: flex; flex-wrap: wrap; }
.ld__r { width: 50%; display: flex; gap: 12rpx; padding: 8rpx 0; }
.ld__k { width: 110rpx; flex: none; font-size: 22rpx; color: var(--biz-text-3); }
.ld__v { flex: 1; font-size: 23rpx; color: var(--biz-text-1); }
.ld__note { display: block; margin-top: 12rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.6; }
.ld__desc { display: block; font-size: 24rpx; color: var(--biz-text-2); line-height: 1.75; }

.ld__st { display: flex; align-items: center; gap: 18rpx; }
.ld__st-b { flex: 1; min-width: 0; }
.ld__st-n { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.ld__st-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-3); }
.ld__st-a { flex: none; padding: 8rpx 20rpx; border-radius: 999rpx; background: #e8f8ee; color: #0aa84f; font-size: 21rpx; }

.ld__qr { display: flex; flex-direction: column; align-items: center; }
.ld__qr-t { font-size: 22rpx; color: var(--biz-text-2); font-weight: 600; }
.ld__qr-box {
  width: 260rpx; height: 260rpx; margin-top: 14rpx; border-radius: 16rpx;
  border: 6rpx solid #fff; box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.08);
  background: var(--biz-bg-fill); color: var(--biz-text-4); font-size: 22rpx;
  display: flex; align-items: center; justify-content: center;
}
.ld__qr-d { margin-top: 12rpx; font-size: 20rpx; color: var(--biz-text-3); }

.ld__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.ld__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }

.ld__wx {
  align-self: flex-start; height: 68rpx; padding: 0 22rpx; border-radius: var(--biz-radius-btn);
  background: #e8f8ee; color: #0aa84f; font-size: 23rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.ld__wxhint { font-size: 20rpx; color: var(--biz-text-4); }
</style>
