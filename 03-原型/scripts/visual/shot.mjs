/**
 * 视觉改造基线截图
 * ----------------------------------------------------------------
 * 用法：
 *   node scripts/visual/shot.mjs --base http://localhost:5188 --out screenshots/visual/before
 *   node scripts/visual/shot.mjs --base http://localhost:5188 --out screenshots/visual/after
 *
 * 只依赖仓库已装的 puppeteer-core，自己找 Chrome。
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const BASE = arg('base', 'http://localhost:5188')
const OUT = path.resolve(arg('out', 'screenshots/visual'))

const PAGES = [
  { name: 'bills', path: '/b/bills' },
  { name: 'workorders', path: '/f/workorders' },
  { name: 'owners', path: '/a/owners' },
]

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find(p => { try { return fs.existsSync(p) } catch { return false } })

if (!CHROME) { console.error('未找到 Chrome，设置 CHROME_PATH 环境变量'); process.exit(1) }

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none'],
})

const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })

const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

for (const p of PAGES) {
  const url = `${BASE}/#${p.path}`
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 })
  await new Promise(r => setTimeout(r, 1200))
  const file = path.join(OUT, `${p.name}.png`)
  await page.screenshot({ path: file })
  console.log(`✓ ${p.name} → ${file}`)
}

await browser.close()
if (errors.length) console.log(`控制台错误 ${errors.length} 条：`, errors.slice(0, 3))
