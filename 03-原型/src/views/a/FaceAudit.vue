<!--
  A 域 · 人脸核验（H4 / H5 · 2026-11-10）
  ------------------------------------------------------------
  业主端采集提交之后，后台必须有人受理，否则流程断在「待核验」：
  提交完没人审 = 永远刷不了脸。

  状态机：未采集 → 待核验 → 已生效 / 已驳回（驳回必填原因，业主端原样展示）。
  业主本人、家庭成员、租客**同一个工作台**，按主体类型分段 ——
  同一件事开两个入口，客服第一句话一定是「到底在哪审」。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>人脸核验</b>：业主与租客在各自的入口提交人脸，<b>统一在这里受理</b>。
        以前「已录人脸」是业主表单里的一个开关，勾一下就生效 ——
        那等于物业替业主担保，出了事没人说得清是谁录的。
        <br />
        现在只有一条路：<b>提交采集 → 待核验 → 通过 / 驳回</b>。
        驳回<b>必须写原因</b>（照片模糊、不是你本人、证件与人脸对不上），业主端会原样展示。
        <br />
        通过后回写主体的「已录人脸」状态：业主本人写业主、家庭成员写成员、租客写租户 ——
        <b>租客列表里的人脸标记是这里写出来的，不是页面自己算的</b>。
      </div>
    </div>

    <div class="grid fstats">
      <div class="panel fstat">
        <div class="fstat__k">待核验</div>
        <div class="fstat__v" :class="{ 'is-warn': st.pending }">{{ st.pending }} <span class="unit">条</span></div>
        <div class="fstat__s">业主 {{ st.pendingOwner }} · 租客 {{ st.pendingTenant }}</div>
      </div>
      <div class="panel fstat">
        <div class="fstat__k">超 24 小时未处理</div>
        <div class="fstat__v" :class="{ 'is-danger': st.overdue }">{{ st.overdue }} <span class="unit">条</span></div>
        <div class="fstat__s">业主等着刷脸进小区，拖一天就是一天投诉</div>
      </div>
      <div class="panel fstat">
        <div class="fstat__k">已生效</div>
        <div class="fstat__v is-ok">{{ st.activated }} <span class="unit">条</span></div>
        <div class="fstat__s">门禁白名单已下发</div>
      </div>
      <div class="panel fstat">
        <div class="fstat__k">已驳回</div>
        <div class="fstat__v is-muted">{{ st.rejected }} <span class="unit">条</span></div>
        <div class="fstat__s">业主可重新采集后再次提交</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters">
        <el-input v-model="q.kw" clearable placeholder="姓名 / 房号" :prefix-icon="'Search'"
          style="width:200px;" @keyup.enter="applyFilter" />
        <el-select v-model="q.status" clearable placeholder="全部状态" style="width:130px;" @change="applyFilter">
          <el-option v-for="s in FACE_STATUS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-checkbox v-model="q.overdue" @change="applyFilter">只看超时</el-checkbox>
        <el-button type="primary" :icon="'Search'" @click="applyFilter">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
        <span class="spacer" />
        <el-radio-group v-model="q.subjectType" size="small" @change="applyFilter">
          <el-radio-button label="">全部</el-radio-button>
          <el-radio-button label="业主">业主与家庭成员</el-radio-button>
          <el-radio-button label="租客">租客</el-radio-button>
        </el-radio-group>
      </div>

      <el-table :data="rows" v-loading="loading" size="small" style="margin-top:12px;" @row-click="openDetail">
        <el-table-column label="主体" width="180">
          <template #default="{ row }">
            <el-tag size="small" :type="row.subjectType === '租客' ? 'info' : ''" effect="plain">{{ row.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="姓名" width="110" />
        <el-table-column label="房屋" min-width="170">
          <template #default="{ row }">
            <span class="mono">{{ row.houseShort || '—' }}</span>
            <span class="sub"> · {{ row.communityName || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="submittedAt" label="提交时间" width="150" />
        <el-table-column label="已等" width="100">
          <template #default="{ row }">
            <span :class="{ 'is-danger': row.overdue }">{{ row.hoursWaiting }} 小时</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag size="small" :type="row.statusType" effect="plain">{{ row.status }}</el-tag>
            <el-tooltip v-if="row.rejectReason" :content="row.rejectReason" placement="top">
              <span class="sub" style="margin-left:6px;">看原因</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === '待核验' && canAudit">
              <el-button link type="primary" size="small" @click.stop="doPass(row)">通过</el-button>
              <el-button link type="danger" size="small" @click.stop="openReject(row)">驳回</el-button>
            </template>
            <span v-else class="sub">{{ row.auditBy ? `${row.auditBy} · ${row.auditAt.slice(11)}` : '—' }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          v-model:current-page="pageNo" v-model:page-size="size" :total="total"
          :page-sizes="PAGE_SIZES" layout="total, sizes, prev, pager, next" background
          @current-change="load" @size-change="onSize"
        />
      </div>
    </div>

    <!-- 详情：看照片占位与审核轨迹 -->
    <el-drawer v-model="dt.visible" title="人脸核验详情" size="520px">
      <template v-if="dt.row">
        <div class="dl">
          <div class="dl__i"><span class="dl__k">主体</span><span class="dl__v">{{ dt.row.label }}</span></div>
          <div class="dl__i"><span class="dl__k">姓名</span><span class="dl__v">{{ dt.row.name }}</span></div>
          <div class="dl__i"><span class="dl__k">手机号</span><span class="dl__v">{{ dt.row.maskedPhone }}</span></div>
          <div class="dl__i"><span class="dl__k">房屋</span><span class="dl__v">{{ dt.row.houseShort }} · {{ dt.row.communityName }}</span></div>
          <div class="dl__i"><span class="dl__k">提交来源</span><span class="dl__v">{{ dt.row.source }}</span></div>
          <div class="dl__i"><span class="dl__k">提交时间</span><span class="dl__v">{{ dt.row.submittedAt }}（已等 {{ dt.row.hoursWaiting }} 小时）</span></div>
          <div class="dl__i"><span class="dl__k">状态</span><span class="dl__v"><el-tag size="small" :type="dt.row.statusType" effect="plain">{{ dt.row.status }}</el-tag></span></div>
          <div v-if="dt.row.rejectReason" class="dl__i"><span class="dl__k">驳回原因</span><span class="dl__v">{{ dt.row.rejectReason }}</span></div>
          <div v-if="dt.row.auditBy" class="dl__i"><span class="dl__k">处理人</span><span class="dl__v">{{ dt.row.auditBy }} · {{ dt.row.auditAt }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:16px;"><h4>采集照片</h4><span class="desc">{{ dt.row.images }} 张 · 原型为占位</span></div>
        <div class="face-imgs">
          <div v-for="i in dt.row.images" :key="i" class="face-img">
            <el-icon><Camera /></el-icon>
            <span>人像 {{ i }}</span>
          </div>
        </div>
        <div class="hint">
          核验只看三件事：<b>是不是同一个人</b>、<b>照片是否清晰可辨</b>、<b>证件与人脸是否一致</b>。
          不判断颜值、不判断年龄，也别因为「看着不像」就驳回 —— 那是纠纷的开始。
        </div>
      </template>
      <template #footer>
        <el-button @click="dt.visible = false">关闭</el-button>
        <template v-if="dt.row && dt.row.status === '待核验' && canAudit">
          <el-button type="danger" plain @click="openReject(dt.row)">驳回</el-button>
          <el-button type="primary" @click="doPass(dt.row)">通过并下发门禁</el-button>
        </template>
      </template>
    </el-drawer>

    <!-- 驳回：原因必填，业主看得到这句 -->
    <el-dialog v-model="rj.visible" title="驳回人脸采集" width="480px">
      <p class="rj-tip">驳回原因会<b>原样展示给业主</b>，请写清楚该怎么改，别只写「不合格」。</p>
      <el-input v-model="rj.reason" type="textarea" :rows="3" maxlength="80" show-word-limit
        placeholder="如：照片是翻拍的证件照，请本人在光线充足处正面拍摄" />
      <div class="rj-quick">
        <el-tag v-for="r in REJECT_QUICK" :key="r" size="small" effect="plain" class="rj-tag" @click="rj.reason = r">{{ r }}</el-tag>
      </div>
      <template #footer>
        <el-button @click="rj.visible = false">取消</el-button>
        <el-button type="danger" :loading="rj.saving" @click="doReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  PAGE_SIZES, auditFaceRequest, canAuditFaces, faceRequestStats, queryFaceRequests
} from '@/api'

const FACE_STATUS = ['待核验', '已生效', '已驳回']
const REJECT_QUICK = [
  '照片模糊，看不清五官',
  '明显不是本人',
  '证件与人脸对不上',
  '遮挡过多（戴帽/口罩/墨镜）',
  '翻拍照片，不是实时采集'
]

const q = reactive({ kw: '', subjectType: '', status: '', overdue: false })
const rows = ref([])
const total = ref(0)
const pageNo = ref(1)
const size = ref(20)
const loading = ref(false)
const st = ref({ total: 0, pending: 0, pendingOwner: 0, pendingTenant: 0, overdue: 0, passed: 0, rejected: 0 })

const canAudit = computed(() => canAuditFaces())

const dt = reactive({ visible: false, row: null })
const rj = reactive({ visible: false, row: null, reason: '', saving: false })

async function load() {
  loading.value = true
  try {
    const r = await queryFaceRequests({
      subjectType: q.subjectType, status: q.status, kw: q.kw, pageNo: pageNo.value, size: size.value
    })
    rows.value = q.overdue ? r.rows.filter(x => x.overdue) : r.rows
    total.value = r.total
    st.value = faceRequestStats()
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function resetFilter() { Object.assign(q, { kw: '', subjectType: '', status: '', overdue: false }); applyFilter() }
function onSize() { pageNo.value = 1; load() }
function openDetail(row) { dt.row = { ...row }; dt.visible = true }

async function doPass(row) {
  try {
    await auditFaceRequest(row.reqId, { pass: true })
    ElMessage.success(`已通过：${row.name}，门禁白名单已下发`)
    dt.visible = false
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

function openReject(row) {
  Object.assign(rj, { visible: true, row, reason: '', saving: false })
}

async function doReject() {
  const reason = String(rj.reason || '').trim()
  if (!reason) { ElMessage.error('驳回必须写原因 —— 业主看得到这句'); return }
  rj.saving = true
  try {
    await auditFaceRequest(rj.row.reqId, { pass: false, reason })
    ElMessage.success(`已驳回：${rj.row.name}`)
    rj.visible = false
    dt.visible = false
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    rj.saving = false
  }
}

onMounted(load)
</script>

<style scoped>
.fstats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.fstat { padding: 14px 16px; }
.fstat__k { font-size: 12px; color: var(--biz-text-3); }
.fstat__v { font-size: 24px; font-weight: 600; line-height: 1.4; font-family: var(--biz-font-num); }
.fstat__v .unit { font-size: 12px; font-weight: 400; color: var(--biz-text-3); }
.fstat__s { font-size: 11.5px; color: var(--biz-text-3); }
.fstat__v.is-warn { color: #d98a1f; }
.fstat__v.is-danger, .is-danger { color: #d9534f; }
.fstat__v.is-ok { color: #2f9e6e; }
.fstat__v.is-muted { color: var(--biz-text-2); }
.mono { font-family: var(--biz-font-num); }
.sub { font-size: 11.5px; color: var(--biz-text-3); }
.spacer { flex: 1; }
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }
.face-imgs { display: flex; gap: 12px; flex-wrap: wrap; }
.face-img {
  width: 132px; height: 168px; border-radius: 8px; border: 1px dashed var(--biz-border);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: var(--biz-text-3); font-size: 12px; background: var(--biz-bg-2);
}
.hint {
  margin-top: 14px; padding: 10px 12px; border-radius: 8px;
  background: var(--biz-bg-2); font-size: 12px; color: var(--biz-text-2); line-height: 1.7;
}
.rj-tip { font-size: 12.5px; color: var(--biz-text-2); margin: 0 0 10px; }
.rj-quick { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.rj-tag { cursor: pointer; }
</style>
