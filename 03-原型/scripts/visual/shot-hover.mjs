import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--disable-gpu','--hide-scrollbars'] })
const p = await b.newPage(); await p.setViewport({width:1600,height:1000})
await p.goto('http://localhost:5190/#/b/bills',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,1400))
const rows = await p.$$('.el-table__row')
const target = rows[2]
await target.hover()
await new Promise(r=>setTimeout(r,400))
const box = await target.boundingBox()
const y = Math.max(0, Math.round(box.y) - 60)
await p.screenshot({path:'screenshots/visual/after10/hover.png', clip:{x:150,y,width:1000,height:300}})
await b.close(); console.log('clipped at y', y)
