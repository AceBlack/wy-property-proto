// 导出：页面统一走「提交任务」，文件只在下载中心生成并下载
//
// 口径（用户 2026-10-22 确认）：页面内不再同步生成文件 ——
//   点「导出」= 提交一个异步任务，本页立即返回；生成、下载都在下载中心完成。
// 原型没有对象存储，文件内容用 CSV 文本近似（Excel 可直接打开），
// 正式实现替换为后端 xlsx 即可，页面侧调用方式不变。

import { ElMessage } from 'element-plus'
import { submitExport } from '@/utils/download'

/** 按列定义生成 CSV（BOM 头避免 Excel 中文乱码） */
export function toCsv(columns, rows) {
  const esc = v => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.map(c => esc(c.label)).join(',')
  const body = rows.map(r => columns.map(c => esc(r[c.prop])).join(','))
  return '\uFEFF' + [head, ...body].join('\n')
}

/**
 * 页面提交导出任务的唯一入口
 * @param {object} o
 * @param {string} o.name     任务名（下载中心显示），如「账单查询」
 * @param {string} o.source   来源路径，下载中心可跳回
 * @param {Array}  o.columns  [{ prop, label }]
 * @param {Array|Function} o.rows  数据行数组，或返回数组的 async 函数（全量导出用）
 * @param {object} o.filters  提交时的筛选条件快照
 * @param {string} o.type     报表 / 列表
 * @returns {string} 任务号
 */
export function submitTableExport({ name, source = '', columns = [], rows = [], filters = {}, type = '列表' }) {
  const snapshot = Array.isArray(rows) ? rows : null
  const buildRows = async () => {
    let list = snapshot
    if (!list) {
      const res = await rows()                 // 全量取数：传函数时在这里才执行
      list = Array.isArray(res) ? res : (res?.rows || [])
    }
    return list
  }
  const id = submitExport({
    name, type, source, filters,
    count: snapshot ? snapshot.length : 0,
    build: async () => toCsv(columns, await buildRows())
  })
  return id
}

/**
 * 列表页导出的统一写法：提交任务 + 提示去下载中心
 * 页面调用这一行即可，不写任何生成文件 / 触发下载的代码
 */
export function exportList({ name, source = '', columns = [], rows = [], filters = {} }) {
  submitTableExport({ name, source, columns, rows, filters })
  ElMessage({ type: 'success', ...exportSubmitted(name) })
}

/** 提交后的统一提示：告诉用户去哪下载，页面不再弹「已导出」 */
export function exportSubmitted(name) {
  return {
    dangerouslyUseHTMLString: true,
    message: `「${name}」已提交导出任务，生成完成后在<a href="#/e/downloads" style="color:#5b6cff;font-weight:600;">下载中心</a>下载`,
    duration: 3200
  }
}
