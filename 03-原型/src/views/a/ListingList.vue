<!--
  A 域 · 租售信息（2026-11-06 第 69 批）
  ------------------------------------------------------------
  只做信息发布：业主自己发，责任楼管审一道，想租的人留电话。
  这一页没有「新建」按钮 —— 挂牌由业主发起，后台只审不改。
  有编辑入口的那天，就一定会变成"客服帮业主改价格"，责任就绕回来了。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>租售信息</b>：业主在业主端自己发布，<b>责任楼管审核</b>通过后对外公开。
        后台<b>没有「新建」</b>——挂牌只能由业主发起，物业不代发、不代改价格。
        <br />
        <b>审核人是这套房的责任楼管</b>（`house.stewardEmpId`），不是"审核员"。
        他门儿清这套房多大、朝哪、装修什么样，照片是不是这套房一眼能看出来。
        <b>超过 24 小时未审自动升到直属上级</b>，列表里标红。
        <br />
        审核只看三件事：<b>人</b>（系统已校验产权人）、<b>内容</b>（面积户型从档案带，改不了）、
        <b>图</b>（有没有拍到门牌、邻居家门）。价格<b>不干预</b>——物业没有定价权。
        <br />
        对外展示的只有「责任楼管姓名 + 微信」，<b>手机号不给</b>：
        访客要联系就留自己的号码，楼管回拨。
      </div>
    </div>

    <div class="grid lstats">
      <div class="panel lstat">
        <div class="lstat__k">待审核</div>
        <div class="lstat__v" :class="{ 'is-warn': st.pending }">{{ st.pending }} <span class="unit">条</span></div>
        <div class="lstat__s" :class="{ 'is-danger': st.escalated }">
          其中 {{ st.escalated }} 条已升级（超 24 小时）
        </div>
      </div>
      <div class="panel lstat">
        <div class="lstat__k">已发布</div>
        <div class="lstat__v is-ok">{{ st.published }} <span class="unit">条</span></div>
        <div class="lstat__s">对外公开中 · 累计浏览 {{ st.viewTotal }}</div>
      </div>
      <div class="panel lstat">
        <div class="lstat__k">看房待联系</div>
        <div class="lstat__v" :class="{ 'is-warn': st.viewingOverdue }">{{ st.viewingPending }} <span class="unit">条</span></div>
        <div class="lstat__s" :class="{ 'is-danger': st.viewingOverdue }">
          {{ st.viewingOverdue }} 条超 24 小时未回拨
        </div>
      </div>
      <div class="panel lstat">
        <div class="lstat__k">已成交 / 已下架</div>
        <div class="lstat__v is-muted">{{ st.dealt }} / {{ st.offline }}</div>
        <div class="lstat__s">另有已过期 {{ st.expired }} 条 · 已驳回 {{ st.rejected }} 条</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="filters">
        <el-input v-model="q.kw" clearable placeholder="编号 / 房号 / 业主" :prefix-icon="'Search'"
          style="width:220px;" @keyup.enter="applyFilter" />
        <el-select v-model="q.communityId" clearable placeholder="全部项目" style="width:150px;" @change="applyFilter">
          <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-select v-model="q.status" clearable placeholder="全部状态" style="width:130px;" @change="applyFilter">
          <el-option v-for="s in LISTING_STATUS" :key="s" :label="s" :value="s" />
        </el-select>
        <el-checkbox v-model="q.overdue" @change="applyFilter">只看已超时</el-checkbox>
        <el-button type="primary" :icon="'Search'" @click="applyFilter">查询</el-button>
        <el-button @click="resetFilter">重置</el-button>
        <span class="spacer" />
        <span class="scope">{{ scopeText }}</span>
        <el-button link type="primary" @click="$router.push('/a/viewings')">看房请求</el-button>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>挂牌列表</h3>
        <span class="spacer" />
        <span class="desc">待审核排最前，按等待时长正序 · 共 {{ total }} 条</span>
      </div>

      <el-table :data="rows" stripe v-loading="loading" style="width:100%">
        <el-table-column label="房源" min-width="230">
          <template #default="{ row }">
            <div class="l-t">{{ row.communityName }} {{ row.buildingName }}{{ row.room }}</div>
            <div class="sub">
              <span class="mono">{{ row.listingId }}</span> ·
              {{ row.houseType }} · {{ row.area }}㎡ · {{ row.orientation }} · {{ row.floor }} 层
            </div>
          </template>
        </el-table-column>
        <el-table-column label="租金" width="120" align="right">
          <template #default="{ row }">
            <span class="money">¥{{ money(row.price) }}</span>
            <div class="sub">{{ row.payTerm }}</div>
          </template>
        </el-table-column>
        <el-table-column label="产权人" width="150">
          <template #default="{ row }">
            <div>{{ row.ownerName }}</div>
            <div class="sub mono">{{ row.ownerPhone }}</div>
          </template>
        </el-table-column>
        <el-table-column label="责任楼管" width="120">
          <template #default="{ row }">
            <div>{{ row.stewardName || '—' }}</div>
            <div class="sub">{{ row.stewardPosition }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag size="small" :type="row.statusType" effect="plain">{{ row.status }}</el-tag>
            <div v-if="row.status === '待审核'" class="sub" :class="{ 'is-danger': row.overdue }">
              已等 {{ row.hoursWaiting }} 小时{{ row.overdue ? ' · 已升级' : '' }}
            </div>
            <div v-else-if="row.status === '已发布'" class="sub">浏览 {{ row.viewCount }} · 看房 {{ row.leadCount }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" align="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">详情</el-button>
            <el-button v-if="row.status === '待审核' && canAudit" link type="primary" size="small"
              @click="openAudit(row)">审核</el-button>
            <el-button v-if="row.status === '已发布' && canAudit" link type="danger" size="small"
              @click="openOffline(row)">下架</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <EmptyState title="没有符合条件的挂牌" desc="挂牌由业主在业主端发起，后台不代发；换个筛选条件试试" />
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

    <!-- 审核抽屉 -->
    <el-drawer v-model="au.visible" title="审核租售信息" size="860px" :close-on-click-modal="false">
      <template v-if="au.row">
        <div class="au-hd">
          <div>
            <div class="au-t">{{ au.row.communityName }} {{ au.row.buildingName }}{{ au.row.room }}</div>
            <div class="au-m">
              <span class="mono">{{ au.row.listingId }}</span> · 提交于 {{ au.row.createdAt }} ·
              <span :class="{ 'is-danger': au.row.overdue }">已等 {{ au.row.hoursWaiting }} 小时</span>
            </div>
          </div>
          <el-tag :type="au.row.statusType" effect="plain">{{ au.row.status }}</el-tag>
        </div>

        <div class="au-grid">
          <!-- 左：产权关系 -->
          <div class="au-col">
            <div class="sec__hd"><h4>产权关系</h4><span class="desc">系统已校验</span></div>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="产权人">{{ au.row.ownerName }}</el-descriptions-item>
              <el-descriptions-item label="联系电话">
                <span class="mono">{{ au.row.ownerPhone }}</span>
              </el-descriptions-item>
              <el-descriptions-item label="发布人">
                {{ au.row.ownerName }}
                <el-tag size="small" type="success" effect="plain" style="margin-left:6px;">本人发布</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="责任楼管">{{ au.row.stewardName }}</el-descriptions-item>
              <el-descriptions-item label="房号">
                <span class="mono">{{ au.row.houseShort }}</span>
              </el-descriptions-item>
            </el-descriptions>
            <div class="au-note">
              面积、户型、朝向、楼层<b>从房屋档案带出，业主改不了</b>——
              所以这一屏不用核对面积，只核对图片。
            </div>
          </div>

          <!-- 右：内容 -->
          <div class="au-col">
            <div class="sec__hd"><h4>挂牌内容</h4><span class="desc">{{ au.row.decorate }} · {{ au.row.payTerm }}</span></div>
            <div class="au-price">
              <span class="au-price__n">¥{{ money(au.row.price) }}</span>
              <span class="au-price__u">/月</span>
              <span class="au-price__d">押金 ¥{{ money(au.row.deposit) }}</span>
            </div>
            <div class="au-meta">
              {{ au.row.houseType }} · {{ au.row.area }}㎡ · {{ au.row.orientation }} ·
              {{ au.row.floor }} 层 · {{ au.row.availableFrom }} 起可住
            </div>
            <div class="au-fac">
              <el-tag v-for="f in au.row.facilities" :key="f" size="small" effect="plain" type="info">{{ f }}</el-tag>
              <span v-if="!au.row.facilities.length" class="sub">未填配套</span>
            </div>
            <div class="au-desc">{{ au.row.desc }}</div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:16px;">
          <h4>图片 {{ au.row.images }} 张</h4>
          <span class="desc">重点看：门牌号 / 邻居家门 / 窗外能定位到哪栋 / 家庭合照与证件</span>
        </div>
        <div class="au-imgs">
          <div v-for="n in Math.min(au.row.images, 6)" :key="n" class="au-img">
            <el-icon><Picture /></el-icon><span>图 {{ n }}</span>
          </div>
          <div v-if="au.row.images > 6" class="au-img is-more">+{{ au.row.images - 6 }}</div>
        </div>

        <div v-if="au.row.rejectReason" class="au-warn">
          <b>上次驳回：</b>{{ au.row.rejectReason }}
        </div>

        <div class="sec__hd" style="margin-top:16px;"><h4>审核</h4><span class="desc">通过后立即对外公开</span></div>
        <div class="au-quick">
          <span class="au-quick__l">驳回理由</span>
          <span v-for="r in REJECT_PRESETS" :key="r" class="chip" :class="{ 'is-on': au.reason === r }"
            @click="au.reason = r">{{ r }}</span>
        </div>
        <el-input v-model="au.reason" type="textarea" :rows="2" maxlength="60" show-word-limit
          placeholder="写清哪张图有问题、怎么改 —— 业主看得到这句" style="margin-top:10px;" />

        <div class="au-row">
          <div class="au-assign">
            <span class="au-assign__l">责任楼管</span>
            <el-select v-model="au.steward" size="small" style="width:220px" :disabled="!canAudit">
              <el-option v-for="o in stewardOpts" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-button v-if="au.steward !== au.row.stewardEmpId" link type="primary" size="small"
              @click="doReassign">改派</el-button>
          </div>
          <div class="au-btns">
            <el-button :loading="au.saving" @click="doAudit(false)">驳回</el-button>
            <el-button type="primary" :loading="au.saving" @click="doAudit(true)">通过并公开</el-button>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 详情抽屉 -->
    <el-drawer v-model="dt.visible" title="挂牌详情" size="640px">
      <template v-if="dt.row">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="编号">{{ dt.row.listingId }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="dt.row.statusType" effect="plain">{{ dt.row.status }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="房源" :span="2">
            {{ dt.row.communityName }} {{ dt.row.buildingName }}{{ dt.row.room }}（{{ dt.row.houseShort }}）
          </el-descriptions-item>
          <el-descriptions-item label="户型">{{ dt.row.houseType }}</el-descriptions-item>
          <el-descriptions-item label="面积">{{ dt.row.area }} ㎡</el-descriptions-item>
          <el-descriptions-item label="租金">¥{{ money(dt.row.price) }} / 月</el-descriptions-item>
          <el-descriptions-item label="押付">{{ dt.row.payTerm }}</el-descriptions-item>
          <el-descriptions-item label="产权人">{{ dt.row.ownerName }}</el-descriptions-item>
          <el-descriptions-item label="电话"><span class="mono">{{ dt.row.ownerPhone }}</span></el-descriptions-item>
          <el-descriptions-item label="责任楼管">{{ dt.row.stewardName }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ dt.row.createdAt }}</el-descriptions-item>
          <el-descriptions-item label="公开至">{{ dt.row.expireAt }}</el-descriptions-item>
          <el-descriptions-item label="浏览 / 看房">{{ dt.row.viewCount }} / {{ dt.row.leadCount }}</el-descriptions-item>
          <el-descriptions-item v-if="dt.row.auditBy" label="审核">
            {{ dt.row.auditBy }} · {{ dt.row.auditAt }}
          </el-descriptions-item>
          <el-descriptions-item v-if="dt.row.dealAt" label="成交">{{ dt.row.dealAt }}</el-descriptions-item>
          <el-descriptions-item v-if="dt.row.rejectReason" label="驳回理由" :span="2">
            {{ dt.row.rejectReason }}
          </el-descriptions-item>
          <el-descriptions-item v-if="dt.row.offlineReason" label="下架原因" :span="2">
            {{ dt.row.offlineReason }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="sec__hd" style="margin:16px 0 8px;">
          <h4>看房请求</h4><span class="desc">对外不展示楼管手机号，访客留号码、楼管回拨</span>
        </div>
        <div v-if="dt.row.viewings.length" class="dt-views">
          <div v-for="v in dt.row.viewings" :key="v.viewingId" class="dt-view">
            <div class="dt-view__l">
              <div class="dt-view__n">{{ v.name }} <span class="mono sub">{{ v.phone }}</span></div>
              <div class="sub">{{ v.preferredTime }} · {{ v.note || '无留言' }}</div>
            </div>
            <div class="dt-view__r">
              <el-tag size="small" :type="v.statusType" effect="plain">{{ v.status }}</el-tag>
              <div class="sub">{{ v.createdAt.slice(5, 16) }}</div>
            </div>
          </div>
        </div>
        <EmptyState v-else title="还没有人咨询" desc="挂牌公开后，访客留的号码会出现在这里" />
      </template>
    </el-drawer>

    <!-- 强制下架 -->
    <el-dialog v-model="of.visible" title="强制下架" width="460" :close-on-click-modal="false">
      <div class="of-hd">
        {{ of.row?.communityName }} {{ of.row?.buildingName }}{{ of.row?.room }}
        <span class="mono sub">{{ of.row?.listingId }}</span>
      </div>
      <el-form label-width="80px" style="margin-top:10px;">
        <el-form-item label="下架原因" required>
          <el-input v-model="of.reason" type="textarea" :rows="2" maxlength="60" show-word-limit
            placeholder="如：业主已当面告知房子租出、图片被举报侵权" />
        </el-form-item>
      </el-form>
      <div class="sub">原因会记录在挂牌上，业主看得到。只有「已发布」的挂牌能下架。</div>
      <template #footer>
        <el-button @click="of.visible = false">取消</el-button>
        <el-button type="danger" :loading="of.saving" @click="doOffline">确认下架</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  LISTING_STATUS, auditListing, canAuditListings, getListing, listingScopeHint,
  listingStats, listingStewardOpts, offlineListing, queryListings, reassignListing
} from '@/api/listings'
import { PAGE_SIZES, communityOpts } from '@/api/shared'
import EmptyState from '@/components/EmptyState.vue'
import { money } from '@/utils/format'

const canAudit = computed(() => canAuditListings())
const cmOpts = communityOpts()
const stewardOpts = ref([])
const REJECT_PRESETS = ['图片拍到门牌号', '图片不清晰 / 疑似网图', '描述含联系方式', '价格与房源明显不符']

/* 楼管看到哪些挂牌由数据范围（责任范围）决定，不再给「只看我负责的」这种筛选框 ——
   权限收敛和主动筛选是两件事，混在一起会让人以为"不勾就能看别人的" */
const scopeText = ref('')
const q = reactive({ kw: '', communityId: '', status: '', overdue: false })
const pageNo = ref(1)
const size = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const st = ref({
  total: 0, pending: 0, escalated: 0, published: 0, rejected: 0,
  offline: 0, expired: 0, dealt: 0, viewingPending: 0, viewingOverdue: 0, viewTotal: 0
})

async function load() {
  loading.value = true
  try {
    const res = await queryListings({ pageNo: pageNo.value, size: size.value, filters: { ...q } })
    rows.value = res.rows
    total.value = res.total
    st.value = listingStats()
  } catch (e) {
    ElMessage.error(e?.message || '租售信息加载失败')
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function resetFilter() {
  Object.assign(q, { kw: '', communityId: '', status: '', overdue: false })
  applyFilter()
}
function onSize() { pageNo.value = 1; load() }

/* ---------------- 审核 ---------------- */
const au = reactive({ visible: false, saving: false, row: null, reason: '', steward: '' })

async function openAudit(row) {
  dt.visible = false
  /* 列表里的业主电话是脱敏的，审核要能直接打给业主 —— 这里拉一次详情拿全号 */
  Object.assign(au, { visible: true, saving: false, row, reason: '', steward: row.stewardEmpId })
  const full = await getListing(row.listingId)
  if (full) { au.row = full; au.steward = full.stewardEmpId }
}

async function doAudit(pass) {
  if (!pass && !au.reason.trim()) {
    ElMessage.warning('驳回必须写理由 —— 业主看得到这句，也会拿着它来问')
    return
  }
  au.saving = true
  try {
    await auditListing(au.row.listingId, { pass, reason: au.reason })
    ElMessage.success(pass ? '已通过，业主端立即公开' : '已驳回，理由已记录')
    au.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    au.saving = false
  }
}

async function doReassign() {
  try {
    await reassignListing(au.row.listingId, au.steward)
    ElMessage.success('已改派责任楼管')
    au.row = await getListing(au.row.listingId)
    load()
  } catch (e) {
    ElMessage.error(e?.message || '改派失败')
  }
}

/* ---------------- 详情 ---------------- */
const dt = reactive({ visible: false, row: null })
async function openDetail(row) {
  au.visible = false
  dt.visible = true
  dt.row = row
  const full = await getListing(row.listingId)
  if (full) dt.row = full
}

/* ---------------- 强制下架 ---------------- */
const of = reactive({ visible: false, saving: false, row: null, reason: '' })
function openOffline(row) {
  Object.assign(of, { visible: true, saving: false, row, reason: '' })
}
async function doOffline() {
  if (!of.reason.trim()) { ElMessage.warning('下架必须写原因'); return }
  of.saving = true
  try {
    await offlineListing(of.row.listingId, of.reason)
    ElMessage.success('已下架')
    of.visible = false
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    of.saving = false
  }
}

onMounted(() => {
  stewardOpts.value = listingStewardOpts()
  try { scopeText.value = listingScopeHint() } catch { scopeText.value = '' }
  load()
})
</script>

<style scoped>
.lstats { margin-top: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.lstat { padding: 14px 16px; }
.lstat__k { font-size: 12.5px; color: var(--biz-text-3); }
.lstat__v {
  font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px;
}
.lstat__v.is-warn { color: var(--biz-warning, #d98a1f); }
.lstat__v.is-ok { color: var(--biz-success, #2f9e6e); }
.lstat__v.is-muted { color: var(--biz-text-2); }
.lstat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.lstat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }
.lstat__s.is-danger { color: var(--biz-danger, #d64545); }

.filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filters .spacer { flex: 1; }
.l-t { font-size: 13px; color: var(--biz-text-1); }
.sub { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.sub.is-danger { color: var(--biz-danger, #d64545); }
.mono { font-family: var(--biz-font-num); }
.money { font-family: var(--biz-font-num); }
.pager { display: flex; justify-content: flex-end; padding-top: 12px; }
.scope { font-size: 11.5px; color: var(--biz-text-3); }

.au-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding-bottom: 12px; border-bottom: 1px solid var(--biz-border); }
.au-t { font-size: 15px; color: var(--biz-text-1); font-weight: 600; }
.au-m { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }
.au-m .is-danger { color: var(--biz-danger, #d64545); }
.au-grid { display: grid; grid-template-columns: 272px minmax(0, 1fr); gap: 20px; margin-top: 14px; }
.au-col { min-width: 0; }
.sec__hd { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.sec__hd h4 { font-size: 13px; color: var(--biz-text-1); margin: 0; }
.sec__hd .desc { font-size: 11.5px; color: var(--biz-text-3); }
.au-note {
  margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--biz-bg-fill);
  font-size: 11.5px; line-height: 1.7; color: var(--biz-text-2);
}
.au-note b { color: var(--biz-text-1); }

.au-price { display: flex; align-items: baseline; gap: 6px; }
.au-price__n { font-family: var(--biz-font-num); font-size: 24px; color: var(--biz-danger, #d64545); }
.au-price__u { font-size: 12px; color: var(--biz-text-3); }
.au-price__d { font-size: 11.5px; color: var(--biz-text-3); margin-left: 8px; }
.au-meta { font-size: 12px; color: var(--biz-text-2); margin-top: 4px; }
.au-fac { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.au-desc {
  margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: var(--biz-bg-fill);
  font-size: 12px; line-height: 1.8; color: var(--biz-text-2);
}
.au-imgs { display: flex; gap: 8px; flex-wrap: wrap; }
.au-img {
  width: 84px; height: 84px; border-radius: 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  background: var(--biz-bg-fill); color: var(--biz-text-3); font-size: 11px;
}
.au-img.is-more { font-family: var(--biz-font-num); font-size: 13px; }
.au-warn {
  margin-top: 12px; padding: 8px 10px; border-radius: 8px;
  background: rgba(214, 69, 69, .07); color: var(--biz-danger, #d64545);
  font-size: 12px; line-height: 1.7;
}
.au-quick { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.au-quick__l { font-size: 11.5px; color: var(--biz-text-3); }
.au-quick .chip {
  font-size: 11.5px; color: var(--biz-text-2); background: var(--biz-bg-fill);
  padding: 3px 10px; border-radius: 12px; cursor: pointer;
}
.au-quick .chip.is-on { background: rgba(214, 69, 69, .1); color: var(--biz-danger, #d64545); font-weight: 600; }
.au-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; }
.au-assign { display: flex; align-items: center; gap: 8px; }
.au-assign__l { font-size: 12px; color: var(--biz-text-3); }
.au-btns { display: flex; gap: 10px; }

.dt-views { display: flex; flex-direction: column; gap: 8px; }
.dt-view {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 9px 12px; border-radius: 8px; border: 1px solid var(--biz-border);
}
.dt-view__n { font-size: 12.5px; color: var(--biz-text-1); }
.dt-view__r { text-align: right; }

.of-hd { font-size: 13px; color: var(--biz-text-1); }
</style>
