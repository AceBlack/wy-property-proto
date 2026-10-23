# -*- coding: utf-8 -*-
"""页面设计稿的样式系统与图表工具（纯 CSS/SVG，无外部依赖）"""

def esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))

# ---------------- 图标 ----------------
ICONS = {
    'work': '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
    'build': '<path d="M4 21V6.5L12 3v18"/><path d="M12 9h8v12"/><path d="M7 9h2M7 13h2M7 17h2M16 13h1.5M16 17h1.5"/>',
    'money': '<rect x="3" y="6" width="18" height="12" rx="2.4"/><path d="M3 10h18"/><circle cx="12" cy="14.5" r="1.6"/>',
    'box': '<path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2z"/><path d="M4 7.2l8 4.3 8-4.3M12 11.5V21"/>',
    'user': '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6"/>',
    'chip': '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v3M14 3v3M10 18v3M14 18v3M3 10h3M3 14h3M18 10h3M18 14h3"/>',
    'chart': '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="10" width="3" height="7"/>',
    'gear': '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    'file': '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
    'clock': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    'bell': '<path d="M6.5 17V11a5.5 5.5 0 0 1 11 0v6"/><path d="M4.5 17h15"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    'camera': '<rect x="3" y="6.5" width="13" height="11" rx="2"/><path d="M16 11l5-3v8l-5-3z"/>',
}

def ic(name, cls=''):
    return ('<svg class="ic %s" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">%s</svg>') % (cls, ICONS.get(name, ICONS['work']))

# ---------------- 样式 ----------------
CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{
 --bg:#eef2f9; --card:#fff; --line:#e6ecf6; --line2:#f1f5fb;
 --ink:#101b2f; --sub:#67788f; --mute:#9aa8bd;
 --pri:#2b5cff; --pri-s:#eaf0ff; --teal:#12b8a6; --teal-s:#e4f8f5;
 --org:#ff8b3d; --org-s:#fff2e8; --red:#ef4559; --red-s:#feecee;
 --yel:#f0ab00; --yel-s:#fff7e2; --pur:#7c5cff; --pur-s:#f0edff; --grn:#22b573;
 --sh:0 1px 3px rgba(16,27,47,.04),0 6px 18px rgba(16,27,47,.045);
}
body{background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--pri);text-decoration:none}
.doc{max-width:1380px;margin:0 auto;padding:0 22px 70px}

/* 文档头 */
.dhd{padding:34px 4px 20px}
.dhd .kicker{font-size:12px;letter-spacing:.16em;color:var(--pri);font-weight:700;text-transform:uppercase}
.dhd h1{font-size:27px;letter-spacing:-.4px;margin:8px 0 8px}
.dhd p{color:var(--sub);font-size:13.5px;max-width:930px}
.dhd .meta{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
.dhd .meta span{background:#fff;border:1px solid var(--line);border-radius:20px;padding:4px 12px;font-size:12px;color:var(--sub)}

/* 导航 */
.dnav{position:sticky;top:0;z-index:30;background:rgba(238,242,249,.92);backdrop-filter:blur(10px);padding:10px 0 12px;display:flex;gap:6px;flex-wrap:wrap;border-bottom:1px solid rgba(16,27,47,.06)}
.dnav a{font-size:13px;color:var(--sub);padding:7px 14px;border-radius:9px;border:1px solid transparent;cursor:pointer}
.dnav a:hover{background:#fff;color:var(--ink)}
.dnav a.on{background:var(--ink);color:#fff;border-color:var(--ink)}

/* 章节 */
.sec{padding-top:26px;scroll-margin-top:70px}
.sechd{display:flex;align-items:flex-start;gap:14px;margin-bottom:14px}
.sechd .no{flex:none;width:40px;height:40px;border-radius:11px;background:var(--ink);color:#fff;display:grid;place-items:center;font-size:14px;font-weight:700;letter-spacing:.02em}
.sechd h2{font-size:20px;letter-spacing:-.2px}
.sechd p{color:var(--sub);font-size:13px;margin-top:3px;max-width:960px}

/* 浏览器框 */
.frame{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh);overflow:hidden}
.fbar{height:34px;display:flex;align-items:center;gap:6px;padding:0 12px;background:#f7f9fd;border-bottom:1px solid var(--line)}
.fbar i{width:9px;height:9px;border-radius:50%;background:#dfe6f1;display:block}
.fbar .url{margin-left:10px;font-size:11.5px;color:var(--mute);background:#fff;border:1px solid var(--line);border-radius:6px;padding:2px 10px;font-family:ui-monospace,Menlo,monospace}
.scrh{overflow-x:auto}
.scr{width:1280px;background:#f2f5fa;display:flex;font-size:13px;color:var(--ink)}

/* 侧边栏 */
.side{width:152px;flex:none;background:#fff;border-right:1px solid var(--line);padding:16px 10px 12px;display:flex;flex-direction:column;gap:2px}
.side .lg{display:flex;align-items:center;gap:8px;padding:0 8px 16px;font-size:13px;font-weight:700;color:#12234a;letter-spacing:.02em}
.side .lg em{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,#2b5cff,#5b8cff);display:block;position:relative}
.side .lg em:after{content:'';position:absolute;inset:7px 6px;border:1.6px solid #fff;border-radius:2px}
.side .mi{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:8px;color:var(--sub);font-size:12.5px;white-space:nowrap}
.side .mi .ic{width:15px;height:15px;flex:none;color:#93a3b9}
.side .mi.on{background:var(--pri-s);color:var(--pri);font-weight:600}
.side .mi.on .ic{color:var(--pri)}
.side .mt{font-size:10.5px;color:#b7c3d4;padding:12px 9px 4px;letter-spacing:.08em}
.side .foot{margin-top:auto;font-size:10.5px;color:#b7c3d4;padding:10px 9px 0;border-top:1px solid var(--line2)}

/* 主区 */
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.top{height:50px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;padding:0 18px;flex:none}
.top .tb{font-size:12.5px;color:var(--sub);padding:6px 2px;position:relative;white-space:nowrap}
.top .tb.on{color:var(--ink);font-weight:600}
.top .tb.on:after{content:'';position:absolute;left:0;right:0;bottom:-13px;height:2px;background:var(--pri);border-radius:2px}
.top .who{margin-left:auto;display:flex;align-items:center;gap:12px;font-size:12px;color:var(--sub);flex:none;white-space:nowrap}
.top .who .av{width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#dfe8ff,#c9d8ff);color:#2b5cff;display:grid;place-items:center;font-size:11px;font-weight:700}
.crumb{padding:10px 18px 0;font-size:11.5px;color:#a8b5c7;flex:none}
.cont{padding:10px 18px 16px;display:flex;flex-direction:column;gap:12px}

/* 通用 */
.g12{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}
.c3{grid-column:span 3}.c4{grid-column:span 4}.c5{grid-column:span 5}.c6{grid-column:span 6}.c7{grid-column:span 7}.c8{grid-column:span 8}.c9{grid-column:span 9}.c12{grid-column:span 12}
.cd{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 14px;box-shadow:0 1px 2px rgba(16,27,47,.03);min-width:0}
.cdh{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.cdh h4{font-size:13px;font-weight:650;letter-spacing:.01em}
.cdh .rt{margin-left:auto;font-size:11px;color:var(--mute);display:flex;gap:8px;align-items:center}
.cdh .rt a{font-size:11px}
.pill{font-size:10.5px;padding:1px 7px;border-radius:20px;background:var(--pri-s);color:var(--pri);font-weight:600}
.pill.t{background:var(--teal-s);color:#0e8f81}
.pill.o{background:var(--org-s);color:#d4691c}
.pill.r{background:var(--red-s);color:#cf2c40}
.pill.y{background:var(--yel-s);color:#a97600}
.pill.g{background:#e8f8ef;color:#12874f}
.pill.n{background:#f2f5fa;color:var(--sub)}
.mut{color:var(--mute);font-size:11.5px}
.sub{color:var(--sub)}
.num{font-variant-numeric:tabular-nums}
b.n{font-weight:700;font-variant-numeric:tabular-nums}

/* KPI */
.kpis{display:grid;gap:10px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:12px;padding:11px 13px;display:flex;gap:10px;align-items:center}
.kpi .kb{width:34px;height:34px;border-radius:10px;background:var(--pri-s);color:var(--pri);display:grid;place-items:center;flex:none}
.kpi .kb .ic{width:17px;height:17px}
.kpi .kt{font-size:11.5px;color:var(--sub);white-space:nowrap}
.kpi .kv{font-size:22px;font-weight:750;letter-spacing:-.5px;line-height:1.25;font-variant-numeric:tabular-nums}
.kpi .kv small{font-size:11px;font-weight:600;color:var(--mute);margin-left:3px;letter-spacing:0}
.kpi .kd{font-size:10.5px;color:var(--teal);font-weight:600}
.kpi .kd.dn{color:var(--red)}
.kpi.t .kb{background:var(--teal-s);color:#0e9c8c}
.kpi.o .kb{background:var(--org-s);color:#e07a24}
.kpi.r .kb{background:var(--red-s);color:#dc3247}
.kpi.p .kb{background:var(--pur-s);color:#6b46e5}
.kpi.y .kb{background:var(--yel-s);color:#b47d00}

/* 表格 */
.tb{width:100%;border-collapse:collapse;font-size:12px}
.tb th{text-align:left;font-weight:600;color:var(--mute);font-size:11px;padding:0 6px 7px;border-bottom:1px solid var(--line);white-space:nowrap}
.tb td{padding:7px 6px;border-bottom:1px solid var(--line2);color:#33415c;white-space:nowrap}
.tb tr:last-child td{border-bottom:none}
.tb td.n{font-variant-numeric:tabular-nums}
.tb .em{font-weight:600;color:var(--ink)}

/* 条形 */
.br{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:12px}
.br .bl{width:62px;flex:none;color:var(--sub)}
.br .bt{flex:1;height:7px;background:#eff3f9;border-radius:5px;overflow:hidden;display:flex}
.br .bf{display:block;height:7px;border-radius:5px;background:var(--pri)}
.br .bv{width:44px;text-align:right;font-weight:650;font-variant-numeric:tabular-nums}
.br.tall .bt{height:10px}.br.tall .bf{height:10px}

/* 环形 */
.dnt{width:118px;height:118px;border-radius:50%;position:relative;flex:none}
.dnt .hole{position:absolute;inset:24%;background:#fff;border-radius:50%}
.dnt .dc{position:absolute;inset:0;display:grid;place-content:center;text-align:center;z-index:2;line-height:1.35}
.dnt .dc b{font-size:19px;font-weight:750;letter-spacing:-.4px}
.dnt .dc span{font-size:10.5px;color:var(--mute)}
.lgd{display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:var(--sub);flex:1;min-width:0}
.lgd i{width:8px;height:8px;border-radius:2px;display:inline-block;margin-right:6px}
.lgd .lv{margin-left:auto;color:var(--ink);font-weight:650;font-variant-numeric:tabular-nums}
.lgd .li{display:flex;align-items:center}

/* 堆叠条 */
.stk{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#eff3f9}
.stk i{display:block;height:100%}

/* 时间轴 */
.tl{position:relative;padding-left:16px}
.tl:before{content:'';position:absolute;left:4px;top:6px;bottom:6px;width:1px;background:var(--line)}
.tl .ti{position:relative;margin-bottom:11px;font-size:12px}
.tl .ti:before{content:'';position:absolute;left:-15px;top:5px;width:7px;height:7px;border-radius:50%;background:#fff;border:2px solid var(--pri)}
.tl .ti.d:before{border-color:var(--mute)}
.tl .ti b{font-weight:650}
.tl .ti .tm{color:var(--mute);font-size:10.5px;margin-left:6px}

/* 列表行 */
.li{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px dashed var(--line2);font-size:12px}
.li:last-child{border-bottom:none}
.li .lt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.li .lm{color:var(--mute);font-size:10.5px;white-space:nowrap}

/* 热力 */
.heat{display:grid;grid-template-columns:repeat(15,1fr);gap:3px}
.heat i{display:block;height:15px;border-radius:3px}

/* 提示条 */
.tip{display:flex;align-items:center;gap:8px;background:var(--pri-s);border:1px solid #d5e1ff;color:#26439c;border-radius:9px;padding:7px 11px;font-size:11.5px}
.tip.r{background:var(--red-s);border-color:#fbd3d8;color:#b32a3d}
.tip.y{background:var(--yel-s);border-color:#fae5b0;color:#8a6100}

/* 按钮 */
.bt{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:#fff;color:var(--sub);border-radius:8px;padding:5px 11px;font-size:12px;white-space:nowrap}
.bt.p{background:var(--pri);border-color:var(--pri);color:#fff;font-weight:600}
.bt.g{background:#f7f9fd}

/* 标签小块 */
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:11px;padding:3px 9px;border-radius:7px;background:#f4f7fc;color:var(--sub);border:1px solid transparent}
.chip.on{background:var(--pri-s);color:var(--pri);border-color:#d3dfff;font-weight:600}

/* 头像 */
.avx{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#e6edff,#cddaff);color:#2b5cff;display:grid;place-items:center;font-size:20px;font-weight:750;flex:none}
.avs{width:26px;height:26px;border-radius:50%;background:#e8eefb;color:#5b7396;display:grid;place-items:center;font-size:11px;font-weight:700;flex:none}

/* 规格说明 */
.specs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
.sp{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.sp h3{font-size:12.5px;font-weight:700;color:var(--ink);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.sp h3 s{width:3px;height:12px;background:var(--pri);border-radius:2px;display:block;text-decoration:none}
.sp ul{list-style:none;font-size:12px;color:var(--sub);line-height:1.75}
.sp ul li{padding-left:11px;position:relative}
.sp ul li:before{content:'';position:absolute;left:1px;top:9px;width:4px;height:4px;border-radius:50%;background:#c7d2e2}
.sp ul li b{color:var(--ink);font-weight:600}
.sp ul li code{background:#f3f6fb;border-radius:4px;padding:1px 5px;font-size:11px;color:#31456b;font-family:ui-monospace,Menlo,monospace}
.diff{margin-top:12px;background:#fffdf5;border:1px solid #f6e6bd;border-radius:12px;padding:13px 16px;font-size:12.5px;color:#6b5216;line-height:1.8}
.diff b{color:#4a3608}
.diff .two{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:6px}
.diff h5{font-size:12px;margin-bottom:4px;color:#8a6a10}

/* 总览 */
.ov{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:var(--sh)}
.ov h3{font-size:14px;margin-bottom:10px}
.ov p{font-size:13px;color:var(--sub);line-height:1.9}
.tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0}
.tier{border:1px solid var(--line);border-radius:12px;padding:14px;background:#fafcff}
.tier .tn{font-size:11px;font-weight:700;color:var(--pri);letter-spacing:.06em}
.tier h4{font-size:13.5px;margin:4px 0 6px}
.tier ul{list-style:none;font-size:12px;color:var(--sub);line-height:1.85}
.tier ul li:before{content:'·';margin-right:6px;color:#b9c6d8}
.rules{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin-top:12px;font-size:12.5px;color:var(--sub)}
.rules div{padding-left:14px;position:relative;line-height:1.8}
.rules div:before{content:'';position:absolute;left:0;top:8px;width:6px;height:6px;border-radius:2px;background:var(--pri)}
footer.docf{margin-top:40px;text-align:center;font-size:11.5px;color:#a9b6c8;line-height:1.9}
@media(max-width:1100px){.specs,.tiers,.diff .two,.rules{grid-template-columns:1fr}}
@media print{.dnav{display:none}.frame{break-inside:avoid}}
"""

# ---------------- 组件 ----------------
def kpi(label, val, unit='', icon='build', delta='', tone='', note=''):
    d = ('<div class="kd %s">%s</div>' % ('dn' if delta.startswith('-') else '', delta)) if delta else ''
    return ('<div class="kpi %s"><div class="kb">%s</div><div><div class="kt">%s</div>'
            '<div class="kv">%s<small>%s</small></div>%s</div></div>') % (tone, ic(icon), label, val, unit, d)


def card(title, body, right='', cls='', sub=''):
    r = ('<div class="rt">%s</div>' % right) if right else ''
    s = ('<div class="mut" style="margin:-4px 0 8px">%s</div>' % sub) if sub else ''
    return ('<div class="cd %s"><div class="cdh"><h4>%s</h4>%s</div>%s%s</div>') % (cls, title, r, s, body)


def donut(segs, center_v='', center_l='', size=118):
    total = sum(s[1] for s in segs) or 1
    acc, stops = 0, []
    for name, v, color in segs:
        start = acc / total * 360
        acc += v
        end = acc / total * 360
        stops.append((color, start, end))
    grad = ','.join('%s %.2fdeg %.2fdeg' % (c, s, e) for c, s, e in stops)
    return ('<div class="dnt" style="width:%dpx;height:%dpx;background:conic-gradient(%s)">'
            '<div class="hole"></div><div class="dc"><b>%s</b><span>%s</span></div></div>') % (size, size, grad, center_v, center_l)


def legend(segs, total=None, unit=''):
    total = total or (sum(s[1] for s in segs) or 1)
    out = []
    for name, v, color in segs:
        out.append('<div class="li"><i style="background:%s"></i><span style="flex:1">%s</span>'
                   '<span class="lv">%s%s</span></div>' % (color, name, format(v, ','), unit))
    return '<div class="lgd">%s</div>' % ''.join(out)


def bars(rows, color='var(--pri)', unit='', width=62, tall=False):
    mx = max([r[1] for r in rows] or [1])
    out = []
    for label, v, *rest in rows:
        c = rest[0] if rest else color
        out.append('<div class="br%s"><span class="bl">%s</span><span class="bt">'
                   '<i class="bf" style="width:%.0f%%;background:%s"></i></span>'
                   '<span class="bv">%s%s</span></div>' % (' tall' if tall else '', label, v / mx * 100, c, format(v, ','), unit))
    return ''.join(out)


def stacked(parts, h=10):
    total = sum(p[1] for p in parts) or 1
    seg = ''.join('<i style="width:%.2f%%;background:%s"></i>' % (p[1] / total * 100, p[2]) for p in parts)
    return '<div class="stk" style="height:%dpx">%s</div>' % (h, seg)


def table(headers, rows, aligns=None):
    aligns = aligns or ['l'] * len(headers)
    th = ''.join('<th style="text-align:%s">%s</th>' % ('right' if a == 'r' else 'left', h) for h, a in zip(headers, aligns))
    trs = []
    for r in rows:
        tds = ''.join('<td class="%s" style="text-align:%s">%s</td>' % ('n' if a == 'r' else '', 'right' if a == 'r' else 'left', c)
                      for c, a in zip(r, aligns))
        trs.append('<tr>%s</tr>' % tds)
    return '<table class="tb"><thead><tr>%s</tr></thead><tbody>%s</tbody></table>' % (th, ''.join(trs))


def line_chart(series, w=560, h=132, labels=None, colors=None, grid=4, area=True, unit=''):
    colors = colors or ['#2b5cff', '#12b8a6', '#ff8b3d']
    pad_l, pad_b, pad_t = 30, 18, 10
    iw, ih = w - pad_l - 6, h - pad_t - pad_b
    mx = max([max(s) for s in series] or [1]) * 1.15 or 1
    n = max(len(s) for s in series)
    def pts(s):
        return [(pad_l + iw * (i / (n - 1 if n > 1 else 1)), pad_t + ih - ih * (v / mx)) for i, v in enumerate(s)]
    out = ['<svg viewBox="0 0 %d %d" style="width:100%%;height:%dpx" preserveAspectRatio="none">' % (w, h, h)]
    for g in range(grid + 1):
        y = pad_t + ih - ih * g / grid
        out.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#eef2f8" stroke-width="1"/>' % (pad_l, y, w - 6, y))
        out.append('<text x="%d" y="%.1f" font-size="9" fill="#a9b6c8" text-anchor="end">%s</text>' % (pad_l - 6, y + 3, int(mx * g / grid)))
    for i, s in enumerate(series):
        p = pts(s)
        d = ' '.join('%.1f,%.1f' % xy for xy in p)
        if area:
            out.append('<polygon points="%d,%d %s %d,%d" fill="%s" opacity=".10"/>' % (pad_l, pad_t + ih, d, w - 6, pad_t + ih, colors[i]))
        out.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' % (d, colors[i]))
        if len(p) <= 12:
            for x, y in p:
                out.append('<circle cx="%.1f" cy="%.1f" r="2.4" fill="#fff" stroke="%s" stroke-width="2"/>' % (x, y, colors[i]))
    if labels:
        step = max(1, n // 7)
        for i, lb in enumerate(labels):
            if i % step: continue
            x = pad_l + iw * (i / (n - 1 if n > 1 else 1))
            out.append('<text x="%.1f" y="%d" font-size="9" fill="#a9b6c8" text-anchor="middle">%s</text>' % (x, h - 4, lb))
    out.append('</svg>')
    return ''.join(out)


def spark(vals, w=70, h=22, color='#2b5cff'):
    mx, mn = max(vals), min(vals)
    rng = (mx - mn) or 1
    p = ' '.join('%.1f,%.1f' % (w * i / (len(vals) - 1), h - 2 - (v - mn) / rng * (h - 4)) for i, v in enumerate(vals))
    return '<svg viewBox="0 0 %d %d" style="width:%dpx;height:%dpx"><polyline points="%s" fill="none" stroke="%s" stroke-width="1.8" stroke-linecap="round"/></svg>' % (w, h, w, h, p, color)


def heat(cells, cols=15):
    out = []
    for v, c in cells:
        out.append('<i style="background:%s" title="%s"></i>' % (c, v))
    return '<div class="heat" style="grid-template-columns:repeat(%d,1fr)">%s</div>' % (cols, ''.join(out))


def timeline(items):
    out = []
    for t, txt, kind in items:
        out.append('<div class="ti %s"><b>%s</b><span class="tm">%s</span><div class="mut">%s</div></div>' % ('d' if kind == 'd' else '', txt[0], t, txt[1]))
    return '<div class="tl">%s</div>' % ''.join(out)


def shell(menu, active, crumbs, body, tabs=None, who='张宁 · 客服主管', proj='城诚·三英里'):
    tabs = tabs or ['物业服务', '智慧物联', '协同办公', '数据统计', '系统设置']
    mi = []
    for item in menu:
        name = item[0]
        if name.startswith('#'):
            mi.append('<div class="mt">%s</div>' % name[1:])
            continue
        icon, is_on = item[1], (item[2] if len(item) > 2 else False)
        mi.append('<div class="mi %s">%s<span>%s</span></div>' % ('on' if is_on else '', ic(icon), name))
    tb = ''.join('<div class="tb %s">%s</div>' % ('on' if t == active else '', t) for t in tabs)
    return ('<div class="scr"><aside class="side"><div class="lg"><em></em>城诚集团</div>%s'
            '<div class="foot">v2.4.0 · 2026</div></aside>'
            '<div class="main"><div class="top">%s<div class="who"><span>%s</span>'
            '<span class="av">张</span><span>退出</span></div></div>'
            '<div class="crumb">%s</div><div class="cont">%s</div></div></div>') % (''.join(mi), tb, proj + ' · ' + who, crumbs, body)


def section(no, title, desc, mock, specs, diff, sid):
    sp = ''.join('<div class="sp"><h3><s></s>%s</h3><ul>%s</ul></div>' % (t, ''.join('<li>%s</li>' % x for x in items))
                 for t, items in specs)
    return ('<section class="sec" id="%s"><div class="sechd"><div class="no">%s</div><div><h2>%s</h2><p>%s</p></div></div>'
            '<div class="frame"><div class="fbar"><i></i><i></i><i></i><span class="url">%s</span></div>'
            '<div class="scrh">%s</div></div><div class="specs">%s</div>%s</section>') % (
        sid, no, title, desc, 'admin.wy-property.cn / #/' + sid, mock, sp, diff)


def diffbox(title, items, against=''):
    a = ('<div><h5>可借鉴</h5>%s</div><div><h5>我做的优化</h5>%s</div>' % (against[0], against[1])) if against else ''
    return '<div class="diff"><b>%s</b>%s%s</div>' % (title, a, ''.join('<div>· %s</div>' % i for i in items) if not against else '')
