<!--
  我要看房（§13.2 第 3 屏 / §13.5 主路径）
  ------------------------------------------------------------
  **不建账号**：不校验短信、不留 userId、不进客户池 —— 只是"这一次联系"的凭据。
  三条硬要求：
    · 提交后文案必须是「楼管会在 24 小时内联系你」（这是承诺，不能省）；
    · 同一手机号同一房源 24 小时内只能提交一次（防刷）；
    · 底部告知用途与保存期限：「仅提供给本房责任楼管，用于本次看房联系」「90 天后自动删除」。
-->
<template>
  <view class="page">
    <NavBar title="我要看房" :subtitle="l ? `${l.communityName} ${l.buildingName}` : ''" />

    <view class="body">
      <Empty v-if="!l" text="房源不存在或已下架" />

      <template v-else-if="done">
        <view class="vw__done">
          <view class="vw__done-ico"><text>✓</text></view>
          <text class="vw__done-t">已提交，楼管会在 24 小时内联系你</text>
          <text class="vw__done-d">
            {{ l.steward ? `本房责任楼管：${l.steward.name}` : '本房责任楼管会尽快联系你' }}。
            看房不收费，也不会有人向你索要定金。
          </text>
          <view class="vw__done-card">
            <view class="vw__dc-r"><text class="vw__dc-k">房源</text><text class="vw__dc-v">{{ l.communityName }} {{ l.buildingName }} · {{ l.houseType }}</text></view>
            <view class="vw__dc-r"><text class="vw__dc-k">称呼</text><text class="vw__dc-v">{{ form.name }}</text></view>
            <view class="vw__dc-r"><text class="vw__dc-k">手机号</text><text class="vw__dc-v">{{ maskPhone(form.phone) }}</text></view>
            <view class="vw__dc-r"><text class="vw__dc-k">方便时间</text><text class="vw__dc-v">{{ form.preferredTime }}</text></view>
          </view>
          <view class="vw__done-acts">
            <view class="btn btn--primary" @tap="goDetail"><text>返回房源</text></view>
            <view class="btn btn--line" @tap="goList"><text>再看几套</text></view>
          </view>
        </view>
      </template>

      <template v-else>
        <view class="card vw__sum">
          <text class="vw__sum-t">{{ l.communityName }} {{ l.buildingName }}</text>
          <text class="vw__sum-d">{{ l.houseType }} · {{ l.area }}㎡ · {{ l.orientation }} · {{ l.floor }} 层</text>
          <text class="vw__sum-p">¥{{ l.price }}/月 · {{ l.payTerm }}</text>
        </view>

        <view class="card">
          <view class="field">
            <view class="field__k"><text>称呼</text><text class="field__hint">怎么称呼你</text></view>
            <input v-model="form.name" class="field__input field__input--boxed" maxlength="12" placeholder="例如：刘先生" placeholder-class="ph" />
          </view>
          <view class="field">
            <view class="field__k"><text>手机号</text><text class="field__hint">楼管回拨用</text></view>
            <input v-model="form.phone" class="field__input field__input--boxed" type="number" maxlength="11" placeholder="11 位手机号" placeholder-class="ph" />
          </view>
          <view class="field">
            <view class="field__k"><text>方便看房时间</text></view>
            <view class="chips">
              <text v-for="t in PREFERRED_TIMES" :key="t" class="chip" :class="{ 'is-on': form.preferredTime === t }" @tap="form.preferredTime = t">{{ t }}</text>
            </view>
          </view>
          <view class="field">
            <view class="field__k"><text>留言</text><text class="field__hint">选填</text></view>
            <textarea v-model="form.note" class="textarea vw__text" maxlength="100" placeholder="例如：在附近上班，想月底前搬进来" placeholder-class="ph" />
          </view>
        </view>

        <view v-if="err" class="banner banner--offline">
          <view class="banner__ico"><text>!</text></view>
          <text class="banner__t">{{ err }}</text>
        </view>

        <view class="vw__privacy">
          <text class="vw__privacy-t">关于你的号码</text>
          <text class="vw__privacy-d">· 该号码仅提供给本房责任楼管，用于本次看房联系。</text>
          <text class="vw__privacy-d">· 90 天后自动删除；成交或关单的立即清理。</text>
          <text class="vw__privacy-d">· 不进入推送、群发或任何二次营销名单；可联系客服要求删除。</text>
          <text class="vw__privacy-d">· 提交即视为同意上述用途；不建访客账号，也不会给你发注册短信。</text>
        </view>
      </template>
    </view>

    <Bar
      v-if="l && !done"
      label="看房"
      :amount="''"
      hint="楼管 24 小时内联系你"
      okText="提交"
      :disabled="!canSubmit"
      btn-id="viewing-submit"
      @submit="submit"
    />
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Empty from '@/components/Empty.vue'
import { PREFERRED_TIMES, listingDetail, submitViewing } from '@/api/listing'
import { maskPhone } from '@/utils/format'
import { go, toastErr } from '@/utils/ui'

const id = ref('')
const done = ref(false)
const err = ref('')
const form = reactive({ name: '', phone: '', preferredTime: '都可以', note: '' })

const l = computed(() => (id.value ? listingDetail(id.value) : null))
const canSubmit = computed(() => !!form.name.trim() && /^1\d{10}$/.test(form.phone))

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})

function submit() {
  err.value = ''
  try {
    submitViewing({
      listingId: id.value,
      name: form.name,
      phone: form.phone,
      preferredTime: form.preferredTime,
      note: form.note
    })
    done.value = true
  } catch (e) {
    err.value = e.message || '提交失败'
    toastErr(err.value)
  }
}

const goDetail = () => go('/pages/house-sale/detail', { id: id.value })
const goList = () => uni.redirectTo({ url: '/pages/house-sale/list' })
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }

.vw__sum { background: linear-gradient(135deg, #eef1ff, #f7f8ff); box-shadow: none; }
.vw__sum-t { font-size: 27rpx; font-weight: 700; color: var(--biz-text-1); }
.vw__sum-d { display: block; margin-top: 6rpx; font-size: 21rpx; color: var(--biz-text-3); }
.vw__sum-p { display: block; margin-top: 10rpx; font-family: var(--biz-font-num); font-size: 28rpx; font-weight: 700; color: var(--biz-danger); }

.vw__text { height: 140rpx; }

.vw__privacy { margin-top: 22rpx; padding: 20rpx 22rpx; background: var(--biz-bg-fill); border-radius: 14rpx; }
.vw__privacy-t { font-size: 22rpx; font-weight: 600; color: var(--biz-text-2); }
.vw__privacy-d { display: block; margin-top: 6rpx; font-size: 20rpx; color: var(--biz-text-3); line-height: 1.7; }

.vw__done { display: flex; flex-direction: column; align-items: center; padding-top: 40rpx; }
.vw__done-ico {
  width: 120rpx; height: 120rpx; border-radius: 50%; background: var(--biz-accent);
  color: #fff; font-size: 46rpx; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.vw__done-t { margin-top: 24rpx; font-size: 31rpx; font-weight: 700; color: var(--biz-text-1); text-align: center; }
.vw__done-d { margin-top: 10rpx; font-size: 22rpx; color: var(--biz-text-3); line-height: 1.65; text-align: center; }
.vw__done-card { width: 100%; margin-top: 26rpx; background: #fff; border-radius: 18rpx; padding: 20rpx 22rpx; box-shadow: var(--biz-shadow-card); }
.vw__dc-r { display: flex; gap: 16rpx; padding: 8rpx 0; }
.vw__dc-k { width: 110rpx; flex: none; font-size: 21rpx; color: var(--biz-text-3); }
.vw__dc-v { flex: 1; font-size: 23rpx; color: var(--biz-text-1); }
.vw__done-acts { width: 100%; margin-top: 28rpx; display: flex; flex-direction: column; gap: 16rpx; }
</style>
