<template>
  <view class="page">
    <NavBar title="业主与房屋" :subtitle="d?.house?.room ? `${d.house.buildingName} ${d.house.room}` : ''" />

    <view v-if="denied" class="body">
      <NoPerm
        title="只有楼栋管家能维护业主档案"
        sub="管家是全站唯一能改业主信息的角色（a.owners.edit）。其他角色可以看任务与工单，但改不了档案。"
        perm="a.owners.edit"
      />
    </view>

    <view v-else-if="d" class="body">
      <!-- 房屋 -->
      <view class="card">
        <view class="house">
          <view class="house__b">
            <text class="house__t">{{ d.house.fullName }}</text>
            <text class="house__d">{{ d.house.houseType || '—' }} · {{ d.house.area }} ㎡ · {{ d.house.orientation || '朝向未填' }}</text>
          </view>
          <view class="house__tags">
            <text class="house__tag">{{ d.house.useStatus || '未标使用状态' }}</text>
            <text v-if="d.debt > 0" class="house__tag is-od">欠 {{ money(d.debt) }}</text>
          </view>
        </view>

        <view class="divider" />

        <view class="fld" v-for="f in houseFields" :key="f.field">
          <text class="fld__k">{{ f.label }}</text>
          <text class="fld__v">{{ f.value || '—' }}</text>
        </view>

        <view class="acts">
          <view id="edit-use" class="btn btn--ghost btn--sm" @tap="openUse">改使用状态</view>
          <view id="edit-house-remark" class="btn btn--line btn--sm" @tap="openEdit('house', 'remark', '房屋备注', d.house.remark || '')">
            房屋备注
          </view>
        </view>
      </view>

      <!-- 业主 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">业主信息</text>
          <text class="sec-hd__d">改完即时生效，与 PC 档案同一份数据</text>
        </view>

        <template v-if="d.owner">
          <view class="fld">
            <text class="fld__k">姓名</text>
            <view class="fld__r">
              <text class="fld__v">{{ d.owner.name }}</text>
              <text id="edit-name" class="fld__act" @tap="openEdit('owner', 'name', '业主姓名', d.owner.name)">修改</text>
            </view>
          </view>

          <view class="fld">
            <text class="fld__k">手机号</text>
            <view class="fld__r">
              <text class="fld__v num">{{ revealed ? d.owner.phone : maskPhone(d.owner.phone) }}</text>
              <text v-if="canReveal" id="reveal-phone" class="fld__act" @tap="toggleReveal">{{ revealed ? '隐藏' : '揭示' }}</text>
              <text id="edit-phone" class="fld__act" @tap="openEdit('owner', 'phone', '手机号', d.owner.phone)">修改</text>
            </view>
          </view>

          <view class="fld">
            <text class="fld__k">应急联系人</text>
            <view class="fld__r">
              <text class="fld__v">{{ d.owner.emergencyContact || '—' }} {{ d.owner.emergencyPhone || '' }}</text>
              <text id="edit-emergency" class="fld__act" @tap="openEdit('owner', 'emergencyContact', '应急联系人', d.owner.emergencyContact || '')">修改</text>
            </view>
          </view>

          <view class="fld">
            <text class="fld__k">信用等级</text>
            <view class="fld__r">
              <text class="fld__v">{{ d.owner.creditLevel || '—' }}</text>
              <text id="edit-credit" class="fld__act" @tap="openCredit">调整</text>
            </view>
          </view>

          <view class="fld">
            <text class="fld__k">业主标签</text>
            <view class="fld__r fld__r--wrap">
              <view class="otags">
                <text v-for="g in ownerTags" :key="g.tagId" class="otag" :class="[`c-${g.color}`, { 'is-off': !g.enabled }]">
                  {{ g.name }}
                </text>
                <text v-if="!ownerTags.length" class="fld__v">未打标签</text>
              </view>
              <text id="edit-tags" class="fld__act" @tap="openTags">调整</text>
            </view>
          </view>

          <view class="fld fld--last">
            <text class="fld__k">业主备注</text>
            <view class="fld__r">
              <text class="fld__v">{{ d.owner.remark || '—' }}</text>
              <text id="edit-owner-remark" class="fld__act" @tap="openEdit('owner', 'remark', '业主备注', d.owner.remark || '')">修改</text>
            </view>
          </view>

          <view v-if="revealNote" class="reveal">
            <text>{{ revealNote }}</text>
          </view>
        </template>
        <text v-else class="empty-owner">这套房没有登记业主（可能未售或空置），先到 PC 建档再维护。</text>
      </view>

      <!-- 住在里面的人：租户与共住成员 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">住在里面的人</text>
          <text class="sec-hd__d">租户 {{ residents.tenants.length }} · 家庭成员 {{ residents.members.length }}</text>
        </view>

        <view v-if="residents.tenants.length" class="ppl-group">
          <text class="ppl-group__t">租户（在住）</text>
          <view
            v-for="t in residents.tenants"
            :key="t.tenantId"
            :id="`tn-${t.tenantId}`"
            class="ppl ppl--link"
            hover-class="ppl--hover"
            @tap="openTenant(t)"
          >
            <view class="ppl__l">
              <view class="ppl__top">
                <text class="ppl__n">{{ t.name }}</text>
                <text class="ppl__tag" :class="{ 'is-warn': t.verifyStatus !== '已核验' }">{{ t.verifyStatus }}</text>
                <text v-if="!t.faceRegistered" class="ppl__tag is-warn">未录人脸</text>
                <text class="ppl__tag">完整度 {{ t.fill?.rate }}%</text>
              </view>
              <text class="ppl__d">{{ t.relation }} · {{ t.residents }} 人居住 · 租期 {{ t.leaseStart }} 至 {{ t.leaseEnd }}</text>
              <text class="ppl__d num">{{ maskPhone(t.phone) }} · 登记来源：{{ t.source }}</text>
            </view>
            <text class="ppl__chev">›</text>
          </view>
          <text class="ppl__note">
            点租户可核验 / 补资料 / 录人脸 / 标记搬离（a.tenants.edit）。
            租金属于合同信息，管家端不展示（财务与项目经理可见）。
          </text>
        </view>

        <view v-if="residents.members.length" class="ppl-group">
          <text class="ppl-group__t">共住家庭成员</text>
          <view v-for="m in residents.members" :key="m.name + m.relation" class="ppl">
            <view class="ppl__l">
              <view class="ppl__top">
                <text class="ppl__n">{{ m.name }}</text>
                <text class="ppl__rel">{{ m.relation }}</text>
                <text v-if="m.faceRegistered" class="ppl__tag">已录人脸</text>
                <text v-if="m.appUser" class="ppl__tag">已绑小程序</text>
              </view>
              <text class="ppl__d num">{{ maskPhone(m.phone) }}</text>
            </view>
          </view>
          <text class="ppl__note">身份证号默认不展示；需要核对时用 PC 的「业主档案」并留痕。</text>
        </view>

        <text v-if="!residents.tenants.length && !residents.members.length" class="empty-owner">
          这套房既没有登记租户，也没有共住成员 —— 如果实际有人住，现场核实后到 PC 补登记。
        </text>
      </view>

      <!-- 账单 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">账单</text>
          <text class="sec-hd__d">最近 6 张 · 只读</text>
        </view>
        <view v-for="b in d.bills" :key="b.billId" class="bill">
          <view class="bill__l">
            <text class="bill__t">{{ b.itemName }}</text>
            <text class="bill__d">账期 {{ b.period }} · 应缴 {{ b.dueDate }}</text>
          </view>
          <view class="bill__r">
            <text class="bill__amt num">{{ money(b.unpaid || b.payable) }}</text>
            <text class="bill__s" :class="{ 'is-od': b.overdueDays > 0 }">
              {{ b.overdueDays > 0 ? `逾期 ${b.overdueDays} 天` : b.status }}
            </text>
          </view>
        </view>
        <text class="bill__hint">收款在收银台 / 业主小程序，管家这边只看到欠与缴。</text>
      </view>

      <view class="tail">
        <text>手机号改了立刻生效：账单短信、催缴通知会发到新号码。改错可以再改回来，改动都有版本记录。</text>
      </view>
    </view>

    <!-- 业主标签：只选不建（维护字典要 e.ownerTags.edit，楼管没有） -->
    <Sheet v-model:show="tagSheet" title="业主标签" :sub="`已打 ${ownerTags.length} 个 · 点一下即生效`" max-height="76vh">
      <view v-for="cat in tagGroups" :key="cat.name" class="tg-group">
        <text class="tg-group__t">{{ cat.name }}</text>
        <view class="tg-list">
          <view
            v-for="g in cat.tags"
            :key="g.tagId"
            :id="`tag-${g.tagId}`"
            class="tg-chip"
            :class="[`c-${g.color}`, { 'is-on': hasTag(g.tagId), 'is-disabled': !g.enabled }]"
            @tap="toggleTag(g)"
          >
            <text class="tg-chip__n">{{ g.name }}</text>
            <text class="tg-chip__c num">{{ g.ownerCount }}</text>
          </view>
        </view>
      </view>
      <text class="tg-note">
        标签是走访与沟通的依据（独居老人 51 位、重点关怀 57 位、投诉频繁 19 位），不是评分。
        字典的增删改在 PC「业主标签」里做，管家端只负责打与去。
      </text>
    </Sheet>

    <!-- 编辑 -->
    <Sheet v-model:show="editSheet" :title="editTitle" :sub="editSub" max-height="46vh">
      <input v-model="editValue" class="input" :maxlength="40" :placeholder="editPlaceholder" placeholder-class="ph-txt" />
      <view class="sheet__act">
        <view class="btn btn--line" @tap="editSheet = false">取消</view>
        <view id="edit-save" class="btn btn--primary" @tap="saveEdit">保存</view>
      </view>
    </Sheet>

    <!-- 使用状态 -->
    <Sheet v-model:show="useSheet" title="房屋使用状态" sub="影响统计口径：空置房不计入入住率" max-height="46vh">
      <view class="chips">
        <text
          v-for="u in HOUSE_USE_OPTS"
          :key="u"
          :id="`use-${u}`"
          class="chip"
          :class="{ 'is-on': d?.house?.useStatus === u }"
          @tap="saveUse(u)"
        >{{ u }}</text>
      </view>
    </Sheet>

    <!-- 信用等级 -->
    <Sheet v-model:show="creditSheet" title="信用等级" sub="影响催缴策略与权限（A 可先享后付）" max-height="40vh">
      <view class="chips">
        <text
          v-for="c in ['A', 'B', 'C']"
          :key="c"
          :id="`credit-${c}`"
          class="chip"
          :class="{ 'is-on': d?.owner?.creditLevel === c }"
          @tap="saveCredit(c)"
        >{{ c }}</text>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import Sheet from '@/components/Sheet.vue'
import NoPerm from '@/components/NoPerm.vue'
import {
  HOUSE_USE_OPTS,
  addTag,
  dropTag,
  houseDetailOf,
  maskPhone,
  residentsOf,
  saveHouseField,
  saveOwnerField,
  tagCategories,
  tagDict,
  tagsOfOwner
} from '@/api/building'
import { money } from '@/utils/format'
import { CAP, can } from '@/config/personas'
import { app, persona } from '@/store/app'
import { toastErr, toastOk } from '@/utils/ui'

const houseId = ref('')
const ver = ref(0)
const revealed = ref(false)
const revealNote = ref('')

const editSheet = ref(false)
const editTitle = ref('')
const editSub = ref('')
const editPlaceholder = ref('')
const editValue = ref('')
const editTarget = ref({ scope: '', field: '' })

const useSheet = ref(false)
const creditSheet = ref(false)

const denied = computed(() => !can(persona.value, CAP.ownersEdit))
const d = computed(() => (ver.value, houseId.value ? houseDetailOf(houseId.value) : null))
const residents = computed(() => (ver.value, houseId.value ? residentsOf(houseId.value) : { tenants: [], members: [] }))
const ownerTags = computed(() => (ver.value, d.value?.owner ? tagsOfOwner(d.value.owner.ownerId) : []))
const tagSheet = ref(false)
const tagDictList = computed(() => (ver.value, tagDict()))
const tagGroups = computed(() => {
  const cats = tagCategories()
  const all = tagDictList.value
  return cats
    .map(name => ({ name, tags: all.filter(t => t.category === name) }))
    .filter(g => g.tags.length)
})
const hasTag = tagId => ownerTags.value.some(t => t.tagId === tagId)

function openTags() {
  tagSheet.value = true
}

/** 一次点击即提交（现场不愿多点两下）；失败如实报错，例如标签已停用 */
function toggleTag(g) {
  const ownerId = d.value?.owner?.ownerId
  if (!ownerId) return
  try {
    if (hasTag(g.tagId)) dropTag(ownerId, g.tagId)
    else addTag(ownerId, g.tagId)
    ver.value++
  } catch (e) {
    toastErr(e.message || '标签更新失败')
  }
}

function openTenant(t) {
  if (!t?.tenantId) return
  uni.navigateTo({ url: `/pages/building/tenant?tenantId=${t.tenantId}` })
}

const houseFields = computed(() => {
  const h = d.value?.house
  if (!h) return []
  return [
    { field: 'propertyStatus', label: '产权状态', value: h.propertyStatus },
    { field: 'decoration', label: '装修', value: h.decoration },
    { field: 'deliverStatus', label: '交付', value: h.deliverStatus },
    { field: 'remark', label: '房屋备注', value: h.remark }
  ]
})

const canReveal = computed(() => can(persona.value, CAP.sensitive))

onLoad(o => {
  houseId.value = o.houseId || ''
})

/**
 * 同一个路由换 houseId 时，uni 的 H5 路由会复用组件、不再触发 onLoad，
 * 页面还停在上一个房号上（实测：从 111001 跳到 110501，标题变了内容没变）。
 * 所以直接监听 hashchange 同步房号 —— 只影响 H5，其他端不编译这段。
 */
onMounted(() => {
  // #ifdef H5
  const syncFromHash = () => {
    const m = String(location.hash || '').match(/houseId=([^&]+)/)
    if (!m) return
    const next = decodeURIComponent(m[1])
    if (next !== houseId.value) {
      houseId.value = next
      ver.value++
    }
  }
  syncFromHash()
  window.addEventListener('hashchange', syncFromHash)
  onUnmounted(() => window.removeEventListener('hashchange', syncFromHash))
  // #endif
})

onShow(() => {
  ver.value++
})

function refresh() {
  ver.value++
}

function openEdit(scope, field, title, value) {
  editTarget.value = { scope, field }
  editTitle.value = title
  editSub.value = scope === 'owner' ? '业主档案 · 改完即时生效' : '房屋档案'
  editPlaceholder.value = field === 'phone' ? '11 位手机号' : '填写内容'
  editValue.value = value || ''
  editSheet.value = true
}

function saveEdit() {
  const { scope, field } = editTarget.value
  const v = String(editValue.value || '').trim()
  try {
    if (scope === 'owner') {
      if (!d.value?.owner) throw new Error('这套房没有业主档案')
      saveOwnerField(d.value.owner.ownerId, field, v)
    } else {
      saveHouseField(houseId.value, field, v)
    }
    editSheet.value = false
    refresh()
    if (field === 'phone' && revealed.value) revealNote.value = '手机号已更新，通知会发到新号码。'
    toastOk('已保存')
  } catch (e) {
    toastErr(e?.message || '保存失败')
  }
}

function openUse() {
  useSheet.value = true
}
function openCredit() {
  creditSheet.value = true
}

function saveUse(u) {
  try {
    saveHouseField(houseId.value, 'useStatus', u)
    useSheet.value = false
    refresh()
    toastOk(`已改为「${u}」`)
  } catch (e) {
    toastErr(e?.message || '保存失败')
  }
}

function saveCredit(c) {
  try {
    saveOwnerField(d.value.owner.ownerId, 'creditLevel', c)
    creditSheet.value = false
    refresh()
    toastOk(`信用等级 ${c}`)
  } catch (e) {
    toastErr(e?.message || '保存失败')
  }
}

/* 揭示明文：与 PC 同口径，算「看过一次」，页面上给出提示 */
function toggleReveal() {
  revealed.value = !revealed.value
  if (revealed.value) revealNote.value = '已揭示明文，本次查看会计入访问日志（与 PC 同口径）。'
  else revealNote.value = ''
}
</script>

<style scoped>
.house {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
}

.house__b {
  flex: 1;
  min-width: 0;
}

.house__t {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  color: var(--biz-text-1);
}

.house__d {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.house__tags {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8rpx;
  flex: none;
}

.house__tag {
  font-size: 19rpx;
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-radius: 999rpx;
  padding: 4rpx 14rpx;
}

.house__tag.is-od {
  color: var(--biz-danger);
  background: #fff0f0;
}

.fld {
  display: flex;
  align-items: center;
  padding: 18rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.fld--last {
  border-bottom: none;
}

.fld__k {
  width: 180rpx;
  flex: none;
  font-size: 24rpx;
  color: var(--biz-text-3);
}

.fld__r {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16rpx;
}

.fld__v {
  font-size: 26rpx;
  color: var(--biz-text-1);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 380rpx;
}

.fld__act {
  flex: none;
  font-size: 21rpx;
  color: var(--biz-primary);
  padding: 5rpx 14rpx;
  border-radius: 999rpx;
  background: var(--biz-primary-light-9);
}

.acts {
  margin-top: 20rpx;
  display: flex;
  gap: 14rpx;
  justify-content: flex-end;
}

.reveal {
  margin-top: 14rpx;
  padding: 12rpx 16rpx;
  background: #fff8f0;
  border-radius: 12rpx;
  font-size: 20rpx;
  color: #a35c13;
  line-height: 1.55;
}

.empty-owner {
  font-size: 22rpx;
  color: var(--biz-text-3);
  line-height: 1.7;
}

.fld__r--wrap {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.otags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  justify-content: flex-end;
  flex: 1;
  min-width: 0;
}

.otag {
  font-size: 18rpx;
  border-radius: 8rpx;
  padding: 3rpx 10rpx;
  color: var(--biz-text-2);
  background: var(--biz-bg-fill);
}

.otag.c-red {
  color: #b42318;
  background: #fff0f0;
}

.otag.c-orange {
  color: #a35c13;
  background: #fff7ed;
}

.otag.c-blue {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
}

.otag.c-green {
  color: var(--biz-accent-dark);
  background: #e6faf3;
}

.otag.c-gray {
  color: var(--biz-text-3);
  background: var(--biz-bg-fill);
}

.otag.is-off {
  opacity: 0.5;
  text-decoration: line-through;
}

.ppl--link {
  border-radius: 12rpx;
}

.ppl--hover {
  background: var(--biz-bg-hover);
}

.ppl__chev {
  flex: none;
  font-size: 30rpx;
  color: var(--biz-text-4);
}

.tg-group {
  margin-bottom: 18rpx;
}

.tg-group__t {
  display: block;
  font-size: 20rpx;
  color: var(--biz-text-4);
  margin-bottom: 10rpx;
}

.tg-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.tg-chip {
  display: flex;
  align-items: center;
  gap: 8rpx;
  height: 64rpx;
  padding: 0 18rpx;
  border-radius: 12rpx;
  background: var(--biz-bg-fill);
  border: 2rpx solid transparent;
}

.tg-chip__n {
  font-size: 23rpx;
  color: var(--biz-text-2);
}

.tg-chip__c {
  font-size: 17rpx;
  color: var(--biz-text-4);
}

.tg-chip.is-on {
  border-color: var(--biz-primary);
  background: var(--biz-primary-light-9);
}

.tg-chip.is-on .tg-chip__n {
  color: var(--biz-primary);
  font-weight: 600;
}

.tg-chip.is-disabled {
  opacity: 0.45;
}

.tg-note {
  display: block;
  margin-top: 6rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.ppl-group {
  margin-bottom: 18rpx;
}

.ppl-group__t {
  display: block;
  font-size: 21rpx;
  color: var(--biz-text-4);
  margin-bottom: 6rpx;
}

.ppl {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.ppl:last-of-type {
  border-bottom: none;
}

.ppl__l {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.ppl__top {
  display: flex;
  align-items: center;
  gap: 10rpx;
  flex-wrap: wrap;
}

.ppl__n {
  font-size: 26rpx;
  color: var(--biz-text-1);
  font-weight: 600;
}

.ppl__rel {
  font-size: 19rpx;
  color: var(--biz-text-3);
}

.ppl__tag {
  font-size: 17rpx;
  color: var(--biz-accent);
  background: #eefbf4;
  border-radius: 6rpx;
  padding: 2rpx 8rpx;
}

.ppl__tag.is-warn {
  color: #a35c13;
  background: #fff7ed;
}

.ppl__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
  line-height: 1.5;
}

.ppl__note {
  display: block;
  margin-top: 10rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.55;
}

.bill {
  display: flex;
  align-items: center;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.bill__l {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.bill__t {
  font-size: 25rpx;
  color: var(--biz-text-1);
}

.bill__d {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.bill__r {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4rpx;
}

.bill__amt {
  font-size: 25rpx;
  color: var(--biz-text-1);
}

.bill__s {
  font-size: 18rpx;
  color: var(--biz-text-4);
}

.bill__s.is-od {
  color: var(--biz-danger);
}

.bill__hint {
  display: block;
  margin-top: 14rpx;
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.tail {
  padding: 8rpx 10rpx;
  font-size: 20rpx;
  color: var(--biz-text-4);
  line-height: 1.7;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.chip {
  font-size: 24rpx;
  padding: 12rpx 26rpx;
  border-radius: 999rpx;
  background: var(--biz-bg-fill);
  color: var(--biz-text-2);
  border: 2rpx solid transparent;
}

.chip.is-on {
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-color: var(--biz-primary);
  font-weight: 600;
}

.sheet__act {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}

.sheet__act .btn {
  flex: 1;
  height: 84rpx;
  font-size: 27rpx;
}

.ph-txt {
  color: var(--biz-text-4);
}
</style>
