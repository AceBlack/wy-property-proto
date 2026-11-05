<template>
  <view class="login">
    <view class="hero">
      <view class="hero__row">
        <text class="hero__brand">智慧物业 V2</text>
        <text class="hero__chip">P0 原型</text>
      </view>
      <text class="hero__title">员工端</text>
      <text class="hero__sub">巡检执行 · 监督核验 · 现场留证</text>
      <view class="hero__meta">
        <text class="hero__dot" />
        <text class="hero__date">演示日期 {{ DEMO.today }} {{ DEMO.nowTime }}</text>
      </view>
    </view>

    <view class="body">
      <view class="tip">选择身份即登录，对齐后台「以某角色查看」的做法，不输账号密码。</view>

      <view
        v-for="p in personas"
        :key="p.id"
        class="pcard"
        hover-class="pcard--hover"
        @tap="pick(p)"
      >
        <view class="pcard__ava" :class="{ 'is-lead': p.lead }">
          <text>{{ p.name.slice(0, 1) }}</text>
        </view>
        <view class="pcard__main">
          <view class="pcard__t">
            <text class="pcard__name">{{ p.name }}</text>
            <text class="pcard__role" :class="{ 'is-lead': p.lead }">{{ roleBadge(p) }}</text>
          </view>
          <text class="pcard__meta">{{ p.post }} · {{ p.orgName }}</text>
          <text class="pcard__desc">{{ p.desc }}</text>
        </view>
        <view class="pcard__chev" />
      </view>

      <view class="foot">
        <text class="foot__t">关于这些账号</text>
        <text class="foot__d">
          账号取自巡检任务里的执行人，保证点进去有真实数据。个别一线执行人是计划上的运营设定值、
          不在员工名册，工号显示为「—」，这不是数据缺陷（后台端踩过同样的坑）。
        </text>
        <text class="foot__d">
          四个身份代表四类权限：一线（工程维修）只做自己的巡检与工单；班组长多出监督核验、客服主管节点审批与本部门整改；
          楼栋管家多出责任楼栋的欠费与催收；项目经理多出项目经理节点审批、整改复核、工单指派与费用看板。
        </text>
        <text class="foot__d">
          报表、模板配置、计划编排、收款与月结仍在 PC；移动端不做代他人操作。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { PERSONAS, DEMO, roleBadge } from '@/config/personas'
import { login } from '@/store/app'

const personas = PERSONAS

function pick(p) {
  login(p.id)
  uni.switchTab({ url: '/pages/home/index' })
}
</script>

<style scoped>
.login {
  min-height: 100vh;
  background: var(--biz-bg-page);
}

.hero {
  padding: calc(80rpx + env(safe-area-inset-top)) 44rpx 60rpx;
  background: var(--biz-gradient);
  color: #fff;
  border-bottom-left-radius: 40rpx;
  border-bottom-right-radius: 40rpx;
}

.hero__row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.hero__brand {
  font-size: 24rpx;
  letter-spacing: 2rpx;
  opacity: 0.9;
}

.hero__chip {
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.22);
}

.hero__title {
  display: block;
  margin-top: 22rpx;
  font-size: 60rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
  line-height: 1.15;
}

.hero__sub {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  opacity: 0.92;
}

.hero__meta {
  margin-top: 34rpx;
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.hero__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #fff;
  opacity: 0.85;
}

.hero__date {
  font-size: 23rpx;
  opacity: 0.9;
}

.body {
  padding: 28rpx 28rpx 60rpx;
}

.tip {
  font-size: 24rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
  margin: 4rpx 8rpx 22rpx;
}

.pcard {
  display: flex;
  align-items: flex-start;
  gap: 22rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 26rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.pcard--hover {
  box-shadow: var(--biz-shadow-card-hover);
  transform: translateY(-1px);
}

.pcard__ava {
  flex: none;
  width: 88rpx;
  height: 88rpx;
  border-radius: 26rpx;
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  font-weight: 600;
}

.pcard__ava.is-lead {
  background: #fff8f0;
  color: var(--biz-warning);
}

.pcard__main {
  flex: 1;
  min-width: 0;
}

.pcard__t {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.pcard__name {
  font-size: 32rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.pcard__role {
  font-size: 20rpx;
  padding: 4rpx 12rpx;
  border-radius: 999rpx;
  color: var(--biz-primary);
  border: 2rpx solid var(--biz-primary-light-8);
  background: var(--biz-primary-light-9);
}

.pcard__role.is-lead {
  color: var(--biz-warning);
  border-color: rgba(255, 159, 64, 0.32);
  background: #fff8f0;
}

.pcard__meta {
  display: block;
  margin-top: 8rpx;
  font-size: 23rpx;
  color: var(--biz-text-3);
}

.pcard__desc {
  display: block;
  margin-top: 12rpx;
  font-size: 20rpx;
  color: var(--biz-text-3);
  line-height: 1.55;
}

.pcard__chev {
  width: 16rpx;
  height: 16rpx;
  border-top: 3rpx solid var(--biz-text-4);
  border-right: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
  margin-top: 34rpx;
  flex: none;
}

.foot {
  margin-top: 40rpx;
  padding: 26rpx;
  background: var(--biz-bg-fill);
  border-radius: 20rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.foot__t {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--biz-text-2);
}

.foot__d {
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
}
</style>
