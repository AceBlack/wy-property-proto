<!--
  收费 / 免费活动报名：出行人 + 条款 + 投保
  ------------------------------------------------------------
  §12.2 第 6 条：收费活动要收**出行人**（姓名/证件/手机/紧急联系人）、投保同意、条款勾选。
  §12.3 第 3 条：证件号**只在 needInsurance 时收集**，用途只写"购买当日意外险"，
  活动结束 30 天脱敏。所以不投保的活动，这个表单里连证件输入框都不出现 ——
  不收集就不会泄露。
-->
<template>
  <view class="page">
    <NavBar title="填写报名信息" :subtitle="a ? a.title : ''" />
    <view class="body" :class="{ 'body--with-foot': !!a }">
      <Empty v-if="!a" text="活动不存在" />

      <template v-else>
        <view class="card en__sum">
          <view class="en__sum-l">
            <text class="en__sum-t">{{ a.title }}</text>
            <text class="en__sum-d">{{ a.startAt }} · {{ a.place }}</text>
          </view>
          <view class="en__sum-r">
            <text class="en__price">{{ a.fee > 0 ? `¥${a.fee}` : '免费' }}</text>
            <text class="en__unit">{{ a.fee > 0 ? '/人' : '' }}</text>
          </view>
        </view>

        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">出行人（{{ list.length }}/{{ a.attendeeLimit }}）</text>
            <text class="sec-hd__d">含本人</text>
          </view>

          <view v-for="(p, i) in list" :key="i" class="en__p">
            <view class="en__p-hd">
              <text class="en__p-t">出行人 {{ i + 1 }}</text>
              <text v-if="list.length > 1" class="en__p-del" @tap="removeAt(i)">删除</text>
            </view>
            <view class="field">
              <view class="field__k"><text>姓名</text><text class="field__hint">与证件一致</text></view>
              <input v-model="p.name" class="field__input field__input--boxed" maxlength="12" placeholder="请输入姓名" placeholder-class="ph" />
            </view>
            <view class="field">
              <view class="field__k"><text>手机号</text><text class="field__hint">行前通知用</text></view>
              <input v-model="p.phone" class="field__input field__input--boxed" type="number" maxlength="11" placeholder="请输入手机号" placeholder-class="ph" />
            </view>
            <view class="field">
              <view class="field__k"><text>年龄</text><text class="field__hint">影响票价与保险</text></view>
              <view class="en__ages">
                <view v-for="t in ['成人', '儿童']" :key="t" class="chip" :class="{ 'is-on': p.ageType === t }" @tap="p.ageType = t">
                  <text>{{ t }}</text>
                </view>
              </view>
            </view>
            <template v-if="a.needInsurance">
              <view class="field">
                <view class="field__k"><text>身份证号</text><text class="field__hint">仅用于购买当日意外险</text></view>
                <input v-model="p.idNo" class="field__input field__input--boxed" maxlength="18" placeholder="18 位身份证号" placeholder-class="ph" />
              </view>
              <view class="field">
                <view class="field__k"><text>紧急联系人</text><text class="field__hint">选填</text></view>
                <input v-model="p.emergencyName" class="field__input field__input--boxed" maxlength="12" placeholder="姓名" placeholder-class="ph" />
              </view>
              <view class="field">
                <view class="field__k"><text>紧急联系电话</text><text class="field__hint">选填</text></view>
                <input v-model="p.emergencyPhone" class="field__input field__input--boxed" type="number" maxlength="11" placeholder="手机号" placeholder-class="ph" />
              </view>
            </template>
          </view>

          <view
            v-if="list.length < a.attendeeLimit"
            id="attendee-add"
            class="btn btn--ghost btn--sm en__add"
            @tap="addOne"
          >
            <text>+ 添加同行人</text>
          </view>
          <text class="en__limit">本活动每位报名人最多 {{ a.attendeeLimit }} 位出行人。</text>
        </view>

        <!-- 费用 -->
        <view class="card">
          <view class="sec-hd"><text class="sec-hd__t">费用合计</text><text class="sec-hd__d">{{ a.fee > 0 ? '报名后在线支付' : '免费' }}</text></view>
          <view class="sum-row"><text class="sum-row__k">单价</text><text class="sum-row__v">{{ a.fee > 0 ? money(a.fee) : '免费' }}</text></view>
          <view class="sum-row"><text class="sum-row__k">人数</text><text class="sum-row__v">{{ list.length }} 人</text></view>
          <view class="sum-row sum-row--total"><text class="sum-row__k">合计</text><text class="sum-row__v">{{ money(total) }}</text></view>
          <text v-if="a.fee > 0" class="en__fee-tip">费用包含：{{ a.feeInclude || '—' }}</text>
        </view>

        <!-- 条款 -->
        <view class="card">
          <view class="en__agree" @tap="agreeTerms = !agreeTerms">
            <view class="en__check" :class="{ 'is-on': agreeTerms }"><text v-if="agreeTerms">✓</text></view>
            <text class="en__agree-t">
              我已阅读并同意《活动报名条款》：按名额先到先得；取消按活动退款分档计算；
              未达成团人数时由物业确认流团并全额退款。
            </text>
          </view>
          <view v-if="a.needInsurance" class="en__agree" @tap="agreeInsurance = !agreeInsurance">
            <view class="en__check" :class="{ 'is-on': agreeInsurance }"><text v-if="agreeInsurance">✓</text></view>
            <text class="en__agree-t">
              同意为出行人购买当日意外险，并授权将姓名与证件号提供给承保机构；
              活动结束后 30 天自动脱敏。
            </text>
          </view>
        </view>

        <view v-if="err" class="banner banner--offline">
          <view class="banner__ico"><text>!</text></view>
          <text class="banner__t">{{ err }}</text>
        </view>

        <view class="en__note">
          <text class="demo-tip">合规</text>
          <text class="en__note-t">
            证件号只在投保时收集，只用于购买当日意外险；不投保的活动连输入框都不出现。
            真实环境这里要接微信内容安全与实名核验，演示环境只做格式校验。
          </text>
        </view>
      </template>
    </view>

    <Bar
      v-if="a"
      label="合计"
      :amount="money(total)"
      :hint="a.fee > 0 ? '报名后生成待支付订单' : '免费活动，提交即报名成功'"
      :okText="submitting ? '提交中…' : a.fee > 0 ? '提交并支付' : '提交报名'"
      :disabled="!canSubmit || submitting"
      btn-id="enroll-submit"
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
import { activityOf, enrollActivity } from '@/api/neighbor'
import { createActivityPay } from '@/api/mp'
import { app } from '@/store/app'
import { money } from '@/utils/format'
import { go, toastOk, toastErr } from '@/utils/ui'
import { gateLogin } from '@/utils/guard'

const id = ref('')
const ver = ref(0)
const agreeTerms = ref(false)
const agreeInsurance = ref(false)
const submitting = ref(false)
const err = ref('')

const a = computed(() => {
  ver.value
  return id.value ? activityOf(id.value) : null
})

const blank = () => ({ name: '', phone: '', idNo: '', ageType: '成人', emergencyName: '', emergencyPhone: '' })
const list = reactive([blank()])

onLoad(o => {
  if (!gateLogin()) return
  id.value = o?.id ? decodeURIComponent(o.id) : ''
  ver.value++
  /* 带出登录人的姓名与手机号，少填两个框 */
  if (app.session) {
    list[0].name = app.session.name || ''
    list[0].phone = app.session.phone || ''
  }
})

const total = computed(() => (a.value ? Math.round(a.value.fee * list.length * 100) / 100 : 0))
const canSubmit = computed(() => {
  if (!a.value) return false
  if (!agreeTerms.value) return false
  if (a.value.needInsurance && !agreeInsurance.value) return false
  return list.every(p => String(p.name).trim() && /^1\d{10}$/.test(String(p.phone)))
})

function addOne() {
  if (list.length >= a.value.attendeeLimit) return
  list.push(blank())
}
function removeAt(i) {
  list.splice(i, 1)
}

async function submit() {
  if (!gateLogin()) return
  err.value = ''
  submitting.value = true
  try {
    const row = await enrollActivity(id.value, {
      attendees: list.map(p => ({ ...p })),
      agreeTerms: agreeTerms.value,
      agreeInsurance: agreeInsurance.value
    })
    if (row.payStatus === '待支付') {
      const pay = await createActivityPay(row.enrollId)
      submitting.value = false
      go('/pages/pay/index', { payId: pay.payId })
      return
    }
    submitting.value = false
    toastOk('报名成功')
    setTimeout(() => uni.redirectTo({ url: `/pages/neighbor/activity?id=${encodeURIComponent(id.value)}` }), 600)
  } catch (e) {
    submitting.value = false
    err.value = e.message || '提交失败'
  }
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 220rpx; }

.en__sum { display: flex; align-items: center; gap: 16rpx; }
.en__sum-l { flex: 1; min-width: 0; }
.en__sum-t { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.en__sum-d { display: block; margin-top: 6rpx; font-size: 20rpx; color: var(--biz-text-3); }
.en__sum-r { flex: none; display: flex; align-items: baseline; }
.en__price { font-family: var(--biz-font-num); font-size: 34rpx; font-weight: 700; color: var(--biz-danger); }
.en__unit { font-size: 19rpx; color: var(--biz-text-4); }

.en__p { padding-top: 8rpx; border-bottom: 2rpx solid var(--biz-border-light); }
.en__p:last-of-type { border-bottom: none; }
.en__p-hd { display: flex; align-items: center; justify-content: space-between; padding: 8rpx 0; }
.en__p-t { font-size: 24rpx; font-weight: 600; color: var(--biz-text-2); }
.en__p-del { font-size: 21rpx; color: var(--biz-danger); }
.en__ages { display: flex; gap: 12rpx; }
.en__add { margin-top: 16rpx; }
.en__limit { display: block; margin-top: 10rpx; font-size: 20rpx; color: var(--biz-text-4); }

.en__fee-tip { display: block; margin-top: 12rpx; font-size: 20rpx; color: var(--biz-text-4); line-height: 1.6; }

.en__agree { display: flex; gap: 12rpx; align-items: flex-start; padding: 10rpx 0; }
.en__check {
  flex: none; width: 32rpx; height: 32rpx; border-radius: 50%;
  border: 3rpx solid var(--biz-border); display: flex; align-items: center; justify-content: center;
  font-size: 18rpx; color: #fff; margin-top: 2rpx;
}
.en__check.is-on { background: var(--biz-primary); border-color: var(--biz-primary); }
.en__agree-t { flex: 1; font-size: 21rpx; color: var(--biz-text-3); line-height: 1.65; }

.en__note { margin-top: 22rpx; display: flex; gap: 12rpx; align-items: flex-start; }
.en__note-t { flex: 1; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.6; }
</style>
