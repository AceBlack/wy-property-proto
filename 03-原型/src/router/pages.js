// 原型页面总清单（唯一数据源：菜单、面包屑、路由三处共用）
// status: 'done' 已实现并注册路由 | 'todo' 已规划未实现（菜单置灰提示）
// 新增页面：在此追加一条并把 status 改为 'done' 即可，无需改 router/index.js

// 域的划分口径（与 01-功能盘点 一致）：
//   C 办公协同 = 内部管理类：工作台/审批/考勤/行政/采购/人力，特征是「后台 · 表单 · 审批流」
//   F 现场运营 = 一线交付类：工单派单/巡检执行/品质监督，特征是「任务驱动 · 移动协同 · 结果影响服务质量」
export const GROUPS = [
  { key: 'shell', name: '原型框架', icon: 'Files', desc: 'L1 骨架与四类页面模板' },
  { key: 'a', name: 'A · 资产', icon: 'House', desc: '人 · 车 · 房' },
  { key: 'b', name: 'B · 费用', icon: 'Wallet', desc: '物业运营收费' },
  // N 邻里（2026-11-06 第 68 批）：业主端「邻里」入口的后台一侧，只做发布 / 审核 / 看数。
  // 单独成域而不是塞进 C 办公协同：C 是「内部管理」，邻里是「面向业主的运营」，评价口径不同。
  { key: 'n', name: 'N · 邻里', icon: 'ChatDotRound', desc: '公告 · 投票 · 活动 · 闲置审核' },
  { key: 'c', name: 'C · 办公协同', icon: 'OfficeBuilding', desc: 'OA 审批 · 考勤 · 人力' },
  { key: 'f', name: 'F · 现场运营', icon: 'Compass', desc: '工单 · 巡检 · 品质' },
  { key: 'd', name: 'D · 物联', icon: 'Cpu', desc: '门禁 · 车行 · 监控' },
  { key: 'e', name: 'E · 平台底座', icon: 'Setting', desc: '组织 · 权限 · 字典 · 日志' }
]

export const PAGES = [
  // ---------- Shell ----------
  { path: '/shell/list', name: 'TplList', title: '列表页模板', group: 'shell', status: 'done', icon: 'Tickets',
    desc: '筛选区 + 工具栏 + 表格 + 分页的标准页型',
    component: () => import('@/views/shell/TplList.vue') },
  { path: '/shell/form', name: 'TplForm', title: '表单页模板', group: 'shell', status: 'done', icon: 'EditPen',
    desc: '分区表单 + 校验 + 底部操作栏的标准页型',
    component: () => import('@/views/shell/TplForm.vue') },
  { path: '/shell/detail', name: 'TplDetail', title: '详情页模板', group: 'shell', status: 'done', icon: 'Document',
    desc: '概要头 + 分区描述 + 子表 + 时间线的标准页型',
    component: () => import('@/views/shell/TplDetail.vue') },
  { path: '/shell/board', name: 'TplBoard', title: '看板页模板', group: 'shell', status: 'done', icon: 'DataAnalysis',
    desc: 'KPI 行 + 图表栅格 + 排行列表的标准页型',
    component: () => import('@/views/shell/TplBoard.vue') },
  { path: '/shell/states', name: 'States', title: '异常态与边界规范', group: 'shell', status: 'done', icon: 'WarningFilled',
    desc: '九类异常分支的文案与载体，含真实注入演示',
    component: () => import('@/views/shell/States.vue') },

  // ---------- A 资产 ----------
  { path: '/a/dashboard', name: 'AssetDashboard', title: '资产驾驶舱', group: 'a', status: 'done', icon: 'DataAnalysis', desc: '房/车/人全景指标与结构分析',
    component: () => import('@/views/a/AssetDashboard.vue') },
  { path: '/a/owner360', name: 'Owner360', title: '业主 360 档案', group: 'a', status: 'done', icon: 'User', desc: '一人多房聚合档案与关联业务',
    component: () => import('@/views/a/Owner360.vue') },
  // 2026-11-02：业主标签字典（楼管打标签、平台维护词条）。权限位在 e 域：e.ownerTags.view/edit
  { path: '/a/owner-tags', name: 'OwnerTag', title: '业主标签', group: 'a', status: 'done', icon: 'CollectionTag', desc: '标签词条维护 · 使用人数 · 启停',
    component: () => import('@/views/a/OwnerTag.vue') },
  // 注：原「车位车牌绑定」/a/parking 已并入 /a/vehicles（见 LEGACY），车牌换绑移入车位详情抽屉
  // ---------- L4 批量生成（第一批：四类列表页，全部继承 shell 模板） ----------
  { path: '/a/owners', name: 'OwnerList', title: '业主档案', group: 'a', status: 'done', icon: 'User', desc: '业主台账 · 认证 · 名下资产',
    component: () => import('@/views/a/OwnerList.vue') },
  // ---------- L4 第二批（21–28 页，数据齐全的实体全部列表化） ----------
  { path: '/a/houses', name: 'HouseLedger', title: '房屋台账', group: 'a', status: 'done', icon: 'OfficeBuilding', desc: '房号 · 户型 · 用途 · 欠费',
    component: () => import('@/views/a/HouseLedger.vue') },
  // 楼栋责任范围：楼管按范围看业主资料与催缴，项目经理负责配置与移交（2026-10-29）
  { path: '/a/stewards', name: 'Stewards', title: '楼栋责任范围', group: 'a', status: 'done', icon: 'UserFilled', desc: '楼管分配 · 一栋多楼管 · 责任移交',
    component: () => import('@/views/a/Stewards.vue') },
  { path: '/a/vehicles', name: 'VehicleList', title: '车位与车辆', group: 'a', status: 'done', icon: 'Van', desc: '车位台账 · 车辆 · 闲置车位 · 授权',
    component: () => import('@/views/a/VehicleList.vue') },
  // ---------- L4 收尾（29–32 页，数据与 IA 骨架齐备后补齐） ----------
  { path: '/a/tenants', name: 'TenantList', title: '租户管理', group: 'a', status: 'done', icon: 'Avatar', desc: '在住租户 · 核验 · 补充 · 搬离',
    component: () => import('@/views/a/TenantList.vue') },
  // 人脸核验（H4/H5 · 2026-11-10）：业主本人 / 家庭成员 / 租客同一个工作台。
  // 以前「已录人脸」是业主表单里的开关，勾一下就生效 —— 那等于物业替业主担保。
  { path: '/a/faces', name: 'FaceAudit', title: '人脸核验', group: 'a', status: 'done', icon: 'Camera', desc: '业主 · 家庭成员 · 租客 · 通过 / 驳回',
    component: () => import('@/views/a/FaceAudit.vue') },
  // 租售信息（2026-11-06 第 69 批）：业主自己发、责任楼管审、访客留电话。
  // 后台**没有「新建」**——挂牌只能由业主发起。留了编辑入口，最后一定变成"客服帮业主改价格"。
  { path: '/a/listings', name: 'ListingList', title: '租售信息', group: 'a', status: 'done', icon: 'Sell',
    desc: '业主发布 · 责任楼管审核 · 面积户型从档案带',
    component: () => import('@/views/a/ListingList.vue') },
  // 独立路径而不是 /a/listings/viewings：后者会让侧栏两项同时高亮（前缀匹配）
  { path: '/a/viewings', name: 'ViewingList', title: '看房请求', group: 'a', status: 'done', icon: 'Phone',
    desc: '访客留电话 · 楼管回拨 · 超 24 小时标红',
    component: () => import('@/views/a/ViewingList.vue') },

  // ---------- B 费用 ----------
  { path: '/b/dashboard', name: 'FeeDashboard', title: '费用驾驶舱', group: 'b', status: 'done', icon: 'DataAnalysis', desc: '应收/实收/欠费/收缴率',
    component: () => import('@/views/b/FeeDashboard.vue') },
  // 多种经营收入 = 商业服务（收费工单）+ 商业合作（经营性合同），与主营业务并列的一大类公司收入
  { path: '/b/multi-revenue', name: 'MultiRevenue', title: '多种经营收入', group: 'b', status: 'done', icon: 'TrendCharts',
    desc: '商业服务 · 商业合作 · 公共收益 · 结构占比',
    component: () => import('@/views/b/MultiRevenue.vue') },
  { path: '/b/cashier', name: 'Cashier', title: 'PC 收银台', group: 'b', status: 'done', icon: 'Money', desc: '按业主聚合的一人多房合并收费',
    component: () => import('@/views/b/Cashier.vue') },
  { path: '/b/bills', name: 'BillList', title: '账单查询', group: 'b', status: 'done', icon: 'Tickets', desc: '账期 · 科目 · 收缴状态 · 缴费流水',
    component: () => import('@/views/b/BillList.vue') },
  // 收费日结（2026-10-30）：现金实点轧账 + 退款冲红核对，一天只能结一次
  { path: '/b/daily-close', name: 'DailyClose', title: '收费日结', group: 'b', status: 'done', icon: 'Wallet',
    desc: '现金实点 · 退款冲红 · 一天一笔账', component: () => import('@/views/b/DailyClose.vue') },
  { path: '/b/month-close', name: 'MonthClose', title: '收费月结', group: 'b', status: 'done', icon: 'Calendar',
    desc: '账面封账 · 试算转定稿 · 一月一笔账', component: () => import('@/views/b/MonthClose.vue') },
  { path: '/b/payments', name: 'PaymentList', title: '缴费流水', group: 'b', status: 'done', icon: 'Money', desc: '收款流水 · 渠道 · 开票 · 退款',
    component: () => import('@/views/b/PaymentList.vue') },
  { path: '/b/fee-items', name: 'FeeItemList', title: '收费科目', group: 'b', status: 'done', icon: 'PriceTag', desc: '科目 · 单价 · 计费方式 · 收缴率',
    component: () => import('@/views/b/FeeItemList.vue') },
  { path: '/b/collection', name: 'Collection', title: '欠费催缴工作台', group: 'b', status: 'done', icon: 'Promotion', desc: '欠费池 · 生成催缴单 · 催缴历史',
    component: () => import('@/views/b/Collection.vue') },
  { path: '/b/invoices', name: 'Invoice', title: '发票与收据', group: 'b', status: 'done', icon: 'Printer', desc: '票据台账 · 批量开票 · 红冲',
    component: () => import('@/views/b/Invoice.vue') },
  // 开票设置（2026-11-06）：抬头档案 / 费用项目 / 票据模板。
  // 这三样是开票时反复要填的东西，收到字典里才不用每次手打；
  // 与「发票与收据」分开：那边是开票动作，这边是开票前的口径。
  { path: '/b/invoice-settings', name: 'InvoiceSettings', title: '开票设置', group: 'b', status: 'done', icon: 'Setting',
    desc: '开票信息 · 费用项目 · 票据模板与套打参数',
    component: () => import('@/views/b/InvoiceSettings.vue') },
  // 临时收费（2026-11-06 第 63 批）：摆摊费、场地租用这类与业务无关的收费。
  // 独立成台账而不是并进账单：**不进收缴率**（收缴率是应收 vs 实收，它没有应收），
  // 但要计入营业收入，所以要有一个能按科目汇总的地方。
  { path: '/b/temp-charges', name: 'TempChargeList', title: '临时收费', group: 'b', status: 'done', icon: 'Yen',
    desc: '摆摊费 · 场地租用等非业务收费（计入收入、不计收缴率）',
    component: () => import('@/views/b/TempChargeList.vue') },
  { path: '/b/deposits', name: 'DepositList', title: '装修押金台账', group: 'b', status: 'done', icon: 'CreditCard', desc: '收取 · 验收 · 退款扣款全流程',
    component: () => import('@/views/b/DepositList.vue') },
  { path: '/b/meters', name: 'Meter', title: '抄表与公摊', group: 'b', status: 'done', icon: 'Odometer', desc: '抄表录入 · 用量复核 · 公摊分摊',
    component: () => import('@/views/b/Meter.vue') },
  { path: '/b/prepay', name: 'Prepay', title: '预存与抵扣', group: 'b', status: 'done', icon: 'Wallet', desc: '预存账户 · 充值 · 余额抵扣账单',
    component: () => import('@/views/b/Prepay.vue') },

  // ---------- N 邻里（业主端「邻里」的后台一侧） ----------
  /* 2026-11-06 第 68 批。四条频道：公告 / 投票 / 活动 / 闲置，外加举报处理。
     公告不在这里另开页面 —— 复用 C 域「公告通知」（同一张表），
     否则运营要在两处发同一条通知、阅读数还对不上。工作台里给一个跳转入口。
     不做话题广场与跟帖：属【社交-社区/论坛】类目，要常态化内容审核，物业没有这个编制。 */
  { path: '/n/workbench', name: 'NeighborWorkbench', title: '邻里运营', group: 'n', status: 'done', icon: 'Monitor',
    desc: '待办 · 阅读与参与 · 成团预警',
    component: () => import('@/views/n/NeighborWorkbench.vue') },
  { path: '/n/votes', name: 'VoteManage', title: '投票管理', group: 'n', status: 'done', icon: 'Histogram',
    desc: '意见征询 · 参与率 · 结果分布（不做业主大会表决）',
    component: () => import('@/views/n/VoteManage.vue') },
  { path: '/n/activities', name: 'ActivityManage', title: '活动管理', group: 'n', status: 'done', icon: 'Ticket',
    desc: '类别 × 收费方式 · 成团下限 · 退款分档',
    component: () => import('@/views/n/ActivityManage.vue') },
  { path: '/n/activities/:id/enrolls', name: 'ActivityEnrolls', title: '报名名单', group: 'n', status: 'done', icon: 'List', hidden: true,
    desc: '出行人 · 代报名 · 退款 · 签到',
    component: () => import('@/views/n/ActivityEnrolls.vue') },
  // 闲置审核：先审后发。这是全站唯一的 UGC 源，队列要能一眼看完「图 + 文 + 发布人」
  { path: '/n/items', name: 'ItemAudit', title: '闲置审核', group: 'n', status: 'done', icon: 'Goods',
    desc: '待审队列 · 通过 / 驳回 · 已上架下架',
    component: () => import('@/views/n/ItemAudit.vue') },
  { path: '/n/reports', name: 'ReportList', title: '举报处理', group: 'n', status: 'done', icon: 'Warning',
    desc: '业主举报 · 下架并警告 · 处理留痕',
    component: () => import('@/views/n/ReportList.vue') },

  // ---------- C 办公协同（内部管理：OA / 考勤 / 人力） ----------
  { path: '/c/workbench', name: 'Workbench', title: '办公工作台', group: 'c', status: 'done', icon: 'Monitor', desc: '待办 · 审批 · 考勤 · 公告',
    component: () => import('@/views/c/Workbench.vue') },
  { path: '/c/todo', name: 'Todo', title: '待办中心', group: 'c', status: 'done', icon: 'List', desc: '六类待办聚合 · 审批单 · 处理入口',
    component: () => import('@/views/c/Todo.vue') },
  // 2026-11-03：OA 审批底座 —— 六类单据共用一套引擎，表单配置驱动
  { path: '/c/oa-apply', name: 'OaApply', title: '发起申请', group: 'c', status: 'done', icon: 'Promotion',
    desc: '用车 · 报销 · 请假 · 加班 · 用印 · 采购',
    component: () => import('@/views/c/OaApply.vue') },
  { path: '/c/oa-mine', name: 'OaMine', title: '我的申请', group: 'c', status: 'done', icon: 'Files',
    desc: '我提交的单 · 进度 · 撤回',
    component: () => import('@/views/c/OaMine.vue') },
  { path: '/c/attendance', name: 'Attendance', title: '考勤管理', group: 'c', status: 'done', icon: 'Clock', desc: '月考勤 · 排班 · 异常申诉',
    component: () => import('@/views/c/Attendance.vue') },
  { path: '/c/approval/:id', name: 'ApprovalDetail', title: '审批处理', group: 'c', status: 'done', icon: 'Stamp', hidden: true,
    desc: '同意 / 驳回 / 转办 / 加签 + 流程时间线', component: () => import('@/views/c/ApprovalDetail.vue') },
  // 通讯录（2026-11-06 第 66 批）：所有在职同事的联系方式，只读。
  // 与员工档案分开：档案里有薪资/证件/紧急联系人，通讯录只有"怎么联系到人"。
  { path: '/c/contacts', name: 'Contacts', title: '通讯录', group: 'c', status: 'done', icon: 'Phone',
    desc: '按部门找人 · 姓名/岗位/手机搜索 · 一键复制与拨打',
    component: () => import('@/views/c/Contacts.vue') },
  { path: '/c/employee', name: 'Employee', title: '员工档案', group: 'c', status: 'done', icon: 'UserFilled', desc: '档案 · 合同 · 证照 · 异动',
    component: () => import('@/views/c/Employee.vue') },
  /* ---------- 办公资产（2026-11-04 第 58 批）----------
     与 D 域「设备台账」并列但不同源：那边是门禁/摄像头这类 IoT 设备（看"在不在线"），
     这里是电脑/桌椅/工具这类可被个人领用的办公物品（看"值多少、在哪个部门"）。 */
  { path: '/c/assets', name: 'AssetList', title: '资产台账', group: 'c', status: 'done', icon: 'Box',
    desc: '办公资产 · 分类 · 二维码标签',
    component: () => import('@/views/c/AssetList.vue') },
  { path: '/c/assets/new', name: 'AssetNew', title: '新增资产', group: 'c', status: 'done', icon: 'Plus', hidden: true,
    desc: '录入办公资产 · 保存后生成编号', component: () => import('@/views/c/AssetForm.vue') },
  { path: '/c/assets/:id/edit', name: 'AssetEdit', title: '编辑资产', group: 'c', status: 'done', icon: 'EditPen', hidden: true,
    desc: '修改资产 · 变更留痕', component: () => import('@/views/c/AssetForm.vue') },
  { path: '/c/assets/:id', name: 'AssetDetail', title: '资产详情', group: 'c', status: 'done', icon: 'Document', hidden: true,
    desc: '基本信息 · 变更记录 · 二维码', component: () => import('@/views/c/AssetDetail.vue') },
  { path: '/c/asset-categories', name: 'AssetCategory', title: '资产分类', group: 'c', status: 'done', icon: 'Files',
    desc: '两级分类 · 启停用 · 删除保护',
    component: () => import('@/views/c/AssetCategory.vue') },
  { path: '/c/payroll', name: 'Payroll', title: '工资表', group: 'c', status: 'done', icon: 'Coin', desc: '薪酬构成 · 月度核算 · 发放',
    component: () => import('@/views/c/Payroll.vue') },
  { path: '/c/contracts', name: 'ContractList', title: '合同管理', group: 'c', status: 'done', icon: 'Document', desc: '五类合同统一台账 · 到期 · 审批',
    component: () => import('@/views/c/ContractList.vue') },
  { path: '/c/notices', name: 'NoticeList', title: '公告通知', group: 'c', status: 'done', icon: 'Bell', desc: '发布 · 审核 · 触达率 · 补推',
    component: () => import('@/views/c/NoticeList.vue') },
  // ---------- F 现场运营（一线交付：工单 / 巡检 / 品质） ----------
  { path: '/f/wo-detail', name: 'WorkOrderDetail', title: '报修工单详情与派单', group: 'f', status: 'done', icon: 'Tools', desc: '五段流程 · 三种派单模式',
    component: () => import('@/views/f/WorkOrderDetail.vue') },
  { path: '/f/workorders', name: 'WorkOrderList', title: '工单列表', group: 'f', status: 'done', icon: 'List', desc: '全量工单 · 状态筛选 · 超时标记',
    component: () => import('@/views/f/WorkOrderList.vue') },
  // 商业服务项目 = 工单收费的价目字典（入户维修拆出来后的项目目录，可单独维护）
  { path: '/f/service-items', name: 'ServiceItemList', title: '商业服务项目', group: 'f', status: 'done', icon: 'PriceTag', desc: '项目分类 · 服务价格 · 成本价 · 启停',
    component: () => import('@/views/f/ServiceItemList.vue') },
  { path: '/f/inspect-plans', name: 'InspectPlanList', title: '巡检计划', group: 'f', status: 'done', icon: 'Calendar', desc: '周期计划 · 模板 · 生成任务',
    component: () => import('@/views/f/InspectPlanList.vue') },
  // 模板是公司级标准：品质督导配置，其他人只读（编辑按钮按 f.inspectTemplates.edit 控制）
  { path: '/f/inspect-templates', name: 'InspectTemplateList', title: '巡检模板', group: 'f', status: 'done', icon: 'Document', desc: '执行 / 监督两类模板 · 检查项配置',
    component: () => import('@/views/f/InspectTemplateList.vue') },
  { path: '/f/inspect-tasks', name: 'InspectTaskList', title: '巡检任务列表', group: 'f', status: 'done', icon: 'Finished', desc: '全量任务 · 异常项 · 转单',
    component: () => import('@/views/f/InspectTaskList.vue') },
  // 巡检任务执行属移动端：后台只做监管（任务列表 / 报表 / 模板与计划配置），
  // 此处 hidden 保留路由，供产品与设计预览执行页形态，不进后台菜单。
  { path: '/f/inspect', name: 'InspectExec', title: '巡检任务执行（移动端）', group: 'f', status: 'done', icon: 'Aim',
    hidden: true, mobile: true, desc: '移动端作业台 · 三类执行载体 · 异常一键转单',
    component: () => import('@/views/f/InspectExec.vue') },
  { path: '/f/quality', name: 'QualityScore', title: '品质检查评分卡', group: 'f', status: 'done', icon: 'Star', desc: '评分卡 · 扣分档位 · 整改闭环',
    component: () => import('@/views/f/QualityScore.vue') },
  // 品质评价：按部门 × 周期聚合巡检数据 → 打分 → 生成品质记录（品质督导专属）
  { path: '/f/quality-eval', name: 'QualityEval', title: '品质评价', group: 'f', status: 'done', icon: 'Medal', desc: '部门达标率 · 按周期评价 · 生成记录',
    component: () => import('@/views/f/QualityEval.vue') },
  { path: '/f/quality-records', name: 'QualityRecordList', title: '品质检查记录', group: 'f', status: 'done', icon: 'Tickets', desc: '检查台账 · 整改闭环 · 复查',
    component: () => import('@/views/f/QualityRecordList.vue') },
  // 整改闭环：开单 → 整改 → 复核 → 闭环，评价不合格自动开单（P3）
  { path: '/f/rectify', name: 'RectifyList', title: '整改闭环', group: 'f', status: 'done', icon: 'CircleCheck', desc: '开单 · 整改 · 复核 · 超期预警',
    component: () => import('@/views/f/RectifyList.vue') },
  // 主管发现问题数：独立考核报表（监督任务的检出量、冲突、主动发现率）
  { path: '/f/sup-finding', name: 'SupFindingReport', title: '主管发现问题数', group: 'f', status: 'done', icon: 'TrendCharts', desc: '监督任务 · 检出量 · 申报冲突',
    component: () => import('@/views/f/SupFindingReport.vue') },
  // 部门计划管理（2026-11-03 第 51 批）：提报 → 审批 → 执行 → 结案评分
  // 一个部门一个月一份计划，各项权重合计必须正好 100%（提报人填、审核可调）；
  // 评分**不并入**品质评价、也不接工资核算
  { path: '/f/plans', name: 'PlanList', title: '部门计划', group: 'f', status: 'done', icon: 'Calendar', desc: '月度计划 · 提报审批 · 执行进度 · 结案评分',
    component: () => import('@/views/f/PlanList.vue') },
  // 计划模板：考核项的唯一源。五套（项目经理 + 四班组 + 职能兜底），权重两段合计必须 100%
  { path: '/f/plan-templates', name: 'PlanTemplateList', title: '计划模板', group: 'f', status: 'done', icon: 'Files', desc: '五套模板 · 条目与权重 · 自动匹配',
    component: () => import('@/views/f/PlanTemplateList.vue') },
  // ---------- D 物联 ----------
  { path: '/d/dashboard', name: 'IotDashboard', title: '物联驾驶舱', group: 'd', status: 'done', icon: 'Odometer', desc: '设备在线率 · 告警 · 通行',
    component: () => import('@/views/d/IotDashboard.vue') },
  { path: '/d/devices', name: 'DeviceList', title: '设备台账', group: 'd', status: 'done', icon: 'Cpu', desc: '设备档案 · 维保到期 · 关联告警',
    component: () => import('@/views/d/DeviceList.vue') },
  { path: '/d/alarms', name: 'AlarmCenter', title: '告警中心', group: 'd', status: 'done', icon: 'Warning', desc: '告警等级 · 类型 · 处理 · 转单',
    component: () => import('@/views/d/AlarmCenter.vue') },
  { path: '/d/pass-records', name: 'PassRecordList', title: '通行记录', group: 'd', status: 'done', icon: 'Guide', desc: '车行流水 · 道闸 · 识别方式',
    component: () => import('@/views/d/PassRecordList.vue') },
  // ---------- E 平台底座 ----------
  // 模型已拍板（2026-10-22）：纯 RBAC（人 → 角色 → 权限）+ 项目级数据权限六档（2026-10-29 增「责任范围」）；
  // 单页三 Tab（成员 / 角色权限 / 数据权限），左侧树随 Tab 切换为 组织树 / 角色树 / 数据范围树。
  { path: '/e/perm-log', name: 'PermLog', title: '权限变更日志', group: 'e', status: 'done', icon: 'Document',
    desc: '谁在什么时候给哪个角色加了什么权限 · 记 diff 不记动作 · 只增不删',
    component: () => import('@/views/e/PermLog.vue') },
  { path: '/e/org', name: 'Org', title: '组织与权限', group: 'e', status: 'done', icon: 'Share', desc: '组织架构 · 角色 · 数据权限',
    component: () => import('@/views/e/Org.vue') },
  // 2026-11-03：审批流配置（6 类 OA + 合同审批），改完只影响新单
  { path: '/e/flow-config', name: 'FlowConfig', title: '审批流配置', group: 'e', status: 'done', icon: 'Connection',
    desc: '节点 · 审批人来源 · 金额分支', component: () => import('@/views/e/FlowConfig.vue') },
  { path: '/e/reports', name: 'Reports', title: '报表中心', group: 'e', status: 'done', icon: 'Tickets',
    desc: '八张报表统一入口 · 明细可导出', component: () => import('@/views/e/Reports.vue') },
  { path: '/e/reports/:code', name: 'ReportView', title: '报表明细', group: 'e', status: 'done', icon: 'Document', hidden: true,
    desc: '配置驱动的通用报表页', component: () => import('@/views/e/ReportView.vue') },
  { path: '/e/downloads', name: 'Downloads', title: '下载中心', group: 'e', status: 'done', icon: 'Download',
    desc: '全站导出的唯一出口 · 异步任务 · 24 小时有效', component: () => import('@/views/e/Downloads.vue') },
  // 数据安全（2026-10-29）：敏感字段查看与导出留痕，只增不删
  { path: '/e/access-log', name: 'AccessLog', title: '数据访问日志', group: 'e', status: 'done', icon: 'Lock',
    desc: '敏感字段查看 · 导出留痕 · 越权拦截', component: () => import('@/views/e/AccessLog.vue') },
  // 口径自检（2026-10-30）：不变量红绿灯，开发阶段可直接搬成后端单测
  { path: '/e/audit', name: 'Audit', title: '口径自检', group: 'e', status: 'done', icon: 'CircleCheck',
    desc: '金额自洽 · 枚举 · 外键 · 权限 · 敏感字段', component: () => import('@/views/e/Audit.vue') },
  { path: '/e/config', name: 'Config', title: '系统配置', group: 'e', status: 'done', icon: 'Setting', desc: '字典管理 · 参数设置 · 操作日志',
    component: () => import('@/views/e/Config.vue') },
  { path: '/e/import', name: 'ImportWizard', title: '导入向导', group: 'e', status: 'done', icon: 'Upload', desc: '三步向导 · 模板下载 · 校验回显',
    component: () => import('@/views/e/ImportWizard.vue') },  // ---------- 表单页（hidden：注册路由但不进侧栏菜单）----------
  // 新增与编辑共用同一组件，靠 route.params.id 区分模式：
  //   /a/owners/new          → 新增      /a/owners/:id/edit → 编辑
  // 菜单高亮走 AppSidebar 的前缀匹配，停在表单页时仍高亮所属列表页
  { path: '/a/owners/new', name: 'OwnerNew', title: '新增业主', group: 'a', status: 'done', icon: 'User', hidden: true,
    desc: '业主建档 · 校验 · 关联资产', component: () => import('@/views/a/OwnerForm.vue') },
  { path: '/a/owners/:id/edit', name: 'OwnerEdit', title: '编辑业主', group: 'a', status: 'done', icon: 'User', hidden: true,
    desc: '业主信息回填与修改', component: () => import('@/views/a/OwnerForm.vue') },
  { path: '/a/houses/new', name: 'HouseNew', title: '新增房屋', group: 'a', status: 'done', icon: 'OfficeBuilding', hidden: true,
    desc: '房屋建档 · 房号唯一性校验', component: () => import('@/views/a/HouseForm.vue') },
  { path: '/a/houses/:id/edit', name: 'HouseEdit', title: '编辑房屋', group: 'a', status: 'done', icon: 'OfficeBuilding', hidden: true,
    desc: '房屋信息回填与修改', component: () => import('@/views/a/HouseForm.vue') },
  { path: '/a/tenants/new', name: 'TenantNew', title: '代业主登记租户', group: 'a', status: 'done', icon: 'Avatar', hidden: true,
    desc: '前台代录 · 记「物业补录 · 待核验」', component: () => import('@/views/a/TenantForm.vue') },
  { path: '/a/tenants/:id/edit', name: 'TenantEdit', title: '编辑住户信息', group: 'a', status: 'done', icon: 'Avatar', hidden: true,
    desc: '物业补充 / 修正 · 保存即生效', component: () => import('@/views/a/TenantForm.vue') },
  { path: '/c/contracts/new', name: 'ContractNew', title: '新建合同', group: 'c', status: 'done', icon: 'Document', hidden: true,
    desc: '五类合同建档 · 期限校验', component: () => import('@/views/c/ContractForm.vue') },
  { path: '/c/contracts/:id/edit', name: 'ContractEdit', title: '编辑合同', group: 'c', status: 'done', icon: 'Document', hidden: true,
    desc: '合同变更 · 终止 · 续签', component: () => import('@/views/c/ContractForm.vue') },
  { path: '/b/fee-items/new', name: 'FeeItemNew', title: '新增科目', group: 'b', status: 'done', icon: 'PriceTag', hidden: true,
    desc: '收费科目建档 · 单价与计费方式', component: () => import('@/views/b/FeeItemForm.vue') },
  { path: '/b/fee-items/:id/edit', name: 'FeeItemEdit', title: '编辑科目', group: 'b', status: 'done', icon: 'PriceTag', hidden: true,
    desc: '科目调价与启停', component: () => import('@/views/b/FeeItemForm.vue') },
  { path: '/a/vehicles/new', name: 'VehicleNew', title: '新增车辆', group: 'a', status: 'done', icon: 'Van', hidden: true,
    desc: '车辆建档 · 车牌校验 · 绑定车位', component: () => import('@/views/a/VehicleForm.vue') },
  { path: '/d/devices/new', name: 'DeviceNew', title: '新增设备', group: 'd', status: 'done', icon: 'Cpu', hidden: true,
    desc: '设备建档 · 维保周期', component: () => import('@/views/d/DeviceForm.vue') },
  { path: '/f/inspect-plans/new', name: 'InspectPlanNew', title: '新建巡检计划', group: 'f', status: 'done', icon: 'Calendar', hidden: true,
    desc: '计划建档 · 模板 · 周期 · 执行人', component: () => import('@/views/f/InspectPlanForm.vue') },
  { path: '/f/inspect-plans/:id/edit', name: 'InspectPlanEdit', title: '编辑巡检计划', group: 'f', status: 'done', icon: 'Calendar', hidden: true,
    desc: '计划周期 · 执行人 · 启停', component: () => import('@/views/f/InspectPlanForm.vue') },
  { path: '/d/devices/:id/edit', name: 'DeviceEdit', title: '编辑设备', group: 'd', status: 'done', icon: 'Cpu', hidden: true,
    desc: '设备档案回填与修改 · 维保周期', component: () => import('@/views/d/DeviceForm.vue') },
  { path: '/f/workorders/new', name: 'WorkOrderNew', title: '发起工单', group: 'f', status: 'done', icon: 'Plus', hidden: true,
    desc: '客服代客报事 · 优先级与 SLA', component: () => import('@/views/f/WorkOrderForm.vue') },
  { path: '/b/deposits/new', name: 'DepositNew', title: '登记装修押金', group: 'b', status: 'done', icon: 'CreditCard', hidden: true,
    desc: '押金收取 · 工期校验', component: () => import('@/views/b/DepositForm.vue') },
  // 部门计划：提报表单与详情（详情用 :id 承接，编辑走 /edit）
  { path: '/f/plans/new', name: 'PlanNew', title: '提报月度计划', group: 'f', status: 'done', icon: 'Calendar', hidden: true,
    desc: '选提报部门 · 任务明细 · 各项权重合计须为 100%', component: () => import('@/views/f/PlanForm.vue') },
  { path: '/f/plans/:id', name: 'PlanDetail', title: '计划详情', group: 'f', status: 'done', icon: 'Calendar', hidden: true,
    desc: '任务执行 · 审批轨迹 · 结案评分', component: () => import('@/views/f/PlanDetail.vue') },
  { path: '/f/plans/:id/edit', name: 'PlanEdit', title: '编辑月度计划', group: 'f', status: 'done', icon: 'Calendar', hidden: true,
    desc: '改任务与权重 · 重新提报', component: () => import('@/views/f/PlanForm.vue') },

  // ---------- 全局错误页（403 / 404 / 500）----------
  { path: '/error/403', name: 'Err403', title: '无权限', group: 'shell', status: 'done', icon: 'Lock', hidden: true,
    desc: '无访问权限落地页', component: () => import('@/views/shell/ErrorPage.vue') },
  { path: '/error/404', name: 'Err404', title: '页面不存在', group: 'shell', status: 'done', icon: 'Warning', hidden: true,
    desc: '地址不存在落地页', component: () => import('@/views/shell/ErrorPage.vue') },
  { path: '/error/500', name: 'Err500', title: '服务异常', group: 'shell', status: 'done', icon: 'CircleClose', hidden: true,
    desc: '服务异常落地页', component: () => import('@/views/shell/ErrorPage.vue') }
]

// 域拆分后的旧路径兼容：C 域拆为「办公协同 / 现场运营」时，三个现场类页面迁到 /f/*
// 保留旧地址跳转，避免此前分享出去的书签/演示脚本失效（可随时整体删除）
export const LEGACY = [
  { from: '/c/wo-detail', to: '/f/wo-detail' },
  { from: '/c/inspect', to: '/f/inspect' },
  { from: '/c/quality', to: '/f/quality' },
  // 车位车牌绑定 → 车位与车辆（原 07 页合并进 26 页，旧链接带 focus / vf 参数仍可落地）
  { from: '/a/parking', to: '/a/vehicles' }
]

export const HOME = '/shell/list'

export function pageOf(path) {
  return PAGES.find(p => p.path === path)
}
export function groupOf(key) {
  return GROUPS.find(g => g.key === key)
}
