<!--
  B 域 · 押金类型字典（2026-11-13）
  ------------------------------------------------------------
  押金不止装修一种：门禁卡、车牌、履约保证金、租约押金都收，也都退。
  但它们的"流程"不一样，所以类型上带四个开关，页面按开关渲染，而不是给每种押金写一个页面：

    · 需要工期：装修要开工/完工日期，门禁卡没有工期
    · 需要验收：装修、履约、租约要验收（退租核验也算），退卡不需要
    · 金额固定：有标准额的按 标准额 × 数量；金额按约定的由前台/合同填
    · 允许部分退：门禁卡一次退清，租约押金可以按扣款后退余额

  停用不删：已收的押金仍要能退，停用只是不给新收。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>押金类型字典</b>：类型决定流程 —— 要不要工期、要不要验收、金额是否固定、能否部分退。
        收银台与押金台账都读这一份，<b>不在页面里硬编码</b>。
        <br />
        <b>金额按约定</b>（履约保证金 / 租约押金）：标准额填 0，收取时必须按合同填金额并写清合同号，
        否则退款时说不清基数。
        <br />
        <b>停用不删</b>：停用后不能再新收，<b>已经收的仍可退款</b> —— 押金是负债，钱必须能还回去。
      </div>
    </div>

    <div class="dict-nav">
      <span class="dict-nav__t">费用字典</span>
      <span class="dict-nav__i" @click="$router.push('/b/fee-categories')">分类字典</span>
      <span class="dict-nav__i" @click="$router.push('/b/fee-items')">收费科目与价目</span>
      <span class="dict-nav__i" @click="$router.push('/b/waive-reasons')">减免原因</span>
      <span class="dict-nav__i is-on">押金类型</span>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">类型总数</div><div class="dstat__v">{{ list.length }}<span class="unit">类</span></div></div>
        <div class="dstat"><div class="dstat__k">启用中</div><div class="dstat__v">{{ list.filter(t => t.enabled).length }}<span class="unit">类</span></div></div>
        <div class="dstat"><div class="dstat__k">需验收</div><div class="dstat__v">{{ list.filter(t => t.needCheck).length }}<span class="unit">类</span></div></div>
        <div class="dstat"><div class="dstat__k">金额按约定</div><div class="dstat__v">{{ list.filter(t => !(t.standardAmount > 0)).length }}<span class="unit">类</span></div></div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters" style="margin-bottom:10px;">
        <span class="muted" style="font-size:12.5px;">在账押金按类型统计见 <router-link to="/b/deposits">押金台账</router-link></span>
        <span class="spacer" />
        <el-button v-if="canEdit" type="primary" :icon="'Plus'" @click="openCreate">新增类型</el-button>
      </div>

      <el-table :data="list" size="small">
        <el-table-column prop="name" label="类型名称" min-width="140">
          <template #default="{ row }"><span :class="{ 'is-off': !row.enabled }">{{ row.name }}</span></template>
        </el-table-column>
        <el-table-column label="标准额" width="110" align="right">
          <template #default="{ row }">
            <span v-if="row.standardAmount > 0">¥ {{ row.standardAmount }}</span>
            <span v-else class="muted">按约定</span>
          </template>
        </el-table-column>
        <el-table-column label="需要工期" width="90" align="center">
          <template #default="{ row }">{{ row.needDates ? '是' : '—' }}</template>
        </el-table-column>
        <el-table-column label="需要验收" width="90" align="center">
          <template #default="{ row }">{{ row.needCheck ? '是' : '—' }}</template>
        </el-table-column>
        <el-table-column label="按数量" width="80" align="center">
          <template #default="{ row }">{{ row.byQuantity ? '是' : '—' }}</template>
        </el-table-column>
        <el-table-column label="部分退" width="80" align="center">
          <template #default="{ row }">{{ row.allowPartial ? '可' : '一次退清' }}</template>
        </el-table-column>
        <el-table-column prop="desc" label="说明" min-width="260" show-overflow-tooltip>
          <template #default="{ row }"><span class="muted">{{ row.desc }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="86" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" size="small" :disabled="!canEdit" @change="v => onToggle(row, v)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button v-if="canEdit" link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dlg.visible" :title="dlg.form.typeId ? '编辑押金类型' : '新增押金类型'" width="560px">
      <el-form :model="dlg.form" label-width="100px">
        <el-form-item label="名称" required>
          <el-input v-model="dlg.form.name" maxlength="12" show-word-limit placeholder="如：车位押金" />
        </el-form-item>
        <el-form-item label="标准金额">
          <el-input-number v-model="dlg.form.standardAmount" :min="0" :max="200000" :step="100" />
          <span class="hint">0 = 金额按合同约定，收取时手填</span>
        </el-form-item>
        <el-form-item label="按数量收">
          <el-switch v-model="dlg.form.byQuantity" />
          <span class="hint">门禁卡、车牌这类按张/按牌收的打开；金额 = 标准额 × 数量</span>
        </el-form-item>
        <el-form-item label="需要工期">
          <el-switch v-model="dlg.form.needDates" />
          <span class="hint">装修类打开（开工 / 计划完工）；打开后收取即进入「装修中」</span>
        </el-form-item>
        <el-form-item label="需要验收">
          <el-switch v-model="dlg.form.needCheck" />
          <span class="hint">关闭则退卡/退牌时直接退款，不出现「验收」动作</span>
        </el-form-item>
        <el-form-item label="允许部分退">
          <el-switch v-model="dlg.form.allowPartial" />
          <span class="hint">关闭后必须一次退清（门禁卡、车牌）</span>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="dlg.form.sort" :min="0" :max="999" :step="10" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="dlg.form.desc" type="textarea" :rows="2" maxlength="80" show-word-limit />
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
import { canEditFeeConfig, depositTypeRows, saveDepositType, toggleDepositType } from '@/utils/api'

const list = ref([])
const canEdit = computed(() => canEditFeeConfig())
const BLANK = {
  typeId: '', name: '', standardAmount: 0, byQuantity: false,
  needDates: false, needCheck: true, allowPartial: true, sort: 0, desc: ''
}
const dlg = reactive({ visible: false, saving: false, form: { ...BLANK } })

function load() { list.value = depositTypeRows() }
function openCreate() {
  Object.assign(dlg, { visible: true, saving: false, form: { ...BLANK, sort: (list.value.length + 1) * 10 } })
}
function openEdit(row) {
  Object.assign(dlg, { visible: true, saving: false, form: { ...row } })
}
function doSave() {
  dlg.saving = true
  try {
    saveDepositType(dlg.form)
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
    toggleDepositType(row.typeId, v)
    ElMessage.success(v ? '已启用' : '已停用：不再新收，已收的仍可退款')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
    load()
  }
}

onMounted(load)
</script>

<style scoped>
.muted { color: var(--biz-text-3); }
.is-off { color: var(--biz-text-3); text-decoration: line-through; }
.hint { font-size: 11.5px; color: var(--biz-text-3); margin-left: 8px; }
.spacer { flex: 1; }
.dict-nav {
  margin-top: 14px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  background: #fff; border: 1px solid var(--biz-border-light);
  border-radius: 10px; padding: 8px 12px; font-size: 12.5px;
}
.dict-nav__t { color: var(--biz-text-3); margin-right: 4px; }
.dict-nav__i { padding: 4px 10px; border-radius: 6px; cursor: pointer; color: var(--biz-text-2); border: 1px solid transparent; }
.dict-nav__i:hover { background: #f5f7fa; }
.dict-nav__i.is-on {
  background: var(--el-color-primary-light-9); color: var(--el-color-primary);
  border-color: var(--el-color-primary-light-7); cursor: default;
}
</style>
