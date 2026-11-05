<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>商业服务项目 · 收费项目的唯一源</b>：这里是「入户维修」拆出来后的项目目录 ——
        <b>公共区域维修免费、商业服务收费</b>，两条线的分类维度不同：公共按<b>设施部位</b>（电梯 / 给排水 / 土建…），
        商业服务按<b>维修品类</b>（水管漏水 / 空调不制冷…），不再混在一个下拉里。
        <br />
        <b>服务价格 = 材料费 + 人工费</b>（业主端下单页与员工端现场增项按它算，材料按成本价过账、人工费是提成基数）；
        <b>成本价 = 材料成本 + 人工成本</b>（人工成本按工时 × {{ LABOR_HOUR_COST }} 元/小时）。
        <b>改价不回溯</b>：已完工的工单按当时的价格快照结算；<b>停用不删</b>：历史工单还引着它。
        维护需要 <code>f.serviceItems.edit</code>，与工单处理权限分开 —— 会改价的人和会派单的人不是同一个。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel dstat">
        <div class="dstat__k">服务项目</div>
        <div class="dstat__v">{{ st.total }}<span class="unit">项</span></div>
        <div class="dstat__s">{{ st.enabled }} 在售 · {{ st.disabled }} 停用 · 分 {{ st.categories }} 类</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">已产生工单</div>
        <div class="dstat__v">{{ st.orders }}<span class="unit">单</span></div>
        <div class="dstat__s">{{ st.used }} 项被引用 · 已结清 {{ st.settled }} 单</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">商业服务收入</div>
        <div class="dstat__v">¥ {{ money(st.income) }}</div>
        <div class="dstat__s">只算已支付 / 已挂账，未支付不计</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">毛利</div>
        <div class="dstat__v" :class="st.profit >= 0 ? 'is-ok' : 'is-warn'">¥ {{ money(st.profit) }}</div>
        <div class="dstat__s">成本 ¥ {{ money(st.cost) }} · 毛利率 {{ st.margin }}%</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-select v-model="query.category" placeholder="全部分类" clearable style="width:130px">
          <el-option v-for="c in categories" :key="c.code" :label="`${c.name}（${c.itemCount}）`" :value="c.name" />
        </el-select>
        <el-select v-model="query.enabled" style="width:118px">
          <el-option label="在售" value="true" />
          <el-option label="已停用" value="false" />
          <el-option label="全部" value="all" />
        </el-select>
        <el-input v-model="query.kw" placeholder="搜名称 / 编码 / 分类" clearable style="width:210px"
          :prefix-icon="'Search'" @keyup.enter="reload" @clear="reload" />
        <el-button @click="reload">查询</el-button>
        <span class="spacer" />
        <el-button type="primary" :icon="'Plus'" :disabled="!canEdit" @click="openCreate">新增项目</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
      </div>
      <div v-if="!canEdit" class="muted" style="font-size:12px;padding:0 0 10px;">
        当前角色没有「商业服务项目」维护权限（<code>f.serviceItems.edit</code>），可以查看但不能改价 ——
        工单派单与完工不受影响。
      </div>

      <el-table :data="rows" size="small" style="width:100%">
        <el-table-column label="服务项目" min-width="230">
          <template #default="{ row }">
            <div>{{ row.name }}</div>
            <div class="ps-sub"><code>{{ row.code }}</code> · {{ row.trade }} · 约 {{ row.minutes }} 分钟</div>
          </template>
        </el-table-column>
        <el-table-column label="项目分类" width="110">
          <template #default="{ row }"><span class="muted">{{ row.category }}</span></template>
        </el-table-column>
        <el-table-column label="服务价格" width="132" align="right">
          <template #default="{ row }">
            <div class="money">¥ {{ money(row.price) }}</div>
            <div class="ps-sub">材料 {{ money(row.material) }} + 人工 {{ money(row.labor) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="成本价" width="132" align="right">
          <template #default="{ row }">
            <div class="money">¥ {{ money(row.cost) }}</div>
            <div class="ps-sub">料 {{ money(row.materialCost) }} + 工 {{ money(row.laborCost) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="毛利 / 毛利率" width="120" align="right">
          <template #default="{ row }">
            <div class="money" :class="row.profit > 0 ? 'money--in' : 'money--out'">¥ {{ money(row.profit) }}</div>
            <div class="ps-sub">{{ row.margin }}%</div>
          </template>
        </el-table-column>
        <el-table-column label="引用" width="96" align="right">
          <template #default="{ row }">
            <span v-if="!row.usedCount" class="muted">未用过</span>
            <span v-else>{{ row.usedCount }} 单</span>
            <div v-if="row.inFlight" class="ps-sub is-warn">{{ row.inFlight }} 在途</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="86">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.enabled ? 'success' : 'info'">
              {{ row.enabled ? '在售' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!canEdit" @click="openEdit(row)">编辑</el-button>
            <el-button link :type="row.enabled ? 'warning' : 'success'" :disabled="!canEdit" @click="toggle(row)">
              {{ row.enabled ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="没有符合条件的服务项目" />
        </template>
      </el-table>
      <div class="muted" style="padding:8px 2px 0;font-size:11.5px;">
        已完工工单按<b>下单时的价格</b>快照结算，这里的改价只影响新单 —— 所以毛利列是"按当前价"的口径，
        与 KPI 里"按历史成交额反算"的数字可能略有差异。
      </div>
    </div>

    <!-- 新增 / 编辑 -->
    <el-drawer v-model="visible" :title="form.code ? `编辑项目 · ${form.code}` : '新增服务项目'" size="640px">
      <div class="sec__hd"><h4>项目信息</h4><span class="desc">编码由系统生成，业主端与员工端按它索引价格</span></div>
      <el-form label-width="92px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="项目分类" required>
              <el-select v-model="form.category" style="width:100%">
                <el-option v-for="c in categories" :key="c.code" :label="c.name" :value="c.name" :disabled="!c.enabled" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="名称" required>
              <el-input v-model="form.name" maxlength="30" show-word-limit placeholder="如：角阀/软管更换（含材料）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="工种">
              <el-select v-model="form.trade" style="width:100%">
                <el-option v-for="t in tradeOpts" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="单位 / 工时">
              <el-input v-model="form.unit" style="width:88px" placeholder="次" />
              <el-input-number v-model="form.minutes" :min="0" :max="600" :step="5" controls-position="right"
                style="width:120px;margin-left:8px" @change="syncLaborCost" />
              <span class="muted" style="margin-left:6px;font-size:12px;">分钟</span>
            </el-form-item>
          </el-col>
        </el-row>

        <div class="sec__hd" style="margin-top:6px;">
          <h4>服务价格</h4><span class="desc">对外报价 = 材料费 + 人工费；人工费也是师傅提成的基数</span>
        </div>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="材料费">
              <el-input-number v-model="form.material" :min="0" :max="99999" :precision="2" controls-position="right"
                style="width:100%" @change="syncMaterialCost" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="人工费"><el-input-number v-model="form.labor" :min="0" :max="99999" :precision="2" controls-position="right" style="width:100%" /></el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="服务价格">
              <div class="calc">¥ {{ money(calc.price) }}</div>
            </el-form-item>
          </el-col>
        </el-row>

        <div class="sec__hd" style="margin-top:6px;">
          <h4>成本价</h4><span class="desc">材料成本按采购价、人工成本按工时折算；两者之和不能高于服务价格</span>
        </div>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="材料成本">
              <el-input-number v-model="form.materialCost" :min="0" :max="99999" :precision="2" controls-position="right"
                style="width:100%" @change="costTouched = true" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="人工成本">
              <div class="calc calc--cost">¥ {{ money(calc.laborCost) }}</div>
              <div class="ps-sub">工时 {{ form.minutes }} 分 × {{ LABOR_HOUR_COST }} 元/时（可手改）</div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="成本价">
              <div class="calc">¥ {{ money(calc.cost) }}</div>
            </el-form-item>
          </el-col>
        </el-row>
        <div class="calc-bar" :class="calc.warn ? 'is-warn' : ''">
          毛利 <b>¥ {{ money(calc.profit) }}</b> · 毛利率 <b>{{ calc.margin }}%</b>
          <span v-if="calc.warn" class="calc-bar__w">{{ calc.warn }}</span>
        </div>

        <el-row :gutter="16" style="margin-top:12px;">
          <el-col :span="12">
            <el-form-item label="排序">
              <el-input-number v-model="form.sort" :min="1" :max="999" />
              <span class="muted" style="margin-left:8px;font-size:12px;">数字小的排前面</span>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item v-if="form.code" label="状态">
              <el-switch v-model="form.enabled" active-text="在售" inactive-text="停用" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="说明">
              <el-input v-model="form.desc" type="textarea" :rows="2" maxlength="80" show-word-limit
                placeholder="写清这个项目包含什么、不包含什么（避免现场加价争议）" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <template v-if="history.length">
        <div class="sec__hd" style="margin-top:4px;"><h4>改价留痕</h4><span class="desc">最近 5 条</span></div>
        <div class="tl">
          <div v-for="(h, i) in history" :key="i" class="tl__i is-done">
            <div class="tl__t">{{ h.action }}<span class="tl__by"> · {{ h.by }}</span></div>
            <div class="tl__m">{{ h.memo }}<template v-if="h.at"> · {{ h.at }}</template></div>
          </div>
        </div>
      </template>

      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  LABOR_HOUR_COST, canEditServiceItems, saveServiceItem, serviceCategoryRows, serviceItemHistory,
  serviceItemRows, serviceItemSummary, toggleServiceItem
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'
import { exportList } from '@/utils/export'

const canEdit = computed(() => canEditServiceItems())
const categories = ref([])
const tradeOpts = ref(['水暖', '电工', '木工', '空调', '泥瓦', '综合'])
const rows = ref([])
const st = ref({ total: 0, enabled: 0, disabled: 0, categories: 0, used: 0, orders: 0, settled: 0, income: 0, cost: 0, profit: 0, margin: 0 })
const query = reactive({ category: '', enabled: 'true', kw: '' })

const visible = ref(false)
const saving = ref(false)
const history = ref([])
const form = reactive({
  code: '', category: '', name: '', trade: '综合', unit: '次', minutes: 30,
  material: 0, labor: 0, materialCost: 0, laborCost: 0, sort: 10, desc: '', enabled: true
})

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)

/** 页面实时算的三个合计：与服务端同一口径（材料+人工 / 材料成本+人工成本） */
const calc = computed(() => {
  const price = Math.round((Number(form.material) + Number(form.labor)) * 100) / 100
  const cost = Math.round((Number(form.materialCost) + Number(form.laborCost)) * 100) / 100
  const profit = Math.round((price - cost) * 100) / 100
  let warn = ''
  if (form.materialCost > form.material) warn = '材料成本高于材料费，等于材料亏本卖'
  else if (cost >= price) warn = '成本价不低于服务价格，启用就亏本'
  return { price, cost, laborCost: Number(form.laborCost) || 0, profit, margin: price ? Math.round(profit / price * 1000) / 10 : 0, warn }
})

function reload() {
  const enabled = query.enabled === 'all' ? null : query.enabled === 'true'
  rows.value = serviceItemRows({ category: query.category, enabled, kw: query.kw })
  st.value = serviceItemSummary()
}

onMounted(() => {
  categories.value = serviceCategoryRows()
  tradeOpts.value = [...new Set(serviceItemRows().map(r => r.trade))].sort()
  reload()
})

function resetForm() {
  Object.assign(form, {
    code: '', category: query.category || categories.value[0]?.name || '', name: '', trade: '综合',
    unit: '次', minutes: 30, material: 0, labor: 0, materialCost: 0, laborCost: 0, sort: 10, desc: '', enabled: true
  })
  costTouched.value = false
  history.value = []
}

function openCreate() {
  resetForm()
  visible.value = true
}

function openEdit(row) {
  Object.assign(form, {
    code: row.code, category: row.category, name: row.name, trade: row.trade, unit: row.unit,
    minutes: row.minutes, material: row.material, labor: row.labor,
    materialCost: row.materialCost, laborCost: row.laborCost,
    sort: row.sort, desc: row.desc || '', enabled: row.enabled
  })
  costTouched.value = true          // 已有项目：不自动把成本拉平到材料费
  history.value = serviceItemHistory(row.code)
  visible.value = true
}

/** 材料成本默认跟随材料费（材料按成本价过账）；手动改过就不再自动覆盖 */
const costTouched = ref(false)
function syncMaterialCost() {
  if (!costTouched.value) form.materialCost = Number(form.material) || 0
}
/** 工时改动时把人工成本按小时成本带出来（可再手改） */
function syncLaborCost() {
  if (!form.minutes) return
  form.laborCost = Math.round(form.minutes / 60 * LABOR_HOUR_COST)
}

function save() {
  if (!canEdit.value) { ElMessage.warning('当前角色没有维护权限'); return }
  if (!form.name.trim() || form.name.trim().length < 2) { ElMessage.warning('项目名称至少 2 个字'); return }
  saving.value = true
  try {
    const r = saveServiceItem({ ...form }, form.code, '物业管理员')
    ElMessage.success(form.code
      ? (r._changed ? `已保存 ${r._changed} 项变更（改价只影响新单）` : '没有变更内容')
      : `已新增「${r.name}」，服务价 ¥${money(r.price)} / 成本 ¥${money(r.cost)}，立即在工单表单可选`)
    visible.value = false
    categories.value = serviceCategoryRows()
    reload()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally { saving.value = false }
}

async function toggle(row) {
  if (!canEdit.value) return
  try {
    await ElMessageBox.confirm(
      row.enabled
        ? `停用后工单表单不能再选「${row.name}」，已有工单与已完工结算不受影响。`
        : `启用后「${row.name}」立即出现在工单表单的下拉里。`,
      row.enabled ? '停用项目' : '启用项目',
      { type: 'warning', confirmButtonText: row.enabled ? '停用' : '启用', cancelButtonText: '取消' }
    )
  } catch { return }
  try {
    const r = toggleServiceItem(row.code, !row.enabled, '物业管理员')
    ElMessage.success(`「${r.name}」已${r.enabled ? '启用' : '停用'}`)
    reload()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

const EXPORT_COLS = [
  { prop: 'code', label: '编码' },
  { prop: 'category', label: '项目分类' },
  { prop: 'name', label: '项目名称' },
  { prop: 'price', label: '服务价格' },
  { prop: 'material', label: '材料费' },
  { prop: 'labor', label: '人工费' },
  { prop: 'cost', label: '成本价' },
  { prop: 'profit', label: '毛利' },
  { prop: 'margin', label: '毛利率%' },
  { prop: 'unit', label: '单位' },
  { prop: 'minutes', label: '工时(分)' },
  { prop: 'usedCount', label: '引用单数' },
  { prop: 'enabledText', label: '状态' }
]
function onExport() {
  const list = rows.value.map(r => ({ ...r, enabledText: r.enabled ? '在售' : '已停用' }))
  exportList({ name: '商业服务项目', source: '/f/service-items', columns: EXPORT_COLS, rows: list, filters: { ...query } })
}
</script>

<style scoped>
.calc {
  font-family: var(--biz-font-num); font-size: 15px; font-weight: 600; color: var(--biz-text-1);
  padding-top: 6px;
}
.calc--cost { color: var(--biz-text-2); }
.calc-bar {
  margin: 2px 0 6px; padding: 8px 12px; border-radius: 7px; font-size: 12.5px;
  background: rgba(18, 185, 138, .08); color: var(--biz-text-2);
}
.calc-bar b { font-family: var(--biz-font-num); color: var(--biz-success, #12b98a); }
.calc-bar.is-warn { background: rgba(227, 77, 89, .08); }
.calc-bar.is-warn b { color: var(--biz-danger, #e34d59); }
.calc-bar__w { margin-left: 8px; color: var(--biz-danger, #e34d59); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; }
.ps-sub.is-warn { color: var(--biz-warning, #d98a1f); }
.money--in { color: var(--biz-success, #12b98a); }
.is-ok { color: var(--biz-success, #12b98a); }
.is-warn { color: var(--biz-warning, #d98a1f); }
.tl__by { color: var(--biz-text-3); font-weight: 400; }
code { font-size: 11px; color: var(--biz-text-3); }
</style>
