<template>
  <view class="page">
    <NavBar title="房源审核" :subtitle="d?.listingId || ''" />

    <view v-if="!d" class="body">
      <Empty text="挂牌不存在或已处理" sub="回到待办列表刷新一下" />
    </view>

    <view v-else class="body body--with-foot">
      <!-- 图：原型用色块 + 张数，不假装有图 -->
      <view class="imgs">
        <view v-for="n in Math.max(1, Math.min(3, d.images || 1))" :key="n" class="imgs__i" :class="`imgs__i--${n}`">
          <text class="imgs__n">图 {{ n }}</text>
        </view>
        <text v-if="!d.images" class="imgs__note">没有图片 —— 租售挂牌必须有实拍图，这种直接驳回</text>
      </view>

      <view class="card">
        <view class="top">
          <text class="price num">¥{{ d.price }}</text>
          <text class="unit">/月</text>
          <text v-if="d.deposit" class="dep num">押 {{ d.deposit }}</text>
          <text class="badge" :class="`is-${statusType}`">{{ d.status }}</text>
        </view>
        <view class="meta">
          <text>{{ d.payTerm }}</text>
          <text class="dot">·</text>
          <text>{{ d.decorate }}</text>
          <text class="dot">·</text>
          <text>{{ d.availableFrom }} 起可租</text>
        </view>
        <text v-if="d.desc" class="desc">{{ d.desc }}</text>
      </view>

      <!-- 只给四样：图、价格描述、房号楼栋、产权已核验。面积户型楼层是档案派生的，不用核 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">房屋</text>
          <text class="sec-hd__d">档案派生，不用核对</text>
        </view>
        <view class="kv"><text class="kv__k">房号</text><text class="kv__v num">{{ d.communityName }} {{ d.buildingName }} {{ d.room }}</text></view>
        <view class="kv">
          <text class="kv__k">产权</text>
          <text v-if="d.certified" class="kv__v ok">产权人已核验 ✓</text>
          <text v-else class="kv__v warn">产权未核验 —— 后台发布时未通过校验，先驳回</text>
        </view>
      </view>

      <view class="note">
        <text class="note__t">审核只看图</text>
        <text class="note__d">
          判断标准就一句：<text class="note__q">这张图能不能让陌生人找到这户人家</text>。能，就驳回。
        </text>
        <view class="chk">
          <text v-for="(c, i) in CHECKS" :key="i" class="chk__i">· {{ c }}</text>
        </view>
        <text class="note__f">
          产权关系后台已经校验过（发布人必须是业主本人），手机上不再判一次 ——
          让楼管在手机上核对产权，等于把已做对的校验再做一遍，还容易看错。
        </text>
      </view>

      <view v-if="d.status !== '待审核'" class="done">
        <text class="done__t">这条已经处理过（{{ d.status }}）</text>
        <text v-if="d.rejectReason" class="done__d">驳回理由：{{ d.rejectReason }}</text>
        <text v-else-if="d.auditAt" class="done__d">{{ d.auditBy }} 于 {{ d.auditAt }} 处理</text>
      </view>
    </view>

    <view v-if="d && d.status === '待审核'" class="footbar">
      <view id="lv-reject" class="btn btn--line foot-btn" @tap="openReject">驳回</view>
      <view id="lv-pass" class="btn btn--primary foot-btn" @tap="pass">通过并公开</view>
    </view>

    <view v-else-if="d" class="footbar">
      <view class="btn foot-btn btn--disabled">已处理，无需再审</view>
    </view>

    <Sheet v-model:show="rejectSheet" title="驳回理由" sub="业主看得到这句，也会拿着它来问" max-height="76vh">
      <view class="reasons">
        <view
          v-for="(r, i) in REASONS"
          :key="r"
          :id="`lv-reason-${i}`"
          class="reason"
          :class="{ 'is-on': reason === r }"
          @tap="reason = r"
        >
          {{ r }}
        </view>
      </view>
      <text class="fld__k">补充说明（会一并给业主）</text>
      <textarea
        id="lv-note"
        v-model="note"
        class="textarea"
        :maxlength="80"
        placeholder="例如：第 3 张图拍到了门牌号，请删掉或打码后重新提交"
        placeholder-class="ph-txt"
      />
      <view id="lv-reject-ok" class="btn btn--primary foot-full" @tap="reject">确认驳回</view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import Sheet from '@/components/Sheet.vue'
import { audit, listingOf } from '@/api/listing'
import { CAP, can } from '@/config/personas'
import { persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

/* 驳回理由给成可选项而不是空白输入框：现场打字慢，且理由要能对得上审核口径 */
const REASONS = [
  '图片拍到了门牌号',
  '图片能定位到具体楼栋（邻居家门 / 楼道特征）',
  '疑似网图，非本房实拍',
  '图片含证件 / 家庭合照',
  '价格或描述与实际不符',
  '疑似中介发布，未证实为产权人'
]

const CHECKS = [
  '门牌号、邻居家门有没有入镜',
  '楼道、窗外能不能认出是哪一栋',
  '有没有家庭合照、证件、快递单',
  '是不是网图（光线、角度、水印对不上）'
]

const listingId = ref('')
const d = ref(null)
const rejectSheet = ref(false)
const reason = ref('')
const note = ref('')

const canAudit = computed(() => can(persona.value, CAP.listingAudit))
const statusType = computed(() => {
  const s = d.value?.status
  if (s === '待审核') return 'warning'
  if (s === '已发布') return 'success'
  if (s === '已驳回') return 'danger'
  return 'info'
})

async function load() {
  try {
    d.value = await listingOf(listingId.value)
  } catch (e) {
    d.value = null
    toastErr(e.message || '挂牌加载失败')
  }
}

function openReject() {
  reason.value = ''
  note.value = ''
  rejectSheet.value = true
}

async function pass() {
  if (!canAudit.value) return toastErr('当前账号没有审核房源的权限')
  try {
    await audit(persona.value, listingId.value, { pass: true })
    toastOk('已通过，业主端立刻可见')
    load()
  } catch (e) {
    toastErr(e.message || '审核失败')
  }
}

async function reject() {
  if (!reason.value) return toastErr('请选一条驳回理由')
  try {
    /* 预设理由 + 补充说明合成一句：业主看到的是一条完整的话，不是两个字段 */
    const why = note.value.trim() ? `${reason.value}；${note.value.trim()}` : reason.value
    await audit(persona.value, listingId.value, { pass: false, reason: why })
    rejectSheet.value = false
    toastOk('已驳回，业主会看到理由')
    load()
  } catch (e) {
    toastErr(e.message || '驳回失败')
  }
}

onLoad(o => {
  listingId.value = o.listingId || ''
  load()
})
</script>

<style scoped>
.imgs {
  display: flex;
  gap: 12rpx;
  margin-bottom: 20rpx;
}

.imgs__i {
  flex: 1;
  height: 180rpx;
  border-radius: 16rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #dfe4ff, #eef6ff);
}

.imgs__i--2 {
  background: linear-gradient(135deg, #e6faf3, #f2fffb);
}

.imgs__i--3 {
  background: linear-gradient(135deg, #fff7ed, #fffdf8);
}

.imgs__n {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.imgs__note {
  font-size: 19rpx;
  color: var(--biz-danger);
  line-height: 1.6;
}

.top {
  display: flex;
  align-items: baseline;
  gap: 8rpx;
  flex-wrap: wrap;
}

.price {
  font-size: 38rpx;
  font-weight: 600;
  color: var(--biz-danger);
}

.unit {
  font-size: 20rpx;
  color: var(--biz-danger);
}

.dep {
  margin-left: 8rpx;
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.badge {
  margin-left: auto;
  font-size: 17rpx;
  border-radius: 6rpx;
  padding: 2rpx 10rpx;
}

.badge.is-warning {
  color: #a35c13;
  background: #fff7ed;
}

.badge.is-success {
  color: var(--biz-accent-dark);
  background: #e6faf3;
}

.badge.is-danger {
  color: var(--biz-danger);
  background: #fff0f0;
}

.badge.is-info {
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
}

.meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 10rpx;
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
  font-size: 21rpx;
  color: var(--biz-text-2);
  line-height: 1.65;
}

.sec-hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 8rpx;
}

.sec-hd__t {
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.sec-hd__d {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.kv {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding: 8rpx 0;
}

.kv__k {
  flex: none;
  width: 90rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.kv__v {
  flex: 1;
  font-size: 22rpx;
  color: var(--biz-text-1);
}

.kv__v.ok {
  color: var(--biz-accent-dark);
  font-weight: 600;
}

.kv__v.warn {
  color: #a35c13;
}

.note {
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.note__t {
  display: block;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  margin-bottom: 10rpx;
}

.note__d {
  display: block;
  font-size: 20rpx;
  color: var(--biz-text-2);
  line-height: 1.6;
}

.note__q {
  font-weight: 600;
  color: var(--biz-primary);
}

.chk {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
  margin: 12rpx 0;
  padding: 12rpx 16rpx;
  border-radius: 14rpx;
  background: var(--biz-bg-fill);
}

.chk__i {
  font-size: 19rpx;
  color: var(--biz-text-2);
  line-height: 1.5;
}

.note__f {
  display: block;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.done {
  background: var(--biz-bg-fill);
  border-radius: 16rpx;
  padding: 18rpx 20rpx;
}

.done__t {
  display: block;
  font-size: 22rpx;
  color: var(--biz-text-2);
  font-weight: 600;
}

.done__d {
  display: block;
  margin-top: 6rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.55;
}

.reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 8rpx;
}

.reason {
  font-size: 21rpx;
  color: var(--biz-text-2);
  background: var(--biz-bg-fill);
  border-radius: 10rpx;
  padding: 12rpx 16rpx;
  line-height: 1.45;
}

.reason.is-on {
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 2rpx var(--biz-primary);
}

.fld__k {
  display: block;
  font-size: 22rpx;
  color: var(--biz-text-3);
  margin: 14rpx 0 10rpx;
}

.ph-txt {
  color: var(--biz-text-4);
}

.foot-btn {
  flex: 1;
  height: 88rpx;
  font-size: 28rpx;
}

.foot-full {
  width: 100%;
  height: 88rpx;
  margin-top: 22rpx;
  font-size: 28rpx;
}
</style>
