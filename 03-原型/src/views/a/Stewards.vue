<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>楼栋责任范围 · 谁管哪几栋</b>：业主资料、租户信息与欠费催缴按<b>责任范围</b>隔离 ——
        楼管只看自己楼栋的业主与账单，<b>项目经理看整个小区</b>，总部看全部项目。
        粒度：<b>楼栋为主 · 单元可拆 · 房屋例外</b>（个别房屋在房屋表单里单独指定即成为例外）。
        <b>责任移交由项目经理执行</b>：楼管离职/调岗必须移交，否则那几栋的业主会「没人管也看不见」。
        <template v-if="!canEdit">当前角色只读（配置与移交由项目经理执行）。</template>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));">
        <div class="dstat">
          <div class="dstat__k">楼栋覆盖</div>
          <div class="dstat__v">{{ summary.covered }}<span class="unit">/ {{ summary.buildings }}</span></div>
          <div class="dstat__k" style="margin-top:2px;">覆盖率 {{ summary.coverage }}%</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">楼栋管家</div>
          <div class="dstat__v">{{ summary.stewards }}<span class="unit">人</span></div>
          <div class="dstat__k" style="margin-top:2px;">人均 {{ summary.avgHouses }} 户</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">单元拆分共管</div>
          <div class="dstat__v">{{ summary.splitUnits }}<span class="unit">个单元</span></div>
          <div class="dstat__k" style="margin-top:2px;">一栋多楼管</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">未分配</div>
          <div class="dstat__v" :class="summary.uncovered ? 'is-warn' : ''">{{ summary.uncovered }}<span class="unit">栋</span></div>
          <div class="dstat__k" style="margin-top:2px;">未分配则无人可见</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">当前视角</div>
          <div class="dstat__v" style="font-size:15px;">{{ myScope ? myScope.empName : '全量' }}</div>
          <div class="dstat__k" style="margin-top:2px;">
            {{ myScope ? `${myScope.buildings} 栋 / ${myScope.houses} 户` : '按角色数据范围' }}
          </div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="60px" @submit.prevent>
        <el-form-item label="项目">
          <el-select v-model="query.communityId" placeholder="全部" clearable style="width:130px" @change="load">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item label="楼管">
          <el-select v-model="query.empId" placeholder="全部" clearable style="width:120px" @change="load">
            <el-option v-for="s in stewardOpts" :key="s.empId" :label="s.name" :value="s.empId" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="楼栋 / 项目 / 姓名" clearable style="width:170px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item class="acts">
          <el-button :icon="'Search'" @click="search">查询</el-button>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-button type="primary" :icon="'Switch'" :disabled="!canEdit" @click="openTransfer">责任移交</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
        <span class="spacer" />
        <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 条责任范围</span>
      </div>

      <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
        :row-class-name="rowClass">
        <el-table-column prop="communityName" label="项目" min-width="96" />
        <el-table-column prop="buildingName" label="楼栋" width="84" />
        <el-table-column label="范围" width="92">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.scopeType === '单元' ? 'warning' : 'info'">
              {{ row.scopeType === '单元' ? row.unitName : (row.scopeType === '未分配' ? '未分配' : '整栋') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="责任楼管" min-width="92">
          <template #default="{ row }">
            <span v-if="row.empName">{{ row.empName }}</span>
            <span v-else class="is-warn">未分配</span>
          </template>
        </el-table-column>
        <el-table-column label="户数" width="76" align="right">
          <template #default="{ row }">{{ row.houses }}</template>
        </el-table-column>
        <el-table-column label="在住租户" width="92" align="right">
          <template #default="{ row }">{{ row.tenants }}</template>
        </el-table-column>
        <el-table-column label="欠费户" width="86" align="right">
          <template #default="{ row }">
            <span :class="row.debtHouses ? 'money money--out' : 'muted'">{{ row.debtHouses }}</span>
          </template>
        </el-table-column>
        <el-table-column label="欠费金额" width="110" align="right">
          <template #default="{ row }">¥{{ money(row.debtAmount) }}</template>
        </el-table-column>
        <el-table-column label="任职" width="96">
          <template #default="{ row }">
            <span v-if="row.days != null" class="muted">{{ row.days }} 天</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="96" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!canEdit" @click.stop="openAssign(row)">调整</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="empty" desc="当前范围内没有楼栋" />
        </template>
      </el-table>

      <div class="table-foot">
        <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
          :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
      </div>
    </div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) 420px;margin-top:16px;">
      <div class="panel">
        <div class="sec__hd"><h4>按楼管汇总</h4><span class="desc">谁管得多、谁那儿欠费多</span></div>
        <el-table :data="summary.staff" size="small" max-height="240">
          <el-table-column prop="name" label="楼管" width="90" />
          <el-table-column label="楼栋" width="80" align="right">
            <template #default="{ row }">{{ row.buildingCount }}</template>
          </el-table-column>
          <el-table-column label="户数" width="80" align="right">
            <template #default="{ row }">{{ row.houses }}</template>
          </el-table-column>
          <el-table-column label="范围内欠费" min-width="120" align="right">
            <template #default="{ row }">¥{{ money(row.debt) }}</template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel">
        <div class="sec__hd"><h4>最近操作</h4><span class="desc">调整与移交留痕</span></div>
        <div class="tl" v-if="logs.length">
          <div v-for="(l, i) in logs" :key="i" class="tl__i is-done">
            <div class="tl__t">{{ l.action }} · {{ l.by }}</div>
            <div class="tl__m">{{ l.memo }} · {{ l.at }}</div>
          </div>
        </div>
        <div v-else class="muted" style="font-size:12px;">本次会话还没有调整记录（原型的操作留痕不落库）</div>
      </div>
    </div>

    <!-- 调整责任人 -->
    <el-dialog v-model="assignVisible" title="调整责任范围" width="520" top="12vh">
      <el-form label-width="96px">
        <el-form-item label="楼栋">
          <span>{{ assignForm.communityName }} {{ assignForm.buildingName }}</span>
        </el-form-item>
        <el-form-item label="范围">
          <el-select v-model="assignForm.unitId" style="width:220px" @change="onScopeChange">
            <el-option label="整栋" value="" />
            <el-option v-for="u in assignUnits" :key="u.unitId" :label="`仅 ${u.name}`" :value="u.unitId" />
          </el-select>
          <div class="muted" style="font-size:11.5px;margin-top:4px;">
            选单元 = 一栋多楼管（该单元单独指定，其余单元仍归整栋责任人）
          </div>
        </el-form-item>
        <el-form-item label="责任楼管" required>
          <el-select v-model="assignForm.empId" filterable clearable placeholder="选择楼管（清空=解除分配）" style="width:260px">
            <el-option v-for="s in stewardOpts" :key="s.empId" :label="s.label" :value="s.empId" />
          </el-select>
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon
          title="保存后立即生效：该楼栋（或单元）的业主资料、租户、账单与催缴，只有新责任人和上级可见。" />
      </el-form>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" @click="doAssign">保存</el-button>
      </template>
    </el-dialog>

    <!-- 责任移交 -->
    <el-dialog v-model="transferVisible" title="责任移交（项目经理执行）" width="560" top="10vh">
      <el-form label-width="96px">
        <el-form-item label="移交人" required>
          <el-select v-model="transferForm.fromEmpId" filterable placeholder="离任楼管" style="width:240px">
            <el-option v-for="s in stewardOpts" :key="s.empId" :label="s.label" :value="s.empId" />
          </el-select>
        </el-form-item>
        <el-form-item label="接收人" required>
          <el-select v-model="transferForm.toEmpId" filterable placeholder="接任楼管" style="width:240px">
            <el-option v-for="s in stewardOpts" :key="s.empId" :label="s.label" :value="s.empId" />
          </el-select>
        </el-form-item>
        <el-form-item label="范围">
          <el-select v-model="transferForm.communityId" clearable placeholder="全部项目（可限定一个项目）" style="width:240px">
            <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
          </el-select>
        </el-form-item>
        <el-form-item label="移交说明">
          <el-input v-model="transferForm.note" type="textarea" :rows="2" placeholder="如：离职交接 / 岗位调整（记入留痕）" />
        </el-form-item>
        <el-alert type="warning" :closable="false" show-icon
          title="移交后：责任台账与房屋快照同时变更；历史催缴记录的操作人不变，只改「该谁继续跟」。" />
      </el-form>
      <template #footer>
        <el-button @click="transferVisible = false">取消</el-button>
        <el-button type="primary" @click="doTransfer">确认移交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PAGE_SIZES, assignSteward, cashierUnitOpts, communities, myStewardScope, queryStewards,
  stewardLogs, stewardOptions, stewardSummary, transferStewards
} from '@/utils/api'
import { currentRoleId } from '@/utils/auth'
import { permCodesOfRole } from '@/utils/rbac'
import { useListQuery } from '@/composables/useQuery'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'
import { exportList } from '@/utils/export'

const canEdit = computed(() => permCodesOfRole(currentRoleId.value).has('a.stewards.edit'))
const stewardOpts = stewardOptions()
const myScope = computed(() => myStewardScope())

const BLANK = { communityId: '', empId: '', kw: '' }
const { rows, total, pageNo, size, loading, query, load, search, reset } =
  useListQuery(queryStewards, { filters: { ...BLANK }, size: 20 })

const ver = ref(0)
const summary = computed(() => { void ver.value; return stewardSummary() })
const logs = computed(() => { void ver.value; return stewardLogs() })

function rowClass({ row }) { return row.uncovered ? 'row--overdue' : '' }
function reload() { ver.value++; load() }

/* ---------- 调整 ---------- */
const assignVisible = ref(false)
const assignUnits = ref([])
const assignForm = reactive({ buildingId: '', communityName: '', buildingName: '', unitId: '', empId: '' })

function openAssign(row) {
  assignForm.buildingId = row.buildingId
  assignForm.communityName = row.communityName
  assignForm.buildingName = row.buildingName
  assignForm.unitId = row.unitId || ''
  assignForm.empId = row.empId || ''
  assignUnits.value = cashierUnitOpts(row.buildingId).map(u => ({ unitId: u.value, name: u.label }))
  assignVisible.value = true
}
function onScopeChange() {
  /* 切范围时把当前责任人带出来，避免误清空 */
  const r = rows.value.find(x => x.buildingId === assignForm.buildingId && (x.unitId || '') === assignForm.unitId)
  assignForm.empId = r ? r.empId : ''
}
function doAssign() {
  try {
    const r = assignSteward({
      buildingId: assignForm.buildingId,
      unitId: assignForm.unitId,
      empId: assignForm.empId,
      operator: '项目经理'
    })
    ElMessage.success(r.changed ? `已更新责任范围（${r.after ? r.after.empName : '未分配'}）` : '没有变化')
    assignVisible.value = false
    reload()
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

/* ---------- 移交 ---------- */
const transferVisible = ref(false)
const transferForm = reactive({ fromEmpId: '', toEmpId: '', communityId: '', note: '' })
function openTransfer() {
  if (!canEdit.value) { ElMessage.warning('责任移交由项目经理执行'); return }
  transferForm.fromEmpId = ''
  transferForm.toEmpId = ''
  transferForm.communityId = ''
  transferForm.note = ''
  transferVisible.value = true
}
async function doTransfer() {
  try {
    const r = transferStewards({ ...transferForm, operator: '项目经理' })
    await ElMessageBox.alert(
      `${r.from} → ${r.to}：${r.moved} 条责任范围、${r.houses} 户已完成移交。`,
      '移交完成', { type: 'success', confirmButtonText: '知道了' }
    )
    transferVisible.value = false
    reload()
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(e?.message || '移交失败')
  }
}

/* ---------- 导出 ---------- */
const EXPORT_COLS = [
  { prop: 'communityName', label: '项目' }, { prop: 'buildingName', label: '楼栋' },
  { prop: 'scopeType', label: '范围' }, { prop: 'unitName', label: '单元' },
  { prop: 'empName', label: '责任楼管' }, { prop: 'houses', label: '户数' },
  { prop: 'tenants', label: '在住租户' }, { prop: 'debtHouses', label: '欠费户' },
  { prop: 'debtAmount', label: '欠费金额' }, { prop: 'from', label: '责任起始' }
]
function onExport() {
  exportList({ name: '楼栋责任范围', source: '/a/stewards', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}
</script>

<style scoped>
.is-warn { color: var(--biz-danger); }
:deep(.el-table__body tr.row--overdue > td.el-table__cell) { background: rgba(236, 77, 99, 0.04); }
</style>
