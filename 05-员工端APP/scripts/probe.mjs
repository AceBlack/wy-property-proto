/**
 * 探针：单页加载 → 抓 console 错误 + 截图（调试用，smoke.mjs 才是正式自检）
 */
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const url = process.argv[2] || 'http://localhost:5199/#/pages/login/index'
const out = process.argv[3] || '/tmp/probe.png'

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
const errs = []
page.on('console', m => {
  if (m.type() === 'error') errs.push('[console] ' + m.text())
})
page.on('pageerror', e => errs.push('[pageerror] ' + e.message))
page.on('requestfailed', r => errs.push('[reqfail] ' + r.url() + ' ' + r.failure()?.errorText))

await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise(r => setTimeout(r, 2600))
console.log('=== TEXT ===\n' + (await page.evaluate(() => document.body.innerText.slice(0, 700))))
console.log('=== ERRORS ===\n' + (errs.length ? errs.join('\n') : '(none)'))
await page.screenshot({ path: out, fullPage: false })
await browser.close()
