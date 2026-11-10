<template>
  <view class="page">
    <NavBar title="转工单" :subtitle="taskId" />

    <view v-if="created" class="body">
      <view class="card ok">
        <view class="ok__i">✓</view>
        <text class="ok__t">工单已生成</text>
        <text class="ok__no num">{{ created.woNo }}</text>
        <view class="ok__meta">
          <text>{{ created.type }} · {{ created.priority }}</text>
          <text class="dot">·</text>
          <text>{{ created.status }}</text>
        </view>
      </view>

      <view class="banner banner--info">
        <text class="banner__ico"><text>i</text></text>
        <view class="banner__bd">
          <text class="banner__t">接下来会怎样</text>
          <text class="banner__d">
            工单进了 {{ created.priority === '特急' ? '4' : created.priority === '紧急' ? '8' : '24' }} 小时 SLA 的待派单池，由工程组接手。
            巡检任务本身还没提交 —— 回去把剩下几项判完再交，否则完成率会少一单。
          </text>
        </view>
      </view>

      <view class="acts">
        <view id="back-exec" class="btn btn--primary" @tap="backExec">继续逐项判定</view>
        <view id="view-wo" class="btn btn--line" @tap="viewWo">查看这张工单</view>
      </view>
    </view>

    <view v-else class="body body--with-foot">
      <view class="card src">
        <view class="src__top">
          <text class="src__tag">来自巡检</text>
          <text class="src__no num">{{ taskId }}</text>
        </view>
        <text class="src__t">{{ draftItem?.label || '—' }}</text>
        <view class="src__meta">
          <text>{{ task?.planName || '—' }}</text>
          <text class="dot">·</text>
          <text>{{ communityLabel }}</text>
          <text class="dot">·</text>
          <text>{{ task?.post || '公区' }}点位</text>
        </view>
        <view v-if="draftItem?.reason" class="src__reason">
          <text class="src__reason-k">问题类型</text>
          <text class="src__reason-v">{{ draftItem.reason }}</text>
        </view>
      </view>

      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">工单类型</text></view>
        <view class="chips">
          <text
            v-for="t in TYPES"
            :key="t"
            :id="`type-${t}`"
            class="chip"
            :class="{ 'is-on': type === t }"
            @tap="type = t"
          >{{ t }}</text>
        </view>

        <view class="sec-hd" style="margin-top: 24rpx"><text class="sec-hd__t">紧急度</text></view>
        <view class="chips">
          <text
            v-for="p in PRIORITIES"
            :key="p"
            :id="`pri-${p}`"
            class="chip"
            :class="[{ 'is-on': priority === p }, p === '特急' ? 'is-urgent' : '']"
            @tap="priority = p"
          >{{ p }}</text>
        </view>
        <text class="hintline">特急 4 小时、紧急 8 小时、普通 24 小时 SLA；等级选高了会压到工程组的响应指标。</text>
      </view>

      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">工单标题</text></view>
        <input v-model="title" class="input" :maxlength="40" placeholder="一句话说清是什么问题" placeholder-class="ph-txt" />

        <view class="sec-hd" style="margin-top: 22rpx">
          <text class="sec-hd__t">现场描述</text>
          <text class="sec-hd__d">现象 + 位置，工程组不用再打电话问</text>
        </view>
        <textarea
          v-model="description"
          class="textarea"
          :maxlength="160"
          placeholder="例：3 号楼大堂地砖有大片油渍，已放置警示牌，需要专业清洗"
          placeholder-class="ph-txt"
        />

        <view class="row">
          <text class="row__k">现场照片</text>
          <text class="row__d">{{ photos.length }}/3 · 随巡检记录一起留证</text>
        </view>
        <PhotoPicker v-model="photos" :max="3" />
      </view>

      <view class="card">
        <view class="sec-hd"><text class="sec-hd__t">位置</text></view>
        <Cell label="项目" :value="communityLabel" />
        <Cell label="点位" :value="`${task?.post || '公区'}责任区 · 巡检点位`" />
        <Cell label="关联任务" :value="task?.planName || '—'" :last="true" />
      </view>

      <view class="tail">
        <text>转单不改巡检任务的状态：先把这张单派出去，再回去把剩下几项判完提交。</text>
      </view>
    </view>

    <view v-if="!created" class="footbar">
      <view class="foot-num">
        <text class="foot-num__p" :class="{ 'is-urgent': priority === '特急' }">{{ priority }}</text>
        <text class="foot-num__d">SLA {{ slaHours }} 小时</text>
      </view>
      <view id="wo-create-submit" class="btn btn--primary foot-btn" :class="{ 'btn--disabled': !canSubmit }" @tap="submit">
        生成工单
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Cell from '@/components/Cell.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { WOCREATE_PRIORITY, WOCREATE_TYPES, createFromInspection } from '@/api/wo'
import { communityNameOf, execData, loadTaskExec, taskOf } from '@/api/mobile'
import { app, getDraft, persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const TYPES = WOCREATE_TYPES
const PRIORITIES = WOCREATE_PRIORITY

const taskId = ref('')
const itemLabel = ref('')
const task = ref(null)
const draftItem = ref(null)

const type = ref('公共区域维修')
const priority = ref('普通')
const title = ref('')
const description = ref('')
const photos = ref([])
const created = ref(null)

const communityLabel = computed(() => communityNameOf(task.value?.communityId))
const slaHours = computed(() => (priority.value === '特急' ? 4 : priority.value === '紧急' ? 8 : 24))
const canSubmit = computed(() => !!description.value.trim())

onLoad(async options => {
  taskId.value = options.taskId || ''
  itemLabel.value = options.item ? decodeURIComponent(options.item) : ''
  await loadTaskExec(taskId.value, persona.value)
  task.value = taskOf(taskId.value)
  const d = execData(taskId.value)
  const fields = d.template?.fields || []
  const hit = fields.find(f => f.label === itemLabel.value)

  /* 现场说明与问题类型在草稿里（逐项执行页每改一次就存），这里直接带过来，不用重填 */
  const draft = getDraft(taskId.value)
  const saved = (draft?.items || []).find(i => i.label === itemLabel.value)

  draftItem.value = {
    label: itemLabel.value || hit?.label || '',
    reason: saved?.reason || '',
    note: saved?.note || '',
    standard: hit?.standard || ''
  }
  title.value = `${draftItem.value.label}异常（巡检转单）`
  description.value = saved?.note || ''
  if (!draftItem.value.label) {
    toastErr('没有带上检查项，回去重新点「转工单」')
  }
})

function submit() {
  if (!canSubmit.value) {
    toastErr('先写现场描述')
    return
  }
  try {
    const wo = createFromInspection({
      task: task.value,
      item: { label: draftItem.value.label, reason: draftItem.value.reason },
      payload: {
        type: type.value,
        priority: priority.value,
        title: title.value,
        description: description.value,
        photos: photos.value.length
      }
    })
    created.value = wo
    toastOk('工单已生成')
  } catch (e) {
    toastErr(e?.message || '建单失败')
  }
}

function backExec() {
  uni.redirectTo({ url: `/pages/tasks/exec?taskId=${taskId.value}` })
}

function viewWo() {
  uni.redirectTo({ url: `/pages/wo/detail?id=${created.value.woId}` })
}
</script>

<style scoped>
.src__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.src__tag {
  font-size: 19rpx;
  color: var(--biz-primary);
  border: 2rpx solid var(--biz-primary-light-8);
  background: var(--biz-primary-light-9);
  border-radius: 999rpx;
  padding: 4rpx 14rpx;
}

.src__no {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.src__t {
  display: block;
  margin-top: 14rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.src__meta {
  margin-top: 10rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.dot {
  color: var(--biz-text-4);
}

.src__reason {
  margin-top: 16rpx;
  padding: 12rpx 16rpx;
  background: #fff0f0;
  border-radius: 12rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.src__reason-k {
  font-size: 20rpx;
  color: var(--biz-text-3);
}

.src__reason-v {
  font-size: 23rpx;
  color: var(--biz-ins-overdue);
  font-weight: 600;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.chip {
  font-size: 24rpx;
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: var(--biz-bg-fill);
  color: var(--biz-text-2);
  border: 2rpx solid transparent;
}

.chip.is-on {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-color: var(--biz-primary);
  font-weight: 600;
}

.chip.is-urgent {
  color: var(--biz-danger);
}

.chip.is-urgent.is-on {
  color: var(--biz-danger);
  background: #fff0f0;
  border-color: var(--biz-danger);
}

.hintline {
  display: block;
  margin-top: 16rpx;
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.row {
  display: flex;
  align-items: center;
  margin: 20rpx 0 10rpx;
}

.row__k {
  font-size: 23rpx;
  color: var(--biz-text-2);
  font-weight: 600;
}

.row__d {
  margin-left: auto;
  font-size: 20rpx;
  color: var(--biz-text-4);
}

.tail {
  padding: 6rpx 10rpx;
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
}

.foot-num {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  padding-right: 10rpx;
}

.foot-num__p {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--biz-text-1);
}

.foot-num__p.is-urgent {
  color: var(--biz-danger);
}

.foot-num__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.foot-btn {
  flex: 1;
}

.ok {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 46rpx 28rpx 36rpx;
  background: linear-gradient(180deg, #eafaf4 0%, #ffffff 62%);
}

.ok__i {
  width: 104rpx;
  height: 104rpx;
  border-radius: 50%;
  background: var(--biz-accent);
  color: #fff;
  font-size: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--biz-shadow-accent);
}

.ok__t {
  margin-top: 20rpx;
  font-size: 32rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.ok__no {
  margin-top: 10rpx;
  font-size: 40rpx;
  color: var(--biz-primary);
  letter-spacing: 1rpx;
}

.ok__meta {
  margin-top: 12rpx;
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.acts {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-top: 24rpx;
}

.ph-txt {
  color: var(--biz-text-4);
}

.banner__bd {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.banner__t {
  font-size: 25rpx;
  font-weight: 600;
}

.banner__d {
  font-size: 21rpx;
  opacity: 0.9;
  line-height: 1.6;
}
</style>
