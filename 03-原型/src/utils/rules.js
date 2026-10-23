// 表单校验规则库：所有新增 / 编辑表单共用，禁止页面各写一套正则
// 用法：rules: { phone: phone('手机号'), area: number('建筑面积') }
// 说明：身份证是否强制校验位、是否支持护照由业务方确认（见 03-原型/README 待确认 #7）

const T = (msg, trigger) => ({ message: msg, trigger })

/** 必填 · 输入类 */
export const req = (label, trigger = 'blur') => [{ required: true, message: `请输入${label}`, trigger }]
/** 必填 · 选择类 */
export const reqSel = (label, trigger = 'change') => [{ required: true, message: `请选择${label}`, trigger }]

/** 手机号：1[3-9] + 9 位 */
export const phone = (label = '手机号') => [
  { required: true, message: `请输入${label}`, trigger: 'blur' },
  { pattern: /^1[3-9]\d{9}$/, message: `${label}格式不正确，应为 11 位数字`, trigger: 'blur' }
]

/** 座机 / 应急联系人电话：允许手机号或带区号固话，可空 */
export const phoneOptional = (label = '联系电话') => [
  { pattern: /^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8})$/, message: `${label}格式不正确`, trigger: 'blur' }
]

/** 身份证：18 位，末位可为 X；含校验位算法 */
const ID_WEIGHT = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
/** 证件类型：按号码形态自动识别（原型不额外收「证件类型」字段） */
export function idDocType(v) {
  const s = String(v || '').trim().toUpperCase()
  if (/^\d{17}[\dX]$/.test(s)) return '身份证'
  if (/^[HM]\d{8,10}$/.test(s)) return '港澳通行证'
  if (/^\d{8}$/.test(s)) return '台胞证'
  if (/^[A-Z]{1,2}\d{7,9}$/.test(s)) return '护照'
  return ''
}

/**
 * 证件号校验（Q5 口径 2026-10-23：身份证严校 + 支持护照 / 港澳台证件）
 * 18 位身份证（含港澳台居民居住证）走校验位；护照 / 回乡证 / 台胞证只校验号码形态。
 */
export function idCardValid(v) {
  const s = String(v || '').trim().toUpperCase()
  if (!s) return false
  if (/^\d{17}[\dX]$/.test(s)) {
    const sum = ID_WEIGHT.reduce((acc, w, i) => acc + Number(s[i]) * w, 0)
    return ID_CHECK[sum % 11] === s[17]
  }
  return !!idDocType(s)
}
export const idCard = (label = '证件号码', { checkBit = true } = {}) => [
  { required: true, message: `请输入${label}`, trigger: 'blur' },
  {
    validator: (_r, v, cb) => {
      const s = String(v || '').trim().toUpperCase()
      if (!s) return cb()
      if (checkBit ? idCardValid(s) : /^[A-Z0-9]{6,20}$/.test(s)) return cb()
      return cb(new Error(`${label}格式不正确：身份证 18 位 / 护照 / 港澳台通行证`))
    },
    trigger: 'blur'
  }
]

/** 姓名：2–20 个中英文字符 */
export const name = (label = '姓名') => [
  { required: true, message: `请输入${label}`, trigger: 'blur' },
  { pattern: /^[一-龥A-Za-z·.\s]{2,20}$/, message: `${label}为 2–20 个中英文字符`, trigger: 'blur' }
]

/** 数值：可限定范围与小数位 */
export const number = (label, { min = 0, max = 99999999, precision = 2, required = true } = {}) => {
  const list = []
  if (required) list.push({ required: true, message: `请输入${label}`, trigger: 'blur' })
  list.push({
    validator: (_r, v, cb) => {
      if (v === '' || v === null || v === undefined) return cb()
      const n = Number(v)
      if (Number.isNaN(n)) return cb(new Error(`${label}必须为数字`))
      if (n < min) return cb(new Error(`${label}不得小于 ${min}`))
      if (n > max) return cb(new Error(`${label}不得大于 ${max}`))
      const str = String(v)
      const dot = str.indexOf('.')
      if (dot >= 0 && str.length - dot - 1 > precision) return cb(new Error(`${label}最多保留 ${precision} 位小数`))
      cb()
    },
    trigger: 'blur'
  })
  return list
}

/** 金额：≥0，2 位小数 */
export const amount = (label = '金额', opts = {}) => number(label, { min: 0, precision: 2, ...opts })
/** 面积：>0，2 位小数 */
export const area = (label = '面积') => number(label, { min: 0.01, max: 99999, precision: 2 })

/** 房号：4 位数字 */
export const room = () => [
  { required: true, message: '请输入房号', trigger: 'blur' },
  { pattern: /^\d{4}$/, message: '房号为 4 位数字，如 0101', trigger: 'blur' }
]

/** 车牌：民用 / 新能源 */
export const plateNo = (label = '车牌号') => [
  { required: true, message: `请输入${label}`, trigger: 'blur' },
  {
    pattern: /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领A-Z]{1}[A-Z]{1}[A-Z0-9]{4,5}[A-Z0-9挂学警港澳]{1}$/,
    message: `${label}格式不正确，如 川A12345`,
    trigger: 'blur'
  }
]

/** 车位号：字母 + 数字，如 A012 */
export const parkNo = (label = '车位号') => [
  { required: true, message: `请输入${label}`, trigger: 'blur' },
  { pattern: /^[A-Za-z]\d{3,4}$/, message: `${label}格式为 1 位字母 + 3–4 位数字，如 A012`, trigger: 'blur' }
]

/** 日期区间：结束必须晚于开始（跨字段校验，挂在结束日字段上） */
export function dateAfter(startKey, { label = '结束日期', allowEqual = true } = {}) {
  return [{
    validator: (_r, v, cb, form) => {
      if (!v || !form) return cb()
      const s = String(form[startKey] || '').slice(0, 10)
      const e = String(v).slice(0, 10)
      if (!s || !e) return cb()
      if (allowEqual ? e < s : e <= s) {
        return cb(new Error(`${label}${allowEqual ? '不得早于' : '必须晚于'}开始日期`))
      }
      cb()
    },
    trigger: 'change'
  }]
}

/** 唯一性：与已有数据比对（原型阶段用内存数组，接后端后改为接口查重） */
export function unique(label, list, key = 'value') {
  return [{
    validator: (_r, v, cb, form) => {
      if (!v) return cb()
      const hit = list.some(x => String(x[key]) === String(v) && x.self !== form)
      // 说明：x.self 用于编辑态排除自身，页面构造候选列表时传入
      if (hit) return cb(new Error(`${label}「${v}」已存在`))
      cb()
    },
    trigger: 'blur'
  }]
}

/** 范围内唯一：getList 返回已存在的取值集合（页面负责排除编辑中的自身） */
export function uniqueIn(label, getList) {
  return [{
    validator: (_r, v, cb) => {
      if (v === '' || v === null || v === undefined) return cb()
      const list = (typeof getList === 'function' ? getList() : getList) || []
      if (list.map(String).includes(String(v))) return cb(new Error(`${label}「${v}」已存在`))
      cb()
    },
    trigger: 'blur'
  }]
}

/** 正数整数（数量、人数） */
export const intPositive = (label, max = 99999) => number(label, { min: 1, max, precision: 0 })

/** 邮箱：可空 */
export const emailOptional = (label = '邮箱') => [
  { pattern: /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/, message: `${label}格式不正确`, trigger: 'blur' }
]
