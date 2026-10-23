# -*- coding: utf-8 -*-
import json, html
from collections import Counter, OrderedDict

D = '/Users/aev/WorkBuddy/WYDoc/01-功能盘点'
rows = json.load(open(D + '/data/mapped.json'))

DOM_ORDER = ['A 资产', 'B 费用', 'C 办公', 'D 物联', 'E 平台底座']
L1_ORDER = [
    'A1 空间资源', 'A2 人员档案', 'A3 车辆与车位', 'A4 生命周期', 'A5 经营合同', 'A6 通行与出入',
    'B1 收费配置', 'B2 计费与出账', 'B3 抄表与公摊', 'B4 收款与票据', 'B5 退费与票据', 'B6 欠费与催缴',
    'C1 审批流', 'C2 考勤', 'C3 工单与服务', 'C4 现场作业', 'C5 采购与库存', 'C6 行政与社区',
    'D1 设备与台账', 'D2 门禁', 'D3 车场设备', 'D4 视频监控', 'D7 边缘设备',
    'E1 组织与权限', 'E2 系统配置', 'E3 报表与驾驶舱', 'E4 端与渠道配置',
]
rows.sort(key=lambda r: (DOM_ORDER.index(r['domain']), L1_ORDER.index(r['l1']) if r['l1'] in L1_ORDER else 99))

CACT = Counter([x['act'] for x in rows])
CDOM = Counter([x['domain'] for x in rows])
TOTAL = len(rows)

DOM_META = {
    'A 资产': ('人 · 车 · 房', '业主、房屋、车位、合同与通行', '#2f6fd0', '#eaf1fd'),
    'B 费用': ('收费与资金', '收费配置、出账、收款、退费、催缴', '#d97706', '#fdf3e7'),
    'C 办公': ('OA 与现场作业', '审批流、考勤、工单、巡检、采购', '#2e8540', '#eaf6ec'),
    'D 物联': ('IoT 硬件联动', '门禁、车牌识别、监控、表计、告警', '#7b3fb5', '#f4ecfb'),
    'E 平台底座': ('跨域共享', '组织权限、系统配置、报表、端配置', '#5b6b7c', '#eef1f4'),
}

groups = OrderedDict()
for x in rows:
    groups.setdefault((x['domain'], x['l1']), []).append(x)


def tag(act):
    cls = {'保留': 'k', '升级': 'u', '合并': 'm', '重建': 'r', '放弃': 'd'}[act]
    return '<span class="tg t%s">%s</span>' % (cls, act)


parts = []
parts.append('''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>智慧物业管理系统 · 功能盘点与重构地图</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
 --navy:#1f3864; --ink:#1c2530; --sub:#5b6b7c; --line:#e3e8ee; --bg:#f6f8fa; --card:#fff;
 --k:#2e8540; --kb:#e6f4ea; --u:#a06a00; --ub:#fff4d6; --m:#2f6fd0; --mb:#e8f0fd;
 --r:#c2410c; --rb:#fdeee5; --d:#6b7684; --db:#eef1f4;
}
body{background:var(--bg);color:var(--ink);font:14px/1.65 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1440px;margin:0 auto;padding:0 28px 80px}
header{background:linear-gradient(135deg,#1f3864 0%,#2b4f8f 60%,#33639f 100%);color:#fff;padding:38px 0 30px;margin-bottom:0}
header .wrap{padding-bottom:0}
h1{font-size:26px;font-weight:700;letter-spacing:.5px}
.sub{margin-top:8px;font-size:13px;color:#c9d8f0}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;margin-top:26px}
.stat{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:14px 16px}
.stat b{display:block;font-size:24px;font-weight:700;line-height:1.2}
.stat span{font-size:12px;color:#c9d8f0}
.bar{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid var(--line);padding:12px 0;margin-bottom:26px;box-shadow:0 2px 10px rgba(20,40,80,.05)}
.bar .wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:0}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 14px;font-size:13px;cursor:pointer;color:var(--sub);transition:.15s;user-select:none}
.chip:hover{border-color:#b9c6d6}
.chip.on{background:var(--navy);border-color:var(--navy);color:#fff;font-weight:600}
.sep{width:1px;height:22px;background:var(--line);margin:0 8px}
.legend{margin-left:auto;font-size:12px;color:var(--sub);display:flex;gap:12px;align-items:center}
.legend i{font-style:normal;display:inline-flex;align-items:center;gap:5px}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.domain{margin-bottom:34px}
.dhead{display:flex;align-items:baseline;gap:14px;padding:14px 0 12px;border-bottom:2px solid var(--line);margin-bottom:18px}
.dhead h2{font-size:19px;font-weight:700}
.dhead .desc{font-size:13px;color:var(--sub)}
.dhead .cnt{margin-left:auto;font-size:12px;color:var(--sub);background:#fff;border:1px solid var(--line);border-radius:999px;padding:3px 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(20,40,80,.04)}
.card h3{font-size:14px;font-weight:700;padding:12px 16px;background:#fbfcfd;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.card h3 em{font-style:normal;font-size:11px;font-weight:500;color:var(--sub);margin-left:auto}
.fn{padding:11px 16px;border-bottom:1px solid #f1f4f7;cursor:pointer;transition:background .12s}
.fn:last-child{border-bottom:0}
.fn:hover{background:#fafcfe}
.fn .top{display:flex;align-items:center;gap:8px}
.fn .nm{font-size:13.5px;font-weight:600}
.fn .tg{font-size:11px;padding:1px 7px;border-radius:5px;font-weight:600;flex:none}
.tk{background:var(--kb);color:var(--k)} .tu{background:var(--ub);color:var(--u)}
.tm{background:var(--mb);color:var(--m)} .tr{background:var(--rb);color:var(--r)}
.td{background:var(--db);color:var(--d)}
.fn .meta{font-size:11.5px;color:#8a97a6;margin-top:3px}
.fn .note{font-size:12.5px;color:var(--sub);margin-top:6px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.fn.open .note{-webkit-line-clamp:unset}
.concl{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px 26px;margin-top:10px}
.concl h2{font-size:17px;margin-bottom:14px}
.concl ol{padding-left:20px}
.concl li{margin-bottom:11px;font-size:13.5px;color:#33414f}
.concl b{color:var(--navy)}
.hidden{display:none}
footer{margin-top:34px;font-size:12px;color:#93a1b0;text-align:center}
@media(max-width:900px){.stats{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}.legend{display:none}}
</style></head><body>
<header><div class="wrap">
<h1>智慧物业管理系统 · 功能盘点与重构地图</h1>
<div class="sub">数据来源：HC 智慧物业 PC 后台真实菜单抓取（13 个一级菜单 / 161 个二级功能点） · 抓取时间 2026-10-21 · 按新系统「资产 / 费用 / 办公 / 物联」四大类重组</div>
<div class="stats">
  <div class="stat"><b>161</b><span>原系统功能点</span></div>
  <div class="stat"><b>__MG__</b><span>建议合并（__MGP__%）</span></div>
  <div class="stat"><b>__KE__</b><span>建议保留</span></div>
  <div class="stat"><b>__UP__</b><span>建议升级</span></div>
  <div class="stat"><b>__RB__</b><span>建议重建</span></div>
  <div class="stat"><b>__DP__</b><span>建议放弃</span></div>
</div>
</div></header>

<div class="bar"><div class="wrap">
  <span class="chip on" data-dom="all">全部 161</span>''')

for d in DOM_ORDER:
    parts.append('<span class="chip" data-dom="%s">%s %d</span>' % (d, d, CDOM[d]))
parts.append('<span class="sep"></span>')
for a in ['保留', '升级', '合并', '重建', '放弃']:
    parts.append('<span class="chip" data-act="%s">%s %d</span>' % (a, a, CACT[a]))
parts.append('''  <span class="legend">
    <i><span class="dot" style="background:var(--k)"></span>保留</i>
    <i><span class="dot" style="background:var(--u)"></span>升级</i>
    <i><span class="dot" style="background:var(--m)"></span>合并</i>
    <i><span class="dot" style="background:var(--r)"></span>重建</i>
    <i><span class="dot" style="background:var(--d)"></span>放弃</i>
  </span>
</div></div>
<div class="wrap">''')

for dom in DOM_ORDER:
    code, title, color, bg = DOM_META[dom]
    sub = [x for x in rows if x['domain'] == dom]
    n = len(sub)
    a = Counter([x['act'] for x in sub])
    parts.append('<section class="domain" data-dom="%s">' % dom)
    parts.append('<div class="dhead"><h2 style="color:%s">%s</h2><span class="desc">%s</span><span class="cnt">%d 项 · 合并%d 保留%d 升级%d 重建%d 放弃%d</span></div>' % (
        color, dom, title, n, a['合并'], a['保留'], a['升级'], a['重建'], a['放弃']))
    parts.append('<div class="grid">')
    for (dm, l1), items in [(k, v) for k, v in groups.items() if k[0] == dom]:
        parts.append('<div class="card"><h3>%s<em>%d 项</em></h3>' % (html.escape(l1), len(items)))
        for x in items:
            parts.append(
                '<div class="fn" data-act="%s" data-dom="%s"><div class="top"><span class="nm">%s</span>%s</div>'
                '<div class="meta">原归属 %s · %s · %s</div>'
                '<div class="note">%s</div></div>' % (
                    x['act'], dom, html.escape(x['name']), tag(x['act']),
                    html.escape(x['module']), x['target'], x['prio'], html.escape(x['note'])))
        parts.append('</div>')
    parts.append('</div></section>')

parts.append('''<div class="concl">
<h2>研判结论</h2>
<ol>
<li><b>菜单碎片化严重，一半功能应当合并。</b>典型：费用域 4 个出账入口（房屋/车位/商铺/合同）、报表域 11 张独立报表、OA 域 5 个待办入口，本质是同一件事的多次实现。直接照搬会把技术债带进新系统。</li>
<li><b>资产域建模是最大风险。</b>现有系统以「房屋」为中心挂业主，无法支撑一人多房、租户、商户、车位产权等真实场景。A1 空间资源与 A2 人员档案必须重建数据模型，否则费用、工单、门禁的数据都会跟着扭曲。</li>
<li><b>物联域最薄弱。</b>原系统仅 11 个功能点，且分散在设备/停车/小区三处，没有设备影子、没有协议适配层、没有统一告警。新系统要做的是「接入平台」，不是「设备列表」。</li>
<li><b>OA 流程引擎必须换。</b>现有自研流程（流程实例/我的流程/工作办理/工作单）不支持会签、条件分支、加签、撤回，也无法被采购、合同、装修复用，建议直接采用成熟 BPMN 引擎 + 表单设计器。</li>
<li><b>办公域占比最高（62 项 / 38%）。</b>说明原系统重心在「人怎么干活」而非「资产怎么增值」。重构时要区分物业内部管理（考勤、采购、巡检）与业主服务（报修、投诉、访客），后者应大幅前移到移动端。</li>
</ol>
</div>
<footer>说明：本页为静态功能地图，点击任意功能点可展开重构要点；完整字段（现状页面路径、优先级、目标端）见配套 Excel《智慧物业PC后台_功能盘点与研判表.xlsx》。</footer>
</div>
<script>
let dom='all', act='all';
document.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>{
  if(c.dataset.dom){ if(c.dataset.dom==='all'){dom='all';} else {dom=c.dataset.dom;} act='all';}
  if(c.dataset.act){ act=c.dataset.act; dom='all'; }
  document.querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));
  c.classList.add('on');
  apply();
}));
function apply(){
  document.querySelectorAll('.domain').forEach(sec=>{
    const sd=sec.dataset.dom;
    sec.classList.toggle('hidden', dom!=='all' && sd!==dom);
    sec.querySelectorAll('.fn').forEach(f=>{
      f.classList.toggle('hidden', act!=='all' && f.dataset.act!==act);
    });
    sec.querySelectorAll('.card').forEach(card=>{
      const vis=[...card.querySelectorAll('.fn')].filter(f=>!f.classList.contains('hidden')).length;
      card.classList.toggle('hidden', vis===0);
    });
  });
}
document.querySelectorAll('.fn').forEach(f=>f.addEventListener('click',()=>f.classList.toggle('open')));
</script>
</body></html>''')

out = ''.join(parts)
out = (out.replace('__MG__', str(CACT['合并']))
          .replace('__MGP__', '%.0f' % (CACT['合并'] / TOTAL * 100))
          .replace('__KE__', str(CACT['保留']))
          .replace('__UP__', str(CACT['升级']))
          .replace('__RB__', str(CACT['重建']))
          .replace('__DP__', str(CACT['放弃'])))
open(D + '/功能架构地图.html', 'w').write(out)
print('saved html', len(out))
