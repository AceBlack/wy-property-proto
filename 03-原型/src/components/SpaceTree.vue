<template>
  <div class="spacetree">
    <div class="spacetree__hd">
      <span class="spacetree__title">{{ title }}</span>
      <span class="spacer" />
      <el-button link size="small" @click="toggleExpand">{{ expandedAll ? '收起' : '展开' }}</el-button>
      <el-button link size="small" @click="emit('collapse')">收起栏</el-button>
    </div>

    <el-input v-model="kw" :placeholder="placeholder" clearable size="small" class="spacetree__search">
      <template #prefix><el-icon><Search /></el-icon></template>
    </el-input>

    <div v-if="virtual.length" class="spacetree__block">
      <div class="spacetree__label">常用视图</div>
      <button v-for="v in virtual" :key="v.key" class="vnode"
        :class="{ 'is-on': activeVn === v.key }" @click="pick(v, 'virtual')">
        <span class="vnode__t">{{ v.label }}</span>
        <span class="vnode__n">{{ v.n }}</span>
      </button>
    </div>

    <div class="spacetree__block is-tree">
      <div class="spacetree__label">{{ treeTitle }}</div>
      <el-scrollbar :max-height="treeMaxHeight" always>
        <el-tree ref="treeRef" :data="nodes" node-key="id" highlight-current
          :current-node-key="activeId" :default-expanded-keys="expandedKeys"
          :expand-on-click-node="false" :filter-node-method="filterNode" @node-click="onNodeClick">
          <template #default="{ data }">
            <span class="tnode">
              <span class="tnode__t">{{ data.label }}</span>
              <span class="tnode__n">{{ data.n }}</span>
              <span v-if="data.empty" class="tnode__tag">空 {{ data.empty }}</span>
              <span v-else-if="data.idle" class="tnode__tag">闲 {{ data.idle }}</span>
            </span>
          </template>
        </el-tree>
      </el-scrollbar>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'

const props = defineProps({
  title: { type: String, default: '范围' },
  treeTitle: { type: String, default: '层级' },
  nodes: { type: Array, default: () => [] },
  virtual: { type: Array, default: () => [] },
  placeholder: { type: String, default: '搜索层级' },
  activeId: { type: String, default: '' },
  activeVn: { type: String, default: '' },
  extraKeys: { type: Object, default: () => ({}) },
  treeMaxHeight: { type: String, default: 'calc(100vh - 430px)' }
})
const emit = defineEmits(['pick', 'collapse'])

const kw = ref('')
const treeRef = ref()
const expandedAll = ref(false)

/** 节点 → 路径（面包屑用），顺带做一次扁平索引 */
const index = computed(() => {
  const m = new Map()
  const walk = (list, labels, ids) => list.forEach(n => {
    m.set(n.id, { node: n, path: [...labels, n.label], chain: [...ids, n.id] })
    if (n.children?.length) walk(n.children, [...labels, n.label], [...ids, n.id])
  })
  walk(props.nodes, [], [])
  return m
})
const allIds = computed(() => [...index.value.keys()])
const expandedKeys = ref([])

watch(() => props.activeId, id => {
  if (!id) return
  const hit = index.value.get(id)
  if (!hit) return
  // 选中节点时，把它的祖先链展开，保证从 URL focus 进来也能直接看到
  const chain = []
  const find = (list, target, trail) => {
    for (const n of list) {
      const next = [...trail, n.id]
      if (n.id === target) { chain.push(...next); return true }
      if (n.children?.length && find(n.children, target, next)) { chain.push(...next); return true }
    }
    return false
  }
  find(props.nodes, id, [])
  expandedKeys.value = [...new Set([...expandedKeys.value, ...chain])]
})

watch(kw, v => treeRef.value?.filter(v))

function filterNode(value, data) {
  if (!value) return true
  const v = String(value).trim().toLowerCase()
  if (!v) return true
  const extra = props.extraKeys[data.id] || ''
  return `${data.label} ${data.id} ${extra}`.toLowerCase().includes(v)
}
function toggleExpand() {
  expandedAll.value = !expandedAll.value
  expandedKeys.value = expandedAll.value ? allIds.value : []
}
function onNodeClick(data) {
  const hit = index.value.get(data.id)
  emit('pick', { ...data, path: hit?.path || [data.label], chain: hit?.chain || [data.id], kind: 'node' })
}
function pick(v, kind) {
  emit('pick', { ...v, path: [v.label], kind })
}
</script>

<style scoped>
/* EP 把 tree 变量定义在组件作用域，写在 :root 无效 —— 这里在容器级覆盖 */
.spacetree {
  --el-tree-node-content-height: 30px;
  --el-tree-node-hover-bg-color: var(--biz-bg-hover);
  padding: 12px;
  background: var(--biz-bg-card);
  border: 1px solid var(--biz-border);
  border-radius: var(--biz-radius-panel);
}
.spacetree__hd { display: flex; align-items: center; gap: 4px; margin-bottom: 10px; }
.spacetree__hd .spacer { flex: 1; }
.spacetree__title { font-size: 13px; font-weight: 600; color: var(--biz-text-1); }
.spacetree__search { margin-bottom: 12px; }
.spacetree__block + .spacetree__block { margin-top: 12px; }
.spacetree__label {
  font-size: 11.5px; color: var(--biz-text-3); margin-bottom: 6px; letter-spacing: .3px;
}
.spacetree.is-tree :deep(.el-tree-node__content) { border-radius: 6px; }
.spacetree :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: var(--biz-primary-light-9, #eef0ff);
}
.tnode { display: flex; align-items: center; gap: 6px; width: 100%; padding-right: 8px; }
.tnode__t { font-size: 12.5px; color: var(--biz-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tnode__n {
  margin-left: auto; font-family: var(--biz-font-num); font-size: 12px; color: var(--biz-text-3);
}
.tnode__tag {
  font-size: 10.5px; color: var(--biz-warning); background: #fdf3e3;
  border-radius: var(--biz-radius-pill); padding: 0 6px; line-height: 16px;
}
.vnode {
  display: flex; align-items: center; width: 100%; height: 28px; padding: 0 8px; margin-bottom: 2px;
  background: transparent; border: 0; border-radius: 6px; cursor: pointer; text-align: left;
}
.vnode:hover { background: var(--biz-bg-hover); }
.vnode.is-on { background: var(--biz-primary-light-9, #eef0ff); }
.vnode__t { font-size: 12.5px; color: var(--biz-text-2); }
.vnode__n { margin-left: auto; font-family: var(--biz-font-num); font-size: 12px; color: var(--biz-text-3); }
</style>
