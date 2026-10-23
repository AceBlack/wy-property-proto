<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>员工档案</b>：以人事档案为中心，串联「合同 → 证照 → 考勤 → 薪酬 → 异动」。
        员工同时是系统用户（登录账号、角色、数据权限在 E 平台底座统一维护），本页只管人事属性。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:minmax(0,1fr) 360px;">
      <div class="panel">
        <div class="toolbar">
          <el-select v-model="f.orgId" placeholder="项目/部门" clearable style="width:150px;">
            <el-option v-for="o in orgOpts" :key="o.orgId" :label="o.name" :value="o.orgId" />
          </el-select>
          <el-select v-model="f.status" placeholder="状态" clearable style="width:110px;">
            <el-option v-for="s in ['在职', '试用', '离职']" :key="s" :label="s" :value="s" />
          </el-select>
          <el-input v-model="f.kw" placeholder="姓名 / 工号 / 手机" clearable style="width:190px;" />
          <span class="spacer" />
          <el-button type="primary" :icon="'Plus'">新增员工</el-button>
          <el-button :icon="'Download'">导出</el-button>
        </div>

        <el-table v-loading="loading" :data="rows" max-height="calc(100vh - 340px)" highlight-current-row @current-change="pick">
          <el-table-column prop="empNo" label="工号" width="100" />
          <el-table-column prop="name" label="姓名" width="90" />
          <el-table-column prop="position" label="岗位" width="120" />
          <el-table-column label="所属" min-width="130">
            <template #default="{ row }">{{ orgName(row.orgId) }}</template>
          </el-table-column>
          <el-table-column prop="level" label="职级" width="70" align="center" />
          <el-table-column prop="empType" label="用工" width="80" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }"><StatusTag domain="employee" :value="row.status" /></template>
          </el-table-column>
          <el-table-column prop="entryDate" label="入职日期" width="110" />
          <el-table-column label="合同到期" width="120">
            <template #default="{ row }">
              <span :class="{ 'is-warn': soon(row.contractEnd) }">{{ row.contractEnd }}</span>
            </template>
          </el-table-column>
          <template #empty><EmptyState type="search" desc="换个条件试试" /></template>
        </el-table>

        <div class="table-foot">
          <el-pagination v-model:current-page="page" :page-size="size" :total="total"
            layout="total, prev, pager, next" />
        </div>
      </div>

      <!-- 详情 -->
      <div class="panel">
        <div class="panel__hd"><h3>档案详情</h3><span class="spacer" />
          <el-button size="small" :icon="'EditPen'">编辑</el-button>
        </div>
        <template v-if="cur">
          <div class="emp">
            <div class="emp__ava">{{ cur.name.slice(0, 1) }}</div>
            <div>
              <div class="emp__n">{{ cur.name }}
                <StatusTag domain="employee" :value="cur.status" />
              </div>
              <div class="emp__d">{{ cur.position }} · {{ orgName(cur.orgId) }} · {{ cur.level }}</div>
            </div>
          </div>

          <div class="dl dl--2" style="margin-top:14px;">
            <div class="dl__i"><span class="dl__k">工号</span><span class="dl__v">{{ cur.empNo }}</span></div>
            <div class="dl__i"><span class="dl__k">性别</span><span class="dl__v">{{ cur.gender }}</span></div>
            <div class="dl__i"><span class="dl__k">手机</span><span class="dl__v">{{ maskPhone(cur.phone) }}</span></div>
            <div class="dl__i"><span class="dl__k">用工</span><span class="dl__v">{{ cur.empType }}</span></div>
            <div class="dl__i is-full"><span class="dl__k">证件</span><span class="dl__v">{{ maskId(cur.idCard) }}</span></div>
            <div class="dl__i"><span class="dl__k">上级</span><span class="dl__v">{{ cur.manager }}</span></div>
            <div class="dl__i is-full"><span class="dl__k">入职</span><span class="dl__v">{{ cur.entryDate }}（转正 {{ cur.regularDate }}，试用 {{ cur.probationMonths }} 个月）</span></div>
            <div class="dl__i is-full"><span class="dl__k">合同</span><span class="dl__v">{{ cur.contractStart }} ~ {{ cur.contractEnd }}</span></div>
          </div>

          <div class="sec__hd" style="margin:16px 0 8px;"><h4>薪酬</h4></div>
          <div class="pay">
            <div><span>基本工资</span><b class="money">{{ money(cur.baseSalary) }}</b></div>
            <div><span>月度应发</span><b class="money">{{ money(cur.monthlySalary) }}</b></div>
            <div><span>社保</span><b>{{ cur.socialSecurity ? '已缴' : '未缴' }}</b></div>
          </div>

          <div class="sec__hd" style="margin:16px 0 8px;"><h4>本月考勤</h4></div>
          <div class="att">
            <div><b>{{ cur.attendance.late }}</b><span>迟到</span></div>
            <div><b>{{ cur.attendance.leaveDays }}</b><span>请假(天)</span></div>
            <div><b>{{ cur.attendance.overtimeHours }}</b><span>加班(时)</span></div>
            <div><b>{{ cur.score }}</b><span>绩效分</span></div>
          </div>

          <div class="sec__hd" style="margin:16px 0 8px;"><h4>证照</h4></div>
          <div v-if="cur.certificates.length" class="certs">
            <span v-for="c in cur.certificates" :key="c" class="tag tag--info">{{ c }}</span>
          </div>
          <div v-else class="muted" style="font-size:12px;">暂无证照记录</div>
        </template>
        <EmptyState v-else type="empty" desc="请选择左侧员工" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { orgs, queryEmployees } from '@/utils/api'
import { useListQuery } from '@/composables/useQuery'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { maskId, maskPhone, money } from '@/utils/format'
import { daysBetween } from '@/utils/format'

/* 列表查询收归 useListQuery + api，页面不再遍历原始数组 */
const {
  rows, total, pageNo: page, size, loading, query: f, search
} = useListQuery(queryEmployees, { filters: { orgId: '', status: '', kw: '' }, size: 15 })
const cur = ref(null)
watch(rows, r => { if (!cur.value && r.length) cur.value = r[0] })

const orgOpts = orgs
const orgName = id => orgs.find(o => o.orgId === id)?.name || id
// 60 天内到期：daysBetween 为「今天 - 到期日」，所以 n ∈ [-60, 0]
const soon = d => { const n = daysBetween(d); return n !== null && n >= -60 && n <= 0 }

function pick(row) { if (row) cur.value = row }
</script>

<style scoped>
.is-warn { color: var(--biz-warning); }
.emp { display: flex; align-items: center; gap: 12px; }
.emp__ava { width: 44px; height: 44px; border-radius: 50%; background: var(--biz-gradient); color: #fff; display: grid; place-items: center; font-size: 16px; font-weight: 600; }
.emp__n { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.emp__d { font-size: 12px; color: var(--biz-text-3); margin-top: 3px; }
.pay { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--biz-text-2); }
.pay > div { display: flex; justify-content: space-between; }
.pay b { color: var(--biz-text-1); }
.att { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.att > div { background: var(--biz-bg-fill); border-radius: 8px; padding: 8px; text-align: center; }
.att b { display: block; font-family: var(--biz-font-num); font-size: 16px; }
.att span { font-size: 11px; color: var(--biz-text-3); }
.certs { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
