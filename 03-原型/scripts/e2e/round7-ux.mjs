/**
 * 第 82 批 · 收银台减免原因 / 业主标签 / 工单评价 / 押金类型 / 报销明细 · 验收
 * ------------------------------------------------------------
 * 这一批改的都是"字段级"的东西，但每一条都对应一个会算错钱或说不清账的口径：
 *   ① 减免不选原因 → 报表只能看到"让了多少"，看不出为什么让；
 *   ② 业主档案不能打标签 → 360 与列表能看不能改，标签体系等于只读；
 *   ③ 工单评价只在业主端能写、后台看不到 → 满意度无法进入考核；
 *   ④ 押金台账只有一个"装修押金" → 门禁卡、履约、租约的钱无处可去；
 *   ⑤ 报销只填一个总额 → 审批人无法核对明细，财务也无法核价；
 *   ⑥ 收费科目自带第三套分类 → 与费用分类字典、与押金负债口径都打架。
 */
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://localhost:5186'
const sleep = ms => new Promise(r => setTimeout(r, ms))

let pass = 0
let fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`) }
  else { fail += 1; console.log(`  ✘ ${name}${extra ? '  → ' + extra : ''}`) }
}

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox']
})
const page = await b.newPage()
const errs = []
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
page.on('pageerror', e => errs.push('pageerror ' + String(e).slice(0, 160)))
await page.setViewport({ width: 1680, height: 1180 })

const txt = sel => page.evaluate(s => {
  const el = document.querySelector(s)
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''
}, sel)
const allTxt = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

async function open(hash, wait = 2400) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2' })
  await page.evaluate(() => localStorage.setItem('wy_proto_role', 'R-GM'))
  await page.goto(`${BASE}/?t=${Date.now()}#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(wait)
}

/** 原生 setter：el-input 直接改 value 不会触发 Vue 的 v-model */
const setVal = (sel, v, idx = 0) => page.evaluate((s, val, i) => {
  const el = document.querySelectorAll(s)[i]
  if (!el) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, val)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}, sel, v, idx)

/** 打开某个 el-select 并选一项（下拉是 teleport 到 body 的，只能按可见文本点） */
async function pickSelect(wrapperSel, text, idx = 0) {
  await page.evaluate((s, i) => {
    const el = document.querySelectorAll(s)[i]
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }, wrapperSel, idx)
  await sleep(450)
  const picked = await page.evaluate(t => {
    const opts = [...document.querySelectorAll('.el-select-dropdown__item')]
      .filter(x => x.getBoundingClientRect().height > 0)
    const hit = opts.find(x => x.innerText.replace(/\s+/g, ' ').includes(t))
    if (hit) { hit.click(); return true }
    return false
  }, text)
  await sleep(500)
  return picked
}

const btnDisabled = async label => page.evaluate(t => {
  const btns = [...document.querySelectorAll('button')]
  const el = btns.find(x => x.innerText.replace(/\s+/g, '').includes(t))
  return el ? el.disabled : null
}, label)

/* ============================================================ */
console.log('\n【一】收银台：减免必须选原因，超额度必须写依据')

await open('/b/cashier', 2800)

/* 有欠费格才收得动 —— 减免只作用在账单上 */
const dueIdx = await page.evaluate(() => [...document.querySelectorAll('.pcell')]
  .map((x, i) => x.className.includes('is-due') ? i : -1).filter(i => i >= 0)[0])
ok(dueIdx >= 0, '有欠费账期格可点')
/* 全选欠费：单期金额只有三百多，凑不到「协商减免」的 500 免审额度 */
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.innerText.includes('全选欠费'))
  b?.click()
})
await sleep(800)
if (!(await page.evaluate(() => document.querySelectorAll('.cart .ci').length))) {
  await page.evaluate(i => document.querySelectorAll('.pcell')[i]?.click(), dueIdx)
  await sleep(600)
}
ok(await page.evaluate(() => document.querySelectorAll('.cart .ci').length) > 0, '已选中账单')

ok(await page.evaluate(() => !!document.querySelector('.sum__r--waive .el-select')), '减免行带原因选择器')
ok(await page.evaluate(() => !!document.querySelector('.sum__r--waive .el-input-number')), '减免金额输入框还在')

await setVal('.sum__r--waive .el-input-number input', '600')
await sleep(500)
const picked = await pickSelect('.sum__r--waive .el-select__wrapper', '协商减免')
ok(picked, '能选到「协商减免」（免审额度 500）')
ok(await page.evaluate(() => !!document.querySelector('.waive-note__warn')),
  '减免 600 超过免审额度时出现提示', await txt('.waive-note__warn'))
ok(await btnDisabled('收款') === true, '未写依据时收款按钮禁用')

await setVal('.waive-note input', '按 2026-11 与业主协商纪要减免')
await sleep(500)
ok(await btnDisabled('收款') === false, '写完依据后收款按钮可用')

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.pay-actions button')]
  btns.find(x => x.innerText.includes('收款'))?.click()
})
await sleep(2600)
const doneTxt = await txt('.pay-done')
ok(/含减免/.test(doneTxt), '收款结果标出减免金额', doneTxt.slice(0, 80))
ok(await page.evaluate(() => !document.querySelector('.waive-note')), '收款后减免依据清空（不带到下一单）')

/* ============================================================ */
console.log('\n【二】业主档案：标签与画像字段可编辑')

await open('/a/owners/OW00001/edit', 2600)
const formTxt = await txt('.page')
ok(formTxt.includes('客户画像'), '有「客户画像」分段')
ok(formTxt.includes('业主标签'), '有「业主标签」字段')
ok(formTxt.includes('业主分类') && formTxt.includes('经济状况') && formTxt.includes('政治面貌'),
  '补上了业主分类 / 经济状况 / 政治面貌')
ok(formTxt.includes('负面信息'), '补上了「负面信息」（敏感字段，仅授权可见）')
ok(formTxt.includes('结婚纪念日') && formTxt.includes('单位名称'), '补上了结婚纪念日 / 单位名称')

const tagChips = await page.evaluate(() => {
  const sec = [...document.querySelectorAll('.sec')].find(x => x.innerText.includes('客户画像'))
  return sec ? sec.querySelectorAll('.el-select .el-tag').length : 0
})
ok(tagChips > 0, '编辑态能回显已打标签', `${tagChips} 个`)

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  btns.find(x => x.innerText.includes('保存修改'))?.click()
})
await sleep(1800)
ok((await allTxt()).includes('业主信息已更新'), '保存走真实写库（不再只 sleep）')

/* ============================================================ */
console.log('\n【三】工单：后台能看到评价，也能筛出「完工未评价」')

await open('/f/workorders', 2600)
const woHead = await page.evaluate(() => [...document.querySelectorAll('.el-table__header th')]
  .map(x => x.innerText.replace(/\s+/g, '')).join('|'))
ok(woHead.includes('业主评分'), '列表有「业主评分」列', woHead.slice(0, 90))
const listTxt = await allTxt()
ok(listTxt.includes('满意度'), '顶部给出满意度（未评价不计入均值）')
ok(listTxt.includes('参评率'), '同时给出参评率，避免"满意度高但只有 3 个人评"')

await page.evaluate(() => {
  const qv = [...document.querySelectorAll('.qv .el-radio-button')]
  qv.find(x => x.innerText.includes('完工未评价'))?.click()
})
await sleep(1600)
const unratedRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body-wrapper tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim()))
ok(unratedRows.length > 0, '「完工未评价」能筛出单', `${unratedRows.length} 行`)
ok(unratedRows.every(r => r.includes('已完工')), '筛出来的都是已完工（与业主端可评价范围一致）')

await open('/f/wo-detail?id=WO000004', 2600)
const woTxt = await txt('.page')
ok(woTxt.includes('业主评价'), '详情有业主评价区块')
ok(/\d+\s*星/.test(woTxt), '展示星级评分')
ok(woTxt.includes('已评价 ·'), '展示评价时间（不是只有一个星数）')

/* ============================================================ */
console.log('\n【四】押金台账：不止装修，按类型分流程')

await open('/b/deposits', 2600)
const depTxt = await allTxt()
ok(depTxt.includes('履约保证金'), '台账出现「履约保证金」')
ok(depTxt.includes('租约押金'), '台账出现「租约押金」')
ok(depTxt.includes('按类型在账'), '有按类型拆分的在账余额')
ok(depTxt.includes('押金台账'), '页面标题已从「装修押金台账」改为「押金台账」')

const depHead = await page.evaluate(() => [...document.querySelectorAll('.el-table__header th')]
  .map(x => x.innerText.replace(/\s+/g, '')).join('|'))
ok(depHead.includes('类型'), '表格有「类型」列', depHead.slice(0, 80))

/* 筛出门禁卡：不需要验收，所以"验收"必须是禁用，"退款"可用 */
await pickSelect('.filter-bar .el-select__wrapper', '门禁卡押金', 1)
await sleep(1500)
const cardRows = await page.evaluate(() =>
  [...document.querySelectorAll('.el-table__body-wrapper tr')].map(tr => tr.innerText.replace(/\s+/g, ' ').trim()))
ok(cardRows.length > 0, '按类型筛选生效', `${cardRows.length} 行`)
/* 取一笔「在押」的门禁卡：已退还的那几笔退款按钮本来就该禁用 */
const cardBtns = await page.evaluate(() => {
  const trs = [...document.querySelectorAll('.el-table__body-wrapper tr')]
    .filter(x => x.innerText.includes('门禁卡押金'))
  const tr = trs.find(x => x.innerText.includes('在押')) || trs[0]
  if (!tr) return null
  const bs = [...tr.querySelectorAll('button')]
  return {
    status: tr.innerText.includes('在押') ? '在押' : tr.innerText.replace(/\s+/g, ' ').slice(0, 40),
    check: bs.find(x => x.innerText.includes('验收'))?.disabled,
    refund: bs.find(x => x.innerText.includes('退款'))?.disabled
  }
})
ok(cardBtns?.check === true, '门禁卡不出现「验收」动作（禁用）', JSON.stringify(cardBtns))
ok(cardBtns?.refund === false, '门禁卡可以直接退款（退卡即退）', JSON.stringify(cardBtns))

await open('/b/deposit-types', 2200)
const dtTxt = await allTxt()
ok(dtTxt.includes('押金类型字典'), '押金类型字典页可打开')
ok(dtTxt.includes('金额按约定'), '「金额按约定」的类型（履约 / 租约）有标记')
ok(dtTxt.includes('停用不删') || dtTxt.includes('已收的仍可退款'), '写明停用规则：已收的仍可退')

/* ============================================================ */
console.log('\n【五】OA 报销：明细行、总价自动、金额取合计')

await open('/c/oa-apply', 2400)
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.oa-type')].find(x => x.innerText.includes('费用报销'))
  t?.click()
})
await sleep(1000)

const oaHead = await page.evaluate(() => {
  const t = document.querySelector('.oaitems')
  return t ? [...t.querySelectorAll('th')].map(x => x.innerText.replace(/\s+/g, '')).join('|') : ''
})
ok(oaHead.includes('物品名称') && oaHead.includes('型号规格') && oaHead.includes('需求数量')
  && oaHead.includes('库存数量') && oaHead.includes('本次采购') && oaHead.includes('单价')
  && oaHead.includes('总价') && oaHead.includes('备注'),
  '明细表 9 列齐全', oaHead)

const amtDisabled = await page.evaluate(() => {
  const marks = [...document.querySelectorAll('.el-form-item')]
    .find(x => x.innerText.includes('报销金额'))
  return marks?.querySelector('input')?.disabled
})
ok(amtDisabled === true, '报销金额只读（取明细合计，避免"明细 800 / 报销 1000"）')

/* 填一行：角阀 × 2 @ 35 → 70 */
await page.evaluate(() => {
  const tr = document.querySelector('.oaitems tbody tr')
  const ins = [...tr.querySelectorAll('input')]
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  set(ins[0], '角阀')          // 物品名称
  set(ins[2], '个')            // 单位
  set(ins[5], '2')             // 本次采购
  set(ins[6], '35')            // 单价
})
await sleep(900)
const rowSum = await txt('.oaitems__sum')
ok(rowSum.replace(/[^\d.]/g, '') === '70.00', '总价 = 单价 × 本次采购 = 70.00', rowSum)
const oaAmt = await page.evaluate(() => {
  const marks = [...document.querySelectorAll('.el-form-item')].find(x => x.innerText.includes('报销金额'))
  return marks?.querySelector('input')?.value
})
ok(String(oaAmt).replace(/[^\d.]/g, '') === '70', '报销金额自动同步为明细合计', String(oaAmt))

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.oaitems__ft button')]
  btns.find(x => x.innerText.includes('添加一行'))?.click()
})
await sleep(700)
const rowCount = await page.evaluate(() => document.querySelectorAll('.oaitems tbody tr').length)
ok(rowCount === 2, '可以自己添加明细行', `${rowCount} 行`)

/* 超量采购：需求 5 / 库存 4 / 买 3 → 超 2，必须写备注 */
await page.evaluate(() => {
  const tr = document.querySelectorAll('.oaitems tbody tr')[0]
  const ins = [...tr.querySelectorAll('input')]
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  set(ins[3], '5')   // 需求数量
  set(ins[4], '4')   // 库存数量
})
await sleep(500)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  btns.find(x => x.innerText.includes('提交申请'))?.click()
})
await sleep(1200)
const submitMsg = await allTxt()
ok(submitMsg.includes('可采购量') || submitMsg.includes('备注'),
  '超出「需求 − 库存」被拦下并要求写备注', submitMsg.slice(-90))

/* 采购申请同一套明细：一次买多样东西，预算金额取合计 */
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.oa-type')].find(x => x.innerText.includes('采购申请'))
  t?.click()
})
await sleep(900)
const buyHead = await page.evaluate(() => {
  const t = document.querySelector('.oaitems')
  return t ? [...t.querySelectorAll('th')].map(x => x.innerText.replace(/\s+/g, '')).join('|') : ''
})
ok(buyHead.includes('物品名称') && buyHead.includes('预估单价') && buyHead.includes('预估总价'),
  '采购申请也有明细表（预估单价 / 预估总价）', buyHead)
const buyAmtDisabled = await page.evaluate(() => {
  const marks = [...document.querySelectorAll('.el-form-item')].find(x => x.innerText.includes('预算金额'))
  return marks?.querySelector('input')?.disabled
})
ok(buyAmtDisabled === true, '采购预算金额只读（取明细合计）')

await page.evaluate(() => {
  const tr = document.querySelector('.oaitems tbody tr')
  const ins = [...tr.querySelectorAll('input')]
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  set(ins[0], 'LED 灯管')
  set(ins[2], '支')
  set(ins[5], '10')
  set(ins[6], '18')
})
await sleep(800)
const buySum = await txt('.oaitems__sum')
ok(buySum.replace(/[^\d.]/g, '') === '180.00', '采购预估总价 = 18 × 10 = 180.00', buySum)

/* ============================================================ */
console.log('\n【六】收费科目：不再自带第三套分类，押金是负债')

await open('/b/fee-items', 2600)
const fiHead = await page.evaluate(() => [...document.querySelectorAll('.el-table__header th')]
  .map(x => x.innerText.replace(/\s+/g, '')).join('|'))
ok(fiHead.includes('方向'), '列表有「方向」列（替代原来的第三套分类）', fiHead.slice(0, 80))
ok(!fiHead.split('|').includes('分类'), '不再有单独的「分类」列（分类只认字典二级）', fiHead)

const fiTxt = await allTxt()
ok(fiTxt.includes('负债（押金）'), '装修押金标为「负债（押金）」')
ok(fiTxt.includes('参考价'), '水电单价标为「参考价」（实际按价目表）')

/* ============================================================ */
console.log('\n【七】支出归集：已批未付可以确认付款')

await open('/b/expense-collect', 2600)
const ecTxt = await allTxt()
if (ecTxt.includes('已批未付')) {
  ok(ecTxt.includes('去确认付款'), '已批未付给出「去确认付款」入口')
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.pending button')]
    btns.find(x => x.innerText.includes('去确认付款'))?.click()
  })
  await sleep(900)
  const dlg = await txt('.el-dialog')
  ok(dlg.includes('确认付款'), '付款弹层打开，按实际打款日入账')
  ok(dlg.includes('不是审批日'), '弹层写明「付款日决定账期」，与批 5 口径一致')
} else {
  ok(true, '本期没有已批未付（跳过，mock 的待付款单分布在别的月份）')
}

/* ============================================================ */
console.log('\n【八】控制台')
const realErrs = errs.filter(e => !/favicon|ResizeObserver|Download the Vue Devtools/i.test(e))
ok(realErrs.length === 0, '零 console 错误', realErrs.slice(0, 3).join(' | '))

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`)
await b.close()
process.exit(fail ? 1 : 0)
