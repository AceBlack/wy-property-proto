<!--
  邻里运营 · 工作台
  ------------------------------------------------------------
  这一页只回答一个问题：**今天邻里这边要做什么**。
  四个待办数字都能点进去，避免"看到 12 条待审还得自己找菜单"。
  不做图表堆砌：阅读率、参与率这些数在各自列表页里有明细，这里给个总览就够。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>邻里运营</b>：业主端「邻里」入口的后台一侧，只有三件事 —— <b>发布、审核、看数</b>。
        四条频道是<b>公告 / 投票 / 活动 / 闲置</b>。
        <br />
        <b>不做话题广场与跟帖</b>：那属于微信【社交-社区/论坛】类目，主体要提供 ICP 备案或
        增值电信业务许可证 —— 证本身不难，难的是<b>常态化内容审核</b>：邻里纠纷、指名骂物业、
        涉政涉黄，每条都要有人 24 小时内处理并留证。砍掉之后，闲置成为全站唯一 UGC 源，
        一个队列、一套词、一份举报规则就够。
        <br />
        公告<b>不在本域另开一套</b>：复用 C 域「公告通知」的同一张表，已发布即同步到邻里 ——
        两处各发一遍的结果是运营发两次、阅读数还对不上。
        <el-button link type="primary" size="small" @click="$router.push('/c/notices')">去公告通知</el-button>
      </div>
    </div>

    <!-- 四件待办 -->
    <div class="grid ntodo">
      <div v-for="t in todos" :key="t.key" class="panel ntd" :class="{ 'is-zero': !t.n }" @click="$router.push(t.to)">
        <div class="ntd__hd">
          <el-icon class="ntd__ico"><component :is="t.icon" /></el-icon>
          <span class="ntd__k">{{ t.label }}</span>
          <el-icon class="ntd__go"><ArrowRight /></el-icon>
        </div>
        <div class="ntd__v">{{ t.n }}<span class="unit">{{ t.unit }}</span></div>
        <div class="ntd__s">{{ t.hint }}</div>
      </div>
    </div>

    <!-- 四个率 -->
    <div class="grid nkpi">
      <div class="panel nk">
        <div class="nk__k">公告阅读率</div>
        <div class="nk__v">{{ sm.kpi.readRate }}<span class="unit">%</span></div>
        <div class="nk__s">已发布公告的平均触达</div>
      </div>
      <div class="panel nk">
        <div class="nk__k">活动报名率</div>
        <div class="nk__v">{{ sm.kpi.enrollFill }}<span class="unit">%</span></div>
        <div class="nk__s">已报名 / 总名额</div>
      </div>
      <div class="panel nk">
        <div class="nk__k">投票参与率</div>
        <div class="nk__v">{{ sm.kpi.votePart }}<span class="unit">%</span></div>
        <div class="nk__s">进行中投票 · 按户计</div>
      </div>
      <div class="panel nk">
        <div class="nk__k">闲置通过率</div>
        <div class="nk__v">{{ sm.kpi.itemPass }}<span class="unit">%</span></div>
        <div class="nk__s">已审内容中上架的比例</div>
      </div>
    </div>

    <div class="ncols">
      <!-- 左：投票 + 活动 -->
      <div class="panel ncol">
        <div class="panel__hd">
          <h3>进行中的投票</h3><span class="spacer" />
          <el-button link type="primary" size="small" @click="$router.push('/n/votes')">全部</el-button>
        </div>
        <div class="nlist">
          <div v-for="v in sm.votes" :key="v.voteId" class="nrow" @click="$router.push('/n/votes')">
            <div class="nrow__main">
              <div class="nrow__t">{{ v.title }}</div>
              <div class="nrow__m">
                {{ v.communityName }} · {{ v.type }} · 截止 {{ v.endAt }}
              </div>
            </div>
            <div class="nrow__side">
              <div class="nrow__v" :class="{ 'is-low': v.partRate < 30 }">{{ v.partRate }}%</div>
              <div class="nrow__x">{{ v.totalVotes }} / {{ v.target }} 户</div>
            </div>
          </div>
          <EmptyState v-if="!sm.votes.length" title="没有进行中的投票" desc="去投票管理发布一条意见征询" />
        </div>

        <div class="panel__hd" style="margin-top:6px;">
          <h3>活动进度</h3><span class="spacer" />
          <el-button link type="primary" size="small" @click="$router.push('/n/activities')">全部</el-button>
        </div>
        <div class="nlist">
          <div v-for="a in sm.acts" :key="a.activityId" class="nrow" @click="$router.push('/n/activities')">
            <div class="nrow__main">
              <div class="nrow__t">
                {{ a.title }}
                <el-tag v-if="a.phase === '待成行'" size="small" type="warning" effect="plain">待成行</el-tag>
              </div>
              <div class="nrow__m">
                {{ a.communityName }} · {{ a.startAt.slice(0, 16) }} · {{ a.feeText }}
              </div>
            </div>
            <div class="nrow__side">
              <div class="nrow__v" :class="{ 'is-low': a.phase === '待成行' }">{{ a.enrolled }} / {{ a.capacity }}</div>
              <div class="nrow__x">
                {{ a.phase === '待成行' ? `还差 ${a.gap} 人成团` : (a.over ? `已超员 ${a.over} 人` : `已报 ${a.fillRate}%`) }}
              </div>
            </div>
          </div>
          <EmptyState v-if="!sm.acts.length" title="暂无进行中的活动" />
        </div>
      </div>

      <!-- 右：待审 + 举报 -->
      <div class="panel ncol">
        <div class="panel__hd">
          <h3>待审闲置</h3><span class="spacer" />
          <el-button link type="primary" size="small" @click="$router.push('/n/items')">去审核</el-button>
        </div>
        <div class="nlist">
          <div v-for="i in sm.items" :key="i.itemId" class="qrow" @click="$router.push('/n/items')">
            <div class="qrow__ph">{{ i.category }}</div>
            <div class="qrow__main">
              <div class="qrow__t">{{ i.title }}</div>
              <div class="qrow__m">
                {{ i.sellerName }} · {{ i.sellerHouse }} · {{ i.price ? `¥${i.price}` : '免费送' }}
              </div>
            </div>
            <div class="qrow__at">{{ i.publishAt.slice(5, 16) }}</div>
          </div>
          <EmptyState v-if="!sm.items.length" title="没有待审内容" desc="新发布的闲置会先落到这里" />
        </div>

        <div class="panel__hd" style="margin-top:6px;">
          <h3>待处理举报</h3><span class="spacer" />
          <el-button link type="primary" size="small" @click="$router.push('/n/reports')">去处理</el-button>
        </div>
        <div class="nlist">
          <div v-for="r in sm.reports" :key="r.reportId" class="rrow" @click="$router.push('/n/reports')">
            <el-tag size="small" type="warning" effect="plain">{{ r.reason }}</el-tag>
            <div class="rrow__main">
              <div class="rrow__t">{{ r.itemTitle }}</div>
              <div class="rrow__m">{{ r.detail }}</div>
            </div>
          </div>
          <EmptyState v-if="!sm.reports.length" title="没有待处理举报" desc="举报会按时间倒序进队列" />
        </div>
      </div>
    </div>

    <div class="nfoot">
      数据截至 {{ sm.at }} · 阅读率取自公告模块，投票与活动的参与数按<b>户</b>去重
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { neighborSummary } from '@/api/neighbor'
import EmptyState from '@/components/EmptyState.vue'

const sm = ref({
  todo: { items: 0, reports: 0, waiting: 0, votes: 0 },
  kpi: { readRate: 0, enrollFill: 0, votePart: 0, itemPass: 0 },
  votes: [], acts: [], items: [], reports: [], at: ''
})

const todos = computed(() => [
  { key: 'items', label: '待审闲置', n: sm.value.todo.items, unit: ' 条', hint: '先审后发，最久已等 2 天', icon: 'Goods', to: '/n/items' },
  { key: 'reports', label: '待处理举报', n: sm.value.todo.reports, unit: ' 条', hint: '超过 24 小时要写说明', icon: 'Warning', to: '/n/reports' },
  { key: 'waiting', label: '待成行活动', n: sm.value.todo.waiting, unit: ' 场', hint: '报名已截止、未达下限', icon: 'Ticket', to: '/n/activities' },
  { key: 'votes', label: '进行中投票', n: sm.value.todo.votes, unit: ' 个', hint: '参与率低于 30% 提示补推', icon: 'Histogram', to: '/n/votes' }
])

onMounted(async () => {
  try {
    sm.value = await neighborSummary()
  } catch (e) {
    ElMessage.error(e?.message || '邻里数据加载失败')
  }
})
</script>

<style scoped>
.ntodo { margin-top: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ntd {
  padding: 14px 16px; cursor: pointer;
  transition: border-color .18s, box-shadow .18s;
}
.ntd:hover { border-color: rgba(91, 108, 255, .3); box-shadow: 0 2px 12px rgba(91, 108, 255, .08); }
.ntd.is-zero { opacity: .72; }
.ntd__hd { display: flex; align-items: center; gap: 6px; color: var(--biz-text-3); font-size: 12.5px; }
.ntd__ico { font-size: 14px; color: var(--biz-text-3); }
.ntd__k { flex: 1; }
.ntd__go { font-size: 12px; opacity: 0; transition: opacity .18s; }
.ntd:hover .ntd__go { opacity: 1; }
.ntd__v {
  font-family: var(--biz-font-num); font-size: 26px; color: var(--biz-text-1);
  line-height: 1.2; margin-top: 6px; display: flex; align-items: baseline; gap: 3px;
}
.ntd__v .unit { font-size: 12px; color: var(--biz-text-3); }
.ntd__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }

.nkpi { margin-top: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.nk { padding: 12px 16px; }
.nk__k { font-size: 12.5px; color: var(--biz-text-3); }
.nk__v {
  font-family: var(--biz-font-num); font-size: 20px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 2px;
}
.nk__v .unit { font-size: 12px; color: var(--biz-text-3); }
.nk__s { font-size: 11px; color: var(--biz-text-3); margin-top: 2px; }

.ncols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; margin-top: 16px; align-items: start; }
.ncol { padding: 0 0 8px; }
.ncol .panel__hd { padding: 12px 16px 6px; }

.nlist { padding: 0 8px; }
.nrow { display: flex; align-items: center; gap: 12px; padding: 9px 8px; border-radius: 8px; cursor: pointer; }
.nrow:hover { background: var(--biz-bg-fill); }
.nrow__main { min-width: 0; flex: 1; }
.nrow__t { font-size: 13px; color: var(--biz-text-1); display: flex; align-items: center; gap: 6px; }
.nrow__m { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.nrow__side { text-align: right; flex: 0 0 auto; }
.nrow__v { font-family: var(--biz-font-num); font-size: 14px; color: var(--biz-text-1); }
.nrow__v.is-low { color: var(--biz-warning, #d98a1f); }
.nrow__x { font-size: 11px; color: var(--biz-text-3); margin-top: 2px; }

.qrow { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; cursor: pointer; }
.qrow:hover { background: var(--biz-bg-fill); }
.qrow__ph {
  width: 40px; height: 40px; flex: 0 0 40px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: var(--biz-bg-fill); color: var(--biz-text-3); font-size: 11px;
}
.qrow__main { min-width: 0; flex: 1; }
.qrow__t { font-size: 12.5px; color: var(--biz-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qrow__m { font-size: 11px; color: var(--biz-text-3); margin-top: 2px; }
.qrow__at { font-size: 11px; color: var(--biz-text-3); font-family: var(--biz-font-num); }

.rrow { display: flex; gap: 8px; align-items: flex-start; padding: 8px; border-radius: 8px; cursor: pointer; }
.rrow:hover { background: var(--biz-bg-fill); }
.rrow__main { min-width: 0; flex: 1; }
.rrow__t { font-size: 12.5px; color: var(--biz-text-1); }
.rrow__m {
  font-size: 11px; color: var(--biz-text-3); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}

.nfoot { margin-top: 14px; font-size: 11.5px; color: var(--biz-text-3); }
.nfoot b { color: var(--biz-text-2); }
</style>
