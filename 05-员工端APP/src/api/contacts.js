/**
 * 通讯录（移动端）
 *
 * PC 第 66 批已有 `queryContacts / contactTree / contactStats`，这里只做移动端需要的那一层：
 *   · 部门 chips：把三级树**拍平成一级 + 二级**再给页面 —— 手机上展开三层树太占地方；
 *   · 搜索：关键字原样传下去，函数内部支持"手机号后 4 位"（前台记不住完整号码，但记得尾巴）；
 *   · 不脱敏：同事之间看手机号就是通讯录的用途，与「员工档案」相反（档案里看手机是查隐私）。
 */
import { contactStats, contactTree, queryContacts } from '@pc/utils/api'
import { persona } from '@/store/app'

/** 部门 chips：一级 + 二级，已按人数排序；树里 0 人节点 PC 已剪掉，这里不再过滤 */
export function contactChips() {
  const tree = contactTree()
  const total = contactStats().total
  const out = []
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      /* 二级以下的班组不铺到 chips 上：手机上 chips 超过两行就没人看了；
         根节点（集团，等于全部人数）也不铺 —— 它和「全部」是同一个结果 */
      const isRoot = depth === 1 && n.totalCount === total
      if (depth <= 2 && !isRoot) out.push({ key: n.orgId, label: n.name, count: n.totalCount, depth })
      if (depth < 2) walk(n.children || [], depth + 1)
    }
  }
  walk(tree, 1)
  return out
}

/** 列表：按部门分组返回（PC 已分好组，页面不再自己 reduce） */
export async function loadContacts({ orgId = '', kw = '' } = {}) {
  const r = await queryContacts({ orgId, kw })
  return { groups: r.groups || [], total: r.total || 0 }
}

export const contactsSummary = () => contactStats()

/** 当前登录人在通讯录里的 empId：列表上标一个「我」，省得找自己 */
export const meEmpId = () => persona.value?.empId || ''

/** 呼叫：H5 用 tel: 会变成新开页，uni 的 makePhoneCall 才走系统拨号 */
export function callPhone(phone) {
  if (!phone) return
  uni.makePhoneCall({ phoneNumber: String(phone) })
}

/**
 * 复制号码。
 * uni.setClipboardData 自己会弹一个「内容已复制」，这里不再补 toast ——
 * 两个提示叠在一起，用户会以为复制了两次。
 */
export function copyPhone(phone) {
  if (!phone) return
  uni.setClipboardData({ data: String(phone) })
}
