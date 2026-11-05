import puppeteer from 'puppeteer-core'
const B='http://localhost:5199'
const b=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']})
const p=await b.newPage(); await p.setViewport({width:390,height:844})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const txt=async()=>(await p.evaluate(()=>document.body.innerText)).replace(/\n/g,'|')
await p.goto(`${B}/#/pages/login/index`,{waitUntil:'networkidle2'}); await sleep(900)
await p.evaluate(()=>document.querySelectorAll('.pcard')[3].click()); await sleep(1300)
for (const id of ['AP00099','AP00100','AP00101','AP00092']) {
  await p.goto(`${B}/#/pages/oa/detail?id=${id}`,{waitUntil:'networkidle2'}); await sleep(1100)
  const t=await txt()
  console.log('===', id, '===', t.slice(0,180))
  if (t.includes('会签')) console.log('   会签块:', t.slice(t.indexOf('会签名单'), t.indexOf('会签名单')+220))
}
await b.close()
