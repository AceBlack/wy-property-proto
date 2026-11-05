<template>
  <view class="page">
    <NavBar title="整改闭环" :subtitle="persona?.orgName || ''" />

    <view class="body">
      <NoPerm
        v-if="!allowed"
        title="整改只对责任人与管理岗开放"
        sub="一线只看到自己名下的整改项；组长看本部门；项目经理/品质督导做复核。其他角色没有这个入口。"
        perm="f.rectify.edit"
      />

      <template v-else>
      <view class="hint">
        <text class="hint__t">整改是谁的事</text>
        <text class="hint__d">
          责任人提交整改 → 项目经理 / 品质督导复核：通过闭环，退回重做（进度归零）。
          组长能替本部门代提交，但提交人会记在单上，不冒名。
        </text>
      </view>

      <Segmented v-model="tab" :items="tabs" id-prefix="rc-" />

      <view v-for="r in rows" :key="r.id" :id="`rc-card-${r.id}`" class="card" hover-class="card--hover" @tap="open(r)">
        <view class="row__top">
          <text class="status" :style="{ color: r.statusTone }">{{ r.status }}</text>
          <text class="lvl" :class="{ 'is-major': r.level === '重大' }">{{ r.level }}</text>
          <text v-if="r.overdue" class="od">超期 {{ r.overdueDays }} 天</text>
          <text class="no num">{{ r.no }}</text>
        </view>
        <text class="issue">{{ r.issueDesc }}</text>
        <view class="meta">
          <text>{{ r.deptName }}</text>
          <text class="dot">·</text>
          <text>责任人 {{ r.owner }}</text>
          <text class="dot">·</text>
          <text>期限 {{ r.dueDate }}</text>
        </view>
        <view class="prog">
          <view class="bar prog__bar"><view class="bar__in" :style="{ width: r.progress + '%' }" /></view>
          <text class="prog__t num">{{ r.doneItems }}/{{ r.totalItems }}</text>
        </view>
      </view>

      <Empty v-if="!rows.length" :text="emptyText" :sub="emptySub" />
      </template>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Segmented from '@/components/Segmented.vue'
import Empty from '@/components/Empty.vue'
import NoPerm from '@/components/NoPerm.vue'
import { countsOf, listFor } from '@/api/rectify'
import { app, persona } from '@/store/app'
import { CAP, can } from '@/config/personas'

const allowed = computed(() => can(persona.value, CAP.rectify) || can(persona.value, CAP.recheck))
const tab = ref('todo')
const ver = ref(0)

const counts = computed(() => (ver.value, countsOf(persona.value)))
const tabs = computed(() => [
  { key: 'todo', label: '待我处理', count: counts.value.todo },
  { key: 'mine', label: '我负责的', count: counts.value.mine },
  { key: 'dept', label: '本部门', count: counts.value.dept }
])
const rows = computed(() => (ver.value, listFor(persona.value, tab.value)))

const emptyText = computed(() =>
  tab.value === 'todo' ? '没有待你处理的整改单' : tab.value === 'mine' ? '你名下没有整改单' : '本部门没有整改单'
)
const emptySub = computed(() =>
  tab.value === 'todo'
    ? '品质抽查开出的单会落到责任人与责任组长头上；项目经理看到的是「待复核」'
    : '整改单由品质记录/监督任务开出，责任人按区域自动归属'
)

onShow(() => {
  if (!app.personaId) {
    uni.reLaunch({ url: '/pages/login/index' })
    return
  }
  ver.value++
})

function open(r) {
  uni.navigateTo({ url: `/pages/rectify/detail?id=${r.id}` })
}
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
  font-size: 24rpx;
  font-weight: 600;
  color: var(--biz-text-2);
  margin-bottom: 8rpx;
}

.hint__d {
  font-size: 21rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
}

.card {
  background: #fff;
  border-radius: 22rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: var(--biz-shadow-card);
}

.card--hover {
  background: var(--biz-bg-hover);
}

.row__top {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.status {
  font-size: 21rpx;
  font-weight: 600;
}

.lvl {
  font-size: 18rpx;
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
  border-radius: 999rpx;
  padding: 3rpx 10rpx;
}

.lvl.is-major {
  color: var(--biz-danger);
  background: #fff0f0;
}

.od {
  font-size: 18rpx;
  color: #fff;
  background: var(--biz-danger);
  border-radius: 999rpx;
  padding: 3rpx 10rpx;
}

.no {
  margin-left: auto;
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.issue {
  display: block;
  margin-top: 12rpx;
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.45;
}

.meta {
  margin-top: 10rpx;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8rpx;
  font-size: 21rpx;
  color: var(--biz-text-3);
}

.dot {
  color: var(--biz-text-4);
}

.prog {
  margin-top: 16rpx;
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.prog__bar {
  flex: 1;
}

.prog__t {
  flex: none;
  font-size: 20rpx;
  color: var(--biz-text-3);
}
</style>
