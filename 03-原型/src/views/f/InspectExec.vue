<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>巡检任务执行（移动端）</b>：这是移动端作业台的 PC 预览，<b>后台不提供执行入口</b> ——
        巡查巡检在现场完成，管理侧只做任务监管、模板与计划配置、报表。
        <template v-if="isSup">
          当前是<b>监督任务</b>：部门经理到下属责任区<b>实地核验</b>（不是看员工提交的表单），
          发现问题必须<b>指定责任员工</b>，否则考核归不到人。
        </template>
        <template v-else>
          同一套引擎跑三类载体：保洁「环节卡片流 + 拍照」、保安「扫码 + 流程」、工程「设备码 + 阈值」；
          正常项一键批量（1 秒），异常才展开拍照描述（30 秒），异常一键转工单避免二次录入。
        </template>
      </div>
    </div>

    <!-- 任务头 -->
    <div class="panel" style="margin-top:16px;">
      <div class="thead">
        <div class="thead__l">
          <div class="thead__t">
            {{ task.planName }}
            <StatusTag domain="inspect" :value="task.status" />
            <el-tag :type="isSup ? 'warning' : 'info'" effect="plain" size="small">{{ isSup ? '监督' : '执行' }}</el-tag>
            <span class="tag tag--muted">{{ isSup ? task.targetPost : task.post }}</span>
            <span class="tag tag--info">{{ template?.version }}</span>
          </div>
          <div class="thead__s">
            {{ task.taskId }} · {{ communityName }} · 计划时间 {{ task.scheduledDate }} {{ task.scheduledTime }} ·
            {{ isSup ? '监督人' : '执行人' }} {{ task.executor }} · 到位方式 {{ task.checkinType }}
            <template v-if="isSup"> · 被检班组 {{ targetDeptName }}</template>
          </div>
        </div>
        <div class="thead__r">
          <div class="prog">
            <div class="prog__n">{{ doneCount }}/{{ items.length }}</div>
            <div class="prog__d">已完成项</div>
          </div>
          <el-button :icon="'SwitchButton'" @click="batchNormal">全部正常</el-button>
          <el-button type="primary" :icon="'Select'" :loading="submitting" @click="submit">提交{{ isSup ? '核验' : '巡检' }}</el-button>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:250px minmax(0,1fr) 300px;">
      <!-- 左：任务列表 -->
      <div class="panel" style="padding:14px;">
        <div class="panel__hd"><h3>我的任务</h3><span class="spacer" /><span class="desc">{{ todayTasks.length }}</span></div>
        <div class="tlist">
          <div
            v-for="t in todayTasks" :key="t.taskId"
            class="titem" :class="{ 'is-on': t.taskId === taskId }"
            @click="switchTask(t.taskId)"
          >
            <div class="titem__n">
              <el-tag v-if="t.taskType === '监督'" type="warning" effect="plain" size="small" style="margin-right:4px;">监督</el-tag>
              {{ t.planName }}
            </div>
            <div class="titem__m">{{ t.post }} · {{ t.scheduledTime }} · {{ t.executor }}</div>
            <StatusTag domain="inspect" :value="t.status" />
          </div>
        </div>
      </div>

      <!-- 中：执行表单 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>{{ template?.name }}</h3>
          <span class="spacer" />
          <span class="desc">
            {{ isSup ? '按达标标准抽查，发现问题指定责任员工' : '默认合格（正常项免操作），异常才切换并拍照说明' }}
          </span>
        </div>

        <div class="cards">
          <div
            v-for="(it, i) in items" :key="it.label"
            class="icard" :class="it.state === 'ok' ? 'is-ok' : it.state === 'ng' ? 'is-ng' : ''"
          >
            <div class="icard__hd">
              <span class="icard__idx">{{ String(i + 1).padStart(2, '0') }}</span>
              <div class="icard__b">
                <div class="icard__t">
                  {{ it.label }}
                  <span v-if="it.required" class="req">*</span>
                  <span class="icard__type">{{ it.type }}</span>
                </div>
                <div class="icard__s">标准：{{ it.standard || (it.options || []).join(' / ') || '—' }}</div>
              </div>
              <el-radio-group v-model="it.state" size="small">
                <el-radio-button label="ok">{{ isSup ? '达标' : '合格' }}</el-radio-button>
                <el-radio-button label="ng">{{ isSup ? '不达标' : '异常' }}</el-radio-button>
              </el-radio-group>
            </div>

            <div v-if="it.state === 'ng'" class="icard__ng">
              <el-select v-model="it.reason" placeholder="问题类型" size="small" style="width:140px;">
                <el-option v-for="r in reasons" :key="r" :label="r" :value="r" />
              </el-select>
              <el-select
                v-if="isSup" v-model="it.responsibleName" filterable placeholder="责任员工（必选）"
                size="small" style="width:170px;" :class="{ 'is-req': !it.responsibleName }"
              >
                <el-option v-for="e in respOpts" :key="e.name" :label="e.label" :value="e.name" />
              </el-select>
              <el-input v-model="it.note" size="small" :placeholder="isSup ? '现场情况（可留空）' : '补充说明（必填）'" style="flex:1;min-width:120px;" />
              <el-button size="small" :icon="'Camera'">拍照</el-button>
              <el-button v-if="!isSup" size="small" type="warning" plain :icon="'Tools'" @click="toWorkOrder(it)">转工单</el-button>
            </div>
            <div v-else-if="it.state === 'ok'" class="icard__ok">
              <el-icon><CircleCheckFilled /></el-icon> 已确认{{ isSup ? '达标' : '合格' }}
              <span class="muted" style="font-size:11.5px;margin-left:6px;">{{ it.note || '无异常' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右：汇总 -->
      <div>
        <div class="panel">
          <div class="sec__hd"><h4>本次汇总</h4></div>
          <div class="stat">
            <div class="stat__i"><div class="stat__k">应检项</div><div class="stat__v">{{ items.length }}</div></div>
            <div class="stat__i"><div class="stat__k">已检项</div><div class="stat__v">{{ doneCount }}</div></div>
            <div class="stat__i">
              <div class="stat__k">{{ isSup ? '发现问题' : '异常项' }}</div>
              <div class="stat__v is-danger">{{ ngCount }}</div>
            </div>
            <div class="stat__i"><div class="stat__k">照片</div><div class="stat__v">{{ photoCount }}</div></div>
          </div>

          <div class="bar">
            <i :style="{ width: (items.length ? doneCount / items.length * 100 : 0) + '%' }" />
          </div>

          <template v-if="isSup">
            <div class="sec__hd" style="margin:18px 0 8px;"><h4>核验对象</h4></div>
            <div class="chk">
              <div>被检班组：{{ targetDeptName }}</div>
              <div>被检岗位：{{ task.targetPost }}</div>
              <div class="muted">责任员工候选：{{ respOpts.length }} 人</div>
              <div v-if="!ngCount" class="muted">未标记不达标时，提交视为「本次抽查全部达标」</div>
            </div>
          </template>

          <div class="sec__hd" style="margin:18px 0 8px;"><h4>到位与定位</h4></div>
          <div class="chk">
            <div><el-icon color="#12b98a"><CircleCheckFilled /></el-icon> {{ task.checkinType }} 打卡通过</div>
            <div class="muted">GPS {{ task.gps }}</div>
            <div class="muted">与点位偏差 8 米（阈值 50 米）</div>
          </div>

          <el-input v-model="remark" type="textarea" :rows="2" :placeholder="isSup ? '核验结论（选填）' : '巡检小结（选填）'" style="margin-top:14px;" />

          <el-button type="primary" plain style="width:100%;margin-top:12px;" :loading="submitting" @click="submit">
            提交（{{ doneCount }}/{{ items.length }}）
          </el-button>
          <div class="hint">
            {{ isSup
              ? '问题项未指定责任员工时不允许提交；若本班组当日有「零异常」申报，系统会标出冲突。'
              : '未完成项提交后记为「逾期」，逾期率计入项目经理考核。' }}
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>{{ isSup ? '历史核验' : '历史评分' }}</h4></div>
          <div class="score">
            <div class="score__n">{{ task.score || '-' }}</div>
            <div class="score__d">
              上次{{ isSup ? '核验' : '质检' }}得分 · 复核人 {{ task.reviewer || '未复核' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  INSPECT_ISSUE_REASONS, inspectExecData, orgNameOf, responsibilityOpts, submitInspectResult
} from '@/api'
import StatusTag from '@/components/StatusTag.vue'

const route = useRoute()
/** 支持 #/f/inspect?task=IT00049 直达某条任务（任务列表抽屉里会带过来） */
const taskId = ref(String(route.query.task || 'IT00006'))
const data = computed(() => inspectExecData(taskId.value))
const task = computed(() => data.value.task)
const template = computed(() => data.value.template)
const communityName = computed(() => data.value.communityName)
const todayTasks = computed(() => data.value.todayTasks)
const isSup = computed(() => task.value.taskType === '监督')
const targetDeptName = computed(() => orgNameOf(task.value.targetDept))

const reasons = ref([...INSPECT_ISSUE_REASONS, '保洁不到位', '设施损坏', '标识缺失', '记录不全'])
const respOpts = computed(() => responsibilityOpts(task.value))

const items = ref([])
const remark = ref('')
const submitting = ref(false)

/** 按当前任务的模板重建检查项；已存在的异常项（历史）带入责任员工 */
function buildItems(tpl, t) {
  const exist = new Map((t?.issueItems || []).map(i => [i.item, i]))
  return (tpl?.fields || []).map(f => {
    const old = exist.get(f.label)
    return {
      label: f.label, type: f.type, required: f.required,
      standard: f.standard, options: f.options || [],
      state: old ? 'ng' : 'ok',
      reason: old?.reason || '',
      note: old?.note || '',
      responsibleName: old?.responsibleName || ''
    }
  })
}
watch(taskId, () => {
  items.value = buildItems(template.value, task.value)
  remark.value = task.value.remark || ''
}, { immediate: true })

function switchTask(id) {
  if (id === taskId.value) return
  taskId.value = id
}

const doneCount = computed(() => items.value.filter(i => i.state === 'ok' || i.state === 'ng').length)
const ngCount = computed(() => items.value.filter(i => i.state === 'ng').length)
const photoCount = computed(() => items.value.filter(i => i.state).length)

function batchNormal() {
  items.value.forEach(i => { i.state = 'ok' })
  ElMessage.success(isSup.value ? '未填项已批量标记为「达标」' : '未填项已批量标记为合格')
}

function toWorkOrder(it) {
  if (!it.note) { ElMessage.error('请先填写异常说明'); return }
  ElMessage.success(`已生成报修工单（来源：巡检）· ${it.label}：${it.reason || '待判定'}`)
}

function submit() {
  if (!doneCount.value) { ElMessage.error('请至少完成一项'); return }
  /* 监督任务：问题项必须先选责任员工，把校验前置到提交前，避免后端抛错 */
  if (isSup.value) {
    const miss = items.value.find(i => i.state === 'ng' && !i.responsibleName)
    if (miss) { ElMessage.error(`问题项「${miss.label}」必须指定责任员工`); return }
  }
  submitting.value = true
  try {
    const r = submitInspectResult(taskId.value, {
      items: items.value.map(i => ({ ...i })),
      remark: remark.value
    })
    const tail = isSup.value
      ? `，发现问题 ${r.issueCount} 项${r.conflictFlag ? '（存在与员工申报的冲突，已标记）' : ''}`
      : `，异常 ${r.issueCount} 项`
    ElMessage.success(`已提交：${r.normalCount} 项达标${tail}`)
  } catch (e) {
    ElMessage.error(e?.message || '提交失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.thead { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.thead__l { flex: 1; min-width: 320px; }
.thead__t { display: flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 600; flex-wrap: wrap; }
.thead__s { font-size: 12.5px; color: var(--biz-text-3); margin-top: 6px; }
.thead__r { display: flex; align-items: center; gap: 10px; }
.prog { text-align: right; margin-right: 6px; }
.prog__n { font-family: var(--biz-font-num); font-size: 22px; font-weight: 600; color: var(--el-color-primary); }
.prog__d { font-size: 11.5px; color: var(--biz-text-3); }

.tlist { max-height: 560px; overflow-y: auto; }
.titem { padding: 10px; border-radius: 8px; cursor: pointer; margin-bottom: 6px; background: var(--biz-bg-fill); }
.titem:hover { background: var(--biz-bg-hover); }
.titem.is-on { background: rgba(91,108,255,.08); box-shadow: inset 0 0 0 1px rgba(91,108,255,.3); }
.titem__n { font-size: 12.5px; font-weight: 500; margin-bottom: 3px; }
.titem__m { font-size: 11px; color: var(--biz-text-3); margin-bottom: 6px; }

.cards { display: flex; flex-direction: column; gap: 10px; max-height: 560px; overflow-y: auto; padding-right: 4px; }
.icard { border: 1px solid var(--biz-border-light); border-radius: 10px; padding: 12px 14px; transition: all .15s; }
.icard.is-ok { border-color: rgba(46,217,163,.4); background: rgba(46,217,163,.04); }
.icard.is-ng { border-color: rgba(255,107,107,.4); background: rgba(255,107,107,.04); }
.icard__hd { display: flex; align-items: center; gap: 10px; }
.icard__idx { font-family: var(--biz-font-num); font-size: 13px; color: var(--biz-text-4); width: 22px; }
.icard__b { flex: 1; min-width: 0; }
.icard__t { font-size: 13.5px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
.icard__type { font-size: 10.5px; color: var(--biz-text-3); background: #fff; border: 1px solid var(--biz-border-light); border-radius: 999px; padding: 0 6px; }
.icard__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 3px; }
.req { color: var(--el-color-danger); }
.icard__ng { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--biz-border); flex-wrap: wrap; }
.icard__ng .is-req :deep(.el-select__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.icard__ok { display: flex; align-items: center; gap: 5px; margin-top: 8px; font-size: 12px; color: var(--biz-success); }

.stat { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.stat__i { background: var(--biz-bg-fill); border-radius: 10px; padding: 10px 12px; }
.stat__k { font-size: 11.5px; color: var(--biz-text-3); }
.stat__v { font-family: var(--biz-font-num); font-size: 20px; font-weight: 600; margin-top: 2px; }
.stat__v.is-danger { color: var(--biz-danger); }
.bar { height: 6px; border-radius: 999px; background: var(--biz-bg-fill); overflow: hidden; margin-top: 12px; }
.bar i { display: block; height: 6px; border-radius: 999px; background: var(--biz-gradient); transition: width .2s; }

.chk { font-size: 12px; color: var(--biz-text-2); display: flex; flex-direction: column; gap: 5px; }
.hint { margin-top: 10px; font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.score__n { font-family: var(--biz-font-num); font-size: 26px; font-weight: 600; color: var(--biz-text-1); }
.score__d { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
</style>
