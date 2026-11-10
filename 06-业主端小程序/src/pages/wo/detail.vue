<!--
  屏 8 · 工单详情（进度 / 师傅 / 费用 / 增项确认 / 评价）
  ------------------------------------------------------------
  这一屏是业主端和员工端真正咬合的地方：

  · 增项确认：业主确认后**金额合并进本单总额**（不新开一单），员工端那边才允许完工；
    所以这里必须把「原价 / 增项 / 合计」三段摆出来，否则业主永远看不懂"怎么就多了 80"。
  · 支付：未支付时给一张待支付订单，支付走模拟成功（不接真通道）。
  · 评价：写回 workOrders 的 score / evalTags / evaluate —— 与 PC、员工端同一组字段。

  增项由**员工端现场加**（`POST /work-orders/{id}/addons`），业主端只做确认。
  2026-11-08 删掉了原来的「模拟加项」按钮 —— 它能让业主给自己加一条收费项，
  性质与"自己能审自己的发布"一样，不能留到交付。
-->
<template>
  <view class="page">
    <NavBar title="工单详情" :subtitle="wo?.woNo || ''" />

    <view class="body" :class="{ 'body--with-foot': !!mainAction }">
      <Empty v-if="!wo" text="工单不存在" sub="可能已被取消，回首页看看其他单" />

      <template v-else>
        <!-- 状态头 -->
        <view class="card wd__hd">
          <view class="wd__hd-top">
            <view class="wd__hd-left">
              <Tag :text="wo.status" :color="STATUS_TONE[wo.status] || 'var(--biz-text-3)'" />
              <text class="wd__hd-t">{{ statusText }}</text>
            </view>
            <text class="wd__hd-fee">{{ money(wo.totalFee) }}</text>
          </view>
          <view v-if="wo.pendingAddons.length" class="wd__hd-tip">
            <text>另有 {{ wo.pendingAddons.length }} 项增项 {{ money(wo.pendingAddonFee) }} 待确认，暂未计入合计</text>
          </view>
          <text class="wd__hd-desc">{{ wo.priceName || wo.title }}</text>
          <view class="wd__hd-meta">
            <text>{{ wo.houseName }}</text>
            <text class="wd__dot">·</text>
            <text>{{ wo.appointSlot ? `预约 ${wo.appointAt} ${wo.appointSlot}` : `下单 ${mdTime(wo.createTime)}` }}</text>
          </view>
        </view>

        <!-- 待确认增项 -->
        <view v-if="wo.pendingAddons.length" class="card wd__pending">
          <view class="sec-hd">
            <text class="sec-hd__t">有 {{ wo.pendingAddons.length }} 项增项待您确认</text>
            <text class="sec-hd__d">确认后并入本单总额</text>
          </view>

          <view v-for="(a, i) in wo.pendingAddons" :key="a.code + i" class="wd__addon">
            <view class="wd__addon-body">
              <text class="wd__addon-t">{{ a.name }}</text>
              <text class="wd__addon-d">{{ a.qty }} 项 · 材料 {{ money(a.material) }} + 人工 {{ money(a.labor) }} · {{ a.by }} 加</text>
            </view>
            <text class="wd__addon-v">{{ money(a.total) }}</text>
          </view>

          <view class="wd__sum">
            <view class="sum-row">
              <text class="sum-row__k">原价（材料 + 人工）</text>
              <text class="sum-row__v">{{ money(wo.originFee) }}</text>
            </view>
            <view class="sum-row sum-row--addon">
              <text class="sum-row__k">现场增项（{{ wo.pendingAddons.length }} 项）</text>
              <text class="sum-row__v">+{{ money(wo.pendingAddonFee) }}</text>
            </view>
            <view class="sum-row sum-row--total">
              <text class="sum-row__k">确认后合计</text>
              <text class="sum-row__v">{{ money(wo.originFee + wo.pendingAddonFee) }}</text>
            </view>
          </view>

          <text class="wd__pending-note">
            以上增项由师傅现场添加，价目与下单时是同一份公示价目。确认后金额合并到本单，不会另开一张单。
          </text>
        </view>

        <!-- 待支付提示 -->
        <view v-if="needPay" class="paybar">
          <view class="paybar__body">
            <text class="paybar__t">待支付 {{ money(wo.dueFee) }}</text>
            <text class="paybar__d">
              {{ wo.paidAmount > 0 ? `本单已预付 ${money(wo.paidAmount)}，这是增项差额` : (wo.payOrder ? `订单 ${wo.payOrder.payId} · 有效期至 ${wo.payOrder.expireAt}` : '点右侧生成待支付订单') }}
            </text>
          </view>
          <text id="wo-pay-link" class="paybar__v" @tap="goPay">去支付</text>
        </view>

        <!-- 进度 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">进度</text>
            <text class="sec-hd__d">节点由工单字段推导，和员工端同一份</text>
          </view>
          <Timeline :nodes="nodes" />
        </view>

        <!-- 师傅 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">上门师傅</text>
            <text class="sec-hd__d">{{ wo.assignee ? '已指派' : '等待派单' }}</text>
          </view>
          <view v-if="wo.assignee" class="wd__emp">
            <view class="wd__emp-ava"><text>{{ wo.assignee.slice(0, 1) }}</text></view>
            <view class="wd__emp-body">
              <text class="wd__emp-n">{{ wo.assignee }}</text>
              <text class="wd__emp-d">
                到达时间 {{ wo.arriveTime ? mdTime(wo.arriveTime) : '未到场' }}
                <text v-if="wo.assigneePhone"> · {{ maskPhone(wo.assigneePhone) }}</text>
              </text>
            </view>
          </view>
          <view v-else class="wd__emp wd__emp--none">
            <text class="wd__emp-d">物业正在派单，通常 30 分钟内会有师傅联系您</text>
          </view>
        </view>

        <!-- 费用与支付 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">费用</text>
            <text class="sec-hd__d">
              <Tag :text="wo.payStatus" size="sm" :color="PAY_TONE[wo.payStatus] || 'var(--biz-text-3)'" />
            </text>
          </view>
          <view class="sum-row">
            <text class="sum-row__k">材料费</text>
            <text class="sum-row__v">{{ money(wo.materialFee) }}</text>
          </view>
          <view class="sum-row">
            <text class="sum-row__k">人工费</text>
            <text class="sum-row__v">{{ money(wo.laborFee) }}</text>
          </view>
          <view v-if="wo.addonFee" class="sum-row sum-row--addon">
            <text class="sum-row__k">现场增项（已确认）</text>
            <text class="sum-row__v">{{ money(wo.addonFee) }}</text>
          </view>
          <view class="sum-row sum-row--total">
            <text class="sum-row__k">合计</text>
            <text class="sum-row__v">{{ money(wo.totalFee) }}</text>
          </view>
          <view v-if="wo.paidAmount > 0" class="sum-row">
            <text class="sum-row__k">已预付</text>
            <text class="sum-row__v">{{ money(wo.paidAmount) }}</text>
          </view>
          <view v-if="wo.dueFee > 0" class="sum-row">
            <text class="sum-row__k">本次应付（增项差额）</text>
            <text class="sum-row__v danger">{{ money(wo.dueFee) }}</text>
          </view>
          <text v-if="wo.payTime" class="wd__paid">
            最近一次支付 {{ wo.payTime }}（{{ wo.payMethod || '微信支付（模拟）' }}）
          </text>
        </view>

        <!-- 报修信息 -->
        <view class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">报修信息</text>
          </view>
          <Cell label="单号" :value="wo.woNo || wo.woId" />
          <Cell label="类型" :value="`${wo.type} · ${wo.category}`" />
          <Cell label="下单时间" :value="wo.createTime" />
          <Cell v-if="wo.priceCode" label="价目编码" :value="`${wo.priceCode} × ${wo.priceQty || 1}`" />
          <Cell label="照片" :value="photoText" />
          <Cell label="描述" :value="wo.description || '—'" :last="true" />
        </view>

        <!-- 评价 -->
        <view v-if="wo.status === '已完工' && !wo.score" class="card wd__eval">
          <view class="sec-hd">
            <text class="sec-hd__t">这单修得怎么样？</text>
            <text class="sec-hd__d">评价会记在这位师傅名下</text>
          </view>
          <view id="wo-eval-inline" class="btn btn--primary" @tap="openEval"><text>去评价</text></view>
        </view>

        <view v-if="wo.score" class="card">
          <view class="sec-hd">
            <text class="sec-hd__t">我的评价</text>
            <text class="sec-hd__d">{{ wo.evaluateAt || '' }}</text>
          </view>
          <view class="wd__stars">
            <text v-for="i in 5" :key="i" class="star" :class="{ 'is-on': i <= wo.score }">★</text>
          </view>
          <view v-if="wo.evalTags?.length" class="chips wd__tags">
            <text v-for="t in wo.evalTags" :key="t" class="chip is-on">{{ t }}</text>
          </view>
          <text v-if="wo.evaluate" class="wd__eval-text">{{ wo.evaluate }}</text>
        </view>

      </template>
    </view>

    <Bar
      v-if="wo && mainAction"
      :label="mainAction.label"
      :amount="mainAction.amount"
      :hint="mainAction.hint"
      :okText="mainAction.ok"
      btn-id="wo-main"
      @submit="mainAction.run"
    />

    <!-- 评价弹层 -->
    <Sheet v-model:show="evalSheet" title="评价这单" sub="评分与标签会写回工单，师傅端能看到">
      <view class="ev__stars">
        <text v-for="i in 5" :key="i" class="star" :class="{ 'is-on': i <= score }" @tap="score = i">★</text>
        <text class="ev__score">{{ scoreText }}</text>
      </view>
      <view class="chips ev__tags">
        <text
          v-for="t in EVAL_TAGS"
          :key="t"
          class="chip"
          :class="{ 'is-on': tags.includes(t) }"
          @tap="toggleTag(t)"
        >{{ t }}</text>
      </view>
      <textarea v-model="text" class="textarea ev__text" maxlength="200" placeholder="说点什么（选填），比如师傅哪里做得好" placeholder-class="ph" />
      <view id="eval-submit" class="btn btn--primary ev__submit" @tap="submitEval"><text>提交评价</text></view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Bar from '@/components/Bar.vue'
import Cell from '@/components/Cell.vue'
import Empty from '@/components/Empty.vue'
import Sheet from '@/components/Sheet.vue'
import Tag from '@/components/Tag.vue'
import Timeline from '@/components/Timeline.vue'
import {
  EVAL_TAGS,
  PAY_TONE,
  STATUS_TEXT,
  STATUS_TONE,
  confirmAddons,
  createOrderPay,
  evaluateOrder,
  orderOf,
  timelineOf
} from '@/api/mp'
import { mdTime, money, maskPhone } from '@/utils/format'
import { toast, toastOk, toastErr, confirm as ask } from '@/utils/ui'
import { guardBound } from '@/utils/guard'

const woId = ref('')
const tick = ref(0)
const evalSheet = ref(false)
const score = ref(5)
const tags = ref([])
const text = ref('')

onLoad(options => {
  if (!guardBound()) return
  woId.value = options?.woId ? decodeURIComponent(options.woId) : ''
})

onShow(() => {
  tick.value++
})

const wo = computed(() => {
  tick.value
  return woId.value ? orderOf(woId.value) : null
})
const nodes = computed(() => timelineOf(wo.value))
const needPay = computed(() => !!(wo.value && wo.value.dueFee > 0 && !wo.value.pendingAddons.length))
/* 状态文案：还有待付时不能说"待评价"，业主会以为已经完事了 */
const statusText = computed(() => {
  const w = wo.value
  if (!w) return ''
  if (w.dueFee > 0 && w.status === '已完工') return '已完工，待支付增项差额'
  if (w.pendingAddons.length) return '有增项待确认'
  return STATUS_TEXT[w.status] || w.status
})
const photoText = computed(() => {
  const n = wo.value?.images || 0
  if (!n) return '未上传'
  const ph = (wo.value?.photos || []).filter(p => p.kind === 'placeholder').length
  return ph ? `${n} 张（含 ${ph} 张占位：设备无相机）` : `${n} 张`
})
const scoreText = computed(() => ['', '很差', '一般', '还行', '满意', '非常满意'][score.value])

/** 底部主操作只留一个：待确认 → 确认；待支付 → 支付；已完工 → 评价；否则再报一单 */
const mainAction = computed(() => {
  const w = wo.value
  if (!w) return null
  if (w.pendingAddons.length) {
    return {
      label: '待确认',
      amount: money(w.pendingAddonFee),
      hint: '确认后并入本单总额',
      ok: '确认增项',
      run: onConfirmAddons
    }
  }
  if (needPay.value) {
    return {
      label: w.paidAmount > 0 ? '增项差额' : '待支付',
      amount: money(w.dueFee),
      hint: w.paidAmount > 0 ? `已预付 ${money(w.paidAmount)}，本次只付差额` : w.payOrder ? `有效期至 ${w.payOrder.expireAt}` : '生成待支付订单',
      ok: '去支付',
      run: goPay
    }
  }
  if (w.status === '已完工' && !w.score) {
    return { label: '已完工', amount: '', hint: '评价会记在这位师傅名下', ok: '去评价', run: openEval }
  }
  return { label: '', amount: '', hint: '问题没解决？可以再下一单', ok: '再报一单', run: againRepair }
})

async function onConfirmAddons() {
  const w = wo.value
  const ok = await ask({
    title: '确认增项',
    content: `共 ${w.pendingAddons.length} 项、${money(w.pendingAddonFee)}。确认后并入本单，合计 ${money(w.originFee + w.pendingAddonFee)}。`,
    okText: '确认并入'
  })
  if (!ok) return
  try {
    confirmAddons(w.woId)
    tick.value++
    toastOk('已确认，金额已并入本单')
  } catch (e) {
    toastErr(e.message || '确认失败')
  }
}

function goPay() {
  try {
    const pay = wo.value.payOrder || createOrderPay(wo.value.woId)
    uni.navigateTo({ url: `/pages/pay/index?payId=${encodeURIComponent(pay.payId)}&woId=${encodeURIComponent(wo.value.woId)}` })
  } catch (e) {
    toastErr(e.message || '生成待支付订单失败')
  }
}

function openEval() {
  if (wo.value?.pendingAddons.length) {
    toast('先确认增项再评价')
    return
  }
  evalSheet.value = true
}

function toggleTag(t) {
  const i = tags.value.indexOf(t)
  if (i >= 0) tags.value.splice(i, 1)
  else tags.value.push(t)
}

async function submitEval() {
  try {
    await evaluateOrder(wo.value.woId, { score: score.value, tags: tags.value, text: text.value })
    evalSheet.value = false
    tick.value++
    toastOk('评价已提交')
  } catch (e) {
    toastErr(e.message || '评价失败')
  }
}

function againRepair() {
  uni.navigateTo({ url: `/pages/repair/create?houseId=${encodeURIComponent(wo.value?.houseId || '')}` })
}
</script>

<style scoped>
.page {
  min-height: 100vh;
  background: var(--biz-bg-page);
}

.body {
  padding: 20rpx 28rpx 60rpx;
}

.body--with-foot {
  padding-bottom: 220rpx;
}

/* ---------- 状态头 ---------- */
.wd__hd-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.wd__hd-left {
  display: flex;
  align-items: center;
  gap: 12rpx;
  min-width: 0;
}

.wd__hd-t {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.wd__hd-fee {
  flex: none;
  font-family: var(--biz-font-num);
  font-size: 34rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.wd__hd-tip {
  margin-top: 12rpx;
  padding: 10rpx 14rpx;
  background: #fff8f0;
  border-radius: 8rpx;
  font-size: 21rpx;
  color: #a35c13;
  line-height: 1.5;
}

.wd__hd-desc {
  display: block;
  margin-top: 14rpx;
  font-size: 25rpx;
  color: var(--biz-text-2);
  line-height: 1.5;
}

.wd__hd-meta {
  margin-top: 10rpx;
  font-size: 21rpx;
  color: var(--biz-text-4);
  display: flex;
  gap: 8rpx;
  flex-wrap: wrap;
}

.wd__dot {
  color: var(--biz-text-4);
}

/* ---------- 待确认增项 ---------- */
.wd__pending {
  border: 2rpx solid rgba(255, 159, 64, 0.35);
  background: #fffdf9;
}

.wd__addon {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.wd__addon-body {
  flex: 1;
  min-width: 0;
}

.wd__addon-t {
  font-size: 27rpx;
  color: var(--biz-text-1);
  font-weight: 500;
  display: block;
}

.wd__addon-d {
  display: block;
  margin-top: 4rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.wd__addon-v {
  flex: none;
  font-family: var(--biz-font-num);
  font-size: 28rpx;
  font-weight: 700;
  color: var(--biz-warning);
}

.wd__sum {
  margin-top: 4rpx;
}

.wd__pending-note {
  display: block;
  margin-top: 14rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

/* ---------- 师傅 ---------- */
.wd__emp {
  display: flex;
  align-items: center;
  gap: 18rpx;
}

.wd__emp-ava {
  flex: none;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wd__emp-body {
  flex: 1;
  min-width: 0;
}

.wd__emp-n {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  display: block;
}

.wd__emp-d {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.wd__emp--none {
  padding: 6rpx 0;
}

/* ---------- 已付 ---------- */
.wd__paid {
  display: block;
  margin-top: 14rpx;
  font-size: 21rpx;
  color: var(--biz-accent-dark);
}

/* ---------- 评价 ---------- */
.wd__stars {
  display: flex;
  gap: 10rpx;
}

.wd__tags {
  margin-top: 16rpx;
}

.wd__eval-text {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: var(--biz-text-2);
  line-height: 1.6;
}

/* ---------- 演示 ---------- */

/* ---------- 评价弹层 ---------- */
.ev__stars {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 12rpx 0 8rpx;
}

.ev__score {
  font-size: 24rpx;
  color: var(--biz-warning);
  font-weight: 600;
  margin-left: 8rpx;
}

.ev__tags {
  margin: 18rpx 0;
}

.ev__text {
  height: 150rpx;
}

.ev__submit {
  margin-top: 22rpx;
}
</style>
