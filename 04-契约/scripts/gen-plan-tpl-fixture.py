"""计划模板样例数据（2026-11-03 第 54 批；2026-11-05 第 60 批去掉权重）

与原型 `03-原型/src/utils/api.js` T 域的种子保持一致：五套业务模板 + 一个职能兜底。
契约测试与 mock 服务都读这份，避免两边各写一遍。

**第 60 批起模板里没有权重**：
  - 模板只定「考什么、怎么算分」：条目、单位、方向、目标默认值、监控的扣分规则文字；
  - 「每项占多少」由提报人在新建计划时逐项填，运营管理部审核可调；
  - 所以这份样例里既没有 `wq/wk`，条目上也没有 `weight`；
  - 方向 direction：1 正向（收入、及时率）、-1 逆向（成本、能耗）。
"""
import json
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'plan-templates.json')

MONITOR = [
    ('主动离职人数', '部门员工每主动离职 1 人，考核总分扣 0.05 分，最高扣 0.2 分'),
    ('培训达标率', '完成值低于 95%，每下降 1 分，考核总分扣 0.05 分，最高扣 0.2 分'),
    ('月度品质检查', '不合格问题整改率 100% 低于达标率，绩效考核降一档'),
    ('有效投诉 0 起', '每发生一起，考核总分扣 0.2 分'),
    ('质量责任事故 0 起', '每发生一起，考核总分扣 0.2 分')
]


def item(section, name, unit='', target='', direction=1, standard=''):
    return {
        'section': section, 'name': name, 'unit': unit,
        'targetDefault': target, 'direction': direction, 'standard': standard,
        'enabled': True
    }


SPECS = [
    {
        'tplId': 'PT01', 'name': '项目经理月度计划', 'matchType': '项目', 'matchSuffix': '',
        'desc': '项目经理考核：收入与成本五项量化 + 五项监控 + 五项重点工作',
        'q': [('物业费清欠', '元', 383796, 1), ('车位费收入', '元', 53040, 1),
              ('其他营业收入', '元', 6810, 1), ('运行成本控制', '元', 17296, -1),
              ('能耗成本控制', '元', 38697, -1)],
        'm': MONITOR,
        'k': ['客户服务（社区活动、客户信息管理）', '房屋及设施设备管理', '环境管理',
              '公共秩序管理', '重要节点工作']
    },
    {
        'tplId': 'PT02', 'name': '客服组月度计划', 'matchType': '班组', 'matchSuffix': '1',
        'desc': '客服班组：三项收入量化 + 五项监控 + 八项重点工作',
        'q': [('物业费清欠', '元', 319830, 1), ('车位费收入', '元', 32240, 1),
              ('其他营业收入', '元', 4300, 1)],
        'm': MONITOR,
        'k': ['社区文化活动', '员工关怀', '业主恳谈会', '项目《客户画像细分表》',
              '维修资金', '档案管理', '走回访调查', '物业费催缴']
    },
    {
        'tplId': 'PT03', 'name': '工程组月度计划', 'matchType': '班组', 'matchSuffix': '2',
        'desc': '工程班组：维修收入与能耗成本两项量化 + 六项监控 + 八项重点工作',
        'q': [('有偿维修收入', '元', 0, 1), ('能耗成本控制', '元', 39922.9, -1)],
        'm': [('年度维保计划完成率', '完成率 100%，低于达标率，考核总分扣 0.2 分')] + MONITOR,
        'k': ['园区节日布置拆除', '消防泵房维护', '直饮水系统维护', '电梯年检',
              '景观水系石材维护', '闭路监控系统常规维保', '公区运行能耗抄表', '居民供水管控']
    },
    {
        'tplId': 'PT04', 'name': '秩序组月度计划', 'matchType': '班组', 'matchSuffix': '3',
        'desc': '秩序班组：停车与其他收入两项量化 + 五项监控 + 八项重点工作',
        'q': [('临时停车收入', '元', 4000, 1), ('其他营业收入', '元', 10, 1)],
        'm': MONITOR,
        'k': ['园区管理', '消防管理', '门岗管理', '地库管理',
              '员工关怀', '突发事件演练', '品质提升', '车辆管理']
    },
    {
        'tplId': 'PT05', 'name': '环境组月度计划', 'matchType': '班组', 'matchSuffix': '4',
        'desc': '环境班组：家政收入与专项成本两项量化 + 五项监控 + 八项重点工作',
        'q': [('家政服务收入', '元', 300, 1), ('专项成本控制', '元', 7200, -1)],
        'm': MONITOR,
        'k': ['元宵节活动', '员工关怀', '越冬蚊蝇消杀', '清理地库大仓库、洗拖把间排水沟',
              '保暖套清洗', '地库环境提升', '清洗生活垃圾桶', '清理 2#、3# 楼管井、电井卫生']
    },
    {
        'tplId': 'PT06', 'name': '职能通用月度计划（兜底）', 'matchType': '职能', 'matchSuffix': '',
        'desc': '总部职能部门没有收入指标，量化段放部门级关键数据；匹配不到模板时用它兜底',
        'q': [('部门预算执行率', '%', 100, 1), ('重点工作按期完成率', '%', 100, 1)],
        'm': MONITOR[:4],
        'k': ['月度重点工作', '制度与流程维护', '跨部门协同', '团队能力建设',
              '档案与资料归档', '会议与汇报', '临时交办事项']
    }
]

out = []
for sp in SPECS:
    items = []
    n = 0
    for name, unit, tgt, d in sp['q']:
        n += 1
        it = item('q', name, unit, tgt, d)
        it['itemId'] = f"{sp['tplId']}-{n:02d}"
        items.append(it)
    for name, std in sp['m']:
        n += 1
        it = item('m', name, standard=std)
        it['itemId'] = f"{sp['tplId']}-{n:02d}"
        items.append(it)
    for name in sp['k']:
        n += 1
        it = item('k', name)
        it['itemId'] = f"{sp['tplId']}-{n:02d}"
        items.append(it)
    out.append({
        'tplId': sp['tplId'], 'name': sp['name'], 'desc': sp['desc'],
        'matchType': sp['matchType'], 'matchSuffix': sp['matchSuffix'],
        'enabled': True, 'version': 1,
        'updatedAt': '2026-11-01 09:00', 'updatedBy': '运营管理部',
        'items': items
    })

json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

for t in out:
    q = sum(1 for i in t['items'] if i['section'] == 'q')
    m = sum(1 for i in t['items'] if i['section'] == 'm')
    k = sum(1 for i in t['items'] if i['section'] == 'k')
    assert q >= 1 and k >= 1, (t['tplId'], q, k)
    assert all('weight' not in i for i in t['items']), t['tplId']
    assert 'wq' not in t and 'wk' not in t, t['tplId']
    print(f"{t['tplId']} {t['name']}  量化 {q} / 监控 {m} / 重点 {k} 条  无权重 ✓")

print(f'已生成 {len(out)} 套模板 → {os.path.normpath(OUT)}')
