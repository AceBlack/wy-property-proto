<!--
  报修详情
  ------------------------------------------------------------
  与设计稿对齐：三段进度 + 信息卡 + 工程师 + 催一催 / 联系管家 / 撤销 + 表情评价。
  数字口径与员工端一致：增项合并进本单总额，补付只付差额（dueFee）。
-->
<template>
  <view class="page">
    <NavBar title="报修详情" :subtitle="wo?.woNo || ''" />

    <view class="body" :class="{ 'body--with-foot': !!mainAction }">
      <Empty v-if="!wo" text="报修单不存在" />

      <template v-else>
        <!-- 进度 -->
        <view class="card wd__prog">
          <view class="wd__prog-hd">
            <Tag :text="wo.isPublic ? '公共区域' : '个人报修'" size="sm" :color="wo.isPublic ? 'var(--biz-primary)' : 'var(--biz-text-3)'" />
            <text class="wd__prog-st" :style="{ color: STATUS_TONE[wo.status] || 'var(--biz-text-3)' }">{{ statusText }}</text>
          </view>
          <view v-if="wo.status === '已取消'" class="wd__cancel">该报修已于 {{ wo.cancelledAt }} 撤销</view>
          <template v-else>
            <Progress :current="stageOf(wo)" />
            <view class="wd__prog-meta">
              <text>{{ wo.createTime }}</text>
              <text v-if="wo.appointSlot">预约 {{ wo.appointAt }} {{ wo.appointSlot }}</text>
            </view>
          </template>
        </view>

        <!-- 内容 -->
        <view class="card">
          <text class="wd__title">{{ wo.title }}</text>
          <text class="wd__desc">{{ wo.description || '（未填写描述）' }}</text>
          <view class="wd__imgs">
            <Cover v-for="i in (wo.images || 0)" :key="i" :cover="i + 1" h="120rpx" />
          </view>
          <view class="wd__meta">
            <text class="wd__m">{{ wo.houseName }}</text>
            <text class="wd__m" v-if="wo.priceCode">· {{ wo.priceName }}</text>
          </view>
        </view>

        <!-- 增项待确认 -->
        <view v-if="wo.pendingAddons.length" class="card wd__pending">
          <view class="sec-hd">
            <text class="sec-hd__t">有 {{ wo.pendingAddons.length }} 项增项待确认</text>
            <text class="sec-hd__d">确认后并入本单</text>
          </view>
          <view v-for="(a, i) in wo.pendingAddons" :key="a.code + i" class="wd__addon">
            <view class="wd__addon-b">
              <text class="wd__addon-t">{{ a.name }}</text>
              <text class="wd__addon-d">{{ a.qty }} 项 · 材料 {{ money(a.material) }} + 人工 {{ money(a.labor) }} · {{ a.by }} 加</text>
            </view>
            <text class="wd__addon-v">{{ money(a.total) }}</text>
          </view>
          <view class="sum-row"><text class="sum-row__k">原价</text><text class="sum-row__v">{{ money(wo.originFee) }}</text></view>
          <view class="sum-row sum-row--addon"><text class="sum-row__k">增项</text><text class="sum-row__v">+{{ money(wo.pendingAddonFee) }}</text></view>
          <view class="sum-row sum-row--total"><text class="sum-row__k">确认后合计</text><text class="sum-row__v">{{ money(wo.originFee + wo.pendingAddonFee) }}</text></view>
        </view>

        <!-- 待支付 -->
        <view v-if="needPay" class="paybar">
          <view class="paybar__b">
            <text class="paybar__t">待支付 {{ money(wo.dueFee) }}</text>
            <text class="paybar__d">{{ wo.paidAmount > 0 ? `已预付 ${money(wo.paidAmount)}，这是增项差额` : '下单预付款' }}</text>
          </view>
          <text id="wo-pay-link" class="paybar__v" @tap="goPay">去支付</text>
        </view>

        <!-- 工程师 -->
        <view v-if="wo.assignee" class="card wd__emp">
          <Avatar :name="wo.assignee" size="md" :tone="1" />
          <view class="wd__emp-b">
            <text class="wd__emp-n">{{ wo.assignee }}</text>
            <text class="wd__emp-d">{{ wo.assigneePhone ? maskPhone(wo.assigneePhone) : '联系方式由物业转接' }}</text>
            <text class="wd__emp-d">到场 {{ wo.arriveTime ? mdTime(wo.arriveTime) : '未到场' }}</text>
          </view>
          <view class="wd__emp-act" @tap="callEmp"><text>联系</text></view>
        </view>

        <!-- 费用 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">费用</text>
            <text class="sec-hd__d"><Tag :text="wo.payStatus" size="sm" :color="PAY_TONE[wo.payStatus] || 'var(--biz-text-3)'" /></text>
          </view>
          <view class="sum-row"><text class="sum-row__k">材料费</text><text class="sum-row__v">{{ money(wo.materialFee) }}</text></view>
          <view class="sum-row"><text class="sum-row__k">人工费</text><text class="sum-row__v">{{ money(wo.laborFee) }}</text></view>
          <view v-if="wo.addonFee" class="sum-row sum-row--addon"><text class="sum-row__k">现场增项（已确认）</text><text class="sum-row__v">{{ money(wo.addonFee) }}</text></view>
          <view class="sum-row sum-row--total"><text class="sum-row__k">合计</text><text class="sum-row__v">{{ money(wo.totalFee) }}</text></view>
          <view v-if="wo.paidAmount > 0" class="sum-row"><text class="sum-row__k">已支付</text><text class="sum-row__v">{{ money(wo.paidAmount) }}</text></view>
          <view v-if="wo.payTime" class="wd__paid">最近支付 {{ wo.payTime }}</view>
        </view>

        <!-- 已评价 -->
        <view v-if="wo.score" class="card">
          <view class="sec-hd"><text class="sec-hd__t">我的评价</text><text class="sec-hd__d">{{ wo.evaluateAt }}</text></view>
          <view class="wd__stars"><text v-for="i in 5" :key="i" class="star" :class="{ 'is-on': i <= wo.score }">★</text></view>
          <view v-if="wo.evalTags?.length" class="chips wd__tags"><text v-for="t in wo.evalTags" :key="t" class="chip is-on">{{ t }}</text></view>
          <text v-if="wo.evalResolved" class="wd__resolved">问题是否解决：{{ wo.evalResolved }}</text>
          <text v-if="wo.evaluate" class="wd__eval-text">{{ wo.evaluate }}</text>
        </view>

        <!-- 操作 -->
        <view v-if="canOperate" class="wd__ops">
          <view class="wd__op" @tap="urge"><text>催一催</text></view>
          <view class="wd__op" @tap="contact"><text>联系管家</text></view>
          <view v-if="canCancel" class="wd__op wd__op--bad" @tap="cancel"><text>撤销报修</text></view>
        </view>
        <text v-if="wo.urgeCount" class="wd__urged">已催办 {{ wo.urgeCount }} 次 · 最近 {{ wo.urgedAt }}</text>

        <!-- 演示：模拟加项 -->
        <view v-if="canDemoAddon" class="wd__demo">
          <text class="demo-tip">演示</text>
          <text class="wd__demo-d">模拟师傅现场加一项（拆旧/清运 ¥80），写入 workOrders[].addons。</text>
          <view id="demo-add" class="chip chip--demo" @tap="demoAdd"><text>模拟加项</text></view>
        </view>
      </template>
    </view>

    <Bar v-if="wo && mainAction" :label="mainAction.label" :amount="mainAction.amount" :hint="mainAction.hint" :okText="mainAction.ok" btn-id="wo-main" @submit="mainAction.run" />

    <!-- 评价 -->
    <Sheet v-model:show="evalSheet" title="对本次服务满意吗" sub="评价会记在这位师傅名下">
      <view class="ev__moods">
        <view v-for="m in EVAL_MOODS" :key="m.score" class="ev__mood" :class="{ 'is-on': mood === m.score }" @tap="mood = m.score">
          <text class="ev__ico">{{ m.icon }}</text>
          <text class="ev__lb">{{ m.label }}</text>
        </view>
      </view>
      <view class="ev__sec">问题是否解决</view>
      <view class="chips">
        <text v-for="r in EVAL_RESOLVED" :key="r" class="chip" :class="{ 'is-on': resolved === r }" @tap="resolved = r">{{ r }}</text>
      </view>
      <view class="ev__sec">其他标签（选填）</view>
      <view class="chips">
        <text v-for="t in EVAL_TAGS" :key="t" class="chip" :class="{ 'is-on': tags.includes(t) }" @tap="toggleTag(t)">{{ t }}</text>
      </view>
      <textarea v-model="text" class="textarea ev__text" maxlength="200" placeholder="说点什么（选填）" placeholder-class="ph" />
      <view id="eval-submit" class="btn btn--primary ev__submit" @tap="submitEval"><text>提交评价</text></view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Tag from '@/components/Tag.vue'
import Avatar from '@/components/Avatar.vue'
import Cover from '@/components/Cover.vue'
import Empty from '@/components/Empty.vue'
import Sheet from '@/components/Sheet.vue'
import Progress from '@/components/Progress.vue'
import {
  EVAL_MOODS,
  EVAL_RESOLVED,
  EVAL_TAGS,
  PAY_TONE,
  STATUS_TEXT,
  STATUS_TONE,
  confirmAddons,
  createOrderPay,
  demoAddAddon,
  evaluateOrder,
  orderOf,
  stageOf
} from '@/api/mp'
import { cancelRepair, urgeRepair } from '@/store/app'
import { mdTime, maskPhone, money } from '@/utils/format'
import { toast, toastOk, toastErr } from '@/utils/ui'
import { gateOwner } from '@/utils/guard'

const woId = ref('')
const tick = ref(0)
const evalSheet = ref(false)
const mood = ref(5)
const resolved = ref('已解决')
const tags = ref([])
const text = ref('')

onLoad(o => {
  if (!gateOwner('报修详情')) return
  woId.value = o?.woId ? decodeURIComponent(o.woId) : ''
})
onShow(() => {
  tick.value++
})

const wo = computed(() => {
  tick.value
  return woId.value ? orderOf(woId.value) : null
})
const statusText = computed(() => {
  const w = wo.value
  if (!w) return ''
  if (w.dueFee > 0 && w.status === '已完工') return '已完工，待支付增项差额'
  if (w.pendingAddons.length) return '有增项待确认'
  return STATUS_TEXT[w.status] || w.status
})
const needPay = computed(() => !!(wo.value && wo.value.dueFee > 0 && !wo.value.pendingAddons.length))
const canCancel = computed(() => wo.value && ['待派单', '已派单'].includes(wo.value.status))
const canOperate = computed(() => wo.value && ['待派单', '已派单', '处理中'].includes(wo.value.status))
const canDemoAddon = computed(
  () => wo.value && ['待派单', '已派单', '处理中', '待确认'].includes(wo.value.status) && !wo.value.score
)
const mainAction = computed(() => {
  const w = wo.value
  if (!w) return null
  if (w.pendingAddons.length) return { label: '待确认', amount: money(w.pendingAddonFee), hint: '确认后并入本单总额', ok: '确认增项', run: onConfirm }
  if (needPay.value) return { label: w.paidAmount > 0 ? '增项差额' : '待支付', amount: money(w.dueFee), hint: w.paidAmount > 0 ? `已预付 ${money(w.paidAmount)}` : '下单预付款', ok: '去支付', run: goPay }
  if (w.status === '已完工' && !w.score) return { label: '已完工', amount: '', hint: '评价会记在这位师傅名下', ok: '去评价', run: () => (evalSheet.value = true) }
  return { label: '', amount: '', hint: '问题没解决？可以再报一单', ok: '再报一单', run: again }
})

async function onConfirm() {
  const w = wo.value
  const ok = await new Promise(r =>
    uni.showModal({
      title: '确认增项',
      content: `共 ${w.pendingAddons.length} 项、${money(w.pendingAddonFee)}，确认后本单合计 ${money(w.originFee + w.pendingAddonFee)}。`,
      confirmText: '确认并入',
      success: x => r(!!x.confirm)
    })
  )
  if (!ok) return
  try {
    await confirmAddons(w.woId)
    tick.value++
    toastOk('已确认，金额已并入本单')
  } catch (e) {
    toastErr(e.message || '确认失败')
  }
}

async function goPay() {
  try {
    const p = wo.value.payOrder || await createOrderPay(wo.value.woId)
    uni.navigateTo({ url: `/pages/pay/index?payId=${encodeURIComponent(p.payId)}&woId=${encodeURIComponent(wo.value.woId)}` })
  } catch (e) {
    toastErr(e.message || '生成订单失败')
  }
}

function urge() {
  urgeRepair(wo.value.woId)
  tick.value++
  toastOk('已提醒物业')
}
function cancel() {
  uni.showModal({
    title: '撤销报修',
    content: '撤销后本单关闭；如果师傅已出发，请先电话沟通。',
    confirmText: '撤销',
    confirmColor: '#ec4d63',
    success: res => {
      if (!res.confirm) return
      cancelRepair(wo.value.woId, '业主撤销')
      tick.value++
      toast('已撤销')
    }
  })
}
function contact() {
  const phone = wo.value.house?.steward?.phone
  if (!phone) return toast('管家电话未登记')
  uni.makePhoneCall({ phoneNumber: phone, fail: () => toast('演示环境不能拨号') })
}
function callEmp() {
  const p = wo.value.assigneePhone
  if (!p) return toast('师傅电话由物业转接')
  uni.makePhoneCall({ phoneNumber: p, fail: () => toast('演示环境不能拨号') })
}

function toggleTag(t) {
  const i = tags.value.indexOf(t)
  if (i >= 0) tags.value.splice(i, 1)
  else tags.value.push(t)
}
async function submitEval() {
  try {
    await evaluateOrder(wo.value.woId, { score: mood.value, tags: tags.value, text: text.value, resolved: resolved.value })
    evalSheet.value = false
    tick.value++
    toastOk('评价已提交')
  } catch (e) {
    toastErr(e.message || '评价失败')
  }
}
function demoAdd() {
  try {
    demoAddAddon(wo.value.woId, 'AD-D01', 1)
    tick.value++
    toastOk('已模拟 1 项现场增项')
  } catch (e) {
    toastErr(e.message || '加项失败')
  }
}
function again() {
  uni.navigateTo({ url: `/pages/repair/create?scope=${wo.value?.isPublic ? 'public' : 'personal'}` })
}
</script>

<style scoped>
.page { min-height: 100vh; background: var(--biz-bg-page); }
.body { padding: 20rpx 28rpx 60rpx; }
.body--with-foot { padding-bottom: 220rpx; }

.wd__prog-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 22rpx; }
.wd__prog-st { font-size: 25rpx; font-weight: 600; }
.wd__prog-meta { display: flex; justify-content: space-between; margin-top: 16rpx; font-size: 20rpx; color: var(--biz-text-4); }
.wd__cancel { padding: 12rpx 0; font-size: 23rpx; color: var(--biz-text-3); }

.wd__title { font-size: 30rpx; font-weight: 600; color: var(--biz-text-1); line-height: 1.4; }
.wd__desc { display: block; margin-top: 10rpx; font-size: 24rpx; color: var(--biz-text-2); line-height: 1.6; }
.wd__imgs { display: flex; gap: 12rpx; margin-top: 16rpx; }
.wd__imgs > * { flex: 1; }
.wd__meta { display: flex; gap: 8rpx; margin-top: 14rpx; flex-wrap: wrap; }
.wd__m { font-size: 20rpx; color: var(--biz-text-4); }

.wd__pending { border: 2rpx solid rgba(255,159,64,0.35); background: #fffdf9; }
.wd__addon { display: flex; align-items: center; gap: 16rpx; padding: 14rpx 0; border-bottom: 2rpx solid var(--biz-border-light); }
.wd__addon-b { flex: 1; min-width: 0; }
.wd__addon-t { font-size: 26rpx; color: var(--biz-text-1); font-weight: 500; }
.wd__addon-d { display: block; margin-top: 4rpx; font-size: 20rpx; color: var(--biz-text-3); }
.wd__addon-v { font-family: var(--biz-font-num); font-size: 27rpx; font-weight: 700; color: var(--biz-warning); }

.wd__emp { display: flex; align-items: center; gap: 18rpx; }
.wd__emp-b { flex: 1; min-width: 0; }
.wd__emp-n { font-size: 27rpx; font-weight: 600; color: var(--biz-text-1); }
.wd__emp-d { display: block; margin-top: 4rpx; font-size: 21rpx; color: var(--biz-text-3); }
.wd__emp-act { padding: 8rpx 20rpx; border-radius: 999rpx; background: var(--biz-primary-light-9); color: var(--biz-primary); font-size: 21rpx; }

.wd__paid { display: block; margin-top: 12rpx; font-size: 20rpx; color: var(--biz-accent-dark); }
.wd__stars { display: flex; gap: 10rpx; }
.wd__tags { margin-top: 14rpx; }
.wd__resolved { display: block; margin-top: 12rpx; font-size: 22rpx; color: var(--biz-text-2); }
.wd__eval-text { display: block; margin-top: 10rpx; font-size: 23rpx; color: var(--biz-text-2); line-height: 1.6; }

.wd__ops { display: flex; gap: 16rpx; margin-top: 22rpx; }
.wd__op { flex: 1; text-align: center; padding: 20rpx 0; border-radius: 16rpx; background: #fff; color: var(--biz-text-2); font-size: 24rpx; box-shadow: var(--biz-shadow-card); }
.wd__op--bad { color: var(--biz-danger); }
.wd__urged { display: block; margin-top: 14rpx; text-align: center; font-size: 20rpx; color: var(--biz-text-4); }

.wd__demo { margin-top: 24rpx; display: flex; gap: 12rpx; align-items: center; flex-wrap: wrap; }
.wd__demo-d { flex: 1; min-width: 340rpx; font-size: 21rpx; color: var(--biz-text-4); line-height: 1.55; }

.ev__moods { display: flex; gap: 18rpx; }
.ev__mood { flex: 1; padding: 22rpx 0; border-radius: 18rpx; background: var(--biz-bg-fill); display: flex; flex-direction: column; align-items: center; gap: 8rpx; border: 2rpx solid transparent; }
.ev__mood.is-on { border-color: var(--biz-primary); background: var(--biz-primary-light-9); }
.ev__ico { font-size: 44rpx; line-height: 1; }
.ev__lb { font-size: 22rpx; color: var(--biz-text-2); }
.ev__sec { margin: 22rpx 0 12rpx; font-size: 23rpx; font-weight: 600; color: var(--biz-text-2); }
.ev__text { margin-top: 20rpx; height: 140rpx; }
.ev__submit { margin-top: 22rpx; }
</style>
