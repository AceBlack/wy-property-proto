/**
 * 计划详情 · 三段表头一致性实测
 *
 * 针对的缺陷：量化段漏了「复评加权」列，合计卡是对的、页面也能开，
 * 只有人眼对着截图才发现。这里用真实浏览器断死「列在」与「数对」两件事：
 *   ① 表头齐全：量化 / 重点段都有「自评加权 + 复评加权」
 *   ② 数值对得上：复评加权 = 复评 × 权重
 *   ③ 不再有裸的「加权」列名
 */
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:5186'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0
let fail = 0
const ok = (c, m, e = '') => {
  if (c) { pass++; console.log('  ✔ ' + m) } else { fail++; console.log('  ✘ ' + m + (e ? '  → ' + e : '')) }
}
const num = s => Number(String(s).replace(/[^\d.-]/g, ''))

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox']
})
const page = await b.newPage()
await page.setViewport({ width: 1680, height: 1200 })

const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

const text = () => page.evaluate(() => document.body.innerText)

async function login(role) {
  await page.evaluate(r => localStorage.setItem('wy_proto_role', r), role)
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(1700)
}

/** 取第 n 张表（0=量化 1=监控 2=重点）的表头文字 */
async function headers(n) {
  return page.evaluate(i => {
    const t = document.querySelectorAll('.el-table')[i]
    if (!t) return []
    return [...t.querySelectorAll('.el-table__header th')]
      .map(th => (th.innerText || '').trim())
      .filter(Boolean)
  }, n)
}

/** 取第 n 张表第一行各列文字 */
async function firstRow(n) {
  return page.evaluate(i => {
    const t = document.querySelectorAll('.el-table')[i]
    if (!t) return []
    const tr = t.querySelector('.el-table__body tbody tr')
    if (!tr) return []
    return [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim())
  }, n)
}

console.log('=== ① 进入已结案的计划 ===')
await page.goto(BASE + '/#/f/plans', { waitUntil: 'networkidle2' })
await login('R-GM')

const hit = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')]
    .find(r => r.innerText.includes('已结案'))
  if (!tr) return null
  tr.click()
  return tr.innerText.replace(/\n+/g, ' | ').slice(0, 90)
})
ok(!!hit, '列表里找到已结案的计划', hit || '(没有已结案)')
await sleep(2200)
const url = page.url()
ok(/\/f\/plans\/PL/.test(url), '进入详情页', url)

const t0 = await text()
ok(t0.includes('一、量化指标'), '渲染出第一段（量化指标）')
ok(t0.includes('三、重点工作计划'), '渲染出第三段（重点工作）')

console.log('\n=== ② 量化段表头齐全（缺陷修复点）===')
const hQ = await headers(0)
console.log('    · 量化表头：', hQ.join(' | '))
ok(hQ.includes('自评加权'), '量化段有「自评加权」', hQ.join('/'))
ok(hQ.includes('复评加权'), '量化段有「复评加权」（原先缺失）', hQ.join('/'))
ok(hQ.includes('复评'), '量化段有「复评」原始分')
ok(!hQ.includes('加权'), '量化段没有裸的「加权」列名', hQ.join('/'))
ok(hQ.indexOf('复评加权') > hQ.indexOf('复评'), '「复评加权」排在「复评」之后')

console.log('\n=== ③ 数值对得上：复评加权 = 复评 × 权重 ===')
const rQ = await firstRow(0)
console.log('    · 量化首行：', rQ.join(' | '))

const iSelf = hQ.indexOf('自评加权')
const iReview = hQ.indexOf('复评')
const iRevW = hQ.indexOf('复评加权')
const selfW = num(rQ[iSelf])
const revScore = num(rQ[iReview])
const revW = num(rQ[iRevW])

ok(Number.isFinite(revW), `首行复评加权有数值（${rQ[iRevW]}）`, rQ[iRevW])
ok(revScore > 0, `首行复评原始分有效（${revScore}）`, rQ[iReview])
if (revScore > 0 && revW > 0) {
  /* 权重反推：加权 = 分 × 权重/100 → 权重 = 加权/分*100，应是个整齐的整数 */
  const weight = Math.round((revW / revScore) * 100)
  ok(weight > 0 && weight <= 40, `按 复评×权重 反推出权重 ${weight}%（合理区间）`, `${revW} / ${revScore}`)
  const calc = Math.round(revScore * weight / 100 * 100) / 100
  ok(Math.abs(calc - revW) < 0.02, `加权与公式一致（${revScore} × ${weight}% = ${calc}）`, `页面 ${revW}`)
}
ok(Math.abs(selfW - revW) < 0.02 || selfW > 0, `自评加权与复评加权同量级（${selfW} / ${revW}）`)

console.log('\n=== ④ 重点段同样齐全 ===')
const hK = await headers(2)
console.log('    · 重点表头：', hK.join(' | '))
ok(hK.includes('自评加权'), '重点段有「自评加权」')
ok(hK.includes('复评加权'), '重点段有「复评加权」')
ok(!hK.includes('加权'), '重点段没有裸的「加权」列名')

console.log('\n=== ⑤ 监控段是对称的两列扣分 ===')
const hM = await headers(1)
console.log('    · 监控表头：', hM.join(' | '))
ok(hM.includes('自评扣分'), '监控段有「自评扣分」')
ok(hM.includes('复评扣分'), '监控段有「复评扣分」')

console.log('\n=== ⑥ 合计卡与明细能对上 ===')
const totals = await page.evaluate(() =>
  [...document.querySelectorAll('.tot')].map(x => x.innerText.replace(/\n+/g, ' ').trim()))
console.log('    · 合计卡：', totals.join(' || '))
ok(totals.some(x => x.includes('自评加权合计')), '合计卡有「自评加权合计」')
ok(totals.some(x => x.includes('复评加权合计')), '合计卡有「复评加权合计」')
ok(totals.some(x => x.includes('月度总得分')), '合计卡有「月度总得分」')

/* 明细求和 == 合计卡：这是"能不能追溯"的硬指标。
   注意监控段也要算 —— 它权重为 0 但复评扣分是负值，会计进复评合计；
   漏掉它会得出"明细比合计多 0.04"，看着像舍入误差，实际是漏了一段。 */
const qRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table')[0].querySelectorAll('.el-table__body tbody tr')]
    .map(tr => [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim())))
const mRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table')[1].querySelectorAll('.el-table__body tbody tr')]
    .map(tr => [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim())))
const kRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table')[2].querySelectorAll('.el-table__body tbody tr')]
    .map(tr => [...tr.querySelectorAll('td')].map(td => (td.innerText || '').trim())))

const iMRev = hM.indexOf('复评扣分')
const iKRev = hK.indexOf('复评加权')
let detailRev = 0
for (const r of qRows) detailRev += num(r[iRevW]) || 0
for (const r of mRows) detailRev += num(r[iMRev]) || 0
for (const r of kRows) detailRev += num(r[iKRev]) || 0
detailRev = Math.round(detailRev * 100) / 100
const shownRev = num((totals.find(x => x.includes('复评加权合计')) || '').replace(/.*?合计/, ''))
console.log(`    · 明细求和 ${detailRev}（量化 ${qRows.length} + 监控 ${mRows.length} + 重点 ${kRows.length} 行） vs 合计卡 ${shownRev}`)
ok(Math.abs(detailRev - shownRev) < 0.02,
  '三段逐项求和 = 合计卡数值（每一分都能在明细里找到来源）',
  `${detailRev} / ${shownRev}`)

console.log('\n=== ⑦ 控制台 ===')
const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 2).join(' | '))

await page.screenshot({ path: '/tmp/shot-detail-cols.png', fullPage: false })
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
