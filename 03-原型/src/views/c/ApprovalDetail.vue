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
            <el-descriptions-item label="业务单号">{{ data.bizId }}</el-descriptions-item>
            <el-descriptions-item label="等待时长">{{ data.waitHours }} 小时</el-descriptions-item>
            <el-descriptions-item label="流程节点数">{{ data.flow.length }}</el-descriptions-item>
          </el-descriptions>
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
                  <StatusTag v-if="n.action !== '待处理'" domain="flowAction" :value="n.action" />
                  <span v-else class="muted"> · 待处理</span>
                </div>
                <div class="muted" style="font-size:12.5px;margin-top:2px;">
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
import { approvalAction, approvalCandidates, getApproval } from '@/utils/api'
import { money } from '@/utils/format'

const route = useRoute()
const id = computed(() => route.params.id)
const { data, loading, error, load } = useDetail(getApproval, id)

const comment = ref('')
const to = ref('')
const act = ref('')
const candidates = approvalCandidates()
const canAct = computed(() => data.value && ['待审批', '审批中'].includes(data.value.status))

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
</style>
