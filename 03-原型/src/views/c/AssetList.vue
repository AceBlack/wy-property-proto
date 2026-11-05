<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>办公资产台账</b>：这里的资产是<b>电脑、桌椅、打印机、工具</b>这类可被个人领用的办公物品，
        与 D 域「设备台账」不是一回事 —— 那边管的是门禁 / 摄像头 / 车闸这类装在公共区域、看「在不在线」的 IoT 设备。
        <br />
        <b>编号由系统生成且不可改</b>：标签已经贴在实物上，改编号等于让报修记录和纸质标签全部对不上。
        <b>状态是描述性字段</b>（闲置 / 在用 / 报废）—— 本期没有领用归还单据，所以<b>不能拿状态推断"资产在哪"</b>，
        真要看在谁手上，看「使用人」。
        维护需要 <code>c.assets.edit</code>。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel dstat">
        <div class="dstat__k">资产总数</div>
        <div class="dstat__v">{{ st.total }}<span class="unit">件</span></div>
        <div class="dstat__s">{{ st.catCount }} 个启用分类 · 在用 {{ st.inUse }} · 闲置 {{ st.idle }}</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">购置总值</div>
        <div class="dstat__v">¥ {{ money(st.totalValue) }}</div>
        <div class="dstat__s">按录入的原值合计，不含折旧（本期不做净值）</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">保修临期</div>
        <div class="dstat__v" :class="st.warrantySoon ? 'is-warn' : ''">{{ st.warrantySoon }}<span class="unit">台</span></div>
        <div class="dstat__s">30 天内到期 · 已过保 {{ st.warrantyExpired }} 台</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">已报废</div>
        <div class="dstat__v">{{ st.scrapped }}<span class="unit">件</span></div>
        <div class="dstat__s">报废后二维码仍可扫（显示"已报废"）</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <!-- 改筛选立即重查并回第一页：下拉改完还要再点一次「查询」，人以为是筛选坏了 -->
        <el-select v-model="query.catId" placeholder="全部分类" clearable filterable style="width:180px"
          @change="applyFilter">
          <el-option v-for="o in catOpts" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="query.status" placeholder="全部状态" clearable style="width:118px"
          @change="applyFilter">
          <el-option v-for="s in ASSET_STATUS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-input v-model="query.kw" placeholder="搜名称 / 编号 / 编码 / 序列号 / 使用人" clearable
          style="width:270px" :prefix-icon="'Search'" @keyup.enter="reload" @clear="reload" />
        <el-button @click="reload">查询</el-button>
        <span class="spacer" />
        <el-button type="primary" :icon="'Plus'" :disabled="!canEdit" @click="$router.push('/c/assets/new')">
          新增资产
        </el-button>
        <el-button :icon="'Printer'" :disabled="!selected.length" @click="printLabels">
          打印标签{{ selected.length ? `（${selected.length}）` : '' }}
        </el-button>
        <el-button :icon="'Setting'" :disabled="!canViewCats" @click="$router.push('/c/asset-categories')">
          分类维护
        </el-button>
      </div>

      <el-table :data="rows" v-loading="loading" style="width:100%;margin-top:12px;"
        @selection-change="v => (selected = v)" @row-click="r => $router.push(`/c/assets/${r.assetId}`)">
        <el-table-column type="selection" width="40" />
        <el-table-column label="资产编号" width="128">
          <template #default="{ row }"><span class="num">{{ row.assetNo }}</span></template>
        </el-table-column>
        <el-table-column label="名称" min-width="200">
          <template #default="{ row }">
            <div class="an-row">
              <el-image v-if="row.cover" class="an-thumb" :src="row.cover" fit="cover" />
              <div v-else class="an-thumb is-empty">无图</div>
              <div>
                <div class="an">{{ row.name }}</div>
                <div class="an__s">
                  {{ [row.brand, row.model].filter(Boolean).join(' · ') || '—' }}
                  <span v-if="row.photoCount"> · {{ row.photoCount }} 张图</span>
                </div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="150">
          <template #default="{ row }"><span class="muted">{{ row.catPath || row.catName || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="使用部门" width="140">
          <template #default="{ row }">{{ row.orgName || '—' }}</template>
        </el-table-column>
        <el-table-column label="使用人" width="100">
          <template #default="{ row }">{{ row.holderName || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="86">
          <template #default="{ row }">
            <span class="st" :class="`is-${row.status}`">{{ row.status }}</span>
          </template>
        </el-table-column>
        <el-table-column label="购置日期" width="110" prop="buyDate" />
        <el-table-column label="原值" width="108" align="right">
          <template #default="{ row }">
            <span class="num">{{ row.price === null || row.price === '' ? '—' : '¥ ' + money(row.price) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="$router.push(`/c/assets/${row.assetId}`)">详情</el-button>
            <el-button link :disabled="!canEdit" @click.stop="$router.push(`/c/assets/${row.assetId}/edit`)">编辑</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="没有符合条件的资产。换个分类，或去新增一件" />
        </template>
      </el-table>

      <div class="table-foot">
        <el-pagination v-model:current-page="pageNo" :page-size="size" :total="total"
          layout="total, prev, pager, next" @current-change="reload" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ASSET_STATUS, assetCatOptions, assetSummary, canEditAssets, canViewAssetCats,
  assetLabelRows, queryAssets
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import { printAssetLabels } from '@/utils/assetLabel'

const canEdit = computed(() => canEditAssets())
const canViewCats = computed(() => canViewAssetCats())
const catOpts = assetCatOptions({ includeDisabled: true })
const st = ref(assetSummary())

const query = ref({ catId: '', status: '', kw: '' })
const rows = ref([])
const total = ref(0)
const pageNo = ref(1)
const size = ref(15)
const loading = ref(false)
const selected = ref([])

const money = n => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

async function reload() {
  loading.value = true
  try {
    const r = await queryAssets({ pageNo: pageNo.value, size: size.value, ...query.value })
    rows.value = r.rows
    total.value = r.total
    st.value = assetSummary()
  } catch (e) {
    ElMessage.error(e?.message || '查询失败')
  } finally {
    loading.value = false
  }
}
reload()

/** 筛选变化：回第一页再查（停在第 3 页查筛完只剩 2 条，会看到空表） */
function applyFilter() {
  pageNo.value = 1
  reload()
}

function printLabels() {
  const labels = assetLabelRows(selected.value.map(a => a.assetId))
  const r = printAssetLabels(labels, { scanBase: location.origin + location.pathname })
  if (!r.ok) {
    ElMessage[r.reason === 'blocked' ? 'error' : 'warning'](
      r.reason === 'blocked' ? '浏览器拦截了弹窗，请允许后重试' : '先勾选要打印的资产'
    )
  }
}
</script>

<style scoped>
.an-row { display: flex; align-items: center; gap: 8px; }
.an-thumb { width: 34px; height: 26px; border-radius: 4px; flex: none; background: var(--biz-bg-fill); }
.an-thumb.is-empty {
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: var(--biz-text-3); border: 1px dashed var(--biz-border, #dfe3ec);
}
.an { font-size: 13px; color: var(--biz-text-1); }
.an__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.st { font-size: 11.5px; padding: 1px 7px; border-radius: 10px; background: var(--biz-bg-fill); color: var(--biz-text-2); }
.st.is-在用 { background: rgba(18, 185, 138, .12); color: var(--biz-success, #12b98a); }
.st.is-闲置 { background: rgba(217, 138, 31, .12); color: var(--biz-warning, #d98a1f); }
.st.is-报废 { background: rgba(136, 135, 128, .14); color: var(--biz-text-3); text-decoration: line-through; }
.is-warn { color: var(--biz-warning); }
:deep(.el-table__row) { cursor: pointer; }
</style>
