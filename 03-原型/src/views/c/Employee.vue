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
          <el-button size="small" :icon="'EditPen'" :disabled="!cur || !canEdit" @click="openEdit">编辑</el-button>
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
            <div class="dl__i"><span class="dl__k">手机</span><span class="dl__v">
              <SensitiveText :value="cur.phone" field="phone" entity-type="员工" :entity-id="cur.empId"
                :entity-name="cur.name" source="/c/employee" />
            </span></div>
            <div class="dl__i"><span class="dl__k">用工</span><span class="dl__v">{{ cur.empType }}</span></div>
            <div class="dl__i is-full"><span class="dl__k">证件</span><span class="dl__v">
              <SensitiveText :value="cur.idCard" field="idCard" entity-type="员工" :entity-id="cur.empId"
                :entity-name="cur.name" source="/c/employee" />
            </span></div>
            <div class="dl__i"><span class="dl__k">上级</span><span class="dl__v">{{ cur.manager }}</span></div>
            <div class="dl__i is-full"><span class="dl__k">入职</span><span class="dl__v">{{ cur.entryDate }}（转正 {{ cur.regularDate }}，试用 {{ cur.probationMonths }} 个月）</span></div>
            <div class="dl__i is-full"><span class="dl__k">合同</span><span class="dl__v">{{ cur.contractStart }} ~ {{ cur.contractEnd }}</span></div>
          </div>

          <div class="sec__hd ec-hd" style="margin:16px 0 8px;">
            <h4>紧急联系人</h4>
            <span class="desc">出事先联系谁</span>
          </div>
          <div v-if="cur.emergencyContact || cur.emergencyPhone" class="dl dl--2">
            <div class="dl__i">
              <span class="dl__k">姓名</span>
              <span class="dl__v">{{ cur.emergencyContact || '—' }}</span>
            </div>
            <div class="dl__i">
              <span class="dl__k">关系</span>
              <span class="dl__v">{{ cur.emergencyRelation || '—' }}</span>
            </div>
            <div class="dl__i is-full">
              <span class="dl__k">联系电话</span>
              <span class="dl__v">
                <SensitiveText v-if="cur.emergencyPhone" :value="cur.emergencyPhone" field="emergencyPhone"
                  entity-type="员工" :entity-id="cur.empId" :entity-name="cur.name" source="/c/employee" />
                <span v-else class="is-empty">—</span>
              </span>
            </div>
          </div>
          <!-- 空态不用"—"了事：这一栏空缺是**要补的**，得说清后果 -->
          <div v-else class="ec-empty">
            <b>未填</b>
            <div>紧急联系人缺失时，突发情况只能联系本人。请补齐姓名、关系与电话，点右上「编辑」录入。</div>
          </div>

          <div class="sec__hd" style="margin:16px 0 8px;"><h4>薪酬</h4></div>
          <!-- 员工域不返回薪资：基本工资 / 月度应发 / 银行卡属工资域（c.payroll.view）。
               档案页显示金额的结果是——能看到员工列表的人，就能看到全公司工资。 -->
          <div class="pay-lock">
            <b>受限</b>
            <div>
              薪酬属「工资域」，需 <code>c.payroll.view</code>。
              <template v-if="payView">当前角色已具备该权限，请到「工资表」查看（本期工资条尚未生成）。</template>
              <template v-else>当前角色无该权限，仅能查看人事档案。</template>
            </div>
          </div>
          <div class="pay" style="margin-top:8px;">
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

    <!-- 编辑：只开紧急联系人这一组。岗位 / 职级 / 组织 / 薪资都不在这里改 ——
         调岗要走调岗单据、薪资要走工资域审批，把它们放进一个表单改，等于绕开留痕。 -->
    <el-drawer v-model="editVisible" title="编辑紧急联系人" size="420px">
      <template v-if="cur">
        <div class="edit-who">
          <b>{{ cur.name }}</b>
          <span class="muted">{{ cur.empNo }} · {{ cur.position }} · {{ orgName(cur.orgId) }}</span>
        </div>
        <el-form label-width="92px" style="margin-top:18px;">
          <el-form-item label="联系人姓名">
            <el-input v-model="editForm.emergencyContact" maxlength="12" placeholder="如：张秀兰" clearable />
          </el-form-item>
          <el-form-item label="与本人关系">
            <el-select v-model="editForm.emergencyRelation" placeholder="选择关系" clearable style="width:100%">
              <el-option v-for="r in relationOpts" :key="r" :label="r" :value="r" />
            </el-select>
          </el-form-item>
          <el-form-item label="联系电话">
            <el-input v-model="editForm.emergencyPhone" maxlength="11" placeholder="11 位手机号" clearable />
          </el-form-item>
        </el-form>
        <div class="edit-tip">
          三项<b>要么都填、要么都空</b>：只填号码不填姓名，出事时不知道该找谁；只填姓名不给号码，等于没留联系方式。
          <br />
          岗位、职级、组织与薪资不在此处修改 —— 调岗走调岗单据、薪资走工资域审批，都需要留痕。
        </div>
      </template>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { EMPLOYEE_RELATION_OPTS, queryEmployees, orgOptions, saveEmployeeProfile } from '@/api'
import { revealSensitive } from '@/utils/api'
import { hasPerm } from '@/utils/auth'
import { useListQuery } from '@/composables/useQuery'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import SensitiveText from '@/components/SensitiveText.vue'
import { daysBetween } from '@/utils/format'

/* 列表查询收归 useListQuery + api，页面不再遍历原始数组 */
const {
  rows, total, pageNo: page, size, loading, query: f, load
} = useListQuery(queryEmployees, { filters: { orgId: '', status: '', kw: '' }, size: 15 })
const cur = ref(null)
watch(rows, r => { if (!cur.value && r.length) cur.value = r[0] })

/* 组织下拉走适配层：页面禁止 import '@/mock'，也不再从 api.js 直接取原始数组 */
const orgOpts = orgOptions()
const orgName = id => orgOpts.find(o => o.orgId === id)?.label || id
/* 薪酬要看工资域的权限位，档案页只做「能不能看」的判断，不自己取数 */
const payView = computed(() => hasPerm('c.payroll.view'))
// 60 天内到期：daysBetween 为「今天 - 到期日」，所以 n ∈ [-60, 0]
const soon = d => { const n = daysBetween(d); return n !== null && n >= -60 && n <= 0 }

function pick(row) { if (row) cur.value = row }

/* ---------- 紧急联系人编辑（2026-11-04） ----------
 * 只开这一组字段。数据层的 updateEmployeeProfile 是整包 patch + 版本号校验，
 * 所以这里必须把 _ver 一起带上 —— 两个人同时改同一份档案时，后提交的会拿到 409 提示刷新，
 * 而不是静默覆盖别人的修改。
 */
const canEdit = computed(() => hasPerm('c.employees.edit'))
const relationOpts = EMPLOYEE_RELATION_OPTS
const editVisible = ref(false)
const saving = ref(false)
const editForm = ref({ emergencyContact: '', emergencyRelation: '', emergencyPhone: '' })

function openEdit() {
  if (!cur.value) return
  /* 列表行里的电话是**掩码**（188****7048）。直接填进编辑框，用户不动它点保存，
     就会把掩码写回数据 —— 紧急联系电话从此变成一串星号，出事时打不通。
     所以打开时先揭示明文（这一次揭示会写访问日志，正是想要的留痕）；
     没有明文权限就留空，由成对校验逼着重新填，而不是带着掩码保存。 */
  let phone = cur.value.emergencyPhone || ''
  if (phone.includes('*')) {
    try {
      phone = revealSensitive({
        entityType: '员工', entityId: cur.value.empId, entityName: cur.value.name,
        field: 'emergencyPhone', value: phone, source: '/c/employee'
      }) || ''
    } catch {
      phone = ''
    }
  }
  editForm.value = {
    emergencyContact: cur.value.emergencyContact || '',
    emergencyRelation: cur.value.emergencyRelation || '',
    emergencyPhone: phone
  }
  editVisible.value = true
}

async function saveEdit() {
  if (!cur.value) return
  const f = editForm.value
  saving.value = true
  try {
    const saved = await saveEmployeeProfile(cur.value.empId, {
      patch: {
        emergencyContact: String(f.emergencyContact || '').trim(),
        emergencyRelation: String(f.emergencyRelation || '').trim(),
        emergencyPhone: String(f.emergencyPhone || '').trim()
      },
      ver: cur.value._ver
    })
    editVisible.value = false
    ElMessage.success('已保存紧急联系人')
    /* 重新取数而不是改本地对象：列表行是脱敏的，就地改会让掩码与真值对不上 */
    await load()
    const hit = rows.value.find(x => x.empId === saved.empId)
    if (hit) cur.value = hit
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
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
.pay-lock { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.6;
  color: var(--biz-text-2); background: var(--biz-bg-fill); border-radius: 8px; padding: 10px; }
.pay-lock b { flex: none; color: var(--biz-warning); font-weight: 600; }
.pay-lock code { font-family: var(--biz-font-num); background: var(--biz-bg-card); padding: 0 4px; border-radius: 4px; }
.att { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.att > div { background: var(--biz-bg-fill); border-radius: 8px; padding: 8px; text-align: center; }
.att b { display: block; font-family: var(--biz-font-num); font-size: 16px; }
.att span { font-size: 11px; color: var(--biz-text-3); }
.certs { display: flex; gap: 6px; flex-wrap: wrap; }
/* 右侧面板只有 360px：标题不许折行，说明文字让步 */
.ec-hd { flex-wrap: nowrap; }
.ec-hd h4 { white-space: nowrap; flex: none; }
.ec-hd .desc { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.is-empty { color: var(--biz-text-3); }
.ec-empty {
  display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 1.6;
  color: var(--biz-text-2); background: var(--biz-bg-fill); border-radius: 8px; padding: 10px;
}
.ec-empty b { flex: none; color: var(--biz-warning); font-weight: 600; }
.edit-who { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.edit-who .muted { font-size: 12px; }
.edit-tip {
  margin-top: 6px; padding: 10px; border-radius: 8px; font-size: 11.5px; line-height: 1.75;
  color: var(--biz-text-2); background: var(--biz-bg-fill);
}
.edit-tip b { color: var(--biz-text-1); }
</style>
