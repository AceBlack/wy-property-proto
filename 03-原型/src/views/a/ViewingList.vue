<!--
  A 域 · 看房请求（2026-11-06 第 69 批）
  ------------------------------------------------------------
  这一页只回答一个问题：**谁在等我们回电话，等了多久**。
  对外不展示楼管手机号，所以访客留的号码就是唯一的联系线索 —— 超时没人回，
  这条线索就死了，而且访客记住的是"物业发信息没人理"。
-->
<template>
  <div class="page">
    <div class="back-line">
      <el-button link type="primary" :icon="'ArrowLeft'" @click="$router.push('/a/listings')">返回租售信息</el-button>
    </div>

    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>看房请求</b>：访客在房源详情页点「我要看房」，留下称呼 + 手机号 + 方便时间，
        系统生成一条请求，分给<b>该房的责任楼管</b>回拨。
        <br />
        <b>不建账号</b>：只是一个号码，用于这一次联系。不校验短信、不进客户池、<b>不做营销</b>；
        <b>90 天后自动清理</b>（成交 / 关单的立即清理）。这条要写进隐私政策 ——
        不写，将来一定有人把这张表导出来群发。
        <br />
        <b>24 小时没回拨就标红</b>，48 小时仍没联系会升到楼管的直属上级。
        不展示电话之后，访客唯一的出路就是等 —— 回拨时效是这套设计的生命线。
      </div>
    </div>

    <div class="grid vstats">
      <div class="panel vstat">
        <div class="vstat__k">待联系</div>
        <div class="vstat__v" :class="{ 'is-warn': st.pending }">{{ st.pending }} <span class="unit">条</span></div>
        <div class="vstat__s" :class="{ 'is-danger': st.overdue }">{{ st.overdue }} 条超 24 小时未回拨</div>
      </div>
      <div class="panel vstat">
        <div class="vstat__k">已联系</div>
        <div class="vstat__v is-ok">{{ st.contacted }} <span class="unit">条</span></div>
        <div class="vstat__s">打完电话并记了结果</div>
      </div>
      <div class="panel vstat">
        <div class="vstat__k">已带看</div>
        <div class="vstat__v">{{ st.visited }} <span class="unit">条</span></div>
        <div class="vstat__s">业主或楼管带去看了房</div>
      </div>
      <div class="panel vstat">
        <div class="vstat__k">已关闭</div>
        <div class="vstat__v is-muted">{{ st.closed }} <span class="unit">条</span></div>
        <div class="vstat__s">租别处 / 联系不上 / 已成交</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters">
        <el-input v-model="q.kw" clearable placeholder="房号 / 联系人 / 手机" :prefix-icon="'Search'"
          style="width:220px;" @keyup.enter="applyFilter" />
        <el-select v-model="q.status" clearable placeholder="全部状态" style="width:130px;" @change="applyFilter">
          <el-option v-for="s in VIEWING_STATUS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-checkbox v-model="q.overdue" @change="applyFilter">只看超时</el-checkbox>
        <el-button type="primary" :icon="'Search'" @click="applyFilter">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>请求列表</h3>
        <span class="spacer" />
        <span class="desc">待联系优先，按等待时长正序 · 共 {{ total }} 条</span>
      </div>

      <el-table :data="rows" stripe v-loading="loading" style="width:100%">
        <el-table-column label="房源" min-width="210">
          <template #default="{ row }">
            <div class="v-t">{{ row.communityName }} {{ row.buildingName }}{{ row.room }}</div>
            <div class="sub">{{ row.houseType }} · {{ row.area }}㎡ · ¥{{ money(row.price) }}/月</div>
          </template>
        </el-table-column>
        <el-table-column label="联系人" width="170">
          <template #default="{ row }">
            <div>{{ row.name }}</div>
            <div class="sub mono">{{ row.phone }}</div>
          </template>
        </el-table-column>
        <el-table-column label="方便时间" width="110">
          <template #default="{ row }"><span class="sub2">{{ row.preferredTime }}</span></template>
        </el-table-column>
        <el-table-column label="留言" min-width="180">
          <template #default="{ row }">
            <div class="v-note">{{ row.note || '—' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="责任楼管" width="110">
          <template #default="{ row }"><span class="sub2">{{ row.stewardName }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="192">
          <template #default="{ row }">
            <el-tag size="small" :type="row.statusType" effect="plain">{{ row.status }}</el-tag>
            <div v-if="row.status === '待联系'" class="sub" :class="{ 'is-danger': row.overdue }">
              已等 {{ row.hoursWaiting }} 小时{{ row.overdue ? ' · 已超时' : '' }}
            </div>
            <div v-else class="sub">{{ row.handledAt ? row.handledAt.slice(5, 16) : '' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="处理结果" min-width="180">
          <template #default="{ row }">
            <span v-if="row.resultNote" class="sub2">{{ row.resultNote }}</span>
            <span v-else class="sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState title="没有符合条件的看房请求" desc="挂牌公开后，访客留的号码会出现在这里" />
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

    <!-- 详情：这里才给完整号码 -->
    <el-drawer v-model="dt.visible" title="看房请求" size="480px">
      <template v-if="dt.row">
        <div class="dt-hd">
          <div class="dt-t">{{ dt.row.communityName }} {{ dt.row.buildingName }}{{ dt.row.room }}</div>
          <div class="dt-m">
            {{ dt.row.houseType }} · {{ dt.row.area }}㎡ · ¥{{ money(dt.row.price) }}/月 ·
            责任楼管 {{ dt.row.stewardName }}
          </div>
        </div>
        <el-descriptions :column="1" border size="small" style="margin-top:14px;">
          <el-descriptions-item label="联系人">{{ dt.row.name }}</el-descriptions-item>
          <el-descriptions-item label="手机号">
            <span class="mono">{{ dt.row.phoneFull }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="方便时间">{{ dt.row.preferredTime }}</el-descriptions-item>
          <el-descriptions-item label="留言">{{ dt.row.note || '—' }}</el-descriptions-item>
          <el-descriptions-item label="提交于">{{ dt.row.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="dt.row.statusType" effect="plain">{{ dt.row.status }}</el-tag>
            <span v-if="dt.row.status === '待联系'" class="sub" style="margin-left:8px;">
              已等 {{ dt.row.hoursWaiting }} 小时{{ dt.row.overdue ? ' · 已超时' : '' }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item v-if="dt.row.handledAt" label="处理">
            {{ dt.row.handledBy }} · {{ dt.row.handledAt }}
          </el-descriptions-item>
          <el-descriptions-item v-if="dt.row.resultNote" label="处理结果">{{ dt.row.resultNote }}</el-descriptions-item>
        </el-descriptions>

        <div class="dt-tip">
          完整号码<b>仅用于本次回拨</b>，不得导出、不得进任何营销名单；
          <b>90 天后自动清理</b>。查看完整号码会记入数据访问日志。
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { VIEWING_STATUS, getViewing, queryViewings, viewingStats } from '@/api/listings'
import { PAGE_SIZES } from '@/api/shared'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'

const q = reactive({ kw: '', status: '', overdue: false })
const pageNo = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const st = ref({ total: 0, pending: 0, overdue: 0, contacted: 0, visited: 0, closed: 0 })

async function load() {
  loading.value = true
  try {
    const res = await queryViewings({ pageNo: pageNo.value, size: size.value, filters: { ...q } })
    rows.value = res.rows
    total.value = res.total
    st.value = viewingStats()
  } catch (e) {
    ElMessage.error(e?.message || '看房请求加载失败')
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function resetFilter() { Object.assign(q, { kw: '', status: '', overdue: false }); applyFilter() }
function onSize() { pageNo.value = 1; load() }

const dt = reactive({ visible: false, row: null })
async function openDetail(row) {
  dt.visible = true
  dt.row = row
  try {
    const full = await getViewing(row.viewingId)
    if (full) dt.row = full
  } catch (e) {
    ElMessage.error(e?.message || '详情加载失败')
  }
}

onMounted(load)
</script>

<style scoped>
.back-line { margin-bottom: 6px; }
.vstats { margin-top: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.vstat { padding: 14px 16px; }
.vstat__k { font-size: 12.5px; color: var(--biz-text-3); }
.vstat__v {
  font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px;
}
.vstat__v.is-warn { color: var(--biz-warning, #d98a1f); }
.vstat__v.is-ok { color: var(--biz-success, #2f9e6e); }
.vstat__v.is-muted { color: var(--biz-text-2); }
.vstat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.vstat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }
.vstat__s.is-danger { color: var(--biz-danger, #d64545); }

.filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.v-t { font-size: 13px; color: var(--biz-text-1); }
.v-note {
  font-size: 12px; color: var(--biz-text-2);
  overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.sub { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.sub.is-danger { color: var(--biz-danger, #d64545); }
.sub2 { font-size: 12px; color: var(--biz-text-2); }
.mono { font-family: var(--biz-font-num); }
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }

.dt-hd { padding-bottom: 10px; border-bottom: 1px solid var(--biz-border); }
.dt-t { font-size: 15px; color: var(--biz-text-1); font-weight: 600; }
.dt-m { font-size: 12px; color: var(--biz-text-3); margin-top: 4px; }
.dt-tip {
  margin-top: 14px; padding: 10px 12px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 11.5px; line-height: 1.8; color: var(--biz-text-2);
}
.dt-tip b { color: var(--biz-text-1); }
</style>
