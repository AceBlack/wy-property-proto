<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>详情页模板 · A 级交互</b>：概要头（标题 + 状态 + 关键指标 + 主操作）→ 分区描述列表 → 关联子表 → 流转时间线。
        ①支持 <code>?id=</code> 从列表页带参数进入；②「编辑」打开<b>编辑抽屉</b>（校验 + 保存反馈 + 刷新）；
        ③「去收银台 / 业主 360」为真实路由跳转；④「查看全部账单」打开抽屉展示完整子表。
      </div>
    </div>

    <!-- 概要头 -->
    <div class="panel" style="margin-top:16px;">
      <div v-loading="detailLoading">
        <div class="dhead">
          <div class="dhead__l">
            <div class="dhead__t">
              {{ house?.fullName || '—' }}
              <StatusTag v-if="house" domain="house" :value="house.useStatus" />
              <span class="tag tag--muted">{{ house?.usage }}</span>
            </div>
            <div class="dhead__s">
              房屋编号 {{ house?.houseId }} · {{ house?.houseType }} · 朝向 {{ house?.orientation }} ·
              业主 {{ owner?.name || '-' }} {{ owner?.phone || '' }}
            </div>
          </div>
          <div class="dhead__r">
            <el-button :icon="'EditPen'" @click="editVisible = true">编辑</el-button>
            <el-button :icon="'Printer'" @click="soon('打印台账')">打印台账</el-button>
            <el-button type="primary" :icon="'Money'" @click="goCashier">去收银台</el-button>
          </div>
        </div>

        <div class="grid g4" style="margin-top:18px;">
          <div class="dstat">
            <div class="dstat__k">建筑面积</div>
            <div class="dstat__v">{{ money(house?.area) }}<span class="unit">㎡</span></div>
          </div>
          <div class="dstat">
            <div class="dstat__k">当前欠费</div>
            <div class="dstat__v" :class="debt > 0 ? 'is-warn' : ''">¥ {{ money(debt) }}</div>
          </div>
          <div class="dstat">
            <div class="dstat__k">在途工单</div>
            <div class="dstat__v">{{ openWo }}<span class="unit">单</span></div>
          </div>
          <div class="dstat">
            <div class="dstat__k">车位</div>
            <div class="dstat__v">{{ myParkings.length }}<span class="unit">个</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:2fr 1fr;">
      <div>
        <!-- 基本信息 -->
        <div class="panel">
          <div class="sec__hd"><h4>房屋信息</h4></div>
          <div class="dl">
            <div class="dl__i"><span class="dl__k">项目</span><span class="dl__v">{{ community?.name || '-' }}</span></div>
            <div class="dl__i"><span class="dl__k">楼栋</span><span class="dl__v">{{ building?.name || '-' }}</span></div>
            <div class="dl__i"><span class="dl__k">房号</span><span class="dl__v">{{ house?.room }}</span></div>
            <div class="dl__i"><span class="dl__k">楼层</span><span class="dl__v">{{ house?.floor }} 层</span></div>
            <div class="dl__i"><span class="dl__k">户型</span><span class="dl__v">{{ house?.houseType }}</span></div>
            <div class="dl__i"><span class="dl__k">套内面积</span><span class="dl__v">{{ money(house?.innerArea) }} ㎡</span></div>
            <div class="dl__i"><span class="dl__k">朝向</span><span class="dl__v">{{ house?.orientation }}</span></div>
            <div class="dl__i"><span class="dl__k">装修</span><span class="dl__v">{{ house?.decoration }}</span></div>
            <div class="dl__i"><span class="dl__k">交付状态</span><span class="dl__v">{{ house?.deliverStatus }}</span></div>
            <div class="dl__i"><span class="dl__k">入住日期</span><span class="dl__v">{{ house?.checkinDate || '-' }}</span></div>
            <div class="dl__i"><span class="dl__k">产权证号</span><span class="dl__v">{{ house?.certNo || '-' }}</span></div>
          </div>
        </div>

        <!-- 账单 -->
        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd">
            <h3>账单记录</h3><span class="spacer" />
            <span class="desc">应收合计 ¥{{ money(totalDue) }} · 欠费 ¥{{ money(debt) }}</span>
            <el-button link type="primary" @click="billsVisible = true">查看全部</el-button>
          </div>
          <el-table :data="myBills.slice(0, 8)" size="small">
            <el-table-column prop="period" label="账期" width="90" />
            <el-table-column prop="itemName" label="科目" min-width="120" />
            <el-table-column prop="payable" label="应收" width="110" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.payable) }}</span></template>
            </el-table-column>
            <el-table-column prop="unpaid" label="欠费" width="110" align="right">
              <template #default="{ row }">
                <span class="money" :class="{ 'money--out': row.unpaid > 0 }">{{ money(row.unpaid) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="overdueDays" label="逾期" width="80" align="right">
              <template #default="{ row }">{{ row.overdueDays ? `${row.overdueDays} 天` : '-' }}</template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 工单 -->
        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd"><h3>关联工单</h3><span class="spacer" /><span class="desc">{{ myWos.length }} 单</span></div>
          <el-table :data="myWos" size="small">
            <el-table-column prop="woNo" label="工单号" width="130" />
            <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
            <el-table-column prop="type" label="类型" width="110" />
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }"><StatusTag domain="workOrder" :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="createTime" label="创建时间" width="140" />
          </el-table>
          <div v-if="!myWos.length" style="padding:8px 0;"><EmptyState type="empty" desc="该房屋暂无工单记录" /></div>
        </div>
      </div>

      <div>
        <!-- 业主 -->
        <div class="panel">
          <div class="sec__hd"><h4>业主</h4><span class="desc">{{ owner?.ownerType }}</span></div>
          <div class="dl dl--2">
            <div class="dl__i"><span class="dl__k">姓名</span><span class="dl__v strong">{{ owner?.name }}</span></div>
            <div class="dl__i"><span class="dl__k">手机</span><span class="dl__v">{{ owner?.phone }}</span></div>
            <div class="dl__i"><span class="dl__k">证件</span><span class="dl__v">{{ maskId(owner?.idCard) }}</span></div>
            <div class="dl__i"><span class="dl__k">信用</span><span class="dl__v">{{ owner?.creditLevel }} 级</span></div>
            <div class="dl__i is-full"><span class="dl__k">名下房产</span><span class="dl__v">{{ owner?.houseIds.length }} 套 · 车位 {{ owner?.parkIds.length }} 个</span></div>
            <div class="dl__i is-full"><span class="dl__k">备注</span><span class="dl__v">{{ owner?.remark || '-' }}</span></div>
          </div>
          <div style="margin-top:12px;">
            <el-button link type="primary" @click="router.push('/a/owner360')">查看业主 360 档案 →</el-button>
          </div>
        </div>

        <!-- 车位 -->
        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>车位与车辆</h4></div>
          <div v-for="p in myParkings" :key="p.parkId" class="pk">
            <div class="pk__t">
              {{ p.parkNo }}
              <StatusTag domain="parking" :value="p.status" />
            </div>
            <div class="pk__d">{{ p.plateNo || '未绑定车牌' }} · {{ p.category }} · {{ expireText(p.expireDate) }}</div>
          </div>
          <div v-if="!myParkings.length"><EmptyState type="empty" desc="暂无车位" /></div>
        </div>

        <!-- 时间线 -->
        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>变更记录</h4></div>
          <div class="tl">
            <div class="tl__i is-done">
              <div class="tl__t">入住办理</div>
              <div class="tl__m">{{ house?.checkinDate }} · 前台办理</div>
            </div>
            <div class="tl__i is-done">
              <div class="tl__t">产权登记</div>
              <div class="tl__m">{{ house?.deliverStatus === '已交付' ? '已办证' : '未办证' }} · {{ house?.certNo || '-' }}</div>
            </div>
            <div class="tl__i is-now">
              <div class="tl__t">账单生成（{{ myBills[0]?.period || '-' }}）</div>
              <div class="tl__m">系统自动生成 · 应收 ¥{{ money(myBills[0]?.payable || 0) }}</div>
            </div>
            <div class="tl__i">
              <div class="tl__t">最近缴费</div>
              <div class="tl__m">{{ lastPay?.payTime || '-' }} · ¥{{ money(lastPay?.paidAmount || 0) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑抽屉 -->
    <DetailDrawer
      v-model="editVisible" title="编辑房屋" :subtitle="house?.fullName"
      :status="house?.useStatus" status-domain="house"
    >
      <el-form ref="editRef" :model="editForm" :rules="editRules" label-width="96px">
        <el-form-item label="用途" prop="usage">
          <el-select v-model="editForm.usage" style="width:100%">
            <el-option v-for="u in usageOpts" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="使用状态" prop="useStatus">
          <el-select v-model="editForm.useStatus" style="width:100%">
            <el-option v-for="u in useStatusOpts" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="产权证号" prop="certNo">
          <el-input v-model="editForm.certNo" placeholder="选填" />
        </el-form-item>
        <el-form-item label="变更原因" prop="reason">
          <el-input v-model="editForm.reason" type="textarea" :rows="3" maxlength="100" show-word-limit placeholder="必填，写入变更记录" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </DetailDrawer>

    <!-- 全部账单抽屉 -->
    <DetailDrawer
      v-model="billsVisible" title="账单记录" :subtitle="`${house?.fullName} · 共 ${myBills.length} 笔`"
    >
      <el-table :data="myBills" size="small" max-height="520">
        <el-table-column prop="period" label="账期" width="90" />
        <el-table-column prop="itemName" label="科目" min-width="120" />
        <el-table-column prop="payable" label="应收" width="110" align="right">
          <template #default="{ row }"><span class="money">{{ money(row.payable) }}</span></template>
        </el-table-column>
        <el-table-column prop="unpaid" label="欠费" width="110" align="right">
          <template #default="{ row }">
            <span class="money" :class="{ 'money--out': row.unpaid > 0 }">{{ money(row.unpaid) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="billsVisible = false">关闭</el-button>
        <el-button type="primary" @click="billsVisible = false; goCashier()">去收银台缴费</el-button>
      </template>
    </DetailDrawer>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getHouseDetail, houseUsageOpts, houseUseStatusOpts } from '@/utils/api'
import { useDetail } from '@/composables/useQuery'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { expireText, maskId, money } from '@/utils/format'

const route = useRoute()
const router = useRouter()

// 默认演示对象：张建国名下房产（一人多房 + 欠费 + 在途工单）
const DEFAULT_ID = 'H010110501'

/* useDetail 返回含 ref 的对象：解构成顶层 ref，模板自动解包、脚本用 .value */
const {
  data: houseData, loading: detailLoading, open: openDetail
} = useDetail(getHouseDetail)
const houseId = computed(() => String(route.query.id || DEFAULT_ID))
openDetail(houseId.value)
watch(houseId, id => openDetail(id))

const house = computed(() => houseData.value?.house || null)
const owner = computed(() => houseData.value?.owner || null)
const community = computed(() => houseData.value?.community || null)
const building = computed(() => houseData.value?.building || null)
const myBills = computed(() => houseData.value?.bills || [])
const myWos = computed(() => houseData.value?.workOrders || [])
const myParkings = computed(() => houseData.value?.parkings || [])

const debt = computed(() => myBills.value.reduce((s, b) => s + (b.unpaid || 0), 0))
const totalDue = computed(() => myBills.value.reduce((s, b) => s + (b.payable || 0), 0))
const lastPay = computed(() =>
  myBills.value.filter(b => b.payTime).sort((a, b) => b.payTime.localeCompare(a.payTime))[0]
)
const openWo = computed(() =>
  myWos.value.filter(w => !['已关闭', '已评价', '已取消'].includes(w.status)).length
)

/* ---- 编辑抽屉 ---- */
const editVisible = ref(false)
const billsVisible = ref(false)
const saving = ref(false)
const editRef = ref()
const editForm = ref({ usage: '', useStatus: '', certNo: '', reason: '' })
const usageOpts = houseUsageOpts()
const useStatusOpts = houseUseStatusOpts()
const editRules = {
  usage: [{ required: true, message: '请选择用途', trigger: 'change' }],
  useStatus: [{ required: true, message: '请选择使用状态', trigger: 'change' }],
  reason: [{ required: true, message: '请填写变更原因', trigger: 'blur' }]
}

watch(editVisible, v => {
  if (v && house.value) {
    editForm.value = {
      usage: house.value.usage, useStatus: house.value.useStatus,
      certNo: house.value.certNo || '', reason: ''
    }
  }
})

async function submitEdit() {
  const ok = await editRef.value?.validate().catch(() => false)
  if (!ok) return
  saving.value = true
  setTimeout(() => {
    saving.value = false
    editVisible.value = false
    ElMessage.success('已保存，变更已写入时间线（原型阶段不写库）')
    openDetail(houseId.value)
  }, 500)
}

function goCashier() { router.push('/b/cashier') }
function soon(name) { ElMessage(`${name}属于 B 级能力，原型阶段仅提示`) }
</script>

<style scoped>
.dhead { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.dhead__l { flex: 1; min-width: 0; }
.dhead__t { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; color: var(--biz-text-1); }
.dhead__s { font-size: 12.5px; color: var(--biz-text-3); margin-top: 6px; }
.dhead__r { display: flex; gap: 8px; }
.dstat { background: var(--biz-bg-fill); border-radius: 10px; padding: 12px 14px; }
.dstat__k { font-size: 12px; color: var(--biz-text-3); }
.dstat__v { font-family: var(--biz-font-num); font-size: 20px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
.dstat__v .unit { font-size: 12px; color: var(--biz-text-3); margin-left: 3px; font-weight: 400; }
.dstat__v.is-warn { color: var(--biz-danger); }
.pk { padding: 10px 0; border-bottom: 1px solid var(--biz-border-light); }
.pk:last-child { border-bottom: none; }
.pk__t { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; }
.pk__d { font-size: 12px; color: var(--biz-text-3); margin-top: 3px; }
</style>
