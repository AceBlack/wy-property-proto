<template>
  <view class="page">
    <NavBar title="闲置审核" :subtitle="d?.itemId || ''" />

    <view v-if="!d" class="body">
      <Empty text="内容不存在或已处理" sub="回到待办列表刷新一下" />
    </view>

    <view v-else class="body body--with-foot">
      <!-- 图：原型用色块 + 张数，不假装有图 -->
      <view class="imgs">
        <view v-for="n in Math.max(1, Math.min(3, d.images || 1))" :key="n" class="imgs__i" :class="`imgs__i--${n}`">
          <text class="imgs__n">图 {{ n }}</text>
        </view>
        <text v-if="!d.images" class="imgs__note">发布时没传图（审核时要留意：无图商品更容易出问题）</text>
      </view>

      <view class="card">
        <view class="top">
          <text class="price num">{{ d.freeGive ? '免费赠送' : `¥${d.price}` }}</text>
          <text v-if="d.originPrice" class="origin num">原价 ¥{{ d.originPrice }}</text>
          <text class="badge">{{ d.status }}</text>
        </view>
        <text class="title">{{ d.title }}</text>
        <view class="meta">
          <text>{{ d.category }}</text>
          <text class="dot">·</text>
          <text>{{ d.condition }}</text>
          <text class="dot">·</text>
          <text>{{ d.publishAt }}</text>
        </view>
        <text v-if="d.desc" class="desc">{{ d.desc }}</text>
      </view>

      <!-- 发布人：只到楼栋，不到门牌 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">发布人</text>
          <text class="sec-hd__d">只到楼栋，不显示门牌</text>
        </view>
        <view class="kv"><text class="kv__k">姓名</text><text class="kv__v">{{ d.sellerName }}</text></view>
        <view class="kv"><text class="kv__k">类型</text><text class="kv__v">{{ d.sellerType }}</text></view>
        <view class="kv"><text class="kv__k">楼栋</text><text class="kv__v">{{ d.building || '未填' }}</text></view>
        <view class="kv"><text class="kv__k">联系方式</text><text class="kv__v">{{ d.contactMode }}</text></view>
      </view>

      <view class="note">
        <text class="note__t">审核口径</text>
        <text class="note__d">
          通过 = 立刻对业主可见；驳回必须写理由 —— 业主会拿着驳回通知来问「为什么」。
          违禁品、活体、药品、代购广告一律驳回；二手正常生活用品通过。
        </text>
      </view>
    </view>

    <view v-if="d" class="footbar">
      <view id="nb-reject" class="btn btn--line foot-btn" @tap="openReject">驳回</view>
      <view id="nb-pass" class="btn btn--primary foot-btn" @tap="pass">通过并上架</view>
    </view>

    <Sheet v-model:show="rejectSheet" title="驳回理由" sub="业主会看到这条理由" max-height="70vh">
      <view class="reasons">
        <view
          v-for="(r, i) in REASONS"
          :key="r"
          :id="`nb-reason-${i}`"
          class="reason"
          :class="{ 'is-on': reason === r }"
          @tap="reason = r"
        >
          {{ r }}
        </view>
      </view>
      <text class="fld__k">补充说明（会一并给业主）</text>
      <textarea
        id="nb-reason-note"
        v-model="note"
        class="textarea"
        :maxlength="80"
        placeholder="例如：图片与实际不符，请补充实拍图后重新发布"
        placeholder-class="ph-txt"
      />
      <view id="nb-reject-confirm" class="btn btn--primary foot-full" @tap="doReject">确认驳回</view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Sheet from '@/components/Sheet.vue'
import Empty from '@/components/Empty.vue'
import { audit, itemOf } from '@/api/neighbor'
import { persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const REASONS = ['疑似违禁品', '图片与描述不符', '价格明显异常', '含广告或引流', '信息不完整', '其他']

const itemId = ref('')
const d = ref(null)
const rejectSheet = ref(false)
const reason = ref(REASONS[0])
const note = ref('')

async function load() {
  d.value = await itemOf(itemId.value)
}

function pass() {
  try {
    audit(persona.value, itemId.value, { pass: true })
    toastOk('已通过，业主端可见')
    setTimeout(() => uni.navigateBack(), 600)
  } catch (e) {
    toastErr(e.message || '审核失败')
  }
}

function openReject() {
  rejectSheet.value = true
}

function doReject() {
  /* 预设理由 + 补充说明一起写进去：只给预设，业主会看不懂 */
  const why = [reason.value, note.value.trim()].filter(Boolean).join('：')
  try {
    audit(persona.value, itemId.value, { pass: false, reason: why })
    rejectSheet.value = false
    toastOk('已驳回')
    setTimeout(() => uni.navigateBack(), 600)
  } catch (e) {
    toastErr(e.message || '驳回失败')
  }
}

onLoad(o => {
  itemId.value = o.itemId || ''
  load()
})
</script>

<style scoped>
.imgs {
  display: flex;
  gap: 10rpx;
  margin-bottom: 18rpx;
  flex-wrap: wrap;
}

.imgs__i {
  flex: 1;
  min-width: 180rpx;
  height: 200rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.imgs__i--1 {
  background: linear-gradient(135deg, #dfe4ff, #eef6ff);
}

.imgs__i--2 {
  background: linear-gradient(135deg, #e6faf3, #f2fffb);
}

.imgs__i--3 {
  background: linear-gradient(135deg, #fff3e6, #fffaf2);
}

.imgs__n {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.imgs__note {
  width: 100%;
  font-size: 18rpx;
  color: #a35c13;
  background: #fff7ed;
  border-radius: 10rpx;
  padding: 10rpx 14rpx;
  line-height: 1.5;
}

.top {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.price {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--biz-danger);
}

.origin {
  font-size: 20rpx;
  color: var(--biz-text-4);
  text-decoration: line-through;
}

.badge {
  margin-left: auto;
  font-size: 18rpx;
  color: #a35c13;
  background: #fff7ed;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}

.title {
  display: block;
  margin-top: 10rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.45;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 8rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  flex-wrap: wrap;
}

.dot {
  color: var(--biz-border);
}

.desc {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: var(--biz-text-2);
  line-height: 1.65;
}

.kv {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding: 10rpx 0;
}

.kv__k {
  flex: none;
  width: 120rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.kv__v {
  flex: 1;
  font-size: 24rpx;
  color: var(--biz-text-1);
}

.note {
  background: #fff;
  border-radius: 20rpx;
  padding: 20rpx 22rpx;
  box-shadow: var(--biz-shadow-card);
}

.note__t {
  display: block;
  font-size: 22rpx;
  font-weight: 600;
  color: var(--biz-text-2);
  margin-bottom: 6rpx;
}

.note__d {
  display: block;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 6rpx;
}

.reason {
  height: 64rpx;
  padding: 0 20rpx;
  border-radius: 12rpx;
  background: var(--biz-bg-fill);
  font-size: 23rpx;
  color: var(--biz-text-2);
  display: flex;
  align-items: center;
}

.reason.is-on {
  background: #fff0f0;
  color: var(--biz-danger);
  box-shadow: inset 0 0 0 2rpx var(--biz-danger);
}

.fld__k {
  display: block;
  margin: 16rpx 0 10rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.textarea {
  width: 100%;
  height: 150rpx;
  padding: 16rpx 18rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
  font-size: 24rpx;
  color: var(--biz-text-1);
}

.ph-txt {
  color: var(--biz-text-4);
}

.foot-btn {
  flex: 1;
  height: 88rpx;
  font-size: 29rpx;
}

.foot-full {
  width: 100%;
  height: 88rpx;
  margin-top: 22rpx;
  font-size: 28rpx;
}
</style>
