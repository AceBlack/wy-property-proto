// 导出：页面统一走「提交任务」，文件只在下载中心生成并下载
//
// 口径（用户 2026-10-22 确认）：页面内不再同步生成文件 ——
//   点「导出」= 提交一个异步任务，本页立即返回；生成、下载都在下载中心完成。
// 原型没有对象存储，文件内容用 CSV 文本近似（Excel 可直接打开），
// 正式实现替换为后端 xlsx 即可，页面侧调用方式不变。

import { ElMessage } from 'element-plus'
import { submitExport } from '@/utils/download'
import { prepareExport } from '@/utils/api'

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
 * 导出前先过 `prepareExport` 的合规校验（P6 数据安全）：
 *   · 超单次上限 → 直接抛错拦截，不产生下载任务；
 *   · 含敏感列且当前角色无明文权限 → 自动按脱敏值导出，并写一条「脱敏」留痕；
 *   · 其余照常导出，每次导出都写一条留痕（大额导出会标注）。
 * @param {object} o
 * @param {string} o.name     任务名（下载中心显示），如「账单查询」
 * @param {string} o.source   来源路径，下载中心可跳回
 * @param {Array}  o.columns  [{ prop, label }]
 * @param {Array|Function} o.rows  数据行数组，或返回数组的 async 函数（全量导出用）
 * @param {object} o.filters  提交时的筛选条件快照
 * @param {string} o.type     报表 / 列表
 * @returns {{id: string, masked: boolean}} 任务号 + 是否已脱敏
 */
export function submitTableExport({ name, source = '', columns = [], rows = [], filters = {}, type = '列表' }) {
  const snapshot = Array.isArray(rows) ? rows : null
  let plan = null
  // 数组行可同步校验：拦截不会留下一个失败任务
  if (snapshot) plan = prepareExport({ name, source, columns, rows: snapshot, filters })
  const buildRows = async () => {
    if (plan) return plan.rows
    const res = await rows()                 // 全量取数：传函数时在这里才执行
    const list = Array.isArray(res) ? res : (res?.rows || [])
    plan = prepareExport({ name, source, columns, rows: list, filters })
    return plan.rows
  }
  const id = submitExport({
    name, type, source, filters,
    count: snapshot ? snapshot.length : 0,
    build: async () => toCsv(columns, await buildRows())
  })
  return { id, masked: !!(plan && plan.masked) }
}

/**
 * 列表页导出的统一写法：合规校验 → 提交任务 → 提示去下载中心
 * 页面调用这一行即可，不写任何生成文件 / 触发下载的代码
 */
export function exportList({ name, source = '', columns = [], rows = [], filters = {} }) {
  let r
  try {
    r = submitTableExport({ name, source, columns, rows, filters })
  } catch (e) {
    ElMessage.error(e?.message || '导出被拦截')
    return ''
  }
  ElMessage(r.masked ? exportMasked(name) : { type: 'success', ...exportSubmitted(name) })
  return r.id
}

/** 脱敏导出后的提示：说明为什么脱敏，并指出留痕可查 */
export function exportMasked(name) {
  return {
    type: 'warning',
    dangerouslyUseHTMLString: true,
    message: `「${name}」含敏感字段，当前角色无明文权限，已按<b>脱敏值</b>提交；本次导出已记入<a href="#/e/access-log" style="color:#5b6cff;font-weight:600;">数据访问日志</a>，生成后在<a href="#/e/downloads" style="color:#5b6cff;font-weight:600;">下载中心</a>下载`,
    duration: 4200
  }
}

/** 提交后的统一提示：告诉用户去哪下载，页面不再弹「已导出」 */
export function exportSubmitted(name) {
  return {
    dangerouslyUseHTMLString: true,
    message: `「${name}」已提交导出任务，生成完成后在<a href="#/e/downloads" style="color:#5b6cff;font-weight:600;">下载中心</a>下载`,
    duration: 3200
  }
}
