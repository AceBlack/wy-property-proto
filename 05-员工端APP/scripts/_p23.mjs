import puppeteer from 'puppeteer-core'
const B='http://localhost:5199'
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']})
const p=await b.newPage(); await p.setViewport({width:390,height:844})
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\n/g,'|')
await p.goto(`${B}/#/pages/login/index`,{waitUntil:'networkidle2'}); await sleep(900)
await p.evaluate(()=>document.querySelectorAll('.pcard')[3].click()); await sleep(1300)
for (const id of ['AP00099','AP00001']) {
  await p.goto(`${B}/#/pages/oa/detail?id=${id}`,{waitUntil:'networkidle2'}); await sleep(1300)
  const t=await txt()
  console.log('===', id, '===')
  console.log(t.slice(0,520))
}
console.log('errs', errs.length?errs.slice(0,3):'none')
await b.close()
