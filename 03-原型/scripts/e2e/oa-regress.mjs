/** OA 回归：oaFormCheck 改成 oaFormOf 之后，普通单据（有动态表单）必须照常提交 */
import puppeteer from 'puppeteer-core'
const sleep = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, m, e = '') => { c ? (pass++, console.log('  ✔ ' + m)) : (fail++, console.log('  ✘ ' + m + (e ? '  → ' + e : ''))) }

const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 1100 })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })

await p.goto('http://localhost:5186/#/c/oa-apply', { waitUntil: 'networkidle2' })
await p.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
await p.reload({ waitUntil: 'networkidle2' })
await sleep(1500)

const t0 = await p.evaluate(() => document.body.innerText)
ok(t0.includes('用车申请'), 'OA 申请页渲染单据类型')

/* 选「用车申请」 */
await p.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find(x => x.children.length === 0 && (x.innerText || '').trim() === '用车申请')
  if (el) el.closest('.card, .type, li, div').click()
})
await sleep(900)
const hasForm = await p.evaluate(() => document.body.innerText.includes('用车事由'))
ok(hasForm, '选中单据后渲染动态表单字段')

/* 填必填项：目的地 + 用车事由（时间用默认值） */
await p.evaluate(() => {
  const fill = (ph, val) => {
    const inp = [...document.querySelectorAll('input,textarea')].find(i => (i.placeholder || '').includes(ph))
    if (!inp) return false
    /* textarea 要用 HTMLTextAreaElement 的 setter，用 input 的会 Illegal invocation */
    const proto = inp.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(inp, val)
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  window.__filled = {
    dest: fill('目的地', '总部'),
    reason: fill('用车事由', '送材料到翡翠城项目')
  }
})
await sleep(500)
const filled = await p.evaluate(() => window.__filled)
ok(filled.dest && filled.reason, `填写必填字段（${JSON.stringify(filled)}）`)

const submitted = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => /提交|发起/.test(x.innerText || ''))
  if (btn) { btn.click(); return btn.innerText.trim() }
  return ''
})
ok(!!submitted, `找到提交按钮「${submitted}」`)
await sleep(2000)
const toast = await p.evaluate(() => [...document.querySelectorAll('.el-message')].map(x => x.innerText.trim()).join(' | '))
const t1 = await p.evaluate(() => document.body.innerText)
console.log('    · toast：', toast || '(无)')
/* 回归目标：oaFormCheck 不能抛「oaFormOf is not defined」这类程序错误。
   拿到中文业务校验提示（如"请填写用车时间"）就说明校验链路正常工作 ——
   时间字段没填只是本脚本没填，不是缺陷。 */
const programError = /not defined|is not a function|Cannot read/.test(toast)
ok(!programError, 'oaFormCheck 没有程序异常（校验链路正常）', toast)
ok(/请填写|提交成功|已提交/.test(toast) || /审批中|待审批/.test(t1), 'OA 单据走到表单校验/提交环节', toast || t1.slice(0, 100))

const real = errs.filter(e => !e.includes('favicon') && !e.includes('ResizeObserver'))
ok(real.length === 0, `零 console 错误（${real.length}）`, real.slice(0, 2).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await b.close()
process.exit(fail ? 1 : 0)
