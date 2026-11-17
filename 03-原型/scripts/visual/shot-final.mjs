import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--disable-gpu','--hide-scrollbars'] })
const p = await b.newPage(); await p.setViewport({width:1600,height:1000})
const pages = [['/b/bills','bills'],['/a/owners','owners-legacy'],['/f/workorders','workorders']]
for (const [url,name] of pages) {
  await p.goto('http://localhost:5190/#'+url,{waitUntil:'networkidle2'})
  await new Promise(r=>setTimeout(r,1400))
  await p.screenshot({path:`screenshots/visual/after12/${name}.png`})
}
// 量一次真实值，确认 token 生效
await p.goto('http://localhost:5190/#/b/bills',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,1200))
console.log(JSON.stringify(await p.evaluate(()=>{
  const row=document.querySelector('.el-table__row')
  const li=document.querySelector('.el-pager li.is-active')
  const cs=li?getComputedStyle(li):null
  return {
    rowH: row? Math.round(row.getBoundingClientRect().height):null,
    pageActiveBg: cs?cs.backgroundColor:null,
    pageActiveColor: cs?cs.color:null,
    pageRadius: cs?cs.borderRadius:null
  }
})))
await b.close()
