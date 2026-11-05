/**
 * 业主端主线冒烟（自包含）
 * ------------------------------------------------------------
 * 覆盖本轮（4 tab + 按需认证）的关键路径：
 *   ① 游客可浏览首页/邻里/生活，动作级才拦（点赞要登录）
 *   ② 登录不强制实名：登录后停在未认证首页
 *   ③ 认证自动匹配：档案对得上立即生效；对不上进人工审核（模拟通过）
 *   ④ 家庭账单多房合并：合计 = 按房分组之和；跨房合并缴费
 *   ⑤ 报修双线：个人（价目 / 预付 / 增项 / 补付 / 评价）、公共（免认证、免费）
 *   ⑥ 便民缴费：水电户号 / 充值 / 余额
 *   ⑦ 邻里：动态评论（先审后发）、活动报名、投票、闲置想要
 *   ⑧ 身份权限：租客不能看业主账单
 *   ⑨ 双模式（dev / 构建产物）+ 零 console 错误
 *
 * 用法：
 *   node scripts/smoke.mjs          # 只跑 dev（没起就自己起）
 *   npm run smoke                   # dev + dist
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SHOTS = path.join(ROOT, 'screenshots')
const argv = process.argv.slice(2)
const argBase = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : ''
const BOTH = argv.includes('--both')
const DEV_BASE = argBase || 'http://localhost:5170'
const DIST_BASE = 'http://localhost:5171'

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome'
].filter(Boolean).find(p => fs.existsSync(p))
if (!CHROME) {
  console.error('找不到 Chrome，请设 CHROME_PATH')
  process.exit(2)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
let results = []
const errsByPage = new Map()
let modeTag = ''
let BASE = DEV_BASE

function pass(name, note = '') {
  results.push({ name, ok: true })
  console.log(`  ✓ ${name}${note ? '  ' + note : ''}`)
}
function fail(name, why) {
  results.push({ name, ok: false, why })
  console.log(`  ✗ ${name} — ${why}`)
}
function check(name, cond, why = '') {
  cond ? pass(name) : fail(name, why || '条件不成立')
}

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch (e) {
    return false
  }
}

let devServer = null
async function ensureDev() {
  if (await reachable(DEV_BASE)) return
  console.log(`· ${DEV_BASE} 未响应，启动 dev:h5 …`)
  devServer = spawn('npm', ['run', 'dev:h5'], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; i < 120; i++) {
    await sleep(1000)
    if (await reachable(DEV_BASE)) {
      await sleep(2000)
      return
    }
  }
  throw new Error('dev 服务器 120 秒内没起来')
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}
function serveDir(dir, port) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0])
    let file = path.join(dir, url === '/' ? 'index.html' : url)
    if (!file.startsWith(dir)) return res.writeHead(403).end()
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise(r => server.listen(port, () => r(server)))
}
async function buildDist() {
  console.log('· 构建 H5 产物 …')
  await new Promise((resolve, reject) => {
    const p = spawn('npm', ['run', 'build:h5'], { cwd: ROOT, stdio: 'inherit' })
    p.on('exit', c => (c === 0 ? resolve() : reject(new Error('build:h5 失败'))))
  })
  const dist = path.join(ROOT, 'dist/build/h5')
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('没有 dist/build/h5/index.html')
  return dist
}

/* ---------------- 页面操作 ---------------- */
let page
const shot = async name => {
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${modeTag}${name}.png`), fullPage: true })
}
const bodyText = () => page.evaluate(() => document.body.innerText)
const has = async n => (await bodyText()).includes(n)
async function waitText(n, t = 9000) {
  const t0 = Date.now()
  while (Date.now() - t0 < t) {
    if (await has(n)) return true
    await sleep(200)
  }
  return false
}
async function tapText(needle, { exact = false, idx = -1 } = {}) {
  const ok = await page.evaluate(
    (needle, exact, idx) => {
      const all = [...document.querySelectorAll('uni-view,uni-text,uni-button,div,span,text')]
      const hit = all
        .filter(n => {
          const s = (n.innerText || '').trim()
          return exact ? s === needle : s.includes(needle)
        })
        .filter(n => ![...n.children].some(c => (c.innerText || '').trim() === needle))
      if (!hit.length) return false
      const el = idx >= 0 ? hit[idx] : hit[hit.length - 1]
      el.scrollIntoView({ block: 'center' })
      el.click()
      return true
    },
    needle,
    exact,
    idx
  )
  if (ok) await sleep(700)
  return ok
}
async function tap(sel, idx = 0, wait = 800) {
  const ok = await page.evaluate(
    (s, i) => {
      const el = document.querySelectorAll(s)[i]
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      el.click()
      return true
    },
    sel,
    idx
  )
  if (ok) await sleep(wait)
  return ok
}
const visible = async sel => (await page.$(sel)) !== null
async function setInput(sel, value, idx = 0) {
  const ok = await page.evaluate(
    (s, v, i) => {
      const r = [...document.querySelectorAll(s)][i]
      if (!r) return false
      const el = r.matches('input,textarea') ? r : r.querySelector('input,textarea')
      if (!el) return false
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    },
    sel,
    value,
    idx
  )
  await sleep(250)
  return ok
}
async function goto(hash) {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle2' })
  await sleep(900)
}
const hOverflow = () => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))
function collectErrors() {
  page.on('console', m => {
    if (m.type() !== 'error') return
    const a = errsByPage.get(page.url()) || []
    a.push('[console] ' + m.text())
    errsByPage.set(page.url(), a)
  })
  page.on('pageerror', e => {
    const a = errsByPage.get(page.url()) || []
    a.push('[pageerror] ' + e.message)
    errsByPage.set(page.url(), a)
  })
}
const nums = t => (String(t).match(/¥\s?[\d,]+\.\d{2}/g) || []).map(s => Number(s.replace(/[¥,\s]/g, '')))
/**
 * 清空演示数据：**必须整页重载**。
 * store 在模块初始化时读一次缓存，只清 localStorage 不重载的话，内存里还是上一个人的会话，
 * 登录页会直接 reLaunch 回首页（表现为"换了身份还在旧账号"）。
 */
const clean = async () => {
  await page.evaluate(() => {
    try {
      localStorage.clear()
    } catch (e) {}
  })
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(900)
}

/** 登录（演示身份） */
async function loginAs(name) {
  await goto('/pages/login/index')
  await tap('#wx-login', 0, 900)
  await tapText(name)
  await sleep(1400)
}

/** 认证：社区 → 楼栋 → 房间 → 身份 */
async function auth({ community = '翡翠城', building = '1栋', houseId = 'H010110501', name = '张建国', cert = '5880' } = {}) {
  await tap('#bind-banner', 0, 1200)
  await tapText(community)
  await sleep(800)
  await tapText(building)
  await sleep(800)
  /* 房间格子用 houseId 精确点：同一楼栋两个单元都有 0501，按文字点会点到隔壁 */
  await tap(`#room-${houseId}`, 0, 600)
  await tap('#room-next', 0, 900)
  await setInput('.field__input', name, 0)
  await setInput('.field__input', cert, 1)
  await tap('#identity-submit', 0, 2000)
}

/* ---------------- 主流程 ---------------- */
async function runSuite(base, tag) {
  BASE = base
  modeTag = tag
  results = []
  errsByPage.clear()

  await page.goto(`${BASE}/#/pages/home/index`, { waitUntil: 'networkidle2' })
  await sleep(1400)

  /* ---------- 1. 游客态 ---------- */
  console.log('\n[1] 游客：不认证也能逛')
  check('首页出现「请绑定房屋」引导', await has('请绑定房屋'))
  check('未认证也能看到社区活动', await has('社区活动'))
  check('四宫格服务入口都在', (await has('生活缴费')) && (await has('报事报修')) && (await has('手机开门')) && (await has('我的车位')))
  await shot('01-home-guest')

  console.log('\n[2] 邻里 / 生活（游客可浏览）')
  await goto('/pages/neighbor/index')
  check('邻里四个子 tab 都在', (await has('邻里动态')) && (await has('闲置转让')) && (await has('投票问卷')) && (await has('社区活动')))
  check('邻里动态有物业发布内容', (await has('物业服务中心')) || (await has('停水通知')))
  await shot('02-neighbor-post')
  await tap('#ntab-sh', 0, 700)
  check('闲置转让有存量内容并标注物业代发', (await has('人想要')) && (await has('发布要接内容安全审核')))
  await shot('03-neighbor-secondhand')
  await tap('#ntab-survey', 0, 700)
  check('投票问卷列表出现', await has('人参与'))
  await tap('#ntab-activity', 0, 800)
  check('社区活动有报名入口', await waitText('人已报名') || (await waitText('已报名')) || (await waitText('去报名')))

  await goto('/pages/life/index')
  check('生活 tab 是占位但有形', (await has('即将开放')) && (await has('认证商家')))
  check('生活 tab 明确不接交易', await has('没有下单'))
  await shot('04-life')

  /* ---------- 3. 登录（不强制实名） ---------- */
  console.log('\n[3] 登录：不做实名校验')
  await clean()
  await goto('/pages/login/index')
  check('登录页有微信快捷登录与手机号登录', (await has('微信快捷登录')) && (await has('手机号登录')))
  check('登录页标注演示态', await has('验证码固定 8888'))
  await shot('05-login')
  await tap('#phone-login', 0, 800)
  await setInput('.lg__input', '13800138001')
  await tap('#send-code', 0, 700)
  check('验证码倒计时出现', await has('重新获取（'))
  await setInput('.lg__input', '8888')
  await shot('06-login-code')
  await tap('#do-login', 0, 1600)
  check('登录成功回到首页', await waitText('请绑定房屋'))
  check('登录后仍停在未认证态（不强制认证）', await has('去认证'))
  await shot('07-home-logged')

  /* ---------- 4. 认证：自动匹配秒过 ---------- */
  console.log('\n[4] 认证：档案对得上直接生效')
  await tap('#bind-banner', 0, 1200)
  check('选择小区页出现', await waitText('附近小区'))
  await shot('08-auth-community')
  await tapText('翡翠城')
  await sleep(800)
  check('楼栋列表出现', await has('个单元'))
  await shot('09-auth-building')
  await tapText('1栋')
  await sleep(800)
  check('房间网格按单元分组', (await has('1单元')) && (await has('㎡')))
  await tap('#room-H010110501', 0, 600)
  await tap('#room-next', 0, 900)
  check('身份页带出房号', await has('1栋1单元0501'))
  await shot('10-auth-identity')
  await setInput('.field__input', '张建国', 0)
  await setInput('.field__input', '5880', 1)
  await tap('#identity-submit', 0, 2200)
  check('自动匹配通过、进入首页', await waitText('待缴'))
  check('房卡显示房号与业主身份', (await has('1栋1单元0501')) && (await has('业主')))
  const oneDebt = nums(await bodyText())[0]
  check('只绑一套时只算这一套 + 车位', Math.abs(oneDebt - 1420.14) < 0.01, `实际 ${oneDebt}`)
  check('首页提示还有未绑定房产', await visible('#bind-more'))
  await shot('11-home-auth')

  /* 补绑第二套：认证是逐套绑的，绑完才谈"多房合并" */
  await tap('#bind-more', 0, 1200)
  await tapText('翡翠城')
  await sleep(800)
  await tapText('3栋')
  await sleep(800)
  await tap('#room-H010311102', 0, 600)
  await tap('#room-next', 0, 900)
  await setInput('.field__input', '张建国', 0)
  await setInput('.field__input', '5880', 1)
  await tap('#identity-submit', 0, 2000)
  check('第二套绑定成功', await waitText('2 套可切换') || (await has('名下还有')))
  const homeDebt = nums(await bodyText())[0]
  check('首页待缴 = 2031.01（两房合并）', Math.abs(homeDebt - 2031.01) < 0.01, `实际 ${homeDebt}`)
  await shot('11b-home-auth2')

  /* ---------- 5. 家庭账单（多房合并） ---------- */
  console.log('\n[5] 家庭账单：多房合并缴费')
  await tapText('家庭账单')
  check('进入家庭账单', await waitText('家庭待缴合计'))
  const billTotal = nums(await bodyText()).find(v => Math.abs(v - homeDebt) < 0.01)
  check('账单合计与首页一致', !!billTotal, `首页 ${homeDebt}`)
  check('按房分组（两套都在）', (await has('1栋1单元0501')) && (await has('3栋1单元1102')))
  check('车位费单独成组', await has('车位'))
  await shot('12-bills-due')
  await tap('#bills-all', 0, 800)
  await shot('13-bills-picked')
  await tap('#bills-pay-all', 0, 1800)
  check('生成待支付订单', await waitText('应付金额'))
  const payAmt = nums(await bodyText())[0]
  check('支付金额 = 账单合计', Math.abs(payAmt - homeDebt) < 0.01, `支付 ${payAmt}`)
  check('多房合并说明可见', (await has('套房合并缴费')) || (await has('合并缴费')))
  await shot('14-pay-bill')
  await tap('#pay-sim', 0, 1600)
  check('模拟支付成功', await waitText('实付金额'))
  await shot('15-pay-bill-done')
  await goto('/pages/bills/index')
  check('账单已结清', await waitText('所有账单已结清'))

  /* ---------- 6. 个人报修（价目 → 预付 → 增项 → 补付 → 评价） ---------- */
  console.log('\n[6] 个人报修全链路')
  await goto('/pages/repair/list')
  check('报修列表有个人/公共两条线', (await has('个人报修')) && (await has('公共区域')))
  await shot('16-repair-list')
  await tap('#repair-new', 0, 1200)
  check('下单页显示价目', await waitText('角阀/软管更换'))
  await tapText('角阀/软管更换')
  await setInput('.textarea', '主卫角阀处持续渗水，地面积水，希望今天上门')
  await shot('17-repair-form')
  await tap('#repair-submit', 0, 2000)
  check('进入待支付', await waitText('应付金额'))
  const woPay = nums(await bodyText())[0]
  check('报修支付 = 价目合计 125', Math.abs(woPay - 125) < 0.01, `实际 ${woPay}`)
  await tap('#pay-sim', 0, 1600)
  await tapText('查看报修进度')
  check('进入报修详情', await waitText('报修详情') || (await waitText('个人报修')))
  check('详情显示已支付', await has('已支付'))
  await shot('18-repair-detail')
  await tap('#demo-add', 0, 1200)
  check('出现待确认增项', await waitText('待确认'))
  check('三段金额都在', (await has('原价')) && (await has('增项')) && (await has('确认后合计')))
  await shot('19-repair-addon')
  await tap('#wo-main', 0, 900)
  if (await has('确认并入')) await tapText('确认并入')
  await sleep(1200)
  check('确认后合计并入 205', await has('¥205.00'))
  check('出现差额补付入口', await visible('#wo-pay-link'))
  await tap('#wo-pay-link', 0, 1600)
  const addonPay = nums(await bodyText())[0]
  check('补付 = 差额 80', Math.abs(addonPay - 80) < 0.01, `实际 ${addonPay}`)
  await shot('20-pay-addon')
  await tap('#pay-sim', 0, 1600)
  await tapText('查看报修进度')
  await sleep(1400)
  check('补付后无待支付', !(await visible('#wo-pay-link')))
  await tap('#wo-main', 0, 900)
  check('评价弹层出现', await waitText('对本次服务满意吗'))
  await tapText('很满意')
  await tapText('收费透明')
  await setInput('.ev__text', '师傅上门很快，价格和下单时看到的一致')
  await shot('21-eval-sheet')
  await tap('#eval-submit', 0, 1400)
  check('评价写回详情', await waitText('我的评价'))
  await shot('22-repair-evaluated')

  /* ---------- 7. 公共报修（免认证、免费） ---------- */
  console.log('\n[7] 公共报修：登录即可，免费')
  await goto('/pages/repair/create?scope=public')
  check('公共报修可选位置', await waitText('问题位置'))
  check('公式报修标注不收费', await has('不收费'))
  await tapText('单元电梯轿厢')
  await tapText('下水道疏通')
  await setInput('.textarea', '3栋2单元电梯运行到6层有异响，请检查')
  await shot('23-repair-public')
  await tap('#repair-submit', 0, 1800)
  check('公共报修免支付，直接进详情', await waitText('个人报修') || (await waitText('公共区域')))
  check('公共单据金额为免费', (await has('¥0.00')) || (await has('无需支付')))
  await shot('24-repair-public-detail')

  /* ---------- 8. 便民缴费 ---------- */
  console.log('\n[8] 便民缴费：水电户号 + 充值')
  await goto('/pages/utility/index')
  check('本房有水电户号', (await has('水费')) && (await has('电费')))
  check('燃气如实标注未开通', await has('未开通'))
  await shot('25-utility')
  await tap('[id^="ut-recharge-"]', 0, 1200)
  check('充值页出现快捷金额', await waitText('充值金额'))
  await tapText('200 元')
  await shot('26-utility-recharge')
  await tap('#ut-pay', 0, 1600)
  await sleep(1200)
  check('充值后余额增加', await waitText('余额') || (await has('充值成功')))

  /* ---------- 9. 邻里交互 ---------- */
  console.log('\n[9] 邻里：评论 / 报名 / 投票 / 想要')
  await goto('/pages/neighbor/index')
  await tap('#ntab-post', 0, 700)
  await tap('.pc', 0, 1300)
  check('进入动态详情', await waitText('邻里评论'))
  await tap('#post-comment', 0, 900)
  await setInput('.textarea', '收到，谢谢提醒')
  await shot('27-post-comment')
  await tap('#comment-submit', 0, 1200)
  check('评论提交后标审核中', await has('审核中'))

  await goto('/pages/neighbor/index')
  await tap('#ntab-activity', 0, 800)
  await tap('.act', 0, 1300)
  check('进入活动详情', await waitText('报名须知'))
  await tap('#act-enroll', 0, 1400)
  check('报名成功', (await has('已报名')) || (await has('取消报名')))
  await shot('28-activity')

  await goto('/pages/neighbor/index')
  await tap('#ntab-survey', 0, 800)
  await tap('.sv', 0, 1300)
  check('进入投票详情', await waitText('参与'))
  await tap('.opt', 0, 500)
  await tap('#sv-submit', 0, 1200)
  check('投票后显示占比', await has('%'))
  await shot('29-survey')

  await goto('/pages/neighbor/index')
  await tap('#ntab-sh', 0, 800)
  await tap('.sh', 0, 1300)
  check('进入闲置详情', await waitText('交易方式'))
  await tap('#sh-want', 0, 900)
  check('想要已记录', (await has('已收藏')) || (await has('取消想要')))
  await shot('30-secondhand')

  /* ---------- 10. 我的 / 身份权限 ---------- */
  console.log('\n[10] 我的 + 身份权限')
  await goto('/pages/mine/index')
  check('我的页显示认证身份', await has('已认证'))
  check('七格入口齐全', (await has('物业缴费')) && (await has('我的房产')) && (await has('便民缴费')))
  await shot('31-mine')

  await goto('/pages/house/index')
  check('我的房屋显示面积与住户', (await has('建筑面积')) && (await has('本房住户')))
  await shot('32-house')

  /* 租客：不能看业主账单 */
  await clean()
  await loginAs('钟瑞')
  await auth({ community: '翡翠城', building: '1栋', houseId: 'H010111002', name: '钟瑞', cert: '8874' })
  check('租客认证通过（房卡出现）', await waitText('1栋1单元1002', 6000))
  check('租客身份标签为租客', await waitText('租客', 4000))
  await goto('/pages/bills/index')
  await sleep(1200)
  check('租客进账单被权限拦下', (await has('当前身份无权限')) || !(await has('家庭待缴合计')))
  await shot('33-tenant-blocked')

  /* ---------- 11. 审核兜底 ---------- */
  console.log('\n[11] 信息不一致 → 人工审核')
  await clean()
  await loginAs('李秀兰')
  await tap('#bind-banner', 0, 1200)
  await tapText('翡翠城')
  await sleep(800)
  await tapText('2栋')
  await sleep(800)
  await tap('#room-H010210302', 0, 600)
  await tap('#room-next', 0, 900)
  await setInput('.field__input', '李秀兰', 0)
  await setInput('.field__input', '1111', 1)
  await tap('#identity-submit', 0, 1200)
  check('证件不符时要求上传证明', await has('请上传购房合同'))
  await shot('34-auth-mismatch')

  /* ---------- 12. 布局 ---------- */
  console.log('\n[12] 布局与零错误')
  const of1 = await hOverflow()
  check('认证页无横向溢出', of1 <= 1, `溢出 ${of1}px`)
  await goto('/pages/home/index')
  const of2 = await hOverflow()
  check('首页无横向溢出', of2 <= 1, `溢出 ${of2}px`)
  const errs = [...errsByPage.entries()].flatMap(([u, a]) => a.map(e => `${u.replace(BASE, '')} → ${e}`))
  check('零 console 错误', errs.length === 0, '\n    ' + errs.slice(0, 6).join('\n    '))
}

async function main() {
  await ensureDev()
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  collectErrors()

  const runs = []
  await runSuite(DEV_BASE, 'dev-')
  runs.push({ label: 'dev（dev:h5）', results: [...results] })

  if (BOTH) {
    const dist = await buildDist()
    const server = await serveDir(dist, 5171)
    await runSuite(DIST_BASE, 'dist-')
    runs.push({ label: 'dist（构建产物）', results: [...results] })
    server.close()
  }

  await browser.close()
  console.log('\n===== 汇总 =====')
  let bad = 0
  for (const r of runs) {
    const b = r.results.filter(x => !x.ok)
    bad += b.length
    console.log(`${r.label}: ${r.results.length - b.length}/${r.results.length} 通过${b.length ? '  ✕' : '  ✓'}`)
    b.forEach(x => console.log(`    ✗ ${x.name} — ${x.why || ''}`))
  }
  if (bad) process.exit(1)
  console.log(`截图：${SHOTS}`)
}

main()
  .catch(e => {
    console.error('\n脚本异常：', e)
    process.exit(1)
  })
  .finally(() => {
    if (devServer) devServer.kill('SIGTERM')
  })
