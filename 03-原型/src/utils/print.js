// X4 打印：统一的新窗口打印通道
// 原型阶段不接真打印机 / 不生成 PDF，只把「单据 HTML」丢进独立窗口调 window.print()，
// 由浏览器提供打印预览与另存为 PDF。所有单据共用一套排版基线（表格 + 页脚 + 落款）。

const BASE_CSS = `
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;color:#1f2430;font-size:13px;}
  .phd{border-bottom:1px solid #d8dce6;padding-bottom:10px;margin-bottom:14px;}
  .phd .tt{font-size:18px;font-weight:600;}
  .phd .sub{font-size:12px;color:#6b7590;margin-top:4px;}
  table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;}
  th,td{border:1px solid #d8dce6;padding:7px 10px;text-align:left;}
  th{background:#f4f6fb;font-weight:600;}
  td.r,th.r{text-align:right;}
  tfoot td{font-weight:600;background:#fafbfd;}
  .pft{margin-top:16px;font-size:12px;color:#6b7590;line-height:1.8;}
  .sign{margin-top:26px;display:flex;justify-content:space-between;font-size:12.5px;color:#3b4256;}
  .sign span{border-top:1px solid #c9cfdd;padding-top:6px;min-width:140px;text-align:center;}
  .kv{margin:10px 0;}
  .kv div{display:flex;gap:10px;padding:3px 0;}
  .kv .k{width:88px;color:#6b7590;flex:0 0 auto;}
`

/**
 * 打印一段 HTML
 * @param {string} title 打印窗口标题（也是另存 PDF 的默认文件名）
 * @param {string} html  单据正文 HTML
 * @param {string} style 追加样式
 * @returns {boolean} 是否成功拉起打印窗口（被浏览器拦截时返回 false）
 */
export function printHtml(title, html, { style = '' } = {}) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return false
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${BASE_CSS}${style}</style></head><body>${html}</body></html>`
  )
  w.document.close()
  w.focus()
  w.print()
  return true
}

/** 直接打印页面上某个区域的 innerHTML（弹窗里的预览区通常用这个） */
export function printArea(title, selector, opts = {}) {
  const el = typeof selector === 'string' ? document.querySelector(selector) : selector
  if (!el) return false
  return printHtml(title, el.innerHTML, opts)
}

/** 单据头：标题 + 副信息 */
export const docHead = (tt, sub = '') =>
  `<div class="phd"><div class="tt">${tt}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`

/** 表格：cols=[{label,width}]，rows=对象数组，foot 为合计行（与 cols 对齐的字符串数组） */
export function docTable(cols, rows, foot = null) {
  const th = cols.map(c => `<th${c.right ? ' class="r"' : ''}>${c.label}</th>`).join('')
  const td = rows.map(r =>
    `<tr>${cols.map(c => `<td${c.right ? ' class="r"' : ''}>${r[c.prop] ?? ''}</td>`).join('')}</tr>`
  ).join('')
  const tf = foot
    ? `<tfoot><tr>${foot.map((v, i) => `<td${cols[i]?.right ? ' class="r"' : ''}>${v}</td>`).join('')}</tr></tfoot>`
    : ''
  return `<table><thead><tr>${th}</tr></thead><tbody>${td || '<tr><td colspan="' + cols.length + '" style="text-align:center;color:#8b93a7">无数据</td></tr>'}</tbody>${tf}</table>`
}

/** 页脚 + 落款 */
export const docFoot = (note = '', signs = ['收款人：', '业主签字：']) =>
  (note ? `<div class="pft">${note}</div>` : '') +
  (signs.length ? `<div class="sign">${signs.map(s => `<span>${s}</span>`).join('')}</div>` : '')

export const esc = v => String(v ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
export const money2 = v => Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
