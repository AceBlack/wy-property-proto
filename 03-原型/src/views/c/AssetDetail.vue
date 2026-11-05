<template>
  <div class="page">
    <AsyncBlock :loading="loading" :error="error" :empty="!data" empty-title="资产不存在"
      empty-desc="编号可能已变更，或链接有误">
      <template v-if="data">
        <div class="panel" style="margin-top:0;">
          <div class="hd">
            <div>
              <div class="hd__t">
                {{ data.name }}
                <span class="st" :class="`is-${data.status}`">{{ data.status }}</span>
                <el-tag v-if="data.warrantyExpired" size="small" effect="plain" type="danger">已过保</el-tag>
                <el-tag v-else-if="data.warrantySoon" size="small" effect="plain" type="warning">保修临期</el-tag>
              </div>
              <div class="hd__s">
                <span class="num">{{ data.assetNo }}</span>
                <span v-if="data.assetCode"> · {{ data.assetCode }}</span>
                · {{ data.catPath || data.catName }}
              </div>
            </div>
            <div class="hd__r">
              <el-button :icon="'ArrowLeft'" @click="$router.push('/c/assets')">返回台账</el-button>
              <el-button :icon="'Printer'" @click="printOne">打印标签</el-button>
              <el-button v-if="canEdit" type="primary" :icon="'EditPen'"
                @click="$router.push(`/c/assets/${data.assetId}/edit`)">编辑</el-button>
            </div>
          </div>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:minmax(0,1fr) 300px;align-items:start;">
          <div>
            <div class="panel">
              <div class="sec__hd"><h4>基本信息</h4></div>
              <el-descriptions :column="2" border size="small" style="margin-top:12px;">
                <el-descriptions-item label="资产编号">
                  <span class="num">{{ data.assetNo }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="资产编码">{{ data.assetCode || '—' }}</el-descriptions-item>
                <el-descriptions-item label="分类">{{ data.catPath || data.catName || '—' }}</el-descriptions-item>
                <el-descriptions-item label="状态">{{ data.status }}</el-descriptions-item>
                <el-descriptions-item label="品牌">{{ data.brand || '—' }}</el-descriptions-item>
                <el-descriptions-item label="型号">{{ data.model || '—' }}</el-descriptions-item>
                <el-descriptions-item label="序列号" :span="2">
                  <span class="num">{{ data.sn || '—' }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="使用部门">{{ data.orgName || '—' }}</el-descriptions-item>
                <el-descriptions-item label="使用人">{{ data.holderName || '未分配' }}</el-descriptions-item>
                <el-descriptions-item label="存放位置" :span="2">{{ data.location || '—' }}</el-descriptions-item>
              </el-descriptions>
            </div>

            <div class="panel" style="margin-top:16px;">
              <div class="sec__hd">
                <h4>设备图片</h4>
                <span class="desc">
                  {{ (data.photos || []).length ? `${data.photos.length} 张 · 点击查看大图` : '还没有图片' }}
                </span>
                <span class="spacer" />
                <span class="desc">作为附件存在这件资产上，不出现在扫码页</span>
              </div>
              <div v-if="(data.photos || []).length" class="shots">
                <el-image v-for="(f, i) in data.photos" :key="f.fileId" class="shot"
                  :src="f.url" fit="cover" :preview-src-list="previewList" :initial-index="i" preview-teleported>
                  <template #error>
                    <div class="shot__bad">图片已失效</div>
                  </template>
                </el-image>
              </div>
              <div v-else class="shots-empty">
                没有图片不影响使用，但报修和盘点时靠名字认东西容易认错 ——
                点右上角「编辑」可以补拍几张。
              </div>
            </div>

            <div class="panel" style="margin-top:16px;">
              <div class="sec__hd">
                <h4>价值与保修</h4>
                <span class="desc">本期不做折旧，只有原值，没有净值</span>
              </div>
              <el-descriptions :column="2" border size="small" style="margin-top:12px;">
                <el-descriptions-item label="购置日期">{{ data.buyDate || '—' }}</el-descriptions-item>
                <el-descriptions-item label="购置原值">
                  <span class="num">{{ data.price === null || data.price === '' ? '—' : '¥ ' + money(data.price) }}</span>
                </el-descriptions-item>
                <el-descriptions-item label="供应商">{{ data.vendor || '—' }}</el-descriptions-item>
                <el-descriptions-item label="保修到期">
                  <span :class="{ 'is-warn': data.warrantySoon, 'is-danger': data.warrantyExpired }">
                    {{ data.warrantyEnd || '—' }}
                  </span>
                </el-descriptions-item>
                <el-descriptions-item label="备注" :span="2">{{ data.remark || '—' }}</el-descriptions-item>
              </el-descriptions>
            </div>

            <div class="panel" style="margin-top:16px;">
              <div class="sec__hd">
                <h4>变更记录</h4>
                <span class="desc">没有领用单，这一层就是唯一的「谁在什么时候改了什么」</span>
              </div>
              <el-table :data="data.logs" size="small" style="width:100%;margin-top:12px;" max-height="320">
                <el-table-column prop="at" label="时间" width="150" />
                <el-table-column prop="by" label="操作人" width="90" />
                <el-table-column prop="fieldLabel" label="字段" width="100" />
                <el-table-column label="改动" min-width="240">
                  <template #default="{ row }">
                    <span class="muted">{{ row.before || '空' }}</span>
                    <span class="arrow">→</span>
                    <b>{{ row.after || '空' }}</b>
                  </template>
                </el-table-column>
                <template #empty>
                  <EmptyState type="empty" desc="还没有变更记录" />
                </template>
              </el-table>
            </div>
          </div>

          <!-- 二维码 -->
          <div class="panel">
            <div class="sec__hd"><h4>二维码</h4><span class="desc">贴在实物上</span></div>
            <div class="qr">
              <img :src="qrSrc" alt="资产二维码" />
              <div class="qr__no num">{{ data.assetNo }}</div>
            </div>
            <div class="qr-url">
              <el-input :model-value="scanUrl" readonly size="small">
                <template #append>
                  <el-button @click="copyUrl">复制</el-button>
                </template>
              </el-input>
            </div>
            <div class="qr-tip">
              这个链接<b>不需要登录</b>就能打开，只显示：名称、编号、分类、状态、<b>使用部门</b>、存放位置、保修到期。
              <br />
              原值、供应商、序列号、使用人姓名、内部备注与<b>设备图片</b>都不会公开。
            </div>
            <el-button style="width:100%;margin-top:12px;" :icon="'View'" @click="openScanPreview">
              预览扫码页
            </el-button>
          </div>
        </div>
      </template>
    </AsyncBlock>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'
import { assetLabelRows, canEditAssets, getAsset } from '@/api'
import { qrDataUrl, printAssetLabels } from '@/utils/assetLabel'
import AsyncBlock from '@/components/AsyncBlock.vue'
import EmptyState from '@/components/EmptyState.vue'

const route = useRoute()
const id = computed(() => String(route.params.id || ''))
const loading = ref(false)
const error = ref('')
const data = ref(null)

const canEdit = computed(() => canEditAssets())
const scanUrl = computed(() => data.value ? `${location.origin}${location.pathname}#/scan/${data.value.qrToken}` : '')
const qrSrc = computed(() => data.value ? qrDataUrl(scanUrl.value, 200) : '')

const money = n => (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const previewList = computed(() => (data.value?.photos || []).map(f => f.url))

function load() {
  loading.value = true
  try {
    data.value = getAsset(id.value)
    error.value = data.value ? '' : '资产不存在'
  } catch (e) {
    error.value = e?.message || '加载失败'
    data.value = null
  } finally {
    loading.value = false
  }
}
load()
watch(id, load)

function printOne() {
  const labels = assetLabelRows([data.value.assetId])
  printAssetLabels(labels, { scanBase: location.origin + location.pathname })
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(scanUrl.value)
    ElMessage.success('扫码链接已复制')
  } catch {
    ElMessage.warning('浏览器不允许自动复制，请手动选中链接')
  }
}

function openScanPreview() {
  window.open(`${location.origin}${location.pathname}#/scan/${data.value.qrToken}`, '_blank')
}
</script>

<style scoped>
.hd { display: flex; align-items: flex-start; gap: 12px; }
.hd__t { font-size: 16px; font-weight: 600; color: var(--biz-text-1); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hd__s { margin-top: 5px; font-size: 12px; color: var(--biz-text-3); }
.hd__r { margin-left: auto; display: flex; gap: 8px; flex: none; }
.st { font-size: 11.5px; padding: 1px 8px; border-radius: 10px; font-weight: 400; }
.st.is-在用 { background: rgba(18, 185, 138, .12); color: var(--biz-success, #12b98a); }
.st.is-闲置 { background: rgba(217, 138, 31, .12); color: var(--biz-warning, #d98a1f); }
.st.is-报废 { background: rgba(136, 135, 128, .14); color: var(--biz-text-3); }
.arrow { margin: 0 6px; color: var(--biz-text-3); }
.is-warn { color: var(--biz-warning); }
.is-danger { color: var(--biz-danger, #e34d59); }
.qr { text-align: center; padding: 8px 0 4px; }
.qr img { width: 168px; height: 168px; border-radius: 8px; background: #fff; }
.qr__no { margin-top: 6px; font-size: 12.5px; color: var(--biz-text-2); }
.qr-url { margin-top: 10px; }
.qr-tip { margin-top: 10px; font-size: 11.5px; line-height: 1.75; color: var(--biz-text-3); }
.qr-tip b { color: var(--biz-text-2); }
.shots { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.shot {
  width: 132px; height: 92px; border-radius: 8px; overflow: hidden;
  background: var(--biz-bg-fill); cursor: zoom-in;
}
.shot__bad {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  font-size: 11.5px; color: var(--biz-text-3);
}
.shots-empty {
  margin-top: 12px; padding: 14px 12px; border-radius: 8px; font-size: 12px; line-height: 1.8;
  color: var(--biz-text-3); background: var(--biz-bg-fill); text-align: center;
}
</style>
