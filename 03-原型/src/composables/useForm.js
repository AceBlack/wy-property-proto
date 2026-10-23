// 表单页通用流程：脏检查 → 校验（含首个错误聚焦）→ 保存 → 离开拦截
// 页面只需提供 form、取到 el-form 的 ref、以及 onSave，其余流程全部复用
// 注意：本函数必须在路由组件的 setup 内调用（onBeforeRouteLeave 只在路由组件生效）

import { computed, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'

/**
 * @param {Object}   form       reactive 表单对象
 * @param {Object}   opts
 *   formRef  - () => el-form 实例（FormShell 通过 defineExpose 暴露）
 *   onSave   - async () => void，真正提交；抛错则视为保存失败
 *   backPath - 取消 / 保存后返回的列表页
 */
export function useForm(form, { formRef, onSave } = {}) {
  const saving = ref(false)
  const snapshot = ref(JSON.stringify(form))
  const dirty = computed(() => JSON.stringify(form) !== snapshot.value)

  /** 回填或保存成功后调用，之后视为「无未保存改动」 */
  function markSaved() { snapshot.value = JSON.stringify(form) }
  function reset(initial) { Object.assign(form, initial); markSaved() }

  /** 校验；失败时提示并滚动到第一个错误字段 */
  async function validate() {
    const ref = typeof formRef === 'function' ? formRef() : formRef?.value
    if (!ref) return true
    try {
      await ref.validate()
      return true
    } catch (e) {
      const fields = Object.keys(e || {})
      if (fields.length) {
        ElMessage.error(`请检查标红的 ${fields.length} 项`)
        try { ref.scrollToField?.(fields[0]) } catch { /* 字段不可滚动时忽略 */ }
      }
      return false
    }
  }

  /** 提交：校验 → 保存 → 提示。返回是否成功 */
  async function submit(okText = '保存成功') {
    if (!(await validate())) return false
    saving.value = true
    try {
      await onSave?.()
      markSaved()
      ElMessage.success(okText)
      return true
    } catch (e) {
      ElMessage.error(e?.message || '保存失败，请稍后重试')
      return false
    } finally {
      saving.value = false
    }
  }

  /** 离开确认：只有真的改过才拦 */
  async function confirmLeave() {
    if (!dirty.value) return true
    try {
      await ElMessageBox.confirm('有未保存的改动，离开后不会保留。', '确认离开？', {
        type: 'warning', confirmButtonText: '确认离开', cancelButtonText: '继续编辑'
      })
      return true
    } catch { return false }
  }
  onBeforeRouteLeave(async () => await confirmLeave())

  return { saving, dirty, validate, submit, markSaved, reset, confirmLeave }
}
