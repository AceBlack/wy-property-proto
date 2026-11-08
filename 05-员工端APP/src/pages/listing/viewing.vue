<template>
  <view class="page">
    <NavBar title="看房请求" :subtitle="`待联系 ${pending} · 超时 ${overdue}`" />

    <view class="body">
      <view class="hint">
        <text class="hint__t">这个模块只有一件事：回电话</text>
        <text class="hint__d">
          访客的号码是唯一的联系线索 —— 我们不对外给楼管手机号，所以楼管不回，这条线索就死了，
          而且访客记住的是「物业发信息没人理」。
        </text>
      </view>

      <Segmented v-model="tab" :items="tabs" id-prefix="lv-" />

      <view
        v-for="v in rows"
        :key="v.viewingId"
        :id="`lv-view-${v.viewingId}`"
        class="card vw"
        :class="{ 'is-over': v.overdue }"
        hover-class="card--hover"
        @tap="openSheet(v)"
      >
        <view class="vw__top">
          <text class="vw__n">{{ v.name }}</text>
          <text class="vw__ph num">{{ v.phone }}</text>
          <text class="wait num" :class="v.tone">{{ v.wait }}</text>
        </view>
        <text class="vw__d">
          {{ v.communityName }} {{ v.buildingName }} · {{ v.houseType }} · ¥{{ v.price }}/月
        </text>
        <text class="vw__t">想看时间：{{ v.preferredTime }}</text>
        <text v-if="v.note" class="vw__note">「{{ v.note }}」</text>

        <view class="vw__foot">
          <text v-if="v.escalated" class="vw__esc">超 48 小时 · 已升级到上级</text>
          <text v-else-if="v.overdue" class="vw__over">超 24 小时未联系</text>
          <text v-else-if="v.status !== '待联系'" class="vw__done">
            {{ v.status }} · {{ v.handledBy }}
          </text>
          <text v-else class="vw__ok">待联系</text>
          <view v-if="v.status === '待联系'" :id="`lv-call-${v.viewingId}`" class="vw__btn" @tap.stop="doCall(v)">
            拨打
          </view>
        </view>
      </view>

      <Empty v-if="!rows.length && !loading" :text="emptyText" sub="超时的会排在最前面" />

      <view class="tail">
        <text>
          名单按「责任楼管」收敛：挂牌归谁管，看房请求就归谁回。
          换个楼管不会把请求带走 —— 那是 PC 的改派动作。
        </text>
      </view>
    </view>

    <!-- 处理：拨完就能就地记一句结果 -->
    <Sheet v-model:show="sheet" title="记录联系结果" :sub="cur ? `${cur.name} · ${cur.phoneFull || cur.phone}` : ''" max-height="76vh">
      <view v-if="cur" class="det">
        <view class="det__row"><text class="det__k">方便时间</text><text class="det__v">{{ cur.preferredTime }}</text></view>
        <view class="det__row"><text class="det__k">房源</text><text class="det__v">{{ cur.communityName }} {{ cur.buildingName }} · {{ cur.houseType }} · ¥{{ cur.price }}/月</text></view>
        <view v-if="cur.note" class="det__row"><text class="det__k">留言</text><text class="det__v">{{ cur.note }}</text></view>
        <view class="det__row"><text class="det__k">已等</text><text class="det__v" :class="cur.tone">{{ cur.wait }}</text></view>
      </view>

      <view id="lv-call-sheet" class="btn btn--line dial" @tap="doCall(cur)">拨打 {{ cur?.phoneFull || cur?.phone }}</view>

      <text class="fld__k">结果（必填，下个人接手要知道聊到哪了）</text>
      <view class="picks">
        <view
          v-for="(p, i) in PICKS"
          :key="p"
          :id="`lv-pick-${i}`"
          class="pick"
          @tap="pickNote(p)"
        >
          {{ p }}
        </view>
      </view>
      <textarea
        id="lv-result"
        v-model="note"
        class="textarea"
        :maxlength="100"
        placeholder="例如：已电话联系，约周六上午 10 点带看"
        placeholder-class="ph-txt"
      />

      <view class="acts">
        <view id="lv-close-case" class="btn btn--line acts__b" @tap="submit('已关闭')">打不通 / 不需要</view>
        <view id="lv-contacted" class="btn btn--primary acts__b" @tap="submit('已联系')">已联系</view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Segmented from '@/components/Segmented.vue'
import Empty from '@/components/Empty.vue'
import Sheet from '@/components/Sheet.vue'
import { contactViewing, viewingOf, viewingsOf } from '@/api/listing'
import { CAP, can } from '@/config/personas'
import { persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

/* 现场三句话最常用，点一下填进输入框再改 —— 比从零打字快 */
const PICKS = ['已电话联系，约好时间带看', '电话打不通，稍后再试', '客户说暂时不看了']

const tab = ref('待联系')
const all = ref([])
const loading = ref(true)
const sheet = ref(false)
const cur = ref(null)
const note = ref('')

const canHandle = computed(() => can(persona.value, CAP.listViewing))
/* 页签切换只做本地过滤：切换不该再打一次接口，两个数字也要同时准确 */
const rows = computed(() => all.value.filter(v => v.status === tab.value))
const pending = computed(() => all.value.filter(v => v.status === '待联系').length)
const overdue = computed(() => all.value.filter(v => v.overdue).length)
const emptyText = computed(() =>
  tab.value === '待联系' ? '名下没有待联系的看房请求' : '还没有联系过的记录'
)

const tabs = computed(() => [
  { key: '待联系', label: '待联系', count: pending.value },
  { key: '已联系', label: '已联系', count: all.value.length - pending.value }
])

async function load() {
  loading.value = true
  try {
    /* 一次拉全量再本地分段：切换页签不该再打一次接口，超时数字也要能同时显示 */
    all.value = await viewingsOf(persona.value, { status: '' })
  } catch (e) {
    all.value = []
    toastErr(e.message || '看房请求加载失败')
  } finally {
    loading.value = false
  }
}

async function doCall(v) {
  if (!v) return
  try {
    const full = v.phoneFull ? v : await viewingOf(v.viewingId)
    const phone = full?.phoneFull || full?.phone || v.phone
    uni.makePhoneCall({ phoneNumber: String(phone) })
  } catch (e) {
    toastErr(e.message || '取号码失败')
  }
}

function openSheet(v) {
  if (v.status !== '待联系') {
    toastErr(`「${v.status}」的请求不用再处理`)
    return
  }
  if (!canHandle.value) return toastErr('当前账号不能处理看房请求')
  cur.value = v
  note.value = ''
  sheet.value = true
}

function pickNote(p) {
  note.value = p
}

async function submit(status) {
  const v = cur.value
  if (!v) return
  const text = note.value.trim()
  if (!text) return toastErr('要写一句联系结果')
  try {
    await contactViewing(persona.value, v.viewingId, { status, note: text })
    sheet.value = false
    toastOk(status === '已联系' ? '已标记，结果已记录' : '已关闭这条请求')
    load()
  } catch (e) {
    toastErr(e.message || '记录失败')
  }
}

onShow(() => load())
</script>

<style scoped>
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

.vw {
  border-left: 6rpx solid transparent;
}

/* 超时的卡片必须一眼看到：左边红条 + 号码变红 */
.vw.is-over {
  border-left-color: var(--biz-danger);
}

.vw__top {
  display: flex;
  align-items: baseline;
  gap: 12rpx;
}

.vw__n {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.vw__ph {
  font-size: 22rpx;
  color: var(--biz-text-2);
}

.wait {
  margin-left: auto;
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.wait.is-warn {
  color: #a35c13;
}

.wait.is-bad {
  color: var(--biz-danger);
  font-weight: 600;
}

.vw__d {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.vw__t {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--biz-text-2);
}

.vw__note {
  display: block;
  margin-top: 8rpx;
  padding: 10rpx 14rpx;
  border-radius: 10rpx;
  background: var(--biz-bg-fill);
  font-size: 19rpx;
  color: var(--biz-text-2);
  line-height: 1.55;
}

.vw__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14rpx;
}

.vw__over {
  font-size: 18rpx;
  color: #a35c13;
}

.vw__esc {
  font-size: 18rpx;
  font-weight: 600;
  color: var(--biz-danger);
}

.vw__ok {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.vw__done {
  font-size: 18rpx;
  color: var(--biz-accent-dark);
}

.vw__btn {
  flex: none;
  height: 56rpx;
  padding: 0 26rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: var(--biz-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 2rpx var(--biz-primary);
  display: flex;
  align-items: center;
}

.det {
  background: var(--biz-bg-fill);
  border-radius: 14rpx;
  padding: 14rpx 18rpx;
}

.det__row {
  display: flex;
  align-items: baseline;
  gap: 14rpx;
  padding: 6rpx 0;
}

.det__k {
  flex: none;
  width: 110rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.det__v {
  flex: 1;
  font-size: 20rpx;
  color: var(--biz-text-2);
  line-height: 1.5;
}

.det__v.is-bad {
  color: var(--biz-danger);
  font-weight: 600;
}

.det__v.is-warn {
  color: #a35c13;
}

.dial {
  width: 100%;
  height: 80rpx;
  margin-top: 16rpx;
  font-size: 26rpx;
}

.fld__k {
  display: block;
  font-size: 20rpx;
  color: var(--biz-text-3);
  margin: 18rpx 0 10rpx;
}

.picks {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-bottom: 10rpx;
}

.pick {
  font-size: 19rpx;
  color: var(--biz-text-2);
  background: var(--biz-bg-fill);
  border-radius: 8rpx;
  padding: 8rpx 14rpx;
}

.ph-txt {
  color: var(--biz-text-4);
}

.acts {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.acts__b {
  flex: 1;
  height: 84rpx;
  font-size: 26rpx;
}

.tail {
  padding: 10rpx 4rpx 20rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}
</style>
