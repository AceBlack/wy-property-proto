<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>OA 审批 · 发起申请</b>：六类单据共用一套审批引擎，差异只在<b>表单字段</b>与<b>审批节点</b>。
        <br />
        字段是<b>配置驱动</b>的（`utils/oa.js` 里描述），加第七种单据只加一条定义，不改页面；
        审批人按<b>规则</b>取（部门负责人 / 直属上级 / 指定岗位），不写死人名。
        <br />
        本期<b>批准即结束</b>：报销批了不生成付款单、请假批了不进考勤 —— 落业务结果单独排批。
      </div>
    </div>

    <!-- KPI -->
    <div class="grid g4" style="margin-top:16px;">
      <div class="dstat"><div class="dstat__k">我的申请</div><div class="dstat__v">{{ sum.total }}<span class="unit">张</span></div></div>
      <div class="dstat"><div class="dstat__k">在途</div><div class="dstat__v" :class="sum.live ? 'is-warn' : ''">{{ sum.live }}<span class="unit">张</span></div></div>
      <div class="dstat"><div class="dstat__k">已办结</div><div class="dstat__v">{{ sum.done }}<span class="unit">张</span></div></div>
      <div class="dstat"><div class="dstat__k">涉及类型</div><div class="dstat__v">{{ sum.types }}<span class="unit">类</span></div></div>
    </div>

    <div class="ia is-flat" style="margin-top:16px;">
      <!-- 左：单据类型 -->
      <aside class="ia__side">
        <div class="panel">
          <div class="sec__hd"><h4>选单据类型</h4><span class="desc">6 类</span></div>
          <div class="oa-types">
            <div
              v-for="d in defs" :key="d.bizType" class="oa-type" :class="{ 'is-on': bizType === d.bizType }"
              @click="pickType(d.bizType)"
            >
              <el-icon class="oa-type__ico"><component :is="d.icon" /></el-icon>
              <div class="oa-type__b">
                <div class="oa-type__n">{{ d.bizType }}</div>
                <div class="oa-type__d">{{ d.desc }}</div>
              </div>
            </div>
          </div>
          <div class="oa-side-note">
            合同审批不在这里发起 —— 它挂在合同上（保存合同即自动发起），
            节点配置在「流程配置」里改。
          </div>
        </div>
      </aside>

      <div class="ia__main">
        <!-- 表单 -->
        <div class="panel">
          <div class="panel__hd">
            <h3>{{ curDef.desc }}</h3>
            <span class="tag tag--primary">{{ bizType }}</span>
            <span class="spacer" />
            <span class="desc">提报人自动带出：{{ me.name }} · {{ me.position }} · {{ me.orgName }}</span>
          </div>

          <el-form ref="formRef" :model="form" label-width="112px" class="oa-form" @submit.prevent>
            <el-row :gutter="24">
              <el-col v-for="f in curDef.fields" :key="f.key" :span="f.type === 'textarea' || f.type === 'file' ? 24 : 12">
                <el-form-item :label="f.label" :required="f.required">
                  <!-- 文本 -->
                  <el-input v-if="f.type === 'text'" v-model="form[f.key]" :maxlength="f.maxlength"
                    :placeholder="`请输入${f.label}`" show-word-limit />
                  <!-- 多行 -->
                  <el-input v-else-if="f.type === 'textarea'" v-model="form[f.key]" type="textarea" :rows="3"
                    :maxlength="f.maxlength" show-word-limit :placeholder="`请说明${f.label}`" />
                  <!-- 数字 -->
                  <el-input-number v-else-if="f.type === 'number'" v-model="form[f.key]" :min="f.min" :max="f.max"
                    controls-position="right" style="width:180px" />
                  <!-- 金额 -->
                  <el-input v-else-if="f.type === 'money'" v-model.number="form[f.key]" placeholder="请输入金额"
                    style="width:200px"><template #append>元</template></el-input>
                  <!-- 日期 -->
                  <el-date-picker v-else-if="f.type === 'date'" v-model="form[f.key]" type="date"
                    value-format="YYYY-MM-DD" style="width:200px" placeholder="选择日期" />
                  <!-- 日期时间 -->
                  <el-date-picker v-else-if="f.type === 'datetime'" v-model="form[f.key]" type="datetime"
                    value-format="YYYY-MM-DD HH:mm" format="YYYY-MM-DD HH:mm" style="width:220px"
                    placeholder="选择时间" />
                  <!-- 下拉 -->
                  <el-select v-else-if="f.type === 'select'" v-model="form[f.key]" style="width:200px" :placeholder="`请选择${f.label}`">
                    <template v-if="f.opts === 'community'">
                      <el-option v-for="c in communityOpts()" :key="c.id" :label="c.name" :value="c.id" />
                    </template>
                    <template v-else>
                      <el-option v-for="o in (f.options || [])" :key="o" :label="o" :value="o" />
                    </template>
                  </el-select>
                  <!-- 附件（原型只登记文件名） -->
                  <div v-else-if="f.type === 'file'" class="oa-file">
                    <el-upload :auto-upload="false" :show-file-list="false" multiple :limit="5"
                      :on-change="(file) => onFile(file, f.key)">
                      <el-button :icon="'Paperclip'">选择文件</el-button>
                    </el-upload>
                    <span v-if="(files[f.key] || []).length" class="oa-file__list">
                      {{ files[f.key].map(x => x.name).join('、') }}
                    </span>
                    <span v-else class="muted">{{ f.hint || '最多 5 个' }}</span>
                  </div>
                  <div v-if="f.unit || f.hint" class="oa-hint">{{ f.unit || f.hint }}</div>
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>
        </div>

        <!-- 审批路径预览 -->
        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd">
            <h3>审批路径</h3>
            <span class="spacer" />
            <span class="desc">提交前就该知道会经过谁，而不是等结果</span>
          </div>
          <div class="oa-flow">
            <div class="oa-flow__me">
              <span class="oa-flow__dot is-me" />
              <div>
                <div class="oa-flow__n">{{ me.name }} 提交</div>
                <div class="oa-flow__m">{{ bizType }} · {{ me.orgName }}</div>
              </div>
            </div>
            <div v-for="(n, i) in preview" :key="i" class="oa-flow__i">
              <span class="oa-flow__dot" />
              <div>
                <div class="oa-flow__n">{{ n.node }}</div>
                <div class="oa-flow__m">{{ n.handler }} · 时限 {{ n.limitHours }} 小时</div>
              </div>
            </div>
          </div>
          <div v-if="branchHint" class="oa-branch">
            <el-icon><InfoFilled /></el-icon>
            {{ branchHint }}
          </div>
        </div>

        <!-- 提交 -->
        <div class="panel" style="margin-top:16px;">
          <div class="oa-submit">
            <span class="muted" style="font-size:12.5px;">
              提交后进入审批流，可在「我的申请」查看进度与撤回（仅未处理时）。
            </span>
            <span class="spacer" />
            <el-button :icon="'RefreshLeft'" @click="resetForm">重置</el-button>
            <el-button type="primary" :icon="'Promotion'" :loading="submitting" @click="onSubmit">
              提交申请
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 提交成功 -->
    <el-dialog v-model="doneVisible" title="提交成功" width="520px">
      <div v-if="doneData" class="oa-done">
        <div class="oa-done__row"><span>审批单号</span><b>{{ doneData.approvalNo }}</b></div>
        <div class="oa-done__row"><span>单据类型</span><b>{{ doneData.bizType }}</b></div>
        <div class="oa-done__row"><span>当前节点</span><b>{{ doneData.currentNode }}</b></div>
        <div class="oa-done__path">
          <span v-for="(n, i) in doneData.flow" :key="i" class="oa-done__node">
            {{ n.node }}（{{ n.handler || '待指派' }}）
          </span>
        </div>
        <div class="oa-done__note">
          单子已进入审批流。本期审批通过即结束，不自动生成付款单 / 考勤 / 采购单。
        </div>
      </div>
      <template #footer>
        <el-button @click="doneVisible = false">继续发起</el-button>
        <el-button type="primary" @click="$router.push('/c/oa-mine')">去我的申请</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  createOaRequest, currentOperator, communityOpts, oaFormCheck, oaNodesFor, oaPreviewFlow,
  oaSummary, OA_FORM_DEFS
} from '@/api'

const defs = OA_FORM_DEFS
const bizType = ref(defs[0].bizType)
const me = currentOperator()
const sum = oaSummary()
const formRef = ref()
const submitting = ref(false)
const doneVisible = ref(false)
const doneData = ref(null)

const curDef = computed(() => defs.find(d => d.bizType === bizType.value) || defs[0])

/** 表单值：按字段定义的 default 初始化，切换类型时整体重置 */
const form = reactive({})
const files = reactive({})

function resetForm() {
  for (const k of Object.keys(form)) delete form[k]
  for (const k of Object.keys(files)) delete files[k]
  for (const f of curDef.value.fields) {
    form[f.key] = f.default !== undefined ? f.default : (f.type === 'number' || f.type === 'money' ? undefined : '')
    if (f.type === 'file') files[f.key] = []
  }
}
resetForm()

function pickType(t) {
  if (bizType.value === t) return
  bizType.value = t
  resetForm()
  formRef.value?.clearValidate?.()
}

function onFile(file, key) {
  files[key] = files[key] || []
  if (files[key].length >= 5) { ElMessage.warning('最多 5 个附件'); return }
  files[key].push({ name: file.name, size: file.size, type: file.type })
}

/* 金额字段变了，审批路径可能从两级变三级 —— 预览实时跟着变 */
const amountValue = computed(() => {
  const af = curDef.value.fields.find(f => f.role === 'amount')
  return af ? Number(form[af.key]) || 0 : 0
})
const preview = computed(() => {
  void amountValue.value
  void bizType.value
  try { return oaPreviewFlow(bizType.value, amountValue.value) } catch { return [] }
})
const branchHint = computed(() => {
  const f = defs.find(d => d.bizType === bizType.value)
  const af = f?.fields.find(x => x.role === 'amount')
  if (!af) return ''
  const amount = amountValue.value
  const nodes = oaNodesFor(bizType.value, amount)
  if (!amount) return '填了金额后，审批路径会按金额自动决定级数'
  return `金额 ¥${amount.toLocaleString('zh-CN')} · 按当前配置走 ${nodes.length} 级审批`
})

async function onSubmit() {
  const bad = oaFormCheck(bizType.value, form)
  if (bad) { ElMessage.error(bad); return }
  submitting.value = true
  try {
    const payload = {}
    for (const f of curDef.value.fields) {
      if (f.type === 'file') continue
      payload[f.key] = form[f.key]
    }
    const allFiles = Object.values(files).flat()
    const r = createOaRequest({ bizType: bizType.value, formData: payload, files: allFiles })
    doneData.value = r
    doneVisible.value = true
    resetForm()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.oa-types { display: flex; flex-direction: column; gap: 8px; }
.oa-type {
  display: flex; gap: 10px; padding: 10px 12px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--biz-border, #eef0f6); transition: all .18s;
}
.oa-type:hover { border-color: rgba(91, 108, 255, .34); background: rgba(91, 108, 255, .03); }
.oa-type.is-on { border-color: var(--biz-primary, #5b6cff); background: rgba(91, 108, 255, .07); }
.oa-type__ico { margin-top: 2px; color: var(--biz-text-3); }
.oa-type.is-on .oa-type__ico { color: var(--biz-primary, #5b6cff); }
.oa-type__n { font-size: 13px; font-weight: 600; }
.oa-type__d { margin-top: 2px; font-size: 11.5px; line-height: 1.55; color: var(--biz-text-3); }
.oa-side-note {
  margin-top: 12px; padding: 8px 10px; border-radius: 6px; font-size: 11.5px; line-height: 1.75;
  background: var(--biz-bg-fill); color: var(--biz-text-3);
}

.oa-form { padding-top: 4px; }
.oa-hint { margin-top: 2px; font-size: 11.5px; color: var(--biz-text-3); }
.oa-file { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.oa-file__list { font-size: 12px; color: var(--biz-text-2); }

/* 审批路径：申请人提交前要看得到 */
.oa-flow { padding: 4px 0 2px; }
.oa-flow__me, .oa-flow__i { position: relative; display: flex; gap: 12px; padding: 0 0 14px 16px; }
.oa-flow__me:last-child, .oa-flow__i:last-child { padding-bottom: 0; }
.oa-flow__me::before, .oa-flow__i::before {
  content: ''; position: absolute; left: 4px; top: 14px; bottom: 0; width: 1px;
  background: var(--biz-border, #eef0f6);
}
.oa-flow__i:last-child::before { display: none; }
.oa-flow__dot {
  position: absolute; left: 0; top: 4px; width: 9px; height: 9px; border-radius: 50%;
  background: #c9d2e3; border: 2px solid #fff; box-shadow: 0 0 0 1px #dfe3ee;
}
.oa-flow__dot.is-me { background: #12b98a; box-shadow: 0 0 0 1px #12b98a; }
.oa-flow__n { font-size: 13px; color: var(--biz-text-1); }
.oa-flow__m { margin-top: 1px; font-size: 11.5px; color: var(--biz-text-3); }
.oa-branch {
  display: flex; align-items: center; gap: 6px; margin-top: 5px; padding: 7px 10px;
  border-radius: 6px; font-size: 12px; background: rgba(91, 108, 255, .06); color: var(--biz-text-2);
}

.oa-submit { display: flex; align-items: center; gap: 12px; }
.oa-done__row { display: flex; gap: 12px; padding: 5px 0; font-size: 13px; }
.oa-done__row span { width: 76px; color: var(--biz-text-3); }
.oa-done__path { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.oa-done__node {
  padding: 2px 8px; border-radius: 10px; font-size: 11.5px;
  background: rgba(91, 108, 255, .08); color: var(--biz-primary, #5b6cff);
}
.oa-done__note {
  margin-top: 12px; padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.75;
  background: var(--biz-bg-fill); color: var(--biz-text-3);
}
</style>
