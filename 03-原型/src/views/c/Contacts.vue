<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>通讯录</b>：所有在职同事的联系方式。按部门找、按姓名/岗位/手机搜，
        卡片上的号码<b>不脱敏</b>——同事之间看全号，点「复制」直接拷走，点「拨打」在支持拨号的设备上呼出。
        <br />
        <b>只显示在职</b>（含试用）：给离职同事打电话是这类工具最常见的错误。
        <b>不含</b>薪资、证件、银行卡、紧急联系人——那些在「员工档案」里，需要 <code>c.employees.view</code>；
        通讯录只有 <code>c.contacts.view</code>，所有角色默认都有。
      </div>
    </div>

    <div class="grid ct-stats">
      <div class="panel ct-stat">
        <div class="ct-stat__k">在职同事</div>
        <div class="ct-stat__v">{{ st.total }} <span class="unit">人</span></div>
        <div class="ct-stat__s">含试用期，不含离职</div>
      </div>
      <div class="panel ct-stat">
        <div class="ct-stat__k">在岗部门</div>
        <div class="ct-stat__v">{{ st.orgCount }} <span class="unit">个</span></div>
        <div class="ct-stat__s">只算有直属员工的组织</div>
      </div>
      <div class="panel ct-stat">
        <div class="ct-stat__k">有手机号</div>
        <div class="ct-stat__v">{{ st.withPhone }} <span class="unit">人</span></div>
        <div class="ct-stat__s">占在职 {{ st.total ? Math.round(st.withPhone / st.total * 100) : 0 }}%</div>
      </div>
    </div>

    <div class="ct-layout">
      <!-- 左：部门树 -->
      <div class="panel ct-side">
        <div class="panel__hd">
          <h3>部门</h3><span class="spacer" />
          <el-button v-if="orgId" link type="primary" size="small" @click="pickOrg('')">全部</el-button>
        </div>
        <div class="ct-tree">
          <div class="ct-tree__hint">只列出有人的部门 · 数字含下级</div>
          <div class="ct-tree__all" :class="{ 'is-on': !orgId }" @click="pickOrg('')">
            <span>全部同事</span>
            <span class="ct-tree__n">{{ st.total }}</span>
          </div>
          <el-tree
            ref="treeRef"
            :data="tree"
            node-key="orgId"
            :props="{ label: 'name', children: 'children' }"
            :expand-on-click-node="false"
            :highlight-current="!!orgId"
            :default-expanded-keys="expanded"
            @node-click="onNodeClick"
          >
            <template #default="{ data }">
              <span class="ct-node">
                <span class="ct-node__n">{{ data.name }}</span>
                <span class="ct-node__c">{{ data.totalCount }}</span>
              </span>
            </template>
          </el-tree>
        </div>
      </div>

      <!-- 右：卡片墙 -->
      <div class="panel ct-main">
        <div class="ct-bar">
          <el-input
            v-model="kw" clearable :prefix-icon="'Search'" style="width:280px"
            placeholder="姓名 / 岗位 / 部门 / 手机号（可搜后 4 位）"
            @input="onSearch"
          />
          <span class="ct-bar__scope">{{ scopeText }}</span>
          <span class="spacer" />
          <span class="ct-bar__n">共 <b>{{ total }}</b> 人</span>
        </div>

        <div v-loading="loading" class="ct-body">
          <template v-if="groups.length">
            <div v-for="g in groups" :key="g.orgId" class="ct-group">
              <div class="ct-group__hd">
                <span class="ct-group__n">{{ g.orgName }}</span>
                <span class="ct-group__c">{{ g.rows.length }} 人</span>
              </div>
              <div class="ct-wall">
                <div
                  v-for="r in g.rows" :key="r.empId"
                  class="ct-card" :class="{ 'is-me': r.empId === me.empId }"
                >
                  <div class="ct-avatar" :class="avatarClass(r.name)">{{ r.name.slice(0, 1) }}</div>
                  <div class="ct-info">
                    <div class="ct-name">
                      {{ r.name }}
                      <el-tag v-if="r.empId === me.empId" size="small" effect="plain" type="success">我</el-tag>
                    </div>
                    <div class="ct-pos">{{ r.position }}</div>
                    <div class="ct-org">{{ r.orgName }}</div>
                    <div class="ct-phone">
                      <span class="mono">{{ r.phone || '未登记' }}</span>
                      <template v-if="r.phone">
                        <el-button link type="primary" size="small" @click="copyPhone(r)">复制</el-button>
                        <a class="ct-call" :href="`tel:${r.phone}`" :title="`呼叫 ${r.name} ${r.phone}`">拨打</a>
                      </template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <EmptyState
            v-else type="search" title="没有找到匹配的同事"
            desc="换个关键词试试；号码记不全可以直接搜后 4 位"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { contactMe, contactStats, contactTree, queryContacts } from '@/utils/api'
import EmptyState from '@/components/EmptyState.vue'

const tree = ref([])
const st = ref({ total: 0, orgCount: 0, withPhone: 0 })
const me = ref({ empId: '', name: '' })
const groups = ref([])
const total = ref(0)
const kw = ref('')
const orgId = ref('')
const loading = ref(false)
const treeRef = ref()
/* 默认展开到「总部职能中心 / 项目」这一层，再深就太长了 */
const expanded = ref([])

const scopeText = computed(() => {
  if (kw.value.trim()) return `搜索「${kw.value.trim()}」`
  if (!orgId.value) return '全部同事'
  const hit = findNode(tree.value, orgId.value)
  return hit ? `${hit.name}（含下级）` : '全部同事'
})

function findNode(list, id) {
  for (const n of list) {
    if (n.orgId === id) return n
    const hit = findNode(n.children || [], id)
    if (hit) return hit
  }
  return null
}

async function load() {
  loading.value = true
  try {
    const res = await queryContacts({ orgId: orgId.value, kw: kw.value })
    groups.value = res.groups
    total.value = res.total
  } catch (e) {
    ElMessage.error(e?.message || '通讯录加载失败')
  } finally {
    loading.value = false
  }
}

let timer = null
function onSearch() {
  /* 输一个字查一次会把接口打满，也会让光标位置跳 */
  clearTimeout(timer)
  timer = setTimeout(load, 280)
}

function pickOrg(id) {
  orgId.value = id
  if (id) treeRef.value?.setCurrentKey(id)
  else treeRef.value?.setCurrentKey(null)
  load()
}
function onNodeClick(data) {
  pickOrg(data.orgId)
}

/** 头像底色按姓名散列：同一人每次进页面颜色一样，不然像换了个系统 */
const AVATAR_COLORS = ['c1', 'c2', 'c3', 'c4', 'c5']
function avatarClass(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 997
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

async function copyPhone(row) {
  const text = row.phone
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制 ${row.name}：${text}`)
  } catch {
    /* 无剪贴板权限（http 非安全上下文）时给个兜底：选中文本让人自己 Ctrl+C */
    ElMessage.warning(`复制失败，请手动选中：${text}`)
  }
}

onMounted(async () => {
  try {
    tree.value = contactTree()
    st.value = contactStats()
    me.value = contactMe()
    /* 展开「总部职能中心」与各项目这两层 */
    expanded.value = tree.value.flatMap(n => [n.orgId, ...(n.children || []).map(c => c.orgId)])
  } catch (e) {
    ElMessage.error(e?.message || '部门树加载失败')
  }
  load()
})
</script>

<style scoped>
.ct-stats { margin-top: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.ct-stat { padding: 14px 16px; }
.ct-stat__k { font-size: 12.5px; color: var(--biz-text-3); }
.ct-stat__v { font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px; }
.ct-stat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.ct-stat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }

.ct-layout { display: grid; grid-template-columns: 258px minmax(0, 1fr); gap: 16px; margin-top: 16px; align-items: start; }

.ct-side { padding: 0 0 10px; }
.ct-side .panel__hd { padding: 12px 14px 8px; }
.ct-tree { max-height: 640px; overflow: auto; padding: 0 8px; }
.ct-tree__hint { font-size: 11px; color: var(--biz-text-3); padding: 0 10px 6px; }
.ct-tree__all {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px; border-radius: 7px; cursor: pointer; font-size: 13px;
  color: var(--biz-text-2); margin-bottom: 4px;
}
.ct-tree__all:hover { background: var(--biz-bg-fill); }
.ct-tree__all.is-on { background: rgba(91, 108, 255, .1); color: var(--el-color-primary); font-weight: 600; }
.ct-tree__n { font-size: 11.5px; font-family: var(--biz-font-num); color: var(--biz-text-3); }
.ct-tree__all.is-on .ct-tree__n { color: var(--el-color-primary); }

.ct-node { display: flex; align-items: center; justify-content: space-between; width: 100%; padding-right: 6px; }
.ct-node__n { font-size: 12.5px; }
.ct-node__c { font-size: 11px; font-family: var(--biz-font-num); color: var(--biz-text-3); }

.ct-main { padding: 0 0 14px; }
.ct-bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--biz-border); }
.ct-bar .spacer { flex: 1; }
.ct-bar__scope { font-size: 12px; color: var(--biz-text-3); }
.ct-bar__n { font-size: 12px; color: var(--biz-text-3); }
.ct-bar__n b { font-family: var(--biz-font-num); color: var(--biz-text-1); }

.ct-body { padding: 6px 16px 0; max-height: 620px; overflow: auto; }
.ct-group { margin-top: 12px; }
.ct-group__hd {
  display: flex; align-items: baseline; gap: 8px;
  padding-bottom: 6px; border-bottom: 1px dashed var(--biz-border);
}
.ct-group__n { font-size: 13px; font-weight: 600; color: var(--biz-text-1); }
.ct-group__c { font-size: 11.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }

.ct-wall {
  display: grid; gap: 10px; margin-top: 10px;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
}
.ct-card {
  display: flex; gap: 10px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--biz-border); background: #fff;
  transition: border-color .18s, box-shadow .18s;
}
.ct-card:hover { border-color: rgba(91, 108, 255, .3); box-shadow: 0 2px 10px rgba(91, 108, 255, .07); }
.ct-card.is-me { border-color: rgba(47, 158, 110, .35); background: rgba(47, 158, 110, .04); }

.ct-avatar {
  width: 34px; height: 34px; flex: 0 0 34px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: #fff; font-weight: 600;
  background: var(--biz-primary, #5b6cff);
}
.ct-avatar.c1 { background: #5b6cff; }
.ct-avatar.c2 { background: #12b98a; }
.ct-avatar.c3 { background: #f0a020; }
.ct-avatar.c4 { background: #7a5af8; }
.ct-avatar.c5 { background: #3aa0d8; }

.ct-info { min-width: 0; flex: 1; }
.ct-name { font-size: 13.5px; color: var(--biz-text-1); font-weight: 600; display: flex; align-items: center; gap: 6px; }
.ct-pos { font-size: 11.5px; color: var(--biz-text-2); margin-top: 2px; }
.ct-org { font-size: 11.5px; color: var(--biz-text-3); margin-top: 1px; }
.ct-phone {
  display: flex; align-items: center; gap: 8px; margin-top: 5px;
  font-size: 12px; color: var(--biz-text-1);
}
.ct-phone .mono { font-family: var(--biz-font-num); letter-spacing: .3px; }
.ct-call {
  font-size: 11.5px; color: var(--el-color-primary); text-decoration: none;
}
.ct-call:hover { text-decoration: underline; }
</style>
