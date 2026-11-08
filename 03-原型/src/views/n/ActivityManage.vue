<!--
  邻里 · 活动管理
  ------------------------------------------------------------
  **类别**（敬老 / 亲子 / 文体 / 出游 / 公益）与**收费方式**（免费 / 收费）是两个维度，
  不是二选一：敬老茶话会免费，敬老一日游可以收成本费。2026-11-07 之前这两个维度
  挤在 type 一个字段里，列表上会同时出现「亲子 · 免费」和「收费 · 收费」。
  收费场次有三个不能省的字段：**成团下限**、**退款分档**、**是否投保**。
  少了成团下限，钱收了团没成、退款没依据；少了退款分档，
  取消时只能凭人情拍脑袋 —— 而这件事每场活动都会发生。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>活动管理</b>：业主端「邻里 · 活动」的内容源。<b>类别</b>（敬老 / 亲子 / 文体 / 出游 / 公益）
        与<b>收费方式</b>（免费 / 收费）分开填 —— 它们是两个维度，不是二选一。
        收费按<b>成本分摊</b>（车费、门票、餐费），不写「旅游」——
        以旅游名义收费需要《旅行社业务经营许可证》。
        <br />
        <b>成团下限</b>是收费场次的必填项：报名截止后未达下限就进「待成行」，
        由运营点「确认流团」触发<b>全额原路退款</b>。少了这一态，钱收了团没成，
        活动当天业主自己发现没车来接 —— 然后在群里炸。
        <br />
        <b>退款按分档算</b>：距开始 ≥7 天全退、≥3 天退一半、之后不退。分档写在活动上而不是代码里，
        每场活动的成本结构不一样。
        <br />
        出行人证件号<b>只在开启投保时收集</b>，且仅用于购买当日意外险；活动结束后应做脱敏。
      </div>
    </div>

    <div class="grid astats">
      <div class="panel astat">
        <div class="astat__k">报名中</div>
        <div class="astat__v">{{ st.running }} <span class="unit">场</span></div>
        <div class="astat__s">累计已报 {{ st.enrollPeople }} 人次</div>
      </div>
      <div class="panel astat">
        <div class="astat__k">待成行</div>
        <div class="astat__v" :class="{ 'is-warn': st.waiting }">{{ st.waiting }} <span class="unit">场</span></div>
        <div class="astat__s">{{ st.waiting ? `一共还差 ${st.gapTotal} 人成团` : '没有卡在成团线上的活动' }}</div>
      </div>
      <div class="panel astat">
        <div class="astat__k">已成行</div>
        <div class="astat__v is-ok">{{ st.odd }} <span class="unit">场</span></div>
        <div class="astat__s">已过截止且达到下限</div>
      </div>
      <div class="panel astat">
        <div class="astat__k">已收活动费</div>
        <div class="astat__v">¥ {{ money(st.paidAmount) }}</div>
        <div class="astat__s">计入营业收入 · 走开票池</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters">
        <el-input v-model="q.kw" clearable placeholder="活动名称 / 编号 / 地点" :prefix-icon="'Search'"
          style="width:230px;" @keyup.enter="applyFilter" />
        <el-select v-model="q.communityId" clearable placeholder="全部项目" style="width:150px;" @change="applyFilter">
          <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="q.category" clearable placeholder="全部类别" style="width:120px;" @change="applyFilter">
          <el-option v-for="c in ACTIVITY_CATEGORIES" :key="c" :label="c" :value="c" />
        </el-select>
        <el-select v-model="q.phase" clearable placeholder="全部状态" style="width:130px;" @change="applyFilter">
          <el-option v-for="p in ACTIVITY_PHASES" :key="p" :label="p" :value="p" />
        </el-select>
        <el-button type="primary" :icon="'Search'" @click="applyFilter">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
        <span class="spacer" />
        <el-button v-if="canEdit" type="primary" plain :icon="'Plus'" @click="openCreate">新建活动</el-button>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>活动列表</h3>
        <span class="spacer" />
        <span class="desc">按开始时间倒序 · 共 {{ total }} 场</span>
      </div>

      <el-table :data="rows" stripe v-loading="loading" style="width:100%">
        <el-table-column label="活动" min-width="240">
          <template #default="{ row }">
            <div class="a-t">{{ row.title }}</div>
            <div class="sub">
              <span class="mono">{{ row.activityId }}</span> · {{ row.communityName }} · {{ row.organizer }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类别 / 费用" width="164">
          <template #default="{ row }">
            <el-tag size="small" :type="row.fee > 0 ? 'warning' : 'success'" effect="plain" class="nowrap">
              {{ row.category }} · {{ row.feeType }}
            </el-tag>
            <div class="sub">{{ row.feeText }}</div>
          </template>
        </el-table-column>
        <el-table-column label="时间 / 地点" width="190">
          <template #default="{ row }">
            <div class="sub">{{ row.startAt.slice(0, 16) }}</div>
            <div class="sub ellip" :title="row.place">{{ row.place }}</div>
          </template>
        </el-table-column>
        <el-table-column label="报名" width="180">
          <template #default="{ row }">
            <el-progress :percentage="row.fillRate" :stroke-width="6" :show-text="false"
              :color="row.phase === '待成行' ? '#d98a1f' : row.over ? '#d64545' : '#2f9e6e'" />
            <div class="sub">
              {{ row.enrolled }} / {{ row.capacity }} 人
              <template v-if="row.over">&nbsp;<span class="warn-txt">超 {{ row.over }}</span></template>
              <template v-else-if="row.minCapacity">· 下限 {{ row.minCapacity }}</template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.phaseType" effect="plain">{{ row.phase }}</el-tag>
            <div v-if="row.phase === '待成行'" class="sub warn-txt">差 {{ row.gap }} 人</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" align="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goEnrolls(row)">名单</el-button>
            <template v-if="row.phase === '草稿' && canEdit">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link type="primary" size="small" @click="doPublish(row)">发布</el-button>
            </template>
            <template v-else-if="row.phase === '待成行' && canEdit">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link type="warning" size="small" @click="openFlow(row)">确认流团</el-button>
            </template>
            <template v-else-if="row.phase === '报名中' && canEdit">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="doEnd(row)">结束</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState title="没有符合条件的活动" desc="换个筛选条件，或点右上角「新建活动」" />
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="pageNo" v-model:page-size="size" :total="total"
          :page-sizes="PAGE_SIZES" layout="total, sizes, prev, pager, next" background
          @current-change="load" @size-change="onSize"
        />
      </div>
    </div>

    <!-- 新建 / 编辑 -->
    <el-drawer v-model="ed.visible" :title="ed.activityId ? '编辑活动' : '新建活动'" size="640px" :close-on-click-modal="false">
      <el-form label-width="100px" label-position="right">
        <el-form-item label="活动名称" required>
          <el-input v-model="ed.title" maxlength="40" show-word-limit placeholder="如：邻里出游 · 青城前山一日游" />
        </el-form-item>

        <el-form-item label="活动类别" required>
          <el-select v-model="ed.category" placeholder="选一个类别" style="width:180px;">
            <el-option v-for="c in ACTIVITY_CATEGORIES" :key="c" :label="c" :value="c" />
          </el-select>
          <span class="hint" style="margin-left:10px;">类别与收费是两回事：敬老活动也可以收成本费</span>
        </el-form-item>

        <el-form-item label="收费方式" required>
          <el-radio-group v-model="ed.feeMode">
            <el-radio-button value="免费">免费</el-radio-button>
            <el-radio-button value="收费">收费（成本分摊）</el-radio-button>
          </el-radio-group>
          <div class="hint">
            {{ ed.feeMode === '收费'
              ? '收费只做成本分摊（车费 / 门票 / 餐费），不要写成「旅游产品」—— 那是旅行社业务'
              : '不收款的场次只需报名与签到' }}
          </div>
        </el-form-item>

        <el-form-item label="所属项目" required>
          <el-select v-model="ed.communityId" placeholder="活动范围按项目算" style="width:100%">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="活动时间" required>
          <el-date-picker v-model="ed.startAt" type="datetime" value-format="YYYY-MM-DD HH:mm"
            placeholder="开始" style="width:186px" />
          <span class="hint" style="margin:0 8px;">至</span>
          <el-date-picker v-model="ed.endAt" type="datetime" value-format="YYYY-MM-DD HH:mm"
            placeholder="结束" style="width:186px" />
        </el-form-item>

        <el-form-item label="报名截止" required>
          <el-date-picker v-model="ed.enrollDeadline" type="date" value-format="YYYY-MM-DD"
            placeholder="截止日期" style="width:186px" />
          <span class="hint" style="margin-left:10px;">不能晚于活动开始</span>
        </el-form-item>

        <el-form-item label="地点" required>
          <el-input v-model="ed.place" maxlength="60" placeholder="写清集合点，别只写景区名" />
        </el-form-item>

        <el-form-item label="名额" required>
          <el-input-number v-model="ed.capacity" :min="1" :max="2000" controls-position="right" style="width:140px;" />
          <span class="hint" style="margin-left:10px;">人（含同行人）</span>
        </el-form-item>

        <el-form-item label="每户限报">
          <el-input-number v-model="ed.attendeeLimit" :min="1" :max="10" controls-position="right" style="width:140px;" />
          <span class="hint" style="margin-left:10px;">人 · 防止一户报满全场</span>
        </el-form-item>

        <template v-if="ed.feeMode === '收费'">
          <el-divider content-position="left"><span class="div-t">收费设置</span></el-divider>

          <el-form-item label="单价" required>
            <el-input-number v-model="ed.fee" :min="0.01" :max="100000" :precision="2" :step="10"
              controls-position="right" style="width:160px;" />
            <span class="hint" style="margin-left:10px;">元 / 人</span>
          </el-form-item>

          <el-form-item label="成团下限" required>
            <el-input-number v-model="ed.minCapacity" :min="1" :max="ed.capacity || 1"
              controls-position="right" style="width:160px;" />
            <span class="hint" style="margin-left:10px;">人 · 截止时不足则整场退款</span>
          </el-form-item>

          <el-form-item label="退款分档" required>
            <div class="rf-box">
              <div v-for="(p, i) in ed.refundPolicy" :key="i" class="rf-row">
                <span class="hint">距开始 ≥</span>
                <el-input-number v-model="p.days" :min="0" :max="60" size="small"
                  controls-position="right" style="width:96px" />
                <span class="hint">天，退</span>
                <el-input-number v-model="p.ratio" :min="0" :max="100" :step="10" size="small"
                  controls-position="right" style="width:104px" />
                <span class="hint">%</span>
                <el-button link type="danger" :disabled="ed.refundPolicy.length <= 1"
                  @click="ed.refundPolicy.splice(i, 1)">删</el-button>
              </div>
              <el-button link type="primary" :disabled="ed.refundPolicy.length >= 4" @click="addTier">
                + 添加一档
              </el-button>
              <div class="hint">
                按提前天数从高到低匹配，命中即止。最后补一档「≥0 天，退 0%」表示临期不退。
              </div>
            </div>
          </el-form-item>

          <el-form-item label="费用包含">
            <el-input v-model="ed.feeInclude" maxlength="80" placeholder="往返大巴、门票、午餐、意外险" />
          </el-form-item>
          <el-form-item label="费用不含">
            <el-input v-model="ed.feeExclude" maxlength="80" placeholder="索道、个人消费" />
          </el-form-item>

          <el-form-item label="需要投保">
            <el-switch v-model="ed.needInsurance" />
            <span class="hint" style="margin-left:10px;">
              开启后报名必须填每位出行人的证件号 —— <b>仅用于购买当日意外险</b>，活动结束后脱敏
            </span>
          </el-form-item>
        </template>

        <el-form-item label="活动说明">
          <el-input v-model="ed.desc" type="textarea" :rows="3" maxlength="200" show-word-limit
            placeholder="行程安排、注意事项、取消规则" />
        </el-form-item>
      </el-form>

      <div class="drawer-tip">
        保存后是<b>草稿</b>，不会出现在业主端。确认名额、费用与退款规则后再点「发布」。
        已有人报名的活动<b>不能改单价</b>（已收金额会对不上），也不能把名额改到小于已报名人数。
      </div>

      <template #footer>
        <el-button @click="ed.visible = false">取消</el-button>
        <el-button type="primary" :loading="ed.saving" @click="saveForm">保存草稿</el-button>
      </template>
    </el-drawer>

    <!-- 确认流团 -->
    <el-dialog v-model="flow.visible" title="确认流团（未达成团人数）" width="520" :close-on-click-modal="false">
      <template v-if="flow.row">
        <div class="flow-brief">
          <div class="flow-brief__t">{{ flow.row.title }}</div>
          <div class="flow-brief__m">
            下限 {{ flow.row.minCapacity }} 人 · 实报 {{ flow.row.enrolled }} 人 ·
            <span class="warn-txt">还差 {{ flow.row.gap }} 人</span>
          </div>
        </div>

        <div class="flow-calc">
          <div class="flow-calc__row">
            <span>需退款报名</span><b>{{ flow.row.enrolled }} 人次</b>
          </div>
          <div class="flow-calc__row">
            <span>退款金额（全额原路退）</span>
            <b class="money">¥ {{ money(flow.row.paidAmount) }}</b>
          </div>
        </div>

        <el-form label-width="80px" style="margin-top:12px;">
          <el-form-item label="流团原因" required>
            <el-input v-model="flow.reason" type="textarea" :rows="2" maxlength="60" show-word-limit
              placeholder="如：报名未达 20 人下限，按规则取消并全额退款" />
          </el-form-item>
        </el-form>

        <div class="flow-tip">
          确认后：活动置为「已流团」，所有报名自动置为「已退款」并记录退款金额与时间。
          业主端会收到一条取消通知。<b>这个动作不可撤销。</b>
        </div>
      </template>
      <template #footer>
        <el-button @click="flow.visible = false">取消</el-button>
        <el-button type="danger" :loading="flow.saving" @click="doFlow">确认流团并退款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRouter } from 'vue-router'
import {
  ACTIVITY_CATEGORIES, ACTIVITY_PHASES, activityStats, canEditActivities,
  confirmFlow, endActivity, publishActivity, queryActivities, saveActivity
} from '@/api/neighbor'
import { PAGE_SIZES, communityOpts } from '@/api/shared'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'

const router = useRouter()
const canEdit = computed(() => canEditActivities())
const cmOpts = communityOpts()

const q = reactive({ kw: '', communityId: '', category: '', phase: '' })
const pageNo = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const st = ref({ total: 0, running: 0, waiting: 0, odd: 0, flowed: 0, paidAmount: 0, enrollPeople: 0, gapTotal: 0 })

async function load() {
  loading.value = true
  try {
    const res = await queryActivities({ pageNo: pageNo.value, size: size.value, filters: { ...q } })
    rows.value = res.rows
    total.value = res.total
    st.value = activityStats()
  } catch (e) {
    ElMessage.error(e?.message || '活动列表加载失败')
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function resetFilter() { Object.assign(q, { kw: '', communityId: '', category: '', phase: '' }); applyFilter() }
function onSize() { pageNo.value = 1; load() }
function goEnrolls(row) { router.push(`/n/activities/${row.activityId}/enrolls`) }

/* ---------------- 表单 ---------------- */
const ed = reactive({
  visible: false, saving: false, activityId: '',
  title: '', category: '文体', feeMode: '免费', communityId: '', startAt: '', endAt: '', place: '',
  capacity: 40, attendeeLimit: 2, enrollDeadline: '',
  fee: null, minCapacity: null, feeInclude: '', feeExclude: '', needInsurance: false,
  refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
  desc: ''
})

function addTier() {
  if (ed.refundPolicy.length >= 4) return
  ed.refundPolicy.push({ days: 1, ratio: 20 })
}

function openCreate() {
  Object.assign(ed, {
    visible: true, saving: false, activityId: '',
    title: '', category: '文体', feeMode: '免费', communityId: cmOpts[0]?.id || '', startAt: '', endAt: '', place: '',
    capacity: 40, attendeeLimit: 2, enrollDeadline: '',
    fee: null, minCapacity: null, feeInclude: '', feeExclude: '', needInsurance: false,
    refundPolicy: [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
    desc: ''
  })
}

function openEdit(row) {
  Object.assign(ed, {
    visible: true, saving: false, activityId: row.activityId,
    title: row.title, category: row.category, feeMode: row.fee > 0 ? '收费' : '免费',
    communityId: row.communityId,
    startAt: row.startAt, endAt: row.endAt, place: row.place,
    capacity: row.capacity, attendeeLimit: row.attendeeLimit, enrollDeadline: row.enrollDeadline,
    fee: row.fee || null, minCapacity: row.minCapacity || null,
    feeInclude: row.feeInclude, feeExclude: row.feeExclude, needInsurance: row.needInsurance,
    refundPolicy: row.refundPolicy.length
      ? row.refundPolicy.map(p => ({ ...p }))
      : [{ days: 7, ratio: 100 }, { days: 3, ratio: 50 }, { days: 0, ratio: 0 }],
    desc: row.desc
  })
}

async function saveForm() {
  /* 选了收费却没填单价，后端会当成免费活动静默通过 —— 这类错最贵，先拦在提交前 */
  if (ed.feeMode === '收费' && !(Number(ed.fee) > 0)) {
    ElMessage.warning('选了「收费」就要填单价；不收费请选「免费」')
    return
  }
  ed.saving = true
  try {
    await saveActivity({
      title: ed.title,
      category: ed.category,
      communityId: ed.communityId,
      startAt: ed.startAt,
      endAt: ed.endAt,
      place: ed.place,
      capacity: ed.capacity,
      attendeeLimit: ed.attendeeLimit,
      enrollDeadline: ed.enrollDeadline,
      fee: ed.feeMode === '收费' ? ed.fee : 0,
      minCapacity: ed.feeMode === '收费' ? ed.minCapacity : 0,
      feeInclude: ed.feeInclude,
      feeExclude: ed.feeExclude,
      needInsurance: ed.feeMode === '收费' ? ed.needInsurance : false,
      refundPolicy: ed.feeMode === '收费' ? ed.refundPolicy : [],
      desc: ed.desc
    }, ed.activityId)
    ElMessage.success(ed.activityId ? '已保存' : '已存为草稿，确认后点「发布」')
    ed.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    ed.saving = false
  }
}

async function doPublish(row) {
  try {
    await ElMessageBox.confirm(
      `发布后业主端立刻可见，报名按「${row.capacity} 人 / ${row.feeText}」执行。确认发布？`,
      '发布活动',
      { confirmButtonText: '确认发布', cancelButtonText: '再想想', type: 'warning' }
    )
  } catch { return }
  try {
    await publishActivity(row.activityId)
    ElMessage.success('已发布')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '发布失败')
  }
}

async function doEnd(row) {
  try {
    await ElMessageBox.confirm('结束后不再接收报名，已有报名保留。确认结束？', '结束活动',
      { confirmButtonText: '确认结束', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  try {
    await endActivity(row.activityId)
    ElMessage.success('已结束')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

/* ---------------- 流团 ---------------- */
const flow = reactive({ visible: false, saving: false, row: null, reason: '' })

function openFlow(row) {
  flow.row = row
  flow.reason = `报名 ${row.enrolled} 人未达 ${row.minCapacity} 人下限，按规则取消并全额退款`
  flow.visible = true
}

async function doFlow() {
  if (!flow.reason.trim()) { ElMessage.warning('请填写流团原因'); return }
  flow.saving = true
  try {
    const res = await confirmFlow(flow.row.activityId, flow.reason)
    ElMessage.success(`已确认流团：${res.count} 笔报名处理，退款 ¥${money(res.refunded)}`)
    flow.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    flow.saving = false
  }
}

onMounted(load)
</script>

<style scoped>
.astats { margin-top: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.astat { padding: 14px 16px; }
.astat__k { font-size: 12.5px; color: var(--biz-text-3); }
.astat__v {
  font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px;
}
.astat__v.is-warn { color: var(--biz-warning, #d98a1f); }
.astat__v.is-ok { color: var(--biz-success, #2f9e6e); }
.astat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.astat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }

.filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filters .spacer { flex: 1; }
.a-t { font-size: 13px; color: var(--biz-text-1); }
.sub { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.mono { font-family: var(--biz-font-num); }
.money { font-family: var(--biz-font-num); }
.warn-txt { color: var(--biz-warning, #d98a1f); }
.ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nowrap { white-space: nowrap; }
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }

.hint { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; }
.div-t { font-size: 12px; color: var(--biz-text-3); }
.rf-box { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.rf-row { display: flex; align-items: center; gap: 6px; }

.drawer-tip {
  margin-top: 16px; padding: 10px 12px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 12px; line-height: 1.8; color: var(--biz-text-2);
}
.drawer-tip b { color: var(--biz-text-1); }

.flow-brief { padding: 10px 12px; border-radius: 8px; background: var(--biz-bg-fill); }
.flow-brief__t { font-size: 14px; color: var(--biz-text-1); font-weight: 600; }
.flow-brief__m { font-size: 12px; color: var(--biz-text-3); margin-top: 4px; }
.flow-calc { margin-top: 12px; border: 1px solid var(--biz-border); border-radius: 8px; overflow: hidden; }
.flow-calc__row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; font-size: 12.5px; color: var(--biz-text-2);
}
.flow-calc__row + .flow-calc__row { border-top: 1px solid var(--biz-border); }
.flow-calc__row b { font-family: var(--biz-font-num); color: var(--biz-text-1); }
.flow-tip { margin-top: 10px; font-size: 11.5px; line-height: 1.7; color: var(--biz-text-3); }
.flow-tip b { color: var(--biz-danger, #d64545); }
</style>
