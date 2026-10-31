<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>权限变更日志 · 治理留痕</b>：这是「谁在什么时候，给哪个角色，加了 / 收了哪一个权限」。
        只记「保存了一次角色权限」<b>等于没留痕</b>——审计问的是具体动了哪一位，不是"有人点过保存"。
        <br />
        <b>提权要审批，降权即时生效</b>：新增<b>敏感明文、推翻封账、改权限本身、工资表、责任范围</b>这几类权限
        要先提交审批，通过后才写入；<b>收回</b>这些权限则立即生效——发现谁多给了权限，第一反应是马上掐掉，
        卡在审批队列里等一天等于让漏洞多开一天，收紧只需要留痕不需要拦。
        <b>提交人不能审批自己提交的申请</b>（双人原则），这是「不能给自己提权」的唯一技术保障。
        <br />
        <b>日志只增不删</b>，本页没有任何删除入口。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum">
        <div class="rsum__l">待审批</div>
        <div class="rsum__v" :class="reqStats.pending ? 'money--out' : ''">
          {{ reqStats.pending }}<span class="unit">条</span>
        </div>
        <div class="rsum__s">其中我提交的 {{ reqStats.mine }} 条（自己不能批）</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">变更次数</div>
        <div class="rsum__v">{{ stats.changes }}<span class="unit">次</span></div>
        <div class="rsum__s">{{ stats.operators }} 人操作 · 最近 {{ stats.lastAt || '—' }}</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">授予权限位</div>
        <div class="rsum__v money--in">+{{ stats.granted }}</div>
        <div class="rsum__s">新增能力的总条数（不是角色数）</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">收回权限位</div>
        <div class="rsum__v money--out">-{{ stats.revoked }}</div>
        <div class="rsum__s">按最小权限原则收回的记录</div>
      </div>
    </div>

    <!-- 待审批：高敏权限的先批后生效 -->
    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <span class="toolbar__t">待审批的高敏变更</span>
        <el-tag v-if="pending.length" size="small" type="warning" effect="plain">{{ pending.length }} 条待处理</el-tag>
        <el-tag v-if="reqStats.overdue" size="small" type="danger" effect="dark">
          {{ reqStats.overdue }} 条超时（>24h）
        </el-tag>
        <el-tag v-if="reqStats.overdue" size="small" type="danger" effect="dark">
          {{ reqStats.overdue }} 条超时（>24h）
        </el-tag>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">
          {{ canApprove ? '审批通过后立即写入角色权限，并生成一条变更记录' : '当前角色没有「权限变更审批」权限，只能查看' }}
        </span>
      </div>

      <el-table :data="pending" size="small" style="width:100%" row-key="reqId">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="permdetail">
              <div v-for="r in row.risks" :key="r.code" class="pd__risk">
                <el-icon class="pd__ico"><WarningFilled /></el-icon>
                <b>{{ label(r.code) }}</b>
                <span class="pd__why">{{ r.why }}</span>
                <span class="pd__code">{{ r.code }}</span>
              </div>
              <div v-if="row.added.length" class="pd__grp">
                <span class="pd__t pd__t--in">授予 {{ row.added.length }}</span>
                <el-tag v-for="c in row.added" :key="c" size="small" type="success" effect="plain" class="pd__tag">
                  {{ label(c) }}<span class="pd__code">{{ c }}</span>
                </el-tag>
              </div>
              <div v-if="row.removed.length" class="pd__grp">
                <span class="pd__t pd__t--out">收回 {{ row.removed.length }}</span>
                <el-tag v-for="c in row.removed" :key="c" size="small" type="danger" effect="plain" class="pd__tag">
                  {{ label(c) }}<span class="pd__code">{{ c }}</span>
                </el-tag>
              </div>
              <div class="pd__meta">申请说明：{{ row.reason || '未填写' }} · 记录号 {{ row.reqId }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="reqId" label="申请号" width="96" />
        <el-table-column label="被改角色" min-width="120">
          <template #default="{ row }">
            <div class="nowrap">{{ row.roleName }}</div>
            <div class="ps-sub">{{ row.roleId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="变更" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.addedCount" size="small" type="success" effect="plain">+{{ row.addedCount }}</el-tag>
            <el-tag v-if="row.removedCount" size="small" type="danger" effect="plain" style="margin-left:4px;">
              -{{ row.removedCount }}
            </el-tag>
            <el-tag size="small" type="warning" effect="dark" style="margin-left:4px;">
              高敏 {{ row.risks.length }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="高敏项" min-width="220">
          <template #default="{ row }">
            <el-tooltip placement="top" :content="row.risks.map(r => r.why).join('；')">
              <span class="risktext">{{ row.risks.map(r => label(r.code)).join('、') }}</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="申请人 / 时间" width="180">
          <template #default="{ row }">
            <div class="nowrap">{{ row.submitBy }}</div>
            <div class="ps-sub">{{ row.submitAt }}</div>
            <el-tag v-if="row.overdue" size="small" type="danger" effect="plain">
              已挂 {{ row.ageHours }}h
            </el-tag>
            <el-tag v-if="row.overdue" size="small" type="danger" effect="plain">
              已挂 {{ row.ageHours }}h
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="196" fixed="right">
          <template #default="{ row }">
            <template v-if="row.submitRoleId === roleId">
              <el-tag size="small" type="info" effect="plain">我提交的</el-tag>
              <el-button size="small" text @click="onWithdraw(row)">撤回</el-button>
            </template>
            <template v-else-if="canApprove">
              <el-button size="small" type="primary" plain @click="onApprove(row)">通过</el-button>
              <el-button size="small" type="danger" plain @click="onReject(row)">驳回</el-button>
            </template>
            <span v-else class="muted" style="font-size:12px;">无审批权限</span>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="!pending.length" class="table-foot">
        <span class="muted">没有待审批的高敏变更。普通权限变更直接生效并留痕，不占审批队列。</span>
      </div>
    </div>

    <!-- 变更记录 -->
    <div class="panel" style="margin-top:16px;">
      <el-form :model="query" class="filter-bar" label-width="60px" @submit.prevent>
        <el-form-item label="角色">
          <el-select v-model="query.roleId" placeholder="全部" clearable style="width:130px">
            <el-option v-for="o in roleOpts" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="操作人">
          <el-select v-model="query.operator" placeholder="全部" clearable style="width:140px">
            <el-option v-for="o in operatorOpts" :key="o" :label="o" :value="o" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键字">
          <el-input v-model="query.kw" placeholder="角色 / 原因 / 权限码" clearable style="width:190px" />
        </el-form-item>
        <el-form-item>
          <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        </el-form-item>
      </el-form>

      <div class="toolbar">
        <span class="toolbar__t">变更记录</span>
        <el-tag size="small" effect="plain" type="info">只增不删</el-tag>
        <span class="spacer" />
        <span class="muted" style="font-size:12.5px;">共 {{ total }} 条 · 展开行看逐条权限</span>
      </div>

      <el-table v-loading="loading" :data="rows" size="small" style="width:100%" row-key="changeId">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="permdetail">
              <div v-if="row.added.length" class="pd__grp">
                <span class="pd__t pd__t--in">授予 {{ row.added.length }}</span>
                <el-tag v-for="c in row.added" :key="c" size="small" type="success" effect="plain" class="pd__tag">
                  {{ label(c) }}<span class="pd__code">{{ c }}</span>
                </el-tag>
              </div>
              <div v-if="row.removed.length" class="pd__grp">
                <span class="pd__t pd__t--out">收回 {{ row.removed.length }}</span>
                <el-tag v-for="c in row.removed" :key="c" size="small" type="danger" effect="plain" class="pd__tag">
                  {{ label(c) }}<span class="pd__code">{{ c }}</span>
                </el-tag>
              </div>
              <div class="pd__meta">
                权限位 {{ row.beforeCount }} → {{ row.afterCount }} · 来源 IP {{ row.ip }} · 记录号 {{ row.changeId }}
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="at" label="时间" width="132" />
        <el-table-column prop="operator" label="操作人" width="132" show-overflow-tooltip />
        <el-table-column label="被改角色" min-width="130">
          <template #default="{ row }">
            <div class="nowrap">{{ row.roleName }}</div>
            <div class="ps-sub">{{ row.roleId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="变更" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.addedCount" size="small" type="success" effect="plain">+{{ row.addedCount }}</el-tag>
            <el-tag v-if="row.removedCount" size="small" type="danger" effect="plain" style="margin-left:4px;">
              -{{ row.removedCount }}
            </el-tag>
            <span v-if="!row.addedCount && !row.removedCount" class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因 / 说明" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.reason">{{ row.reason }}</span>
            <span v-else class="muted">未填写</span>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="来源 IP" width="112" />
      </el-table>

      <div v-if="!rows.length" class="table-foot">
        <span class="muted">当前筛选下没有变更记录。权限没被改过也是好消息。</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { currentRoleId, invalidatePerms } from '@/utils/auth'
import {
  approvePermRequest, canApprovePerm, canApproveRequest, permChangeOperatorOpts,
  permChangeRoleOpts, permChangeStats, permLabelOf, permRequestStats, queryPermLogs,
  queryPermRequests, rejectPermRequest, withdrawPermRequest
} from '@/api'

const query = reactive({ roleId: '', operator: '', kw: '' })
const roleOpts = ref(permChangeRoleOpts())
const operatorOpts = ref(permChangeOperatorOpts())
const rows = ref([])
const total = ref(0)
const pending = ref([])
const stats = ref({ changes: 0, granted: 0, revoked: 0, operators: 0, lastAt: '' })
const reqStats = ref({ pending: 0, approved: 0, rejected: 0, mine: 0 })
const canApprove = ref(false)
const loading = ref(false)
const roleId = currentRoleId
const label = code => permLabelOf(code)

/**
 * 数据改为异步拉取：日志是分页的，前端 reduce 只能算当前页——
 * 「本月变更 20 次」其实是「这一页 20 条」，这类数字比没有更糟。
 */
async function load() {
  loading.value = true
  try {
    const [logs, reqs] = await Promise.all([
      queryPermLogs({ roleId: query.roleId, operator: query.operator, kw: query.kw, pageNo: 1, size: 100 }),
      queryPermRequests({ status: '待审批' })
    ])
    rows.value = logs.rows
    total.value = logs.total
    pending.value = reqs.rows
    stats.value = await permChangeStats({ roleId: query.roleId, operator: query.operator, kw: query.kw })
    reqStats.value = await permRequestStats()
    canApprove.value = canApprovePerm()
    roleOpts.value = permChangeRoleOpts()
    operatorOpts.value = permChangeOperatorOpts()
  } catch (e) {
    ElMessage.error(e?.message || '加载失败')
  } finally {
    loading.value = false
  }
}

function refresh() {
  /* 审批会写角色权限：通知守卫与菜单重新求值（不重复写数据） */
  invalidatePerms()
  load()
}

watch(query, load, { deep: true })
onMounted(load)

async function onApprove(row) {
  if (!canApproveRequest(row)) return
  try {
    await ElMessageBox.confirm(
      `通过后「${row.roleName}」将立即获得 ${row.addedCount} 个、失去 ${row.removedCount} 个权限位` +
      `（新增含 ${row.risks.length} 项高敏）。\n这会立刻影响该角色所有在用的账号，并生成一条不可删除的变更记录。`,
      `${row.reqId} · 确认通过`,
      { type: 'warning', confirmButtonText: '确认通过', cancelButtonText: '再核一遍' }
    )
  } catch { return }
  try {
    const req = await approvePermRequest(row.reqId)
    refresh()
    ElMessage.success(`已通过 ${req.reqId}：「${req.roleName}」权限已更新（记录 ${req.changeId || '—'}）`)
  } catch (e) {
    ElMessage.error(e?.message || '审批失败')
  }
}

async function onReject(row) {
  let note = ''
  try {
    const r = await ElMessageBox.prompt(
      `驳回 ${row.reqId}（${row.roleName}）。请写清原因——申请人要知道为什么被拒，而不是只收到"不同意"。`,
      '驳回变更申请',
      {
        type: 'warning', confirmButtonText: '确认驳回', cancelButtonText: '取消',
        inputType: 'textarea', inputPlaceholder: '如：改权限的能力不能给业务岗，用数据范围解决',
        inputValidator: v => (String(v || '').trim().length >= 4) || '原因至少 4 个字'
      }
    )
    note = r.value
  } catch { return }
  try {
    await rejectPermRequest(row.reqId, note)
    refresh()
    ElMessage.success(`已驳回 ${row.reqId}：权限未改变`)
  } catch (e) {
    ElMessage.error(e?.message || '驳回失败')
  }
}

async function onWithdraw(row) {
  try {
    await ElMessageBox.confirm(
      `撤回 ${row.reqId}？撤回后该申请作废，需要重新提交。`,
      '撤回申请', { type: 'warning', confirmButtonText: '确认撤回', cancelButtonText: '取消' }
    )
  } catch { return }
  try {
    await withdrawPermRequest(row.reqId)
    refresh()
    ElMessage.success(`已撤回 ${row.reqId}`)
  } catch (e) {
    ElMessage.error(e?.message || '撤回失败')
  }
}

function reset() {
  query.roleId = ''
  query.operator = ''
  query.kw = ''
}
</script>

<style scoped>
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.toolbar__t { font-size: 14px; font-weight: 600; color: var(--biz-text-1); }
.toolbar .spacer { flex: 1; }
.rsum { padding: 12px 16px; }
.rsum__l { font-size: 12px; color: var(--biz-text-3); }
.rsum__v { font-size: 20px; font-weight: 600; color: var(--biz-text-1); margin-top: 4px; }
.rsum__s { font-size: 12px; color: var(--biz-text-3); margin-top: 4px; }
.permdetail { padding: 4px 12px 8px 48px; }
.pd__grp { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.pd__t { font-size: 12px; font-weight: 600; min-width: 62px; }
.pd__t--in { color: #4a9d5f; }
.pd__t--out { color: #c45656; }
.pd__tag { font-family: inherit; }
.pd__code { font-size: 11px; opacity: .55; margin-left: 4px; }
.pd__meta { margin-top: 8px; font-size: 12px; color: var(--biz-text-3); }
.pd__risk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #c45656; margin-top: 4px; }
.pd__ico { color: #e6a23c; }
.pd__why { color: var(--biz-text-3); }
.risktext { color: #c45656; cursor: help; }
</style>
