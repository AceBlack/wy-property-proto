<!--
  邻里 · 报名名单
  ------------------------------------------------------------
  一张表回答三件事：谁报了、谁来了、钱退了没有。
  代报名是这个页面存在的主要理由 —— 现场总有阿姨不会用小程序，前台帮她报、顺手收现金。
-->
<template>
  <div class="page">
    <div class="back-line">
      <el-button link type="primary" :icon="'ArrowLeft'" @click="$router.push('/n/activities')">返回活动列表</el-button>
    </div>

    <div v-if="act" class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>{{ act.title }}</b>
        <el-tag size="small" :type="act.phaseType" effect="plain" style="margin-left:8px;">{{ act.phase }}</el-tag>
        <br />
        {{ act.communityName }} · {{ act.startAt }} ~ {{ act.endAt.slice(11, 16) }} · {{ act.place }}
        <br />
        {{ act.feeText }}<template v-if="act.fee > 0"> · 成团下限 {{ act.minCapacity }} 人</template> ·
        名额 {{ act.capacity }} 人 · 报名截止 {{ act.enrollDeadline }}
        <template v-if="act.phase === '待成行'">
          <br /><span class="warn-txt">已截止但只报了 {{ act.enrolled }} 人，还差 {{ act.gap }} 人成团。</span>
          要么补人，要么回活动列表点「确认流团」全额退款。
        </template>
        <template v-if="act.fee > 0">
          <br />退款规则：<span v-for="(p, i) in act.refundPolicy" :key="i" class="rf">
            距开始 ≥{{ p.days }} 天退 {{ p.ratio }}%{{ i < act.refundPolicy.length - 1 ? '，' : '' }}
          </span>
        </template>
      </div>
    </div>

    <div class="grid estats">
      <div class="panel estat">
        <div class="estat__k">报名人次</div>
        <div class="estat__v">{{ st.people }} <span class="unit">人</span></div>
        <div class="estat__s">{{ st.total }} 条报名记录</div>
      </div>
      <div class="panel estat">
        <div class="estat__k">已签到</div>
        <div class="estat__v is-ok">{{ st.checkedIn }} <span class="unit">人</span></div>
        <div class="estat__s">占报名 {{ st.people ? Math.round(st.checkedIn / st.people * 100) : 0 }}%</div>
      </div>
      <div class="panel estat">
        <div class="estat__k">已收 / 已退</div>
        <div class="estat__v">¥ {{ money(st.paidAmount) }}</div>
        <div class="estat__s">已退 ¥{{ money(st.refundAmount) }} · {{ st.refunded }} 条</div>
      </div>
      <div class="panel estat">
        <div class="estat__k">成团进度</div>
        <div class="estat__v" :class="{ 'is-warn': st.gap > 0 }">
          {{ st.people }}<span class="unit">/ {{ st.minCapacity || st.capacity }}</span>
        </div>
        <div class="estat__s">{{ st.minCapacity ? (st.gap > 0 ? `还差 ${st.gap} 人` : '已达成团人数') : '无成团要求' }}</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters">
        <el-input v-model="q.kw" clearable placeholder="姓名 / 手机 / 房号 / 出行人" :prefix-icon="'Search'"
          style="width:250px;" @keyup.enter="applyFilter" />
        <el-select v-model="q.status" clearable placeholder="全部状态" style="width:130px;" @change="applyFilter">
          <el-option v-for="s in ENROLL_STATUS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-button type="primary" :icon="'Search'" @click="applyFilter">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
        <span class="spacer" />
        <el-button :icon="'Download'" @click="doExport">导出名单</el-button>
        <el-button v-if="canEnrollPerm && canEnrollNow" type="primary" plain :icon="'Plus'" @click="openEnroll">
          代报名
        </el-button>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>报名名单</h3>
        <span class="spacer" />
        <span class="desc">按报名时间正序 · 共 {{ total }} 条</span>
      </div>

      <el-table :data="rows" stripe v-loading="loading" style="width:100%">
        <el-table-column label="报名人" min-width="170">
          <template #default="{ row }">
            <div class="e-n">{{ row.name }}<span class="e-num">{{ row.people }} 人</span></div>
            <div class="sub">{{ row.phone }}</div>
          </template>
        </el-table-column>
        <el-table-column label="房号 / 来源" width="170">
          <template #default="{ row }">
            <div class="mono sub2">{{ row.houseShort || '—' }}</div>
            <div class="sub">
              <el-tag v-if="row.source === '前台代报'" size="small" type="warning" effect="plain">前台代报</el-tag>
              <span v-else>业主自助</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="出行人" min-width="200">
          <template #default="{ row }">
            <template v-if="row.attendees.length">
              <span v-for="(t, i) in row.attendees" :key="i" class="trav">
                {{ t.name }}<em v-if="t.ageType === '儿童'">儿</em>
              </span>
            </template>
            <span v-else class="sub">未填（本场不需实名）</span>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">
            <span v-if="row.amount" class="money">¥ {{ money(row.amount) }}</span>
            <span v-else class="sub">免费</span>
            <div class="sub">{{ row.payStatus }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="96" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.statusType" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="报名时间" width="130">
          <template #default="{ row }">
            <span class="sub2">{{ row.at }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="right">
          <template #default="{ row }">
            <template v-if="row.status === '已报名'">
              <el-button v-if="canCheckin" link type="primary" size="small" @click="doCheckin(row)">签到</el-button>
              <el-button v-if="canEnrollPerm && act && act.fee > 0" link type="warning" size="small" @click="openRefund(row)">退款</el-button>
              <el-button v-else-if="canEnrollPerm" link type="danger" size="small" @click="doCancel(row)">取消</el-button>
            </template>
            <span v-else-if="row.status === '已退款'" class="sub" :title="row.cancelReason">
              已退 ¥{{ money(row.refundAmount) }}
            </span>
            <!-- 已取消不再重复显示「已取消」：状态列已经写了，这里只在有原因时才给一句 -->
            <span v-else-if="row.status === '已取消' && row.cancelReason" class="sub ellip" :title="row.cancelReason">
              {{ row.cancelReason }}
            </span>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState title="还没有人报名" desc="活动发布后，业主要在业主端「邻里 · 活动」里报名；不会用的可以在这里代报名" />
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

    <!-- 代报名 -->
    <el-drawer v-model="eo.visible" title="代报名（前台）" size="560px" :close-on-click-modal="false">
      <el-form label-width="92px" label-position="right">
        <el-form-item label="联系人" required>
          <el-input v-model="eo.name" maxlength="20" placeholder="业主姓名" />
        </el-form-item>
        <el-form-item label="手机号" required>
          <el-input v-model="eo.phone" maxlength="11" placeholder="11 位手机号，用于行前通知" />
        </el-form-item>
        <el-form-item label="房号">
          <el-input v-model="eo.houseShort" maxlength="24" placeholder="如 P02-003-1102（选填）" />
        </el-form-item>
        <el-form-item label="报名人数" required>
          <el-input-number v-model="eo.people" :min="1" :max="act?.attendeeLimit || 1"
            controls-position="right" style="width:140px;" />
          <span class="hint" style="margin-left:10px;">每户最多 {{ act?.attendeeLimit || 1 }} 人</span>
        </el-form-item>

        <template v-if="act?.needInsurance">
          <el-divider content-position="left"><span class="div-t">出行人（投保必填）</span></el-divider>
          <div v-for="(t, i) in eo.attendees" :key="i" class="tv-box">
            <div class="tv-hd">
              <span class="tv-no">第 {{ i + 1 }} 位</span>
              <el-radio-group v-model="t.ageType" size="small">
                <el-radio-button label="成人" value="成人">成人</el-radio-button>
                <el-radio-button label="儿童" value="儿童">儿童</el-radio-button>
              </el-radio-group>
            </div>
            <el-input v-model="t.name" maxlength="20" placeholder="姓名" style="margin-bottom:6px;" />
            <el-input v-model="t.idNo" maxlength="18" placeholder="身份证号（仅用于购买当日意外险）" style="margin-bottom:6px;" />
            <el-input v-model="t.emergencyPhone" maxlength="11" placeholder="紧急联系人电话" />
          </div>
          <div class="hint" style="margin-top:6px;">
            证件号仅用于投保，活动结束后 30 天脱敏。业主端报名时是单独勾选同意的，前台代报请口头告知。
          </div>
        </template>

        <el-form-item v-if="act && act.fee > 0" label="现场收款" style="margin-top:12px;">
          <el-checkbox v-model="eo.paid">已收现金 ¥{{ money(act.fee * eo.people) }}</el-checkbox>
          <div class="hint">不勾选则记为「待支付」，业主端会看到待付提示</div>
        </el-form-item>

        <el-form-item label="备注">
          <el-input v-model="eo.remark" type="textarea" :rows="2" maxlength="60" placeholder="选填" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="eo.visible = false">取消</el-button>
        <el-button type="primary" :loading="eo.saving" @click="doEnroll">确认报名</el-button>
      </template>
    </el-drawer>

    <!-- 退款 -->
    <el-dialog v-model="rf.visible" title="办理退款" width="480" :close-on-click-modal="false">
      <template v-if="rf.row && act">
        <div class="rf-brief">
          <div class="rf-brief__t">{{ rf.row.name }} · {{ rf.row.people }} 人</div>
          <div class="rf-brief__m">距活动开始 {{ rf.days }} 天 · 命中档位「退 {{ rf.ratio }}%」</div>
        </div>
        <div class="rf-calc">
          <div class="rf-calc__row"><span>已支付</span><b>¥ {{ money(rf.row.amount) }}</b></div>
          <div class="rf-calc__row"><span>退款比例</span><b>{{ rf.ratio }}%</b></div>
          <div class="rf-calc__row is-total"><span>应退金额</span><b class="money">¥ {{ money(rf.row.amount * rf.ratio / 100) }}</b></div>
        </div>
        <el-form label-width="80px" style="margin-top:10px;">
          <el-form-item label="退款原因">
            <el-input v-model="rf.reason" maxlength="60" placeholder="默认按退款规则填写，可改" />
          </el-form-item>
        </el-form>
        <div class="hint">退款原路返回，日结与流水都会看到这笔冲减。</div>
      </template>
      <template #footer>
        <el-button @click="rf.visible = false">取消</el-button>
        <el-button type="primary" :loading="rf.saving" @click="doRefund">确认退款</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute } from 'vue-router'
import {
  canEnrollActivities, cancelEnroll, checkinEnroll, enrollActivity, enrollStats,
  getActivity, queryEnrolls, refundEnroll, refundRatioOf
} from '@/api/neighbor'
import { PAGE_SIZES } from '@/api/shared'
import EmptyState from '@/components/EmptyState.vue'
import { money, TODAY } from '@/utils/format'
import { submitExport } from '@/utils/download'

const route = useRoute()
const activityId = route.params.id
/* 名单页只做「代报名 / 取消 / 退款 / 签到」，全部归 n.activities.enroll：
   一线客服可以帮业主报名，但不能建活动、改价格、确认流团（那些在活动管理页，走 edit） */
const canEnrollPerm = computed(() => canEnrollActivities())

const ENROLL_STATUS = ['已报名', '已签到', '已取消', '已退款']
const act = ref(null)
const st = ref({ total: 0, people: 0, checkedIn: 0, cancelled: 0, refunded: 0, paidAmount: 0, refundAmount: 0, capacity: 0, minCapacity: 0, gap: 0, phase: '' })

/* 签到只在活动确定成行之后才有意义：待成行时签到会把"可能流团"的人标记成到场 */
const canCheckin = computed(() => canEnrollPerm.value && act.value && !['草稿', '待成行', '已流团'].includes(act.value.phase))
/** 只有「报名中」能接新报名 —— 与权限是两件事，两个都要满足 */
const canEnrollNow = computed(() => act.value && act.value.phase === '报名中')

const q = reactive({ kw: '', status: '' })
const pageNo = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const [res, full] = await Promise.all([
      queryEnrolls({ activityId, pageNo: pageNo.value, size: size.value, filters: { ...q } }),
      getActivity(activityId)
    ])
    rows.value = res.rows
    total.value = res.total
    act.value = full
    st.value = enrollStats(activityId)
  } catch (e) {
    ElMessage.error(e?.message || '名单加载失败')
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function resetFilter() { Object.assign(q, { kw: '', status: '' }); applyFilter() }
function onSize() { pageNo.value = 1; load() }

function doExport() {
  submitExport({
    name: `活动报名名单 · ${act.value?.title || activityId}`,
    type: '列表',
    source: '邻里 / 活动管理',
    filters: { activityId, ...q },
    count: total.value
  })
  ElMessage.success('已提交导出任务，去「下载中心」取文件')
}

/* ---------------- 代报名 ---------------- */
const eo = reactive({
  visible: false, saving: false, name: '', phone: '', houseShort: '',
  people: 1, attendees: [], paid: false, remark: ''
})

function openEnroll() {
  const n = 1
  Object.assign(eo, {
    visible: true, saving: false, name: '', phone: '', houseShort: '',
    people: n, paid: false, remark: '',
    attendees: Array.from({ length: n }, () => ({ name: '', idNo: '', ageType: '成人', emergencyPhone: '' }))
  })
}

/* 人数变了要同步出行人行数：不一致时接口会以"必须填满 N 位出行人"拒绝 */
function syncAttendees() {
  if (!act.value?.needInsurance) return
  const n = eo.people || 1
  while (eo.attendees.length < n) {
    eo.attendees.push({ name: '', idNo: '', ageType: '成人', emergencyPhone: '' })
  }
  if (eo.attendees.length > n) eo.attendees.splice(n)
}
/* 输入框改人数就立刻补行，别等点提交才报"必须填满 3 位出行人" */
watch(() => eo.people, () => { if (eo.visible) syncAttendees() })

async function doEnroll() {
  syncAttendees()
  eo.saving = true
  try {
    await enrollActivity(activityId, {
      name: eo.name,
      phone: eo.phone,
      houseShort: eo.houseShort,
      people: eo.people,
      attendees: eo.attendees,
      paid: eo.paid,
      remark: eo.remark
    })
    ElMessage.success('已代报名')
    eo.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '报名失败')
  } finally {
    eo.saving = false
  }
}

/* ---------------- 签到 / 取消 ---------------- */
async function doCheckin(row) {
  try {
    await checkinEnroll(row.enrollId)
    ElMessage.success(`${row.name} 已签到`)
    load()
  } catch (e) {
    ElMessage.error(e?.message || '签到失败')
  }
}

async function doCancel(row) {
  try {
    await ElMessageBox.confirm(`取消「${row.name}」的报名？名额会释放给候补。`, '取消报名',
      { confirmButtonText: '确认取消', cancelButtonText: '再想想', type: 'warning' })
  } catch { return }
  try {
    await cancelEnroll(row.enrollId, '前台代客取消')
    ElMessage.success('已取消')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

/* ---------------- 退款 ---------------- */
const rf = reactive({ visible: false, saving: false, row: null, ratio: 100, days: 0, reason: '' })

function daysToStart() {
  if (!act.value) return 0
  const start = new Date(`${String(act.value.startAt).slice(0, 10)}T00:00:00`)
  const now = new Date(`${TODAY}T00:00:00`)
  return Math.max(0, Math.round((start - now) / 86400000))
}

function openRefund(row) {
  rf.row = row
  rf.days = daysToStart()
  rf.ratio = refundRatioOf(activityId)
  rf.reason = `按退款规则：距开始 ${rf.days} 天，退 ${rf.ratio}%`
  rf.visible = true
}

async function doRefund() {
  rf.saving = true
  try {
    const res = await refundEnroll(rf.row.enrollId, rf.reason)
    ElMessage.success(`已退款 ¥${money(res.amount)}（${res.ratio}%）`)
    rf.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '退款失败')
  } finally {
    rf.saving = false
  }
}

onMounted(load)
</script>

<style scoped>
.back-line { margin-bottom: 6px; }
.estats { margin-top: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.estat { padding: 14px 16px; }
.estat__k { font-size: 12.5px; color: var(--biz-text-3); }
.estat__v {
  font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px;
}
.estat__v.is-ok { color: var(--biz-success, #2f9e6e); }
.estat__v.is-warn { color: var(--biz-warning, #d98a1f); }
.estat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.estat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }

.filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filters .spacer { flex: 1; }
.sub { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.sub2 { font-size: 12px; color: var(--biz-text-2); font-family: var(--biz-font-num); }
.mono { font-family: var(--biz-font-num); }
.money { font-family: var(--biz-font-num); }
.warn-txt { color: var(--biz-warning, #d98a1f); }
.ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }
.hint { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; }
.div-t { font-size: 12px; color: var(--biz-text-3); }
.rf { color: var(--biz-text-2); }

.e-n { font-size: 13px; color: var(--biz-text-1); display: flex; align-items: center; gap: 8px; }
.e-num {
  font-size: 11px; color: var(--biz-text-3); background: var(--biz-bg-fill);
  padding: 0 5px; border-radius: 4px; line-height: 1.7;
}
.trav {
  display: inline-block; font-size: 11.5px; color: var(--biz-text-2);
  background: var(--biz-bg-fill); border-radius: 4px; padding: 1px 6px; margin: 0 4px 3px 0;
}
.trav em { font-style: normal; color: var(--biz-warning, #d98a1f); font-size: 10px; margin-left: 2px; }

.tv-box {
  margin-bottom: 10px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--biz-border);
}
.tv-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.tv-no { font-size: 12px; color: var(--biz-text-2); }

.rf-brief { padding: 10px 12px; border-radius: 8px; background: var(--biz-bg-fill); }
.rf-brief__t { font-size: 14px; color: var(--biz-text-1); font-weight: 600; }
.rf-brief__m { font-size: 12px; color: var(--biz-text-3); margin-top: 3px; }
.rf-calc { margin-top: 10px; border: 1px solid var(--biz-border); border-radius: 8px; overflow: hidden; }
.rf-calc__row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; font-size: 12.5px; color: var(--biz-text-2);
}
.rf-calc__row + .rf-calc__row { border-top: 1px solid var(--biz-border); }
.rf-calc__row.is-total { background: var(--biz-bg-fill); }
.rf-calc__row b { font-family: var(--biz-font-num); color: var(--biz-text-1); }
</style>
