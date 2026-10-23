<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>品质检查评分卡</b>：评分项 + 权重 + 档位扣分可配置，支持一票否决。
        扣分必须选档位、写说明、拍照；整改单闭环后下轮抽查自动加权，防止问题回潮。
      </div>
    </div>

    <!-- 检查对象 -->
    <div class="panel" style="margin-top:16px;">
      <div class="qhead">
        <el-form inline label-width="72px" class="filter-bar">
          <el-form-item label="检查项目">
            <el-select v-model="target.community" style="width:150px;">
              <el-option v-for="c in communities" :key="c.communityId" :label="c.name" :value="c.communityId" />
            </el-select>
          </el-form-item>
          <el-form-item label="检查区域">
            <el-select v-model="target.area" style="width:140px;">
              <el-option v-for="a in ['公共区域', '楼栋大堂', '地下车库', '设备房', '绿化带']" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
          <el-form-item label="检查类型">
            <el-radio-group v-model="target.type">
              <el-radio-button label="日常" />
              <el-radio-button label="专项" />
              <el-radio-button label="月度" />
            </el-radio-group>
          </el-form-item>
          <el-form-item label="检查人">
            <el-input v-model="target.auditor" style="width:120px;" />
          </el-form-item>
        </el-form>
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:minmax(0,1fr) 320px;">
      <!-- 评分表 -->
      <div class="panel">
        <div class="panel__hd">
          <h3>评分项</h3>
          <span class="spacer" />
          <span class="desc">权重合计 {{ totalWeight }} · 选择档位后自动计算</span>
        </div>

        <el-table :data="groups" row-key="cat" :tree-props="{ children: 'items' }" size="small" default-expand-all>
          <el-table-column prop="cat" label="检查项" min-width="210">
            <template #default="{ row }">
              <span :class="{ 'is-cat': !row.parent }">{{ row.cat }}</span>
              <span v-if="row.veto" class="tag tag--danger" style="margin-left:6px;font-size:10px;">一票否决</span>
            </template>
          </el-table-column>
          <el-table-column prop="weight" label="权重" width="70" align="right">
            <template #default="{ row }">{{ row.weight ? row.weight + '%' : '' }}</template>
          </el-table-column>
          <el-table-column prop="standard" label="检查标准" min-width="200" show-overflow-tooltip />
          <el-table-column label="评分档位" width="260">
            <template #default="{ row }">
              <el-radio-group v-if="row.weight" v-model="row.grade" size="small" @change="calc">
                <el-radio-button v-for="g in grades" :key="g.v" :label="g.v">{{ g.t }}</el-radio-button>
              </el-radio-group>
            </template>
          </el-table-column>
          <el-table-column label="得分" width="76" align="right">
            <template #default="{ row }">
              <span v-if="row.weight" class="money" :class="{ 'is-bad': rowScore(row) < row.weight * 0.7 }">
                {{ rowScore(row).toFixed(1) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="说明 / 照片" width="120">
            <template #default="{ row }">
              <template v-if="row.weight && row.grade !== 'A'">
                <el-button link type="primary" size="small">补充说明</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>

        <div class="legend">
          <span v-for="g in grades" :key="g.v" class="lg">
            <i :style="{ background: g.c }" />{{ g.t }}（{{ Math.round(g.r * 100) }}%）
          </span>
          <span class="spacer" />
          <span class="muted" style="font-size:12px;">档位系数 × 权重 = 得分；一票否决项不合格直接 0 分</span>
        </div>
      </div>

      <!-- 结果 -->
      <div>
        <div class="panel res">
          <div class="res__k">本次得分</div>
          <div class="res__n" :class="levelClass">{{ score.toFixed(1) }}</div>
          <div class="res__lv">
            <span class="tag" :class="levelTag">{{ level }}</span>
            <span class="muted" style="font-size:12px;">{{ target.type }}检查 · {{ target.area }}</span>
          </div>
          <div class="res__bar"><i :style="{ width: score + '%', background: levelColor }" /></div>
          <div class="res__hint">上期 {{ lastScore }} 分 · 环比 {{ (score - lastScore).toFixed(1) }}</div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd"><h4>一票否决</h4></div>
          <el-switch v-model="vetoHit" active-text="触发（安全责任事故）" @change="calc" />
          <div class="hint">触发后总分记 0，并强制生成整改单与上报片区。</div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="panel__hd"><h3>整改项</h3><span class="spacer" /><span class="desc">{{ issues.length }} 项</span></div>
          <div v-if="!issues.length"><EmptyState type="empty" desc="暂无扣分项" /></div>
          <div v-for="(i, idx) in issues" :key="i.cat" class="issue">
            <span class="issue__idx">{{ idx + 1 }}</span>
            <div class="issue__b">
              <div class="issue__t">{{ i.cat }} <span class="issue__d">扣 {{ (i.weight - rowScore(i)).toFixed(1) }} 分</span></div>
              <div class="issue__s">责任人 {{ i.owner }} · 整改期限 3 天</div>
            </div>
            <el-button link type="primary" size="small">派整改</el-button>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <el-button type="primary" style="width:100%;" :loading="saving" @click="submit">提交评分并生成整改单</el-button>
          <el-button style="width:100%;margin:8px 0 0 0;">存为草稿</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { communities } from '@/utils/api'
import { bucketColor } from '@/utils/dict'

const target = reactive({ community: 'P01', area: '公共区域', type: '日常', auditor: '品质专员 · 韩雪' })
const grades = [
  { v: 'A', t: '合格', r: 1 },
  { v: 'B', t: '轻微', r: 0.8 },
  { v: 'C', t: '一般', r: 0.6 },
  { v: 'D', t: '严重', r: 0 }
]

// 评分卡（可按项目配置，原型内置一套四类 10 项）
const groups = reactive([
  {
    cat: '一、环境保洁（30%）', weight: null,
    items: [
      { cat: '大堂与电梯轿厢', weight: 10, standard: '地面无污渍、轿厢无手印', grade: 'A', owner: '孙桂英' },
      { cat: '垃圾收集点', weight: 10, standard: '桶盖闭合、周边无散落', grade: 'A', owner: '孙桂英' },
      { cat: '绿化养护', weight: 10, standard: '无枯枝、草坪修剪整齐', grade: 'A', owner: '冯小花' }
    ]
  },
  {
    cat: '二、秩序维护（30%）', weight: null,
    items: [
      { cat: '门岗值守', weight: 10, standard: '在岗在位、登记完整', grade: 'A', owner: '蒋大勇' },
      { cat: '车辆管理', weight: 10, standard: '无占用消防通道', grade: 'A', owner: '蒋大勇' },
      { cat: '监控值守', weight: 10, standard: '24 小时有人、录像可回溯 30 天', grade: 'A', owner: '周明' }
    ]
  },
  {
    cat: '三、工程设施（30%）', weight: null,
    items: [
      { cat: '消防设施', weight: 12, standard: '灭火器压力正常、疏散指示完好', grade: 'A', owner: '周明', veto: true },
      { cat: '电梯运行', weight: 10, standard: '年检有效、五方对讲可用', grade: 'A', owner: '孙德海' },
      { cat: '二次供水', weight: 8, standard: '水质检测报告在有效期', grade: 'A', owner: '孙德海' }
    ]
  },
  {
    cat: '四、客户服务（10%）', weight: null,
    items: [
      { cat: '公示与档案', weight: 10, standard: '收费公示、服务标准上墙', grade: 'A', owner: '王芳' }
    ]
  }
])

// 注意：必须保持对象引用，否则改档位后总分不响应
const flat = computed(() => groups.flatMap(g => g.items))
const totalWeight = computed(() => flat.value.reduce((s, i) => s + i.weight, 0))
const rowScore = row => (row.grade === 'D' ? 0 : row.weight * (grades.find(g => g.v === row.grade)?.r ?? 1))

const vetoHit = ref(false)
const score = computed(() => {
  if (vetoHit.value) return 0
  return flat.value.reduce((s, i) => s + rowScore(i), 0)
})
const lastScore = 91.5
const level = computed(() => score.value >= 90 ? '优秀' : score.value >= 80 ? '良好' : score.value >= 70 ? '合格' : '不合格')
const levelTag = computed(() => score.value >= 90 ? 'tag--success' : score.value >= 80 ? 'tag--primary' : score.value >= 70 ? 'tag--warning' : 'tag--danger')
// 档位配色统一走 dict.grade，页面不再出现色值
const levelGrade = computed(() => score.value >= 90 ? 'A' : score.value >= 80 ? 'B' : score.value >= 70 ? 'C' : 'D')
const levelColor = computed(() => bucketColor('grade', levelGrade.value))
const levelClass = computed(() => ({ 'is-bad': score.value < 70 }))

const issues = computed(() => flat.value.filter(i => i.grade !== 'A' && rowScore(i) < i.weight))
const saving = ref(false)

function calc() { /* 计算属性自动响应，保留钩子便于后续接接口 */ }
function submit() {
  if (issues.value.some(i => i.grade === 'D')) {
    ElMessage.warning('存在「严重」档位，已自动生成整改单并要求 24 小时内响应')
  }
  saving.value = true
  setTimeout(() => {
    saving.value = false
    ElMessage.success(`评分已提交：${score.value.toFixed(1)} 分（${level.value}），整改项 ${issues.value.length} 条`)
  }, 600)
}
</script>

<style scoped>
.qhead :deep(.el-form-item) { margin-bottom: 0; }
.is-cat { font-weight: 600; color: var(--biz-text-1); }
.is-bad { color: var(--biz-danger); }
.legend { display: flex; align-items: center; gap: 14px; margin-top: 12px; font-size: 12px; color: var(--biz-text-3); }
.legend .spacer { flex: 1; }
.lg { display: inline-flex; align-items: center; gap: 5px; }
.lg i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

.res { text-align: center; padding: 20px; }
.res__k { font-size: 12.5px; color: var(--biz-text-3); }
.res__n { font-family: var(--biz-font-num); font-size: 46px; font-weight: 600; color: var(--biz-success); line-height: 1.2; margin: 4px 0; }
.res__n.is-bad { color: var(--biz-danger); }
.res__lv { display: flex; align-items: center; justify-content: center; gap: 8px; }
.res__bar { height: 8px; border-radius: 999px; background: var(--biz-bg-fill); overflow: hidden; margin: 14px 0 8px; }
.res__bar i { display: block; height: 8px; border-radius: 999px; transition: width .2s; }
.res__hint { font-size: 11.5px; color: var(--biz-text-3); }

.hint { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); line-height: 1.6; }
.issue { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--biz-border-light); }
.issue:last-child { border-bottom: none; }
.issue__idx { width: 18px; height: 18px; border-radius: 50%; background: rgba(255,107,107,.12); color: #EC4D63; font-size: 11px; display: grid; place-items: center; flex: 0 0 18px; }
.issue__b { flex: 1; min-width: 0; }
.issue__t { font-size: 12.5px; }
.issue__d { color: var(--biz-danger); font-size: 11.5px; }
.issue__s { font-size: 11px; color: var(--biz-text-3); margin-top: 2px; }
</style>
