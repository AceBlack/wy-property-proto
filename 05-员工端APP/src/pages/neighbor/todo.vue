<template>
  <view class="page">
    <NavBar title="邻里待办" :subtitle="`待审 ${counts.items} · 待处理 ${counts.reports}`" />

    <view class="body">
      <view id="nb-act-link" class="toAct" hover-class="toAct--hover" @tap="goActivities">
        <view class="toAct__l">
          <text class="toAct__t">邻里活动</text>
          <text class="toAct__d">看本项目还能不能报 · 现场代报名 / 签到</text>
        </view>
        <text class="toAct__chev">›</text>
      </view>

      <view class="hint">
        <text class="hint__t">两件事，别混在一起</text>
        <text class="hint__d">
          待审核是「还没给业主看过，等你决定能不能发」；待处理是「已经上线，有人投诉，等你决定怎么办」。
          判断依据和留痕要求都不同，所以分成两个队列。
        </text>
      </view>

      <Segmented v-model="tab" :items="tabs" id-prefix="nb-" />

      <!-- 待审核：闲置 + 房源，按权限决定拉哪一类（同一个队列，不是一个入口） -->
      <template v-if="tab === 'items'">
        <view
          v-for="i in items"
          :key="i.itemId"
          :id="`nb-item-${i.itemId}`"
          class="card nb"
          hover-class="card--hover"
          @tap="openItem(i)"
        >
          <view class="nb__thumb">
            <text class="nb__thumb-n num">{{ i.images || 1 }}</text>
            <text class="nb__thumb-k">图</text>
          </view>
          <view class="nb__b">
            <view class="nb__top">
              <text class="nb__t">{{ i.title }}</text>
              <text class="wait num" :class="waitTone(i.publishAt)">{{ waitText(i.publishAt) }}</text>
            </view>
            <text class="nb__d">{{ i.category }} · {{ i.freeGive ? '免费赠送' : `¥${i.price}` }} · {{ i.condition }}</text>
            <text class="nb__m">{{ i.sellerName }} · {{ buildingOf(i.sellerHouse) || '楼栋未填' }}</text>
          </view>
          <text class="nb__chev">›</text>
        </view>

        <view
          v-for="l in listings"
          :key="l.listingId"
          :id="`nb-listing-${l.listingId}`"
          class="card lst"
          hover-class="card--hover"
          @tap="openListing(l)"
        >
          <view class="lst__top">
            <text class="lst__price num">¥{{ l.price }}</text>
            <text class="lst__type">{{ l.houseType }} · {{ l.area }}㎡</text>
            <text class="wait num" :class="l.tone">{{ l.wait }}</text>
          </view>
          <text class="lst__t">{{ l.buildingName }} · {{ l.decorate }} · {{ l.ownerName }}</text>
          <text class="lst__d">{{ l.desc }}</text>
          <view class="lst__foot">
            <text class="lst__s">待审核房源</text>
            <text v-if="l.escalated" class="lst__esc">超 48 小时 · 已升级给上级</text>
            <text v-else-if="l.overdue" class="lst__ec">超 24 小时未审</text>
          </view>
        </view>

        <Empty v-if="!items.length && !listings.length" :text="emptyAuditText" :sub="emptyAuditSub" />
      </template>

      <!-- 待处理：举报 -->
      <template v-else>
        <view
          v-for="r in reports"
          :key="r.reportId"
          :id="`nb-report-${r.reportId}`"
          class="card rp"
          hover-class="card--hover"
          @tap="openReport(r)"
        >
          <view class="rp__top">
            <text class="rp__reason">{{ r.reason }}</text>
            <text class="wait num" :class="waitTone(r.at)">{{ waitText(r.at) }}</text>
          </view>
          <text class="rp__t">{{ r.itemTitle }}</text>
          <text class="rp__d">{{ r.detail }}</text>
          <view class="rp__foot">
            <text class="rp__m">举报人 {{ r.reporterName }} · {{ buildingOf(r.reporterHouse) }}</text>
            <text class="rp__s">待处理</text>
          </view>
        </view>
        <Empty v-if="!reports.length" text="本项目没有待处理的举报" sub="全公司还有其它项目的单，按数据范围过滤掉了" />
      </template>

      <view class="tail">
        <text>
          数字比 PC 少是正常的：手机按登录人所属项目过滤，PC 是全公司口径。
          为了"对得上"去掉过滤，会让客服看到别的项目的业主。
        </text>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Segmented from '@/components/Segmented.vue'
import Empty from '@/components/Empty.vue'
import { buildingOf, todoOf, waitText, waitTone } from '@/api/neighbor'
import { listingAuditQueueOf } from '@/api/listing'
import { CAP, can } from '@/config/personas'
import { persona } from '@/store/app'
import { toastErr } from '@/utils/ui'

const tab = ref('items')
const items = ref([])
const listings = ref([])
const reports = ref([])
const counts = ref({ items: 0, reports: 0, total: 0 })
const loading = ref(true)

/* 队列按权限收条目：客服没有 a.listings.audit 就看不到房源，楼管没有 n.items.audit 就看不到闲置 */
const canAuditItem = computed(() => can(persona.value, CAP.neighborItemAudit))
const canAuditListing = computed(() => can(persona.value, CAP.listingAudit))
const canHandleReport = computed(() => can(persona.value, CAP.neighborReportHandle))

const emptyAuditText = computed(() =>
  canAuditListing.value && !canAuditItem.value
    ? '名下没有待审的房源'
    : canAuditItem.value && !canAuditListing.value
      ? '本项目没有待审的闲置'
      : '没有待审的内容'
)
const emptyAuditSub = computed(() =>
  canAuditListing.value && !canAuditItem.value
    ? '房源按「责任楼管」分派，名下没有挂牌就说明不在你这儿'
    : '别的地方还有，不在你的数据范围里'
)

const tabs = computed(() => [
  { key: 'items', label: '待审核', count: counts.value.items },
  { key: 'reports', label: '待处理', count: counts.value.reports }
])

async function load() {
  loading.value = true
  try {
    /* 没有审核权的队列干脆不拉：拉回来再在页面上藏，数字会说谎 */
    const r = await todoOf({ items: canAuditItem.value, reports: canHandleReport.value })
    items.value = r.items
    reports.value = r.reports
    listings.value = canAuditListing.value ? await listingAuditQueueOf(persona.value) : []
    counts.value = {
      items: r.items.length + listings.value.length,
      reports: r.reports.length,
      total: r.items.length + listings.value.length + r.reports.length
    }
    /* 只有一个队列有单时，默认落在有单的那一栏 */
    if (!counts.value.items && counts.value.reports) tab.value = 'reports'
  } catch (e) {
    toastErr(e.message || '待办加载失败')
  } finally {
    loading.value = false
  }
}

function goActivities() {
  uni.navigateTo({ url: '/pages/neighbor/activity' })
}

function openItem(i) {
  uni.navigateTo({ url: `/pages/neighbor/item?itemId=${i.itemId}` })
}

function openListing(l) {
  uni.navigateTo({ url: `/pages/neighbor/listing?listingId=${l.listingId}` })
}

function openReport(r) {
  uni.navigateTo({ url: `/pages/neighbor/report?reportId=${r.reportId}` })
}

onShow(() => load())
</script>

<style scoped>
.toAct {
  display: flex;
  align-items: center;
  gap: 14rpx;
  background: linear-gradient(120deg, #fff7ed, #fffdf8);
  border: 2rpx solid #f6e3c9;
  border-radius: 20rpx;
  padding: 20rpx 22rpx;
  margin-bottom: 18rpx;
}

.toAct--hover {
  opacity: 0.92;
}

.toAct__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.toAct__t {
  font-size: 25rpx;
  font-weight: 600;
  color: #a35c13;
}

.toAct__d {
  font-size: 18rpx;
  color: #b07a3f;
}

.toAct__chev {
  flex: none;
  font-size: 30rpx;
  color: #c99a63;
}

.hint {
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.hint__t {
  display: block;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  margin-bottom: 8rpx;
}

.hint__d {
  display: block;
  font-size: 19rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.nb {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.nb__thumb {
  flex: none;
  width: 104rpx;
  height: 104rpx;
  border-radius: 14rpx;
  background: linear-gradient(135deg, #dfe4ff, #eef6ff);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rpx;
}

.nb__thumb-n {
  font-size: 30rpx;
  color: var(--biz-primary);
  font-weight: 600;
}

.nb__thumb-k {
  font-size: 16rpx;
  color: var(--biz-primary);
  opacity: 0.7;
}

.nb__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.nb__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12rpx;
}

.nb__t {
  flex: 1;
  min-width: 0;
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.nb__d {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.nb__m {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.nb__chev {
  flex: none;
  font-size: 30rpx;
  color: var(--biz-text-4);
}

.wait {
  flex: none;
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.wait.is-warn {
  color: #a35c13;
}

.wait.is-bad {
  color: var(--biz-danger);
}

/* 房源卡片：审核只看图、价格与楼栋 —— 面积户型是档案派生的，业主改不了 */
.lst__top {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.lst__price {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--biz-danger);
}

.lst__type {
  flex: 1;
  min-width: 0;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.lst__t {
  display: block;
  margin-top: 8rpx;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.lst__d {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
  text-overflow: ellipsis;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.lst__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
  padding-top: 12rpx;
  border-top: 2rpx solid var(--biz-border-light);
}

.lst__s {
  font-size: 18rpx;
  color: var(--biz-text-4);
  background: var(--biz-bg-fill);
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}

.lst__ec {
  font-size: 18rpx;
  color: #a35c13;
}

.lst__esc {
  font-size: 18rpx;
  font-weight: 600;
  color: var(--biz-danger);
}

.rp__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.rp__reason {
  font-size: 17rpx;
  color: var(--biz-danger);
  background: #fff0f0;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}

.rp__t {
  display: block;
  margin-top: 10rpx;
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.rp__d {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--biz-text-3);
  line-height: 1.55;
}

.rp__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12rpx;
}

.rp__m {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.rp__s {
  font-size: 18rpx;
  color: #a35c13;
}

.tail {
  padding: 10rpx 4rpx 20rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}
</style>
