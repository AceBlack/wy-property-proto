<!--
  代客报名表单（活动列表 / 活动详情共用）

  抽出来的原因：同一个表单要在两处出现 —— 列表行上"看一眼就能替阿姨报掉"，
  详情页里"看完退款分档再报"。复制两份的后果是校验规则改一处漏一处，
  而这里每条校验都对应一次真实返工（重复报名、保险缺证件号、超名额）。

  规则仍以后端为准：`enrollActivity` 才是判官，这里只做提前拦一道，
  免得白填一屏再弹错。金额、比例一律不自己算。
-->
<template>
  <Sheet
    v-model:show="open"
    title="代客报名"
    :sub="subText"
    max-height="82vh"
  >
    <view class="fld">
      <text class="fld__k">联系人姓名 <text class="req">*</text></text>
      <input id="nb-name" v-model="form.name" class="input" placeholder="业主或家属姓名" placeholder-class="ph-txt" />
    </view>
    <view class="fld">
      <text class="fld__k">手机号 <text class="req">*</text></text>
      <input id="nb-phone" v-model="form.phone" class="input num" type="number" :maxlength="11" placeholder="11 位手机号" placeholder-class="ph-txt" />
    </view>
    <view class="fld">
      <text class="fld__k">房号</text>
      <input id="nb-house" v-model="form.house" class="input" placeholder="如 1-1-1001（对账用，可不填）" placeholder-class="ph-txt" />
    </view>

    <view class="fld">
      <text class="fld__k">人数（每户限 {{ act.attendeeLimit }} 人）</text>
      <view class="step">
        <view id="nb-people-minus" class="step__b" @tap="setPeople(-1)">−</view>
        <text class="step__n num">{{ form.people }}</text>
        <view id="nb-people-plus" class="step__b" @tap="setPeople(1)">＋</view>
      </view>
      <text v-if="leftTip" class="left" :class="{ 'is-bad': short }">{{ leftTip }}</text>
    </view>

    <!-- 要投保就必须每位出行人实名 -->
    <view v-if="act.needInsurance" class="who">
      <text class="who__t">出行人（需投保，姓名与证件号必填）</text>
      <view v-for="(t, i) in form.attendees" :key="i" class="who__i">
        <text class="who__n">第 {{ i + 1 }} 人</text>
        <input :id="`nb-at-name-${i}`" v-model="t.name" class="input who__in" placeholder="姓名" placeholder-class="ph-txt" />
        <!-- 证件号单独一行：18 位数字挤在半行里会被截掉 -->
        <input :id="`nb-at-id-${i}`" v-model="t.idNo" class="input who__in who__in--full num" maxlength="18" placeholder="证件号（18 位）" placeholder-class="ph-txt" />
      </view>
    </view>

    <view v-if="act.fee > 0" class="fld">
      <text class="fld__k">现场收款</text>
      <view class="chips">
        <view id="nb-paid" class="chip" :class="{ 'is-on': form.paid }" @tap="form.paid = !form.paid">
          {{ form.paid ? '已收款' : '未收款（记待支付）' }}
        </view>
        <template v-if="form.paid">
          <view
            v-for="m in ['现金', '扫码']"
            :key="m"
            :id="`nb-pay-${m}`"
            class="chip"
            :class="{ 'is-on': form.paymentMethod === m }"
            @tap="form.paymentMethod = m"
          >
            {{ m }}
          </view>
        </template>
      </view>
    </view>

    <view id="nb-submit" class="btn btn--primary foot-full" @tap="submit">确认报名</view>
  </Sheet>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import Sheet from '@/components/Sheet.vue'
import { duplicateOf, enroll, enrollsOf } from '@/api/neighbor'
import { persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const props = defineProps({
  show: { type: Boolean, default: false },
  /** 活动行（列表行与详情行同结构，都是 _nvActRow 的产物） */
  activity: { type: Object, default: null }
})
const emit = defineEmits(['update:show', 'done'])

const act = computed(() => props.activity || {})

const form = reactive({
  name: '',
  phone: '',
  house: '',
  people: 1,
  attendees: [],
  paid: false,
  paymentMethod: '现金'
})

/** 名额：列表行带 left，详情行也带；没有就不提示 */
const left = computed(() => (typeof act.value.left === 'number' ? act.value.left : null))

/** 报的人数比剩下的名额多 —— 直接拦在提交前，别让填完一屏再弹错 */
const short = computed(() => left.value != null && form.people > left.value)

/**
 * 只剩 40 个名额时说「只剩」很怪，所以只在两种情况下提示：
 * 名额已经不够这次报的，或者余量确实紧张（≤5）；其余时候不占地方。
 */
const leftTip = computed(() => {
  if (left.value == null) return ''
  if (short.value) return `名额只剩 ${left.value} 个，报不了 ${form.people} 人`
  if (left.value <= 5) return `名额只剩 ${left.value} 个`
  return ''
})

const open = computed({
  get: () => props.show,
  set: v => emit('update:show', v)
})

const subText = computed(() =>
  act.value.fee > 0 ? `${act.value.feeText || ''} · 现场可代收` : '公益活动'
)

/** 打开时重置：上次填了一半的名字不能留给下一位业主 */
watch(
  () => props.show,
  v => {
    if (!v) return
    form.name = ''
    form.phone = ''
    form.house = ''
    form.people = 1
    form.attendees = [{ name: '', idNo: '' }]
    form.paid = false
    form.paymentMethod = '现金'
  }
)

/* 人数变化时同步出行人输入框数量 */
watch(
  () => form.people,
  n => {
    const list = form.attendees.slice(0, n)
    while (list.length < n) list.push({ name: '', idNo: '' })
    form.attendees = list
  }
)

function setPeople(delta) {
  const max = Number(act.value.attendeeLimit) || 1
  form.people = Math.min(max, Math.max(1, form.people + delta))
}

async function submit() {
  const name = form.name.trim()
  const phone = form.phone.trim()
  if (!name) return toastErr('联系人姓名必填')
  if (!/^1\d{10}$/.test(phone)) return toastErr('手机号要 11 位')
  if (short.value) return toastErr(`名额只剩 ${left.value} 个，报不了 ${form.people} 人`)

  if (act.value.needInsurance) {
    const bad = form.attendees.findIndex(t => !String(t.name || '').trim() || !String(t.idNo || '').trim())
    if (bad >= 0) return toastErr(`需要投保，第 ${bad + 1} 位出行人的姓名与证件号都要填`)
  }

  try {
    /* 同一手机号重复报名：现场两个人同时办会重复，必须提示而不是静默加一条 */
    const rows = await enrollsOf(act.value.activityId)
    const dup = duplicateOf(rows, phone)
    if (dup) return toastErr(`「${dup.name}」已经报过名了（${dup.status}），不要重复添加`)

    enroll(persona.value, act.value.activityId, {
      name,
      phone,
      houseShort: form.house.trim(),
      people: form.people,
      attendees: form.attendees.map(t => ({ ...t })),
      paid: form.paid,
      paymentMethod: form.paymentMethod
    })
    open.value = false
    toastOk(form.paid && act.value.fee > 0 ? '已报名并记已收款' : '已报名')
    emit('done')
  } catch (e) {
    toastErr(e.message || '报名失败')
  }
}
</script>

<style scoped>
.fld {
  padding: 12rpx 0;
}

.fld__k {
  display: block;
  font-size: 22rpx;
  color: var(--biz-text-3);
  margin-bottom: 10rpx;
}

.req {
  color: var(--biz-danger);
}

.ph-txt {
  color: var(--biz-text-4);
}

.left {
  display: block;
  margin-top: 10rpx;
  font-size: 18rpx;
  color: #a35c13;
}

.left.is-bad {
  color: var(--biz-danger);
}

.step {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.step__b {
  width: 64rpx;
  height: 64rpx;
  border-radius: 12rpx;
  background: var(--biz-bg-fill);
  color: var(--biz-text-1);
  font-size: 30rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step__n {
  min-width: 40rpx;
  text-align: center;
  font-size: 28rpx;
  color: var(--biz-text-1);
}

.who {
  margin-top: 6rpx;
  padding: 14rpx 16rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
}

.who__t {
  display: block;
  font-size: 21rpx;
  color: var(--biz-text-2);
  margin-bottom: 8rpx;
}

.who__i {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
  margin-bottom: 12rpx;
  padding-bottom: 10rpx;
  border-bottom: 2rpx dashed var(--biz-border);
}

.who__i:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.who__n {
  flex: none;
  width: 100rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.who__in {
  flex: 1;
  min-width: 0;
  background: #fff;
}

.who__in--full {
  flex: none;
  width: calc(100% - 110rpx);
  margin-left: 110rpx;
  font-size: 22rpx;
  letter-spacing: 0.5rpx;
}

.chips {
  display: flex;
  gap: 12rpx;
  flex-wrap: wrap;
}

.chip {
  height: 64rpx;
  padding: 0 20rpx;
  border-radius: 12rpx;
  background: var(--biz-bg-fill);
  font-size: 23rpx;
  color: var(--biz-text-2);
  display: flex;
  align-items: center;
}

.chip.is-on {
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 2rpx var(--biz-primary);
}

.foot-full {
  width: 100%;
  height: 88rpx;
  margin-top: 22rpx;
  font-size: 28rpx;
}
</style>
