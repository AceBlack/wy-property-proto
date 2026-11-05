<!--
  认证 4/4 · 身份信息 + 提交
  ------------------------------------------------------------
  三条口径（2026-11-01 定稿）：
    · 手机号 + 姓名 + 证件后四位 与档案对得上 → **直接生效**，不审核；
    · 身份以档案为准（选"业主"但档案是家属，按家属生效并提示）；
    · 对不上才进人工审核 —— 这时**必须**传购房合同/房产证，否则物业没法核验。
-->
<template>
  <view class="page">
    <NavBar title="身份信息" :subtitle="flow.houseName" />
    <view class="body">
      <view class="card">
        <view class="ai__house">
          <text class="ai__house-t">{{ flow.houseName }}</text>
          <text class="ai__house-d">{{ flow.communityName }} {{ flow.buildingName }}</text>
        </view>

        <view class="field">
          <view class="field__k"><text>我的身份</text><text class="field__hint">以物业档案为准</text></view>
          <view class="ai__roles">
            <view v-for="r in roles" :key="r" class="chip" :class="{ 'is-on': identity === r }" @tap="identity = r">
              <text>{{ r }}</text>
            </view>
          </view>
        </view>

        <view class="field">
          <view class="field__k"><text>姓名</text><text class="field__hint">与房产证一致</text></view>
          <input v-model="name" class="field__input field__input--boxed" maxlength="12" placeholder="请输入姓名" placeholder-class="ph" />
        </view>

        <view class="field">
          <view class="field__k"><text>证件号后四位</text><text class="field__hint">身份证 / 护照均可</text></view>
          <input v-model="idCard4" class="field__input field__input--boxed" maxlength="4" placeholder="例如 5880" placeholder-class="ph" />
        </view>
      </view>

      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">证明材料</text>
          <text class="sec-hd__d">仅在信息不一致、需人工核验时使用</text>
        </view>
        <PhotoPicker v-model="photos" :max="2" />
      </view>

      <view v-if="err" class="banner banner--offline">
        <view class="banner__ico"><text>!</text></view>
        <text class="banner__t">{{ err }}</text>
      </view>

      <view class="ai__note">
        <text class="ai__note-t">为什么不用填完整证件号</text>
        <text class="ai__note-d">
          比对只需要后四位。完整证件号留在物业档案里，业主端不存 —— 少存一份，泄露风险就少一分。
        </text>
      </view>
    </view>

    <Bar label="提交后" hint="与档案一致立即生效" okText="确认提交" btn-id="identity-submit" @submit="submit" />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { matchFor } from '@/api/mp'
import { app, approveBinding, approveReview, setRealname, submitReview } from '@/store/app'
import { flow } from '@/store/auth-flow'
import { toast, toastOk } from '@/utils/ui'

const roles = ['业主', '家属', '租客']
const identity = ref(flow.identity || '业主')
const name = ref('')
const idCard4 = ref('')
const photos = ref([])
const err = ref('')

onLoad(() => {
  if (!flow.houseId) {
    uni.redirectTo({ url: '/pages/auth/community' })
    return
  }
  name.value = app.session?.name || ''
  idCard4.value = app.session?.idCard4 || ''
})

function validate() {
  if (!/^[\u4e00-\u9fa5·]{2,12}$/.test(name.value.trim())) return '姓名需为 2~12 个汉字'
  if (!/^\d{4}$/.test(idCard4.value)) return '证件号后四位需为 4 位数字'
  return ''
}

function submit() {
  const msg = validate()
  err.value = msg
  if (msg) return

  setRealname({ name: name.value.trim(), idCard4: idCard4.value })
  flow.identity = identity.value
  flow.proof = photos.value.length ? '已上传证明材料' : ''

  const r = matchFor({
    phone: app.session.phone,
    name: name.value.trim(),
    idCard4: idCard4.value,
    houseId: flow.houseId
  })

  /* ① 档案对得上：立即生效，不经过人工 */
  if (r.ok) {
    approveBinding({
      houseId: flow.houseId,
      identity: r.role,
      ownerId: r.ownerId,
      verifyStatus: r.verifyStatus
    })
    if (r.role !== identity.value) {
      toast(`档案显示您是「${r.role}」，已按实际身份生效`)
    } else {
      toastOk('认证通过')
    }
    setTimeout(() => uni.reLaunch({ url: '/pages/home/index' }), 500)
    return
  }

  /* ② 对不上：必须带材料，否则物业没法核验 */
  if (!photos.value.length) {
    err.value = `${r.reason}。请上传购房合同 / 房产证照片，物业才能核验`
    return
  }
  submitReview({ houseId: flow.houseId, identity: identity.value, proof: '已上传证明材料', reason: r.reason })
  uni.navigateTo({ url: '/pages/auth/pending' })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); display: flex; flex-direction: column; }
.body { flex: 1; padding: 20rpx 28rpx 220rpx; }
.ai__house { padding-bottom: 18rpx; border-bottom: 2rpx solid var(--biz-border-light); margin-bottom: 6rpx; }
.ai__house-t { font-size: 30rpx; font-weight: 600; color: var(--biz-text-1); }
.ai__house-d { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--biz-text-3); }
.ai__roles { display: flex; gap: 16rpx; }
.ai__note { margin-top: 24rpx; padding: 20rpx 22rpx; background: var(--biz-bg-fill); border-radius: 14rpx; }
.ai__note-t { font-size: 22rpx; font-weight: 600; color: var(--biz-text-2); }
.ai__note-d { display: block; margin-top: 8rpx; font-size: 21rpx; color: var(--biz-text-3); line-height: 1.65; }
</style>
