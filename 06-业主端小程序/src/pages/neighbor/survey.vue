<!-- 投票 / 问卷：单选提交，提交后显示占比（匿名） -->
<template>
  <view class="page">
    <NavBar title="参与" :subtitle="sv?.type || ''" />
    <view class="body" :class="{ 'body--with-foot': !!sv }">
      <Empty v-if="!sv" text="问卷不存在" />
      <template v-else>
        <view class="card">
          <text class="sv__t">{{ sv.title }}</text>
          <text class="sv__d">{{ sv.desc }}</text>
          <view class="sv__meta">
            <Tag :text="sv.status" size="sm" :color="sv.status === '进行中' ? 'var(--biz-accent-dark)' : 'var(--biz-text-3)'" />
            <text class="sv__m">{{ sv.totalVotes }} 人参与 · 截至 {{ sv.endAt }}</text>
          </view>
        </view>

        <view class="card">
          <view v-for="o in sv.options" :key="o.key" class="opt" :class="{ 'is-active': picked.includes(o.key) }" @tap="pick(o)">
            <view class="opt__body">
              <text class="opt__t">{{ o.label }}</text>
              <view v-if="sv.voted" class="sv__bar">
                <view class="sv__bar-in" :style="{ width: o.pct + '%' }" />
              </view>
            </view>
            <text class="opt__v">{{ sv.voted ? o.pct + '%' : '' }}</text>
            <view class="opt__check" />
          </view>
          <text class="sv__tip">{{ sv.voted ? '您已参与，结果实时更新（匿名统计）' : '请选择一项后提交' }}</text>
        </view>

        <view class="sv__note">
          <text class="demo-tip">说明</text>
          <text class="sv__note-t">这是意见征集，用于物业改进服务；不构成《民法典》意义上的业主共同决定。</text>
        </view>
      </template>
    </view>

    <Bar v-if="sv" :label="sv.voted ? '已参与' : '待提交'" :amount="sv.voted ? '' : `${picked.length} 项`" :hint="sv.voted ? '感谢参与' : '匿名'" :okText="sv.voted ? '已提交' : '提交'" :disabled="sv.voted || !picked.length" btn-id="sv-submit" @submit="submit" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import { surveyOf } from '@/api/neighbor'
import { castVote } from '@/store/app'
import { toastOk } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const id = ref('')
const picked = ref([])
const ver = ref(0)
const sv = computed(() => {
  ver.value
  return id.value ? surveyOf(id.value) : null
})

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})
onShow(() => {
  ver.value++
})

function pick(o) {
  if (sv.value.voted || sv.value.status === '已结束') return
  picked.value = [o.key]
}

function submit() {
  if (!gateLogin()) return
  if (!picked.value.length) return
  castVote(id.value, picked.value)
  ver.value++
  toastOk('已提交，感谢参与')
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 210rpx; }
.sv__t { font-size: 31rpx; font-weight: 700; color: var(--biz-text-1); line-height: 1.4; }
.sv__d { display: block; margin-top: 12rpx; font-size: 22rpx; color: var(--biz-text-3); line-height: 1.65; }
.sv__meta { display: flex; align-items: center; gap: 14rpx; margin-top: 16rpx; }
.sv__m { font-size: 20rpx; color: var(--biz-text-4); }
.sv__bar { margin-top: 10rpx; height: 10rpx; border-radius: 6rpx; background: var(--biz-bg-fill); overflow: hidden; }
.sv__bar-in { height: 100%; border-radius: 6rpx; background: var(--biz-primary); }
.sv__tip { display: block; margin-top: 14rpx; font-size: 21rpx; color: var(--biz-text-4); }
.sv__note { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.sv__note-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
