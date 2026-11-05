<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>流程配置</b>：八种单据（六类 OA + 合同审批 + 计划审批）的审批节点都在这里定，改完<b>只影响新提交的单</b>。
        <br />
        在途单沿用<b>发起时的 flow 快照</b> —— 回头改会让"批到一半换规则"，说不清谁批的算数。
        <br />
        合同审批的节点原来硬编码在代码里（≥30 万三级），收进这张配置表后可以改阈值、加减节点。
      </div>
    </div>

    <div class="ia is-flat" style="margin-top:16px;">
      <aside class="ia__side">
        <div class="panel">
          <div class="sec__hd"><h4>单据类型</h4><span class="desc">8 种</span></div>
          <div class="fc-list">
            <div v-for="f in flows" :key="f.bizType" class="fc-item" :class="{ 'is-on': bizType === f.bizType }"
              @click="pick(f.bizType)">
              <div class="fc-item__n">{{ f.bizType }}</div>
              <div class="fc-item__m">
                {{ f.baseNodes.length }} 级<template v-if="f.overNodes.length"> · 超额 {{ f.overNodes.length }} 级</template>
                <span v-if="f.inFlight" class="fc-item__live">在途 {{ f.inFlight }}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div class="ia__main">
        <div class="panel">
          <div class="panel__hd">
            <h3>{{ cur.bizType }}</h3>
            <span class="spacer" />
            <span class="desc">
              <template v-if="cur.inFlight">当前 {{ cur.inFlight }} 张在途单沿用旧流程</template>
              <template v-else>暂无在途单</template>
            </span>
          </div>

          <!-- 合同审批没有独立表单，发起入口在合同页 -->
          <div v-if="cur.bizType === '合同审批'" class="fc-tip">
            <el-icon><InfoFilled /></el-icon>
            合同审批<b>从合同页发起</b>（新建合同 / 发起变更时自动生成审批单），此页只管节点配置。
          </div>

          <!-- 金额分支 -->
          <div class="fc-threshold">
            <span class="fc-threshold__k">金额阈值</span>
            <el-input-number v-model="form.amountThreshold" :min="0" :step="1000" :max="10000000"
              controls-position="right" style="width:160px" :disabled="!hasAmount" />
            <span class="fc-threshold__u">元</span>
            <span class="fc-threshold__h">
              {{ hasAmount
                ? `≤ ${form.amountThreshold} 走基础流程；> ${form.amountThreshold} 走超额流程`
                : '该单据没有金额字段，阈值不生效' }}
            </span>
          </div>

          <el-tabs v-model="tab" style="margin-top:6px;">
            <el-tab-pane label="基础流程" name="base">
              <div class="fc-nodes">
                <div v-for="(n, i) in form.baseNodes" :key="i" class="fc-node">
                  <span class="fc-node__idx">{{ i + 1 }}</span>
                  <div class="fc-node__grid">
                    <el-input v-model="n.name" placeholder="节点名称" maxlength="16" />
                    <el-select v-model="n.assigneeType" style="width:100%">
                      <el-option v-for="a in ASSIGNEE_TYPES" :key="a.value" :label="a.label" :value="a.value">
                        <span>{{ a.label }}</span>
                        <span class="fc-opt-hint">{{ a.hint }}</span>
                      </el-option>
                    </el-select>
                    <el-select v-model="n.signMode" :disabled="n.assigneeType !== 'orgLeader'" style="width:100%">
                      <el-option v-for="sm in SIGN_MODES" :key="sm.value" :label="sm.label" :value="sm.value">
                        <span>{{ sm.label }}</span>
                        <span class="fc-opt-hint">{{ sm.hint }}</span>
                      </el-option>
                    </el-select>
                    <el-select v-if="n.assigneeType === 'role'" v-model="n.roleCode" placeholder="岗位" style="width:100%">
                      <el-option v-for="(label, code) in ROLE_CODES" :key="code" :label="label" :value="code" />
                    </el-select>
                    <span v-else class="fc-node__ph">—</span>
                    <el-input-number v-model="n.limitHours" :min="1" :max="240" :step="4"
                      controls-position="right" style="width:100%" />
                  </div>
                  <div class="fc-node__acts">
                    <el-button link :disabled="i === 0" @click="move(form.baseNodes, i, -1)">上移</el-button>
                    <el-button link :disabled="i === form.baseNodes.length - 1" @click="move(form.baseNodes, i, 1)">下移</el-button>
                    <el-button link type="danger" :disabled="form.baseNodes.length === 1" @click="remove(form.baseNodes, i)">删除</el-button>
                  </div>
                </div>
                <el-button :icon="'Plus'" plain style="margin-top:4px;" @click="addNode('base')">加一级</el-button>
              </div>
            </el-tab-pane>

            <el-tab-pane name="over">
              <template #label>
                超额流程
                <span class="fc-tab-hint">{{ form.overNodes.length || '未配' }}</span>
              </template>
              <div v-if="!hasAmount" class="fc-empty">
                该单据没有金额字段，不需要超额流程。
              </div>
              <template v-else>
                <div class="fc-empty" v-if="!form.overNodes.length">
                  没配超额流程 —— 金额超过阈值也走基础流程。
                  <el-button link type="primary" @click="copyFromBase">从基础流程复制一份</el-button>
                </div>
                <div v-else class="fc-nodes">
                  <div v-for="(n, i) in form.overNodes" :key="i" class="fc-node">
                    <span class="fc-node__idx">{{ i + 1 }}</span>
                    <div class="fc-node__grid">
                      <el-input v-model="n.name" placeholder="节点名称" maxlength="16" />
                      <el-select v-model="n.assigneeType" style="width:100%">
                        <el-option v-for="a in ASSIGNEE_TYPES" :key="a.value" :label="a.label" :value="a.value" />
                      </el-select>
                      <el-select v-model="n.signMode" :disabled="n.assigneeType !== 'orgLeader'" style="width:100%">
                        <el-option v-for="sm in SIGN_MODES" :key="sm.value" :label="sm.label" :value="sm.value">
                          <span>{{ sm.label }}</span>
                          <span class="fc-opt-hint">{{ sm.hint }}</span>
                        </el-option>
                      </el-select>
                      <el-select v-if="n.assigneeType === 'role'" v-model="n.roleCode" placeholder="岗位" style="width:100%">
                        <el-option v-for="(label, code) in ROLE_CODES" :key="code" :label="label" :value="code" />
                      </el-select>
                      <span v-else class="fc-node__ph">—</span>
                      <el-input-number v-model="n.limitHours" :min="1" :max="240" :step="4"
                        controls-position="right" style="width:100%" />
                    </div>
                    <div class="fc-node__acts">
                      <el-button link :disabled="i === 0" @click="move(form.overNodes, i, -1)">上移</el-button>
                      <el-button link :disabled="i === form.overNodes.length - 1" @click="move(form.overNodes, i, 1)">下移</el-button>
                      <el-button link type="danger" @click="remove(form.overNodes, i)">删除</el-button>
                    </div>
                  </div>
                  <el-button :icon="'Plus'" plain style="margin-top:4px;" @click="addNode('over')">加一级</el-button>
                </div>
              </template>
            </el-tab-pane>
          </el-tabs>

          <div class="fc-note-row">
            <span class="fc-note-k">配置说明</span>
            <el-input v-model="form.note" type="textarea" :rows="2" maxlength="120" show-word-limit
              placeholder="写清为什么这么配，半年后没人记得" />
          </div>

          <div class="fc-actions">
            <span class="muted" style="font-size:12.5px;">
              审批人按规则取（部门负责人 / 项目经理 / 直属上级 / 指定岗位），不写死人名 —— 人一调岗审批就断。
            </span>
            <span class="spacer" />
            <el-button :disabled="!canEdit" @click="pick(bizType)">还原</el-button>
            <el-button v-if="canEdit" type="primary" :icon="'Check'" :loading="saving" @click="onSave">
              保存配置
            </el-button>
            <span v-else class="muted" style="font-size:12.5px;">当前角色只读（需要「审批流配置 · 操作」权限）</span>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd"><h3>审批人来源对照</h3><span class="spacer" /><span class="desc">规则 → 实际取谁</span></div>
          <el-table :data="ASSIGNEE_TYPES" size="small">
            <el-table-column prop="label" label="来源" width="130" />
            <el-table-column prop="hint" label="取人规则" min-width="300" />
            <el-table-column label="本期解析结果" min-width="180">
              <template #default="{ row }">
                <span class="muted">{{ resolveSample(row.value) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ASSIGNEE_TYPES, SIGN_MODES, OA_FORM_DEFS, ROLE_CODES, canEditOaFlow, oaFlows, oaNodesFor, oaPreviewFlow, updateOaFlow
} from '@/api'

const flows = oaFlows()
/* 改流程 = 改全公司规则，只有握有 e.oaFlow.edit 的角色能保存（其余只读） */
const canEdit = canEditOaFlow()
const bizType = ref(flows[0].bizType)
const tab = ref('base')
const saving = ref(false)

const cur = computed(() => flows.find(f => f.bizType === bizType.value) || flows[0])
const hasAmount = computed(() => {
  const d = OA_FORM_DEFS.find(x => x.bizType === bizType.value)
  return !!d && d.fields.some(f => f.role === 'amount')
})

const form = reactive({ amountThreshold: 0, baseNodes: [], overNodes: [], note: '' })

function pick(t) {
  bizType.value = t
  const f = flows.find(x => x.bizType === t)
  form.amountThreshold = f.amountThreshold || 0
  /* 老配置没有 signMode（第 53 批之前），补成单人 —— 否则下拉是空的，
     人一看"没选"就会以为配错了 */
  const norm = list => list.map(n => ({ ...n, signMode: n.signMode || 'single' }))
  form.baseNodes = norm(f.baseNodes)
  form.overNodes = norm(f.overNodes)
  form.note = f.note || ''
  tab.value = 'base'
}

function addNode(which) {
  const list = which === 'base' ? form.baseNodes : form.overNodes
  list.push({ key: 'n' + (list.length + 1), name: `节点 ${list.length + 1}`, assigneeType: 'orgLeader', signMode: 'single', roleCode: '', limitHours: 24, allowReject: true })
}
function remove(list, i) { list.splice(i, 1) }
function move(list, i, d) {
  const j = i + d
  if (j < 0 || j >= list.length) return
  const [x] = list.splice(i, 1)
  list.splice(j, 0, x)
}
function copyFromBase() {
  form.overNodes = form.baseNodes.map(n => ({ ...n, key: 'o' + n.key }))
  ElMessage.success('已复制基础流程，按需加一级')
}

/** 抽样展示：这条规则在当前流程里会解析成谁 —— 配完能立刻验证，不用等一张单跑一遍 */
function resolveSample(type) {
  try {
    const amount = Math.max(1, Number(form.amountThreshold) || 0) + 1
    const nodes = oaNodesFor(cur.value.bizType, amount)
    const idx = nodes.findIndex(n => n.assigneeType === type)
    if (idx < 0) return '本单据未用'
    const p = oaPreviewFlow(cur.value.bizType, amount)
    const name = p[idx]?.handler || '待指派'
    const n = nodes[idx]
    return n.assigneeType === 'role'
      ? `${ROLE_CODES[n.roleCode] || n.roleCode} → ${name}`
      : name
  } catch { return '—' }
}

async function onSave() {
  if (!form.baseNodes.length) { ElMessage.error('至少保留一个审批节点，否则提交即通过'); return }
  if (form.baseNodes.some(n => !String(n.name || '').trim())) { ElMessage.error('节点名称不能为空'); return }
  if (form.overNodes.length && !form.amountThreshold) {
    ElMessage.error('配了超额流程，但阈值是 0 —— 这套节点永远走不到')
    return
  }
  try {
    await ElMessageBox.confirm(
      `修改后只影响新提交的《${cur.value.bizType}》。${cur.value.inFlight
        ? `当前 ${cur.value.inFlight} 张在途单仍按旧流程走完。` : ''}`,
      '保存流程配置', { confirmButtonText: '确认保存', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  saving.value = true
  try {
    updateOaFlow(cur.value.bizType, {
      baseNodes: form.baseNodes,
      overNodes: form.overNodes,
      amountThreshold: form.amountThreshold,
      note: form.note
    })
    /* 同步左栏的级数显示 */
    const f = flows.find(x => x.bizType === bizType.value)
    f.baseNodes = form.baseNodes.map(n => ({ ...n }))
    f.overNodes = form.overNodes.map(n => ({ ...n }))
    f.amountThreshold = form.amountThreshold
    f.note = form.note
    ElMessage.success('已保存，新提交的单将按新流程走')
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}

pick(flows[0].bizType)
</script>

<style scoped>
.fc-list { display: flex; flex-direction: column; gap: 6px; }
.fc-item { padding: 8px 10px; border-radius: 7px; cursor: pointer; border: 1px solid transparent; }
.fc-item:hover { background: var(--biz-bg-fill); }
.fc-item.is-on { background: rgba(91, 108, 255, .07); border-color: rgba(91, 108, 255, .28); }
.fc-item__n { font-size: 13px; }
.fc-item__m { margin-top: 2px; font-size: 11.5px; color: var(--biz-text-3); }
.fc-item__live {
  margin-left: 6px; padding: 0 5px; border-radius: 8px; font-size: 10.5px;
  background: rgba(217, 138, 31, .12); color: var(--biz-warning, #d98a1f);
}

.fc-threshold {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 9px 12px; border-radius: 7px; background: var(--biz-bg-fill); font-size: 12.5px;
}
.fc-threshold__k { color: var(--biz-text-3); }
.fc-threshold__u { color: var(--biz-text-3); }
.fc-threshold__h { color: var(--biz-text-2); }

.fc-nodes { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
.fc-node {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px;
  border: 1px solid var(--biz-border, #eef0f6); border-radius: 8px;
}
.fc-node__idx {
  flex: none; width: 20px; height: 20px; line-height: 20px; text-align: center; border-radius: 50%;
  font-family: var(--biz-font-num); font-size: 11.5px;
  background: rgba(91, 108, 255, .1); color: var(--biz-primary, #5b6cff); margin-top: 6px;
}
.fc-node__grid {
  flex: 1; display: grid; grid-template-columns: 1.25fr 1.05fr 0.8fr 0.85fr 0.75fr; gap: 8px; align-items: center;
}
.fc-node__ph { font-size: 12px; color: var(--biz-text-4, #a6adc1); text-align: center; }
.fc-node__acts { flex: none; display: flex; align-items: center; gap: 2px; padding-top: 4px; }
.fc-opt-hint { float: right; margin-left: 12px; font-size: 11px; color: var(--biz-text-4, #a6adc1); }
.fc-tab-hint { margin-left: 4px; font-size: 11px; color: var(--biz-text-4, #a6adc1); }

.fc-empty {
  padding: 12px; border-radius: 7px; background: var(--biz-bg-fill);
  font-size: 12.5px; color: var(--biz-text-3);
}
.fc-note-row { display: flex; gap: 12px; align-items: flex-start; margin-top: 14px; }
.fc-note-k { flex: none; width: 68px; font-size: 12.5px; color: var(--biz-text-3); padding-top: 7px; }
.fc-actions { display: flex; align-items: center; gap: 10px; margin-top: 16px; padding-top: 12px; border-top: 1px dashed var(--biz-border, #eef0f6); }

.fc-tip {
  display: flex; align-items: center; gap: 6px; margin-bottom: 10px; padding: 8px 11px;
  border-radius: 7px; font-size: 12px; line-height: 1.7;
  background: rgba(91, 108, 255, .06); color: var(--biz-text-2);
}
</style>
