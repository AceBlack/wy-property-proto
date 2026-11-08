<template>
  <view class="page">
    <NavBar title="我的" :back="false" :subtitle="`演示日 ${DEMO.today}`" />

    <view class="body body--tab">
      <!-- 身份 -->
      <view class="card me">
        <view class="me__ava" :class="{ 'is-lead': persona?.lead }">
          <text>{{ persona?.name?.slice(0, 1) }}</text>
        </view>
        <view class="me__b">
          <view class="me__row">
            <text class="me__n">{{ persona?.name }}</text>
            <text class="me__role" :class="{ 'is-lead': persona?.lead }">{{ persona?.roleName }}</text>
          </view>
          <text class="me__m">{{ persona?.post }} · {{ persona?.orgName }}</text>
          <text class="me__no">工号 {{ persona?.empNo || '— （计划设定值，不在员工名册）' }}</text>
        </view>
        <view id="switch-identity" class="me__switch" @tap="switchSheet = true">切换</view>
      </view>

      <!-- 本月 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">{{ kpi.period }} 本月</text>
          <text class="sec-hd__d">完成率含已转工单（与 PC 达标率同口径）</text>
        </view>
        <view class="rate">
          <view class="rate__l">
            <text class="rate__n num">{{ rateText }}</text>
            <text class="rate__u">%</text>
          </view>
          <view class="rate__r">
            <text class="rate__k">应做 {{ kpi.monthTotal }} 单</text>
            <text class="rate__k">已完成 {{ kpi.monthDone }} 单</text>
          </view>
        </view>
        <view class="bar rate__bar"><view class="bar__in" :style="{ width: rateText + '%' }" /></view>
        <view class="grid3">
          <view class="g3">
            <text class="g3__n num">{{ kpi.todayOpen }}</text>
            <text class="g3__k">今日待办</text>
          </view>
          <view class="g3">
            <text class="g3__n num">{{ kpi.openTotal }}</text>
            <text class="g3__k">未完成</text>
          </view>
          <view class="g3">
            <text class="g3__n num" :class="{ danger: kpi.overdueTotal > 0 }">{{ kpi.overdueTotal }}</text>
            <text class="g3__k">已超时</text>
          </view>
        </view>
      </view>

      <!-- 待同步 -->
      <view v-if="app.pending.length" class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">待同步 {{ app.pending.length }} 条</text>
          <text class="sec-hd__d">{{ app.net === 'offline' ? '断网中，先存本机' : '可立即上传' }}</text>
        </view>
        <view v-for="p in app.pending" :key="p.id" class="pend">
          <view class="pend__b">
            <text class="pend__t">{{ p.planName }}</text>
            <text class="pend__d">{{ p.taskId }} · {{ p.at }}</text>
          </view>
          <text class="pend__s">待上传</text>
        </view>
        <view id="sync-now" class="btn btn--ghost pend__btn" @tap="onSync">{{ app.syncing ? '同步中…' : '立即同步' }}</view>
      </view>

      <!-- 个人自助：只看本人 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">个人</text>
          <text class="sec-hd__d">都是「本人」规则，看不到别人的</text>
        </view>
        <view
          v-for="e in selfEntries"
          :key="e.key"
          :id="`me-${e.key}`"
          class="lnk"
          hover-class="lnk--hover"
          @tap="go(e)"
        >
          <view class="lnk__b">
            <text class="lnk__t">{{ e.label }}</text>
            <text class="lnk__d">{{ e.desc }}</text>
          </view>
          <view class="lnk__chev" />
        </view>
      </view>

      <!-- 工具：和"个人"分开，通讯录看的不是自己的资料 -->
      <view v-if="canContacts" class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">工具</text>
          <text class="sec-hd__d">在职同事的联系方式</text>
        </view>
        <view id="me-contacts" class="lnk" hover-class="lnk--hover" @tap="goContacts">
          <view class="lnk__b">
            <text class="lnk__t">通讯录</text>
            <text class="lnk__d">按部门找人，直接拨号 / 复制号码</text>
          </view>
          <view class="lnk__chev" />
        </view>
      </view>

      <!-- 演示开关 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">演示开关</text>
          <text class="sec-hd__d">原型没有后端，网络状态手动切</text>
        </view>
        <view class="nchips">
          <view
            v-for="n in netOpts"
            :key="n.value"
            :id="'net-' + n.value"
            class="nchip"
            :class="[{ 'is-on': app.net === n.value }, n.value === 'offline' ? 'is-off' : '']"
            @tap="setNet(n.value)"
          >
            <text class="nchip__t">{{ n.label }}</text>
            <text class="nchip__d">{{ n.desc }}</text>
          </view>
        </view>
        <view class="what">
          <text class="what__k">三个状态分别影响什么</text>
          <text class="what__d">断网：提交进本地队列、列表打「待同步」、恢复网络自动上传；弱网：定位按人工打卡记；在线：正常写回任务。</text>
        </view>
        <view id="reset-local" class="btn btn--line reset" @tap="resetLocal">清除本机暂存（草稿 / 打卡 / 待同步）</view>
      </view>

      <!-- 数据对齐 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">与 PC 数字对齐</text>
          <text class="sec-hd__d">同一份 mock，不该出现两套算法</text>
        </view>
        <view class="chk">
          <view v-for="r in checks.rows" :key="r.label" class="chk__row">
            <text class="chk__k">{{ r.label }}</text>
            <view class="chk__vwrap">
              <text class="chk__v num">{{ r.live }}</text>
              <text v-if="r.changed" class="chk__mark">*</text>
            </view>
            <text class="chk__pc num">PC {{ r.pc }}</text>
            <text class="chk__s" :class="r.ok ? 'is-ok' : 'is-ng'">{{ r.ok ? '✓' : '✕' }}</text>
          </view>
        </view>
        <text class="chk__hint">
          数据来自 03-原型/src/mock，只读引用，改 PC 的数据这里会跟着变。
          <template v-if="checks.drifted">带 * 的 {{ checks.drifted }} 处是本次演示改的（内存态，刷新还原），✓ 仍按页面加载时的初始值判定。</template>
        </text>
      </view>

      <view id="logout" class="btn btn--line logout" @tap="onLogout">退出登录</view>

      <view class="ver">
        <text>员工端 P0 原型 · uni-app + Vue3 · 不接后端 · 写操作刷新即还原</text>
      </view>
    </view>

    <ActionSheet v-model:show="switchSheet" title="切换身份" :actions="switchActions" @select="onSwitch" />
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import { DEMO, PERSONAS } from '@/config/personas'
import { dataCheck, kpiOf } from '@/api/mobile'
import { CAP, can } from '@/config/personas'
import { app, login, logout, persona, setNet, syncPending } from '@/store/app'
import { confirm, toast, toastErr, toastOk } from '@/utils/ui'

const switchSheet = ref(false)
const ver = ref(0)

const kpi = computed(() => (ver.value, kpiOf(persona.value?.name || '')))
const rateText = computed(() => kpi.value.rate.toFixed(1))
const checks = computed(() => (ver.value, dataCheck()))

const selfEntries = computed(() => {
  const p = persona.value
  const list = []
  if (can(p, CAP.attendanceSelf)) list.push({ key: 'attendance', label: '我的考勤', desc: '月度确认与申诉', to: '/pages/attendance/index' })
  if (can(p, CAP.payrollSelf)) list.push({ key: 'payroll', label: '我的工资条', desc: '核算快照，只读', to: '/pages/payroll/index' })
  /* 提成只对抢单的维修岗有意义，别的岗位进去是空表 */
  if (can(p, CAP.woEdit) && (p.roleId === 'R-ENG' || p.post === '工程维修')) {
    list.push({ key: 'commission', label: '我的提成', desc: '按人工费计提，已收款才结', to: '/pages/payroll/commission' })
  }
  if (can(p, CAP.noticeRead)) list.push({ key: 'msg', label: '公告', desc: '本项目公告', tab: '/pages/msg/list' })
  /* 对外联系方式：只有会出现在租售页的岗位（楼管 / 项目经理 / 客服）才给入口 */
  if (can(p, CAP.listingView)) list.push({ key: 'contact', label: '我的联系方式', desc: '微信号与二维码，展示给看房者', to: '/pages/mine/contact' })
  return list
})

function go(e) {
  if (e.tab) uni.switchTab({ url: e.tab })
  else uni.navigateTo({ url: e.to })
}

const canContacts = computed(() => can(persona.value, CAP.contactsView))

function goContacts() {
  uni.navigateTo({ url: '/pages/contacts/index' })
}

const netOpts = [
  { label: '在线', desc: '默认', value: 'online' },
  { label: '弱网', desc: '定位降级', value: 'weak' },
  { label: '断网', desc: '本地暂存', value: 'offline' }
]

const switchActions = computed(() =>
  PERSONAS.map(p => ({ label: `${p.name} · ${p.post}`, desc: p.desc, value: p.id, active: p.id === app.personaId }))
)

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  ver.value++
})

function onSwitch(id) {
  if (id === app.personaId) return
  login(id)
  ver.value++
  toast('已切换身份')
}

async function onSync() {
  if (app.net === 'offline') {
    toastErr('仍是断网，先切回在线')
    return
  }
  const r = await syncPending()
  ver.value++
  if (r.ok) toastOk(`已同步 ${r.ok} 条`)
  else toastErr('没有可同步的内容')
}

async function resetLocal() {
  const ok = await confirm({
    title: '清除本机暂存',
    content: '会清掉草稿、打卡记录与待同步队列；任务数据本身在内存里，刷新页面即还原。',
    okText: '清除'
  })
  if (!ok) return
  app.drafts = {}
  app.checkins = {}
  app.pending = []
  uni.removeStorageSync('wy_emp_app_v1')
  ver.value++
  toast('已清除')
}

async function onLogout() {
  const ok = await confirm({ title: '退出登录', content: '退出后回到身份选择页，本机暂存保留。', okText: '退出' })
  if (!ok) return
  logout()
  uni.reLaunch({ url: '/pages/login/index' })
}
</script>

<style scoped>
.body--tab {
  padding-bottom: 40rpx;
}

.me {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.me__ava {
  width: 100rpx;
  height: 100rpx;
  border-radius: 28rpx;
  background: var(--biz-gradient);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 38rpx;
  font-weight: 600;
  flex: none;
}

.me__ava.is-lead {
  background: linear-gradient(135deg, #ff9f40 0%, #ffcf9b 100%);
}

.me__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5rpx;
}

.me__row {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.me__n {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.me__role {
  font-size: 19rpx;
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border: 2rpx solid var(--biz-primary-light-8);
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
}

.me__role.is-lead {
  color: var(--biz-warning);
  background: #fff8f0;
  border-color: rgba(255, 159, 64, 0.32);
}

.me__m {
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.me__no {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.me__switch {
  flex: none;
  font-size: 22rpx;
  color: var(--biz-primary);
  padding: 10rpx 20rpx;
  border-radius: 999rpx;
  background: var(--biz-primary-light-9);
}

.rate {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
}

.rate__l {
  display: flex;
  align-items: baseline;
  gap: 4rpx;
}

.rate__n {
  font-size: 72rpx;
  line-height: 1;
  color: var(--biz-text-1);
}

.rate__u {
  font-size: 24rpx;
  color: var(--biz-text-3);
}

.rate__r {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
}

.rate__k {
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.rate__bar {
  margin-top: 18rpx;
}

.grid3 {
  display: flex;
  margin-top: 24rpx;
  gap: 12rpx;
}

.g3 {
  flex: 1;
  background: var(--biz-bg-fill);
  border-radius: 16rpx;
  padding: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.g3__n {
  font-size: 36rpx;
  line-height: 1;
  color: var(--biz-text-1);
}

.g3__k {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.pend {
  display: flex;
  align-items: center;
  padding: 16rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.pend__b {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.pend__t {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.pend__d {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.pend__s {
  font-size: 20rpx;
  color: var(--biz-primary);
}

.pend__btn {
  margin-top: 20rpx;
  height: 76rpx;
  font-size: 26rpx;
}

.nchips {
  display: flex;
  gap: 12rpx;
}

.nchip {
  flex: 1;
  border-radius: 16rpx;
  padding: 18rpx 12rpx;
  background: var(--biz-bg-fill);
  border: 2rpx solid transparent;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;
}

.nchip.is-on {
  border-color: var(--biz-primary);
  background: var(--biz-primary-light-9);
}

.nchip.is-on.is-off {
  border-color: var(--biz-warning);
  background: #fff8f0;
}

.nchip__t {
  font-size: 26rpx;
  color: var(--biz-text-1);
  font-weight: 600;
}

.nchip__d {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.what {
  margin-top: 20rpx;
  padding: 18rpx;
  background: var(--biz-bg-fill);
  border-radius: 14rpx;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.what__k {
  font-size: 21rpx;
  font-weight: 600;
  color: var(--biz-text-2);
}

.what__d {
  font-size: 20rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.reset {
  margin-top: 20rpx;
  height: 76rpx;
  font-size: 25rpx;
}

.chk__row {
  display: flex;
  align-items: center;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.chk__k {
  flex: 1;
  font-size: 25rpx;
  color: var(--biz-text-2);
}

.chk__vwrap {
  width: 110rpx;
  display: flex;
  justify-content: flex-end;
  align-items: baseline;
}

.chk__v {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.chk__mark {
  font-size: 20rpx;
  color: var(--biz-warning);
  margin-left: 3rpx;
}

.chk__pc {
  width: 120rpx;
  text-align: right;
  font-size: 21rpx;
  color: var(--biz-text-4);
}

.chk__s {
  width: 40rpx;
  text-align: right;
  font-size: 24rpx;
}

.chk__s.is-ok {
  color: var(--biz-success);
}

.chk__s.is-ng {
  color: var(--biz-danger);
}

.chk__hint {
  display: block;
  margin-top: 14rpx;
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.lnk {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.lnk:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.lnk--hover {
  background: var(--biz-bg-hover);
}

.lnk__b {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.lnk__t {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.lnk__d {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.lnk__chev {
  width: 14rpx;
  height: 14rpx;
  border-top: 3rpx solid var(--biz-text-4);
  border-right: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
}

.logout {
  margin-top: 28rpx;
  height: 90rpx;
  color: var(--biz-danger);
  border-color: rgba(236, 77, 99, 0.24);
}

.ver {
  margin-top: 26rpx;
  text-align: center;
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}
</style>
