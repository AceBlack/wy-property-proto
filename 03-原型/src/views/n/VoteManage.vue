<!--
  邻里 · 投票管理
  ------------------------------------------------------------
  只做**意见征询**：满意度、方案偏好、活动意愿。
  不做《民法典》278 条的业主共同决定 —— 那个要人数 + 专有部分面积双过半、
  要公示期、要能出纸质表决票，小程序替代不了票箱，做了反而给人「已经表决过」的错觉。
  所以结果页只有参与率与分布，**没有「是否通过」这一句**。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>投票管理</b>：业主端「邻里 · 投票」的内容源。
        <br />
        <b>只做意见征询</b>，不构成《民法典》意义上业主共同决定 —— 涉及全体业主的正式表决仍要走线下票箱，
        小程序只做意见收集与参与率统计。所以结果页不给「是否通过」。
        <br />
        <b>一旦发布，题目和选项都不能改</b>：已经投出去的票会指向不存在的选项，改完票数合计还对不上。
        要调整就复制一份新的。参与率按<b>户</b>计，租户不计 —— 征询的是产权人意见。
      </div>
    </div>

    <div class="grid vstats">
      <div class="panel vstat">
        <div class="vstat__k">进行中</div>
        <div class="vstat__v">{{ st.running }} <span class="unit">个</span></div>
        <div class="vstat__s">平均参与率 {{ st.runningPartRate }}%</div>
      </div>
      <div class="panel vstat">
        <div class="vstat__k">草稿</div>
        <div class="vstat__v">{{ st.draft }} <span class="unit">个</span></div>
        <div class="vstat__s">发布前可自由改</div>
      </div>
      <div class="panel vstat">
        <div class="vstat__k">已结束</div>
        <div class="vstat__v">{{ st.ended }} <span class="unit">个</span></div>
        <div class="vstat__s">平均参与率 {{ st.endedPartRate }}%</div>
      </div>
      <div class="panel vstat">
        <div class="vstat__k">累计票数</div>
        <div class="vstat__v">{{ st.votesTotal }} <span class="unit">票</span></div>
        <div class="vstat__s">全部投票合计</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters">
        <el-input v-model="q.kw" clearable placeholder="标题 / 编号" :prefix-icon="'Search'"
          style="width:220px;" @keyup.enter="applyFilter" />
        <el-select v-model="q.communityId" clearable placeholder="全部项目" style="width:150px;" @change="applyFilter">
          <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="q.type" clearable placeholder="全部类型" style="width:140px;" @change="applyFilter">
          <el-option v-for="t in VOTE_TYPES" :key="t" :label="t" :value="t" />
        </el-select>
        <el-select v-model="q.status" clearable placeholder="全部状态" style="width:120px;" @change="applyFilter">
          <el-option v-for="s in VOTE_STATUS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-button type="primary" :icon="'Search'" @click="applyFilter">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
        <span class="spacer" />
        <el-button v-if="canEdit" type="primary" plain :icon="'Plus'" @click="openCreate">新建投票</el-button>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>投票列表</h3>
        <span class="spacer" />
        <span class="desc">进行中 → 草稿 → 已结束 · 共 {{ total }} 条</span>
      </div>

      <el-table :data="rows" stripe v-loading="loading" style="width:100%">
        <el-table-column label="投票" min-width="260">
          <template #default="{ row }">
            <div class="v-t">{{ row.title }}</div>
            <div class="sub">
              <span class="mono">{{ row.voteId }}</span> · {{ row.type }} ·
              {{ row.multi ? `多选（最多 ${row.maxPick}）` : '单选' }}{{ row.anonymous ? ' · 匿名' : ' · 实名' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="communityName" label="项目" width="120" show-overflow-tooltip />
        <el-table-column label="时间" width="180">
          <template #default="{ row }">
            <template v-if="row.status === '草稿'">
              <div class="sub">未发布</div>
              <div class="sub">拟截止 {{ row.endAt }}</div>
            </template>
            <template v-else>
              <div class="sub">{{ row.startAt }} 起</div>
              <div class="sub">截止 {{ row.endAt }}</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="参与" width="170">
          <template #default="{ row }">
            <template v-if="row.status === '草稿'">
              <span class="sub">—</span>
            </template>
            <template v-else>
              <el-progress :percentage="row.partRate" :stroke-width="6" :show-text="false"
                :color="row.partRate >= 50 ? '#2f9e6e' : row.partRate >= 30 ? '#5b6cff' : '#d98a1f'" />
              <div class="sub">{{ row.totalVotes }} / {{ row.target }} 户 · {{ row.partRate }}%</div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.statusType" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openResult(row)">结果</el-button>
            <template v-if="row.status === '草稿' && canEdit">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link type="primary" size="small" @click="doPublish(row)">发布</el-button>
              <el-button link type="danger" size="small" @click="doDelete(row)">删除</el-button>
            </template>
            <el-button v-if="row.status === '进行中' && canEdit" link type="warning" size="small"
              @click="doEnd(row)">结束</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState title="没有符合条件的投票" desc="换个筛选条件，或点右上角「新建投票」" />
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="pageNo" v-model:page-size="size" :total="total"
          :page-sizes="PAGE_SIZES" layout="total, sizes, prev, pager, next" background
          @current-change="load" @size-change="onSize"
        />
      </div>
    </div>

    <!-- 新建 / 编辑 -->
    <el-drawer v-model="ed.visible" :title="ed.voteId ? '编辑投票' : '新建投票'" size="600px" :close-on-click-modal="false">
      <el-form label-width="92px" label-position="right">
        <el-form-item label="标题" required>
          <el-input v-model="ed.title" maxlength="40" show-word-limit placeholder="如：地下车库充电桩加装位置征询" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-radio-group v-model="ed.type">
            <el-radio-button v-for="t in VOTE_TYPES" :key="t" :label="t" :value="t">{{ t }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="项目" required>
          <el-select v-model="ed.communityId" placeholder="投票范围按项目算" style="width:100%">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="ed.desc" type="textarea" :rows="3" maxlength="200" show-word-limit
            placeholder="写清背景与用途，业主才知道自己这一票在决定什么" />
        </el-form-item>

        <el-form-item label="选择方式">
          <div class="ed-line">
            <el-switch v-model="ed.multi" active-text="多选" />
            <template v-if="ed.multi">
              <span class="hint" style="margin-left:8px;">最多可选</span>
              <el-input-number v-model="ed.maxPick" :min="1" :max="ed.options.length" size="small"
                controls-position="right" style="width:96px;margin-left:6px;" />
            </template>
            <el-switch v-model="ed.anonymous" active-text="匿名" style="margin-left:18px;" />
          </div>
        </el-form-item>

        <el-form-item label="截止日期" required>
          <el-date-picker v-model="ed.endAt" type="date" value-format="YYYY-MM-DD"
            placeholder="投票到哪天结束" style="width:200px" />
          <span class="hint" style="margin-left:10px;">发布后开始时间取当天</span>
        </el-form-item>

        <el-form-item label="选项" required>
          <div class="opt-box">
            <div v-for="(o, i) in ed.options" :key="i" class="opt-row">
              <span class="opt-no">{{ String.fromCharCode(65 + i) }}</span>
              <el-input v-model="o.label" maxlength="30" :placeholder="`选项 ${i + 1}`" />
              <el-button link type="danger" :disabled="ed.options.length <= 2" @click="ed.options.splice(i, 1)">删</el-button>
            </div>
            <el-button link type="primary" :disabled="ed.options.length >= 10" @click="addOption">
              + 添加选项（最多 10 个）
            </el-button>
          </div>
        </el-form-item>
      </el-form>

      <div class="drawer-tip">
        <b>发布后就不能改题目和选项了</b>。已经投出去的票会指向不存在的选项，改完合计还对不上。
        草稿阶段随便改 —— 这也是为什么默认建成草稿，而不是保存即发布。
      </div>

      <template #footer>
        <el-button @click="ed.visible = false">取消</el-button>
        <el-button type="primary" :loading="ed.saving" @click="saveForm">保存草稿</el-button>
      </template>
    </el-drawer>

    <!-- 结果 -->
    <el-drawer v-model="res.visible" title="投票结果" size="520px">
      <template v-if="res.row">
        <div class="res-hd">
          <div class="res-t">{{ res.row.title }}</div>
          <div class="res-m">
            {{ res.row.communityName }} · {{ res.row.type }} ·
            {{ res.row.status === '进行中' ? `进行中，截止 ${res.row.endAt}` : `已于 ${res.row.endedAt || res.row.endAt} 结束` }}
          </div>
        </div>

        <div class="res-kpis">
          <div class="res-kpi">
            <div class="res-kpi__k">参与率</div>
            <div class="res-kpi__v">{{ res.row.partRate }}%</div>
            <div class="res-kpi__s">{{ res.row.totalVotes }} / {{ res.row.target }} 户</div>
          </div>
          <div class="res-kpi">
            <div class="res-kpi__k">未参与</div>
            <div class="res-kpi__v">{{ res.row.notVoted }}</div>
            <div class="res-kpi__s">户（含空置）</div>
          </div>
          <div class="res-kpi">
            <div class="res-kpi__k">结果可信度</div>
            <div class="res-kpi__v is-sm">{{ res.row.confidence }}</div>
            <div class="res-kpi__s">按参与率判定</div>
          </div>
        </div>

        <div class="sec__hd" style="margin:16px 0 8px;"><h4>选项分布</h4><span class="desc">按票数降序</span></div>
        <div class="bar-box">
          <div v-for="o in res.row.options" :key="o.key" class="bar">
            <div class="bar__hd">
              <span class="bar__l">{{ o.label }}</span>
              <span class="bar__n">{{ o.votes }} 票 · {{ o.pct }}%</span>
            </div>
            <div class="bar__track">
              <div class="bar__fill" :style="{ width: `${o.pct}%` }" />
            </div>
          </div>
        </div>

        <div class="res-note">
          <b>这是意见征询，不是表决。</b>结果只反映参与业主的偏好，不产生《民法典》278 条
          业主共同决定的效力，也不能作为「业主已同意」的凭证。需要正式表决的事项请走线下票箱与公示流程。
        </div>
        <div v-if="res.row.partRate < 30" class="res-warn">
          参与率仅 {{ res.row.partRate }}%，样本偏低。对外引用时建议注明参与户数，避免被理解成全体业主意见。
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  VOTE_STATUS, VOTE_TYPES, canEditVotes,
  deleteVote, endVote, publishVote, queryVotes, saveVote, voteResult, voteStats
} from '@/api/neighbor'
import { PAGE_SIZES, communityOpts } from '@/api/shared'
import EmptyState from '@/components/EmptyState.vue'

const canEdit = computed(() => canEditVotes())
const cmOpts = communityOpts()

const q = reactive({ kw: '', communityId: '', type: '', status: '' })
const pageNo = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const st = ref({ total: 0, running: 0, draft: 0, ended: 0, runningPartRate: 0, endedPartRate: 0, votesTotal: 0 })

async function load() {
  loading.value = true
  try {
    const res = await queryVotes({ pageNo: pageNo.value, size: size.value, filters: { ...q } })
    rows.value = res.rows
    total.value = res.total
    st.value = voteStats()
  } catch (e) {
    ElMessage.error(e?.message || '投票列表加载失败')
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function resetFilter() { Object.assign(q, { kw: '', communityId: '', type: '', status: '' }); applyFilter() }
function onSize() { pageNo.value = 1; load() }

/* ---------------- 新建 / 编辑 ---------------- */
const ed = reactive({
  visible: false, saving: false, voteId: '',
  title: '', type: '意见征询', communityId: '', desc: '',
  multi: false, maxPick: 2, anonymous: true, endAt: '',
  options: [{ label: '' }, { label: '' }]
})

function addOption() {
  if (ed.options.length >= 10) return
  ed.options.push({ label: '' })
}

function openCreate() {
  Object.assign(ed, {
    visible: true, saving: false, voteId: '',
    title: '', type: '意见征询', communityId: cmOpts[0]?.id || '', desc: '',
    multi: false, maxPick: 2, anonymous: true, endAt: '',
    options: [{ label: '' }, { label: '' }]
  })
}

function openEdit(row) {
  Object.assign(ed, {
    visible: true, saving: false, voteId: row.voteId,
    title: row.title, type: row.type, communityId: row.communityId, desc: row.desc || '',
    multi: row.multi, maxPick: row.maxPick || 2, anonymous: row.anonymous,
    endAt: row.endAt, options: row.options.map(o => ({ label: o.label }))
  })
}

async function saveForm() {
  ed.saving = true
  try {
    await saveVote({
      title: ed.title,
      type: ed.type,
      communityId: ed.communityId,
      desc: ed.desc,
      multi: ed.multi,
      maxPick: ed.maxPick,
      anonymous: ed.anonymous,
      endAt: ed.endAt,
      options: ed.options
    }, ed.voteId)
    ElMessage.success(ed.voteId ? '已保存' : '已存为草稿，确认无误后点「发布」')
    ed.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    ed.saving = false
  }
}

async function doPublish(row) {
  try {
    await ElMessageBox.confirm(
      `发布后题目与选项都不能再改，业主会立刻看到「${row.title}」。确认发布？`,
      '发布投票',
      { confirmButtonText: '确认发布', cancelButtonText: '再想想', type: 'warning' }
    )
  } catch { return }
  try {
    await publishVote(row.voteId)
    ElMessage.success('已发布')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '发布失败')
  }
}

async function doEnd(row) {
  try {
    await ElMessageBox.confirm(
      `结束后不再接收新票，当前 ${row.totalVotes} 票作为最终结果。确认结束？`,
      '结束投票',
      { confirmButtonText: '确认结束', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  try {
    await endVote(row.voteId)
    ElMessage.success('已结束')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

async function doDelete(row) {
  try {
    await ElMessageBox.confirm(`删除草稿「${row.title}」？删除后不可恢复。`, '删除投票',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  try {
    await deleteVote(row.voteId)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}

/* ---------------- 结果 ---------------- */
const res = reactive({ visible: false, row: null })
async function openResult(row) {
  res.visible = true
  res.row = row
  try {
    const full = await voteResult(row.voteId)
    if (full) res.row = full
  } catch (e) {
    ElMessage.error(e?.message || '结果加载失败')
  }
}

onMounted(load)
</script>

<style scoped>
.vstats { margin-top: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.vstat { padding: 14px 16px; }
.vstat__k { font-size: 12.5px; color: var(--biz-text-3); }
.vstat__v {
  font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px;
}
.vstat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.vstat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }

.filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filters .spacer { flex: 1; }
.v-t { font-size: 13px; color: var(--biz-text-1); }
.sub { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.mono { font-family: var(--biz-font-num); }
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }

.ed-line { display: flex; align-items: center; flex-wrap: wrap; }
.hint { font-size: 11.5px; color: var(--biz-text-3); }
.opt-box { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.opt-row { display: flex; align-items: center; gap: 8px; }
.opt-no {
  width: 22px; height: 22px; flex: 0 0 22px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  background: var(--biz-bg-fill); color: var(--biz-text-2); font-size: 11px; font-family: var(--biz-font-num);
}

.drawer-tip {
  margin-top: 16px; padding: 10px 12px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 12px; line-height: 1.8; color: var(--biz-text-2);
}
.drawer-tip b { color: var(--biz-text-1); }

.res-hd { padding-bottom: 12px; border-bottom: 1px solid var(--biz-border); }
.res-t { font-size: 15px; color: var(--biz-text-1); font-weight: 600; }
.res-m { font-size: 12px; color: var(--biz-text-3); margin-top: 4px; }
.res-kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.res-kpi { padding: 10px 12px; border-radius: 8px; background: var(--biz-bg-fill); }
.res-kpi__k { font-size: 11.5px; color: var(--biz-text-3); }
.res-kpi__v { font-family: var(--biz-font-num); font-size: 20px; color: var(--biz-text-1); margin-top: 2px; }
.res-kpi__v.is-sm { font-size: 14px; font-family: inherit; line-height: 1.6; }
.res-kpi__s { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; }

.bar-box { display: flex; flex-direction: column; gap: 12px; }
.bar__hd { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 5px; }
.bar__l { font-size: 12.5px; color: var(--biz-text-1); }
.bar__n { font-size: 11.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.bar__track { height: 6px; border-radius: 3px; background: var(--biz-bg-fill); overflow: hidden; }
.bar__fill { height: 100%; border-radius: 3px; background: var(--biz-primary, #5b6cff); }

.res-note {
  margin-top: 16px; padding: 10px 12px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 12px; line-height: 1.8; color: var(--biz-text-2);
}
.res-note b { color: var(--biz-text-1); }
.res-warn {
  margin-top: 10px; padding: 8px 12px; border-radius: 8px;
  background: rgba(217, 138, 31, .08); color: var(--biz-warning, #d98a1f);
  font-size: 11.5px; line-height: 1.7;
}
</style>
