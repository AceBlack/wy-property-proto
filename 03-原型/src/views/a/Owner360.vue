<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>业主 360 档案</b>：以「业主」而非「房屋」为中心组织。一人多房是本项目的一等公民——
        头部按业主聚合欠费，账单表可按房切换，收银台与催缴从本页直接进入。
      </div>
    </div>

    <!-- 概要头 -->
    <div class="panel" style="margin-top:16px;">
      <div class="ohead">
        <div class="ohead__ava">{{ owner.name.slice(0, 1) }}</div>
        <div class="ohead__info">
          <div class="ohead__nm">
            {{ owner.name }}
            <span class="tag tag--primary">{{ owner.ownerType }}</span>
            <span class="tag" :class="owner.creditLevel === 'A' ? 'tag--success' : 'tag--warning'">信用 {{ owner.creditLevel }}</span>
            <span v-if="owner.certified" class="tag tag--success">已实名</span>
            <span v-else class="tag tag--muted">未实名</span>
          </div>
          <div class="ohead__sub">
            <SensitiveText :value="owner.phone" field="phone" entity-type="业主" :entity-id="owner.ownerId"
              :entity-name="owner.name" source="/a/owner360" /> ·
            证件 <SensitiveText :value="owner.idCard" field="idCard" entity-type="业主" :entity-id="owner.ownerId"
              :entity-name="owner.name" source="/a/owner360" /> · 入住 {{ owner.registerDate }}
            · 人脸{{ owner.faceRegistered ? '已录' : '未录' }} · APP{{ owner.appRegistered ? '已注册' : '未注册' }}
          </div>
          <div class="ohead__tags">
            <span v-for="t in owner.tags" :key="t" class="tag tag--info">{{ t }}</span>
            <span v-if="owner.remark" class="muted" style="font-size:12px;">备注：{{ owner.remark }}</span>
          </div>
        </div>
        <div class="ohead__act">
          <el-select v-model="ownerId" filterable style="width:180px;" placeholder="切换业主">
            <el-option v-for="o in demoOwners" :key="o.ownerId" :label="`${o.name} ${o.phone}`" :value="o.ownerId" />
          </el-select>
          <el-button :icon="'EditPen'">编辑档案</el-button>
          <el-button :icon="'ChatDotRound'">发通知</el-button>
          <el-button type="primary" :icon="'Money'">去收银台</el-button>
        </div>
      </div>

      <div class="grid g4" style="margin-top:18px;">
        <div class="dstat">
          <div class="dstat__k">名下房产</div>
          <div class="dstat__v">{{ p.houses.length }}<span class="unit">套 · {{ money(p.totalArea) }}㎡</span></div>
        </div>
        <div class="dstat">
          <div class="dstat__k">车位 / 车辆</div>
          <div class="dstat__v">{{ p.parkings.length }}<span class="unit">位 / {{ p.vehicles.length }} 车</span></div>
        </div>
        <div class="dstat">
          <div class="dstat__k">当前欠费</div>
          <div class="dstat__v" :class="p.debt > 0 ? 'is-warn' : ''">¥ {{ money(p.debt) }}</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">最长逾期</div>
          <div class="dstat__v" :class="p.maxOverdue > 90 ? 'is-warn' : ''">{{ p.maxOverdue }}<span class="unit">天</span></div>
        </div>
      </div>

      <!-- 一人多房：按房欠费条 -->
      <div v-if="p.debtByHouse.length" class="hdebts">
        <div v-for="d in p.debtByHouse" :key="d.house.houseId" class="hdebt" :class="{ 'is-debt': d.debt > 0 }">
          <div class="hdebt__n">{{ d.house.fullName }}</div>
          <div class="hdebt__v">
            <template v-if="d.debt > 0">欠费 ¥{{ money(d.debt) }} · {{ d.count }} 笔</template>
            <template v-else>无欠费</template>
          </div>
          <div class="hdebt__o">{{ d.maxOverdue ? `最长逾期 ${d.maxOverdue} 天` : '-' }}</div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="panel" style="margin-top:16px;">
      <el-tabs v-model="tab">
        <el-tab-pane label="房产与车位" name="house">
          <div class="sec__hd" style="margin-bottom:12px;"><h4>名下房产</h4><span class="desc">{{ p.houses.length }} 套</span></div>
          <el-table :data="p.houses" size="small">
            <el-table-column prop="fullName" label="房屋" min-width="180" />
            <el-table-column prop="usage" label="用途" width="90" />
            <el-table-column prop="houseType" label="户型" width="110" />
            <el-table-column prop="area" label="面积" width="100" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.area) }}</span> ㎡</template>
            </el-table-column>
            <el-table-column prop="useStatus" label="使用状态" width="100">
              <template #default="{ row }"><StatusTag domain="house" :value="row.useStatus" /></template>
            </el-table-column>
            <el-table-column prop="deliverStatus" label="交付" width="90" />
            <el-table-column label="租户" width="110">
              <template #default="{ row }">{{ tenantOf(row.houseId)?.name || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <el-button link type="primary">房屋详情</el-button>
                <el-button link type="primary">账单</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="sec__hd" style="margin:20px 0 12px;"><h4>车位与车辆</h4><span class="desc">{{ p.parkings.length }} 个车位</span></div>
          <el-table :data="p.parkings" size="small">
            <el-table-column prop="parkNo" label="车位号" width="110" />
            <el-table-column prop="zone" label="区域" width="80" />
            <el-table-column prop="category" label="类型" width="110" />
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }"><StatusTag domain="parking" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="绑定车牌" width="130">
              <template #default="{ row }">{{ row.plateNo || '-' }}</template>
            </el-table-column>
            <el-table-column prop="bindStatus" label="绑定状态" width="100">
              <template #default="{ row }"><StatusTag domain="bindStatus" :value="row.bindStatus" /></template>
            </el-table-column>
            <el-table-column label="管理费到期" min-width="190">
              <template #default="{ row }"><span class="nowrap">{{ row.expireDate }}（{{ expireText(row.expireDate) }}）</span></template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default><el-button link type="primary">换绑车牌</el-button></template>
            </el-table-column>
            <template #empty><EmptyState type="empty" desc="该业主暂无车位" /></template>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`账单（${p.bills.length}）`" name="bill">
          <div class="toolbar">
            <el-radio-group v-model="billHouse" size="small">
              <el-radio-button label="__all">全部房产</el-radio-button>
              <el-radio-button v-for="h in p.houses" :key="h.houseId" :label="h.houseId">{{ h.room }}</el-radio-button>
            </el-radio-group>
            <span class="spacer" />
            <span class="muted" style="font-size:12.5px;">
              应收 ¥{{ money(shownBills.reduce((s, b) => s + b.payable, 0)) }} ·
              欠费 ¥{{ money(shownBills.filter(b => b.unpaid > 0).reduce((s, b) => s + b.unpaid, 0)) }}
            </span>
            <el-button :icon="'Printer'">催缴单</el-button>
            <el-button type="primary" :icon="'Money'">合并收费</el-button>
          </div>
          <el-table :data="shownBills" size="small" max-height="420">
            <el-table-column prop="period" label="账期" width="90" />
            <el-table-column prop="itemName" label="科目" width="130" />
            <el-table-column label="房屋" min-width="160">
              <template #default="{ row }">{{ houseName(row.houseId) }}</template>
            </el-table-column>
            <el-table-column prop="payable" label="应收" width="110" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.payable) }}</span></template>
            </el-table-column>
            <el-table-column prop="unpaid" label="欠费" width="110" align="right">
              <template #default="{ row }">
                <span class="money" :class="{ 'money--out': row.unpaid > 0 }">{{ money(row.unpaid) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="overdueDays" label="逾期" width="80" align="right">
              <template #default="{ row }">{{ row.overdueDays || '-' }}</template>
            </el-table-column>
            <el-table-column prop="dueDate" label="应缴日" width="110" />
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }"><StatusTag domain="bill" :value="row.status" /></template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`工单（${p.workOrders.length}）`" name="wo">
          <el-table :data="p.workOrders" size="small">
            <el-table-column prop="woNo" label="工单号" width="130" />
            <el-table-column prop="title" label="标题" min-width="200" show-overflow-tooltip />
            <el-table-column prop="type" label="类型" width="110" />
            <el-table-column prop="priority" label="优先级" width="90">
              <template #default="{ row }"><StatusTag domain="priority" :value="row.priority" /></template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="100">
              <template #default="{ row }"><StatusTag domain="workOrder" :value="row.status" /></template>
            </el-table-column>
            <el-table-column prop="assignee" label="处理人" width="100" />
            <el-table-column prop="createTime" label="创建时间" width="140" />
            <template #empty><EmptyState type="empty" desc="暂无工单" /></template>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="成员与租户" name="member">
          <div class="sec__hd" style="margin-bottom:12px;">
            <h4>家庭成员</h4>
            <span class="desc">
              共 {{ mSum.total }} 人 · 实名 {{ mSum.certified }} · 人脸 {{ mSum.faced }} · 已授权 {{ mSum.granted }}
            </span>
            <span class="spacer" />
            <el-button type="primary" :icon="'Plus'" size="small" @click="openMember(null)">新增成员</el-button>
          </div>
          <el-table :data="memberList" size="small">
            <el-table-column prop="name" label="姓名" width="100" />
            <el-table-column prop="relation" label="关系" width="100" />
            <el-table-column prop="phone" label="手机号" width="140" />
            <el-table-column label="证件" min-width="180">
              <template #default="{ row }">
                <SensitiveText :value="row.idCard" field="idCard" entity-type="业主" :entity-id="row.ownerId"
                  :entity-name="row.name" source="/a/owner360" />
              </template>
            </el-table-column>
            <el-table-column label="认证" width="90">
              <template #default="{ row }">
                <span class="tag" :class="row.certified ? 'tag--success' : 'tag--muted'">{{ row.certified ? '已认证' : '未认证' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="人脸" width="90">
              <template #default="{ row }">
                <span class="tag" :class="row.faceRegistered ? 'tag--success' : 'tag--muted'">{{ row.faceRegistered ? '已录入' : '未录入' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="门禁授权" width="110">
              <template #default="{ row }">
                <span class="tag" :class="row.access === '未授权' ? 'tag--muted' : 'tag--info'">{{ row.access }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click="openMember(row)">编辑</el-button>
                <el-button link type="primary" @click="openAccess(row)">授权</el-button>
                <el-button link type="danger" @click="delMember(row)">移除</el-button>
              </template>
            </el-table-column>
            <template #empty><EmptyState type="empty" desc="暂无家庭成员，点「新增成员」建档" /></template>
          </el-table>

          <div class="sec__hd" style="margin:20px 0 12px;"><h4>租户</h4></div>
          <el-table :data="tenantList" size="small">
            <el-table-column prop="name" label="姓名" width="100" />
            <el-table-column prop="phone" label="手机号" width="140" />
            <el-table-column label="房屋" min-width="180">
              <template #default="{ row }">{{ houseName(row.houseId) }}</template>
            </el-table-column>
            <el-table-column label="租期" width="200">
              <template #default="{ row }">{{ row.leaseStart }} ~ {{ row.leaseEnd }}</template>
            </el-table-column>
            <el-table-column prop="rent" label="月租" width="110" align="right">
              <template #default="{ row }"><span class="money">{{ money(row.rent) }}</span></template>
            </el-table-column>
            <template #empty><EmptyState type="empty" desc="名下房屋暂无租户" /></template>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="跟进记录" name="log">
          <div class="tl">
            <div v-for="(e, i) in timeline" :key="i" class="tl__i" :class="{ 'is-done': i < 2 }">
              <div class="tl__t">{{ e.title }}</div>
              <div class="tl__m">{{ e.time }} · {{ e.from }}</div>
            </div>
            <div v-if="!timeline.length"><EmptyState type="empty" desc="暂无跟进记录" /></div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- A1：家庭成员建档（新增 / 编辑） -->
    <el-dialog v-model="mVisible" :title="mForm.memberId ? '编辑成员' : '新增家庭成员'" width="560">
      <el-form ref="mRef" :model="mForm" :rules="mRules" label-width="86px">
        <el-form-item label="姓名" prop="name">
          <el-input v-model="mForm.name" placeholder="请输入成员姓名" style="width:200px" />
        </el-form-item>
        <el-form-item label="与业主关系" prop="relation">
          <el-select v-model="mForm.relation" style="width:200px">
            <el-option v-for="r in MEMBER_RELATIONS" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="mForm.phone" placeholder="11 位手机号，可留空" style="width:200px" />
        </el-form-item>
        <el-form-item label="证件号码" prop="idCard">
          <el-input v-model="mForm.idCard" placeholder="身份证 / 护照 / 港澳台通行证，可留空" style="width:260px" clearable />
        </el-form-item>
        <el-form-item label="认证状态">
          <el-checkbox v-model="mForm.certified" label="已实名认证" />
          <el-checkbox v-model="mForm.faceRegistered" label="人脸已录入" />
          <el-checkbox v-model="mForm.isOwnerAppUser" label="已是 App 用户" />
        </el-form-item>
        <el-form-item label="门禁授权" prop="access">
          <el-select v-model="mForm.access" style="width:200px">
            <el-option v-for="a in MEMBER_ACCESS" :key="a" :label="a" :value="a" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="mForm.remark" type="textarea" :rows="2" placeholder="如：长期同住 / 仅节假日居住" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mVisible = false">取消</el-button>
        <el-button type="primary" @click="saveMemberDo">保存</el-button>
      </template>
    </el-dialog>

    <!-- A1：门禁授权（单独动作，留审计） -->
    <el-dialog v-model="aVisible" title="门禁授权" width="420">
      <div class="muted" style="font-size:12.5px;margin-bottom:12px;">
        为「{{ aRow.name }}」配置通行方式；选择「人脸」时自动标记人脸已录入。
      </div>
      <el-form label-width="86px">
        <el-form-item label="授权方式">
          <el-radio-group v-model="aAccess">
            <el-radio v-for="a in MEMBER_ACCESS" :key="a" :label="a">{{ a }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="aVisible = false">取消</el-button>
        <el-button type="primary" @click="saveAccess">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  demoOwnerList, memberRows, memberSummary, ownerProfile, paymentsOfOwner,
  removeMember, saveMember, setMemberAccess, tenantOfHouse, tenantsOfHouses,
  MEMBER_ACCESS, MEMBER_RELATIONS
} from '@/utils/api'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { expireText, money } from '@/utils/format'
import SensitiveText from '@/components/SensitiveText.vue'
import { idCardValid } from '@/utils/rules'

// 四个固定演示对象（与数据集剧本一致）
const demoOwners = demoOwnerList(4)
const ownerId = ref('OW00001')
const p = computed(() => ownerProfile(ownerId.value))
const owner = computed(() => p.value.owner)

const tab = ref('house')
const billHouse = ref('__all')

const shownBills = computed(() => {
  const list = [...p.value.bills].sort((a, b) => b.period.localeCompare(a.period))
  return billHouse.value === '__all' ? list : list.filter(b => b.houseId === billHouse.value)
})

const houseName = id => p.value.houses.find(h => h.houseId === id)?.fullName || id
const tenantOf = id => tenantOfHouse(id)
const tenantList = computed(() => tenantsOfHouses(p.value.houses.map(h => h.houseId)))

// —— A1 家庭成员建档（业主下挂同住人；写操作内存态）——
const memberList = ref(memberRows(ownerId.value))
const mSum = ref(memberSummary(ownerId.value))
watch(ownerId, id => { memberList.value = memberRows(id); mSum.value = memberSummary(id) })
function refreshMembers() {
  memberList.value = memberRows(ownerId.value)
  mSum.value = memberSummary(ownerId.value)
}

const mVisible = ref(false)
const mRef = ref(null)
const blankMember = () => ({
  memberId: '', name: '', relation: '配偶', phone: '', idCard: '',
  certified: false, faceRegistered: false, isOwnerAppUser: false, access: '未授权', remark: ''
})
const mForm = ref(blankMember())
const mRules = {
  name: [{ required: true, message: '请输入成员姓名', trigger: 'blur' }],
  relation: [{ required: true, message: '请选择与业主关系', trigger: 'change' }],
  phone: [{ pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确，应为 11 位', trigger: 'blur' }],
  idCard: [{
    validator: (_r, v, cb) => {
      if (!v) return cb()
      // 与 utils/rules.idCard 同源：身份证严校 / 护照 / 港澳台通行证
      cb(idCardValid(v) ? undefined : new Error('证件号格式不正确：身份证 18 位 / 护照 / 港澳台通行证'))
    }, trigger: 'blur'
  }]
}
function openMember(row) {
  mForm.value = row ? { ...row } : blankMember()
  mVisible.value = true
}
async function saveMemberDo() {
  try {
    await mRef.value.validate()
    const r = saveMember({ ...mForm.value, ownerId: ownerId.value })
    ElMessage.success(r.memberId && mForm.value.memberId ? `已更新成员「${r.name}」` : `已新增成员「${r.name}」`)
    mVisible.value = false
    refreshMembers()
  } catch (e) {
    if (e?.message) ElMessage.error(e.message)
  }
}
async function delMember(row) {
  try {
    await ElMessageBox.confirm(`确定移除成员「${row.name}」？移除后其门禁授权同时失效。`, '移除成员', { type: 'warning' })
    removeMember(row.memberId)
    ElMessage.success(`已移除成员「${row.name}」`)
    refreshMembers()
  } catch (e) {
    if (e?.message && e !== 'cancel') ElMessage.error(e.message)
  }
}
const aVisible = ref(false)
const aRow = ref({})
const aAccess = ref('人脸')
function openAccess(row) { aRow.value = row; aAccess.value = row.access || '人脸'; aVisible.value = true }
function saveAccess() {
  try {
    setMemberAccess(aRow.value.memberId, aAccess.value)
    ElMessage.success(`${aRow.value.name} 门禁授权已设为「${aAccess.value}」`)
    aVisible.value = false
    refreshMembers()
  } catch (e) { ElMessage.error(e?.message || '授权失败') }
}

// 跟进记录：缴费 + 工单 合成，按时间倒序
const timeline = computed(() => {
  const ev = []
  for (const pm of paymentsOfOwner(ownerId.value).slice(0, 5)) {
    ev.push({ title: `缴费 ¥${money(pm.amount)}（${pm.method}）`, time: pm.payTime, from: pm.operator })
  }
  for (const w of p.value.workOrders.slice(0, 5)) {
    ev.push({ title: `[${w.status}] ${w.title}`, time: w.createTime, from: `${w.source} · ${w.assignee || '待派单'}` })
  }
  return ev.sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 10)
})
</script>

<style scoped>
.ohead { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.ohead__ava {
  width: 52px; height: 52px; flex: 0 0 52px; border-radius: 50%;
  background: var(--biz-gradient); color: #fff; display: grid; place-items: center;
  font-size: 20px; font-weight: 600;
}
.ohead__info { flex: 1; min-width: 260px; }
.ohead__nm { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 600; color: var(--biz-text-1); flex-wrap: wrap; }
.ohead__sub { font-size: 12.5px; color: var(--biz-text-3); margin-top: 6px; }
.ohead__tags { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center; }
.ohead__act { display: flex; gap: 8px; flex-wrap: wrap; }
.dstat { background: var(--biz-bg-fill); border-radius: 10px; padding: 12px 14px; }
.dstat__k { font-size: 12px; color: var(--biz-text-3); }
.dstat__v { font-family: var(--biz-font-num); font-size: 20px; font-weight: 600; margin-top: 4px; font-variant-numeric: tabular-nums; }
.dstat__v .unit { font-size: 12px; color: var(--biz-text-3); margin-left: 3px; font-weight: 400; }
.dstat__v.is-warn { color: var(--biz-danger); }
.hdebts { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
.hdebt { flex: 1 1 220px; border: 1px solid var(--biz-border-light); border-radius: 10px; padding: 10px 12px; }
.hdebt.is-debt { border-color: rgba(255, 107, 107, .35); background: rgba(255, 107, 107, .04); }
.hdebt__n { font-size: 13px; font-weight: 500; }
.hdebt__v { font-size: 15px; font-weight: 600; margin-top: 4px; font-family: var(--biz-font-num); }
.hdebt.is-debt .hdebt__v { color: var(--biz-danger); }
.hdebt__o { font-size: 12px; color: var(--biz-text-3); margin-top: 2px; }
</style>
