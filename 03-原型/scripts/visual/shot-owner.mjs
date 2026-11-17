import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--disable-gpu','--hide-scrollbars'] })
const p = await b.newPage(); await p.setViewport({width:1600,height:1000})
await p.goto('http://localhost:5190/#/a/owner360',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,1500))
await p.screenshot({path:'screenshots/visual/after9/owner360.png'})
await b.close(); console.log('ok')
