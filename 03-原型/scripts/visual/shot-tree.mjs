import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--disable-gpu','--hide-scrollbars'] })
const p = await b.newPage(); await p.setViewport({width:1600,height:1000})
await p.goto('http://localhost:5190/#/b/bills',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,1500))
const n = await p.$$('.bl-node'); if(n[1]){ await n[1].click(); await new Promise(r=>setTimeout(r,700)) }
const n2 = await p.$$('.bl-node'); if(n2[2]){ await n2[2].click(); await new Promise(r=>setTimeout(r,900)) }
await p.screenshot({path:'screenshots/visual/after4/bills-tree.png'})
await b.close(); console.log('ok')
