<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>巡检任务执行</b>：同一套引擎跑三类载体——保洁「环节卡片流 + 拍照」、保安「扫码 + 流程」、工程「设备码 + 阈值」。
        设计原则：正常项一键批量（1 秒），异常才展开拍照描述（30 秒）；异常一键转工单，避免二次录入。
      </div>
    </div>

    <!-- 任务头 -->
    <div class="panel" style="margin-top:16px;">
      <div class="thead">
        <div class="thead__l">
          <div class="thead__t">
            {{ task.planName }}
            <StatusTag domain="inspect" :value="task.status" />
            <span class="tag tag--muted">{{ task.post }}</span>
            <span class="tag tag--info">{{ template.version }}</span>
          </div>
          <div class="thead__s">
            {{ task.taskId }} · {{ communityName }} · 计划时间 {{ task.scheduledDate }} {{ task.scheduledTime }} ·
            执行人 {{ task.executor }} · 到位方式 {{ task.checkinType }}
          </div>
        </div>
        <div class="thead__r">
          <div class="prog">
            <div class="prog__n">{{ doneCount }}/{{ items.length }}</div>
            <div class="prog__d">已完成项</div>
          </div>
          <el-button :icon="'SwitchButton'" @click="batchNormal">全部正常</el-button>
          <el-button type="primary" :icon="'Select'" :loading="submitting" @click="submit">提交巡检</el-button>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:250px minmax(0,1fr) 300px;">
      <!-- 左：任务列表 -->
      <div class="panel" style="padding:14px;">
        <div class="panel__hd"><h3>今日任务</h3><span class="spacer" /><span class="desc">{{ todayTasks.length }}</span></div>
        <div class="tlist">
          <div
            v-for="t in todayTasks" :key="t.taskId"
            class="titem" :class="{ 'is-on': t.taskId === task.taskId }"
          >
            <div class="titem__n">{{ t.planName }}</div>
            <div class="titem__m">{{ t.post }} · {{ t.scheduledTime }} · {{ t.executor }}</div>
            <StatusTag domain="inspect" :value="t.status" />
          </div>
        </div>
      </div>

      <!-- 中：执行表单 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>{{ template.name }}</h3>
          <span class="spacer" />
          <span class="desc">默认合格（正常项免操作），异常才切换并拍照说明</span>
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
                <div class="icard__s">标准：{{ it.standard }}</div>
              </div>
              <el-radio-group v-model="it.state" size="small">
                <el-radio-button label="ok">合格</el-radio-button>
                <el-radio-button label="ng">异常</el-radio-button>
              </el-radio-group>
            </div>

            <div v-if="it.state === 'ng'" class="icard__ng">
              <el-select v-model="it.reason" placeholder="异常类型" size="small" style="width:150px;">
                <el-option v-for="r in reasons" :key="r" :label="r" :value="r" />
              </el-select>
              <el-input v-model="it.note" size="small" placeholder="补充说明（必填）" style="flex:1;" />
              <el-button size="small" :icon="'Camera'">拍照</el-button>
              <el-button size="small" type="warning" plain :icon="'Tools'" @click="toWorkOrder(it)">转工单</el-button>
            </div>
            <div v-else-if="it.state === 'ok'" class="icard__ok">
              <el-icon><CircleCheckFilled /></el-icon> 已确认合格
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
            <div class="stat__i"><div class="stat__k">异常项</div><div class="stat__v is-danger">{{ ngCount }}</div></div>
            <div class="stat__i"><div class="stat__k">照片</div><div class="stat__v">{{ photoCount }}</div></div>
          </div>

          <div class="bar">
            <i :style="{ width: (doneCount / items.length * 100) + '%' }" />
          </div>

          <div class="sec__hd" style="margin:18px 0 8px;"><h4>到位与定位</h4></div>
          <div class="chk">
            <div><el-icon color="#12b98a"><CircleCheckFilled /></el-icon> {{ task.checkinType }} 打卡通过</div>
            <div class="muted">GPS {{ task.gps }}</div>
            <div class="muted">与点位偏差 8 米（阈值 50 米）</div>
          </div>

          <el-input v-model="remark" type="textarea" :rows="2" placeholder="巡检小结（选填）" style="margin-top:14px;" />

          <el-button type="primary" plain style="width:100%;margin-top:12px;" :loading="submitting" @click="submit">
            提交（{{ doneCount }}/{{ items.length }}）
          </el-button>
          <div class="hint">未完成项提交后记为「逾期」，逾期率计入项目经理考核。</div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>历史评分</h4></div>
          <div class="score">
            <div class="score__n">{{ task.score || '-' }}</div>
            <div class="score__d">上次质检得分 · 复核人 {{ task.reviewer || '未复核' }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { inspectExecData } from '@/utils/api'
import StatusTag from '@/components/StatusTag.vue'

// 固定演示任务：保洁责任区日检（待执行）。数据拼装收归 api，页面只消费
const { task, template, communityName, todayTasks } = inspectExecData('IT00006')

const reasons = ['保洁不到位', '设施损坏', '安全隐患', '标识缺失', '记录不全']

const items = reactive(template.fields.map(f => ({
  label: f.label, type: f.type, required: f.required, standard: f.standard,
  state: 'ok', reason: '', note: ''
})))

const remark = ref('')
const submitting = ref(false)

const doneCount = computed(() => items.filter(i => i.state === 'ok' || i.state === 'ng').length)
const ngCount = computed(() => items.filter(i => i.state === 'ng').length)
const photoCount = computed(() => items.filter(i => i.state).length) // 原型：完成项默认带 1 张

function batchNormal() {
  items.forEach(i => { if (!i.state) i.state = 'ok' })
  ElMessage.success('未填项已批量标记为合格')
}

function toWorkOrder(it) {
  if (!it.note) { ElMessage.error('请先填写异常说明'); return }
  ElMessage.success(`已生成报修工单（来源：巡检）· ${it.label}：${it.reason || '待判定'}`)
}

function submit() {
  if (!doneCount.value) { ElMessage.error('请至少完成一项'); return }
  if (items.some(i => i.state === 'ng' && !i.note)) {
    ElMessage.error('异常项必须填写说明'); return
  }
  submitting.value = true
  setTimeout(() => {
    submitting.value = false
    ElMessage.success(`巡检已提交：${doneCount.value} 项已检，${ngCount.value} 项异常`)
  }, 600)
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
.icard__ng { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--biz-border); }
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
