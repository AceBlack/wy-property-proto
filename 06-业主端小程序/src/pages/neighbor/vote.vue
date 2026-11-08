<!--
  投票详情（§12.2 第 3 条）
  ------------------------------------------------------------
  与原「问卷」页的差别：
    · 支持**多选**（`multi` + `maxPick`），提交结构改成 `optionKeys: []`；
    · 有截止倒计时（剩 N 天 / 今天截止 / 已截止）；
    · **投完才看结果**（`resultVisibility`）；未投且未结束时只给题目与选项，不显示票数 ——
      先看到票数会从众，意见征询就失真了。
  结果里**永远不出现「通过 / 未通过」**：这是意见征询，不产生《民法典》278 条的效力。
-->
<template>
  <view class="page">
    <NavBar title="投票" :subtitle="v ? v.type : ''" />
    <view class="body" :class="{ 'body--with-foot': !!v }">
      <Empty v-if="!v" text="投票不存在" />

      <template v-else>
        <view class="card">
          <view class="vt__hd">
            <Tag :text="v.multi ? `多选 · 最多 ${v.maxPick} 项` : '单选'" size="sm" color="var(--biz-primary)" />
            <Tag :text="v.anonymous ? '匿名' : '实名'" size="sm" color="var(--biz-text-3)" />
            <text class="vt__st" :class="{ 'is-end': v.status === '已结束' }">
              {{ v.status === '已结束' ? '已结束' : v.deadlineText }}
            </text>
          </view>
          <text class="vt__t">{{ v.title }}</text>
          <text v-if="v.desc" class="vt__d">{{ v.desc }}</text>
          <view class="vt__meta">
            <text>截止 {{ v.endAt }}</text>
            <text>{{ v.status === '已结束' || v.canSeeResult ? v.partRateText : `应投 ${v.target} 户` }}</text>
          </view>
        </view>

        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">选项</text>
            <text class="sec-hd__d">{{ v.voted ? '您已参与，可查看结果' : v.multi ? `最多选 ${v.maxPick} 项` : '请选择一项' }}</text>
          </view>

          <view
            v-for="o in v.options"
            :key="o.key"
            :id="`vote-opt-${o.key}`"
            class="opt"
            :class="{ 'is-active': picked.includes(o.key) }"
            @tap="pick(o)"
          >
            <view class="opt__body">
              <text class="opt__t">{{ o.label }}</text>
              <view v-if="v.canSeeResult" class="vt__bar">
                <view class="vt__bar-in" :style="{ width: Math.max(o.pct, 1) + '%' }" />
              </view>
              <text v-if="v.canSeeResult" class="vt__bar-d">{{ o.votes }} 票 · {{ o.pct }}%</text>
            </view>
            <text v-if="v.canSeeResult" class="opt__v">{{ o.pct }}%</text>
            <view class="opt__check" />
          </view>

          <text class="vt__hint">
            {{ v.canSeeResult ? '结果实时更新（匿名统计，参与率按户计算）' : '提交后才能看到结果' }}
          </text>
        </view>

        <view class="vt__note">
          <text class="demo-tip">说明</text>
          <text class="vt__note-t">
            本投票为**意见征询**，用于物业改进服务；不构成《民法典》意义上的业主共同决定
            （法定表决需面积与人数双过半、实名留痕、可公证，小程序替代不了票箱）。
          </text>
        </view>
      </template>
    </view>

    <Bar
      v-if="v"
      :label="v.voted ? '已参与' : '待提交'"
      :amount="v.voted ? '' : `${picked.length} 项`"
      :hint="v.voted ? v.partRateText : v.multi ? `最多选 ${v.maxPick} 项` : '单选'"
      :okText="v.voted ? '已提交' : v.status === '已结束' ? '已结束' : '提交'"
      :disabled="v.voted || v.status === '已结束' || !picked.length"
      btn-id="vote-submit"
      @submit="submit"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import { castVote, voteOf } from '@/api/neighbor'
import { toast, toastOk, toastErr } from '@/utils/ui'
import { gateVoter } from '@/utils/guard'

const id = ref('')
const ver = ref(0)
const picked = ref([])

const v = computed(() => {
  ver.value
  return id.value ? voteOf(id.value) : null
})

onLoad(o => {
  id.value = o?.id ? decodeURIComponent(o.id) : ''
})
onShow(() => {
  ver.value++
  /* 已投过的回显自己的选择（多选要看到自己选了哪几项） */
  if (v.value?.voted) picked.value = [...v.value.myVote]
})

function pick(o) {
  const cur = v.value
  if (!cur) return
  if (cur.voted || cur.status === '已结束') return toast('已提交，不能再改')
  const i = picked.value.indexOf(o.key)
  if (i >= 0) {
    picked.value.splice(i, 1)
    return
  }
  const limit = cur.multi ? cur.maxPick : 1
  if (picked.value.length >= limit) {
    if (!cur.multi) picked.value = [o.key]
    else toast(`最多选 ${limit} 项`)
    return
  }
  picked.value.push(o.key)
}

async function submit() {
  /* 投票是产权人意见：要认证，且租户不参与（§12.3 第 2 条） */
  if (!gateVoter('投票')) return
  try {
    await castVote(id.value, picked.value)
    ver.value++
    toastOk('已提交，感谢参与')
  } catch (e) {
    toastErr(e.message || '提交失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 210rpx; }

.vt__hd { display: flex; align-items: center; gap: 10rpx; }
.vt__st { margin-left: auto; font-size: 20rpx; color: var(--biz-warning); }
.vt__st.is-end { color: var(--biz-text-4); }
.vt__t { display: block; margin-top: 14rpx; font-size: 31rpx; font-weight: 700; color: var(--biz-text-1); line-height: 1.45; }
.vt__d { display: block; margin-top: 12rpx; font-size: 22rpx; color: var(--biz-text-3); line-height: 1.7; }
.vt__meta { display: flex; align-items: center; justify-content: space-between; margin-top: 16rpx; font-size: 20rpx; color: var(--biz-text-4); }

.vt__bar { margin-top: 10rpx; height: 10rpx; border-radius: 6rpx; background: var(--biz-bg-fill); overflow: hidden; }
.vt__bar-in { height: 100%; border-radius: 6rpx; background: var(--biz-primary); }
.vt__bar-d { display: block; margin-top: 6rpx; font-size: 19rpx; color: var(--biz-text-4); }
.vt__hint { display: block; margin-top: 16rpx; font-size: 21rpx; color: var(--biz-text-4); }

.vt__note { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.vt__note-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
