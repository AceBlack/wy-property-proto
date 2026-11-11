<!--
  我要报修（个人 / 公共两条线）
  ------------------------------------------------------------
  个人：选房 → 价目项目（下单即见价）→ 1 小时时段 → 描述 + 照片 → 提交并支付
  公共：选位置（快捷 + 可手填）→ 部位 → 描述 + 照片 → 提交（免费，不支付）

  两条线**要的东西不一样**，2026-11-11 按实际数据与业务分了家：
    · 公共区域维修由物业出人出料，没有价目项 —— 不再让业主先挑一个收费项目再免费处理；
      也不要求预约时段（样例里 75 张公共单没有一张有预约时间）。
    · 但**部位**要留（电梯 / 配电 / 给排水…）：它决定派给哪个工种，
      也是工时积分的权重来源。部位不是"项目"，选了不影响收费。
    · 位置除了 10 个高频快捷项，必须能自己填 —— 小区总有列表没覆盖的角落（消防通道、屋面）。

  个人项目按分类折叠 + 搜索：现在只有 10 项，但项目是会加的，
  一次摊开几十项就没法选了。默认展开前 3 类，搜索时全部展开。
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
        <template v-else>
          <view class="rc__places">
            <view
              v-for="p in PUBLIC_PLACES"
              :key="p"
              class="chip"
              :class="{ 'is-on': !useOther && placePick === p }"
              @tap="pickPlace(p)"
            ><text>{{ p }}</text></view>
            <view id="place-other" class="chip" :class="{ 'is-on': useOther }" @tap="pickOther"><text>其它位置</text></view>
          </view>
          <view v-if="useOther" class="rc__other">
            <input
              id="place-input"
              v-model="placeOther"
              class="field__input field__input--boxed"
              maxlength="40"
              placeholder="例如：5栋消防通道 / 中心花园东侧廊架"
              placeholder-class="ph"
            />
            <text class="rc__other-tip">写清楚楼栋与具体位置，师傅才不用满小区找</text>
          </view>
        </template>
      </view>

      <!-- 部位（公共）：不影响收费，只决定派给谁 -->
      <view v-if="isPublic" class="rc__sec">
        <view class="rc__k-row">
          <text class="rc__k">部位</text>
          <text class="rc__k-d">决定派给哪个工种，不影响收费</text>
        </view>
        <view class="rc__places">
          <view v-for="c in PUBLIC_PARTS" :key="c" class="chip" :class="{ 'is-on': part === c }" @tap="part = c"><text>{{ c }}</text></view>
        </view>
      </view>

      <!-- 项目（个人）：分类折叠 + 搜索 -->
      <view v-else class="rc__sec">
        <view class="rc__k-row">
          <text class="rc__k">报修项目</text>
          <text class="rc__k-d">下单即见价</text>
        </view>

        <view class="rc__search">
          <input
            v-model="kw"
            class="field__input field__input--boxed"
            placeholder="搜项目，如 漏水 / 空调 / 门锁"
            placeholder-class="ph"
          />
        </view>

        <view v-for="g in shownGroups" :key="g.category" class="rc__group">
          <view class="rc__group-hd" @tap="toggleCat(g.category)">
            <text class="rc__group-t">{{ g.category }}</text>
            <text class="rc__group-n">{{ g.items.length }} 项</text>
            <text v-if="!kw.trim()" class="rc__group-x">{{ isOpen(g.category) ? '收起' : '展开' }}</text>
          </view>
          <template v-if="isOpen(g.category)">
            <view
              v-for="it in g.items"
              :key="it.code"
              class="opt opt--dense"
              :class="{ 'is-active': code === it.code }"
              @tap="pick(it)"
            >
              <view class="opt__body">
                <text class="opt__t">{{ it.name }}</text>
                <text class="opt__d">材料 {{ money(it.material) }} + 人工 {{ money(it.labor) }} · 约 {{ it.minutes }} 分钟</text>
              </view>
              <text class="opt__v">{{ money(it.material + it.labor) }}</text>
              <view class="opt__check" />
            </view>
          </template>
        </view>

        <Empty v-if="!shownGroups.length" text="没有匹配的项目" sub="换个词试试，或先选「其他 · 上门检测」让师傅判断" />
      </view>

      <!-- 时间（个人） -->
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

      <!-- 费用（个人） -->
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
      :hint="isPublic ? '物业指派处理 · 无需预约时间' : sel ? `${sel.name}` : '请选择项目'"
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

/**
 * 公共报修的**部位**：与后台工单的 category 同一套枚举。
 * 它不是价目分类 —— 派单按它找工种，工时积分按它取权重（电梯 1.5 / 配电 1.3 / 给排水 1.2）。
 * 不选默认「公共设备」，保证落库一定有值，不至于让后台在"未分类"里堆一堆单。
 */
const PUBLIC_PARTS = ['电梯', '配电', '给排水', '公共设备', '公区照明', '门窗五金', '土建']

const groups = priceGroups()
const isPublic = ref(false)
const code = ref('')
const desc = ref('')
const photos = ref([])
const day = ref(DEMO.today)
const slot = ref('09:00-10:00')

/* 位置：快捷项与手填二选一，最终取 finalPlace */
const placePick = ref(PUBLIC_PLACES[0])
const useOther = ref(false)
const placeOther = ref('')
/* 部位默认「公共设备」：既保证落库有值，又不会被当成"必须选一项"的负担 */
const part = ref('公共设备')

/* 个人项目的折叠与搜索 */
const kw = ref('')
const openCats = ref(new Set(groups.slice(0, 3).map(g => g.category)))

const slots = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '19:00-20:00']
const house = computed(() => activeHouse())
/* priceItems() 而不是常量：接口模式下价目来自服务端快照，模块加载时还是空的 */
const sel = computed(() => priceItems().find(i => i.code === code.value) || null)
const fee = computed(() => orderFee(sel.value, 1))

const finalPlace = computed(() => (useOther.value ? placeOther.value.trim() : placePick.value))

/** 搜索时不分折叠状态，一律展开 —— 搜到了还要再点一次展开，等于没搜 */
const shownGroups = computed(() => {
  const k = kw.value.trim()
  if (!k) return groups
  return groups
    .map(g => ({ ...g, items: g.items.filter(it => `${it.name}${it.category}`.includes(k)) }))
    .filter(g => g.items.length)
})
const isOpen = cat => (kw.value.trim() ? true : openCats.value.has(cat))

const canSubmit = computed(() => {
  if (isPublic.value) return !!finalPlace.value && !!desc.value.trim()
  return !!sel.value && !!house.value
})
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
}

function pickPlace(p) {
  useOther.value = false
  placePick.value = p
}
function pickOther() {
  useOther.value = true
}

function toggleCat(cat) {
  if (kw.value.trim()) return
  const next = new Set(openCats.value)
  if (next.has(cat)) next.delete(cat)
  else next.add(cat)
  openCats.value = next
}

function pick(it) {
  code.value = it.code
}

async function submit() {
  if (isPublic.value) {
    if (!finalPlace.value) return toastErr('请选择或填写问题位置')
    if (!desc.value.trim()) return toastErr('写一句问题描述，师傅好带工具')
    try {
      const wo = await createOrder({
        scope: 'public',
        place: finalPlace.value,
        /* 部位不是"项目"：它只决定派给谁，不影响收费 */
        category: part.value,
        description: desc.value.trim(),
        photos: photos.value.map(p => ({ kind: p.kind, at: p.at, note: p.note || '' }))
      })
      toast('已提交，物业会指派处理')
      setTimeout(() => go('/pages/repair/detail', { woId: wo.woId }), 400)
    } catch (e) {
      toastErr(e.message || '提交失败')
    }
    return
  }

  if (!sel.value) return toastErr('先选报修项目')
  if (!desc.value.trim()) return toastErr('写一句问题描述，师傅好带工具')
  try {
    const wo = await createOrder({
      scope: 'personal',
      houseId: house.value?.houseId || '',
      communityId: house.value?.communityId || 'P01',
      code: code.value,
      qty: 1,
      appointDate: day.value,
      appointSlot: slot.value,
      description: desc.value.trim(),
      photos: photos.value.map(p => ({ kind: p.kind, at: p.at, note: p.note || '' }))
    })
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
.rc__other { margin-top: 16rpx; }
.rc__other-tip { display: block; margin-top: 8rpx; font-size: 20rpx; color: var(--biz-text-4); }
.rc__search { margin-bottom: 14rpx; }
.rc__group + .rc__group { margin-top: 6rpx; }
.rc__group-hd { display: flex; align-items: center; gap: 12rpx; padding: 16rpx 4rpx; border-bottom: 1rpx solid var(--biz-border-light); }
.rc__group-t { font-size: 24rpx; font-weight: 600; color: var(--biz-text-2); }
.rc__group-n { font-size: 20rpx; color: var(--biz-text-4); }
.rc__group-x { margin-left: auto; font-size: 21rpx; color: var(--biz-primary); }
.opt--dense { padding: 16rpx 20rpx; margin-top: 10rpx; border-radius: 14rpx; }
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
