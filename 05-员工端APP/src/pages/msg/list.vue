<template>
  <view class="page">
    <NavBar title="消息" :back="false" :subtitle="`公告 ${noticeTotal} 条`" />

    <view class="body body--tab">
      <view class="hd">
        <view class="hd__l">
          <text class="hd__n num">{{ noticeTotal }}</text>
          <text class="hd__k">全公司公告总数</text>
        </view>
        <view class="hd__r">
          <text class="hd__n num">{{ mine.length }}</text>
          <text class="hd__k">{{ communityLabel }}相关</text>
        </view>
      </view>

      <view class="tip">
        <text>P0 只做「看得到公告」，群发、已读统计、定向推送都在 PC 端公告管理里。</text>
      </view>

      <view v-for="n in mine" :key="n.noticeId" class="msg" hover-class="msg--hover" @tap="toggle(n.noticeId)">
        <view class="msg__hd">
          <text class="msg__type">{{ n.type }}</text>
          <text class="msg__time">{{ n.publishTime }}</text>
        </view>
        <text class="msg__t">{{ n.title }}</text>
        <text class="msg__d" :class="{ 'is-open': opened === n.noticeId }">{{ n.content }}</text>
        <view class="msg__ft">
          <text class="msg__p">{{ n.publisher }} 发布</text>
          <text class="msg__more">{{ opened === n.noticeId ? '收起' : '展开' }}</text>
        </view>
      </view>

      <Empty v-if="!mine.length" text="本项目暂无公告" sub="切到别的项目能看到别的公告" />
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import { communityNameOf, noticesOf, noticeTotal } from '@/api/mobile'
import { persona } from '@/store/app'

const opened = ref('')
const mine = computed(() => noticesOf(persona.value?.communityId))
const communityLabel = computed(() => communityNameOf(persona.value?.communityId))

function toggle(id) {
  opened.value = opened.value === id ? '' : id
}
</script>

<style scoped>
.body--tab {
  padding-bottom: 40rpx;
}

.hd {
  display: flex;
  background: #fff;
  border-radius: 22rpx;
  padding: 26rpx;
  box-shadow: var(--biz-shadow-card);
  margin-bottom: 20rpx;
}

.hd__l,
.hd__r {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.hd__r {
  align-items: flex-end;
  border-left: 2rpx solid var(--biz-border-light);
  padding-left: 24rpx;
}

.hd__n {
  font-size: 48rpx;
  line-height: 1;
  color: var(--biz-primary);
}

.hd__r .hd__n {
  color: var(--biz-text-1);
}

.hd__k {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.tip {
  font-size: 21rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
  padding: 0 8rpx 20rpx;
}

.msg {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: var(--biz-shadow-card);
}

.msg--hover {
  background: var(--biz-bg-hover);
}

.msg__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.msg__type {
  font-size: 19rpx;
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border: 2rpx solid var(--biz-primary-light-8);
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
}

.msg__time {
  font-size: 20rpx;
  color: var(--biz-text-4);
  font-family: var(--biz-font-num);
}

.msg__t {
  display: block;
  margin-top: 14rpx;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.4;
}

.msg__d {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.msg__d.is-open {
  display: block;
  -webkit-line-clamp: unset;
}

.msg__ft {
  margin-top: 14rpx;
  padding-top: 12rpx;
  border-top: 2rpx dashed var(--biz-border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.msg__p {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.msg__more {
  font-size: 20rpx;
  color: var(--biz-primary);
}
</style>
