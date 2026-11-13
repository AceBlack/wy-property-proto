<!--
  B 域 · 费用分类字典（批 1 · 2026-11-12）
  ------------------------------------------------------------
  这张表是所有统计报表的根：收费项、合同、报销、补录最后都要落到这里的一个二级分类上。

  三条规矩（页面说明里也写了，因为这是最容易被人想当然改坏的地方）：
    ① 一级定方向、二级挂单据，只有两级 —— 三层以上最后没人填得对；
    ② 每级声明「允许来源」：账单不能产生"税金"，合同不能产生"物业费"；
    ③ 停用不等于删除：历史单据仍要能显示分类名，所以停用后只是不给新单据选。

  编码与来源**不允许在页面上改** —— 它们被单据引用，改了等于让历史数据指向不存在的分类。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>费用分类字典</b>：收入 / 支出 / 负债三个方向，各两级。
        报表按二级分组，所以二级的名称一旦定下就尽量别再改 —— 改了旧报表按名字分组会对不上。
        <br />
        <b>「允许来源」是关键约束</b>：`手册补录` 的税金只能手工录，`账单` 的物业费只能由账单产生。
        少这条，收银员能在账单里录一笔"税金"，财务对账时就找不到出处。
        <br />
        <b>停用不删</b>：停用后新单据选不到，但历史单据照旧显示分类名。
      </div>
    </div>

    <!-- 费用字典同组入口：分类是会计口径，其余是作业口径。
         不做成一张表（改一个减免原因看起来像在动报表），但入口要放在一起，
         否则用的人会在"收费科目"和"分类字典"之间反复找 -->
    <div class="dict-nav">
      <span class="dict-nav__t">费用字典</span>
      <span class="dict-nav__i is-on">分类字典</span>
      <span class="dict-nav__i" @click="$router.push('/b/fee-items')">收费科目与价目</span>
      <span class="dict-nav__i" @click="$router.push('/b/waive-reasons')">减免原因</span>
      <span class="dict-nav__i" @click="$router.push('/b/deposit-types')">押金类型</span>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">一级分类（当前方向）</div><div class="dstat__v">{{ l1Count }}<span class="unit">个</span></div></div>
        <div class="dstat"><div class="dstat__k">二级分类（当前方向）</div><div class="dstat__v">{{ l2Count }}<span class="unit">个</span></div></div>
        <div class="dstat"><div class="dstat__k">已停用（当前方向）</div><div class="dstat__v">{{ disabledCount }}<span class="unit">个</span></div></div>
        <div class="dstat">
          <div class="dstat__k">收费项未挂分类</div>
          <div class="dstat__v" :class="{ 'money--out': gaps.missing.length }">{{ gaps.missing.length }}<span class="unit">/ {{ gaps.total }}</span></div>
        </div>
      </div>
      <div v-if="gaps.missing.length" class="gap-tip">
        未挂分类的收费项：<b>{{ gaps.missing.map(x => x.name).join('、') }}</b> —— 它们产生的收入在报表里只能进"未分类"。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-tabs v-model="tab" @tab-change="onTab">
        <el-tab-pane label="收入" name="income" />
        <el-tab-pane label="支出" name="expense" />
        <el-tab-pane label="负债 / 押金" name="liability" />
      </el-tabs>

      <el-table :data="rows" size="small" row-key="code" default-expand-all style="margin-top:8px;">
        <el-table-column label="分类名称" min-width="200">
          <template #default="{ row }">
            <span :class="{ 'is-off': !row.enabled }">{{ row.name }}</span>
            <el-tag v-if="row.level === 1" size="small" effect="plain" style="margin-left:6px;">一级</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="编码" width="180">
          <template #default="{ row }"><code class="mono">{{ row.code }}</code></template>
        </el-table-column>
        <el-table-column prop="sourceText" label="允许来源" min-width="170" />
        <el-table-column label="计收入" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.countInRevenue" size="small" type="success" effect="plain">是</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="计收缴率" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.countInCollection" size="small" type="warning" effect="plain">是</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="sort" label="排序" width="70" align="right" />
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" size="small" :disabled="!canEdit" @change="v => onToggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="220" show-overflow-tooltip>
          <template #default="{ row }"><span class="muted">{{ row.desc }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canEdit" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dlg.visible" title="编辑分类" width="520px">
      <el-form :model="dlg.form" label-width="96px">
        <el-form-item label="编码">
          <el-input :model-value="dlg.form.code" disabled />
          <div class="hint">编码被单据引用，不可修改；要改语义请新建分类并停用旧的。</div>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="dlg.form.name" maxlength="12" show-word-limit />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="dlg.form.sort" :min="0" :max="999" :step="10" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="dlg.form.desc" type="textarea" :rows="2" maxlength="60" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="doSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  canEditFeeConfig, feeCategoryTree, feeItemCategoryGaps, saveFeeCategory, toggleFeeCategory
} from '@/utils/api'

const tab = ref('income')
const treeData = ref([])
const gaps = ref({ total: 0, missing: [] })
const dlg = reactive({ visible: false, saving: false, form: { code: '', name: '', sort: 0, desc: '' } })

const canEdit = computed(() => canEditFeeConfig())
const rows = computed(() => treeData.value)
const l1Count = computed(() => rows.value.length)
const l2Count = computed(() => rows.value.reduce((n, r) => n + (r.children?.length || 0), 0))
const disabledCount = computed(() => rows.value.reduce((n, r) => n + (r.enabled ? 0 : 1) + (r.children || []).filter(c => !c.enabled).length, 0))

function load() {
  treeData.value = feeCategoryTree({ direction: tab.value })
  gaps.value = feeItemCategoryGaps()
}
function onTab() { load() }

function openEdit(row) {
  Object.assign(dlg, { visible: true, saving: false, form: { code: row.code, name: row.name, sort: row.sort, desc: row.desc } })
}

function doSave() {
  dlg.saving = true
  try {
    saveFeeCategory({ code: dlg.form.code, name: dlg.form.name, sort: dlg.form.sort, desc: dlg.form.desc })
    ElMessage.success('已保存')
    dlg.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    dlg.saving = false
  }
}

function onToggle(row, v) {
  try {
    toggleFeeCategory(row.code, v)
    ElMessage.success(v ? '已启用' : '已停用，历史单据仍显示该分类')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
    load()
  }
}

onMounted(load)
</script>

<style scoped>
.mono { font-family: var(--biz-font-num); font-size: 12px; }
.muted { color: var(--biz-text-3); }
.is-off { color: var(--biz-text-3); text-decoration: line-through; }
.gap-tip {
  margin-top: 10px; padding: 8px 12px; border-radius: 8px;
  background: var(--biz-bg-2); font-size: 12.5px; color: var(--biz-text-2);
}
.hint { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.dict-nav {
  margin-top: 14px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  background: var(--biz-bg-2, #fff); border: 1px solid var(--biz-border-light);
  border-radius: 10px; padding: 8px 12px; font-size: 12.5px;
}
.dict-nav__t { color: var(--biz-text-3); margin-right: 4px; }
.dict-nav__i {
  padding: 4px 10px; border-radius: 6px; cursor: pointer; color: var(--biz-text-2);
  border: 1px solid transparent;
}
.dict-nav__i:hover { background: var(--biz-bg-3, #f5f7fa); }
.dict-nav__i.is-on {
  background: var(--el-color-primary-light-9); color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-7); cursor: default;
}
</style>
