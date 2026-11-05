<template>
  <div class="page">
    <AsyncBlock :loading="loading" :error="error" :empty="!data" empty-title="审批单不存在" empty-desc="可能已被删除或单号有误">
      <template v-if="data">
        <div class="panel" style="margin-top:0;">
          <div class="wo-hd">
            <div>
              <div class="wo-hd__t">{{ data.title }}</div>
              <div class="muted" style="font-size:12.5px;margin-top:4px;">
                {{ data.approvalNo }} · {{ data.bizType }} · {{ data.communityName }}
              </div>
            </div>
            <div class="wo-hd__r">
              <StatusTag domain="approval" :value="data.status" />
              <el-button :icon="'ArrowLeft'" @click="$router.back()">返回</el-button>
            </div>
          </div>
          <el-descriptions :column="4" border size="small" style="margin-top:14px;">
            <el-descriptions-item label="申请人">{{ data.applicant }}（{{ data.applicantRole }}）</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ data.applyTime }}</el-descriptions-item>
            <el-descriptions-item label="涉及金额">
              <span v-if="data.amount" class="money">¥ {{ money(data.amount) }}</span>
              <span v-else class="muted">—</span>
            </el-descriptions-item>
            <el-descriptions-item label="紧急度">
              <StatusTag domain="todoLevel" :value="data.urgency === '紧急' ? '紧急' : '一般'" />
            </el-descriptions-item>
            <el-descriptions-item label="当前节点">{{ data.currentNode }}</el-descriptions-item>
            <el-descriptions-item label="业务单号">{{ data.bizId || '—（无业务单号）' }}</el-descriptions-item>
            <el-descriptions-item label="等待时长">{{ data.waitHours }} 小时</el-descriptions-item>
            <el-descriptions-item label="流程节点数">{{ data.flow.length }}</el-descriptions-item>
          </el-descriptions>
        </div>

        <!-- OA 单据没有业务实体：只给标题和金额等于让人盲批，表单内容必须逐项展开 -->
        <div v-if="oaRows.length" class="panel" style="margin-top:16px;">
          <div class="sec__hd">
            <h4>申请内容</h4>
            <span class="desc">{{ data.bizType }} · {{ oaRows.length }} 项 · 提报人 {{ data.applicant }}（{{ data.applicantRole }}）</span>
          </div>
          <el-descriptions :column="3" border size="small" style="margin-top:12px;">
            <el-descriptions-item v-for="f in oaRows" :key="f.key" :label="f.label">
              <span v-if="f.type === 'money'" class="money">¥ {{ money(f.value) }}</span>
              <span v-else>{{ f.value }}{{ f.unit ? ' ' + f.unit : '' }}</span>
            </el-descriptions-item>
          </el-descriptions>
          <div v-if="(data.files || []).length" class="oa-files">
            附件：{{ data.files.map(f => f.name).join('、') }}
            <span class="muted">（原型只登记文件名，不存文件本体）</span>
          </div>
          <div class="oa-biz-note">
            本期审批<b>通过即结束</b>：不会自动生成付款单 / 写入考勤 / 生成采购单。
          </div>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:1fr 380px;">
          <div class="panel">
            <div class="sec__hd"><h4>审批流程</h4><span class="desc">同意后自动推进下一节点，全部节点通过即整单通过</span></div>
            <el-timeline style="margin-top:14px;padding-left:4px;">
              <el-timeline-item
                v-for="(n, i) in data.flow" :key="i"
                :type="n.action === '同意' ? 'success' : (n.action === '驳回' ? 'danger' : (n.action === '待处理' ? 'primary' : 'warning'))"
                :hollow="n.action === '待处理'"
                :timestamp="n.time || '待处理'"
              >
                <div style="font-size:13.5px;">
                  <b>{{ n.node }}</b>
                  <el-tag v-if="isSignNode(n)" size="small" effect="plain"
                    :type="n.signMode === 'any' ? 'info' : 'warning'" style="margin-left:6px;">
                    {{ n.signMode === 'any' ? '或签' : '会签' }}
                  </el-tag>
                  <StatusTag v-if="n.action !== '待处理'" domain="flowAction" :value="n.action" />
                  <span v-else class="muted"> · 待处理</span>
                  <span v-if="isSignNode(n)" class="muted" style="font-size:12.5px;">
                    · 已签 {{ signedCount(n) }}/{{ n.approvers.length }}
                  </span>
                </div>
                <!-- 会签：逐人列出签了没有。合成一行的话看不出"卡在谁那儿" -->
                <div v-if="isSignNode(n)" class="sign-list">
                  <div v-for="(p, k) in n.approvers" :key="k" class="sign-row" :class="`is-${p.action}`">
                    <span class="sign-row__n">{{ p.name }}</span>
                    <el-tag v-if="p.duty" size="small" effect="plain" type="info">{{ p.duty }}</el-tag>
                    <span class="sign-row__a">{{ p.action }}</span>
                    <span class="sign-row__t">{{ p.time || '' }}</span>
                    <span v-if="p.comment" class="sign-row__c">{{ p.comment }}</span>
                  </div>
                </div>
                <div v-else class="muted" style="font-size:12.5px;margin-top:2px;">
                  {{ n.handler || '待指派' }}<span v-if="n.comment"> · {{ n.comment }}</span>
                </div>
              </el-timeline-item>
            </el-timeline>
          </div>

          <div class="panel">
            <div class="sec__hd"><h4>处理</h4><span class="desc">原型阶段为内存态，刷新还原</span></div>
            <div v-if="canAct">
              <el-form label-width="72px" style="margin-top:12px;">
                <el-form-item label="处理意见">
                  <el-input v-model="comment" type="textarea" :rows="3" placeholder="同意 / 驳回理由，转办与加签时必填" />
                </el-form-item>
                <el-form-item v-if="act === '转办' || act === '加签'" label="处理人">
                  <el-select v-model="to" filterable style="width:100%" placeholder="选择转办 / 加签人">
                    <el-option v-for="c in candidates" :key="c.empId" :label="`${c.name} · ${c.position}`" :value="c.name" />
                  </el-select>
                </el-form-item>
              </el-form>
              <div class="dl-foot">
                <el-button type="success" :icon="'Select'" @click="doAct('同意')">同意</el-button>
                <el-button type="danger" :icon="'CloseBold'" @click="doAct('驳回')">驳回</el-button>
                <el-button :icon="'Switch'" @click="act = '转办'">转办</el-button>
                <el-button :icon="'CirclePlus'" @click="act = '加签'">加签</el-button>
              </div>
              <div v-if="act === '转办' || act === '加签'" class="muted" style="font-size:12.5px;margin-top:8px;">
                已选「{{ act }}」，选择处理人后点击对应按钮提交
                <el-button link type="primary" style="margin-left:6px;" @click="doAct(act)">提交{{ act }}</el-button>
              </div>
              <div v-if="signHint" class="sign-hint">{{ signHint }}</div>
            </div>
            <div v-else class="muted" style="font-size:13px;padding:12px 0;">
              该审批单已结束（{{ data.status }}），无需处理。
            </div>
          </div>
        </div>
      </template>
    </AsyncBlock>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import AsyncBlock from '@/components/AsyncBlock.vue'
import StatusTag from '@/components/StatusTag.vue'
import { useDetail } from '@/composables/useQuery'
import { approvalAction, approvalCandidates, getApproval, oaFieldRows } from '@/utils/api'
import { money } from '@/utils/format'

const route = useRoute()
const id = computed(() => route.params.id)
const { data, loading, error, load } = useDetail(getApproval, id)

/** OA 单据把表单内容存在 formData 里：按定义还原成 label + 值，没定义（业务单据）就是空 */
const oaRows = computed(() => (data.value ? oaFieldRows(data.value) : []))

const comment = ref('')
const to = ref('')
const act = ref('')
const candidates = approvalCandidates()
const canAct = computed(() => data.value && ['待审批', '审批中'].includes(data.value.status))

/** 会签节点 = approvers 多于一人。单人节点的 approvers 只有一条，按单签展示 */
const isSignNode = n => Array.isArray(n.approvers) && n.approvers.length > 1
const signedCount = n => (n.approvers || []).filter(p => p.action !== '待处理').length

/** 当前待处理节点的会签提示：说清"我签完还要等谁" */
const signHint = computed(() => {
  const n = data.value?.flow.find(x => x.action === '待处理')
  if (!n || !isSignNode(n)) return ''
  const left = n.approvers.filter(p => p.action === '待处理').map(p => p.name)
  if (n.signMode === 'any') return `或签：${left.join('、')} 任一人同意即通过，其余人不必再签。`
  return `会签：还需 ${left.join('、')} 同意。全部签完才会推进下一节点；其中任一人驳回，整单驳回。`
})

async function doAct(action) {
  if ((action === '转办' || action === '加签') && !to.value) {
    ElMessage.warning(`请先选择${action}人`)
    return
  }
  try {
    const a = approvalAction(id.value, action, { comment: comment.value, to: to.value })
    ElMessage.success(`${action}成功，当前状态：${a.status}`)
    comment.value = ''; to.value = ''; act.value = ''
    await load(id.value)
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}
</script>

<style scoped>
.wo-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.wo-hd__t { font-size: 17px; font-weight: 600; }
.wo-hd__r { display: flex; align-items: center; gap: 10px; }
.dl-foot { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }

.oa-files { margin-top: 10px; font-size: 12.5px; color: var(--biz-text-2); }
.oa-files .muted { color: var(--biz-text-3); font-size: 11.5px; }
.sign-list { margin-top: 6px; border-radius: 7px; background: var(--biz-bg-fill); padding: 6px 10px; }
.sign-row { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 2; }
.sign-row__n { font-weight: 500; color: var(--biz-text-1); }
.sign-row__a { color: var(--biz-text-2); }
.sign-row__t { color: var(--biz-text-3); font-family: var(--biz-font-num); }
.sign-row__c { color: var(--biz-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sign-row.is-待处理 .sign-row__a { color: var(--biz-warning, #d98a1f); }
.sign-row.is-驳回 .sign-row__a { color: var(--biz-danger, #e34d59); }
.sign-row.is-同意 .sign-row__a { color: var(--biz-success, #12b98a); }
.sign-row.is-已跳过 .sign-row__n, .sign-row.is-已跳过 .sign-row__a { color: var(--biz-text-3); text-decoration: line-through; }
.sign-hint {
  margin-top: 8px; padding: 7px 10px; border-radius: 7px; font-size: 11.5px; line-height: 1.7;
  background: var(--bg-warning, rgba(217, 138, 31, .1)); color: var(--biz-text-2);
}
.oa-biz-note {
  margin-top: 10px; padding: 8px 11px; border-radius: 7px; font-size: 12px; line-height: 1.75;
  background: var(--biz-bg-fill); color: var(--biz-text-3);
}
</style>
