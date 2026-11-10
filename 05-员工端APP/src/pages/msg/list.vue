<template>
  <view class="page">
    <NavBar title="消息" :back="false" :subtitle="`公告 ${rows.length} 条`" />

    <view class="body body--tab">
      <!-- 左「待办」是要动手的，右「未读」是要阅知的 —— 两个数分开，混成一个会被忽略 -->
      <view class="hd">
        <view class="hd__l" @tap="jump('remind')">
          <text class="hd__n num" :class="{ 'is-zero': !remind.total }">{{ remind.total }}</text>
          <text class="hd__k">待办</text>
        </view>
        <view class="hd__r" @tap="jump('all')">
          <text class="hd__n num" :class="{ 'is-zero': !unread }">{{ unread }}</text>
          <text class="hd__k">公告未读</text>
        </view>
      </view>

      <!-- 类型：横向滚动。项数会随身份变（有几天有审批、有几天没有），不能用平分 -->
      <scroll-view scroll-x class="tabs" :show-scrollbar="false">
        <view class="tabs__in">
          <view
            v-for="t in tabs"
            :key="t.key"
            :id="`ntab-${t.key}`"
            class="chip"
            :class="{ 'is-on': tab === t.key }"
            @tap="tab = t.key"
          >
            <text class="chip__t">{{ t.label }}</text>
            <text class="chip__n num">{{ t.count }}</text>
          </view>
        </view>
      </scroll-view>

      <!-- ---------------- 待办提醒 ---------------- -->
      <template v-if="tab === 'remind'">
        <view v-for="g in remind.groups" :key="g.key" class="grp">
          <view class="grp__hd">
            <text class="grp__t">{{ g.label }}</text>
            <text class="grp__n num">{{ g.count }}</text>
          </view>

          <view
            v-for="it in g.items"
            :id="`rm-${it.id}`"
            :key="it.id"
            class="rm"
            :class="`tone-${g.tone}`"
            hover-class="rm--hover"
            @tap="go(it.to)"
          >
            <view class="rm__hd">
              <text class="rm__tag" :class="`tg-${it.tagTone}`">{{ it.tag }}</text>
              <text class="rm__at num">{{ it.at }}</text>
            </view>
            <text class="rm__t">{{ it.title }}</text>
            <text class="rm__s">{{ it.sub }}</text>
            <text class="rm__go">去处理 ›</text>
          </view>

          <view v-if="g.more" class="grp__more" @tap="goGroup(g.key)">
            <text>还有 {{ g.more }} 条{{ g.label }}待办</text>
            <text>全部 ›</text>
          </view>
        </view>

        <Empty
          v-if="!remind.total"
          text="没有待办"
          sub="工单、巡检、审批、邻里、租售都清了，去看公告"
        />
      </template>

      <!-- ---------------- 公告 ---------------- -->
      <template v-else>
        <view
          v-for="n in filtered"
          :key="n.noticeId"
          :id="`nt-${n.noticeId}`"
          class="msg"
          :class="{ 'is-unread': !isNoticeRead(n.noticeId) }"
          hover-class="msg--hover"
          @tap="toggle(n)"
        >
          <view class="msg__hd">
            <view class="msg__tags">
              <text class="msg__type" :class="`tone-${noticeToneOf(n.type)}`">{{ n.type }}</text>
              <text v-if="n.top" class="msg__top">置顶</text>
              <text v-if="!n.communityId" class="msg__grp">集团</text>
            </view>
            <text class="msg__time">{{ n.publishTime }}</text>
          </view>
          <view class="msg__tb">
            <text v-if="!isNoticeRead(n.noticeId)" class="msg__dot" />
            <text class="msg__t">{{ n.title }}</text>
          </view>
          <text class="msg__d" :class="{ 'is-open': opened === n.noticeId }">{{ n.content }}</text>
          <view class="msg__ft">
            <text class="msg__p">{{ n.publisher }} 发布</text>
            <text class="msg__more">{{ opened === n.noticeId ? '收起' : '展开' }}</text>
          </view>
        </view>

        <Empty v-if="!filtered.length" :text="emptyText" :sub="emptySub" />
      </template>
    </view>
  </view>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Empty from '@/components/Empty.vue'
import {
  communityNameOf,
  loadTasks,
  noticeTabsOf,
  noticeToneOf,
  noticesOf
} from '@/api/mobile'
import { remindersOf } from '@/api/inbox'
import { isNoticeRead, markNoticeRead, persona } from '@/store/app'

const opened = ref('')
const tab = ref('all')
/** 首次进入才自动落到「待办」，之后尊重用户当前的选择 */
let inited = false

/* 只算「已发布 + 本项目 + 集团」的那批 —— 口径在 noticesOf 里，页面不重复判断 */
const rows = computed(() => noticesOf(persona.value?.communityId))
const filtered = computed(() => {
  if (tab.value === 'all' || tab.value === 'remind') return rows.value
  return rows.value.filter(n => n.type === tab.value)
})
const unread = computed(() => rows.value.filter(n => !isNoticeRead(n.noticeId)).length)
const communityLabel = computed(() => communityNameOf(persona.value?.communityId))

/* 待办提醒：工单 / 巡检 / 审批。聚合规则在 api/inbox.js，这里只负责显示 */
const remind = ref({ total: 0, groups: [] })

const tabs = computed(() => {
  const out = []
  if (remind.value.total) out.push({ key: 'remind', label: '待办', count: remind.value.total })
  out.push(...noticeTabsOf(rows.value))
  return out
})

const emptyText = computed(() => {
  if (!rows.value.length) return '本项目暂无公告'
  return `没有「${tab.value}」类型的公告`
})

const emptySub = computed(() =>
  rows.value.length
    ? `其他类型还有 ${rows.value.length} 条，切回「公告」看看`
    : '切到别的项目能看到别的公告'
)

onShow(async () => {
  /* 巡检已切 HTTP 取数，消息页要算巡检待办就得先把任务拉下来；
     mock 模式下这行等于没做 */
  try {
    await loadTasks(persona.value)
  } catch (e) {
    /* 取数失败不该让整页白掉 —— 公告照常显示，待办少一组而已 */
  }
  remind.value = await remindersOf(persona.value)
  /*
   * 有活要干时**首次进入**落在「待办」：进消息页的第一诉求是"有没有事"。
   * 只在首次做 —— 从工单详情返回会再触发一次 onShow，那会儿把人拽回待办很烦。
   *
   * `persona.value` 的判断不能省：刷新后 personaId 是从 storage 异步恢复的，
   * 第一次 onShow 时可能还是 null（remindersOf 于是返回 0）。
   * 提前把 inited 置掉，就再也不会切到待办 —— 实测徐悦就是这样卡在公告页的。
   */
  if (!inited && persona.value) {
    inited = true
    if (remind.value.total) tab.value = 'remind'
  }
})

/**
 * 切身份后本项目可能一条「收费通知」都没有，此时页签会少一项，
 * 而 tab 还停在旧值上 —— 列表空着、页签也找不到，看着像坏了。
 */
watch(tabs, list => {
  if (!list.some(t => t.key === tab.value)) tab.value = list[0]?.key || 'all'
})

/** 展开即视为已读：这个 App 里「看」的唯一动作就是展开，没有另设「标为已读」按钮 */
function toggle(n) {
  const next = opened.value === n.noticeId ? '' : n.noticeId
  opened.value = next
  if (next) markNoticeRead(n.noticeId)
}

/**
 * tabBar 上的页面只能用 switchTab 跳 —— 用 navigateTo 会静默失败，
 * 表现是"点了没反应"。工单列表与任务列表都在 tabBar 上，实测踩过这个坑。
 */
const TAB_PAGES = ['/pages/wo/list', '/pages/tasks/list']

function go(url) {
  if (TAB_PAGES.includes(url)) {
    uni.switchTab({ url })
    return
  }
  uni.navigateTo({ url })
}

/** 「还有 N 条」跳到该域自己的列表页，不在消息页做假分页 */
function goGroup(key) {
  const TO = {
    wo: '/pages/wo/list',
    insp: '/pages/tasks/list',
    oa: '/pages/oa/list',
    nb: '/pages/neighbor/todo',
    ls: '/pages/listing/viewing'
  }
  if (TO[key]) go(TO[key])
}

/** 顶部两个数字可以点，直接切到对应页签 */
function jump(key) {
  if (tabs.value.some(t => t.key === key)) tab.value = key
}
</script>

<style scoped>
.body--tab {
  padding-bottom: 40rpx;
}

.hd {
  display: flex;
  background: #fff;
  border-radius: 22rpx;
  padding: 26rpx;
  box-shadow: var(--biz-shadow-card);
  margin-bottom: 20rpx;
}

.hd__l,
.hd__r {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.hd__r {
  align-items: flex-end;
  border-left: 2rpx solid var(--biz-border-light);
  padding-left: 24rpx;
}

.hd__n {
  font-size: 48rpx;
  line-height: 1;
  color: var(--biz-primary);
}

.hd__n.is-zero {
  color: var(--biz-text-4);
}

.hd__r .hd__n {
  color: var(--biz-text-1);
}

.hd__k {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

/* ---------- 类型页签 ---------- */
.tabs {
  white-space: nowrap;
  margin-bottom: 20rpx;
}

.tabs__in {
  display: inline-flex;
  gap: 12rpx;
  padding: 2rpx 2rpx 6rpx;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  flex: none;
  height: 60rpx;
  padding: 0 20rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.85);
  border: 2rpx solid var(--biz-border-light);
}

.chip.is-on {
  background: var(--biz-primary-light-9);
  border-color: var(--biz-primary-light-8);
}

.chip__t {
  font-size: 23rpx;
  color: var(--biz-text-2);
}

.chip.is-on .chip__t {
  color: var(--biz-primary);
  font-weight: 600;
}

.chip__n {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.chip.is-on .chip__n {
  color: var(--biz-primary);
}

/* ---------- 待办分组 ---------- */
.grp {
  margin-bottom: 24rpx;
}

.grp__hd {
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  padding: 0 8rpx 12rpx;
}

.grp__t {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.grp__n {
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.grp__more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.7);
  border: 2rpx dashed var(--biz-border-light);
  font-size: 22rpx;
  color: var(--biz-primary);
}

/* ---------- 待办卡片 ---------- */
.rm {
  position: relative;
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx 22rpx 30rpx;
  margin-bottom: 14rpx;
  box-shadow: var(--biz-shadow-card);
  border-left: 6rpx solid var(--biz-border-light);
}

.rm--hover {
  background: var(--biz-bg-hover);
}

.rm.tone-info {
  border-left-color: var(--biz-info);
}

.rm.tone-ok {
  border-left-color: var(--biz-success);
}

.rm.tone-warn {
  border-left-color: var(--biz-warning);
}

.rm__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rm__tag {
  font-size: 19rpx;
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
  border: 2rpx solid transparent;
}

.tg-danger {
  color: var(--biz-danger);
  background: #fef2f2;
  border-color: #fecaca;
}

.tg-warn {
  color: #b45309;
  background: #fff7ed;
  border-color: #fed7aa;
}

.tg-info {
  color: var(--biz-info);
  background: #eff6ff;
  border-color: #bfdbfe;
}

.rm__at {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.rm__t {
  display: block;
  margin-top: 12rpx;
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.4;
}

.rm__s {
  display: block;
  margin-top: 6rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.55;
}

.rm__go {
  display: block;
  margin-top: 10rpx;
  font-size: 21rpx;
  color: var(--biz-primary);
  text-align: right;
}

/* ---------- 公告卡片 ---------- */
.msg {
  background: #fff;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: var(--biz-shadow-card);
  border-left: 6rpx solid transparent;
}

/* 未读的左侧立一条主色：扫一眼就知道哪几条还没看 */
.msg.is-unread {
  border-left-color: var(--biz-primary);
}

.msg--hover {
  background: var(--biz-bg-hover);
}

.msg__hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
}

.msg__tags {
  display: flex;
  align-items: center;
  gap: 8rpx;
  min-width: 0;
}

.msg__type,
.msg__top,
.msg__grp {
  font-size: 19rpx;
  border-radius: 999rpx;
  padding: 3rpx 12rpx;
  border: 2rpx solid transparent;
  flex: none;
}

.tone-warn {
  color: #b45309;
  background: #fff7ed;
  border-color: #fed7aa;
}

.tone-danger {
  color: var(--biz-danger);
  background: #fef2f2;
  border-color: #fecaca;
}

.tone-info {
  color: var(--biz-info);
  background: #eff6ff;
  border-color: #bfdbfe;
}

.tone-ok {
  color: var(--biz-success);
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.tone-plain {
  color: var(--biz-text-3);
  background: #f5f7fa;
  border-color: #e5e9f0;
}

.msg__top {
  color: var(--biz-danger);
  background: #fef2f2;
  border-color: #fecaca;
}

.msg__grp {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-color: var(--biz-primary-light-8);
}

.msg__time {
  font-size: 20rpx;
  color: var(--biz-text-4);
  font-family: var(--biz-font-num);
  flex: none;
}

.msg__tb {
  display: flex;
  align-items: center;
  gap: 10rpx;
  margin-top: 14rpx;
}

.msg__dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: var(--biz-primary);
  flex: none;
}

.msg__t {
  flex: 1;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.4;
}

.msg__d {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.msg__d.is-open {
  display: block;
  -webkit-line-clamp: unset;
}

.msg__ft {
  margin-top: 14rpx;
  padding-top: 12rpx;
  border-top: 2rpx dashed var(--biz-border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.msg__p {
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.msg__more {
  font-size: 20rpx;
  color: var(--biz-primary);
}
</style>
