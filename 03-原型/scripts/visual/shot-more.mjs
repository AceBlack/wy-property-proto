import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--disable-gpu','--hide-scrollbars'] })
const p = await b.newPage(); await p.setViewport({width:1600,height:1000})
await p.goto('http://localhost:5190/#/b/bills',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,1500))
const btn = await p.$('.bl-more'); await btn.click(); await new Promise(r=>setTimeout(r,600))
await p.screenshot({path:'screenshots/visual/after7/bills-more.png'})
await b.close(); console.log('ok')
