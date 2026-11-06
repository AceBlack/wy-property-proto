<!--
  邻里 · 闲置审核
  ------------------------------------------------------------
  这是全站唯一的 UGC 源（话题广场与跟帖已砍掉），所以审核只需要一套流程：
  左边队列、右边预览，通过 / 驳回两个动作，驳回必须写理由。
  不做「先发后审」：邻里纠纷、违禁品、邻里之间的指名对骂，上线十分钟就够闹到物业办公室。
-->
<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>闲置审核</b>：业主 / 租户自己发布，<b>先审后发</b>，通过后才出现在业主端。
        发布资格挂 A 域认证状态 —— 未认证的号根本发不出来，这里不会出现。
        <br />
        <b>驳回必须写理由</b>：业主会拿着「审核未通过」的通知来问为什么，一句"不符合规范"解释不了。
        常见理由是<b>禁售清单</b>：烟酒、药品、自制食品、活体宠物、仿冒品、管制器具。
        <br />
        <b>不做公开评论墙</b>（只有「想要 / 私信」）：一旦有业主对业主的公开回帖，
        审核就会把它往【社交-社区/论坛】类目靠，那是另一套资质与人力。
      </div>
    </div>

    <div class="grid istats">
      <div class="panel istat">
        <div class="istat__k">待审核</div>
        <div class="istat__v" :class="{ 'is-warn': st.pending }">{{ st.pending }} <span class="unit">条</span></div>
        <div class="istat__s">今日新增 {{ st.todayNew }} 条</div>
      </div>
      <div class="panel istat">
        <div class="istat__k">已上架</div>
        <div class="istat__v">{{ st.online }} <span class="unit">条</span></div>
        <div class="istat__s">业主端可见</div>
      </div>
      <div class="panel istat">
        <div class="istat__k">通过率</div>
        <div class="istat__v">{{ st.passRate }}<span class="unit">%</span></div>
        <div class="istat__s">已审内容中上架的比例</div>
      </div>
      <div class="panel istat">
        <div class="istat__k">累计驳回 / 下架</div>
        <div class="istat__v is-muted">{{ st.rejected }} / {{ st.offline }}</div>
        <div class="istat__s">被举报 {{ st.reported }} 次</div>
      </div>
    </div>

    <div class="ia-layout">
      <!-- 左：队列 -->
      <div class="panel ia-side">
        <div class="ia-bar">
          <el-input v-model="q.kw" clearable placeholder="标题 / 发布人" :prefix-icon="'Search'"
            size="small" @keyup.enter="applyFilter" />
        </div>
        <div class="ia-chips">
          <span v-for="s in STATUS_CHIPS" :key="s.v" class="chip" :class="{ 'is-on': q.status === s.v }"
            @click="pickStatus(s.v)">
            {{ s.t }}<em v-if="s.v === '待审核' && st.pending">{{ st.pending }}</em>
          </span>
        </div>

        <div v-loading="loading" class="ia-list">
          <div v-for="i in rows" :key="i.itemId" class="ic" :class="{ 'is-on': cur && cur.itemId === i.itemId }"
            @click="pick(i)">
            <div class="ic__ph">{{ i.category }}</div>
            <div class="ic__main">
              <div class="ic__t">{{ i.title }}</div>
              <div class="ic__m">{{ i.sellerName }} · {{ i.sellerHouse }}</div>
              <div class="ic__f">
                <span class="ic__p">{{ i.price ? `¥${i.price}` : '免费送' }}</span>
                <el-tag size="small" :type="i.statusType" effect="plain">{{ i.status }}</el-tag>
              </div>
            </div>
          </div>
          <EmptyState v-if="!rows.length" title="队列是空的" desc="新内容会先落到这里" />
        </div>

        <div class="ia-pager">
          <el-pagination
            v-model:current-page="pageNo" small layout="prev, pager, next" :total="total"
            :page-size="size" @current-change="load"
          />
        </div>
      </div>

      <!-- 右：预览 -->
      <div class="panel ia-main">
        <template v-if="cur">
          <div class="d-hd">
            <div>
              <div class="d-t">{{ cur.title }}</div>
              <div class="d-m">
                <span class="mono">{{ cur.itemId }}</span> · {{ cur.category }} · {{ cur.condition }} ·
                发布 {{ cur.publishAt }}
              </div>
            </div>
            <el-tag :type="cur.statusType" effect="plain">{{ cur.status }}</el-tag>
          </div>

          <div class="d-gallery">
            <div v-for="n in Math.min(cur.images, 4)" :key="n" class="d-img">
              <el-icon><Picture /></el-icon>
              <span>图 {{ n }}</span>
            </div>
            <div v-if="cur.images > 4" class="d-img is-more">+{{ cur.images - 4 }}</div>
          </div>

          <div class="d-price">
            <span class="d-price__now">{{ cur.price ? `¥${cur.price}` : '免费送' }}</span>
            <span v-if="cur.originPrice" class="d-price__old">原价 ¥{{ cur.originPrice }}</span>
            <span class="d-price__w">想要 {{ cur.wants }} · 浏览 {{ cur.views }}</span>
          </div>

          <div class="d-desc">{{ cur.desc || '（无描述）' }}</div>

          <el-descriptions :column="2" border size="small" style="margin-top:14px;">
            <el-descriptions-item label="发布人">
              {{ cur.sellerName }}
              <el-tag size="small" type="info" effect="plain" style="margin-left:4px;">{{ cur.sellerType }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="房号">{{ cur.sellerHouse }}</el-descriptions-item>
            <el-descriptions-item label="联系方式">
              {{ cur.contactMode }}<template v-if="cur.sellerPhone"> · {{ cur.sellerPhone }}</template>
            </el-descriptions-item>
            <el-descriptions-item label="所属项目">{{ cur.communityName }}</el-descriptions-item>
            <el-descriptions-item v-if="cur.reportCount" label="被举报">
              <span class="warn-txt">{{ cur.reportCount }} 次</span>
            </el-descriptions-item>
            <el-descriptions-item v-if="cur.auditBy" label="上次审核">{{ cur.auditBy }} · {{ cur.auditAt }}</el-descriptions-item>
          </el-descriptions>

          <div v-if="cur.rejectReason" class="d-note is-danger">
            <b>驳回理由：</b>{{ cur.rejectReason }}
          </div>
          <div v-if="cur.offlineReason" class="d-note is-danger">
            <b>下架理由：</b>{{ cur.offlineReason }}
          </div>

          <!-- 待审：通过 / 驳回 -->
          <div v-if="cur.status === '待审核' && canAudit" class="d-act">
            <div class="d-act__hd">
              <h4>审核</h4>
              <span class="desc">按禁售清单判断 · 拿不准就驳回并要求补充说明</span>
            </div>
            <div class="d-quick">
              <span class="d-quick__l">驳回理由</span>
              <span v-for="r in REJECT_PRESETS" :key="r" class="chip" :class="{ 'is-on': rejectForm.reason === r }"
                @click="rejectForm.reason = r">{{ r }}</span>
            </div>
            <el-input v-model="rejectForm.reason" type="textarea" :rows="2" maxlength="60" show-word-limit
              placeholder="写清具体原因，业主看得到这句" style="margin-top:10px;" />
            <div class="d-act__btns">
              <el-button :loading="saving" @click="doAudit(false)">驳回</el-button>
              <el-button type="primary" :loading="saving" @click="doAudit(true)">通过并上架</el-button>
            </div>
            <div class="d-tip">
              通过后立即出现在业主端「邻里 · 闲置」。30 天后自动过期，业主可一键重发。
            </div>
          </div>

          <!-- 已上架：下架 -->
          <div v-else-if="cur.status === '已上架' && canAudit" class="d-act">
            <div class="d-act__hd">
              <h4>已上架</h4>
              <span class="desc">内容正在业主端展示</span>
            </div>
            <el-input v-model="offlineForm.reason" type="textarea" :rows="2" maxlength="60" show-word-limit
              placeholder="下架理由（必填），会同步给发布人" />
            <div class="d-act__btns">
              <el-button type="danger" plain :loading="saving" @click="doOffline">下架</el-button>
            </div>
          </div>

          <div v-else class="d-note">
            {{ cur.status === '待审核' ? '当前角色只有查看权限，不能审核。' : `当前状态「${cur.status}」，没有可执行的动作。` }}
          </div>
        </template>

        <EmptyState v-else title="从左边选一条内容" desc="待审的排最前，过审的也可以翻出来下架" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ITEM_STATUSES, auditItem, canAuditItems, itemStats, offlineItem, queryItems
} from '@/api/neighbor'
import EmptyState from '@/components/EmptyState.vue'

const canAudit = ref(canAuditItems())
const STATUS_CHIPS = [{ v: '', t: '全部' }, ...ITEM_STATUSES.map(s => ({ v: s, t: s }))]
const REJECT_PRESETS = ['属禁售清单', '描述与图片不符', '联系方式违规', '图片不清晰', '重复发布']

const q = reactive({ kw: '', status: '待审核' })
const pageNo = ref(1)
const size = ref(12)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const saving = ref(false)
const cur = ref(null)
const st = ref({ total: 0, pending: 0, online: 0, rejected: 0, offline: 0, expired: 0, todayNew: 0, passRate: 0, reported: 0 })

const rejectForm = reactive({ reason: '' })
const offlineForm = reactive({ reason: '' })

async function load() {
  loading.value = true
  try {
    const res = await queryItems({ pageNo: pageNo.value, size: size.value, filters: { ...q } })
    rows.value = res.rows
    total.value = res.total
    st.value = itemStats()
    /* 列表刷新后保持选中项：审核完一条接着看下一条，是最常见的路径 */
    if (cur.value) {
      const hit = rows.value.find(r => r.itemId === cur.value.itemId)
      cur.value = hit || rows.value[0] || null
    } else {
      cur.value = rows.value[0] || null
    }
    pick(cur.value)
  } catch (e) {
    ElMessage.error(e?.message || '队列加载失败')
  } finally {
    loading.value = false
  }
}
function applyFilter() { pageNo.value = 1; load() }
function pickStatus(v) { q.status = v; applyFilter() }

function pick(row) {
  if (!row) return
  cur.value = row
  rejectForm.reason = row.rejectReason || ''
  offlineForm.reason = row.offlineReason || ''
}

async function doAudit(pass) {
  if (!pass && !rejectForm.reason.trim()) {
    ElMessage.warning('驳回必须写理由 —— 业主会拿着通知来问为什么')
    return
  }
  saving.value = true
  try {
    await auditItem(cur.value.itemId, { pass, reason: rejectForm.reason })
    ElMessage.success(pass ? '已通过，业主端可见' : '已驳回，理由已记录')
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

async function doOffline() {
  if (!offlineForm.reason.trim()) { ElMessage.warning('下架必须写理由'); return }
  saving.value = true
  try {
    await offlineItem(cur.value.itemId, offlineForm.reason)
    ElMessage.success('已下架')
    await load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.istats { margin-top: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.istat { padding: 14px 16px; }
.istat__k { font-size: 12.5px; color: var(--biz-text-3); }
.istat__v {
  font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-text-1); margin-top: 4px;
  display: flex; align-items: baseline; gap: 4px;
}
.istat__v.is-warn { color: var(--biz-warning, #d98a1f); }
.istat__v.is-muted { color: var(--biz-text-2); }
.istat__v .unit { font-size: 12px; color: var(--biz-text-3); }
.istat__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }

.ia-layout { display: grid; grid-template-columns: 372px minmax(0, 1fr); gap: 16px; margin-top: 16px; align-items: start; }
.ia-side { padding: 0 0 8px; display: flex; flex-direction: column; max-height: 760px; }
.ia-bar { padding: 10px 12px 6px; }
.ia-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 12px 8px; }
.ia-chips .chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; color: var(--biz-text-2); background: var(--biz-bg-fill);
  padding: 3px 10px; border-radius: 12px; cursor: pointer;
}
.ia-chips .chip.is-on { background: rgba(91, 108, 255, .12); color: var(--el-color-primary); font-weight: 600; }
.ia-chips .chip em {
  font-style: normal; font-size: 10px; background: var(--biz-warning, #d98a1f); color: #fff;
  border-radius: 7px; padding: 0 5px; line-height: 1.5;
}

.ia-list { flex: 1; overflow: auto; padding: 0 8px; }
.ic { display: flex; gap: 10px; padding: 9px; border-radius: 9px; cursor: pointer; border: 1px solid transparent; }
.ic:hover { background: var(--biz-bg-fill); }
.ic.is-on { background: rgba(91, 108, 255, .07); border-color: rgba(91, 108, 255, .25); }
.ic__ph {
  width: 46px; height: 46px; flex: 0 0 46px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: var(--biz-bg-fill); color: var(--biz-text-3); font-size: 11px;
}
.ic__main { min-width: 0; flex: 1; }
.ic__t {
  font-size: 12.5px; color: var(--biz-text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ic__m {
  font-size: 11px; color: var(--biz-text-3); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ic__f { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.ic__p { font-size: 12px; font-family: var(--biz-font-num); color: var(--biz-warning, #d98a1f); }
.ia-pager { display: flex; justify-content: center; padding: 6px 0 2px; }

.ia-main { padding: 16px 18px 18px; min-height: 300px; }
.d-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.d-t { font-size: 16px; color: var(--biz-text-1); font-weight: 600; }
.d-m { font-size: 11.5px; color: var(--biz-text-3); margin-top: 4px; }
.mono { font-family: var(--biz-font-num); }

.d-gallery { display: flex; gap: 8px; margin-top: 14px; }
.d-img {
  width: 96px; height: 96px; border-radius: 10px; flex: 0 0 96px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  background: var(--biz-bg-fill); color: var(--biz-text-3); font-size: 11px;
}
.d-img.is-more { font-family: var(--biz-font-num); font-size: 13px; }

.d-price { display: flex; align-items: baseline; gap: 10px; margin-top: 14px; }
.d-price__now { font-family: var(--biz-font-num); font-size: 22px; color: var(--biz-danger, #d64545); }
.d-price__old { font-size: 12px; color: var(--biz-text-3); text-decoration: line-through; }
.d-price__w { font-size: 11.5px; color: var(--biz-text-3); margin-left: auto; }

.d-desc {
  margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: var(--biz-bg-fill);
  font-size: 12.5px; line-height: 1.8; color: var(--biz-text-2);
}
.d-note {
  margin-top: 12px; padding: 10px 12px; border-radius: 8px;
  background: var(--biz-bg-fill); font-size: 12px; line-height: 1.7; color: var(--biz-text-2);
}
.d-note.is-danger { background: rgba(214, 69, 69, .06); color: var(--biz-danger, #d64545); }
.d-note b { color: inherit; }

.d-act { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--biz-border); }
.d-act__hd { display: flex; align-items: baseline; gap: 10px; }
.d-act__hd h4 { font-size: 13px; color: var(--biz-text-1); margin: 0; }
.d-act__hd .desc { font-size: 11.5px; color: var(--biz-text-3); }
.d-quick { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.d-quick__l { font-size: 11.5px; color: var(--biz-text-3); }
.d-quick .chip {
  font-size: 11.5px; color: var(--biz-text-2); background: var(--biz-bg-fill);
  padding: 3px 10px; border-radius: 12px; cursor: pointer;
}
.d-quick .chip.is-on { background: rgba(214, 69, 69, .1); color: var(--biz-danger, #d64545); font-weight: 600; }
.d-act__btns { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; }
.d-tip { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; }
.warn-txt { color: var(--biz-warning, #d98a1f); }
</style>
