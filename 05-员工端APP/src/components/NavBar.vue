<!-- 顶部导航：全部页面用自定义导航（pages.json 里 navigationStyle: custom） -->
<template>
  <view class="nav-wrap">
    <view class="nav" :style="{ paddingTop: statusH + 'px' }">
      <view class="nav__bar">
        <view v-if="back" class="nav__back" hover-class="nav__back--hover" @tap="onBack">
          <view class="chev" />
        </view>
        <view class="nav__title">
          <text class="nav__t">{{ title }}</text>
          <text v-if="subtitle" class="nav__s">{{ subtitle }}</text>
        </view>
        <view class="nav__right">
          <slot name="right" />
        </view>
      </view>
    </view>
    <!-- 占位：导航固定，正文让出高度 -->
    <view :style="{ height: statusH + 44 + 'px' }" />
  </view>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { back as goBack } from '@/utils/ui'

defineProps({
  title: { type: String, default: '' },
  subtitle: { type: String, default: '' },
  back: { type: Boolean, default: true }
})

const statusH = ref(0)
onMounted(() => {
  try {
    statusH.value = uni.getSystemInfoSync().statusBarHeight || 0
  } catch (e) {
    statusH.value = 0
  }
})

function onBack() {
  goBack()
}
</script>

<style scoped>
.nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  background: rgba(241, 242, 250, 0.94);
  backdrop-filter: saturate(160%) blur(12px);
}

.nav__bar {
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  position: relative;
}

.nav__back {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  margin-left: -4px;
}

.nav__back--hover {
  background: rgba(31, 37, 64, 0.06);
}

.chev {
  width: 10px;
  height: 10px;
  border-left: 2px solid var(--biz-text-1);
  border-bottom: 2px solid var(--biz-text-1);
  transform: rotate(45deg);
  border-radius: 1px;
  margin-left: 3px;
}

.nav__title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.nav__t {
  font-size: 17px;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.2;
  max-width: 60vw;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nav__s {
  font-size: 11px;
  color: var(--biz-text-3);
  margin-top: 1px;
}

.nav__right {
  min-width: 34px;
  display: flex;
  justify-content: flex-end;
  align-items: center;
}
</style>
