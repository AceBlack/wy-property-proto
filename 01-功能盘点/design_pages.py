# -*- coding: utf-8 -*-
"""五个页面的高保真线框（纯 HTML/CSS）"""
from design_kit import (kpi, card, donut, legend, bars, stacked, table, line_chart,
                        spark, heat, timeline, shell, ic)

C = ['#2b5cff', '#12b8a6', '#ff8b3d', '#7c5cff', '#f0ab00', '#ef4559', '#22b573', '#93a3b9']


# ============================================================ 01 办公工作台
def p_workbench():
    menu = [('工作台', 'work', True), ('资产', 'build', False), ('费用', 'money', False),
            ('工单', 'file', False), ('巡检', 'clock', False), ('协同', 'user', False),
            ('物联', 'chip', False), ('报表', 'chart', False), ('#设置', ''), ('组织权限', 'gear', False)]
    body = []
    body.append('<div style="display:flex;align-items:center;gap:14px">'
                '<div><div style="font-size:18px;font-weight:750;letter-spacing:-.3px">上午好，张宁</div>'
                '<div class="mut" style="margin-top:2px">城诚·三英里 · 客服主管　·　今天 6 项待办，<span style="color:#ef4559;font-weight:600">2 项已超时</span></div></div>'
                '<div style="margin-left:auto;display:flex;gap:8px"><span class="bt g">全部标记已读</span>'
                '<span class="bt p">+ 新建工单</span></div></div>')

    body.append('<div class="kpis" style="grid-template-columns:repeat(6,1fr)">' + ''.join([
        kpi('待我审批', '8', '项', 'file', '+2 今日', ''),
        kpi('待处理工单', '12', '单', 'work', '-3 较昨日', 'o'),
        kpi('今日考勤异常', '3', '人', 'user', '需确认', 'r'),
        kpi('未读通知', '5', '条', 'bell', '', 'p'),
        kpi('本周到期任务', '7', '项', 'clock', '', 'y'),
        kpi('本月完成', '26', '项', '+9', 't'),
    ]) + '</div>')

    todo = ('<div class="chips" style="margin-bottom:6px"><span class="chip on">待我审批 8</span>'
            '<span class="chip">待我处理 12</span><span class="chip">抄送我的 5</span>'
            '<span class="chip">我发起的 3</span></div>')
    todo += table(['类型', '标题', '发起人', '时间', '时限'], [
        ['<span class="pill">审批</span>', '<span class="em">采购申请 · 保洁耗材补充 ¥4,260</span>', '李静', '10:24', '<span class="pill r">超时 2h</span>'],
        ['<span class="pill">审批</span>', '员工转正 · 王浩（工程部）', '系统', '09:12', '<span class="pill y">今日</span>'],
        ['<span class="pill o">工单</span>', '<span class="em">3-2-1602 卫生间漏水（入户收费）</span>', '业主端', '08:50', '<span class="pill r">超时 40m</span>'],
        ['<span class="pill t">巡检</span>', '抽查：保洁 B 区日检执行', '品质', '昨天 18:30', '<span class="pill y">今日</span>'],
        ['<span class="pill">合同</span>', '商铺 S-108 续租审批', '招商', '昨天 16:05', '<span class="pill n">3 天</span>'],
        ['<span class="pill">用印</span>', '电梯维保合同用印', '行政', '昨天 11:20', '<span class="pill n">3 天</span>'],
    ])
    body.append('<div class="g12">' + card('待办中心', todo, '<a>全部待办 →</a>', 'c8') + _quick() + '</div>')

    att = ('<div style="display:flex;align-items:center;gap:12px">'
           + donut([('出勤', 18, C[0]), ('请假', 1, C[2]), ('异常', 2, C[5])], '18', '应出勤 21 天', 96)
           + '<div style="flex:1">'
           + '<div class="li"><span class="mut">本月出勤</span><b class="n" style="margin-left:auto">18 / 21</b></div>'
           + '<div class="li"><span class="mut">迟到 / 早退</span><b class="n" style="margin-left:auto;color:#ef4559">2 次</b></div>'
           + '<div class="li"><span class="mut">请假</span><b class="n" style="margin-left:auto">1 天</b></div>'
           + '<div class="li"><span class="mut">加班</span><b class="n" style="margin-left:auto">16 h</b></div>'
           + '</div></div>')
    att += '<div style="margin-top:6px"><span class="bt g" style="width:100%;justify-content:center">查看我的考勤</span></div>'
    body.append('<div class="g12">' + card('我的考勤', att, '<span class="mut">10 月</span>', 'c4')
                + card('我的日程', '<div class="tl">'
                       '<div class="ti d"><b>09:30 项目晨会</b><span class="tm">已结束</span><div class="mut">会议室 A · 8 人</div></div>'
                       '<div class="ti"><b>14:00 3 号楼业主沟通</b><span class="tm">2h 后</span><div class="mut">3-1-802 · 漏水赔偿</div></div>'
                       '<div class="ti"><b>16:30 月度品质评审</b><span class="tm">今日</span><div class="mut">线上 · 需提交品质报告</div></div>'
                       '</div>', '<a>+ 新建日程</a>', 'c4')
                + card('公告与动态', '<div class="li"><span class="pill r">置顶</span><span class="lt">关于 10 月收费冲刺的通知</span><span class="lm">2h</span></div>'
                       '<div class="li"><span class="pill">公告</span><span class="lt">消防演练定于 10-24 上午</span><span class="lm">昨</span></div>'
                       '<div class="li"><span class="pill t">动态</span><span class="lt">李静 完成了 6 单收费对账</span><span class="lm">昨</span></div>'
                       '<div class="li"><span class="pill o">预警</span><span class="lt">B 区 3 台水泵在线异常</span><span class="lm">2 天</span></div>'
                       '<div class="li"><span class="pill n">制度</span><span class="lt">《员工奖惩制度 V3》已发布</span><span class="lm">3 天</span></div>',
                       '<a>全部 →</a>', 'c4') + '</div>')

    eff = ('<div style="display:flex;gap:18px;margin-bottom:2px">'
           '<div><div class="mut">近 7 日处理量</div><div style="font-size:19px;font-weight:750">86 <small style="font-size:11px;color:#12b8a6">+12%</small></div></div>'
           '<div><div class="mut">平均处理时长</div><div style="font-size:19px;font-weight:750">1.8 <small style="font-size:11px;color:#67788f">小时</small></div></div>'
           '<div><div class="mut">超时率</div><div style="font-size:19px;font-weight:750">4.2<small style="font-size:11px;color:#67788f">%</small></div></div>'
           '<div style="margin-left:auto;align-self:flex-end" class="mut">数据口径：我经手的工单 + 审批</div></div>')
    eff += line_chart([[8, 12, 9, 15, 11, 17, 14]], 620, 116,
                      ['10-15', '10-16', '10-17', '10-18', '10-19', '10-20', '10-21'])
    body.append('<div class="g12">' + card('我的效率', eff,
                '<span class="mut"><i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:#2b5cff"></i> 我经手的处理量（件）</span>', 'c8')
                + card('团队今日', bars([('工单及时率', 96, '#2b5cff'), ('巡检完成率', 98, '#12b8a6'),
                                        ('收费完成率', 92, '#ff8b3d'), ('品质合格率', 89, '#7c5cff')], unit='%', width=74)
                       + '<div class="tip" style="margin-top:10px">品质合格率低于 90%，B 区保洁需重点复核</div>',
                       '<a>部门看板 →</a>', 'c4') + '</div>')

    return shell(menu, '协同办公', '首页 / 工作台 / 我的待办', ''.join(body))


def _quick():
    items = [('收银台', 'money'), ('报修派单', 'file'), ('巡检任务', 'clock'), ('请假', 'user'),
             ('报销', 'money'), ('合同审批', 'file'), ('采购申请', 'box'), ('工资条', 'chart')]
    tiles = ''.join('<div style="display:flex;flex-direction:column;align-items:center;gap:5px;padding:9px 0;border-radius:9px;background:#f8fafd">'
                    '%s<span style="font-size:11.5px;color:#4b5c75">%s</span></div>' % (ic(i, 'q'), n) for n, i in items)
    # 图标沿用统一描边，尺寸由内联控制
    tiles = tiles.replace('class="ic q"', 'class="ic" style="width:18px;height:18px;color:#5b7396"')
    return card('快捷入口', '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">%s</div>'
                '<div class="mut" style="margin-top:8px;text-align:center">可在「工作台设置」里自定义</div>' % tiles,
                '<a>设置</a>', 'c4')


# ============================================================ 02 资产驾驶舱
def p_asset():
    menu = [('工作台', 'work', False), ('#资产', ''), ('资产驾驶舱', 'chart', True), ('房屋与楼栋', 'build', False),
            ('业主档案', 'user', False), ('车位与车辆', 'box', False), ('合同与经营', 'file', False),
            ('#费用', ''), ('费用驾驶舱', 'money', False), ('收银台', 'money', False)]
    body = []
    body.append('<div style="display:flex;align-items:center;gap:10px">'
                '<div style="font-size:16px;font-weight:750">资产驾驶舱</div>'
                '<span class="chip on">城诚·三英里</span><span class="chip">城诚·翡翠湾</span>'
                '<span class="chip">集团汇总</span>'
                '<div style="margin-left:auto;display:flex;gap:8px;align-items:center">'
                '<span class="chip">本月</span><span class="chip">本季</span><span class="chip">本年</span>'
                '<span class="mut" style="margin-left:4px">更新 22:41</span><span class="bt g">导出</span></div></div>')

    body.append('<div class="kpis" style="grid-template-columns:repeat(6,1fr)">' + ''.join([
        kpi('楼栋总数', '45', '栋', 'build', '含 3 栋商业', ''),
        kpi('房屋数量', '2,000', '间', 'box', '+12 本月交付', 't'),
        kpi('车位总数', '888', '个', 'box', '已租售 734', 'p'),
        kpi('在册人口', '1,639', '人', 'user', '业主 1,022 / 租户 617', ''),
        kpi('空置率', '6.2', '%', 'chart', '+0.4pt', 'y'),
        kpi('产权办理率', '78', '%', 'file', '待办 42 户', 'r'),
    ]) + '</div>')

    a1 = ('<div style="display:flex;gap:10px;align-items:center">'
          + donut([('住宅', 1720, C[0]), ('商铺', 96, C[2]), ('车位', 888, C[1]), ('配套', 184, C[3])], '2,888', '资产总量(宗)', 112)
          + legend([('住宅', 1720, C[0]), ('商铺', 96, C[2]), ('车位', 888, C[1]), ('配套用房', 184, C[3])]) + '</div>')

    use = [('自住', 1180, '#2b5cff'), ('出租', 396, '#12b8a6'), ('空置', 124, '#ff8b3d'), ('装修中', 20, '#7c5cff')]
    a2 = stacked(use, 12) + '<div style="display:flex;gap:14px;margin-top:10px">' + ''.join(
        '<div style="flex:1;white-space:nowrap"><div class="mut">%s</div><div style="font-size:15px;font-weight:700">%s <small style="font-size:10px;color:#9aa8bd">%.1f%%</small></div></div>'
        % (n, format(v, ','), v / 1720 * 100) for n, v, _ in use) + '</div>'
    a2 += table(['业态', '总套数', '空置', '空置率'], [
        ['住宅', '1,720', '124', '7.2%'], ['商铺', '96', '11', '11.5%'], ['配套', '184', '6', '3.3%']], ['l', 'r', 'r', 'r'])
    # 手动压缩表格高度
    a2 = a2.replace('<td class="n" style="text-align:right">7.2%</td>', '<td class="n" style="text-align:right;color:#ef4559;font-weight:600">7.2%</td>')

    pk = ('<div style="display:flex;align-items:center;gap:10px">'
          + donut([('已绑定', 734, C[1]), ('未绑定', 154, '#e9eff8')], '82%', '车牌绑定率', 92)
          + '<div style="flex:1"><div class="li"><span class="mut">30 天内到期</span><b class="n" style="margin-left:auto;color:#ff8b3d">46</b></div>'
          '<div class="li"><span class="mut">一位多车</span><b class="n" style="margin-left:auto;color:#ef4559">7</b></div>'
          '<div class="li"><span class="mut">临停日均</span><b class="n" style="margin-left:auto">312</b></div></div></div>')
    body.append('<div class="g12">' + card('资产构成', a1, '<a>明细</a>', 'c4')
                + card('房屋使用状态', a2, '<a>房屋清单 →</a>', 'c5')
                + card('车位健康度', pk, '<a>车位管理 →</a>', 'c3') + '</div>')

    cells = []
    for i in range(45):
        r = abs((i * 37) % 11)
        c = '#e8f7ef' if r < 4 else ('#c9ecd9' if r < 7 else ('#ffe1c7' if r < 9 else '#ffc9cf'))
        cells.append(('T%d栋' % (i + 1), c))
    hm = ('<div class="mut" style="margin-bottom:8px">按楼栋空置率着色，点击下钻到房屋清单</div>'
          + heat(cells, 15)
          + '<div style="display:flex;gap:14px;margin-top:10px;font-size:11px;color:#67788f;align-items:center">'
          '<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#e8f7ef"></i> 0-3%</span>'
          '<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#c9ecd9"></i> 3-8%</span>'
          '<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#ffe1c7"></i> 8-15%</span>'
          '<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:#ffc9cf"></i> &gt;15%</span>'
          '<span class="mut" style="margin-left:auto">最差：T31 栋 22%</span></div>')
    body.append('<div class="g12">' + card('楼栋空置热力', hm, '<span class="mut">45 栋</span>', 'c5')
                + card('合同到期预警（90 天内）', table(['合同号', '承租方', '业态', '月租', '到期日', '剩余'], [
                    ['HT-2023-0187', '美宜佳便利店', '商铺 S-108', '¥8,600', '2026-11-05', '<span class="pill r">15 天</span>'],
                    ['HT-2024-0042', '中国移动营业厅', '商铺 S-102', '¥12,400', '2026-11-20', '<span class="pill r">30 天</span>'],
                    ['HT-2023-0231', '李某某（住宅）', '3-2-1602', '¥2,800', '2026-12-01', '<span class="pill y">41 天</span>'],
                    ['HT-2024-0088', '顺丰驿站', '配套 P-03', '¥3,200', '2026-12-15', '<span class="pill y">55 天</span>'],
                    ['HT-2024-0102', '张某某（车位）', 'B1-088', '¥300', '2027-01-08', '<span class="pill n">79 天</span>'],
                ], ['l', 'l', 'l', 'r', 'l', 'r'])
                    + '<div class="tip y" style="margin-top:8px">6 份合同 30 天内到期，其中 2 份未发起续租流程</div>',
                    '<a>合同台账 →</a>', 'c7') + '</div>')

    life = ('<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">'
            + ''.join('<div style="background:#f8fafd;border-radius:9px;padding:8px 10px">'
                      '<div class="mut">%s</div><div style="font-size:16px;font-weight:700">%s</div></div>' % (a, b)
                      for a, b in [('本月交房', '12 套'), ('装修报备', '8 户'), ('产权过户', '3 户'),
                                   ('新签合同', '6 份'), ('退租', '5 户'), ('入住率', '93.8%')])
            + '</div>'
            + '<div class="tl">'
            '<div class="ti"><b>3-2-1801 完成交房</b><span class="tm">今天 10:12</span><div class="mut">面积 118㎡ · 业主 王某某</div></div>'
            '<div class="ti"><b>3-1-902 装修报备通过</b><span class="tm">今天 09:30</span><div class="mut">工期 45 天 · 押金 ¥2,000</div></div>'
            '<div class="ti"><b>S-108 续租流程发起</b><span class="tm">昨天</span><div class="mut">月租拟上调 5%</div></div>'
            '<div class="ti d"><b>B1-088 车位退租</b><span class="tm">前天</span><div class="mut">已释放，待重新上架</div></div>'
            '</div>')
    risk = ('<div class="tip r" style="margin-bottom:8px">空置超 90 天 17 套，集中在 T31 / T32 栋，建议启动特价策略</div>'
            + table(['风险项', '数量', '影响', '建议动作'], [
                ['空置超 90 天', '17 套', '年损失约 ¥61 万', '调价 / 渠道推广'],
                ['产权未办理', '42 户', '投诉与合规风险', '批量代办'],
                ['一位多车', '7 个', '车场纠纷', '按规则清理'],
                ['合同临期未续', '6 份', '收入中断', '自动续租提醒'],
                ['装修超期', '2 户', '现场安全', '现场核查'],
            ], ['l', 'r', 'l', 'l']))
    body.append('<div class="g12">' + card('资产生命周期（本月）', life, '<span class="mut">实时</span>', 'c5')
                + card('资产风险清单', risk, '<a>生成报告</a>', 'c7') + '</div>')
    return shell(menu, '物业服务', '首页 / 数据驾驶舱 / 资产', ''.join(body))


# ============================================================ 03 物联驾驶舱
def p_iot():
    menu = [('工作台', 'work', False), ('#物联', ''), ('物联驾驶舱', 'chart', True), ('设备台账', 'chip', False),
            ('门禁与通行', 'user', False), ('车场设备', 'box', False), ('视频监控', 'camera', False),
            ('告警中心', 'bell', False), ('联动场景', 'work', False), ('#运维', ''), ('工单监控台', 'file', False)]
    body = []
    body.append('<div style="display:flex;align-items:center;gap:10px">'
                '<div style="font-size:16px;font-weight:750">物联驾驶舱</div>'
                '<span class="chip on">城诚·三英里</span><span class="chip">全部子系统</span>'
                '<div style="margin-left:auto;display:flex;gap:8px;align-items:center">'
                '<span class="mut"><i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#22b573"></i> 实时连接</span>'
                '<span class="mut">30s 刷新</span><span class="bt g">全屏</span></div></div>')

    body.append('<div class="kpis" style="grid-template-columns:repeat(6,1fr)">' + ''.join([
        kpi('接入设备', '1,286', '台', 'chip', '+18 本月', ''),
        kpi('设备在线率', '98.2', '%', 'chart', '-0.6pt', 't'),
        kpi('今日告警', '37', '条', 'bell', '严重 3', 'o'),
        kpi('未闭环告警', '6', '条', 'clock', '超 24h 2 条', 'r'),
        kpi('今日通行', '4,812', '次', 'user', '门禁 3,906 / 车场 906', 'p'),
        kpi('在场车辆', '486', '辆', 'box', '周转 3.2 次/位', 'y'),
    ]) + '</div>')

    on = bars([('门禁', 99.2, '#2b5cff'), ('车场', 97.8, '#12b8a6'), ('监控', 96.4, '#7c5cff'),
               ('梯控', 99.6, '#22b573'), ('消防', 100, '#2b5cff'), ('给排水', 95.1, '#ff8b3d'),
               ('照明', 98.9, '#12b8a6')], unit='%', width=52)
    on += '<div class="mut" style="margin-top:6px">离线设备 23 台，其中 11 台为地下车库摄像头（交换机故障）</div>'
    trend = line_chart([[2, 1, 0, 1, 3, 6, 4, 2, 5, 9, 12, 8, 6, 4, 7, 11, 14, 9, 6, 5, 8, 12, 7, 4],
                        [2, 1, 0, 1, 3, 5, 4, 2, 4, 8, 10, 7, 5, 4, 6, 9, 12, 8, 5, 4, 7, 10, 6, 3]],
                       660, 120, ['00', '03', '06', '09', '12', '15', '18', '21'])
    trend = ('<div style="display:flex;gap:16px;margin-bottom:4px">'
             '<div><div class="mut">今日告警</div><div style="font-size:18px;font-weight:750">37</div></div>'
             '<div><div class="mut">已闭环</div><div style="font-size:18px;font-weight:750;color:#12b8a6">31</div></div>'
             '<div><div class="mut">平均响应</div><div style="font-size:18px;font-weight:750">4.2<small style="font-size:10px">min</small></div></div>'
             '<div style="margin-left:auto;align-self:flex-end" class="mut">'
             '<i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:#2b5cff"></i> 告警数　'
             '<i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:#12b8a6;margin-left:8px"></i> 已闭环</div></div>'
             + trend)
    body.append('<div class="g12">' + card('子系统在线率', on, '<a>设备台账 →</a>', 'c4')
                + card('24 小时告警趋势', trend, '<span class="mut">按小时</span>', 'c8') + '</div>')

    al = table(['时间', '点位 / 设备', '类型', '等级', '状态', '处理人'], [
        ['22:31', '<span class="em">B1 车库 · 摄像头 CH-14</span>', '设备离线', '<span class="pill r">严重</span>', '处理中', '王浩'],
        ['22:18', '3-1 单元 · 门禁读头', '开门超时', '<span class="pill o">警告</span>', '已派单', '—'],
        ['21:52', '消防主机 · 3 号楼', '监管信号', '<span class="pill r">严重</span>', '已闭环', '李静'],
        ['21:40', 'T22 电梯 · 梯控', '困人告警', '<span class="pill r">严重</span>', '已闭环', '维保'],
        ['20:57', '生活水泵房', '压力越下限', '<span class="pill o">警告</span>', '已闭环', '王浩'],
        ['20:12', 'B2 车场入口', '道闸故障', '<span class="pill y">提示</span>', '已闭环', '—'],
    ], ['l', 'l', 'l', 'l', 'l', 'l'])
    body.append('<div class="g12">' + card('实时告警', al, '<a>告警中心 →</a>', 'c7')
                + card('联动场景', _scenes(), '<a>场景编排 →</a>', 'c5') + '</div>')

    hours = [0, 0, 1, 2, 8, 26, 64, 92, 48, 22, 18, 20, 34, 21, 16, 24, 52, 88, 96, 62, 34, 18, 9, 4]
    hb = line_chart([hours], 330, 96, ['00', '06', '12', '18'])
    hb = ('<div class="mut" style="margin-bottom:-4px">今日 4,812 次 · 高峰 18:00</div>' + hb
          + '<div style="display:flex;gap:14px;margin-top:4px">'
          '<div><div class="mut">陌生人员</div><div style="font-weight:700">126</div></div>'
          '<div><div class="mut">访客</div><div style="font-weight:700">88</div></div>'
          '<div><div class="mut">尾随告警</div><div style="font-weight:700;color:#ef4559">3</div></div></div>')
    cp = ('<div style="display:flex;gap:10px;align-items:center">'
          + donut([('月卡', 412, C[0]), ('临停', 74, C[1])], '486', '在场', 84)
          + '<div style="flex:1"><div class="li"><span class="mut">今日临停收入</span><b class="n" style="margin-left:auto">¥2,840</b></div>'
          '<div class="li"><span class="mut">月卡 30 天到期</span><b class="n" style="margin-left:auto;color:#ff8b3d">46</b></div>'
          '<div class="li"><span class="mut">厂商同步异常</span><b class="n" style="margin-left:auto;color:#ef4559">2</b></div></div></div>')
    en = ('<div style="display:flex;gap:12px">'
          '<div style="flex:1;background:#f8fafd;border-radius:9px;padding:9px 11px"><div class="mut">今日用电</div>'
          '<div style="font-size:17px;font-weight:750">2,486 <small style="font-size:10px">kWh</small></div>'
          '<div style="font-size:11px;color:#ef4559">↑ 4.2% 较昨日</div>' + spark([12, 14, 13, 16, 15, 18, 17, 19, 18, 21], 120, 26, '#ff8b3d') + '</div>'
          '<div style="flex:1;background:#f8fafd;border-radius:9px;padding:9px 11px"><div class="mut">今日用水</div>'
          '<div style="font-size:17px;font-weight:750">318 <small style="font-size:10px">m³</small></div>'
          '<div style="font-size:11px;color:#12b8a6">↓ 1.8% 较昨日</div>' + spark([18, 17, 19, 16, 15, 16, 14, 15, 13, 12], 120, 26, '#12b8a6') + '</div></div>'
          + '<div class="tip" style="margin-top:8px">B 区照明 22:00 后仍有 38 盏常亮，建议校时或改策略</div>')
    body.append('<div class="g12">' + card('门禁通行分布', hb, '<span class="mut">今日</span>', 'c4')
                + card('车场运行', cp, '<a>车场看板 →</a>', 'c4')
                + card('能耗监测', en, '<a>能耗分析 →</a>', 'c4') + '</div>')
    return shell(menu, '智慧物联', '首页 / 数据驾驶舱 / 物联', ''.join(body))


def _scenes():
    rows = [('消防报警联动', '烟感报警 → 门禁常开 + 电梯迫降 + 电话通知', '128', '100%', '#ef4559'),
            ('夜间陌生人告警', '22:00-06:00 陌生人员 → 抓拍 + 推送保安', '64', '98%', '#ff8b3d'),
            ('车位到期提醒', '到期前 7 天 → 短信 + 小程序推送 + 生成账单', '312', '100%', '#2b5cff')]
    out = []
    for n, d, c, s, col in rows:
        out.append('<div style="border:1px solid #eef2f8;border-radius:9px;padding:8px 10px;margin-bottom:7px">'
                   '<div style="display:flex;align-items:center;gap:6px"><i style="width:6px;height:6px;border-radius:50%%;background:%s"></i>'
                   '<b style="font-size:12px">%s</b><span class="mut" style="margin-left:auto">执行 %s 次 · 成功 %s</span></div>'
                   '<div class="mut" style="margin-top:2px">%s</div></div>' % (col, n, c, s, d))
    return ''.join(out)


# ============================================================ 04 业主 360
def p_owner():
    menu = [('工作台', 'work', False), ('#资产', ''), ('资产驾驶舱', 'chart', False), ('房屋与楼栋', 'build', False),
            ('业主档案', 'user', True), ('车位与车辆', 'box', False), ('合同与经营', 'file', False),
            ('#服务', ''), ('工单', 'file', False), ('收费', 'money', False)]
    body = []
    body.append('<div style="display:flex;align-items:center;gap:8px">'
                '<span class="mut">业主档案</span><span class="mut">/</span><span style="font-weight:600">肖战</span>'
                '<span class="pill n" style="margin-left:2px">客户编号 C-2023-00871</span>'
                '<div style="margin-left:auto;display:flex;gap:8px"><span class="bt g">发通知</span>'
                '<span class="bt g">发账单</span><span class="bt">换绑车牌</span><span class="bt p">去收银台收款</span></div></div>')

    head = ('<div style="display:flex;gap:14px;align-items:flex-start">'
            '<div class="avx">肖</div>'
            '<div style="flex:1;min-width:0">'
            '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:17px;font-weight:750">肖战</span>'
            '<span class="pill">业主</span><span class="pill y">VIP</span><span class="pill r">欠费 32 天</span>'
            '<span class="pill n">高价值</span></div>'
            '<div style="display:grid;grid-template-columns:repeat(4,auto);gap:2px 26px;margin-top:7px;font-size:12px;color:#4b5c75">'
            '<div><span class="mut">手机</span> 123 4567 8910</div>'
            '<div><span class="mut">身份证</span> 1101**********1234</div>'
            '<div><span class="mut">入住</span> 3 年 8 个月</div>'
            '<div><span class="mut">家庭</span> 3 人</div>'
            '<div><span class="mut">房产</span> 2 套 / 236㎡</div>'
            '<div><span class="mut">车位</span> 2 个</div>'
            '<div><span class="mut">车辆</span> 2 辆</div>'
            '<div><span class="mut">标签</span> 早缴 / 无投诉</div>'
            '</div></div>'
            '<div style="display:flex;gap:10px;flex:none">'
            + ''.join('<div style="text-align:right;min-width:74px"><div class="mut">%s</div>'
                      '<div style="font-size:17px;font-weight:750;color:%s">%s</div></div>' % (a, c, b)
                      for a, b, c in [('当前欠费', '¥3,860', '#ef4559'), ('本年已缴', '¥12,480', '#101b2f'),
                                      ('报修', '6 次', '#101b2f'), ('满意度', '4.8', '#12b8a6')])
            + '</div></div>')
    body.append(card('', head, '', '').replace('<div class="cdh"><h4></h4></div>', ''))

    prop = ('<div style="border:1px solid #eef2f8;border-radius:10px;padding:9px 11px;margin-bottom:8px">'
            '<div style="display:flex;align-items:center;gap:6px"><b style="font-size:12.5px">3-1-802</b>'
            '<span class="pill n">住宅</span><span class="pill g">自住</span>'
            '<span class="mut" style="margin-left:auto">118㎡ · 三室两厅</span></div>'
            '<div class="mut" style="margin-top:3px">产权人 肖战 · 共有 无 · 交付 2022-11 · 产权证已办</div>'
            '<div style="display:flex;gap:6px;margin-top:6px"><span class="chip">本年物业费 ¥3,186</span>'
            '<span class="chip">欠费 2 期</span><span class="chip">车位 B1-088</span></div></div>'
            '<div style="border:1px solid #eef2f8;border-radius:10px;padding:9px 11px">'
            '<div style="display:flex;align-items:center;gap:6px"><b style="font-size:12.5px">S-108 商铺</b>'
            '<span class="pill n">商铺</span><span class="pill o">出租中</span>'
            '<span class="mut" style="margin-left:auto">86㎡ · 租户 美宜佳</span></div>'
            '<div class="mut" style="margin-top:3px">租期 2023-11 ~ 2026-11 · 月租 ¥8,600 · 合同 15 天后到期</div>'
            '<div style="display:flex;gap:6px;margin-top:6px"><span class="chip">租金正常</span>'
            '<span class="chip" style="color:#cf2c40;background:#feecee">续租待发起</span></div></div>')
    body.append('<div class="g12">' + card('房产（2 套 / 236㎡）', prop, '<a>资产视图 →</a>', 'c5')
                + card('家庭成员（3 人）', _family(), '<a>+ 添加</a>', 'c3')
                + card('车位（2 个）', _parking(), '<a>车位管理 →</a>', 'c4') + '</div>')

    bills = ('<div style="background:#fff5f6;border:1px solid #fbd3d8;border-radius:10px;padding:9px 11px;margin-bottom:8px">'
             '<div style="display:flex;align-items:center"><b style="font-size:12.5px;color:#b32a3d">待缴 2 笔 · 合计 ¥3,860</b>'
             '<span class="pill r" style="margin-left:auto">逾期 32 天</span></div>'
             '<div class="mut" style="margin-top:3px">物业费 2026 Q3-Q4 ¥3,540　·　车位管理费 ¥320</div></div>'
             + table(['账期', '费用项', '金额', '状态'], [
                 ['2026 Q3', '物业费', '¥1,770', '<span class="pill r">逾期</span>'],
                 ['2026 Q4', '物业费', '¥1,770', '<span class="pill y">待缴</span>'],
                 ['2026-10', '车位管理费', '¥320', '<span class="pill y">待缴</span>'],
                 ['2026 Q2', '物业费', '¥1,770', '<span class="pill g">已缴</span>'],
                 ['2026-09', '车位管理费', '¥320', '<span class="pill g">已缴</span>'],
             ], ['l', 'l', 'r', 'r'])
             + '<div class="tip" style="margin-top:8px">已催缴 3 次（短信 2 / 电话 1），最近 10-19</div>')
    body.append('<div class="g12">' + card('缴费与欠费', bills, '<a>账单明细 →</a>', 'c5')
                + card('通行记录', _pass(), '<span class="mut">近 7 天</span>', 'c7') + '</div>')

    cons = ('<div style="display:flex;align-items:center;gap:8px">'
            + donut([('物业费', 9, C[0]), ('车位费', 3, C[1]), ('水电', 4, C[2]), ('增值服务', 2, C[3])], '18', '笔/本年', 90)
            + '<div style="flex:1"><div class="li"><span class="mut">本年消费</span><b class="n" style="margin-left:auto">¥12,480</b></div>'
            '<div class="li"><span class="mut">月均</span><b class="n" style="margin-left:auto">¥1,040</b></div>'
            '<div class="li"><span class="mut">缴费及时率</span><b class="n" style="margin-left:auto">72%</b></div></div></div>')
    body.append('<div class="g12">' + card('消费统计', cons, '<span class="mut">本年</span>', 'c3')
                + card('服务历史', _history(), '<a>全部记录 →</a>', 'c9') + '</div>')
    return shell(menu, '物业服务', '首页 / 业主档案 / 肖战', ''.join(body))


def _family():
    rows = [('李', '李某某', '配偶', '138****2231', '已认证', '#2b5cff'),
            ('肖', '肖小某', '子女', '—', '未认证', '#12b8a6'),
            ('王', '王某某', '父母', '139****8802', '已认证', '#ff8b3d')]
    out = []
    for av, n, rel, tel, st, col in rows:
        out.append('<div class="li"><span class="avs" style="background:%s1a;color:%s">%s</span>'
                   '<span class="lt"><b>%s</b> <span class="mut">%s</span></span>'
                   '<span class="lm">%s</span><span class="pill n">%s</span></div>' % (col, col, av, n, rel, tel, st))
    return ''.join(out) + '<div class="mut" style="margin-top:6px">家属可授权开门、接收通知，不参与计费</div>'


def _parking():
    rows = [('B1-088', '自有车位', '粤B·D12345', '2027-03-31', '#2b5cff', '正常'),
            ('B1-102', '租赁车位', '粤B·D67890', '2026-11-15', '#ff8b3d', '46 天到期')]
    out = []
    for no, typ, plate, exp, col, st in rows:
        out.append('<div style="border:1px solid #eef2f8;border-radius:9px;padding:8px 10px;margin-bottom:7px">'
                   '<div style="display:flex;align-items:center;gap:6px"><b style="font-size:12.5px">%s</b>'
                   '<span class="pill n">%s</span><span class="mut" style="margin-left:auto">%s</span></div>'
                   '<div class="mut" style="margin-top:2px">绑定车牌 %s</div>'
                   '<div style="display:flex;gap:6px;margin-top:5px"><span class="chip">到期 %s</span>'
                   '<span class="chip" style="color:%s">%s</span></div></div>' % (no, typ, plate, plate, exp, col, st))
    return ''.join(out)


def _pass():
    t = table(['时间', '类型', '通道', '方式', '结果'], [
        ['今天 18:42', '<span class="pill">门禁</span>', '3-1 单元门', '人脸', '通过'],
        ['今天 18:36', '<span class="pill t">车场</span>', 'B1 入口', '车牌 粤B·D12345', '进场'],
        ['今天 08:12', '<span class="pill">门禁</span>', '东门人行', '刷卡', '通过'],
        ['昨天 20:05', '<span class="pill o">访客</span>', '3-1 单元门', '临时码 王某某', '通过'],
        ['昨天 19:48', '<span class="pill t">车场</span>', 'B1 出口', '车牌 粤B·D67890', '出场 ¥6'],
    ], ['l', 'l', 'l', 'l', 'l'])
    return ('<div class="chips" style="margin-bottom:6px"><span class="chip on">全部</span><span class="chip">门禁</span>'
            '<span class="chip">车场</span><span class="chip">访客</span><span class="chip">异常</span></div>' + t)


def _history():
    t = table(['时间', '类型', '事项', '处理人', '状态', '满意度'], [
        ['10-19 14:20', '<span class="pill o">报修</span>', '厨房下水堵塞（入户收费 ¥120）', '王浩', '<span class="pill g">已完成</span>', '★★★★★'],
        ['10-19 15:02', '<span class="pill y">催缴</span>', 'Q3 物业费电话催缴', '张宁', '<span class="pill y">未缴</span>', '—'],
        ['09-28 09:10', '<span class="pill t">巡检</span>', '入户安全巡检（燃气/水电）', '李静', '<span class="pill g">已完成</span>', '★★★★☆'],
        ['09-12 16:40', '<span class="pill">投诉</span>', '楼上噪音，已协调', '张宁', '<span class="pill g">已闭环</span>', '★★★★☆'],
        ['08-30 10:05', '<span class="pill o">报修</span>', '客厅灯不亮（公共线路，免费）', '王浩', '<span class="pill g">已完成</span>', '★★★★★'],
    ], ['l', 'l', 'l', 'l', 'l', 'l'])
    return t + '<div class="mut" style="margin-top:6px">同一时间轴聚合报修 / 投诉 / 巡检 / 催缴 / 缴费，客服一次看全，避免"每次都要问一遍"</div>'


# ============================================================ 05 人力资源
def p_hr():
    menu = [('工作台', 'work', False), ('#协同办公', ''), ('协同工作台', 'work', False), ('审批流', 'file', False),
            ('考勤', 'clock', False), ('人力资源', 'user', True), ('巡检品质', 'chart', False),
            ('采购库存', 'box', False), ('#组织', ''), ('组织与权限', 'gear', False)]
    body = []
    body.append('<div style="display:flex;align-items:center;gap:10px">'
                '<div style="font-size:16px;font-weight:750">人力资源</div>'
                '<span class="chip on">人事看板</span><span class="chip">招聘</span><span class="chip">员工档案</span>'
                '<span class="chip">薪酬</span><span class="chip">工资表</span>'
                '<div style="margin-left:auto"><span class="bt g">导出花名册</span></div></div>')

    body.append('<div class="kpis" style="grid-template-columns:repeat(6,1fr)">' + ''.join([
        kpi('编制 / 在岗', '120 / 112', '人', 'user', '缺口 8', ''),
        kpi('试用期', '9', '人', 'clock', '3 人本月转正', 'y'),
        kpi('本月异动', '5', '人', 'work', '入职 4 / 离职 1', 't'),
        kpi('人力成本率', '18.6', '%', 'money', '-0.8pt', 'p'),
        kpi('人均管理面积', '4,200', '㎡', 'build', '+120', ''),
        kpi('待办事项', '14', '项', 'bell', '合同 4 / 证书 2', 'r'),
    ]) + '</div>')

    funnel = ('<div class="mut" style="margin-bottom:4px">本月 · 在招 6 个岗位</div>'
              + bars([('简历投递', 42, '#2b5cff'), ('初筛通过', 26, '#3f6bff'), ('面试', 18, '#12b8a6'),
                      ('发放 offer', 6, '#ff8b3d'), ('实际入职', 4, '#22b573')], width=66)
              + '<div style="display:flex;gap:10px;margin-top:8px">'
              '<div><div class="mut">平均招聘周期</div><div style="font-weight:700">18 <small style="font-size:10px">天</small></div></div>'
              '<div><div class="mut">offer 接受率</div><div style="font-weight:700">67%</div></div>'
              '<div><div class="mut">渠道成本</div><div style="font-weight:700">¥1,240</div></div></div>')
    todo = ('<div class="li"><span class="pill y">转正</span><span class="lt">王浩 · 工程部 · 试用期到 10-31</span><a>办理</a></div>'
            '<div class="li"><span class="pill r">合同</span><span class="lt">李静 · 合同 11-05 到期</span><a>续签</a></div>'
            '<div class="li"><span class="pill r">证书</span><span class="lt">张强 · 电工证 11-12 到期</span><a>提醒</a></div>'
            '<div class="li"><span class="pill">离职</span><span class="lt">陈明 · 交接 3/5 项完成</span><a>查看</a></div>'
            '<div class="li"><span class="pill t">工资</span><span class="lt">10 月工资表待审核（112 人）</span><a>去审核</a></div>')
    org = bars([('客服部', 28, '#2b5cff'), ('工程部', 32, '#12b8a6'), ('秩序部', 30, '#ff8b3d'),
                ('环境部', 18, '#7c5cff'), ('综合', 12, '#f0ab00')], width=54)
    org += '<div class="mut" style="margin-top:6px">灰色为编制上限，实际在岗低于编制 8 人，秩序部缺口最大（-5）</div>'
    body.append('<div class="g12">' + card('招聘漏斗', funnel, '<a>招聘需求 →</a>', 'c4')
                + card('待办提醒', todo, '<span class="mut">14 项</span>', 'c4')
                + card('部门编制与在岗', org, '<a>编制管理 →</a>', 'c4') + '</div>')

    prof = ('<div style="display:flex;gap:12px">'
            '<div class="avx" style="width:64px;height:64px;border-radius:16px">王</div>'
            '<div style="flex:1">'
            '<div style="display:flex;align-items:center;gap:6px"><b style="font-size:15px">王浩</b>'
            '<span class="pill">工程部</span><span class="pill t">P5 技工</span><span class="pill y">试用期</span></div>'
            '<div class="mut" style="margin-top:2px">工号 E-2026-018 · 入职 2026-07-01 · 试用期至 2026-10-31</div></div></div>'
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin-top:10px;font-size:12px;color:#4b5c75">'
            '<div><span class="mut">岗位</span> 维修技工（水电）</div><div><span class="mut">直属上级</span> 赵强</div>'
            '<div><span class="mut">合同</span> 2026-07-01 ~ 2029-06-30</div><div><span class="mut">社保</span> 已参保（深圳）</div>'
            '<div><span class="mut">证书</span> 低压电工证</div><div><span class="mut">紧急联系人</span> 王父 139****</div>'
            '<div><span class="mut">银行卡</span> 招商 ****8821</div><div><span class="mut">累计奖惩</span> +2 / 0</div>'
            '</div>'
            '<div style="display:flex;gap:6px;margin-top:9px"><span class="chip">档案 100% 完整</span>'
            '<span class="chip">培训 4/6</span><span class="chip">绩效 86</span></div>')

    band = table(['职级', '岗位示例', '薪酬带宽（月）', '在岗', '中位值'], [
        ['P7', '项目经理', '¥18,000 – ¥26,000', '4', '¥22,000'],
        ['P6', '部门主管', '¥12,000 – ¥18,000', '11', '¥15,000'],
        ['P5', '高级技工 / 客服', '¥8,000 – ¥12,000', '38', '¥9,800'],
        ['P4', '技工 / 管家', '¥6,000 – ¥8,000', '42', '¥7,200'],
        ['P3', '秩序员 / 保洁', '¥4,500 – ¥6,000', '17', '¥5,200'],
    ], ['l', 'l', 'l', 'r', 'r'])
    band += '<div class="mut" style="margin-top:6px">带宽是薪酬制度的核心：同岗不同级、同级有区间，调薪必须在带宽内并走审批</div>'
    body.append('<div class="g12">' + card('员工档案', prof, '<a>完整档案 →</a>', 'c5')
                + card('职级与薪酬带宽', band, '<a>职级体系 →</a>', 'c7') + '</div>')

    pay = table(['工号', '姓名', '部门', '应发', '社保公积金', '个税', '其他扣款', '实发', '状态'], [
        ['E-018', '王浩', '工程部', '9,200', '1,180', '85', '0', '<b>7,935</b>', '<span class="pill g">已发放</span>'],
        ['E-007', '李静', '客服部', '8,600', '1,090', '60', '120', '<b>7,330</b>', '<span class="pill g">已发放</span>'],
        ['E-003', '赵强', '工程部', '15,000', '1,860', '620', '0', '<b>12,520</b>', '<span class="pill g">已发放</span>'],
        ['E-021', '张强', '秩序部', '5,600', '720', '0', '50', '<b>4,830</b>', '<span class="pill y">待复核</span>'],
    ], ['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'])
    pay += ('<div style="display:flex;gap:12px;margin-top:8px;align-items:center">'
            '<div class="mut">10 月工资表 · 112 人 · 应发合计 ¥968,400 · 实发 ¥812,300</div>'
            '<div style="margin-left:auto;display:flex;gap:6px"><span class="bt g">生成银行代发文件</span>'
            '<span class="bt p">审核发放</span></div></div>')
    flow = ('<div class="tl">'
            '<div class="ti"><b>转正 · 王浩</b><span class="tm">10-21</span><div class="mut">试用期考核 86 分，部门同意转正</div></div>'
            '<div class="ti"><b>调薪 · 李静</b><span class="tm">10-15</span><div class="mut">P4→P5，+¥800，在带宽内</div></div>'
            '<div class="ti"><b>奖励 · 秩序部 3 人</b><span class="tm">10-08</span><div class="mut">消防演练表现突出，各奖 ¥200</div></div>'
            '<div class="ti d"><b>离职 · 陈明</b><span class="tm">10-05</span><div class="mut">主动离职，交接中</div></div>'
            '</div>')
    body.append('<div class="g12">' + card('工资表', pay, '<a>历史工资表 →</a>', 'c8')
                + card('异动与奖惩', flow, '<a>全部 →</a>', 'c4') + '</div>')
    return shell(menu, '协同办公', '首页 / 人力资源 / 人事看板', ''.join(body))
