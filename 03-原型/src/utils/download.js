// 下载中心：所有导出统一走异步任务，页面内不再同步生成文件
//
// 口径（用户 2026-10-22 确认）：
//   ① 页面点「导出」= 提交一个导出任务，立即返回，不在当前页生成/下载任何文件；
//   ② 任务在后台排队 → 生成 → 完成，进度与状态在下载中心可见；
//   ③ 下载动作只发生在下载中心，任务完成后 24 小时内有效；
//   ④ 生成失败可重试，失败原因落到任务上，不在页面弹窗里丢掉。
//
// 存储取舍：任务元数据存 localStorage（跨刷新保留）；文件内容存 sessionStorage
// （同标签页刷新仍可下载）。文件超过 sessionStorage 余量时降级为「已过期」，
// 提示回来源页重新导出 —— 原型环境没有对象存储，这是最接近真实行为的近似。

import { reactive, computed } from 'vue'
import { currentRoleName } from '@/utils/auth'

const KEY = 'wy_dl_tasks'
const FILE = 'wy_dl_file_'
const KEEP = 60                 // 最多保留 60 条任务记录
const EXPIRE_HOURS = 24         // 文件有效期
const MAX_RUNNING = 3           // 并发上限：超出的排队等待
const TIMEOUT_MS = 90 * 1000    // 单任务硬超时：超过即判失败，防止任务永远卡在「生成中」
const AUTO_RETRY = 1            // 失败后自动重试次数（超过转人工）
const KEEP_FAILED_DAYS = 7      // 失败 / 已过期任务保留天数，超期自动清理

/* ---------------- 状态与存储 ---------------- */

let seq = 0
const state = reactive({ tasks: load(), failMode: false })

// 任务号在同一会话内递增；刷新后从历史记录的最大序号接着编，避免与已有任务重号
seq = state.tasks.reduce((m, t) => {
  const hit = /-(\d{4})$/.exec(t.id || '')
  return hit ? Math.max(m, Number(hit[1])) : m
}, 0)

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    // 刷新后：未完成的任务不可能还在跑（定时器已随页面销毁），回退为「已失败 · 可重试」
    return list.map(t => (t.status === '排队中' || t.status === '生成中')
      ? { ...t, status: '失败', progress: 0, error: '页面刷新导致任务中断，可重试' }
      : t)
  } catch {
    return []
  }
}
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state.tasks.slice(0, KEEP)))
  } catch { /* 配额满：只影响跨刷新保留，不影响当前会话 */ }
}
function putFile(id, text) {
  try {
    sessionStorage.setItem(FILE + id, text)
    return true
  } catch {
    return false            // 放不下：标记已过期
  }
}
const getFile = id => sessionStorage.getItem(FILE + id)
const dropFile = id => sessionStorage.removeItem(FILE + id)

const find = id => state.tasks.find(t => t.id === id)

/* ---------------- 任务号与时间 ---------------- */

function nextId() {
  const d = new Date()
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  seq += 1
  return `DL${day}-${String(seq).padStart(4, '0')}`
}
const nowText = () => {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const hoursLeft = t => {
  if (!t.finishedAt) return 0
  const diff = Date.now() - new Date(t.finishedAt.replace(/-/g, '/')).getTime()
  return Math.max(0, EXPIRE_HOURS - Math.floor(diff / 3600000))
}

/* ---------------- 提交与推进 ---------------- */

/**
 * 提交导出任务（页面唯一入口，立即返回）
 * @param {object} o
 * @param {string} o.name     任务名，如「费用明细表」
 * @param {string} o.type     来源类型：报表 / 列表
 * @param {string} o.source   来源页面路径（下载中心可跳回）
 * @param {object} o.filters  提交时的筛选条件快照（下载中心可回显）
 * @param {number} o.count    预计条数
 * @param {Function} o.build  生成文件内容的函数，可 async，返回文本
 */
export function submitExport({ name, type = '列表', source = '', filters = {}, count = 0, format = 'xlsx', build = null }) {
  const task = {
    id: nextId(),
    name, type, source,
    filters: JSON.parse(JSON.stringify(filters || {})),
    count: count || 0,
    format,
    status: '排队中',
    progress: 0,
    createdAt: nowText(),
    finishedAt: '',
    size: 0,
    operator: currentRoleName.value || '—',
    error: ''
  }
  state.tasks.unshift(task)
  if (build) BUILDS.set(task.id, build)     // 生成函数只在当前会话有效，不进 localStorage
  persist()
  schedule()
  return task.id
}

/** 调度：并发未满则把排队任务拉起 */
function schedule() {
  const running = state.tasks.filter(t => t.status === '生成中').length
  if (running >= MAX_RUNNING) return
  const next = [...state.tasks].reverse().find(t => t.status === '排队中')
  if (next) start(next.id)
}

function start(id) {
  const t = find(id)
  if (!t) return
  t.status = '生成中'
  t.progress = 4
  t.error = ''
  persist()
  setTimeout(() => tick(id), 400)
}

function _bornMs(t) {
  const v = new Date(String(t.createdAt || '').replace(/-/g, '/')).getTime()
  return Number.isNaN(v) ? Date.now() : v
}
/** 统一失败出口：写原因 + 按策略自动重试一次，重试也用尽才留给人工 */
function failTask(t, msg) {
  t.retries = t.retries || 0
  if (t.retries < AUTO_RETRY && BUILDS.has(t.id)) {
    t.retries += 1
    t.status = '排队中'
    t.progress = 0
    t.error = `${msg}（已自动重试第 ${t.retries} 次）`
    persist()
    setTimeout(schedule, 600)
    return
  }
  t.status = '失败'
  t.progress = 0
  t.error = msg
  persist()
  schedule()
}

function tick(id) {
  const t = find(id)
  if (!t || t.status !== '生成中') return
  // 硬超时：浏览器切后台 / 长任务卡死时，任务不能永远停在「生成中」
  if (Date.now() - _bornMs(t) > TIMEOUT_MS) {
    failTask(t, `生成超时（超过 ${Math.round(TIMEOUT_MS / 1000)}s），任务已回收`)
    return
  }
  // 条数越多走得越慢，让「生成中」这个状态在演示里真的看得见
  const step = t.count > 2000 ? 12 + Math.random() * 14 : 18 + Math.random() * 22
  t.progress = Math.min(96, Math.round(t.progress + step))
  if (t.progress >= 96) {
    finish(id)
  } else {
    persist()
    setTimeout(() => tick(id), 320)
  }
}

async function finish(id) {
  const t = find(id)
  if (!t) return
  const build = BUILDS.get(id)
  // 失败注入：演示「生成失败 → 重试」这一支（下载中心可开关）
  // 注意：失败分支不能删 build，否则重试时没有生成函数，会变成永远修不好的死任务
  if (state.failMode) {
    failTask(t, '导出服务超时（模拟）：生成时间超过 60s，请重试或缩小筛选范围')
    return
  }
  try {
    // 刷新后 build 函数已随会话销毁（函数无法持久化），重试也无内容可生成
    if (!build) throw new Error('页面已刷新，导出内容无法重建，请回来源页重新导出')
    const text = await build()
    if (!text) throw new Error('没有可导出的数据')
    const ok = putFile(id, text)
    t.progress = 100
    t.status = ok ? '已完成' : '已过期'
    t.size = new Blob([text]).size
    t.count = (text.trim().split('\n').length - 1) || t.count
    t.finishedAt = nowText()
    t.error = ok ? '' : '文件超过本地存储余量，请回来源页重新导出'
  } catch (e) {
    failTask(t, e?.message || '生成失败')   // 保留 build：自动重试与手动重试都要能重跑
    return
  }
  BUILDS.delete(id)             // 只有成功才释放
  persist()
  schedule()
}

// build 函数只在当前会话有效，不进 localStorage
const BUILDS = new Map()
export function registerBuild(id, fn) { if (fn) BUILDS.set(id, fn) }

/* ---------------- 查询与操作 ---------------- */

export const STATUS_OPTS = ['排队中', '生成中', '已完成', '失败', '已过期']

export function listTasks({ status = '', type = '', kw = '' } = {}) {
  const k = String(kw || '').trim()
  return state.tasks.filter(t =>
    (!status || t.status === status) &&
    (!type || t.type === type) &&
    (!k || (t.name + t.id + t.source).includes(k))
  )
}

export const allTasks = () => state.tasks
export const pendingCount = () => state.tasks.filter(t => ['排队中', '生成中'].includes(t.status)).length
export const doneCount = () => state.tasks.filter(t => t.status === '已完成').length

export function taskSummary() {
  const c = s => state.tasks.filter(t => t.status === s).length
  return {
    total: state.tasks.length,
    pending: c('排队中') + c('生成中'),
    done: c('已完成'),
    failed: c('失败'),
    expired: c('已过期')
  }
}

/** 下载：只有已完成且有文件的任务能下载；文件由下载中心生成，页面从不触发下载 */
export function downloadTask(id) {
  const t = find(id)
  if (!t) return { ok: false, msg: '任务不存在' }
  if (t.status !== '已完成') return { ok: false, msg: '任务尚未完成，无法下载' }
  const text = getFile(id)
  if (!text) {
    t.status = '已过期'
    t.error = '文件已超出有效期，请重新导出'
    persist()
    return { ok: false, msg: '文件已超出有效期，请重新导出' }
  }
  // BOM 只加一次：toCsv 已经带 BOM，这里避免重复导致 Excel 首列名多一个不可见字符
  const body = text.charCodeAt(0) === 0xFEFF ? text : '\uFEFF' + text
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }))
  a.download = `${t.name}-${t.id}.${t.format === 'xlsx' ? 'csv' : t.format}`
  document.body.appendChild(a)
  a.click()
  URL.revokeObjectURL(a.href)
  a.remove()
  return { ok: true, msg: `已下载 ${t.count} 条` }
}

/**
 * 任务清理（下载中心挂载时调用）：
 *   ① 已完成但超过有效期的文件 → 标「已过期」并释放存储；
 *   ② 失败 / 已过期且超过 7 天的记录 → 自动移除（避免 localStorage 越滚越大）。
 */
export function sweepTasks() {
  let expired = 0
  let removed = 0
  const now = Date.now()
  for (const t of [...state.tasks]) {
    if (t.status === '已完成' && hoursLeft(t) === 0 && t.finishedAt) {
      t.status = '已过期'
      t.error = '文件已超出 24 小时有效期，请重新导出'
      dropFile(t.id)
      expired++
      continue
    }
    if (['失败', '已过期'].includes(t.status)) {
      const base = String(t.finishedAt || t.createdAt || '').replace(/-/g, '/')
      const ms = new Date(base).getTime()
      if (!Number.isNaN(ms) && now - ms > KEEP_FAILED_DAYS * 86400000) {
        const i = state.tasks.findIndex(x => x.id === t.id)
        if (i >= 0) state.tasks.splice(i, 1)
        dropFile(t.id)
        removed++
      }
    }
  }
  if (expired || removed) persist()
  return { expired, removed }
}

export function retryTask(id) {
  const t = find(id)
  if (!t) return false
  t.status = '排队中'
  t.progress = 0
  t.error = ''
  t.finishedAt = ''
  persist()
  schedule()
  return true
}

export function removeTask(id) {
  const i = state.tasks.findIndex(t => t.id === id)
  if (i >= 0) {
    state.tasks.splice(i, 1)
    dropFile(id)
    persist()
  }
}

export function clearFinished() {
  state.tasks.filter(t => ['已完成', '失败', '已过期'].includes(t.status)).forEach(t => dropFile(t.id))
  state.tasks = state.tasks.filter(t => !['已完成', '失败', '已过期'].includes(t.status))
  persist()
}

/** 失败注入开关（与 api.js 的 setFailMode 同款思路：异常态必须能真实触发） */
export function setExportFailMode(on) { state.failMode = !!on }
export const exportFailMode = computed(() => state.failMode)

export const sizeText = bytes => {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
export const expireText = t => {
  if (t.status !== '已完成') return '—'
  const h = hoursLeft(t)
  return h > 0 ? `${h} 小时内` : '已过期'
}
