<template>
  <DetailDrawer
    v-model="inner" :loading="loading" width="860px"
    title="组织维护" subtitle="集团 / 中心 / 部门 / 班组 · 改名、调上级、加班组"
  >
    <el-alert
      type="info" :closable="false" show-icon style="margin-bottom:12px;"
      title="三条不让改：类型、集团上级、挂到自己的下级下面"
      description="改类型会让下面所有人的归属语义整体变化（班组改部门 = 从「走排班」变「走职能」）；集团没有上级；挂成环之后整棵子树会从组织树上消失，但人还在列表里。集团与项目由立项流程创建，这里只能建部门 / 班组。"
    />

    <el-table
      v-loading="loading" :data="tree" row-key="orgId" size="small" default-expand-all
      :tree-props="{ children: 'children' }" style="width:100%"
    >
      <el-table-column label="组织" min-width="220">
        <template #default="{ row }">
          <span class="osn">{{ row.name }}</span>
          <el-tag size="small" :type="typeTag(row.type)" effect="plain" class="osn__tag">{{ row.type }}</el-tag>
          <span class="osn__id">{{ row.orgId }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="leader" label="负责人" width="100">
        <template #default="{ row }">{{ row.leader || '—' }}</template>
      </el-table-column>
      <el-table-column label="人数" width="92" align="right">
        <template #default="{ row }">
          <span>{{ row.selfHeadcount }}<span class="muted"> / {{ row.headcount }}</span></span>
        </template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="70" align="center" />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" :disabled="!canEdit" @click="openAdd(row)">新增下级</el-button>
          <el-button link type="primary" :disabled="!canEdit" @click="openEdit(row)">编辑</el-button>
        </template>
      </el-table-column>
      <template #empty><EmptyState type="empty" desc="没有组织数据" /></template>
    </el-table>

    <div class="os-foot">
      人数列：左边是本级在编人数，右边是含下级的人头数。组织改名 / 调上级后，成员列表上的组织与路径会同步刷新。
    </div>

    <template #footer>
      <el-button @click="inner = false">关闭</el-button>
      <el-button :disabled="!canEdit" @click="openAdd(null)">新增一级部门</el-button>
    </template>

    <!-- 新增 -->
    <el-dialog v-model="add.visible" :title="add.parentId ? `在「${add.parentName}」下新增` : '新增部门'" width="520">
      <el-form label-width="88px">
        <el-form-item label="上级">
          <span>{{ add.parentName || '总部职能中心（默认）' }}</span>
          <span class="muted" style="margin-left:8px;font-size:12px;">上级决定新组织挂在树的哪一支</span>
        </el-form-item>
        <el-form-item label="名称" required>
          <el-input v-model="add.name" placeholder="如：客服一组" maxlength="20" show-word-limit style="width:260px" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-radio-group v-model="add.type">
            <el-radio-button value="班组">班组</el-radio-button>
            <el-radio-button value="部门">部门</el-radio-button>
          </el-radio-group>
          <span class="muted" style="margin-left:8px;font-size:12px;">集团 / 项目不在这里建</span>
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="add.leader" placeholder="可不填" style="width:200px" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="add.sort" :min="1" :max="99" />
          <span class="muted" style="margin-left:8px;font-size:12px;">同级小的在前</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="add.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAdd">保存</el-button>
      </template>
    </el-dialog>

    <!-- 编辑 -->
    <el-dialog v-model="edit.visible" title="编辑组织" width="520">
      <el-form label-width="88px">
        <el-form-item label="组织">
          <span>{{ edit.name }}</span>
          <el-tag size="small" effect="plain" style="margin-left:8px">{{ edit.type }}</el-tag>
          <span class="muted" style="margin-left:8px;font-size:12px;">{{ edit.orgId }}</span>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="edit.name" maxlength="20" show-word-limit style="width:260px" />
        </el-form-item>
        <el-form-item label="上级">
          <el-select v-model="edit.parentId" filterable style="width:260px" :disabled="edit.orgId === 'O-ROOT'">
            <el-option
              v-for="o in parentOpts" :key="o.orgId"
              :label="`${o.name}（${o.type}）`" :value="o.orgId"
            />
          </el-select>
          <span class="muted" style="margin-left:8px;font-size:12px;">不能选自己或自己的下级</span>
        </el-form-item>
        <el-form-item label="负责人">
          <el-input v-model="edit.leader" style="width:200px" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="edit.sort" :min="1" :max="99" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edit.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </DetailDrawer>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { createOrg, queryOrgs, updateOrg } from '@/api'
import { hasPerm } from '@/utils/auth'
import DetailDrawer from '@/components/DetailDrawer.vue'
import EmptyState from '@/components/EmptyState.vue'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue', 'changed'])

const inner = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

/* 组织维护是「操作」位：只看不建的角色（如只读观察员）能看到结构，但按钮是灰的 */
const canEdit = computed(() => hasPerm('e.org.edit'))

const rows = ref([])
const loading = ref(false)
const saving = ref(false)

/** 扁平 → 树（el-table 的 tree-props 直接吃 children） */
function buildTree(list, parentId = '') {
  return list
    .filter(r => (r.parentId || '') === parentId)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map(r => {
      const kids = buildTree(list, r.orgId)
      return kids.length ? { ...r, children: kids } : { ...r }
    })
}

const tree = computed(() => buildTree(rows.value))

async function load() {
  loading.value = true
  try {
    const res = await queryOrgs()
    rows.value = res.rows
  } catch (e) {
    ElMessage.error(e?.message || '组织列表加载失败')
  } finally {
    loading.value = false
  }
}

/* 每次打开都重新拉：别的地方（新增角色 / 调岗）也可能动了组织 */
watch(() => props.modelValue, v => { if (v) load() })

const typeTag = t => ({ 集团: 'danger', 项目: 'primary', 部门: 'warning', 班组: 'info' }[t] || 'info')

/* ---------- 新增 ---------- */
const add = reactive({ visible: false, parentId: '', parentName: '', name: '', type: '班组', leader: '', sort: 10 })

function openAdd(row) {
  const parent = row || rows.value.find(o => o.orgId === 'O-HEAD') || rows.value.find(o => o.type === '集团')
  add.parentId = parent?.orgId || ''
  add.parentName = parent?.name || ''
  add.name = ''
  /* 挂在项目下的默认班组、挂在部门下的默认部门——选错类型是最常见的一次返工 */
  add.type = parent?.type === '项目' ? '班组' : '部门'
  add.leader = ''
  add.sort = 10
  add.visible = true
}

async function saveAdd() {
  if (!add.parentId) { ElMessage.warning('先选一个上级组织'); return }
  saving.value = true
  try {
    const r = await createOrg({
      name: add.name, type: add.type, parentId: add.parentId, leader: add.leader, sort: add.sort
    })
    add.visible = false
    ElMessage.success(`已新增「${r.name}」（${r.type} · ${r.orgId}）`)
    await load()
    emit('changed')
  } catch (e) {
    ElMessage.error(e?.message || '新增失败')
  } finally {
    saving.value = false
  }
}

/* ---------- 编辑 ---------- */
const edit = reactive({ visible: false, orgId: '', name: '', type: '', parentId: '', leader: '', sort: 10 })

/** 可选上级：排除自己与自己的下级（选了就成环） */
const parentOpts = computed(() => {
  const banned = new Set([edit.orgId])
  let grew = true
  while (grew) {
    grew = false
    for (const r of rows.value) {
      if (!banned.has(r.orgId) && banned.has(r.parentId || '')) { banned.add(r.orgId); grew = true }
    }
  }
  return rows.value.filter(r => !banned.has(r.orgId))
})

function openEdit(row) {
  Object.assign(edit, {
    visible: true, orgId: row.orgId, name: row.name, type: row.type,
    parentId: row.parentId || '', leader: row.leader || '', sort: row.sort || 0
  })
}

async function saveEdit() {
  saving.value = true
  try {
    const r = await updateOrg(edit.orgId, {
      name: edit.name, parentId: edit.parentId, leader: edit.leader, sort: edit.sort
    })
    edit.visible = false
    ElMessage.success(`已保存「${r.name}」`)
    await load()
    emit('changed')
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.osn { font-weight: 600; color: var(--biz-text-1); }
.osn__tag { margin-left: 6px; }
.osn__id { margin-left: 6px; font-size: 11px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.os-foot { margin-top: 10px; font-size: 12px; color: var(--biz-text-3); line-height: 1.7; }
</style>
