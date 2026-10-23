# -*- coding: utf-8 -*-
import json, html
from collections import Counter, OrderedDict

D = '/Users/aev/WorkBuddy/WYDoc/01-功能盘点'
from topics import TOPICS

rows = json.load(open(D + '/data/final.json'))

DOM_ORDER = ['A 资产', 'B 费用', 'C 办公', 'D 物联', 'E 平台底座']
L1_ORDER = [
    'A1 空间资源', 'A2 人员档案', 'A3 车辆与车位', 'A4 生命周期', 'A5 经营合同', 'A6 通行与出入',
    'A7 资产驾驶舱',
    'B1 费用总览与驾驶舱', 'B2 费用收取与收银台', 'B3 抄表与公摊', 'B4 欠费催缴', 'B5 缴费与预存',
    'B6 退费与押金', 'B7 折扣与优惠', 'B8 发票与票据', 'B9 配置与导入',
    'C0 统一工作台', 'C1 审批流', 'C2 考勤', 'C3 工单与服务', 'C4 现场作业', 'C5 采购与库存',
    'C6 行政与社区', 'C7 巡检计划与执行', 'C8 品质管理与监督', 'C9 人力资源',
    'D1 设备与台账', 'D2 门禁', 'D3 车场设备', 'D4 视频监控', 'D7 边缘设备', 'D8 物联驾驶舱',
    'E1 组织与权限', 'E2 系统配置', 'E3 报表与驾驶舱', 'E4 端与渠道配置',
]
rows.sort(key=lambda r: (DOM_ORDER.index(r['domain']),
                         L1_ORDER.index(r['l1']) if r['l1'] in L1_ORDER else 99))

for i, r in enumerate(rows):
    r['id'] = '%s|%s|%s' % (r['domain'], r['l1'], r['name'])

TOTAL = len(rows)
CACT = Counter([r['act'] for r in rows])
CDOM = Counter([r['domain'] for r in rows])
CSRC = Counter([r['src'] for r in rows])

DOM_META = {
    'A 资产': ('人 · 车 · 房', '#2f6fd0', '#eaf1fd'),
    'B 费用': ('收费与资金', '#d97706', '#fdf3e7'),
    'C 办公': ('OA 与现场作业', '#2e8540', '#eaf6ec'),
    'D 物联': ('IoT 硬件联动', '#7b3fb5', '#f4ecfb'),
    'E 平台底座': ('跨域共享', '#5b6b7c', '#eef1f4'),
}
ACT_CLS = {'保留': 'k', '升级': 'u', '合并': 'm', '新建': 'n', '重建': 'r'}
SRC_CLS = {'旧系统已有': 's0', '旧系统升级': 's1', '原型新增': 's2', '本次新增': 's3'}

groups = OrderedDict()
for r in rows:
    groups.setdefault((r['domain'], r['l1']), []).append(r)

e = html.escape
P = []
A = P.append

A('''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>智慧物业重构 · 功能地图与研判台（可协作）</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--navy:#1f3864;--ink:#1c2530;--sub:#5b6b7c;--line:#e3e8ee;--bg:#f6f8fa;--card:#fff;
--k:#2e8540;--kb:#e6f4ea;--u:#a06a00;--ub:#fff4d6;--m:#2f6fd0;--mb:#e8f0fd;--n:#0f766e;--nb:#d9f2ee;--r:#c2410c;--rb:#fdeee5;}
body{background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1500px;margin:0 auto;padding:0 28px 90px}
header{background:linear-gradient(135deg,#1f3864,#2b4f8f 60%,#33639f);color:#fff;padding:34px 0 26px}
header .wrap{padding-bottom:0}
h1{font-size:25px;font-weight:700}
.sub{margin-top:7px;font-size:13px;color:#c9d8f0}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:13px;margin-top:22px}
.stat{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:13px 15px}
.stat b{display:block;font-size:23px;font-weight:700}
.stat span{font-size:12px;color:#c9d8f0}
.collab{margin-top:14px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:10px 15px;font-size:12.5px;color:#dbe7f7;line-height:1.75}
.collab b{color:#fff}
.who{height:28px;border:1px solid #d5dde6;border-radius:6px;padding:0 9px;font-size:12.5px;width:98px;background:#fff;color:#1c2530;outline:none}
.who:focus{border-color:#2f6fd0}
nav{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:40;box-shadow:0 2px 10px rgba(20,40,80,.05)}
nav .wrap{display:flex;align-items:center;gap:6px;padding:0 28px;height:52px}
.nv{padding:7px 16px;border-radius:8px;font-size:14px;cursor:pointer;color:var(--sub);user-select:none}
.nv:hover{background:#f2f5f8}
.nv.on{background:var(--navy);color:#fff;font-weight:600}
.tools{margin-left:auto;display:flex;gap:8px;align-items:center}
.btn{border:1px solid var(--line);background:#fff;border-radius:8px;padding:6px 12px;font-size:12.5px;cursor:pointer;color:var(--sub)}
.btn:hover{border-color:#b9c6d6;color:var(--ink)}
.btn.p{background:var(--navy);border-color:var(--navy);color:#fff}
.saved{font-size:12px;color:#2e8540;margin-right:4px}
.bar{position:sticky;top:52px;z-index:30;background:#fbfcfd;border-bottom:1px solid var(--line);padding:10px 0}
.bar .wrap{display:flex;gap:7px;flex-wrap:wrap;align-items:center;padding:0 28px}
.chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;color:var(--sub);user-select:none}
.chip.on{background:var(--navy);border-color:var(--navy);color:#fff;font-weight:600}
.sbox{margin-left:auto;border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:13px;width:230px;background:#fff}
.sep{width:1px;height:20px;background:var(--line);margin:0 6px}
.domain{margin-bottom:32px}
.dhead{display:flex;align-items:baseline;gap:13px;padding:16px 0 11px;border-bottom:2px solid var(--line);margin-bottom:16px}
.dhead h2{font-size:19px;font-weight:700}
.dhead .desc{font-size:13px;color:var(--sub)}
.dhead .cnt{margin-left:auto;font-size:12px;color:var(--sub);background:#fff;border:1px solid var(--line);border-radius:999px;padding:3px 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:15px;align-items:start}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(20,40,80,.04)}
.card h3{font-size:14px;font-weight:700;padding:11px 15px;background:#fbfcfd;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
.card h3 em{font-style:normal;font-size:11px;font-weight:500;color:var(--sub);margin-left:auto}
.fn{border-bottom:1px solid #f1f4f7}
.fn:last-of-type{border-bottom:0}
.fnt{padding:10px 15px;cursor:pointer;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.fnt:hover{background:#fafcfe}
.fnt .nm{font-size:13.5px;font-weight:600}
.tg{font-size:11px;padding:1px 7px;border-radius:5px;font-weight:600;flex:none}
.tk{background:var(--kb);color:var(--k)}.tu{background:var(--ub);color:var(--u)}.tm{background:var(--mb);color:var(--m)}
.tn2{background:var(--nb);color:var(--n)}.tr{background:var(--rb);color:var(--r)}
.src{font-size:10.5px;padding:1px 6px;border-radius:4px;background:#f2f4f7;color:#7b8794}
.s3{background:#fee2e2;color:#b91c1c}.s2{background:#e0e7ff;color:#4338ca}
.stt{font-size:10.5px;padding:1px 6px;border-radius:4px;background:#f2f4f7;color:#7b8794}
.stt.st-ok{background:#dcfce7;color:#15803d}.stt.st-no{background:#fee2e2;color:#b91c1c}
.stt.st-do{background:#dbeafe;color:#1d4ed8}.stt.st-fix{background:#fef3c7;color:#b45309}
.fnb{display:none;padding:0 15px 13px;background:#fbfcfd;border-top:1px dashed var(--line)}
.fn.open .fnb{display:block}
.fnb .nt{font-size:12.5px;color:var(--sub);padding:10px 0;line-height:1.7}
.fnb .meta{font-size:11.5px;color:#93a1b0;padding-bottom:8px}
.ed{display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center;margin-top:6px}
.ed label{font-size:12px;color:var(--sub)}
.ed select,.ed input{font:inherit;font-size:12.5px;padding:5px 8px;border:1px solid var(--line);border-radius:7px;background:#fff;color:var(--ink)}
.ed textarea{font:inherit;font-size:12.5px;padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:#fff;resize:vertical;min-height:52px;color:var(--ink);grid-column:2}
.add{padding:8px 15px;font-size:12px;color:#93a1b0;cursor:pointer;text-align:center;border-top:1px solid #f1f4f7}
.add:hover{background:#f6f9fc;color:var(--navy)}
.tabs{display:flex;gap:8px;margin:22px 0 14px;flex-wrap:wrap}
.tab{border:1px solid var(--line);background:#fff;border-radius:10px;padding:11px 18px;cursor:pointer;font-size:14px}
.tab.on{background:var(--navy);color:#fff;border-color:var(--navy);font-weight:600}
.tab small{display:block;font-size:11.5px;color:var(--sub);font-weight:400;margin-top:3px}
.tab.on small{color:#c9d8f0}
.tp{background:#fff;border:1px solid var(--line);border-radius:12px;padding:26px 30px}
.tp-lead{background:#fff8e6;border-left:3px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;font-size:13.5px;color:#78350f;margin-bottom:20px}
.tp h4{font-size:15px;color:var(--navy);margin:22px 0 10px;padding-bottom:6px;border-bottom:1px solid #eef1f4}
.tp h4:first-of-type{margin-top:0}
.tp p{font-size:13.5px;color:#33414f;margin-bottom:8px}
.tbl{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}
.tbl th{background:#f6f8fa;text-align:left;padding:8px 11px;border:1px solid var(--line);font-weight:600;color:var(--navy);white-space:nowrap}
.tbl td{padding:8px 11px;border:1px solid var(--line);vertical-align:top;color:#33414f}
.flow{display:flex;align-items:stretch;gap:6px;flex-wrap:wrap;margin:12px 0}
.fs{background:#f6f8fa;border:1px solid var(--line);border-radius:10px;padding:11px 14px;min-width:150px;flex:1}
.fs b{display:inline-block;width:19px;height:19px;line-height:19px;text-align:center;background:var(--navy);color:#fff;border-radius:50%;font-size:11px;margin-right:6px}
.fs span{font-weight:600;font-size:13.5px}
.fs i{display:block;font-style:normal;font-size:11.5px;color:var(--sub);margin-top:5px;line-height:1.5}
.fa{display:flex;align-items:center;color:#b9c6d6;font-size:17px}
.sm{display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin:10px 0}
.st{background:var(--mb);color:var(--m);border-radius:6px;padding:4px 11px;font-size:12.5px;font-weight:600}
.stx{background:var(--rb);color:var(--r);border-radius:6px;padding:4px 11px;font-size:12.5px;margin-left:8px}
.tree{background:#fbfcfd;border:1px solid var(--line);border-radius:10px;padding:13px 16px;font-size:13px;margin:8px 0}
.tn{margin:3px 0 3px 12px}.tl{color:var(--sub);font-size:12.5px;margin:3px 0 3px 26px;line-height:1.8}
.note{background:#eff6ff;border-left:3px solid #3b82f6;padding:11px 15px;border-radius:0 8px 8px 0;font-size:13px;color:#1e40af;margin:10px 0;line-height:1.7}
.lay{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}
.lc{background:#fbfcfd;border:1px solid var(--line);border-radius:10px;padding:13px 15px}
.lc b{display:block;font-size:13px;color:var(--navy);margin-bottom:8px}
.li{font-size:12.5px;color:#4b5563;padding:4px 0;border-top:1px dashed #eef1f4;line-height:1.6}
.kv{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}
.kv span{background:#f6f8fa;border:1px solid var(--line);border-radius:6px;padding:4px 10px;font-size:12.5px;color:#4b5563}
.api{margin:8px 0}
.api div{font-size:12.5px;padding:5px 0;border-bottom:1px dashed #eef1f4;color:#4b5563}
.api code{background:#f1f5f9;padding:2px 7px;border-radius:5px;font-size:12px;color:#0f172a;margin-right:8px;font-family:ui-monospace,Menlo,monospace}
.arch{display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center;margin:12px 0}
.abox{background:#f6f8fa;border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center;font-size:13px;color:#4b5563}
.abox b{display:block;color:var(--navy);margin-bottom:5px}
.amid{background:#fff8e6;border:1px solid #fcd34d;border-radius:10px;padding:12px;text-align:center;font-size:12.5px;color:#78350f}
.stg{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;margin-top:14px}
.stc{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.stc h5{font-size:13.5px;color:var(--navy);margin-bottom:10px}
.brow{display:flex;align-items:center;gap:10px;margin:6px 0;font-size:12.5px}
.brow span:first-child{width:90px;color:var(--sub);flex:none}
.bbar{flex:1;height:16px;background:#f1f5f9;border-radius:4px;overflow:hidden}
.bbar i{display:block;height:100%;background:var(--navy);border-radius:4px}
.bnum{width:34px;text-align:right;color:var(--ink);font-weight:600}
.hidden{display:none}
footer{margin-top:36px;font-size:12px;color:#93a1b0;text-align:center;line-height:1.9}
@media(max-width:1000px){.stats{grid-template-columns:repeat(3,1fr)}.grid,.lay,.arch{grid-template-columns:1fr}.sbox{width:150px}}
</style></head><body>
<header><div class="wrap">
<h1>智慧物业重构 · 功能地图与研判台</h1>
<div class="sub">HC 智慧物业 PC 后台 161 个现状功能点 + 费用原型 52 页 + 七大专题（看板 / 业主360 / 人力资源 / 报修 / 收银台 / 停车场 / 巡检品质）= <b>__TOTAL__</b> 项　·　支持团队在线标注状态、负责人与备注，数据存在本机浏览器，可导出共享</div>
<div class="collab">团队协作说明：本页标注保存在<b>各自浏览器本机</b>，多人之间不会自动互通。改完后点右上角「导出 JSON」发给同事，对方点「导入」即可看到你的标注；先填右侧「你的名字」，导出时会带上署名。需要多人实时同屏协作，可导出 CSV 后放进腾讯文档 / 飞书表格。</div>
<div class="stats">
  <div class="stat"><b>__TOTAL__</b><span>功能点总数</span></div>
  <div class="stat"><b>__NEW__</b><span>本次新增/新建</span></div>
  <div class="stat"><b>__MERGE__</b><span>建议合并</span></div>
  <div class="stat"><b>__UP__</b><span>建议升级/重建</span></div>
  <div class="stat"><b>__KEEP__</b><span>建议保留</span></div>
  <div class="stat"><b>__P0__</b><span>P0 首期必做</span></div>
</div>
</div></header>
<nav><div class="wrap">
  <span class="nv on" data-v="map">功能地图</span>
  <span class="nv" data-v="topic">升级专题</span>
  <span class="nv" data-v="stat">研判统计</span>
  <a class="nv" href="design.html" target="_blank" style="text-decoration:none">页面设计稿 ↗</a>
  <a class="nv" href="design-system.html" target="_blank" style="text-decoration:none">设计系统 ↗</a>
  <a class="nv" href="dataset.html" target="_blank" style="text-decoration:none">演示数据集 ↗</a>
  <div class="tools">
    <input id="who" class="who" placeholder="你的名字">
    <span class="saved" id="savedTip"></span>
    <button class="btn" id="btnCsv">导出 CSV</button>
    <button class="btn" id="btnJson">导出 JSON</button>
    <button class="btn" id="btnMd">导出 Markdown</button>
    <button class="btn" id="btnImp">导入</button>
    <button class="btn" id="btnReset">重置标注</button>
    <input type="file" id="fileImp" accept=".json" style="display:none">
  </div>
</div></nav>
<div id="viewMap">
<div class="bar"><div class="wrap">
  <span class="chip on" data-f="dom" data-v="all">全部</span>''')

for d in DOM_ORDER:
    A('<span class="chip" data-f="dom" data-v="%s">%s %d</span>' % (d, d, CDOM[d]))
A('<span class="sep"></span>')
for a in ['保留', '升级', '合并', '新建', '重建']:
    A('<span class="chip" data-f="act" data-v="%s">%s %d</span>' % (a, a, CACT[a]))
A('<span class="sep"></span>')
for a in ['待评审', '已确认', '需修改', '开发中', '已放弃']:
    A('<span class="chip" data-f="st" data-v="%s">%s</span>' % (a, a))
A('''  <input class="sbox" id="q" placeholder="搜索功能点 / 关键字…">
</div></div>
<div class="wrap">''')

for dom in DOM_ORDER:
    title, color, bg = DOM_META[dom]
    sub = [r for r in rows if r['domain'] == dom]
    c = Counter([x['act'] for x in sub])
    A('<section class="domain" data-dom="%s">' % dom)
    A('<div class="dhead"><h2 style="color:%s">%s</h2><span class="desc">%s</span><span class="cnt">%d 项 · 新建%d 升级%d 合并%d 保留%d 重建%d</span></div>' % (
        color, dom, title, len(sub), c['新建'], c['升级'], c['合并'], c['保留'], c['重建']))
    A('<div class="grid">')
    for (dm, l1), items in [(k, v) for k, v in groups.items() if k[0] == dom]:
        A('<div class="card" data-l1="%s"><h3>%s<em>%d 项</em></h3>' % (e(l1), e(l1), len(items)))
        for x in items:
            tpc = x.get('topic', '')
            A('<div class="fn" data-id="%s" data-dom="%s" data-act="%s" data-prio="%s" data-topic="%s">'
              '<div class="fnt"><span class="nm">%s%s</span>'
              '<span class="tg t%s">%s</span><span class="src %s">%s</span>'
              '<span class="stt" data-role="stTag"></span></div>'
              '<div class="fnb"><div class="nt">%s</div>'
              '<div class="meta">目标端 %s · 优先级 %s · 原归属 %s%s</div>'
              '<div class="ed"><label>团队状态</label><select data-role="st">'
              '<option value="">待评审</option><option>已确认</option><option>需修改</option>'
              '<option>开发中</option><option>已放弃</option></select></div>'
              '<div class="ed"><label>负责人</label><input data-role="ow" placeholder="如：产品-张三 / 研发-李四"></div>'
              '<div class="ed"><label>备注</label><textarea data-role="nt" placeholder="评审意见、升级方案、依赖项…"></textarea></div>'
              '</div></div>' % (
                  e(x['id']), dom, x['act'], x['prio'], tpc,
                  e(x['name']),
                  ' <span class="src s3">专题</span>' if tpc else '',
                  ACT_CLS[x['act']], x['act'], SRC_CLS[x['src']], x['src'],
                  e(x['note']), x['target'], x['prio'], e(x.get('module') or '—'),
                  (' · ' + e(x['href'])) if x.get('href') else ''))
        A('<div class="add" data-add="%s">+ 新增自定义功能点</div>' % e(l1))
        A('</div>')
    A('</div></section>')
A('</div></div>')

# ---------- 专题视图 ----------
A('<div id="viewTopic" class="hidden"><div class="wrap"><div class="tabs" id="topicTabs">')
for i, (key, title, l1, desc, _) in enumerate(TOPICS):
    A('<div class="tab%s" data-t="%s"><b>%s</b><small>%s · %s</small></div>' % (' on' if i == 0 else '', key, title, l1, desc))
A('</div><div id="topicBody">')
for i, (key, title, l1, desc, body) in enumerate(TOPICS):
    A('<div class="topicPanel%s" data-p="%s">%s</div>' % ('' if i == 0 else ' hidden', key, body))
A('</div></div></div>')

# ---------- 统计视图 ----------
A('<div id="viewStat" class="hidden"><div class="wrap"><div class="stg" id="statBox"></div></div></div>')

A('''<footer>
本页所有标注保存在你本机浏览器（localStorage），刷新不丢失；点「导出 JSON」可把标注交给同事导入，实现离线协作。<br>
数据来源：HC 智慧物业 PC 后台真实菜单抓取（161 项）＋ 费用原型 propertyYX（52 页）＋ 需求沟通方案 V2.0　·　2026-10-21<br>
升级专题：① 三张看板与工作台　② 业主 360 档案　③ 人力资源　④ 报事报修闭环　⑤ PC 收银台　⑥ 停车场对接　⑦ 巡检计划与品质管理
</footer>
<script>
const DATA = __DATA__;
const KEY='wy_map_v2_state';
let st={};
try{st=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){st={}}
let filt={dom:'all',act:'all',st:'all',q:''};
let view='map';
let who='';
try{who=localStorage.getItem(KEY+'_who')||''}catch(e){who=''}
{const w=document.getElementById('who'); w.value=who;
 w.addEventListener('input',()=>{who=w.value;try{localStorage.setItem(KEY+'_who',who)}catch(e){}});}

function save(){localStorage.setItem(KEY,JSON.stringify(st));
  const t=document.getElementById('savedTip'); t.textContent='已保存 '+Object.keys(st).length+' 项标注';
  setTimeout(()=>{t.textContent=''},1800); renderStat();}

function statOf(id){return st[id]&&st[id].st||''}
function applyEdits(){
  document.querySelectorAll('.fn').forEach(f=>{
    const id=f.dataset.id, s=st[id]||{};
    const sel=f.querySelector('[data-role=st]'), ow=f.querySelector('[data-role=ow]'), nt=f.querySelector('[data-role=nt]');
    sel.value=s.st||''; ow.value=s.ow||''; nt.value=s.nt||'';
    const tag=f.querySelector('[data-role=stTag]'); const v=s.st||'';
    if(!v){tag.textContent='';tag.className='stt';}
    else{tag.textContent=v;tag.className='stt st-'+(v==='已确认'?'ok':v==='已放弃'?'no':v==='开发中'?'do':'fix');}
  });
}
function bindEdits(){
  document.querySelectorAll('.fn').forEach(f=>{
    const id=f.dataset.id;
    f.querySelector('.fnt').addEventListener('click',e=>{
      if(e.target.closest('span.tg'))return; f.classList.toggle('open');});
    ['st','ow','nt'].forEach(k=>{
      const el=f.querySelector('[data-role='+k+']');
      el.addEventListener('input',()=>{
        st[id]=Object.assign(st[id]||{},{[k]:el.value,by:who});
        if(k==='st'){const tag=f.querySelector('[data-role=stTag]');const v=el.value;
          if(!v){tag.textContent='';tag.className='stt';}
          else{tag.textContent=v;tag.className='stt st-'+(v==='已确认'?'ok':v==='已放弃'?'no':v==='开发中'?'do':'fix');}}
        save();});
      el.addEventListener('click',ev=>ev.stopPropagation());
    });
  });
  document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',()=>{
    const l1=b.dataset.add;
    const name=prompt('在【'+l1+'】下新增功能点名称：');
    if(!name)return;
    const id='CUSTOM|'+l1+'|'+name;
    st[id]=Object.assign(st[id]||{},{custom:1,l1:l1}); save();
    const d=document.createElement('div');
    d.className='fn'; d.dataset.id=id; d.dataset.dom=l1[0]==='A'?'A 资产':l1[0]==='B'?'B 费用':l1[0]==='C'?'C 办公':l1[0]==='D'?'D 物联':'E 平台底座';
    d.dataset.act='新建'; d.dataset.prio='P1';
    d.innerHTML='<div class="fnt"><span class="nm">'+name+'</span><span class="tg tn2">新建</span><span class="src s3">自定义</span><span class="stt" data-role="stTag"></span></div>'
      +'<div class="fnb"><div class="nt">（自定义项，请补充设计说明）</div>'
      +'<div class="ed"><label>团队状态</label><select data-role="st"><option value="">待评审</option><option>已确认</option><option>需修改</option><option>开发中</option><option>已放弃</option></select></div>'
      +'<div class="ed"><label>负责人</label><input data-role="ow"></div>'
      +'<div class="ed"><label>备注</label><textarea data-role="nt"></textarea></div></div>';
    b.parentNode.insertBefore(d,b); bindEdits(); applyEdits();
  }));
}

function doFilter(){
  const q=filt.q.toLowerCase();
  document.querySelectorAll('.fn').forEach(f=>{
    const okD=filt.dom==='all'||f.dataset.dom===filt.dom;
    const okA=filt.act==='all'||f.dataset.act===filt.act;
    const okS=filt.st==='all'||statOf(f.dataset.id)===filt.st;
    const okQ=!q||f.innerText.toLowerCase().includes(q);
    f.classList.toggle('hidden',!(okD&&okA&&okS&&okQ));
  });
  document.querySelectorAll('.domain').forEach(s=>{
    s.classList.toggle('hidden',filt.dom!=='all'&&s.dataset.dom!==filt.dom);
    s.querySelectorAll('.card').forEach(c=>{
      const n=[...c.querySelectorAll('.fn')].filter(x=>!x.classList.contains('hidden')).length;
      c.classList.toggle('hidden',n===0);});
  });
}
document.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>{
  const f=c.dataset.f;
  document.querySelectorAll('.chip[data-f='+f+']').forEach(x=>x.classList.remove('on'));
  c.classList.add('on'); filt[f]=c.dataset.v; doFilter();}));
document.getElementById('q').addEventListener('input',e=>{filt.q=e.target.value;doFilter();});
document.querySelectorAll('.nv').forEach(n=>n.addEventListener('click',()=>{
  document.querySelectorAll('.nv').forEach(x=>x.classList.remove('on')); n.classList.add('on');
  view=n.dataset.v;
  document.getElementById('viewMap').classList.toggle('hidden',view!=='map');
  document.getElementById('viewTopic').classList.toggle('hidden',view!=='topic');
  document.getElementById('viewStat').classList.toggle('hidden',view!=='stat');
  if(view==='stat')renderStat();}));
document.querySelectorAll('#topicTabs .tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('#topicTabs .tab').forEach(x=>x.classList.remove('on')); t.classList.add('on');
  document.querySelectorAll('.topicPanel').forEach(p=>p.classList.toggle('hidden',p.dataset.p!==t.dataset.t));}));

function rows(){return DATA.map(d=>Object.assign({},d,{st:(st[d.id]||{}).st||'待评审',ow:(st[d.id]||{}).ow||'',nt:(st[d.id]||{}).nt||'',by:(st[d.id]||{}).by||''}));}
function dl(name,txt,mime){const b=new Blob([txt],{type:mime});const a=document.createElement('a');
  a.href=URL.createObjectURL(b);a.download=name;a.click();URL.revokeObjectURL(a.href);}
document.getElementById('btnCsv').onclick=()=>{
  const h=['顶级域','一级模块','功能点','来源','处置建议','目标端','优先级','团队状态','负责人','备注','标注人'];
  const esc=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const lines=[h.join(',')].concat(rows().map(r=>[r.domain,r.l1,r.name,r.src,r.act,r.target,r.prio,r.st,r.ow,r.nt,r.by].map(esc).join(',')));
  dl('功能地图研判_'+new Date().toISOString().slice(0,10)+'.csv','\\ufeff'+lines.join('\\n'),'text/csv;charset=utf-8');};
document.getElementById('btnJson').onclick=()=>dl('功能地图研判_'+new Date().toISOString().slice(0,10)+'.json',
  JSON.stringify({exportedAt:new Date().toISOString(),author:who||'',items:rows()},null,1),'application/json');
document.getElementById('btnMd').onclick=()=>{
  let md='# 智慧物业重构 · 功能研判\\n\\n';let cur='';
  rows().forEach(r=>{if(r.domain!==cur){cur=r.domain;md+='\\n## '+cur+'\\n\\n| 一级模块 | 功能点 | 来源 | 处置 | 端 | 优先级 | 状态 | 负责人 | 备注 |\\n|---|---|---|---|---|---|---|---|---|\\n';}
    md+='| '+r.l1+' | '+r.name+' | '+r.src+' | '+r.act+' | '+r.target+' | '+r.prio+' | '+r.st+' | '+(r.ow||'')+' | '+(r.nt||'')+' |\\n';});
  dl('功能地图研判.md',md,'text/markdown');};
document.getElementById('btnImp').onclick=()=>document.getElementById('fileImp').click();
document.getElementById('fileImp').onchange=e=>{
  const f=e.target.files[0]; if(!f)return; const r=new FileReader();
  r.onload=()=>{try{const j=JSON.parse(r.result);
    (j.items||[]).forEach(it=>{if(it.st||it.ow||it.nt)st[it.id]={st:it.st,ow:it.ow,nt:it.nt,by:it.by||j.author||''};});
    save();applyEdits();alert('导入成功');}catch(x){alert('文件格式有误')}};
  r.readAsText(f);};
document.getElementById('btnReset').onclick=()=>{if(confirm('清空所有团队标注？')){st={};save();applyEdits();doFilter();}};

function renderStat(){
  const rs=rows(); const box=document.getElementById('statBox');
  const mk=(title,map)=>{let mx=Math.max(...Object.values(map),1);let h='<div class="stc"><h5>'+title+'</h5>';
    Object.entries(map).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>{
      h+='<div class="brow"><span>'+k+'</span><div class="bbar"><i style="width:'+(v/mx*100)+'%"></i></div><span class="bnum">'+v+'</span></div>';});
    return h+'</div>';};
  const cnt=k=>rs.reduce((o,r)=>{o[r[k]]=(o[r[k]]||0)+1;return o},{});
  box.innerHTML=mk('按顶级域',cnt('domain'))+mk('按处置建议',cnt('act'))
    +mk('按团队状态',cnt('st'))+mk('按优先级',cnt('prio'))+mk('按来源',cnt('src'));
}
applyEdits();bindEdits();renderStat();
</script></body></html>''')

out = ''.join(P)
data_json = json.dumps([{k: r[k] for k in ('id', 'domain', 'l1', 'name', 'src', 'act', 'target', 'prio', 'note', 'module', 'href')} for r in rows], ensure_ascii=False)
out = out.replace('__DATA__', data_json)
out = (out.replace('__TOTAL__', str(TOTAL))
          .replace('__NEW__', str(CACT['新建']))
          .replace('__MERGE__', str(CACT['合并']))
          .replace('__UP__', str(CACT['升级'] + CACT['重建']))
          .replace('__KEEP__', str(CACT['保留']))
          .replace('__P0__', str(sum(1 for r in rows if r['prio'] == 'P0'))))

open(D + '/功能地图与研判台.html', 'w').write(out)
print('saved', len(out), 'items', TOTAL)
