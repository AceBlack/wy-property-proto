<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>办公资产分类 · 层级最多两级</b>：一级是大类（办公设备 / 办公家具 / 电子电器 / 工具器具 / 其他），
        二级是具体品类（电脑 / 显示器 / 打印机…）。<b>不做三级</b> —— 录入时选到第三层基本选不出东西，
        实际业务也用不到。
        <br />
        <b>改名不回写资产</b>：资产上存的是分类名快照，所以「电脑」改叫「笔记本电脑」之后，
        历史资产仍显示当时的名字，能解释"当时归在哪一类"。
        <b>停用不删、有资产或子级不给删</b>：删掉等于让已有资产指向空分类。
        维护需要 <code>c.assetCats.edit</code>。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:330px minmax(0,1fr);align-items:start;">
      <!-- 左：分类树 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>分类树</h3>
          <span class="spacer" />
          <el-button size="small" :icon="'Plus'" :disabled="!canEdit" @click="startCreate('')">一级分类</el-button>
        </div>
        <el-input v-model="kw" placeholder="搜分类名" clearable size="small" :prefix-icon="'Search'" />
        <el-scrollbar max-height="calc(100vh - 420px)" style="margin-top:8px;">
          <el-tree
            ref="treeRef"
            :data="tree"
            node-key="catId"
            :props="{ label: 'name', children: 'children' }"
            :filter-node-method="filterNode"
            :expand-on-click-node="false"
            default-expand-all
            highlight-current
            :current-node-key="form.catId"
            @node-click="pick"
          >
            <template #default="{ data }">
              <span class="tnode">
                <span class="tnode__t" :class="{ 'is-off': !data.enabled }">{{ data.name }}</span>
                <span v-if="!data.enabled" class="tnode__off">停用</span>
                <span class="tnode__n">{{ data.assetCountAll }}</span>
              </span>
            </template>
          </el-tree>
          <EmptyState v-if="!tree.length" type="empty" desc="还没有分类，先建一个一级分类" />
        </el-scrollbar>
        <div class="tree-foot">
          共 {{ catTotal }} 个分类 · 挂 {{ assetTotal }} 件资产；节点右侧数字含全部下级
        </div>
      </div>

      <!-- 右：详情 / 编辑 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>{{ form.catId ? '分类详情' : (form.parentId ? '新增子分类' : '新增一级分类') }}</h3>
          <span class="spacer" />
          <template v-if="form.catId">
            <el-button size="small" :disabled="!canEdit" @click="startCreate(form.catId)">新增下级</el-button>
            <el-button size="small" :disabled="!canEdit" @click="doToggle">
              {{ curCat?.enabled ? '停用' : '启用' }}
            </el-button>
            <el-button size="small" type="danger" plain :disabled="!canEdit" @click="doRemove">删除</el-button>
          </template>
        </div>

        <el-form label-width="96px" style="max-width:560px;margin-top:14px;">
          <el-form-item label="分类名称" required>
            <el-input v-model="form.name" maxlength="12" show-word-limit :disabled="!canEdit || !editing"
              placeholder="如：电脑" style="width:260px" />
            <span class="muted" style="margin-left:8px;font-size:12px;">最多 12 字</span>
          </el-form-item>
          <el-form-item label="上级分类">
            <el-select v-model="form.parentId" :disabled="!canEdit || !editing" clearable
              placeholder="留空 = 一级分类" style="width:260px">
              <el-option v-for="o in parentOpts" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <span class="muted" style="margin-left:8px;font-size:12px;">不能选自己或自己的下级</span>
          </el-form-item>
          <el-form-item label="编码前缀">
            <el-input v-model="form.prefix" maxlength="8" :disabled="!canEdit || !editing" placeholder="如：BG-PC"
              style="width:200px" />
            <span class="muted" style="margin-left:8px;font-size:12px;">新增资产时用它拼资产编码（可改）</span>
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="form.sort" :min="1" :max="99" :disabled="!canEdit || !editing" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.note" maxlength="60" :disabled="!canEdit || !editing" placeholder="选填"
              style="width:100%" />
          </el-form-item>
        </el-form>

        <div v-if="form.catId" class="cat-facts">
          <div><span>资产数</span><b>{{ curCat?.assetCountAll || 0 }} 件</b>
            <span class="muted" v-if="curCat && curCat.assetCount !== curCat.assetCountAll">
              （本级 {{ curCat.assetCount }}，含下级共 {{ curCat.assetCountAll }}）
            </span>
          </div>
          <div><span>下级</span><b>{{ curCat?.childCount || 0 }} 个</b></div>
          <div><span>状态</span><b :class="curCat?.enabled ? '' : 'is-off'">{{ curCat?.enabled ? '启用中' : '已停用' }}</b></div>
          <div v-if="!curCat?.canDelete" class="cat-facts__warn">
            当前不可删除：{{ curCat?.childCount ? `下还有 ${curCat.childCount} 个子分类` : `下有 ${curCat?.assetCountAll || 0} 件资产` }}
          </div>
        </div>

        <div class="act-bar">
          <el-button v-if="editing" @click="cancelEdit">取消</el-button>
          <el-button v-if="editing" type="primary" :loading="saving" :disabled="!canEdit" @click="doSave">
            {{ form.catId ? '保存' : '创建' }}
          </el-button>
          <el-button v-else :disabled="!form.catId || !canEdit" @click="editing = true">编辑</el-button>
          <span class="spacer" />
          <span class="muted" style="font-size:12px;">分类只影响新录入的资产，不会改动已有资产上的分类快照</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  assetCatFlat, assetCatOptions, assetCatTree, canEditAssetCats,
  removeAssetCategory, saveAssetCategory, toggleAssetCategory
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'

const canEdit = computed(() => canEditAssetCats())
const tree = ref([])
const rows = ref([])
const kw = ref('')
const treeRef = ref(null)
const saving = ref(false)
const editing = ref(false)

const BLANK = { catId: '', name: '', parentId: '', prefix: '', sort: 10, note: '' }
const form = ref({ ...BLANK })

const catTotal = computed(() => rows.value.length)
/** 最末级（二级）分类上的资产合计；一级不直接挂资产，所以不会漏 */
const assetTotal = computed(() => rows.value.filter(r => r.leaf).reduce((s, r) => s + r.assetCount, 0))
const curCat = computed(() => rows.value.find(r => r.catId === form.value.catId) || null)

/* 上级候选：只能是「一级分类」，且不能是自己 —— 二级下面不能再挂一级 */
const parentOpts = computed(() => assetCatOptions({ includeDisabled: true })
  .filter(o => o.depth === 0 && o.value !== form.value.catId))

async function load() {
  tree.value = assetCatTree({ includeDisabled: true })
  rows.value = assetCatFlat()
}
load()

watch(kw, v => treeRef.value?.filter(v))
const filterNode = (value, data) => !value || String(data.name).includes(value)

function pick(node) {
  form.value = {
    catId: node.catId, name: node.name, parentId: node.parentId || '',
    prefix: node.prefix || '', sort: node.sort || 10, note: node.note || ''
  }
  editing.value = false
}

function startCreate(parentId) {
  const parent = parentId ? rows.value.find(r => r.catId === parentId) : null
  form.value = {
    ...BLANK,
    parentId: parentId || '',
    prefix: parent ? `${parent.prefix || ''}-` : ''
  }
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  if (form.value.catId) pick(rows.value.find(r => r.catId === form.value.catId) || { catId: '' })
  else form.value = { ...BLANK }
}

async function doSave() {
  saving.value = true
  const isEdit = !!form.value.catId
  try {
    const r = await saveAssetCategory({
      name: form.value.name, parentId: form.value.parentId || '',
      prefix: form.value.prefix, sort: form.value.sort, note: form.value.note
    }, form.value.catId)
    ElMessage.success(isEdit ? `已保存「${r.name}」` : `已创建「${r.name}」`)
    editing.value = false
    form.value = {
      catId: r.catId, name: r.name, parentId: r.parentId || '',
      prefix: r.prefix || '', sort: r.sort, note: r.note || ''
    }
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function doToggle() {
  try {
    const r = await toggleAssetCategory(form.value.catId)
    ElMessage.success(r.enabled
      ? `已启用「${r.name}」`
      : `已停用「${r.name}」：不能再往里新增资产，已有资产保留`)
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

async function doRemove() {
  try {
    await ElMessageBox.confirm(
      `删除分类「${form.value.name}」？只有没有子分类、也没有资产时才能删。`,
      '删除分类', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch { return }
  try {
    await removeAssetCategory(form.value.catId)
    ElMessage.success('已删除')
    form.value = { ...BLANK }
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '删除失败')
  }
}
</script>

<style scoped>
.tnode { display: flex; align-items: center; gap: 6px; width: 100%; padding-right: 6px; }
.tnode__t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tnode__t.is-off { color: var(--biz-text-3); text-decoration: line-through; }
.tnode__off { font-size: 10.5px; color: var(--biz-warning); border: 1px solid currentColor; border-radius: 3px; padding: 0 3px; }
.tnode__n { font-family: var(--biz-font-num); font-size: 11.5px; color: var(--biz-text-3); }
.tree-foot { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--biz-border); font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; }
.cat-facts { margin-top: 6px; padding: 12px 14px; border-radius: 8px; background: var(--biz-bg-fill); font-size: 12.5px; line-height: 2; }
.cat-facts > div { display: flex; gap: 8px; }
.cat-facts span:first-child { width: 56px; flex: none; color: var(--biz-text-3); }
.cat-facts b { font-weight: 500; }
.cat-facts b.is-off { color: var(--biz-warning); }
.cat-facts__warn { margin-top: 4px; color: var(--biz-warning); font-size: 11.5px; }
.act-bar { display: flex; align-items: center; gap: 8px; margin-top: 18px; }
</style>
