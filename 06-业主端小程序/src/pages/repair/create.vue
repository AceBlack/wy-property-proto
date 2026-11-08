<!--
  我要报修（个人 / 公共两条线）
  ------------------------------------------------------------
  个人：选房 → 价目项目（下单即见价）→ 1 小时时段 → 描述 + 照片 → 提交并支付
  公共：选位置 → 项目 → 描述 + 照片 → 提交（免费，不支付）
-->
<template>
  <view class="page">
    <NavBar :title="isPublic ? '公共区域报修' : '我要报修'" :subtitle="isPublic ? '楼道 · 电梯 · 地库' : house?.fullName" />

    <view class="body">
      <view class="seg">
        <view class="seg__i" :class="{ 'is-on': !isPublic }" @tap="setScope('personal')"><text>个人报修</text></view>
        <view class="seg__i" :class="{ 'is-on': isPublic }" @tap="setScope('public')"><text>公共区域</text></view>
      </view>

      <!-- 位置 -->
      <view class="rc__sec">
        <text class="rc__k">{{ isPublic ? '问题位置' : '报修房号' }}</text>
        <view v-if="!isPublic" class="opt is-active">
          <view class="opt__body">
            <text class="opt__t">{{ house?.fullName }}</text>
            <text class="opt__d">{{ house?.communityName }} · {{ house?.houseType }} · {{ house?.area }}㎡</text>
          </view>
        </view>
        <view v-else class="rc__places">
          <view v-for="p in PUBLIC_PLACES" :key="p" class="chip" :class="{ 'is-on': place === p }" @tap="place = p"><text>{{ p }}</text></view>
        </view>
      </view>

      <!-- 项目 -->
      <view class="rc__sec">
        <view class="rc__k-row">
          <text class="rc__k">报修项目</text>
          <text class="rc__k-d">{{ isPublic ? '公共维修免费' : '下单即见价' }}</text>
        </view>
        <view v-for="g in groups" :key="g.category" class="rc__group">
          <text class="rc__group-t">{{ g.category }}</text>
          <view v-for="it in g.items" :key="it.code" class="opt" :class="{ 'is-active': code === it.code }" @tap="pick(it)">
            <view class="opt__body">
              <text class="opt__t">{{ it.name }}</text>
              <text class="opt__d">
                <text v-if="isPublic">公共区域维修不收费</text>
                <text v-else>材料 {{ money(it.material) }} + 人工 {{ money(it.labor) }} · 约 {{ it.minutes }} 分钟</text>
              </text>
            </view>
            <text v-if="!isPublic" class="opt__v">{{ money(it.material + it.labor) }}</text>
            <view class="opt__check" />
          </view>
        </view>
      </view>

      <!-- 时间 -->
      <view v-if="!isPublic" class="rc__sec">
        <view class="rc__k-row"><text class="rc__k">预约上门时间</text><text class="rc__k-d">1 小时一档</text></view>
        <view class="rc__days">
          <view v-for="d in days" :key="d.value" class="rc__day" :class="{ 'is-on': day === d.value }" @tap="day = d.value">
            <text class="rc__day-t">{{ d.label }}</text>
            <text class="rc__day-d">{{ d.short }}</text>
          </view>
        </view>
        <view class="rc__slots">
          <view v-for="s in slots" :key="s" class="chip" :class="{ 'is-on': slot === s }" @tap="slot = s"><text>{{ s }}</text></view>
        </view>
      </view>

      <!-- 描述 -->
      <view class="rc__sec">
        <view class="rc__k-row"><text class="rc__k">问题描述</text><text class="rc__k-d">{{ desc.length }}/120</text></view>
        <textarea v-model="desc" class="textarea" maxlength="120" :placeholder="isPublic ? '例如：3栋2单元电梯有异响，运行到 6 层会顿一下' : '例如：主卫角阀处持续渗水，地面积水'" placeholder-class="ph" />
        <view class="rc__photos">
          <text class="rc__k-d">照片（选填，最多 3 张）</text>
          <PhotoPicker v-model="photos" :max="3" />
        </view>
      </view>

      <!-- 费用 -->
      <view v-if="!isPublic" class="card rc__fee">
        <view class="sec-hd"><text class="sec-hd__t">费用预览</text><text class="sec-hd__d">下单即预付</text></view>
        <view v-if="sel">
          <view class="sum-row"><text class="sum-row__k">材料费</text><text class="sum-row__v">{{ money(fee.material) }}</text></view>
          <view class="sum-row"><text class="sum-row__k">人工费</text><text class="sum-row__v">{{ money(fee.labor) }}</text></view>
          <view class="sum-row sum-row--total"><text class="sum-row__k">合计</text><text class="sum-row__v">{{ money(fee.total) }}</text></view>
        </view>
        <Empty v-else text="先选一个维修项目" />
      </view>
    </view>

    <Bar
      :label="isPublic ? '费用' : '合计'"
      :amount="isPublic ? '免费' : sel ? money(fee.total) : '¥0.00'"
      :hint="isPublic ? '物业指派处理' : sel ? `${sel.name}` : '请选择项目'"
      :okText="isPublic ? '提交报修' : '提交并支付'"
      :disabled="!canSubmit"
      btn-id="repair-submit"
      @submit="submit"
    />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Empty from '@/components/Empty.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { orderFee, priceGroups, priceItems } from '@/api/pricing'
import { PUBLIC_PLACES, activeHouse, createOrder, createOrderPay } from '@/api/mp'
import { DEMO } from '@/config/demo'
import { money } from '@/utils/format'
import { go, toast, toastErr } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const groups = priceGroups()
const isPublic = ref(false)
const code = ref('')
const place = ref('')
const day = ref(DEMO.today)
const slot = ref('09:00-10:00')
const desc = ref('')
const photos = ref([])

const slots = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '19:00-20:00']
const house = computed(() => activeHouse())
/* priceItems() 而不是常量：接口模式下价目来自服务端快照，模块加载时还是空的 */
const sel = computed(() => priceItems().find(i => i.code === code.value) || null)
const fee = computed(() => orderFee(sel.value, 1))
const canSubmit = computed(() => !!sel.value && (isPublic.value ? !!place.value : !!house.value))
const days = computed(() => {
  const base = new Date(`${DEMO.today}T00:00:00`)
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return [0, 1, 2].map(n => {
    const d = new Date(base.getTime() + n * 86400000)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { value: iso, label: n === 0 ? '今天' : n === 1 ? '明天' : '后天', short: `${d.getMonth() + 1}-${d.getDate()} ${week[d.getDay()]}` }
  })
})

onLoad(o => {
  const s = o?.scope === 'public' ? 'public' : 'personal'
  if (s === 'personal' && !gateOwner('个人报修')) return
  isPublic.value = s === 'public'
})

function setScope(s) {
  if (s === 'personal' && !gateOwner('个人报修')) return
  isPublic.value = s === 'public'
  code.value = ''
  if (s === 'public' && !place.value) place.value = PUBLIC_PLACES[0]
}

function pick(it) {
  code.value = it.code
}

async function submit() {
  if (!sel.value) return toastErr('先选报修项目')
  if (isPublic.value && !place.value) return toastErr('请选择问题位置')
  if (!desc.value.trim()) return toastErr('写一句问题描述，师傅好带工具')
  try {
    const wo = await createOrder({
      scope: isPublic.value ? 'public' : 'personal',
      houseId: house.value?.houseId || '',
      communityId: house.value?.communityId || 'P01',
      place: place.value,
      code: code.value,
      qty: 1,
      appointDate: day.value,
      appointSlot: slot.value,
      description: desc.value.trim(),
      photos: photos.value.map(p => ({ kind: p.kind, at: p.at, note: p.note || '' }))
    })
    if (isPublic.value) {
      toast('已提交，物业会指派处理')
      setTimeout(() => go('/pages/repair/detail', { woId: wo.woId }), 400)
      return
    }
    const pay = await createOrderPay(wo.woId)
    go('/pages/pay/index', { payId: pay.payId, woId: wo.woId })
  } catch (e) {
    toastErr(e.message || '提交失败')
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 10rpx 28rpx 240rpx; }
.seg { display: flex; background: var(--biz-bg-fill); border-radius: 14rpx; padding: 6rpx; margin-bottom: 22rpx; }
.seg__i { flex: 1; text-align: center; padding: 14rpx 0; border-radius: 10rpx; font-size: 25rpx; color: var(--biz-text-3); }
.seg__i.is-on { background: #fff; color: var(--biz-text-1); font-weight: 600; box-shadow: var(--biz-shadow-card); }
.rc__sec { margin-bottom: 28rpx; }
.rc__k { font-size: 25rpx; font-weight: 600; color: var(--biz-text-2); display: block; margin-bottom: 14rpx; }
.rc__k-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14rpx; }
.rc__k-row .rc__k { margin-bottom: 0; }
.rc__k-d { font-size: 21rpx; color: var(--biz-text-4); }
.rc__places { display: flex; flex-wrap: wrap; gap: 12rpx; }
.rc__group + .rc__group { margin-top: 18rpx; }
.rc__group-t { display: block; font-size: 21rpx; color: var(--biz-text-3); margin-bottom: 10rpx; }
.rc__days { display: flex; gap: 14rpx; }
.rc__day { flex: 1; padding: 16rpx 10rpx; border-radius: 16rpx; background: #fff; border: 2rpx solid var(--biz-border-light); text-align: center; }
.rc__day.is-on { border-color: var(--biz-primary); background: var(--biz-primary-light-9); }
.rc__day-t { display: block; font-size: 26rpx; font-weight: 600; color: var(--biz-text-1); }
.rc__day.is-on .rc__day-t { color: var(--biz-primary); }
.rc__day-d { display: block; margin-top: 4rpx; font-size: 19rpx; color: var(--biz-text-3); }
.rc__slots { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 16rpx; }
.rc__photos { margin-top: 20rpx; }
.rc__photos .rc__k-d { display: block; margin-bottom: 12rpx; }
</style>
