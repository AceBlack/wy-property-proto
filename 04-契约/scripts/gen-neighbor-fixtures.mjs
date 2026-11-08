/**
 * 邻居域 fixtures 生成器
 * ----------------------------------------------------------------
 * 为什么要有这个脚本：`mock-server.mjs` 的其余 fixtures 都是"抓一次、存下来"，
 * 但邻里这四份源数据在 `03-原型/src/utils/api.js` 里是**运行时种子**（PRNG 生成 + 手写补丁），
 * 直接抓 JSON 会漏掉 AC0013–AC0017 与那一批报名。
 *
 * 所以这里把 `_nvSeedItems / _nvSeedReports / _nvSeedActivities / _nvSeedEnrolls` 的
 * 生成逻辑照抄一遍（含 PRNG 种子 20261106 + 68），保证 HTTP 模式与前端 mock 模式
 * **同一份数字**：待审 3 / 待处理 2 / 活动 4 场 / 待成行还差 7 人。
 *
 * 用法：node scripts/gen-neighbor-fixtures.mjs
 * 源文件变了就重跑，别手改 fixtures —— 手改的结果是两边数字对不上，
 * 而"对不上"正是联调时最难查的那类问题。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, '../03-原型/src/mock')
const OUT = path.join(ROOT, 'fixtures')

const readSrc = f => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'))
const write = (name, rows) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(rows, null, 2) + '\n')
  console.log(`  ${name}  ${rows.length} 条`)
}

/* ============================ ① 闲置 ============================ */
const secondhandItems = readSrc('secondhandItems.json')

const items = []
let itemSeq = 0

secondhandItems.forEach(i => {
  items.push({
    ...i,
    status: '已上架',
    sellerType: '业主',
    sellerPhone: i.wechat ? '' : '138****' + String(1000 + (i.views || 0)).slice(-4),
    contactMode: '站内私信',
    auditBy: '物业代发（历史数据）',
    auditAt: i.publishAt,
    expireAt: '',
    reportCount: 0,
    source: '物业代发'
  })
})

/* 待审 / 驳回 / 下架 / 过期 四类各来几条，审核队列才有东西可点 */
const itemSeed = [
  ['宜家儿童书桌（白色）', '家具', 120, 399, 'P01', '陈**', 'P01-012-0302', '九成新', '待审核', '2026-10-21 09:12', '业主'],
  ['小米空气净化器 4', '家电', 260, 899, 'P02', '李**', 'P02-003-1102', '八成新', '待审核', '2026-10-21 08:40', '业主'],
  ['捷安特山地车 26 寸', '其他', 420, 1580, 'P03', '王**', 'P03-005-0701', '七成新', '待审核', '2026-10-20 20:15', '租户'],
  ['全新未拆封 乐高得宝 10874', '母婴', 150, 399, 'P01', '周**', 'P01-007-0403', '全新', '待审核', '2026-10-20 19:02', '业主'],
  ['实木餐椅 4 把（自提）', '家具', 200, 1200, 'P02', '吴**', 'P02-009-0802', '八成新', '待审核', '2026-10-20 16:30', '业主'],
  ['罗技 MX Keys 键盘', '数码', 380, 899, 'P03', '徐**', 'P03-002-1201', '九成新', '待审核', '2026-10-20 14:20', '租户'],
  ['儿童安全座椅 0-4 岁', '母婴', 350, 1299, 'P01', '孙**', 'P01-003-0601', '九成新', '待审核', '2026-10-20 11:05', '业主'],
  ['西门子嵌入式洗碗机（需自拆）', '家电', 600, 6800, 'P02', '马**', 'P02-011-0301', '六成新', '待审核', '2026-10-19 22:41', '业主'],
  ['茅台飞天 53 度 500ml ×2', '其他', 2600, 2999, 'P01', '朱**', 'P01-001-0101', '全新', '已驳回', '2026-10-19 10:30', '业主'],
  ['布偶猫幼崽 2 个月', '其他', 1800, 0, 'P02', '胡**', 'P02-006-0903', '全新', '已驳回', '2026-10-18 15:22', '租户'],
  ['自制药酒（外用）', '其他', 80, 0, 'P03', '郭**', 'P03-008-0502', '全新', '已驳回', '2026-10-18 09:10', '业主'],
  ['某品牌代餐粉（无中文标签）', '其他', 99, 398, 'P01', '何**', 'P01-009-1104', '全新', '已下架', '2026-10-17 13:45', '业主'],
  ['二手笔记本电脑 i5 8G', '数码', 1200, 4999, 'P02', '林**', 'P02-004-0205', '七成新', '已下架', '2026-10-16 18:20', '业主'],
  ['三人位布艺沙发 免费送', '家具', 0, 2600, 'P03', '罗**', 'P03-006-0304', '五成新', '已过期', '2026-09-12 10:00', '业主']
]
itemSeed.forEach((s, i) => {
  itemSeq += 1
  items.push({
    itemId: `SH${String(100 + itemSeq).padStart(4, '0')}`,
    title: s[0], category: s[1], price: s[2], originPrice: s[3],
    communityId: s[4], sellerName: s[5], sellerHouse: s[6], condition: s[7],
    status: s[8], publishAt: s[9], sellerType: s[10],
    images: 2 + (i % 4),
    desc: '自用闲置，功能正常，成色见实拍。小区内自提，介意议价勿扰。',
    sellerPhone: `138****${String(2000 + i * 37).slice(-4)}`,
    contactMode: '站内私信',
    views: 10 + i * 7,
    wants: i % 6,
    auditBy: ['已驳回', '已下架', '已过期'].includes(s[8]) ? '物业服务中心' : '',
    auditAt: ['已驳回', '已下架'].includes(s[8]) ? s[9] : '',
    rejectReason: s[0].includes('茅台') ? '平台禁售酒类，请自行线下处理'
      : s[0].includes('布偶猫') ? '禁止发布活体动物'
        : s[0].includes('药酒') ? '自制药酒属食品/药品，无资质不得发布' : '',
    offlineReason: s[0].includes('代餐') ? '举报核实：无中文标签，涉嫌三无食品'
      : s[0].includes('笔记本') ? '举报核实：无法说明来源' : '',
    expireAt: s[8] === '已过期' ? '2026-10-12' : '',
    reportCount: s[8] === '已下架' ? 3 : 0,
    source: '业主发布'
  })
})

/* ============================ ② 举报 ============================ */
/* 第 4 条故意指向一条**已上架**的内容（SH0008 电钢琴）：
   原型种子里待处理举报全部指向已下架 / 已驳回的内容，那样「下架并警告」这个动作
   在假服务上永远验不出效果 —— 它才是举报处置里唯一会改动别处状态的分支。
   换个 itemId 不动任何数字（待处理仍是 P01 2 / 全公司 4）。 */
const reportSeed = [
  ['SH0109', '违禁品', '这酒是假的吧？物业也不管管，小区里能随便卖酒？', '周**', 'P01-003-0602', '2026-10-20 21:10', '待处理'],
  ['SH0110', '违禁品', '在小区里卖活体宠物，卫生谁负责', '李**', 'P02-002-0801', '2026-10-19 09:30', '待处理'],
  ['SH0112', '虚假信息', '这个代餐粉我买过，吃完拉肚子，包装上全是英文没有中文标签', '陈**', 'P01-009-1105', '2026-10-18 14:02', '待处理'],
  ['SH0008', '疑似诈骗', '卖家要求先付定金再看货，价格低得离谱，怕是骗定金', '王**', 'P02-011-0302', '2026-10-17 11:20', '待处理'],
  ['SH0007', '骚扰辱骂', '私信里骂人，说话很难听', '刘**', 'P01-002-0301', '2026-10-16 19:40', '已处理'],
  ['SH0012', '重复刷屏', '同一个人连发五条一样的', '杨**', 'P02-008-0402', '2026-10-15 08:55', '已处理']
]
const reports = reportSeed.map((s, i) => ({
  reportId: `RP${String(101 + i).padStart(4, '0')}`,
  itemId: s[0], reason: s[1], detail: s[2], reporterName: s[3], reporterHouse: s[4],
  at: s[5], status: s[6],
  action: s[6] === '已处理' ? (s[1] === '骚扰辱骂' ? '仅警告' : '忽略') : '',
  note: s[6] === '已处理' ? '已联系双方，暂不涉及违规内容' : '',
  handledBy: s[6] === '已处理' ? '汪磊' : '',
  handledAt: s[6] === '已处理' ? s[5].replace(/\d{2}:\d{2}$/, '20:30') : ''
}))

/* ============================ ③ 活动 ============================ */
/**
 * 活动的两个维度分开：
 *   - `category`（敬老/亲子/文体/出游/公益）来自数据源，不派生；
 *   - `feeType`（收费/免费）由 `fee > 0` 派生，**不落库** —— 落库就有第二份真相。
 * 2026-11-07 之前这里存的是 `type`，两种含义挤在一个字段里，页面上会出现「亲子 · 收费」。
 */
const withFeeType = a => ({ ...a, feeType: (Number(a.fee) || 0) > 0 ? '收费' : '免费' })

const activities = readSrc('activities.json').map(a => withFeeType({
  ...a,
  enrollDeadline: a.enrollDeadline || String(a.startAt).slice(0, 10),
  minCapacity: 0,
  needInsurance: false,
  attendeeLimit: 3,
  refundPolicy: [],
  createdBy: '汪磊'
}))

/* 收费活动三条 + 公益一条：报名中 / 待成行 / 已成行 三个分支都要有样本 */
const actExtra = [
  {
    activityId: 'AC0013', communityId: 'P02', title: '邻里出游 · 青城前山一日游',
    category: '出游', cover: 3, startAt: '2026-11-15 07:30', endAt: '2026-11-15 18:00',
    place: '青城山前山景区（小区南门集合上车）', capacity: 40, minCapacity: 20, fee: 180,
    enrollDeadline: '2026-11-10', needInsurance: true, attendeeLimit: 4,
    feeInclude: '往返大巴、景区门票、团队午餐、随车导游、旅游意外险',
    feeExclude: '索道、观光车、个人消费',
    refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
    desc: '费用按车费、门票、餐费成本分摊，不构成旅行社业务。出行人需实名，用于购买当日意外险；活动结束后 30 天身份信息自动脱敏。'
  },
  {
    activityId: 'AC0014', communityId: 'P01', title: '秋日露营 · 亲子两天一夜',
    category: '出游', cover: 5, startAt: '2026-11-01 14:00', endAt: '2026-11-02 12:00',
    place: '青龙湖露营地（统一大巴往返）', capacity: 30, minCapacity: 15, fee: 260,
    enrollDeadline: '2026-10-18', needInsurance: true, attendeeLimit: 4,
    feeInclude: '营位、帐篷租赁、两正餐一早餐、往返交通、意外险',
    feeExclude: '睡袋（可自带或现场租 30 元）',
    refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
    desc: '按 15 人成团，不足则全额退款。'
  },
  {
    activityId: 'AC0016', communityId: 'P01', title: '冬日温泉一日游 · 含往返与午餐',
    category: '出游', cover: 4, startAt: '2026-11-28 08:00', endAt: '2026-11-28 19:00',
    place: '花水湾温泉度假区（小区北门集合上车）', capacity: 40, minCapacity: 15, fee: 168,
    enrollDeadline: '2026-11-20', needInsurance: true, attendeeLimit: 4,
    feeInclude: '往返大巴、温泉门票、团队午餐、随车服务、旅游意外险',
    feeExclude: '泳衣租赁、个人消费',
    refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
    desc: '按 15 人成团，不足则全额退款。出行人需实名用于投保。'
  },
  {
    activityId: 'AC0017', communityId: 'P01', title: '社区义诊 · 免费量血压与用药咨询',
    category: '公益', cover: 2, startAt: '2026-10-24 09:00', endAt: '2026-10-24 12:00',
    place: '翡翠城 1 栋架空层', capacity: 40, minCapacity: 10, fee: 0,
    enrollDeadline: '2026-10-16', needInsurance: false, attendeeLimit: 2,
    feeInclude: '', feeExclude: '', refundPolicy: [],
    desc: '社区卫生服务中心进小区，现场量血压、血糖与用药咨询；已达下限，按报名顺序通知。'
  },
  {
    activityId: 'AC0015', communityId: 'P03', title: '亲子农场采摘 · 含午餐',
    category: '出游', cover: 2, startAt: '2026-10-25 09:00', endAt: '2026-10-25 16:00',
    place: '禾田农场（自驾前往，园区东门集合）', capacity: 60, minCapacity: 20, fee: 88,
    enrollDeadline: '2026-10-20', needInsurance: true, attendeeLimit: 5,
    feeInclude: '采摘 2 斤、农场午餐、儿童手作材料',
    feeExclude: '超出 2 斤按 15 元/斤计',
    refundPolicy: [{ days: 3, ratio: 100 }, { days: 0, ratio: 50 }],
    desc: '已达成团人数，按报名顺序确认。'
  }
]
actExtra.forEach(a => {
  activities.push({
    ...withFeeType(a), status: '报名中', organizer: '物业服务中心', views: 0, enrolled: 0, createdBy: '汪磊'
  })
})

/* ============================ ④ 报名 ============================ */
const enrolls = readSrc('activityEnrollments.json').map(e => ({ ...e, source: '业主自助' }))

/* 与原型同一套 PRNG：种子由「批次号 + 1」推出，重跑结果稳定 */
const rng = (seed => {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
})(20261106 + 68)

const SURNAME = ['王', '李', '张', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗']
const GIVEN = ['语桐', '子墨', '思远', '雨桐', '浩然', '若曦', '宇轩', '梓涵', '沐宸', '一诺', '晨曦', '安然']
const person = () => `${SURNAME[Math.floor(rng() * SURNAME.length) % SURNAME.length]}${GIVEN[Math.floor(rng() * GIVEN.length) % GIVEN.length]}`

/* 三条收费活动的报名：让「待成行」差 7 人、「已成行」刚过线，数字能对上 */
const plan = [
  { activityId: 'AC0013', count: 14, day: '2026-10-19' },
  { activityId: 'AC0014', count: 8, day: '2026-10-15' },
  { activityId: 'AC0015', count: 22, day: '2026-10-18' },
  { activityId: 'AC0017', count: 12, day: '2026-10-12' }
]
const units = ['0701', '1102', '0302', '0503', '0901', '0204', '1201', '0802']
let enrollSeq = 0
const actOf = id => activities.find(a => a.activityId === id)

plan.forEach(p => {
  for (let i = 0; i < p.count; i += 1) {
    enrollSeq += 1
    const people = rng() > 0.55 ? 2 : 1
    const attendees = []
    for (let k = 0; k < people; k += 1) {
      attendees.push({
        name: person(),
        idType: '身份证',
        idNo: `5101${String(10 + (i % 80)).padStart(2, '0')}19${80 + (i % 20)}${String(1010 + i).slice(0, 4)}${String(1000 + i * 7).slice(-4)}`.slice(0, 18),
        phone: `138${String(10000000 + i * 137 + k).slice(-8)}`,
        ageType: k === 0 ? '成人' : (rng() > 0.6 ? '儿童' : '成人'),
        emergencyName: person(),
        emergencyPhone: `139${String(20000000 + i * 211).slice(-8)}`
      })
    }
    enrolls.push({
      enrollId: `AE${String(300 + enrollSeq).padStart(4, '0')}`,
      activityId: p.activityId,
      ownerId: `OW${String(100 + i).padStart(5, '0')}`,
      name: attendees[0].name,
      phone: attendees[0].phone,
      houseShort: `${actOf(p.activityId).communityId}-0${(i % 9) + 1}-${units[i % units.length]}`,
      people,
      at: `${p.day} ${String(9 + (i % 9)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
      status: i % 11 === 10 ? '已取消' : '已报名',
      attendees,
      source: i % 5 === 0 ? '前台代报' : '业主自助'
    })
  }
})

/* ============================ ⑤ 投票（意见征询） ============================ */
/**
 * 投票的源数据是 `03/src/mock/surveys.json`（业主端与后台读同一份），但契约里的
 * `totalVotes` **必须由选项票数求和得出**，不能沿用源里的 `totalVotes`：
 * 种子的票数是独立随机生成的，出现过「310 票 / 189 户」，直接拿字段算参与率会 >100%。
 * 所以这里重算一遍；`maxPick` 也补成显式值（单选恒为 1，多选取配置）。
 *
 * 另外两个字段**不进 fixture**：
 *   - `targetHouseholds`（应投户数）由服务端按项目去重业主数现算 —— 存进样例里就会被当成真值抄走；
 *   - `myVote` / `voted` 是"当前登录人"的状态，属于运行时，不属于样例。
 */
const surveys = readSrc('surveys.json')

const votes = surveys.map(s => {
  const options = (s.options || []).map(o => ({
    key: o.key,
    label: o.label,
    votes: Number(o.votes) || 0
  }))
  return {
    surveyId: s.surveyId,
    communityId: s.communityId,
    communityName: s.communityName,
    title: s.title,
    type: s.type,
    desc: s.desc || '',
    startAt: s.startAt,
    endAt: s.endAt,
    status: s.status,
    multi: !!s.multi,
    /* 单选恒 1；多选没配就按 2（与后台 `_nvVoteRow` 同一口径） */
    maxPick: Number(s.maxPick) || (s.multi ? 2 : 1),
    anonymous: s.anonymous !== false,
    resultVisibility: s.resultVisibility || '投票后可见',
    options,
    totalVotes: options.reduce((n, o) => n + o.votes, 0)
  }
})

console.log('生成邻里 fixtures：')
write('neighbor-items.json', items)
write('neighbor-reports.json', reports)
write('neighbor-activities.json', activities)
write('neighbor-enrolls.json', enrolls)
write('neighbor-votes.json', votes)

/* 自检：三个数字必须与前端 mock 模式一致，不一致说明原型种子又变了 */
const p01Pending = items.filter(i => i.communityId === 'P01' && i.status === '待审核').length
const p01Reports = reports.filter(r => r.status === '待处理'
  && (items.find(i => i.itemId === r.itemId) || {}).communityId === 'P01').length
const p01Acts = activities.filter(a => a.communityId === 'P01').length
const a14 = enrolls.filter(e => e.activityId === 'AC0014' && !['已取消', '已退款'].includes(e.status))
  .reduce((s, e) => s + e.people, 0)
/* 投票：票数合计必须等于选项之和，否则业主端参与率会超 100% */
const voteSumOk = votes.every(v => v.totalVotes === v.options.reduce((n, o) => n + o.votes, 0))
const multiCount = votes.filter(v => v.multi).length
console.log(`\n自检：P01 待审 ${p01Pending}（应 3）· 待处理 ${p01Reports}（应 2）· 活动 ${p01Acts} 场 · AC0014 已报 ${a14}（应 8）`)
console.log(`投票：${votes.length} 条 · 多选 ${multiCount} 条 · 票数合计自洽 ${voteSumOk ? '是' : '否'}`)
