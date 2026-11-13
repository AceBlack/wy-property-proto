<template>
  <view class="page">
    <NavBar title="发起申请" :subtitle="persona?.name || ''" />

    <view class="body body--with-foot">
      <view class="hint">
        <text class="hint__t">移动端也能报，不用回办公室</text>
        <text class="hint__d">
          六类单据共用一套审批引擎，表单与审批路径都来自后台配置（OA_FORM_DEFS / OA_FLOW_DEFS），
          这里不硬编码字段，加第七种单据也不用改这个页面。
        </text>
      </view>

      <!-- 单据类型 -->
      <!-- 六类两行就放下了，不用横向 scroll-view（H5 下不给高度会被压扁，顶部被裁） -->
      <view class="types">
        <view
          v-for="d in defs"
          :key="d.bizType"
          :id="`type-${d.code}`"
          class="type"
          :class="{ 'is-on': bizType === d.bizType }"
          @tap="pickType(d.bizType)"
        >
          <text class="type__n">{{ d.bizType }}</text>
        </view>
      </view>

      <!-- 表单：字段描述驱动 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">{{ curDef?.desc }}</text>
          <text class="sec-hd__d">{{ bizType }}</text>
        </view>

        <view v-for="f in fields" :key="f.key" class="fld">
          <view class="fld__k">
            <text>{{ f.label }}</text>
            <text v-if="f.required" class="req">*</text>
          </view>

          <!-- 单行文本 -->
          <input
            v-if="f.type === 'text'"
            :id="`f-${f.key}`"
            v-model="form[f.key]"
            class="input"
            :maxlength="f.maxlength || 60"
            :placeholder="`请输入${f.label}`"
            placeholder-class="ph-txt"
          />

          <!-- 多行文本 -->
          <textarea
            v-else-if="f.type === 'textarea'"
            :id="`f-${f.key}`"
            v-model="form[f.key]"
            class="textarea"
            :maxlength="f.maxlength || 200"
            :placeholder="`请说明${f.label}`"
            placeholder-class="ph-txt"
          />

          <!-- 数字 / 金额：派生金额（= 明细合计）只读，避免明细与报销额两套数 -->
          <view v-else-if="f.type === 'money' && f.derived" class="derived">
            <text class="derived__v num">¥ {{ fmtMoney(itemsTotal(form[f.derived] || [])) }}</text>
            <text class="derived__h">自动取明细合计，不需要手填</text>
          </view>
          <input
            v-else-if="f.type === 'number' || f.type === 'money'"
            :id="`f-${f.key}`"
            v-model="form[f.key]"
            class="input num"
            type="digit"
            :placeholder="f.type === 'money' ? '0.00' : `请输入${f.label}`"
            placeholder-class="ph-txt"
          />

          <!-- 明细行：手机上用卡片逐行编。9 列表格在 375px 上没法用 -->
          <view v-else-if="f.type === 'items'" class="items">
            <view v-for="(row, i) in form[f.key]" :key="i" class="items__row">
              <view class="items__hd">
                <text class="items__no">第 {{ i + 1 }} 项</text>
                <text class="items__del" @tap="removeItem(f.key, i)">删除</text>
              </view>
              <view class="fld2">
                <text class="fld2__k">物品名称<text class="req">*</text></text>
                <input v-model="row.name" class="input" placeholder="如：角阀" placeholder-class="ph-txt" />
              </view>
              <view class="fld2">
                <text class="fld2__k">型号规格</text>
                <input v-model="row.spec" class="input" placeholder="选填" placeholder-class="ph-txt" />
              </view>
              <view class="fld2 fld2--half">
                <text class="fld2__k">单位</text>
                <input v-model="row.unit" class="input" placeholder="个 / 米" placeholder-class="ph-txt" />
              </view>
              <view class="fld2 fld2--half">
                <text class="fld2__k">需求数量</text>
                <input v-model="row.needQty" class="input num" type="digit" placeholder="选填" placeholder-class="ph-txt" />
              </view>
              <view class="fld2 fld2--half">
                <text class="fld2__k">库存数量</text>
                <input v-model="row.stockQty" class="input num" type="digit" placeholder="选填" placeholder-class="ph-txt" />
              </view>
              <view class="fld2 fld2--half">
                <text class="fld2__k">本次采购<text class="req">*</text></text>
                <input v-model="row.buyQty" class="input num" type="digit" placeholder="数量" placeholder-class="ph-txt" />
              </view>
              <view class="fld2 fld2--half">
                <text class="fld2__k">单价（元）<text class="req">*</text></text>
                <input v-model="row.price" class="input num" type="digit" placeholder="0.00" placeholder-class="ph-txt" />
              </view>
              <view class="fld2 fld2--half">
                <text class="fld2__k">总价</text>
                <text class="items__sum num">¥ {{ fmtMoney(itemTotal(row)) }}</text>
              </view>
              <view class="fld2">
                <text class="fld2__k">备注</text>
                <input v-model="row.note" class="input" placeholder="超量采购请在这里说明" placeholder-class="ph-txt" />
              </view>
            </view>
            <view class="items__ft">
              <text class="items__add" @tap="addItem(f.key)">+ 添加一行</text>
              <text class="items__total">合计 <text class="num">¥ {{ fmtMoney(itemsTotal(form[f.key])) }}</text></text>
            </view>
          </view>

          <!-- 日期：给「今天 / 明天」，现场两下就填完，不用在日历里翻 -->
          <view v-else-if="f.type === 'date'">
            <picker mode="date" :value="form[f.key] || today" @change="e => (form[f.key] = e.detail.value)">
              <view :id="`f-${f.key}`" class="pick">
                <text :class="form[f.key] ? 'pick__v num' : 'pick__ph'">{{ form[f.key] || '请选择日期' }}</text>
                <view class="pick__chev" />
              </view>
            </picker>
            <view class="quick">
              <text :id="`f-${f.key}-today`" class="quick__i" @tap="quickDate(f.key, 0)">今天</text>
              <text :id="`f-${f.key}-tomorrow`" class="quick__i" @tap="quickDate(f.key, 1)">明天</text>
            </view>
          </view>

          <!-- 日期 + 时刻 -->
          <view v-else-if="f.type === 'datetime'">
            <view class="dt">
              <picker mode="date" :value="dateOf(f.key) || today" @change="e => setDate(f.key, e.detail.value)">
                <view :id="`f-${f.key}`" class="pick pick--half">
                  <text :class="dateOf(f.key) ? 'pick__v num' : 'pick__ph'">{{ dateOf(f.key) || '选日期' }}</text>
                </view>
              </picker>
              <picker mode="time" :value="timeOf(f.key)" @change="e => setTime(f.key, e.detail.value)">
                <view class="pick pick--half">
                  <text class="pick__v num">{{ timeOf(f.key) }}</text>
                </view>
              </picker>
            </view>
            <view class="quick">
              <text :id="`f-${f.key}-today`" class="quick__i" @tap="quickDate(f.key, 0)">今天</text>
              <text :id="`f-${f.key}-tomorrow`" class="quick__i" @tap="quickDate(f.key, 1)">明天</text>
            </view>
          </view>

          <!-- 单选 -->
          <view v-else-if="f.type === 'select'" class="chips">
            <view
              v-for="o in optsOf(f)"
              :key="o"
              :id="`opt-${f.key}-${o}`"
              class="chip"
              :class="{ 'is-on': form[f.key] === o }"
              @tap="form[f.key] = o"
            >
              {{ o }}
            </view>
          </view>

          <!-- 附件：复用巡检那套拍照（无相机落占位，不假装上传成功） -->
          <view v-else-if="f.type === 'file'">
            <PhotoPicker v-model="files[f.key]" :max="5" />
            <text class="fld__hint">{{ f.hint || '最多 5 个' }} · 原型只记数量与占位，不真上传</text>
          </view>

          <text v-if="f.hint && f.type !== 'file'" class="fld__hint">{{ f.hint }}</text>
        </view>
      </view>

      <!-- 审批路径：填表时就能看到会经过谁 -->
      <view class="card">
        <view class="sec-hd">
          <text class="sec-hd__t">审批路径</text>
          <text class="sec-hd__d">{{ preview.length }} 级</text>
        </view>
        <view v-for="(n, i) in preview" :key="i" class="step">
          <text class="step__i">{{ i + 1 }}</text>
          <view class="step__b">
            <text class="step__n">{{ n.node }}</text>
            <text class="step__h">{{ n.handler }} · 限时 {{ n.limitHours }} 小时</text>
          </view>
        </view>
        <text v-if="branchHint" class="branch">{{ branchHint }}</text>
        <text v-if="!preview.length" class="branch">该单据没有配置审批流，提交会被拦下 —— 先去 PC 的流程配置加节点。</text>
      </view>
    </view>

    <view class="footbar">
      <view id="oa-submit" class="btn btn--primary foot-btn" hover-class="none" @tap="submit">提交申请</view>
    </view>

    <!-- 提交结果 -->
    <Sheet v-model:show="done.show" title="已提交" :sub="done.no" max-height="66vh">
      <view class="done">
        <view class="done__ico"><text>✓</text></view>
        <text class="done__t">{{ done.title }}</text>
        <view class="done__row">
          <text class="done__k">单据编号</text>
          <text class="done__v num">{{ done.no }}</text>
        </view>
        <view class="done__row">
          <text class="done__k">当前节点</text>
          <text class="done__v">{{ done.node }}</text>
        </view>
        <view class="done__row">
          <text class="done__k">下一站</text>
          <text class="done__v">{{ done.handler }}</text>
        </view>
        <text class="done__note">
          审批进度与结果在「我发起」里看。<b>费用报销</b>批准后会生成一张待付款报销单，
          财务确认付款后才计入成本；其余单据本期批准即结束（与 PC 同一口径）。
        </text>
      </view>
      <view class="sheet-foot">
        <view id="oa-see-mine" class="btn btn--line" @tap="seeMine">查看我的申请</view>
        <view id="oa-again" class="btn btn--primary" @tap="again">再发起一张</view>
      </view>
    </Sheet>
  </view>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import NavBar from '@/components/NavBar.vue'
import { DEMO } from '@/config/personas'
import Sheet from '@/components/Sheet.vue'
import PhotoPicker from '@/components/PhotoPicker.vue'
import { APPLY_DEFS, amountFieldOf, applyDefOf, checkApplyForm, nextHandlerOf, previewFlowOf, submitApply } from '@/api/oa'
import { persona } from '@/store/app'
import { toastErr } from '@/utils/ui'
import { communities } from '@pc/mock'
import { oaItemTotal, oaItemsTotal } from '@pc/utils/api'

/* 明细行：与 PC 同一份定义（columns 来自 OA_FORM_DEFS），这里只负责移动端交互 */
function blankItem(f) {
  const row = {}
  for (const c of f.columns || []) row[c.key] = ''
  row.buyQty = 1
  return row
}
const addItem = key => form[key].push({ name: '', spec: '', unit: '', needQty: '', stockQty: '', buyQty: 1, price: '', note: '' })
const removeItem = (key, i) => {
  if (form[key].length <= 1) { toastErr('至少保留一行明细'); return }
  form[key].splice(i, 1)
}
const itemTotal = oaItemTotal
const itemsTotal = oaItemsTotal
const fmtMoney = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2)

const defs = APPLY_DEFS
const bizType = ref(defs[0]?.bizType || '')

const today = DEMO.today

const curDef = computed(() => applyDefOf(bizType.value))
const fields = computed(() => curDef.value?.fields || [])

const form = reactive({})
const files = reactive({})

/* 明细一变就回写金额字段：审批路径按金额分级，金额不同步会走错流程。
   必须放在 form 声明**之后** —— watch 建立时会先跑一次 getter 收集依赖，
   放前面就是 TDZ（Cannot access 'form' before initialization）。 */
watch(() => JSON.stringify(form.items || []), () => {
  const af = amountFieldOf(bizType.value)
  if (!af || af.derived !== 'items') return
  const total = oaItemsTotal(form.items || [])
  form[af.key] = total > 0 ? total.toFixed(2) : ''
})
const done = reactive({ show: false, no: '', title: '', node: '', handler: '' })

function reset() {
  for (const k of Object.keys(form)) delete form[k]
  for (const k of Object.keys(files)) delete files[k]
  for (const f of fields.value) {
    if (f.type === 'file') {
      files[f.key] = []
      continue
    }
    if (f.type === 'items') {
      form[f.key] = [blankItem(f)]
      continue
    }
    if (f.type === 'select') {
      form[f.key] = f.default !== undefined ? f.default : ''
    } else if (f.type === 'number' || f.type === 'money') {
      form[f.key] = f.default !== undefined ? f.default : ''
    } else if (f.type === 'datetime') {
      form[f.key] = ''
    } else {
      form[f.key] = f.default !== undefined ? f.default : ''
    }
  }
}

function pickType(t) {
  if (t === bizType.value) return
  bizType.value = t
  reset()
}

/* ---------- 日期 / 时刻：一个字段存 "YYYY-MM-DD HH:mm" ---------- */
const dateOf = key => String(form[key] || '').slice(0, 10)
const timeOf = key => String(form[key] || '').slice(11, 16) || '09:00'
const setDate = (key, d) => (form[key] = `${d} ${timeOf(key)}`)
const setTime = (key, t) => (form[key] = `${dateOf(key) || today} ${t}`)

/** 演示时钟固定 10-20：今天/明天按它算，不用系统当天（系统日期会让「明天」跳到真实世界） */
function dayText(offset) {
  const base = new Date('2026/10/20')
  base.setDate(base.getDate() + offset)
  const pad = n => String(n).padStart(2, '0')
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
}

/** 日期与日期时间共用：日期字段只写日期，日期时间字段保留已选的时刻 */
function quickDate(key, offset) {
  const d = dayText(offset)
  const f = fields.value.find(x => x.key === key)
  form[key] = f?.type === 'datetime' ? `${d} ${timeOf(key)}` : d
}

/** 项目下拉：值用 communityId（报销单要按项目归属） */
const optsOf = f => {
  if (f.opts === 'community') return communities.map(c => c.communityId)
  return f.options || []
}

/* 金额变了审批级数可能变，预览必须跟着变 */
const amount = computed(() => {
  const af = amountFieldOf(bizType.value)
  return af ? Number(form[af.key]) || 0 : 0
})

/**
 * 审批路径放在 ref 里、用 watch 重算，不用 computed：
 * `previewFlowOf` 内部会临时切一次角色（要按本人身份解析审批人），
 * 在 computed 的求值过程中改响应式状态会触发重入 —— 实测直接把页面卡死。
 */
const preview = ref([])

function refreshPreview() {
  try {
    preview.value = previewFlowOf(persona.value, bizType.value, amount.value)
  } catch (e) {
    preview.value = []
  }
}

watch([bizType, amount], refreshPreview, { immediate: true })

const branchHint = computed(() => {
  const af = amountFieldOf(bizType.value)
  if (!af) return ''
  if (!amount.value) return `填了${af.label}之后，审批路径会按金额自动决定级数`
  return `金额 ¥${amount.value.toLocaleString('zh-CN')} · 按当前配置走 ${preview.value?.length || 0} 级审批`
})

/* ---------- 提交 ---------- */
async function submit() {
  const bad = checkApplyForm(bizType.value, form)
  if (bad) {
    toastErr(bad)
    return
  }
  /* 附件按字段拍平：原型只传数量与名字，不真传文件 */
  const allFiles = Object.entries(files).flatMap(([key, list]) =>
    (list || []).map((p, i) => ({
      name: `${key}-${i + 1}.jpg`,
      size: 0,
      type: 'image/jpeg',
      placeholder: p.kind === 'placeholder'
    }))
  )
  try {
    const ap = await submitApply(persona.value, { bizType: bizType.value, formData: { ...form }, files: allFiles })
    const next = nextHandlerOf(ap)
    done.no = ap.approvalNo
    done.title = ap.title
    done.node = ap.currentNode
    done.handler = next.name
    done.show = true
  } catch (e) {
    toastErr(e.message || '提交失败')
  }
}

function seeMine() {
  done.show = false
  uni.navigateBack()
}

function again() {
  done.show = false
  reset()
}

onLoad(o => {
  if (o?.bizType && applyDefOf(o.bizType)) bizType.value = o.bizType
  reset()
  refreshPreview()
})
</script>

<style scoped>
.hint {
  background: #fff;
  border-radius: 20rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 20rpx;
  box-shadow: var(--biz-shadow-card);
}

.hint__t {
  display: block;
  font-size: 25rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  margin-bottom: 8rpx;
}

.hint__d {
  display: block;
  font-size: 19rpx;
  color: var(--biz-text-3);
  line-height: 1.6;
}

.types {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 20rpx;
}

.type {
  display: flex;
  align-items: center;
  height: 68rpx;
  padding: 0 26rpx;
  border-radius: 999rpx;
  background: #fff;
  border: 2rpx solid var(--biz-border);
}

.type.is-on {
  background: var(--biz-primary);
  border-color: var(--biz-primary);
}

.type__n {
  font-size: 24rpx;
  color: var(--biz-text-2);
}

.type.is-on .type__n {
  color: #fff;
  font-weight: 600;
}

.fld {
  padding: 18rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.fld:last-child {
  border-bottom: none;
}

.fld__k {
  display: flex;
  align-items: center;
  gap: 4rpx;
  font-size: 23rpx;
  color: var(--biz-text-3);
  margin-bottom: 12rpx;
}

.req {
  color: var(--biz-danger);
  font-size: 22rpx;
}

.fld__hint {
  display: block;
  margin-top: 8rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.55;
}

.ph-txt {
  color: var(--biz-text-4);
}

.pick {
  height: 76rpx;
  padding: 0 20rpx;
  border-radius: 12rpx;
  background: var(--biz-bg-fill);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pick--half {
  flex: 1;
}

.pick__v {
  font-size: 26rpx;
  color: var(--biz-text-1);
}

.pick__ph {
  font-size: 25rpx;
  color: var(--biz-text-4);
}

.pick__chev {
  width: 12rpx;
  height: 12rpx;
  border-right: 3rpx solid var(--biz-text-4);
  border-bottom: 3rpx solid var(--biz-text-4);
  transform: rotate(45deg);
}

.dt {
  display: flex;
  gap: 12rpx;
}

.quick {
  display: flex;
  gap: 12rpx;
  margin-top: 10rpx;
}

.quick__i {
  font-size: 21rpx;
  color: var(--biz-primary);
  background: var(--biz-primary-light-9);
  border-radius: 8rpx;
  padding: 6rpx 16rpx;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.chip {
  height: 64rpx;
  padding: 0 22rpx;
  border-radius: 12rpx;
  background: var(--biz-bg-fill);
  font-size: 24rpx;
  color: var(--biz-text-2);
  display: flex;
  align-items: center;
}

.chip.is-on {
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 2rpx var(--biz-primary);
}

.step {
  display: flex;
  align-items: flex-start;
  gap: 14rpx;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.step:last-of-type {
  border-bottom: none;
}

.step__i {
  flex: none;
  width: 38rpx;
  height: 38rpx;
  border-radius: 50%;
  background: var(--biz-primary-light-9);
  color: var(--biz-primary);
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2rpx;
}

.step__b {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4rpx;
}

.step__n {
  font-size: 25rpx;
  color: var(--biz-text-1);
}

.step__h {
  font-size: 19rpx;
  color: var(--biz-text-4);
}

.branch {
  display: block;
  margin-top: 12rpx;
  font-size: 19rpx;
  color: #a35c13;
  background: #fff7ed;
  border-radius: 10rpx;
  padding: 12rpx 14rpx;
  line-height: 1.55;
}

.done {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}

.done__ico {
  width: 84rpx;
  height: 84rpx;
  border-radius: 50%;
  background: var(--biz-accent);
  color: #fff;
  font-size: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6rpx;
}

.done__t {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--biz-text-1);
  line-height: 1.5;
}

.done__row {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding: 14rpx 0;
  border-bottom: 2rpx solid var(--biz-border-light);
}

.done__k {
  flex: none;
  width: 140rpx;
  font-size: 22rpx;
  color: var(--biz-text-3);
}

.done__v {
  flex: 1;
  font-size: 24rpx;
  color: var(--biz-text-1);
}

.done__note {
  margin-top: 6rpx;
  font-size: 18rpx;
  color: var(--biz-text-4);
  line-height: 1.6;
}

.sheet-foot {
  display: flex;
  gap: 14rpx;
  margin-top: 22rpx;
}

.sheet-foot .btn {
  flex: 1;
  height: 84rpx;
  font-size: 26rpx;
}

/* 底部主按钮铺满：.foot-btn 是各页各自定义的（不在全局），漏了就会出现「按钮只有一半宽」 */
.foot-btn {
  flex: 1;
  height: 88rpx;
  font-size: 30rpx;
}

/* ---------- 明细行 ---------- */
.items { display: flex; flex-direction: column; gap: 12rpx; }
.items__row {
  background: var(--biz-bg-fill, #f7f8fa); border-radius: 14rpx; padding: 16rpx 18rpx;
  display: flex; flex-direction: column; gap: 10rpx;
}
.items__hd { display: flex; justify-content: space-between; align-items: center; }
.items__no { font-size: 22rpx; font-weight: 600; color: var(--biz-text-1); }
.items__del { font-size: 22rpx; color: #c0392b; }
.fld2 { display: flex; align-items: center; gap: 12rpx; }
.fld2__k { width: 150rpx; font-size: 22rpx; color: var(--biz-text-3); }
.fld2--half { width: 48%; display: inline-flex; }
.items__sum { font-size: 24rpx; font-weight: 600; color: var(--biz-text-1); }
.items__ft { display: flex; justify-content: space-between; align-items: center; padding: 4rpx 2rpx; }
.items__add { font-size: 24rpx; color: var(--biz-primary, #5b6cff); }
.items__total { font-size: 22rpx; color: var(--biz-text-2); }
.items__total .num { font-weight: 600; color: var(--el-color-primary, #5b6cff); }
.req { color: #c0392b; margin-left: 2rpx; }
.derived { display: flex; flex-direction: column; gap: 4rpx; }
.derived__v { font-size: 32rpx; font-weight: 600; color: var(--biz-text-1); }
.derived__h { font-size: 20rpx; color: var(--biz-text-3); }
</style>
