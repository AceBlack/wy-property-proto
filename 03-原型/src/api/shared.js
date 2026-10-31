/**
 * 跨域共用项（字典、通用工具、常量）
 * ----------------------------------------------------------------
 * 这些与后端无关（前端字典/常量），放一处避免各域文件重复导出造成 export 冲突。
 */
export {
  PAGE_SIZES, communities, orgNameOf,
  /* 选房 / 选车位的级联字典：账单页与工单页都在用，放共用处只导一次 */
  cashierBuildingOpts, cashierUnitOpts,
  /* 显示辅助与业务字典 */
  feeItems, houseName, ownerName, subjectLabel,
  /* 选人 / 选组织 / 选项目：合同、公告、工资表都在用 */
  empOptions, orgOptions, communityOpts
} from '@/utils/api'
