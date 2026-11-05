<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>业主标签字典 · 全公司共用口径</b>：标签是<b>人打的，不是系统算的</b>，所以每个词条必须写清
        「什么情况下打」。业主只存 <code>tagId</code> 不存名称 —— 改一个词条的名字不用刷 682 条业主，
        停用一个词条也不会让历史标签变成孤儿。
        <b>停用 ≠ 删除</b>：停用后不能再新打，<b>已经打上去的保留</b>（"这户去年确实涉过诉"不因为现在不统计了而变假）；
        内置词条可以改名 / 停用，但不可删除。维护字典需要 <code>e.ownerTags.edit</code>，
        楼栋管家只有打标签的权限，<b>能选不能改</b>。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel rsum">
        <div class="rsum__l">词条总数</div>
        <div class="rsum__v">{{ st.total }}<span class="unit">个</span></div>
        <div class="rsum__s">{{ st.enabled }} 启用 · {{ st.disabled }} 停用</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">已用过</div>
        <div class="rsum__v">{{ st.used }}<span class="unit">个</span></div>
        <div class="rsum__s">{{ st.total - st.used }} 个加了没人用，可考虑清理</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">已打标签业主</div>
        <div class="rsum__v">{{ st.taggedOwners }}<span class="unit">人</span></div>
        <div class="rsum__s">占全部业主 {{ pct(st.taggedOwners, st.taggedOwners + st.untaggedOwners) }}%</div>
      </div>
      <div class="panel rsum">
        <div class="rsum__l">未打标签</div>
        <div class="rsum__v">{{ st.untaggedOwners }}<span class="unit">人</span></div>
        <div class="rsum__s">新交付 / 刚过户的业主通常还没有</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-select v-model="query.category" placeholder="全部分类" clearable style="width:130px" @change="load">
          <el-option v-for="c in OWNER_TAG_CATEGORIES" :key="c" :label="c" :value="c" />
        </el-select>
        <el-select v-model="query.enabled" style="width:130px" @change="load">
          <el-option label="启用中" value="true" />
          <el-option label="已停用" value="false" />
          <el-option label="全部" value="all" />
        </el-select>
        <el-input v-model="query.kw" placeholder="搜名称 / 说明 / tagId" clearable style="width:220px"
          :prefix-icon="'Search'" @keyup.enter="load" @clear="load" />
        <el-button @click="load">查询</el-button>
        <span class="spacer" />
        <el-button type="primary" :icon="'Plus'" :disabled="!canEdit" @click="openCreate">新增词条</el-button>
        <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
      </div>
      <div v-if="!canEdit" class="muted" style="font-size:12px;padding:0 0 10px;">
        当前角色没有「业主标签字典」操作权限（<code>e.ownerTags.edit</code>），可以查看但不能维护 ——
        打标签仍然可以在业主档案里做。
      </div>

      <el-table v-loading="loading" :data="rows" size="small" style="width:100%">
        <el-table-column label="标签" min-width="150">
          <template #default="{ row }">
            <span class="otag" :style="chipStyle(row.color)">{{ row.name }}</span>
            <code class="tid">{{ row.tagId }}</code>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="90">
          <template #default="{ row }"><span class="muted">{{ row.category }}</span></template>
        </el-table-column>
        <el-table-column prop="desc" label="口径说明（什么情况下打）" min-width="300" show-overflow-tooltip>
          <template #default="{ row }">{{ row.desc || '—' }}</template>
        </el-table-column>
        <el-table-column label="使用人数" width="110" align="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!row.ownerCount" @click="goOwners(row)">
              {{ row.ownerCount }} 人
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.enabled ? 'success' : 'info'">
              {{ row.enabled ? '启用中' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="排序" width="70" align="center">
          <template #default="{ row }"><span class="muted">{{ row.sort }}</span></template>
        </el-table-column>
        <el-table-column label="来源" width="80">
          <template #default="{ row }">
            <span class="muted" style="font-size:12px;">{{ row.builtin ? '内置' : '自定义' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!canEdit" @click="openEdit(row)">编辑</el-button>
            <el-button link :type="row.enabled ? 'warning' : 'success'" :disabled="!canEdit" @click="toggle(row)">
              {{ row.enabled ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState type="search" desc="没有符合条件的标签词条" />
        </template>
      </el-table>
    </div>

    <!-- 新增 / 编辑：tagId 不可改，编辑时只读展示 -->
    <el-drawer v-model="visible" :title="form.tagId ? `编辑词条 · ${form.tagId}` : '新增标签词条'" size="480px">
      <el-form label-width="92px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="12" show-word-limit placeholder="如：养宠家庭" />
        </el-form-item>
        <el-form-item label="分类" required>
          <el-radio-group v-model="form.category">
            <el-radio-button v-for="c in OWNER_TAG_CATEGORIES" :key="c" :value="c">{{ c }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="配色">
          <div class="colors">
            <span v-for="c in OWNER_TAG_COLORS" :key="c" class="colors__i"
              :class="{ 'is-on': form.color === c }" :style="chipStyle(c)" @click="form.color = c" />
          </div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="1" :max="99" />
          <span class="muted" style="margin-left:8px;font-size:12px;">数字小的排前面</span>
        </el-form-item>
        <el-form-item label="口径说明">
          <el-input v-model="form.desc" type="textarea" :rows="3" maxlength="80" show-word-limit
            placeholder="写清什么情况下打这个标签，避免各人理解不同" />
        </el-form-item>
        <el-form-item v-if="form.tagId" label="状态">
          <el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" />
          <div v-if="!form.enabled && form.ownerCount" class="muted" style="font-size:12px;margin-top:6px;">
            停用后不能再新打，但已有 <b>{{ form.ownerCount }}</b> 位业主的标签会保留。
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  OWNER_TAG_CATEGORIES, OWNER_TAG_COLORS, canEditOwnerTags,
  createOwnerTag, ownerTagStats, queryOwnerTags, updateOwnerTag
} from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import { exportList } from '@/utils/export'

const router = useRouter()
const canEdit = computed(() => canEditOwnerTags())

const query = reactive({ category: '', enabled: 'true', kw: '' })
const rows = ref([])
const loading = ref(false)
const st = ref({ total: 0, enabled: 0, disabled: 0, used: 0, taggedOwners: 0, untaggedOwners: 0 })

const visible = ref(false)
const saving = ref(false)
const form = reactive({ tagId: '', name: '', category: '关怀', color: 'blue', sort: 1, desc: '', enabled: true, ownerCount: 0 })

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0)

const CHIP = {
  red: { bg: '#fdecec', fg: '#c0392b', bd: '#f5c2c2' },
  orange: { bg: '#fdf1e3', fg: '#b96a12', bd: '#f3d3a8' },
  green: { bg: '#e9f7ee', fg: '#227a41', bd: '#bce3c9' },
  blue: { bg: '#eaf1fb', fg: '#2b5f9e', bd: '#c3d7f0' },
  cyan: { bg: '#e6f6f4', fg: '#0b7a70', bd: '#b3e3dd' },
  gray: { bg: '#f1f2f5', fg: '#5b6472', bd: '#dcdfe6' }
}
const chipStyle = c => {
  const k = CHIP[c] || CHIP.gray
  return { background: k.bg, color: k.fg, borderColor: k.bd }
}

async function load() {
  loading.value = true
  try {
    const [res, s] = await Promise.all([
      queryOwnerTags({ enabled: query.enabled, category: query.category, kw: query.kw }),
      ownerTagStats()
    ])
    rows.value = res.rows
    st.value = s
  } catch (e) {
    ElMessage.error(e?.message || '标签字典加载失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(form, {
    tagId: '', name: '', category: '关怀', color: 'blue',
    sort: (rows.value.reduce((m, r) => Math.max(m, r.sort || 0), 0) || 0) + 1,
    desc: '', enabled: true, ownerCount: 0
  })
  visible.value = true
}

function openEdit(row) {
  Object.assign(form, { ...row })
  visible.value = true
}

async function save() {
  if (!String(form.name || '').trim()) { ElMessage.warning('请填写标签名称'); return }
  saving.value = true
  try {
    if (form.tagId) {
      await updateOwnerTag(form.tagId, {
        name: form.name, category: form.category, color: form.color,
        sort: form.sort, desc: form.desc, enabled: form.enabled
      })
      ElMessage.success(`已保存「${form.name}」`)
    } else {
      /* 新建不带 enabled：服务端默认启用，避免前端漏传导致建出来就是停用的 */
      const r = await createOwnerTag({
        name: form.name, category: form.category, color: form.color, desc: form.desc
      })
      ElMessage.success(`已新增「${r.name}」（${r.tagId}），建完即可在业主档案里使用`)
    }
    visible.value = false
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggle(row) {
  try {
    await updateOwnerTag(row.tagId, { enabled: !row.enabled })
    ElMessage.success(
      row.enabled
        ? `已停用「${row.name}」：不能再新打，已有 ${row.ownerCount} 位业主的标签保留`
        : `已启用「${row.name}」：现在可以在业主档案里打了`
    )
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

const goOwners = row => router.push({ path: '/a/owners', query: { tagId: row.tagId } })

const EXPORT_COLS = [
  { prop: 'tagId', label: '标签ID' }, { prop: 'name', label: '名称' }, { prop: 'category', label: '分类' },
  { prop: 'ownerCount', label: '使用人数' }, { prop: 'enabled', label: '启用' },
  { prop: 'sort', label: '排序' }, { prop: 'desc', label: '口径说明' }
]
function onExport() {
  exportList({ name: '业主标签字典', source: '/a/owner-tags', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

onMounted(load)
</script>

<style scoped>
.otag {
  display: inline-block; padding: 1px 8px; border-radius: 10px;
  font-size: 12px; line-height: 18px; border: 1px solid transparent; margin-right: 6px;
}
.tid { font-size: 11px; color: var(--biz-text-3); }
.colors { display: flex; gap: 8px; }
.colors__i {
  width: 26px; height: 26px; border-radius: 6px; border: 1px solid transparent;
  cursor: pointer; display: inline-block; position: relative;
}
.colors__i.is-on::after {
  content: '✓'; position: absolute; inset: 0; display: flex;
  align-items: center; justify-content: center; font-size: 13px; font-weight: 700;
}
</style>
