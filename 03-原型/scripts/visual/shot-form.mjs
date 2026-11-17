import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--disable-gpu','--hide-scrollbars'] })
const p = await b.newPage(); await p.setViewport({width:1600,height:1000})
for (const [url,name] of [['/#/a/owners/new','owner-new'],['/#/f/workorders/new','wo-new']]) {
  await p.goto('http://localhost:5190'+url,{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,1400))
  await p.screenshot({path:`screenshots/visual/after11/${name}.png`})
}
await b.close(); console.log('ok')
