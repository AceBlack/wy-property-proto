<!--
  底部操作条：左边金额摘要、右边主按钮。

  踩过的坑（交接单 §九）：**不要在一条 padding 里混用 `constant()` 和 `var()`** ——
  Chrome 认不出 `constant()` 会让整条声明失效，底栏内边距直接变 0，按钮压到安全区外面。
  所以这里 `env()` 单独一条声明，`constant()` 再单独一条，谁认谁生效。
-->
<template>
  <view class="bbar">
    <view class="bbar__inner">
      <view class="bbar__left">
        <slot name="left">
          <text v-if="label" class="bbar__label">{{ label }}</text>
          <text v-if="amount" class="bbar__amount">{{ amount }}</text>
          <text v-if="hint" class="bbar__hint">{{ hint }}</text>
        </slot>
      </view>
      <view class="bbar__right">
        <slot name="right">
          <view
            v-if="okText"
            :id="btnId || undefined"
            class="bbar__btn"
            :class="{ 'is-disabled': disabled }"
            hover-class="bbar__btn--hover"
            @tap="onTap"
          >
            <text>{{ okText }}</text>
          </view>
        </slot>
      </view>
    </view>
  </view>
</template>

<script setup>
const props = defineProps({
  label: { type: String, default: '' },
  amount: { type: String, default: '' },
  hint: { type: String, default: '' },
  okText: { type: String, default: '' },
  disabled: { type: Boolean, default: false },
  /** 主按钮的 id：给冒烟脚本一个稳定锚点（按钮文案会随状态变，id 不变） */
  btnId: { type: String, default: '' }
})
/* 用 'submit' 不用 'tap'：uni 的 tap 是原生事件名，$emit('tap') 到父级拿到的是事件对象，参数会丢 */
const emit = defineEmits(['submit'])

function onTap() {
  if (props.disabled) return
  emit('submit')
}
</script>

<style scoped>
.bbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: saturate(160%) blur(12px);
  border-top: 2rpx solid var(--biz-border-light);
  padding-bottom: 0;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
}

.bbar__inner {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 18rpx 28rpx;
  min-height: 108rpx;
}

.bbar__left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
}

.bbar__label {
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.bbar__amount {
  font-family: var(--biz-font-num);
  font-size: 40rpx;
  font-weight: 700;
  color: var(--biz-text-1);
  line-height: 1.15;
}

.bbar__hint {
  font-size: 21rpx;
  color: var(--biz-text-4);
}

.bbar__right {
  flex: none;
}

.bbar__btn {
  min-width: 232rpx;
  height: 84rpx;
  border-radius: var(--biz-radius-btn);
  background: var(--biz-primary);
  box-shadow: var(--biz-shadow-primary);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bbar__btn--hover {
  background: var(--biz-primary-hover);
}

.bbar__btn.is-disabled {
  background: var(--biz-text-4);
  box-shadow: none;
}
</style>
