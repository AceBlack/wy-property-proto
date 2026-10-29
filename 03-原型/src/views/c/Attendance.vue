<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>考勤 · A 级交互</b>：月度考勤汇总 + 排班两张表。①按月份 / 项目 / 岗位 / 状态筛选，异常行标红；
        ②「班次」可直接调整（内存态）；③有申诉的记录可「通过 / 驳回」，通过后冲抵异常。
        出勤率口径：<code>实际出勤天数 / 应出勤天数</code>，请假与旷工不计入实际出勤。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(5,minmax(0,1fr));">
      <div class="panel rsum"><div class="rsum__l">考勤月份</div><div class="rsum__v" style="font-size:17px;">{{ sum.month }}</div></div>
      <div class="panel rsum"><div class="rsum__l">在册人数</div><div class="rsum__v">{{ sum.headcount }}<span class="unit">人</span></div></div>
      <div class="panel rsum"><div class="rsum__l">平均出勤率</div><div class="rsum__v">{{ sum.avgRate }}<span class="unit">%</span></div></div>
      <div class="panel rsum"><div class="rsum__l">迟到 / 旷工</div><div class="rsum__v">{{ sum.late }}<span class="unit">/ {{ sum.absent }}</span></div></div>
      <div class="panel rsum"><div class="rsum__l">异常 / 申诉</div><div class="rsum__v money--out">{{ sum.abnormal }}<span class="unit">/ {{ sum.appeal }}</span></div></div>
    </div>

    <el-tabs v-model="tab" style="margin-top:16px;">
      <el-tab-pane label="月度考勤" name="month">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="query" class="filter-bar" label-width="60px" @submit.prevent>
            <el-form-item label="月份">
              <el-select v-model="query.month" style="width:110px" @change="onMonth">
                <el-option v-for="m in ATTENDANCE_MONTHS()" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
            <el-form-item label="项目">
              <el-select v-model="query.communityId" placeholder="全部" clearable style="width:120px">
                <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="岗位">
              <el-select v-model="query.position" placeholder="全部" clearable filterable style="width:120px">
                <el-option v-for="p in positions" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:100px">
                <el-option v-for="s in ATTENDANCE_STATUS" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="姓名 / 工号" clearable style="width:140px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出月考勤</el-button>
            <span class="spacer" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 条</span>
          </div>
          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 420px)"
            :row-class-name="rowClass">
            <el-table-column prop="empName" label="姓名" min-min-width="90" show-overflow-tooltip />
            <el-table-column prop="empNo" label="工号" min-width="90" />
            <el-table-column prop="position" label="岗位" min-min-width="110" show-overflow-tooltip />
            <el-table-column prop="month" label="月份" min-width="90" />
            <el-table-column prop="shouldDays" label="应出勤" min-width="80" align="right" />
            <el-table-column prop="actualDays" label="实际出勤" min-width="90" align="right" />
            <el-table-column label="出勤率" min-width="90" align="right">
              <template #default="{ row }">
                <span :class="row.attRate < 90 ? 'money--out' : ''">{{ row.attRate }}%</span>
              </template>
            </el-table-column>
            <el-table-column prop="late" label="迟到" min-width="70" align="right" />
            <el-table-column prop="earlyLeave" label="早退" min-width="70" align="right" />
            <el-table-column prop="absent" label="旷工" min-width="70" align="right" />
            <el-table-column prop="leaveDays" label="请假" min-width="70" align="right" />
            <el-table-column prop="overtimeHours" label="加班(h)" min-width="90" align="right" />
            <el-table-column label="状态" min-min-width="90">
              <template #default="{ row }"><StatusTag domain="attendance" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button
                  link type="primary" :disabled="!row.appealCount"
                  @click="openAppeal(row)"
                >{{ row.appealCount ? '处理申诉' : '无申诉' }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="pager">
            <el-pagination
              background layout="total, sizes, prev, pager, next"
              :total="total" :current-page="pageNo" :page-size="size" :page-sizes="PAGE_SIZES"
              @current-change="p => { pageNo.value = p; load() }" @size-change="s => { size.value = s; load() }"
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="排班" name="shift">
        <div class="panel" style="margin-top:12px;">
          <el-form :model="sq" class="filter-bar" label-width="60px" @submit.prevent>
            <el-form-item label="月份">
              <el-select v-model="sq.month" style="width:110px" @change="loadS">
                <el-option v-for="m in ATTENDANCE_MONTHS()" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
            <el-form-item label="岗位">
              <el-select v-model="sq.position" placeholder="全部" clearable filterable style="width:120px" @change="loadS">
                <el-option v-for="p in positions" :key="p" :label="p" :value="p" />
              </el-select>
            </el-form-item>
            <el-form-item label="班次">
              <el-select v-model="sq.shift" placeholder="全部" clearable style="width:110px" @change="loadS">
                <el-option v-for="s in SHIFTS" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item class="acts">
              <span class="muted" style="font-size:12.5px;">班次调整即时生效（内存态，刷新还原）</span>
            </el-form-item>
          </el-form>
        </div>
        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <span class="muted" style="font-size:12.5px;">共 {{ sRows.length }} 条排班</span>
          </div>
          <el-table :data="sRows" style="width:100%" max-height="calc(100vh - 400px)">
            <el-table-column prop="empName" label="姓名" width="90" />
            <el-table-column prop="empNo" label="工号" width="90" />
            <el-table-column prop="position" label="岗位" width="110" />
            <el-table-column prop="month" label="月份" width="90" />
            <el-table-column label="班次" width="140">
              <template #default="{ row }">
                <el-select v-model="row.shift" size="small" style="width:110px" @change="v => onShift(row, v)">
                  <el-option v-for="s in SHIFTS" :key="s" :label="s" :value="s" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column prop="shouldDays" label="应出勤" width="80" align="right" />
            <el-table-column label="班次说明" min-width="220">
              <template #default="{ row }"><span class="muted">{{ shiftDesc(row.shift) }}</span></template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="appealVisible" title="考勤申诉处理" width="460">
      <el-form v-if="cur" label-width="80px">
        <el-form-item label="员工">{{ cur.empName }} · {{ cur.position }} · {{ cur.month }}</el-form-item>
        <el-form-item label="异常项">
          迟到 {{ cur.late }} 次 / 早退 {{ cur.earlyLeave }} 次 / 旷工 {{ cur.absent }} 天
        </el-form-item>
        <el-form-item label="处理意见">
          <el-radio-group v-model="appealPass">
            <el-radio-button :value="true">通过（冲抵异常）</el-radio-button>
            <el-radio-button :value="false">驳回（维持原记录）</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="appealMemo" type="textarea" :rows="2" placeholder="选填，写入考勤备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="appealVisible = false">取消</el-button>
        <el-button type="primary" @click="doAppeal">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import StatusTag from '@/components/StatusTag.vue'
import { useListQuery } from '@/composables/useQuery'
import { exportList } from '@/utils/export'
import {
  ATTENDANCE_MONTHS, ATTENDANCE_STATUS, PAGE_SIZES, SHIFTS, attendanceSummary,
  communityOpts, handleAppeal, queryAttendance, saveShift
} from '@/utils/api'

const tab = ref('month')
const months = ATTENDANCE_MONTHS()
const sum = ref(attendanceSummary(months[0]))
const positions = ['项目经理', '客服主管', '客服专员', '安保主管', '保安', '环境主管', '保洁员',
  '工程主管', '维修工', '财务主管', '会计', '收银员', '人事专员', '品质专员', '总经理']

const { rows, total, pageNo, size, loading, query, load, search, reset } = useListQuery(queryAttendance, {
  filters: { month: months[0], communityId: '', position: '', status: '', shift: '', kw: '' }, size: 20
})
function onMonth() { sum.value = attendanceSummary(query.month); search(); loadS() }
function rowClass({ row }) { return row.status === '异常' ? 'row--danger' : '' }

// —— 排班 ——
const sq = ref({ month: months[0], position: '', shift: '' })
const sRows = ref([])
async function loadS() {
  const res = await queryAttendance({
    pageNo: 1, size: 100,
    filters: { month: sq.value.month, position: sq.value.position, shift: sq.value.shift }
  })
  sRows.value = res.rows
}
loadS()
async function onShift(row, v) {
  try {
    saveShift(row.attId, v)
    ElMessage.success(`${row.empName} 班次已改为「${v}」`)
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}
function shiftDesc(s) {
  return ({
    行政班: '09:00–18:00，周末双休', 早班: '07:00–15:00，覆盖早高峰',
    晚班: '15:00–23:00，覆盖夜间报事', 轮班: '按排班表轮换，含夜班'
  })[s] || '—'
}

// —— 申诉 ——
const cur = ref(null)
const appealVisible = ref(false)
const appealPass = ref(true)
const appealMemo = ref('')
function openAppeal(row) {
  cur.value = row
  appealPass.value = true
  appealMemo.value = ''
  appealVisible.value = true
}
async function doAppeal() {
  try {
    const a = handleAppeal(cur.value.attId, appealPass.value, appealMemo.value)
    ElMessage.success(`${a.empName} 申诉${appealPass.value ? '通过，异常已冲抵' : '驳回，维持原记录'}`)
    appealVisible.value = false
    sum.value = attendanceSummary(query.month)
    load()
  } catch (e) { ElMessage.error(e?.message || '处理失败') }
}

const COLS = [
  { prop: 'empName', label: '姓名' }, { prop: 'empNo', label: '工号' },
  { prop: 'position', label: '岗位' }, { prop: 'month', label: '月份' },
  { prop: 'shouldDays', label: '应出勤' }, { prop: 'actualDays', label: '实际出勤' },
  { prop: 'attRate', label: '出勤率(%)' }, { prop: 'late', label: '迟到' },
  { prop: 'absent', label: '旷工' }, { prop: 'overtimeHours', label: '加班' },
  { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '月度考勤', source: '/c/attendance', columns: COLS, rows: rows.value, filters: { ...query } })
}
</script>
