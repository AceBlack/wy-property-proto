<!-- 无权限占位：移动端也要"看得见的权限边界"，不能靠页面上什么都不显示 -->
<template>
  <view class="np">
    <view class="np__ico">锁</view>
    <text class="np__t">{{ title }}</text>
    <text class="np__s">{{ sub }}</text>
    <text v-if="perm" class="np__p">权限位：{{ perm }}</text>
  </view>
</template>

<script setup>
defineProps({
  title: { type: String, default: '当前角色没有这个模块' },
  sub: { type: String, default: '换一个身份可以看到 —— 移动端按角色装配，不是所有人都能看到所有入口。' },
  perm: { type: String, default: '' }
})
</script>

<style scoped>
.np {
  background: #fff;
  border-radius: 22rpx;
  padding: 60rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14rpx;
  box-shadow: var(--biz-shadow-card);
}

.np__ico {
  width: 84rpx;
  height: 84rpx;
  border-radius: 24rpx;
  background: var(--biz-bg-fill);
  color: var(--biz-text-4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
}

.np__t {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.np__s {
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
  text-align: center;
}

.np__p {
  margin-top: 6rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  font-family: var(--biz-font-mono);
}
</style>
