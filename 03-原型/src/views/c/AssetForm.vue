<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div v-if="isEdit">
        <b>编辑资产</b>：改动会逐字段记进变更记录。其中<b>资产编号不可改</b> —— 标签已经贴在实物上，
        改号等于让报修记录和纸质标签全部对不上。
        <b>改分类不改历史</b>：资产上存的是分类快照，改完只有这一条变。
      </div>
      <div v-else>
        <b>新增资产</b>：保存后系统生成<b>资产编号</b>与<b>二维码 token</b>，编号形如 <code>ZC20260001</code>，
        从当年流水里取，永不重复、永不可改。保存完去详情页打印标签，贴到实物上才算上架。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>{{ isEdit ? `编辑 · ${form.assetNo}` : '新增资产' }}</h3>
        <span class="spacer" />
        <el-button @click="$router.back()">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!canEdit" @click="doSave">
          {{ isEdit ? '保存' : '保存并生成编号' }}
        </el-button>
      </div>

      <div class="sec__hd" style="margin-top:14px;"><h4>基本信息</h4></div>
      <el-form label-width="104px" style="max-width:900px;">
        <el-row :gutter="18">
          <el-col :span="12">
            <el-form-item label="资产名称" required>
              <el-input v-model="form.name" maxlength="40" show-word-limit placeholder="如：联想 ThinkPad E14" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="资产分类" required>
              <el-select v-model="form.catId" filterable placeholder="选择分类" style="width:100%" @change="onCatChange">
                <el-option v-for="o in catOpts" :key="o.value" :label="o.label" :value="o.value"
                  :disabled="o.disabled" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="资产编码">
              <el-input v-model="form.assetCode" maxlength="24" placeholder="如：BG-PC-001（选填，可自定义）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="资产编号">
              <el-input :model-value="isEdit ? form.assetNo : '保存后自动生成'" readonly />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="品牌">
              <el-input v-model="form.brand" maxlength="20" placeholder="选填" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="型号">
              <el-input v-model="form.model" maxlength="30" placeholder="选填" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="序列号">
              <el-input v-model="form.sn" maxlength="30" placeholder="选填" />
            </el-form-item>
          </el-col>
        </el-row>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>价值与保修</h4>
          <span class="desc">本期不做折旧，只记原值；不填也能保存</span>
        </div>
        <el-row :gutter="18">
          <el-col :span="8">
            <el-form-item label="购置日期">
              <el-date-picker v-model="form.buyDate" type="date" value-format="YYYY-MM-DD"
                placeholder="选择日期" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="购置原值">
              <el-input-number v-model="form.price" :min="0" :max="9999999" :step="100" :precision="2"
                controls-position="right" style="width:100%" placeholder="元" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="供应商">
              <el-input v-model="form.vendor" maxlength="40" placeholder="选填" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="保修到期">
              <el-date-picker v-model="form.warrantyEnd" type="date" value-format="YYYY-MM-DD"
                placeholder="选择日期" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>归属与状态</h4>
          <span class="desc">使用部门跟着使用人走，也可以单独改（成本归属可能不是使用人所在部门）</span>
        </div>
        <el-row :gutter="18">
          <el-col :span="8">
            <el-form-item label="使用人">
              <el-select v-model="form.holderEmpId" filterable clearable placeholder="未分配"
                style="width:100%" @change="onHolderChange">
                <el-option v-for="e in holders" :key="e.empId" :label="`${e.name}（${e.position}）`" :value="e.empId" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="使用部门">
              <el-select v-model="form.orgId" filterable clearable placeholder="选择部门" style="width:100%">
                <el-option v-for="o in orgOpts" :key="o.orgId" :label="o.name" :value="o.orgId" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width:100%">
                <el-option v-for="s in ASSET_STATUS" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="16">
            <el-form-item label="存放位置">
              <el-input v-model="form.location" maxlength="40" placeholder="如：总部 3F 财务部" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="120" show-word-limit
                placeholder="选填" />
            </el-form-item>
          </el-col>
        </el-row>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>设备图片</h4>
          <span class="desc">
            作为附件存在这件资产上，最多 {{ FILE_MAX }} 张、单张 ≤ {{ FILE_MAX_SIZE / 1024 / 1024 }}MB，
            支持 JPG / PNG / WebP / GIF
          </span>
        </div>
        <div class="shots">
          <div v-for="(f, i) in form.files" :key="f.fileId" class="shot">
            <el-image class="shot__img" :src="f.url" fit="cover"
              :preview-src-list="previewList" :initial-index="i" preview-teleported />
            <div class="shot__bar">
              <span class="shot__n" :title="f.name">{{ f.name }}</span>
              <el-button link type="danger" size="small" @click="removePhoto(i)">删除</el-button>
            </div>
          </div>
          <el-upload v-if="form.files.length < FILE_MAX" class="shot-add" :auto-upload="false"
            accept="image/jpeg,image/png,image/webp,image/gif" :show-file-list="false" multiple
            :on-change="onPhoto">
            <div class="shot-add__in">
              <el-icon><Plus /></el-icon>
              <span>上传图片</span>
              <span class="shot-add__n">{{ form.files.length }} / {{ FILE_MAX }}</span>
            </div>
          </el-upload>
        </div>
      </el-form>

      <div class="form-tip">
        <b>状态说明</b>：本期没有领用 / 归还单据，所以「闲置 / 在用 / 报废」是<b>描述性字段</b>，
        可以手工改，但改动会进变更记录。要看"东西在谁手上"，看使用人，不要看状态。
        <br />
        <b>图片说明</b>：图片只在本页和详情页展示，<b>不会出现在扫码页</b>（那是免登录的，
        照片背景里常有工位和同事）。增删图片也会记进变更记录，但只记张数和文件名 ——
        把图片内容写进日志会让记录表几秒钟就变成一屏乱码。
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import {
  ASSET_FILE_MAX, ASSET_FILE_MAX_SIZE, ASSET_FILE_MIME, ASSET_STATUS,
  assetCatFlat, assetCatOptions, canEditAssets, getAsset, orgOptions, queryEmployees, saveAsset
} from '@/api'

const route = useRoute()
const router = useRouter()
const id = computed(() => String(route.params.id || ''))
const isEdit = computed(() => !!id.value)
const canEdit = computed(() => canEditAssets())

const FILE_MAX = ASSET_FILE_MAX
const FILE_MAX_SIZE = ASSET_FILE_MAX_SIZE

const catOpts = assetCatOptions({ includeDisabled: true })
const orgOpts = orgOptions()
const holders = ref([])

const BLANK = {
  assetId: '', assetNo: '', name: '', catId: '', assetCode: '', brand: '', model: '', sn: '',
  buyDate: '', price: null, vendor: '', warrantyEnd: '', holderEmpId: '', orgId: '',
  location: '', status: '闲置', remark: '', files: []
}
const form = ref({ ...BLANK })
const saving = ref(false)

const previewList = computed(() => form.value.files.map(f => f.url))

/* 使用人候选：在职员工。用 queryEmployees 而不是另开接口 —— 它已经带了实际归属部门 */
queryEmployees({ pageNo: 1, size: 500 }).then(r => { holders.value = r.rows }).catch(() => {})

if (isEdit.value) {
  const a = getAsset(id.value)
  if (a) {
    form.value = {
      assetId: a.assetId, assetNo: a.assetNo, name: a.name, catId: a.catId, assetCode: a.assetCode,
      brand: a.brand, model: a.model, sn: a.sn, buyDate: a.buyDate, price: a.price,
      vendor: a.vendor, warrantyEnd: a.warrantyEnd, holderEmpId: a.holderEmpId,
      orgId: a.orgId, location: a.location, status: a.status, remark: a.remark,
      files: (a.files || []).map(f => ({ ...f }))
    }
  } else {
    ElMessage.error('资产不存在')
    router.replace('/c/assets')
  }
}

/**
 * 图片读成 data URL 存内存。
 * 原型没有上传服务，也不能把 File 对象留在内存里（刷新就没了、预览还要 createObjectURL）；
 * data URL 至少让「保存 → 详情 → 再编辑」这条链路是通的。
 */
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result || ''))
    fr.onerror = () => reject(new Error('读取文件失败'))
    fr.readAsDataURL(file)
  })
}

async function onPhoto(uploadFile) {
  const raw = uploadFile?.raw
  if (!raw) return
  if (form.value.files.length >= FILE_MAX) {
    ElMessage.warning(`最多 ${FILE_MAX} 张，先删一张再传`)
    return
  }
  /* 类型和体积在这里先拦一次：等提交时才报错，用户已经选了十张图，等于白选 */
  if (!ASSET_FILE_MIME.includes(raw.type)) {
    ElMessage.warning(`「${raw.name}」不是 JPG / PNG / WebP / GIF，换一张`)
    return
  }
  if (raw.size > FILE_MAX_SIZE) {
    ElMessage.warning(`「${raw.name}」${(raw.size / 1024 / 1024).toFixed(1)}MB，超过 ${FILE_MAX_SIZE / 1024 / 1024}MB 上限`)
    return
  }
  try {
    const url = await readAsDataUrl(raw)
    form.value.files.push({
      fileId: `AF${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      kind: 'image', name: raw.name, url, size: raw.size, mime: raw.type
    })
    ElMessage.success(`已添加「${raw.name}」`)
  } catch (e) {
    ElMessage.error(e?.message || '读取图片失败')
  }
}

function removePhoto(i) {
  const [f] = form.value.files.splice(i, 1)
  if (f) ElMessage.info(`已移除「${f.name}」，保存后生效`)
}

/** 换分类时，如果资产编码还是空的，就用分类前缀给个建议值（`BG-PC-001`），可再改 */
function onCatChange(catId) {
  if (form.value.assetCode) return
  const cat = assetCatFlat().find(c => c.catId === catId)
  if (cat && cat.prefix) form.value.assetCode = `${cat.prefix}-001`
}

/** 选使用人 → 带出他的实际部门（可再改） */
function onHolderChange(empId) {
  if (!empId) return
  const e = holders.value.find(x => x.empId === empId)
  if (e && e.orgId) form.value.orgId = e.orgId
}

async function doSave() {
  if (!form.value.name.trim()) { ElMessage.warning('请填写资产名称'); return }
  if (!form.value.catId) { ElMessage.warning('请选择资产分类'); return }
  saving.value = true
  try {
    const r = await saveAsset({
      name: form.value.name, catId: form.value.catId, assetCode: form.value.assetCode,
      brand: form.value.brand, model: form.value.model, sn: form.value.sn,
      buyDate: form.value.buyDate || '', price: form.value.price === null ? '' : form.value.price,
      vendor: form.value.vendor, warrantyEnd: form.value.warrantyEnd || '',
      holderEmpId: form.value.holderEmpId || '', orgId: form.value.orgId || '',
      location: form.value.location, status: form.value.status, remark: form.value.remark,
      files: form.value.files
    }, form.value.assetId)
    ElMessage.success(isEdit.value ? '已保存' : `已生成资产 ${r.assetNo}，去详情页打印标签`)
    router.replace(`/c/assets/${r.assetId}`)
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.form-tip {
  margin-top: 18px; padding: 10px 12px; border-radius: 8px; font-size: 11.5px; line-height: 1.8;
  color: var(--biz-text-2); background: var(--biz-bg-fill);
}
.form-tip b { color: var(--biz-text-1); }
.shots { display: flex; flex-wrap: wrap; gap: 12px; margin: 4px 0 0 104px; }
.shot {
  width: 148px; border: 1px solid var(--biz-border, #e5e8f0); border-radius: 8px;
  overflow: hidden; background: var(--biz-bg-card, #fff);
}
.shot__img { width: 148px; height: 100px; display: block; background: var(--biz-bg-fill); }
.shot__bar {
  display: flex; align-items: center; gap: 4px; padding: 3px 6px;
  border-top: 1px solid var(--biz-border, #e5e8f0);
}
.shot__n {
  flex: 1; min-width: 0; font-size: 11px; color: var(--biz-text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.shot-add { width: 148px; }
.shot-add__in {
  width: 148px; height: 128px; border: 1px dashed var(--biz-border, #d3d8e4); border-radius: 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  color: var(--biz-text-3); font-size: 12px; background: var(--biz-bg-fill); transition: border-color .2s;
}
.shot-add__in:hover { border-color: var(--biz-primary, #5b6cff); color: var(--biz-primary, #5b6cff); }
.shot-add__n { font-size: 11px; font-family: var(--biz-font-num); }
</style>
