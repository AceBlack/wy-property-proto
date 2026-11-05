<!-- 客服与反馈：电话 / 在线留言（留言落本地，演示态） -->
<template>
  <view class="page">
    <NavBar title="客服与反馈" subtitle="投诉建议都会进物业工单" />
    <view class="body">
      <view class="card fb__call" @tap="call">
        <view class="fb__ico"><text>电</text></view>
        <view class="fb__b">
          <text class="fb__t">物业服务中心</text>
          <text class="fb__d">028-8888 6666 · 8:30-18:00（中控室 24 小时）</text>
        </view>
        <text class="fb__a">呼叫</text>
      </view>

      <view v-if="steward" class="card fb__call" @tap="callSteward">
        <Avatar :name="steward.name" size="md" :tone="1" />
        <view class="fb__b">
          <text class="fb__t">{{ steward.name }} · 楼栋管家</text>
          <text class="fb__d">{{ maskPhone(steward.phone) }}</text>
        </view>
        <text class="fb__a">呼叫</text>
      </view>

      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">在线留言</text><text class="sec-hd__d">选类型，便于分派</text></view>
        <view class="chips fb__types">
          <text v-for="t in TYPES" :key="t" class="chip" :class="{ 'is-on': type === t }" @tap="type = t">{{ t }}</text>
        </view>
        <textarea v-model="text" class="textarea fb__text" maxlength="200" placeholder="请描述问题，附上房号或时间会更方便处理" placeholder-class="ph" />
        <view id="fb-submit" class="btn btn--primary fb__submit" @tap="submit"><text>提交</text></view>
      </view>

      <view class="fb__tip">
        <text class="demo-tip">演示</text>
        <text class="fb__tip-t">留言只存本机（不提交后端）。真实环境应落客服工单并回传处理进度。</text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import NavBar from '@/components/NavBar.vue'
import Avatar from '@/components/Avatar.vue'
import { useFeedback } from '@/utils/feedback'
import { activeHouse } from '@/api/mp'
import { maskPhone } from '@/utils/format'
import { toast, toastOk } from '@/utils/ui'

const TYPES = ['投诉', '建议', '表扬', '其他']
const type = ref('建议')
const text = ref('')
const steward = computed(() => activeHouse()?.steward || null)

function call() {
  uni.makePhoneCall({ phoneNumber: '02888886666', fail: () => toast('演示环境不能拨号') })
}
function callSteward() {
  uni.makePhoneCall({ phoneNumber: steward.value.phone, fail: () => toast('演示环境不能拨号') })
}
function submit() {
  if (!text.value.trim()) return toast('写点内容再提交')
  useFeedback(type.value, text.value.trim())
  text.value = ''
  toastOk('已提交，物业会尽快处理')
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 50rpx; }
.fb__call { display: flex; align-items: center; gap: 16rpx; }
.fb__ico { flex: none; width: 72rpx; height: 72rpx; border-radius: 20rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); display: flex; align-items: center; justify-content: center; font-size: 28rpx; font-weight: 700; }
.fb__b { flex: 1; min-width: 0; }
.fb__t { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.fb__d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.fb__a { font-size: 22rpx; color: var(--biz-primary); font-weight: 600; }
.fb__types { margin-bottom: 18rpx; }
.fb__text { height: 180rpx; }
.fb__submit { margin-top: 20rpx; }
.fb__tip { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.fb__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
