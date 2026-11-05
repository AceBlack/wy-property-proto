/**
 * 资产标签：二维码占位图 + A4 不干胶打印
 *
 * 为什么不引二维码库：原型里不装第三方依赖（`qrcode` 会进包），而且这个码在
 * 演示环境里不会被真机扫。这里只是**按二维码的视觉规格**画一个占位图：
 * 三个定位角 + 与内容相关的伪点阵。同一个 `token` 永远画出同一张图，所以
 * 「换了资产码就变」这件事在演示里是成立的。
 *
 * 真正上线时替换成真二维码（后端按 `/scan/{token}` 出图），
 * 标签版式与调用方都不用改 —— 只要 `qrDataUrl()` 返回一张 DataURL 就行。
 */

const N = 21 // 21×21 点阵，和真二维码（version 1）网格一致，视觉上不会被看出是假的

/** 由文本派生一张 21×21 点阵图（DataURL），同一文本结果稳定 */
export function qrDataUrl(text, px = 160) {
  const cell = Math.floor(px / N)
  const seed = [...String(text)].reduce((h, ch) => (h * 131 + ch.charCodeAt(0)) >>> 0, 7)
  let bits = ''
  let x = seed || 1
  for (let i = 0; i < N * N; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    bits += (x >>> 16) & 1 ? '1' : '0'
  }
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7)
  const finderOn = (r, c) => {
    const rr = r < 7 ? r : r - (N - 7)
    const cc = c < 7 ? c : c - (N - 7)
    if (rr === 0 || rr === 6 || cc === 0 || cc === 6) return true
    return rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4
  }
  let rects = ''
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const on = inFinder(r, c) ? finderOn(r, c) : bits[r * N + c] === '1'
      if (on) rects += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="#111"/>`
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${N * cell} ${N * cell}"><rect width="100%" height="100%" fill="#fff"/>${rects}</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

/**
 * 打开打印窗口。`labels` 是 `assetLabelRows()` 的返回（含 name / assetNo / catName / scanUrl）。
 * 版式：A4 每页 3 列 × 8 行，虚线裁切框 —— 不干胶纸撕下来正好。
 */
export function printAssetLabels(labels = [], { scanBase = '' } = {}) {
  const list = Array.isArray(labels) ? labels : []
  if (!list.length) return { ok: false, reason: 'empty' }
  const w = window.open('', '_blank', 'width=900,height=1200')
  if (!w) return { ok: false, reason: 'blocked' }

  const cells = list.map(l => {
    const url = scanBase ? `${scanBase}${l.scanUrl}` : l.scanUrl
    return `<div class="lb">
      <div class="lb__n">${esc(l.name)}</div>
      <div class="lb__c">${esc(l.catName || '')}</div>
      <div class="lb__q"><img src="${qrDataUrl(url, 120)}" alt="${esc(l.assetNo)}"/></div>
      <div class="lb__no">${esc(l.assetNo)}</div>
      <div class="lb__h">扫码查看 / 报修</div>
    </div>`
  }).join('')

  w.document.write(`<!doctype html><meta charset="utf-8"><title>资产标签（${list.length}）</title>
<style>
  @page { size: A4; margin: 8mm; }
  body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; padding: 4mm; }
  .lb { border: 1px dashed #c4c4c4; border-radius: 3mm; padding: 3mm; text-align: center; page-break-inside: avoid; }
  .lb__n { font-size: 11pt; font-weight: 600; line-height: 1.3; height: 2.6em; overflow: hidden; }
  .lb__c { font-size: 8pt; color: #666; margin-bottom: 1mm; }
  .lb__q img { width: 26mm; height: 26mm; }
  .lb__no { font-size: 9pt; font-family: ui-monospace, SFMono-Regular, monospace; letter-spacing: .3px; }
  .lb__h { font-size: 7.5pt; color: #999; margin-top: 1mm; }
</style>
<div class="sheet">${cells}</div>
<script>setTimeout(function(){ window.print() }, 400)<\/script>`)
  w.document.close()
  return { ok: true, count: list.length }
}
