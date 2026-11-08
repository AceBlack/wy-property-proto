<template>
  <view class="page">
    <NavBar title="通讯录" :subtitle="`在职 ${summary.total} 人 · ${summary.orgCount} 个部门`" />

    <view class="body">
      <!-- 搜索：姓名 / 岗位 / 部门 / 手机后 4 位 -->
      <view class="search">
        <text class="search__ico">搜</text>
        <input
          id="ct-kw"
          v-model="kw"
          class="search__inp"
          confirm-type="search"
          placeholder="姓名 / 岗位 / 部门 / 手机后 4 位"
          placeholder-class="ph-txt"
        />
        <text v-if="kw" id="ct-clear" class="search__clear" @tap="kw = ''">✕</text>
      </view>

      <!-- 部门：一级 + 二级，已按人数排序；不铺三级班组 -->
      <view class="chips">
        <view
          id="ct-org-all"
          class="chip"
          :class="{ 'is-on': !orgId }"
          @tap="pickOrg('')"
        >
          全部
        </view>
        <view
          v-for="c in chips"
          :key="c.key"
          :id="`ct-org-${c.key}`"
          class="chip"
          :class="{ 'is-on': orgId === c.key, 'is-sub': c.depth === 2 }"
          @tap="pickOrg(c.key)"
        >
          {{ c.label }}
          <text class="chip__n num">{{ c.count }}</text>
        </view>
      </view>

      <text class="chips__hint">部门人数含下级班组；下拉分组标题里是直属人数</text>

      <view v-if="loading" class="tip">加载中…</view>

      <template v-else>
        <view v-for="g in groups" :key="g.orgId" class="group">
          <view class="group__hd">
            <text class="group__t">{{ g.orgName }}</text>
            <text class="group__n num">{{ g.rows.length }} 人</text>
          </view>

          <view
            v-for="p in g.rows"
            :key="p.empId"
            :id="`ct-${p.empId}`"
            class="p"
            hover-class="p--hover"
            @tap="openActions(p)"
          >
            <view class="p__ava" :class="{ 'is-me': p.empId === me }">{{ p.name.slice(0, 1) }}</view>
            <view class="p__b">
              <view class="p__top">
                <text class="p__n">{{ p.name }}</text>
                <text v-if="p.empId === me" class="p__me">我</text>
                <text class="p__pos">{{ p.position }}</text>
              </view>
              <text class="p__org">{{ p.orgName }}</text>
            </view>
            <view class="p__r">
              <text class="p__phone num" @tap.stop="call(p)">{{ p.phone || '未登记' }}</text>
              <text v-if="p.phone" class="p__copy" @tap.stop="copy(p)">复制</text>
            </view>
          </view>
        </view>

        <Empty v-if="!groups.length" text="没有匹配的同事" :sub="kw ? '换个关键字试试，手机号可以只输后 4 位' : '换个部门看看'" />
      </template>

      <view class="tail">
        <text>
          手机号在这里不脱敏：同事之间要联系，号码就是它的用途（与「员工档案」相反，那里看号是查隐私、要留痕）。
          通讯录只包含在职人员，薪资、证件、银行卡、紧急联系人不在返回里。
        </text>
      </view>
    </view>

    <!-- 点人：呼叫 / 复制 -->
    <ActionSheet
      v-model:show="sheet"
      :title="cur?.name || ''"
      :sub="cur ? `${cur.position} · ${cur.orgName}` : ''"
      :actions="actions"
      @select="onAction"
    />
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import ActionSheet from '@/components/ActionSheet.vue'
import { contactChips, contactsSummary, copyPhone, loadContacts, meEmpId } from '@/api/contacts'
import { toastErr } from '@/utils/ui'

const chips = contactChips()
const summary = contactsSummary()
const me = meEmpId()

const kw = ref('')
const orgId = ref('')
const loading = ref(true)
const groups = ref([])

const sheet = ref(false)
const cur = ref(null)

const actions = computed(() => [
  { label: '呼叫', desc: cur.value?.phone || '未登记号码', value: 'call' },
  { label: '复制号码', desc: '粘贴到微信 / 短信里发给他', value: 'copy' }
])

let timer = null
async function refresh() {
  loading.value = true
  try {
    const r = await loadContacts({ orgId: orgId.value, kw: kw.value })
    groups.value = r.groups
  } catch (e) {
    groups.value = []
    toastErr(e.message || '通讯录加载失败')
  } finally {
    loading.value = false
  }
}

/* 输入防抖：每敲一个字就查一次会把 mock 的 delay 叠成队列 */
watch(kw, () => {
  clearTimeout(timer)
  timer = setTimeout(refresh, 300)
})

function pickOrg(key) {
  if (orgId.value === key) return
  orgId.value = key
  refresh()
}

function openActions(p) {
  cur.value = p
  sheet.value = true
}

function onAction(v) {
  sheet.value = false
  const p = cur.value
  if (!p?.phone) {
    toastErr('这位同事没有登记手机号')
    return
  }
  if (v === 'call') call(p)
  else copy(p)
}

function call(p) {
  if (!p?.phone) return
  uni.makePhoneCall({ phoneNumber: String(p.phone) })
}

function copy(p) {
  copyPhone(p?.phone)
}

onLoad(() => refresh())
</script>

<style scoped>
.search {
  display: flex;
  align-items: center;
  gap: 10rpx;
  height: 76rpx;
  padding: 0 20rpx;
  background: #fff;
  border-radius: 16rpx;
  box-shadow: var(--biz-shadow-card);
}

.search__ico {
  flex: none;
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.search__inp {
  flex: 1;
  min-width: 0;
  height: 76rpx;
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.ph-txt {
  color: var(--biz-text-4);
}

.search__clear {
  flex: none;
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  background: var(--biz-bg-fill);
  color: var(--biz-text-3);
  font-size: 20rpx;
  text-align: center;
  line-height: 40rpx;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin: 18rpx 0;
}

.chip {
  display: flex;
  align-items: center;
  gap: 6rpx;
  height: 60rpx;
  padding: 0 18rpx;
  border-radius: 999rpx;
  background: #fff;
  border: 2rpx solid var(--biz-border);
  font-size: 22rpx;
  color: var(--biz-text-2);
}

.chip.is-sub {
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.chip.is-on {
  background: var(--biz-primary);
  border-color: var(--biz-primary);
  color: #fff;
}

.chip__n {
  font-size: 17rpx;
  color: var(--biz-text-4);
}

.chip.is-on .chip__n {
  color: rgba(255, 255, 255, 0.85);
}

.chips__hint {
  display: block;
  margin: -8rpx 4rpx 10rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.tip {
  display: block;
  padding: 40rpx 0;
  text-align: center;
  font-size: 22rpx;
  color: var(--biz-text-4);
}

.group {
  margin-bottom: 18rpx;
}

.group__hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 6rpx 4rpx 10rpx;
}

.group__t {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--biz-text-2);
}

.group__n {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.p {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: #fff;
  border-radius: 18rpx;
  padding: 18rpx 20rpx;
  margin-bottom: 10rpx;
  box-shadow: var(--biz-shadow-card);
}

.p--hover {
  background: var(--biz-bg-hover);
}

.p__ava {
  flex: none;
  width: 68rpx;
  height: 68rpx;
  border-radius: 50%;
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  font-size: 26rpx;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.p__ava.is-me {
  background: var(--biz-primary);
  color: #fff;
}

.p__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.p__top {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.p__n {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.p__me {
  font-size: 16rpx;
  color: #fff;
  background: var(--biz-primary);
  border-radius: 6rpx;
  padding: 1rpx 8rpx;
}

.p__pos {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.p__org {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.p__r {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
}

.p__phone {
  font-size: 23rpx;
  color: var(--biz-primary);
}

.p__copy {
  font-size: 18rpx;
  color: var(--biz-text-4);
  border: 2rpx solid var(--biz-border);
  border-radius: 8rpx;
  padding: 1rpx 10rpx;
}

.tail {
  padding: 10rpx 4rpx 20rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}
</style>
