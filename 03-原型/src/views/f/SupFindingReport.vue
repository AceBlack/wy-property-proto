<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>主管发现问题数 · 独立考核报表</b>：考核对象是<b>部门经理（组长）本人提交的「监督」任务</b>，
        不是一线执行任务——组长到现场核验下属责任区，查出问题必须指定责任员工，所以「发现多少问题」是可以归到人的。
        本页只做考核，不替代 <code>/f/quality-eval</code> 的部门达标率评价：
        <b>达标率看部门做得怎么样，本表看主管查得怎么样</b>。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="caliber">
        <div class="caliber__hd">
          <h4>统计口径</h4>
          <span class="desc">口径与 <code>api.supFindingRows</code> 同源，页面不做二次计算</span>
        </div>
        <div class="caliber__g">
          <div class="caliber__i">
            <div class="caliber__k">① 统计对象</div>
            <div class="caliber__v">部门经理本人提交的「监督」任务；一线员工的「执行」任务不计入本表</div>
          </div>
          <div class="caliber__i">
            <div class="caliber__k">② 发现问题数</div>
            <div class="caliber__v">监督任务异常项（issueCount）合计，每项必须指定责任员工</div>
          </div>
          <div class="caliber__i">
            <div class="caliber__k">③ 次均 / 检出率</div>
            <div class="caliber__v">次均 = 发现问题 ÷ 已完成监督任务（查得勤）；检出率 = 发现问题 ÷ 检查项（查得细）</div>
          </div>
          <div class="caliber__i">
            <div class="caliber__k">④ 申报冲突</div>
            <div class="caliber__v">下属当日申报「零异常」，组长现场却查出问题的次数 —— 防「报喜不报忧」</div>
          </div>
          <div class="caliber__i">
            <div class="caliber__k">⑤ 主动发现率</div>
            <div class="caliber__v">自查 ÷（自查 + 抽查未发现）；抽查未发现取评价记录录入值，未评价时按同区域现场抽查扣分项折算</div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid" style="grid-template-columns:repeat(6,minmax(0,1fr));">
        <div class="dstat"><div class="dstat__k">考核主管</div><div class="dstat__v">{{ summary.supervisors }}<span class="unit">人</span></div></div>
        <div class="dstat">
          <div class="dstat__k">监督任务</div>
          <div class="dstat__v">{{ summary.done }}<span class="unit">/ {{ summary.planned }}</span></div>
          <div class="dstat__k" style="margin-top:2px;">已完成 / 应执行</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">发现问题</div>
          <div class="dstat__v">{{ summary.issues }}<span class="unit">项</span></div>
          <div class="dstat__k" style="margin-top:2px;">检出率 {{ summary.issueRate }}%</div>
        </div>
        <div class="dstat"><div class="dstat__k">次均发现问题</div><div class="dstat__v">{{ summary.perTask }}<span class="unit">项/次</span></div></div>
        <div class="dstat">
          <div class="dstat__k">申报冲突</div>
          <div class="dstat__v" :class="summary.conflicts ? 'is-warn' : ''">{{ summary.conflicts }}<span class="unit">次</span></div>
          <div class="dstat__k" style="margin-top:2px;">{{ summary.silent }} 名主管有问题未抓到冲突</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">主动发现率</div>
          <div class="dstat__v">{{ summary.proactive == null ? '—' : summary.proactive + '%' }}</div>
          <div class="dstat__k" style="margin-top:2px;">抽查未发现 {{ summary.crossMissed }} 项</div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="72px" @submit.prevent>
        <el-form-item label="周期">
          <el-select v-model="query.period" style="width:120px" @change="reload">
            <el-option v-for="p in periodOpts" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:132px" @change="reload">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item label="岗位">
          <el-select v-model="query.post" placeholder="全部" clearable style="width:100px" @change="reload">
            <el-option v-for="o in postOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="主管">
          <el-select v-model="query.supervisor" placeholder="全部" clearable style="width:110px" @change="reload">
            <el-option v-for="o in supervisorOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
          <el-button :icon="'Refresh'" @click="reload">刷新</el-button>
        </el-form-item>
        <el-form-item label="排序">
          <span class="muted" style="font-size:12px;">按发现问题数降序 · 同分看次均</span>
        </el-form-item>
      </el-form>
    </div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) 380px;margin-top:16px;">
      <div class="panel">
        <div class="toolbar">
          <el-radio-group v-model="dim" size="small">
            <el-radio-button value="sup">按主管（考核明细）</el-radio-button>
            <el-radio-button value="dept">按部门（汇总）</el-radio-button>
          </el-radio-group>
          <span class="spacer" />
          <span class="muted" style="font-size:12.5px;">{{ query.period }} · {{ rows.length }} 名主管 / {{ deptRows.length }} 个部门</span>
        </div>

        <el-table v-if="dim === 'sup'" :data="rows" style="width:100%" max-height="calc(100vh - 560px)" @row-click="openDrill">
          <el-table-column label="#" width="52" align="center">
            <template #default="{ row }">
              <span class="rk" :class="{ 'is-top': row.rank <= 3 }">{{ row.rank }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="supervisor" label="主管" min-width="86" />
          <el-table-column prop="deptName" label="部门" min-width="100" show-overflow-tooltip />
          <el-table-column prop="communityName" label="项目" min-width="96" show-overflow-tooltip />
          <el-table-column label="监督任务" min-width="96" align="right">
            <template #default="{ row }">{{ row.done }}<span class="muted">/{{ row.planned }}</span></template>
          </el-table-column>
          <el-table-column label="发现问题" min-width="92" align="right">
            <template #default="{ row }"><span class="money money--out">{{ row.issues }}</span></template>
          </el-table-column>
          <el-table-column label="次均" width="76" align="right">
            <template #default="{ row }">{{ row.perTask }}</template>
          </el-table-column>
          <el-table-column label="检出率" width="88" align="right">
            <template #default="{ row }">{{ row.issueRate }}%</template>
          </el-table-column>
          <el-table-column label="冲突" width="72" align="right">
            <template #default="{ row }">
              <span :class="row.conflicts ? 'money money--out' : 'muted'">{{ row.conflicts }}</span>
            </template>
          </el-table-column>
          <el-table-column label="抽查未发现" width="104" align="right">
            <template #default="{ row }">
              <span :class="row.crossMissed ? 'money money--out' : 'muted'">{{ row.crossMissed }}</span>
            </template>
          </el-table-column>
          <el-table-column label="主动发现率" width="104" align="right">
            <template #default="{ row }">
              <span :class="row.proactive != null && row.proactive < 30 ? 'money money--out' : ''">
                {{ row.proactive == null ? '—' : row.proactive + '%' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click.stop="openDrill(row)">下钻</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <EmptyState type="search" desc="该周期没有监督任务，换个周期或项目看看" />
          </template>
        </el-table>

        <el-table v-else :data="deptRows" style="width:100%" max-height="calc(100vh - 560px)">
          <el-table-column prop="deptName" label="部门" min-width="112" show-overflow-tooltip />
          <el-table-column prop="post" label="岗位" width="76" />
          <el-table-column prop="communityName" label="项目" min-width="96" show-overflow-tooltip />
          <el-table-column prop="supervisorText" label="主管" min-width="96" show-overflow-tooltip />
          <el-table-column label="监督任务" min-width="96" align="right">
            <template #default="{ row }">{{ row.done }}<span class="muted">/{{ row.planned }}</span></template>
          </el-table-column>
          <el-table-column label="发现问题" min-width="92" align="right">
            <template #default="{ row }"><span class="money money--out">{{ row.issues }}</span></template>
          </el-table-column>
          <el-table-column label="次均" width="76" align="right">
            <template #default="{ row }">{{ row.perTask }}</template>
          </el-table-column>
          <el-table-column label="检出率" width="88" align="right">
            <template #default="{ row }">{{ row.issueRate }}%</template>
          </el-table-column>
          <el-table-column label="冲突" width="72" align="right">
            <template #default="{ row }">
              <span :class="row.conflicts ? 'money money--out' : 'muted'">{{ row.conflicts }}</span>
            </template>
          </el-table-column>
          <el-table-column label="抽查未发现" width="104" align="right">
            <template #default="{ row }">
              <span :class="row.crossMissed ? 'money money--out' : 'muted'">{{ row.crossMissed }}</span>
            </template>
          </el-table-column>
          <el-table-column label="主动发现率" width="104" align="right">
            <template #default="{ row }">{{ row.proactive == null ? '—' : row.proactive + '%' }}</template>
          </el-table-column>
          <template #empty>
            <EmptyState type="search" desc="该周期没有监督任务" />
          </template>
        </el-table>
      </div>

      <div class="panel">
        <div class="sec__hd"><h4>发现问题排名</h4><span class="desc">Top {{ rankRows.length }}</span></div>
        <div class="bars">
          <div v-for="r in rankRows" :key="r.key" class="bars__i" @click="openDrill(r)">
            <div class="bars__t">
              <span class="bars__n">{{ r.supervisor }}</span>
              <span class="bars__d">{{ r.deptName }}</span>
              <span class="bars__v">{{ r.issues }}</span>
            </div>
            <div class="bars__bar"><i :style="{ width: barW(r) + '%' }" /></div>
            <div class="bars__m">次均 {{ r.perTask }} · 冲突 {{ r.conflicts }} · 主动发现率 {{ r.proactive == null ? '—' : r.proactive + '%' }}</div>
          </div>
          <EmptyState v-if="!rankRows.length" type="empty" desc="暂无监督任务数据" />
        </div>
        <div class="bars__note">
          排名只反映「查出多少」，需与「抽查未发现」合读：查得多但抽查未被发现，说明监督有效；
          查得少且抽查未发现多，说明监督走过场。
        </div>
      </div>
    </div>

    <!-- 下钻：某主管本期的监督任务 -->
    <DetailDrawer v-model="drillVisible" :loading="drillLoading"
      :title="drill ? `${drill.supervisor} · ${drill.deptName}` : ''"
      :subtitle="drill ? `${drill.communityName} · ${drill.post} · ${query.period}` : ''"
    >
      <template v-if="drill">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">监督任务</div><div class="dstat__v">{{ drill.done }}<span class="unit">/ {{ drill.planned }}</span></div></div>
          <div class="dstat"><div class="dstat__k">发现问题</div><div class="dstat__v">{{ drill.issues }}<span class="unit">项</span></div></div>
          <div class="dstat"><div class="dstat__k">次均</div><div class="dstat__v">{{ drill.perTask }}</div></div>
          <div class="dstat">
            <div class="dstat__k">主动发现率</div>
            <div class="dstat__v">{{ drill.proactive == null ? '—' : drill.proactive + '%' }}</div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>监督任务清单</h4>
          <span class="desc">{{ tasks.length }} 条 · 含问题项与责任员工</span>
        </div>
        <el-table :data="tasks" size="small" max-height="420">
          <el-table-column prop="scheduledDate" label="日期" width="96" />
          <el-table-column prop="planName" label="计划" min-width="120" show-overflow-tooltip />
          <el-table-column label="状态" width="84">
            <template #default="{ row }"><StatusTag domain="inspect" :value="row.status" /></template>
          </el-table-column>
          <el-table-column label="检查项" width="88" align="right">
            <template #default="{ row }">{{ row.normalCount }}<span class="muted">/{{ row.itemCount }}</span></template>
          </el-table-column>
          <el-table-column label="问题" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="!row.issueCount" class="muted">零异常</span>
              <span v-else>{{ row.issueText }}</span>
            </template>
          </el-table-column>
          <el-table-column label="冲突" width="72" align="center">
            <template #default="{ row }">
              <span v-if="row.conflicts" class="money money--out">是</span>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>

        <div class="drill-note">
          <div><b>说明：</b>零异常的监督任务不计入发现问题，但仍计入「已完成」分母；
          冲突标记来自「下属当日申报零异常 + 组长查出问题」的自动比对，不是人工填写。</div>
        </div>
      </template>
      <template #footer>
        <el-button @click="drillVisible = false">关闭</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import {
  communities, supFindingDeptRows, supFindingPeriodOpts, supFindingPostOpts, supFindingRows,
  supFindingSummary, supFindingSupervisorOpts, supFindingTaskRows
} from '@/utils/api'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const periodOpts = supFindingPeriodOpts()
const postOpts = supFindingPostOpts()
const supervisorOpts = supFindingSupervisorOpts()
const query = reactive({ period: periodOpts[0] || '', communityId: '', post: '', supervisor: '' })
const dim = ref('sup')
const ver = ref(0)
const f = () => ({ period: query.period, communityId: query.communityId, post: query.post, supervisor: query.supervisor })

const rows = computed(() => { void ver.value; return supFindingRows(f()) })
const deptRows = computed(() => { void ver.value; return supFindingDeptRows(f()) })
const summary = computed(() => { void ver.value; return supFindingSummary(f()) })
const rankRows = computed(() => rows.value.slice(0, 6))
const maxIssues = computed(() => Math.max(1, ...rankRows.value.map(r => r.issues)))
const barW = r => Math.max(4, Math.round(r.issues / maxIssues.value * 100))
function reload() { ver.value++ }

/* ---------- 下钻 ---------- */
const drillVisible = ref(false)
const drillLoading = ref(false)
const drill = ref(null)
const tasks = ref([])
async function openDrill(row) {
  drill.value = row
  drillVisible.value = true
  drillLoading.value = true
  try {
    tasks.value = await supFindingTaskRows({ supervisor: row.supervisor, orgId: row.orgId, period: query.period })
  } finally { drillLoading.value = false }
}

/* ---------- 导出 ---------- */
const EXPORT_COLS = [
  { prop: 'rank', label: '排名' }, { prop: 'supervisor', label: '主管' },
  { prop: 'deptName', label: '部门' }, { prop: 'communityName', label: '项目' },
  { prop: 'planned', label: '应执行监督任务' }, { prop: 'done', label: '已完成' },
  { prop: 'issues', label: '发现问题数' }, { prop: 'perTask', label: '次均问题' },
  { prop: 'issueRate', label: '检出率(%)' }, { prop: 'conflicts', label: '申报冲突' },
  { prop: 'crossMissed', label: '抽查未发现' }, { prop: 'proactive', label: '主动发现率(%)' }
]
function onExport() {
  const src = dim.value === 'sup' ? rows.value : deptRows.value
  exportList({ name: `主管发现问题数_${query.period}`, source: '/f/sup-finding', columns: EXPORT_COLS, rows: src, filters: { ...query } })
}
</script>

<style scoped>
.rk { font-family: var(--biz-font-num); color: var(--biz-text-3); }
.rk.is-top { color: var(--biz-danger); font-weight: 600; }

.caliber__hd { display: flex; align-items: baseline; gap: 10px; }
.caliber__hd h4 { margin: 0; font-size: 14px; color: var(--biz-text-1); }
.caliber__hd .desc { font-size: 12px; color: var(--biz-text-3); }
.caliber__g { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.caliber__i { padding: 10px 12px; border-radius: 6px; background: var(--biz-fill-1, #f7f8fb); }
.caliber__k { font-size: 12px; color: var(--biz-text-3); }
.caliber__v { font-size: 12.5px; color: var(--biz-text-2); margin-top: 4px; line-height: 1.5; }

.bars { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
.bars__i { cursor: pointer; }
.bars__t { display: flex; align-items: baseline; gap: 6px; font-size: 12.5px; }
.bars__n { color: var(--biz-text-1); font-weight: 600; }
.bars__d { color: var(--biz-text-3); font-size: 11.5px; }
.bars__v { margin-left: auto; font-family: var(--biz-font-num); color: var(--biz-danger); font-weight: 600; }
.bars__bar { height: 6px; border-radius: 3px; background: var(--biz-fill-2, #eef0f6); margin-top: 4px; overflow: hidden; }
.bars__bar i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #ffb05c, #ec4d63); }
.bars__m { font-size: 11px; color: var(--biz-text-3); margin-top: 3px; }
.bars__note { margin-top: 12px; font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.drill-note { margin-top: 14px; font-size: 12px; color: var(--biz-text-3); line-height: 1.7; }
</style>
