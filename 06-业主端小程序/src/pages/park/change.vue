<!--
  换绑车牌（批次 79）
  ------------------------------------------------------------
  这一页替代的正是客服每天在接的电话："帮我换下车牌"。
  所以设计目标只有一个：**让业主自己两分钟办完，且办错了看得出**。
  因此四条前置条件全部**明写**在页面上（不满足就说明为什么），而不是点了按钮才报错。
-->
<template>
  <view class="page">
    <NavBar title="换绑车牌" :subtitle="park?.parkNo || ''" />
    <view class="body" :class="{ 'body--with-foot': !done }">
      <Empty v-if="loaded && !park" text="车位不存在" />

      <!-- 成功态：这一屏要能截图给客服看，所以把记录号与状态都摆出来 -->
      <template v-else-if="done">
        <view class="card pc__done">
          <text class="pc__done-i">✓</text>
          <text class="pc__done-t">已提交换绑</text>
          <text class="pc__done-d">{{ done.fromPlate }} → {{ done.toPlate }}</text>
          <Tag text="待同步至道闸" size="sm" color="var(--biz-warning)" />
        </view>
        <view class="card">
          <Cell label="车位" :value="done.parkNo" />
          <Cell label="记录编号" :value="done.logId" />
          <Cell label="提交时间" :value="done.at" />
          <Cell label="来源" :value="`${done.source} · ${done.operatorName || ''}`" :last="true" />
        </view>
        <view class="pc__tip">
          <text class="demo-tip">说明</text>
          <text class="pc__tip-t">
            车牌识别系统接入后，这里会显示厂商回执；原型阶段停在「待同步」。
            换错车牌可以直接在本页再换一次 —— 次数与这里共用，别指望"撤销不计数"。
          </text>
        </view>
        <view class="pc__back">
          <view class="btn btn--ghost" @tap="backDetail"><text>返回车位详情</text></view>
        </view>
      </template>

      <template v-else-if="park">
        <view class="card">
          <Cell label="当前车牌" :value="currentPlate || '未绑定'" />
          <Cell label="所在车位" :value="`${park.parkNo} · ${park.category}`" />
          <Cell label="管理费到期" :value="exp.date || '—'" :last="true" />
        </view>

        <view class="card">
          <view class="field">
            <view class="field__k">
              <text>新车牌</text>
              <text class="field__hint">如 川B·SFV7D</text>
            </view>
            <input
              :value="plate"
              class="field__input field__input--boxed pc__input"
              maxlength="9"
              placeholder="请输入车牌号"
              placeholder-class="ph"
              @input="onInput"
            />
          </view>
          <view class="pc__chips">
            <text class="pc__chips-t">输入后自动补全为「川B·SFV7D」格式；新能源 6 位也可以</text>
          </view>
        </view>

        <!-- 四条前置：全写出来，别让人点一次才知道不行 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">办理条件</text>
            <text class="sec-hd__d">{{ guard.ok ? '全部满足' : `${guard.reasons.length} 项不满足` }}</text>
          </view>
          <view v-for="(c, i) in checks" :key="c.key" class="pc__ck" :class="{ 'is-last': i === checks.length - 1 }">
            <text class="pc__ck-i" :class="c.ok ? 'is-ok' : 'is-no'">{{ c.ok ? '✓' : '✗' }}</text>
            <view class="pc__ck-b">
              <text class="pc__ck-t">{{ c.label }}</text>
              <text v-if="!c.ok" class="pc__ck-d">{{ c.why }}</text>
            </view>
          </view>
        </view>

        <view class="pc__tip">
          <text class="demo-tip">说明</text>
          <text class="pc__tip-t">
            换绑不需要物业审核，提交后立即生效并留一条记录；道闸同步约 5 分钟。
            每车位每月 {{ quota.limit }} 次（本月已用 {{ quota.used }} 次），下月 1 日自动恢复。
            第二辆车请找管家登记，不占这里次数。
          </text>
        </view>
      </template>
    </view>

    <Bar
      v-if="!done"
      label="换绑后"
      hint="立即生效 · 需同步道闸"
      okText="确认换绑"
      btn-id="plate-submit"
      :disabled="!canSubmit"
      @submit="submit"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Cell from '@/components/Cell.vue'
import Tag from '@/components/Tag.vue'
import Empty from '@/components/Empty.vue'
import {
  changeGuard, changePlate, expiryOf, myParkings, normalizePlate, plateOf, quotaOf
} from '@/api/park'
import { identity, isRealname } from '@/store/app'
import { back, toastErr } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const parkId = ref('')
const plate = ref('')
const done = ref(null)
const loaded = ref(false)
const ver = ref(0)

const park = computed(() => {
  ver.value
  return myParkings().find(p => p.parkId === parkId.value) || null
})
const currentPlate = computed(() => (park.value ? plateOf(park.value) : ''))
const exp = computed(() => (park.value ? expiryOf(park.value) : { date: '' }))
const guard = computed(() => (park.value ? changeGuard(park.value.parkId) : { ok: false, reasons: [] }))
const quota = computed(() => (park.value ? quotaOf(park.value.parkId) : { limit: 1, used: 0 }))

/** 四条条件拆开渲染：guard 只回"哪条不满足"，页面需要"每条的名称" */
const checks = computed(() => {
  const list = [
    { key: 'role', label: '已认证业主', ok: identity.value === '业主', why: '换绑只对产权业主开放' },
    { key: 'realname', label: '已实名认证', ok: isRealname.value, why: '请先在「我的」完成实名' },
    { key: 'expire', label: '车位管理费未到期', ok: (exp.value.days ?? 0) >= 0, why: `已于 ${exp.value.date} 到期，续费后可换绑` },
    { key: 'quota', label: `本月换绑次数（${quota.value.used}/${quota.value.limit}）`, ok: quota.value.used < quota.value.limit, why: '本月次数已用完，下月 1 日恢复' }
  ]
  return list
})

const canSubmit = computed(() => guard.value.ok && plate.value.length >= 7)

onLoad(opts => {
  parkId.value = String(opts?.parkId || '')
  gateOwner('车位信息')
})

onShow(() => {
  ver.value++
  loaded.value = true
})

function onInput(e) {
  plate.value = normalizePlate(e?.detail?.value ?? '')
}

function submit() {
  if (!canSubmit.value) return
  try {
    done.value = changePlate(parkId.value, plate.value)
  } catch (e) {
    toastErr(e?.message || '换绑失败')
  }
}

function backDetail() {
  back(`/pages/park/detail?parkId=${parkId.value}`)
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 40rpx; }
.body--with-foot { padding-bottom: 220rpx; }
.card + .card { margin-top: 20rpx; }
.pc__input { letter-spacing: 2rpx; font-weight: 600; }
.pc__chips { display: flex; gap: 12rpx; margin-top: 16rpx; flex-wrap: wrap; }
.pc__ck { display: flex; gap: 14rpx; padding: 18rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.pc__ck.is-last { border-bottom: none; padding-bottom: 0; }
.pc__ck-i { flex: none; width: 34rpx; font-size: 26rpx; font-weight: 700; }
.pc__ck-i.is-ok { color: var(--biz-accent-dark); }
.pc__ck-i.is-no { color: var(--biz-danger); }
.pc__ck-b { flex: 1; }
.pc__ck-t { display: block; font-size: 25rpx; color: var(--biz-text-1); }
.pc__ck-d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-danger); line-height: 1.5; }
.pc__done { text-align: center; padding: 40rpx 28rpx; }
.pc__done-i { display: block; font-size: 56rpx; color: var(--biz-accent-dark); line-height: 1; }
.pc__done-t { display: block; margin-top: 16rpx; font-size: 32rpx; font-weight: 700; color: var(--biz-text-1); }
.pc__done-d { display: block; margin: 10rpx 0 16rpx; font-size: 26rpx; color: var(--biz-text-2); letter-spacing: 1rpx; }
.pc__tip { margin-top: 26rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.pc__tip-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.7; }
.pc__back { margin-top: 24rpx; }
</style>
