import puppeteer from 'puppeteer-core'
const B='http://localhost:5199'
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']})
const p=await b.newPage(); await p.setViewport({width:390,height:844})
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\n/g,'|')
const login=async(i)=>{await p.goto(`${B}/#/pages/login/index`,{waitUntil:'networkidle2'});await sleep(900);await p.evaluate(i=>document.querySelectorAll('.pcard')[i].click(),i);await sleep(1300)}

await login(1)  // 汪磊
await p.goto(`${B}/#/pages/oa/list`,{waitUntil:'networkidle2'}); await sleep(1400)
console.log('--- 汪磊 待办 ---')
console.log((await txt()).slice(0,420))

await login(3)  // 徐悦
await p.goto(`${B}/#/pages/oa/list`,{waitUntil:'networkidle2'}); await sleep(1400)
console.log('--- 徐悦 待办 ---')
console.log((await txt()).slice(0,420))
console.log('errs', errs.length?errs.slice(0,3):'none')
await b.close()
