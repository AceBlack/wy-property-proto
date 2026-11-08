<template>
  <view class="page">
    <NavBar title="我的联系方式" subtitle="展示给看房者" />

    <view class="body body--with-foot">
      <view class="hint">
        <text class="hint__t">这段信息会出现在租售信息页</text>
        <text class="hint__d">
          看房者看完房源想联系你，看到的就是这里的微信号和二维码。
          填了就是愿意展示，没填就不显示 —— 没有「是否公开」开关。
        </text>
      </view>

      <view class="card">
        <view class="row">
          <text class="row__k">姓名</text>
          <text class="row__v">{{ me?.name || persona?.name }} · {{ me?.position || persona?.post }}</text>
        </view>
        <view class="row row--col">
          <text class="row__k">微信号</text>
          <input
            id="mc-wechat"
            v-model="wechatId"
            class="input"
            :maxlength="30"
            placeholder="例如 wx_morui，可留空"
            placeholder-class="ph-txt"
          />
        </view>

        <view class="row row--col">
          <text class="row__k">二维码</text>
          <PhotoPicker v-model="photos" :max="1" />
          <text class="row__tip">加个微信二维码，看房者扫码就能加你，不用手打微信号</text>
        </view>
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">手机号不在这里</text>
        </view>
        <text class="p">
          手机号只在内部通讯录里给同事看，不对业主和看房者展示。
          看房者要联系就留自己的号码，你回拨 —— 反过来才有保护。
        </text>
      </view>

      <view class="tail">
        <text>
          保存后回 PC 的租售审核页能看到同一个微信号：两侧读的是同一份员工档案。
        </text>
      </view>
    </view>

    <view class="footbar">
      <view id="mc-save" class="btn btn--primary foot-btn" @tap="save">保存</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { myContactOf, saveMyContact } from '@/api/listing'
import { persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const me = ref(null)
const wechatId = ref('')
const photos = ref([])

async function load() {
  try {
    me.value = await myContactOf(persona.value)
    wechatId.value = me.value?.wechatId || ''
    /* 原型不存真图：有地址就摆一张占位，让"已上传"和"没上传"看得出区别 */
    photos.value = me.value?.contactQrUrl
      ? [{ id: 'qr', kind: 'placeholder', src: '' }]
      : []
  } catch (e) {
    toastErr(e.message || '联系方式加载失败')
  }
}

async function save() {
  try {
    await saveMyContact(persona.value, {
      wechatId: wechatId.value.trim(),
      contactQrUrl: photos.value.length ? `qr/${persona.value?.empId || 'me'}.png` : ''
    })
    toastOk('已保存，租售页立刻按新信息展示')
    load()
  } catch (e) {
    toastErr(e.message || '保存失败')
  }
}

onLoad(() => load())
</script>

<style scoped>
.hint {
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.hint__t {
  display: block;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  margin-bottom: 8rpx;
}

.hint__d {
  display: block;
  font-size: 19rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.row:last-child {
  border-bottom: none;
}

.row--col {
  flex-direction: column;
  align-items: stretch;
  gap: 10rpx;
}

.row__k {
  flex: none;
  width: 120rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.row--col .row__k {
  width: auto;
}

.row__v {
  flex: 1;
  font-size: 23rpx;
  color: var(--biz-text-1);
}

.row__tip {
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.sec-hd {
  margin-bottom: 8rpx;
}

.sec-hd__t {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.p {
  display: block;
  font-size: 20rpx;
  color: var(--biz-text-2);
  line-height: 1.65;
}

.ph-txt {
  color: var(--biz-text-4);
}

.foot-btn {
  flex: 1;
  height: 88rpx;
  font-size: 28rpx;
}

.tail {
  padding: 10rpx 4rpx 20rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}
</style>
