// 列表查询 / 详情查询的组合式封装（A 级交互的通用骨架）
// 页面只传「取数函数」，分页、加载态、重置逻辑全部复用，L4 批量页直接继承

import { onMounted, reactive, ref, watch } from 'vue'

/**
 * 列表查询
 * @param {Function} fetcher  (params) => Promise<{ rows, total }>，通常来自 utils/api.js
 * @param {Object}   opts
 *   filters  - 筛选字段初始值（重置时回填）
 *   size     - 默认每页条数
 *   immediate- 是否挂载即查询
 *
 * 异常口径（2026-10-22 修订）：失败不再静默清空数据后置之不理，而是置 error 供页面渲染
 * 「加载失败 + 重试」，与「查询成功但 0 条」严格区分——此前二者都显示「暂无数据」，
 * 无法分辨是接口坏了还是真的没有业务数据。
 */
export function useListQuery(fetcher, { filters = {}, size: defaultSize = 20, immediate = true } = {}) {
  const rows = ref([])
  const total = ref(0)
  const pageNo = ref(1)
  const size = ref(defaultSize)
  const loading = ref(false)
  const error = ref('')
  const errorCode = ref(0)
  const query = reactive({ ...filters })

  async function load() {
    loading.value = true
    error.value = ''
    errorCode.value = 0
    try {
      const res = await fetcher({ pageNo: pageNo.value, size: size.value, filters: { ...query } })
      rows.value = res.rows
      total.value = res.total
    } catch (e) {
      rows.value = []
      total.value = 0
      error.value = e?.message || '数据加载失败'
      errorCode.value = e?.code || 500
    } finally {
      loading.value = false
    }
  }

  /** 点「查询」：回到第一页再取数（筛选不即时生效，符合后台习惯） */
  function search() { pageNo.value = 1; load() }

  /** 点「重置」：清空筛选 + 回第一页 */
  function reset() { Object.assign(query, filters); pageNo.value = 1; load() }

  watch([pageNo, size], load)
  if (immediate) onMounted(load)

  return { rows, total, pageNo, size, loading, error, errorCode, query, load, search, reset }
}

/**
 * 详情查询（抽屉 / 弹窗 / 独立详情页用）
 * @param {Function} fetcher (id) => Promise<Object|null>
 * @param {Ref}      idRef   传入则挂载即取数并随 id 变化自动刷新（详情页用法）
 * 失败时置 error、data 保持 null：页面据此区分「加载失败」与「查无此条」
 */
export function useDetail(fetcher, idRef = null) {
  const data = ref(null)
  const visible = ref(false)
  const loading = ref(false)
  const error = ref('')

  async function fetchById(id) {
    loading.value = true
    error.value = ''
    data.value = null
    try {
      data.value = await fetcher(id)
    } catch (e) {
      error.value = e?.message || '详情加载失败'
    } finally {
      loading.value = false
    }
  }

  async function open(id) {
    visible.value = true
    await fetchById(id)
  }
  function close() { visible.value = false; error.value = '' }

  /** 独立详情页：watch id 并立即取数 */
  if (idRef) {
    watch(idRef, id => { if (id) fetchById(id) }, { immediate: true })
  }

  return { data, visible, loading, error, open, close, load: fetchById }
}
