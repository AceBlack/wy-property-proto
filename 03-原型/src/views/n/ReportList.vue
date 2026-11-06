<!--
  邻里 · 举报处理
  ------------------------------------------------------------
  举报是 UGC 的最后一道闸。这个页面只做一件事：**把"谁举报了什么、为什么"摆清楚**，
  然后逼着处理人写一句说明 —— 事后要能解释为什么这么判。
  不给"一键删除"的原因：删了没有留痕，发布人来问时谁也说不清。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>举报处理</b>：业主在闲置详情里点「举报」，按时间倒序进这里。
        <b>超过 24 小时未处理</b>要在群里说明 —— 邻里纠纷拖一天就会变成两家的矛盾。
        <br />
        四个动作：<b>忽略</b>（不构成违规）、<b>仅警告</b>（不改内容，留记录）、
        <b>下架并警告</b>（内容立即下线）、<b>封禁 7 天</b>（发布人停发）。
        前三个的差别很实在：忽略是"没问题"，仅警告是"有问题但不用删" —— 别混着用。
        <br />
        <b>处理说明必填</b>：不是为了走形式，是因为发布人一定会来问「凭什么删我的东西」。
      </div>
    </div>

    <div class="grid rstats">
      <div class="panel rstat">
        <div class="rstat__k">待处理</div>
        <div class="rstat__v" :class="{ 'is-warn': st.pending }">{{ st.pending }} <span class="unit">条</span></div>
        <div class="rstat__s">按时间正序处理</div>
      </div>
      <div class="panel rstat">
        <div class="rstat__k">已处理</div>
        <div class="rstat__v">{{ st.handled }} <span class="unit">条</span></div>
        <div class="rstat__s">累计 {{ st.total }} 条</div>
      </div>
      <div class="panel rstat">
        <div class="rstat__k">因举报下架</div>
        <div class="rstat__v is-danger">{{ st.offline }} <span class="unit">条</span></div>
        <div class="rstat__s">处理方式为「下架并警告」</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters">
        <el-input v-model="q.kw" clearable placeholder="内容标题 / 举报人 / 说明" :prefix-icon="'Search'"
          style="width:260px;" @keyup.enter="applyFilter" />
        <el-select v-model="q.status" clearable placeholder="全部状态" style="width:120px;" @change="applyFilter">
          <el-option v-for="s in ['待处理', '已处理']" :key="s" :label="s" :value="s" />
        </el-select>
        <el-select v-model="q.reason" clearable placeholder="全部原因" style="width:140px;" @change="applyFilter">
          <el-option v-for="r in REPORT_REASONS" :key="r" :label="r" :value="r" />
        </el-select>
        <el-button type="primary" :icon="'Search'" @click="applyFilter">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>举报队列</h3>
        <span class="spacer" />
        <span class="desc">待处理优先 · 共 {{ total }} 条</span>
      </div>

      <el-table :data="rows" stripe v-loading="loading" style="width:100%">
        <el-table-column label="被举报内容" min-width="220">
          <template #default="{ row }">
            <div class="r-t">{{ row.itemTitle }}</div>
            <div class="sub">{{ row.sellerName }} · {{ row.sellerHouse }} · 当前 {{ row.itemStatus || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="举报原因" width="110">
          <template #default="{ row }">
            <el-tag size="small" type="warning" effect="plain">{{ row.reason }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="举报说明" min-width="240">
          <template #default="{ row }">
            <div class="r-d">{{ row.detail }}</div>
          </template>
        </el-table-column>
        <el-table-column label="举报人" width="150">
          <template #default="{ row }">
            <div class="sub2">{{ row.reporterName }}</div>
            <div class="sub">{{ row.reporterHouse }}</div>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="130">
          <template #default="{ row }">
            <span class="sub2">{{ row.at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.statusType" effect="plain">{{ row.status }}</el-tag>
            <div v-if="row.action" class="sub">{{ row.action }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" align="right">
          <template #default="{ row }">
            <el-button v-if="row.status === '待处理' && canHandle" link type="primary" size="small"
              @click="openHandle(row)">处理</el-button>
            <el-button v-else link type="primary" size="small" @click="openHandle(row)">查看</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState title="没有符合条件的举报" desc="举报会按时间倒序进队列，待处理的排最前" />
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

    <!-- 处理 -->
    <el-drawer v-model="hd.visible" :title="hd.row && hd.row.status === '待处理' ? '处理举报' : '举报详情'" size="520px">
      <template v-if="hd.row">
        <div class="h-hd">
          <div class="h-t">{{ hd.row.itemTitle }}</div>
          <div class="h-m">
            {{ hd.row.sellerName }} · {{ hd.row.sellerHouse }} · 当前状态 {{ hd.row.itemStatus || '—' }}
          </div>
        </div>

        <div class="h-quote">
          <div class="h-quote__hd">
            <el-tag size="small" type="warning" effect="plain">{{ hd.row.reason }}</el-tag>
            <span class="sub">{{ hd.row.reporterName }} 举报于 {{ hd.row.at }}</span>
          </div>
          <div class="h-quote__d">{{ hd.row.detail }}</div>
        </div>

        <template v-if="hd.row.status === '待处理'">
          <div class="sec__hd" style="margin:16px 0 8px;"><h4>处理方式</h4><span class="desc">选一个，写清理由</span></div>
          <el-radio-group v-model="hd.action" class="h-acts">
            <el-radio v-for="a in REPORT_ACTIONS" :key="a" :label="a" :value="a" border>{{ a }}</el-radio>
          </el-radio-group>
          <div class="h-effect">{{ effectText }}</div>

          <el-form label-width="70px" style="margin-top:10px;">
            <el-form-item label="处理说明" required>
              <el-input v-model="hd.note" type="textarea" :rows="3" maxlength="80" show-word-limit
                placeholder="如：核实为无中文标签食品，已下架并通知发布人" />
            </el-form-item>
          </el-form>
          <div class="h-tip">处理说明会留档。发布人来问「凭什么删」时，这就是依据。</div>
        </template>

        <template v-else>
          <el-descriptions :column="1" border size="small" style="margin-top:16px;">
            <el-descriptions-item label="处理方式">{{ hd.row.action }}</el-descriptions-item>
            <el-descriptions-item label="处理说明">{{ hd.row.note }}</el-descriptions-item>
            <el-descriptions-item label="处理人">{{ hd.row.handledBy }}</el-descriptions-item>
            <el-descriptions-item label="处理时间">{{ hd.row.handledAt }}</el-descriptions-item>
          </el-descriptions>
        </template>
      </template>

      <template v-if="hd.row && hd.row.status === '待处理'" #footer>
        <el-button @click="hd.visible = false">取消</el-button>
        <el-button type="primary" :loading="hd.saving" @click="doHandle">提交处理</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { REPORT_ACTIONS, REPORT_REASONS, canHandleReports, handleReport, queryReports, reportStats } from '@/api/neighbor'
import { PAGE_SIZES } from '@/api/shared'
import EmptyState from '@/components/EmptyState.vue'

const canHandle = computed(() => canHandleReports())

const q = reactive({ kw: '', status: '', reason: '' })
const pageNo = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const st = ref({ total: 0, pending: 0, handled: 0, offline: 0 })

async function load() {
  loading.value = true
  try {
    const res = await queryReports({ pageNo: pageNo.value, size: size.value, filters: { ...q } })
    rows.value = res.rows
    total.value = res.total
    st.value = reportStats()
  } catch (e) {
    ElMessage.error(e?.message || '举报列表加载失败')
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function resetFilter() { Object.assign(q, { kw: '', status: '', reason: '' }); applyFilter() }
function onSize() { pageNo.value = 1; load() }

const hd = reactive({ visible: false, saving: false, row: null, action: '下架并警告', note: '' })

const effectText = computed(() => {
  const a = hd.action
  if (a === '忽略') return '内容保持上架，举报标记为已处理（不构成违规）。'
  if (a === '仅警告') return '内容保持上架，向发布人发一条警告记录。'
  if (a === '下架并警告') return hd.row?.itemStatus === '已上架'
    ? '内容立即从业主端下线，并通知发布人下架理由。'
    : `内容当前是「${hd.row?.itemStatus || '—'}」，不改变状态，只记录处理结果。`
  return '发布人 7 天内不能发布新的闲置，已上架内容同时下架。'
})

function openHandle(row) {
  hd.row = row
  hd.action = row.action || '下架并警告'
  hd.note = row.note || ''
  hd.visible = true
}

async function doHandle() {
  if (!hd.note.trim()) { ElMessage.warning('处理说明必填'); return }
  hd.saving = true
  try {
    await handleReport(hd.row.reportId, { action: hd.action, note: hd.note })
    ElMessage.success('已处理')
    hd.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '处理失败')
  } finally {
    hd.saving = false
  }
}

onMounted(load)
</script>

<style scoped>
.rstats { margin-top: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rstat { padding: 14px 16px; }
.rstat__k { font-size: 12.5px; color: var(--biz-text-3); }
.rstat__v {
  font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px;
}
.rstat__v.is-warn { color: var(--biz-warning, #d98a1f); }
.rstat__v.is-danger { color: var(--biz-danger, #d64545); }
.rstat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.rstat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }

.filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.r-t { font-size: 13px; color: var(--biz-text-1); }
.sub { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.sub2 { font-size: 12px; color: var(--biz-text-2); }
.r-d {
  font-size: 12px; color: var(--biz-text-2); line-height: 1.7;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }

.h-hd { padding-bottom: 12px; border-bottom: 1px solid var(--biz-border); }
.h-t { font-size: 15px; color: var(--biz-text-1); font-weight: 600; }
.h-m { font-size: 12px; color: var(--biz-text-3); margin-top: 4px; }
.h-quote {
  margin-top: 12px; padding: 10px 12px; border-radius: 8px;
  background: rgba(217, 138, 31, .07);
}
.h-quote__hd { display: flex; align-items: center; gap: 8px; }
.h-quote__d { font-size: 12.5px; color: var(--biz-text-2); line-height: 1.8; margin-top: 6px; }
.h-acts { display: flex; flex-wrap: wrap; gap: 8px; }
.h-acts :deep(.el-radio) { margin-right: 0; }
.h-effect {
  margin-top: 8px; padding: 8px 10px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 11.5px; line-height: 1.7; color: var(--biz-text-2);
}
.h-tip { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; }
</style>
