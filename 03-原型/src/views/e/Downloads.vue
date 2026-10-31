<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>下载中心</b>：全站导出的唯一出口 —— 各页面点「导出」只是<b>提交任务</b>，
        不在页面内生成文件；生成、下载、失败重试都在这里完成。
        文件有效期 <b>24 小时</b>，超时任务需回来源页重新导出。
        <b>原型限制</b>：文件存在浏览器会话里，刷新后未完成的任务会置为失败（可重试）。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel dsum">
        <div class="dsum__l">任务总数</div><div class="dsum__v">{{ sum.total }}</div>
      </div>
      <div class="panel dsum">
        <div class="dsum__l">排队 / 生成中</div><div class="dsum__v">{{ sum.pending }}</div>
      </div>
      <div class="panel dsum">
        <div class="dsum__l">已完成</div><div class="dsum__v ok">{{ sum.done }}</div>
      </div>
      <div class="panel dsum">
        <div class="dsum__l">失败 / 已过期</div><div class="dsum__v bad">{{ sum.failed + sum.expired }}</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="dfilter">
        <el-select v-model="query.status" placeholder="状态" clearable style="width:110px">
          <el-option v-for="s in STATUS_OPTS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-select v-model="query.type" placeholder="来源" clearable style="width:100px">
          <el-option label="报表" value="报表" />
          <el-option label="列表" value="列表" />
        </el-select>
        <el-input v-model="query.kw" placeholder="任务名 / 任务号" clearable style="width:180px" />
        <el-button :icon="'Search'" @click="search">查询</el-button>
        <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
        <span class="spacer" />
        <!-- 开关状态存在 store 里：离开页面再回来仍与真实状态一致（不能用组件内 ref，会丢） -->
        <el-checkbox :model-value="exportFailMode" @change="onFailMode">
          模拟生成失败<el-tooltip content="用于演示「失败 → 重试」分支，与异常态规范页同款思路" placement="top">
            <el-icon class="tip"><QuestionFilled /></el-icon>
          </el-tooltip>
        </el-checkbox>
        <el-button :icon="'Delete'" :disabled="!sum.done && !sum.failed && !sum.expired" @click="onClear">
          清理已结束
        </el-button>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <EmptyState
        v-if="!rows.length" type="empty"
        title="还没有导出任务"
        desc="到任意列表页或报表页点「导出」，任务会出现在这里"
      >
        <template #action>
          <el-button type="primary" @click="$router.push('/e/reports')">去报表中心</el-button>
        </template>
      </EmptyState>

      <el-table v-else :data="rows" size="small" border stripe height="440">
        <el-table-column prop="id" label="任务号" width="120" />
        <el-table-column prop="name" label="任务名称" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.name }}</span>
            <span class="dtype">{{ row.type }}</span>
          </template>
        </el-table-column>
        <el-table-column label="条数" width="70" align="right">
          <template #default="{ row }">{{ row.count || '—' }}</template>
        </el-table-column>
        <el-table-column label="大小" width="80" align="right">
          <template #default="{ row }">{{ row.status === '已完成' ? sizeText(row.size) : '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <StatusTag v-if="row.status !== '生成中'" domain="download" :value="row.status" />
            <div v-else class="prog">
              <el-progress :percentage="row.progress" :stroke-width="6" :show-text="false" />
              <span class="prog__t">{{ row.progress }}%</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="发起时间" width="120" />
        <el-table-column label="有效期" width="90">
          <template #default="{ row }">{{ expireText(row) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="118" align="center">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="row.status !== '已完成'" @click="onDownload(row)">下载</el-button>
            <el-button link type="warning" :disabled="!['失败', '已过期'].includes(row.status)" @click="onRetry(row)">
              重试
            </el-button>
            <el-button link @click="onRemove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty><span /></template>
      </el-table>

      <div v-if="rows.some(r => r.error)" class="derr">
        <b>最近一次失败原因：</b>{{ rows.find(r => r.error)?.error }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import EmptyState from '@/components/EmptyState.vue'
import StatusTag from '@/components/StatusTag.vue'
import {
  STATUS_OPTS, clearFinished, downloadTask, expireText, exportFailMode, listTasks, removeTask,
  retryTask, setExportFailMode, sizeText, sweepTasks, taskSummary
} from '@/utils/download'

/* 进页面先做一次任务清理：过期文件释放存储、7 天前的失败记录移除（避免 localStorage 越滚越大） */
sweepTasks()

const query = reactive({ status: '', type: '', kw: '' })
const searchQ = reactive({ ...query })
function search() { Object.assign(searchQ, query) }
function reset() {
  Object.assign(query, { status: '', type: '', kw: '' })
  Object.assign(searchQ, query)
}
watch(query, () => Object.assign(searchQ, query), { deep: true })

// 任务列表本身是响应式的：任务在后台推进进度，这里无需轮询
const rows = computed(() => listTasks(searchQ))
const sum = computed(() => taskSummary())

function onFailMode(v) {
  setExportFailMode(v)
  ElMessage({
    message: v ? '已开启：之后提交的导出任务会模拟生成失败，用于演示重试' : '已关闭失败模拟',
    type: v ? 'warning' : 'success', duration: 1800
  })
}

function onDownload(row) {
  const r = downloadTask(row.id)
  if (r.ok) ElMessage.success(`${row.name}：${r.msg}`)
  else ElMessage.warning(r.msg)
}
function onRetry(row) {
  if (retryTask(row.id)) ElMessage.info(`已重新提交「${row.name}」`)
}
async function onRemove(row) {
  try {
    await ElMessageBox.confirm(`删除任务「${row.name}」？已生成的文件会一并清除。`, '删除确认', {
      confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning'
    })
  } catch { return }
  removeTask(row.id)
  ElMessage.success('已删除')
}
async function onClear() {
  try {
    await ElMessageBox.confirm('清理所有已完成 / 失败 / 已过期的任务记录？', '清理确认', {
      confirmButtonText: '清理', cancelButtonText: '取消', type: 'warning'
    })
  } catch { return }
  clearFinished()
  ElMessage.success('已清理')
}
</script>

<style scoped>
.dfilter { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; height: 40px; }
.dfilter .spacer { flex: 1; }
.dsum { padding: 12px 16px; }
.dsum__l { font-size: 12px; color: var(--biz-text-3); }
.dsum__v { font-size: 20px; font-weight: 600; color: var(--biz-text-1); margin-top: 4px; }
.dsum__v.ok { color: var(--biz-success, #34c38f); }
.dsum__v.bad { color: var(--biz-danger, #ff6b6b); }
.dtype {
  font-size: 11px; color: var(--biz-text-3); background: var(--biz-bg-2);
  border-radius: 4px; padding: 0 5px; margin-left: 6px;
}
.prog { display: flex; align-items: center; gap: 6px; }
.prog :deep(.el-progress) { flex: 1; }
.prog__t { font-size: 11px; color: var(--biz-text-3); width: 30px; }
.tip { margin-left: 4px; color: var(--biz-text-3); }
.derr {
  margin-top: 10px; font-size: 12.5px; color: var(--biz-danger, #ff6b6b);
  background: var(--biz-bg-2); border-radius: 8px; padding: 8px 12px;
}
</style>
