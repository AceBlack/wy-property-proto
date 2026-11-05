import puppeteer from 'puppeteer-core'
const B='http://localhost:5199'
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']})
const p=await b.newPage(); await p.setViewport({width:390,height:844})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
await p.goto(`${B}/#/pages/login/index`,{waitUntil:'networkidle2'}); await sleep(900)
await p.evaluate(()=>document.querySelectorAll('.pcard')[0].click()); await sleep(1200)
await p.goto(`${B}/#/pages/wo/detail?id=WO000002`,{waitUntil:'networkidle2'}); await sleep(1400)
console.log((await p.evaluate(()=>document.body.innerText)).replace(/\n/g,'|').slice(0,700))
await b.close()
