// 业务状态字典：状态值 → 标签语义（primary/success/warning/danger/info/muted）
// 统一在此维护，页面禁止各写一套 if-else

const MAP = {
  bill: {
    已缴: 'success', 未缴: 'warning', 部分缴: 'primary',
    逾期: 'danger', 已减免: 'muted', 已作废: 'muted'
  },
  workOrder: {
    待派单: 'danger', 已派单: 'warning', 处理中: 'primary', 待确认: 'info',
    已完工: 'success', 已评价: 'success', 已关闭: 'muted', 已取消: 'muted'
  },
  inspect: {
    待执行: 'muted', 执行中: 'primary', 已完成: 'success',
    逾期: 'danger', 已转工单: 'warning'
  },
  device: {
    在线: 'success', 离线: 'muted', 告警: 'warning', 故障: 'danger', 维保中: 'primary'
  },
  parking: {
    已租: 'primary', 已售: 'success', 闲置: 'muted', 不可用: 'danger'
  },
  employee: { 在职: 'success', 试用: 'warning', 离职: 'muted' },
  house: { 自住: 'primary', 出租: 'success', 空置: 'warning', 装修中: 'info', 限制使用: 'danger' },
  alarmLevel: { 紧急: 'danger', 重要: 'warning', 一般: 'primary', 提示: 'muted' },
  priority: { 特急: 'danger', 紧急: 'warning', 普通: 'info' },
  vehicle: { 正常: 'success', 欠费: 'warning', 黑名单: 'danger', 未授权: 'muted' },
  plan: { 启用: 'success', 停用: 'muted' },
  alarmStatus: { 未处理: 'danger', 处理中: 'warning', 已关闭: 'muted' },
  invoice: { 已开票: 'success', 未开票: 'muted' },
  bindStatus: { 已绑定: 'success', 未绑定: 'muted', 待审核: 'warning' },
  // 补充批次（租户 / 合同 / 公告 / 品质记录）：与上面同口径，越紧急越靠红端
  contract: {
    履行中: 'success', 待生效: 'info', 即将到期: 'warning', 已到期: 'danger',
    待审批: 'primary', 草稿: 'muted', 已终止: 'muted'
  },
  notice: { 已发布: 'success', 待审核: 'warning', 草稿: 'muted', 已过期: 'muted', 已撤回: 'danger' },
  quality: { 已闭环: 'success', 整改中: 'primary', 待复核: 'warning', 已超时: 'danger' },
  // 租户（P4）：在住/已搬离 + 物业核验三态（租金不进字典，后台不展示）
  tenantStatus: { 在住: 'success', 已搬离: 'muted' },
  tenantVerify: { 待核验: 'warning', 已核验: 'success', 信息不全: 'danger' },
  // 整改闭环（P3）：待整改要盯、退回是红、闭环是绿
  rectify: { 待整改: 'warning', 待复核: 'primary', 已退回: 'danger', 已闭环: 'success' },
  rectifyLevel: { 重大: 'danger', 一般: 'warning', 轻微: 'info' },
  lease: { 生效中: 'success', 即将到期: 'warning', 已到期: 'danger' },
  // 装修押金（唯一押金场景）：在账 = danger，已结清 = success/muted
  deposit: {
    装修中: 'info', 已逾期: 'danger', 待退款: 'primary',
    已退还: 'success', 部分扣除: 'warning', 已没收: 'muted'
  },
  // 下载中心任务状态
  download: { 排队中: 'info', 生成中: 'primary', 已完成: 'success', 失败: 'danger', 已过期: 'muted' },
  grade: { 优秀: 'success', 良好: 'primary', 合格: 'info', 不合格: 'danger' },
  // 收尾轮（SEED+61 新表）：审批、待办、催缴、票据、抄表、考勤、维保、预存
  approval: { 待审批: 'warning', 审批中: 'primary', 已通过: 'success', 已驳回: 'danger', 已撤回: 'muted' },
  todoLevel: { 紧急: 'danger', 重要: 'warning', 一般: 'info' },
  flowAction: { 同意: 'success', 驳回: 'danger', 转办: 'warning', 加签: 'primary', 待处理: 'muted', 撤回: 'muted' },
  collection: { 已还款: 'success', 已承诺还款: 'primary', 已送达: 'info', 已发送: 'info', 联系无效: 'danger' },
  invoice: { 已开具: 'success', 已红冲: 'danger', 开具失败: 'warning' },
  meter: { 正常: 'success', 故障: 'danger', 已停用: 'muted' },
  reading: { 已计费: 'success', 待复核: 'warning', 待录入: 'muted' },
  attendance: { 正常: 'success', 待确认: 'warning', 异常: 'danger' },
  maintain: { 已完成: 'success', 计划中: 'info', 待派工: 'warning', 已逾期: 'danger', 待跟进: 'warning' },
  prepay: { 正常: 'success', 冻结: 'warning', 已销户: 'muted' }
}

/** 原始字典（字典管理页用）：域 → { 状态值: 语义 }，可被 addDictItem 修改 */
export const dictMapRaw = () => MAP
/** 字典域清单（[domain, map] 数组，供字典管理页枚举） */
export const DICT_MAP = Object.entries(MAP)

/** 取标签语义，未收录返回 muted（避免未知状态显示成主色抢眼） */
export function statusType(domain, value) {
  return MAP[domain]?.[value] || 'muted'
}

/** 取状态对应色值，供图表/自定义绘制使用 */
export function statusColor(domain, value) {
  const t = statusType(domain, value)
  return ({
    primary: '#5B6CFF', success: '#12B98A', warning: '#D98A1F',
    danger: '#EC4D63', info: '#7A52E0', muted: '#8A94B0'
  })[t]
}

/**
 * 分桶配色：图表里的「人为分段」（到期分桶、账龄、告警等级）不属于状态字典，
 * 但同样必须集中维护——否则同一套语义在不同驾驶舱里颜色不一致。
 * 取色原则：越紧急越靠红端，越安全越靠绿/主色端。
 */
const BUCKET = {
  // 车位/合同到期分桶（越近越紧急）
  expire: {
    已过期: '#FF6B6B', '30天内': '#FF9F40', '90天内': '#FFB05C',
    半年内: '#5B6CFF', '一年以上': '#2ED9A3'
  },
  // 欠费账龄（未到期用主色，越久越靠红端——顺序本身携带语义，不能乱排）
  aging: {
    未到期: '#5B6CFF', '1–30 天': '#8A63F2', '31–90 天': '#FFB05C',
    '91–180 天': '#FF9F40', '180 天以上': '#FF6B6B'
  },
  // 告警等级
  alarm: { 紧急: '#FF6B6B', 重要: '#FF9F40', 一般: '#5B6CFF', 提示: '#8A94B0' },
  // 品质评分档位（A 合格 → D 严重）
  grade: { A: '#2ED9A3', B: '#5B6CFF', C: '#FF9F40', D: '#FF6B6B' },
}

/** 取分桶色，未收录返回中性灰（不抢眼，也提示字典缺项） */
export function bucketColor(domain, name) {
  return BUCKET[domain]?.[name] || '#8A94B0'
}

export const DICT = MAP
export const BUCKETS = BUCKET
