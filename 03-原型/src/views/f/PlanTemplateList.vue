<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>计划模板 · 考核项的唯一源</b>：项目经理和四个班组各一套，<b>考什么、怎么算分、单位是什么</b>都由这里定，
        填报人只填目标值和完成情况。
        <br />
        <b>模板里没有权重</b>：每一项占多少，由提报人在新建计划时逐项填，运营管理部审核时可以调。
        原因很实际 —— 同一套考核项，不同项目当月的重点不一样；写死在模板里，要么所有人按同一比例，
        要么每个月改一遍模板，还会把历史版本的分数搅乱。
        <br />
        改模板<b>不影响已经提报的计划</b>：提报时整份拷贝成快照，之后模板怎么改都不回写。
        监控段的权重恒为 0，只扣分不占权重 —— 它的扣分上限本期不做配置，只让评价标准的文字可编辑。
        <br />
        改这个需要 <code>f.planTpl.edit</code>，与提报计划分开：能定考核标准的人和报计划的人不是同一个。
      </div>
    </div>

    <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
      <div class="panel dstat">
        <div class="dstat__k">模板</div>
        <div class="dstat__v">{{ st.total }}<span class="unit">套</span></div>
        <div class="dstat__s">{{ st.enabled }} 启用 · {{ st.disabled }} 停用</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">考核项</div>
        <div class="dstat__v">{{ st.items }}<span class="unit">条</span></div>
        <div class="dstat__s">三段落合计</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">规则校验</div>
        <div class="dstat__v" :class="st.broken ? 'is-warn' : 'is-ok'">
          {{ st.broken ? st.broken + ' 套缺项' : '全部通过' }}
        </div>
        <div class="dstat__s">{{ st.broken ? '量化段或重点段没有考核项' : '三段标题与条目齐全' }}</div>
      </div>
      <div class="panel dstat">
        <div class="dstat__k">自动匹配</div>
        <div class="dstat__v" style="font-size:16px;">按组织类型</div>
        <div class="dstat__s">项目 / 班组 T1–T4 / 职能兜底</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="toolbar">
        <el-input v-model="kw" placeholder="搜模板名 / 考核项" clearable style="width:230px"
          :prefix-icon="'Search'" @keyup.enter="load" @clear="load" />
        <el-button @click="load">查询</el-button>
        <span class="spacer" />
        <el-button type="primary" :icon="'Plus'" :disabled="!canEdit" @click="openCreate">新增模板</el-button>
      </div>
      <div v-if="!canEdit" class="muted" style="font-size:12px;padding:0 0 10px;">
        当前角色没有「计划模板」维护权限（<code>f.planTpl.edit</code>），可以查看条目与评价标准，但不能改。
      </div>

      <el-table :data="rows" stripe style="width:100%">
        <el-table-column prop="name" label="模板" min-width="200">
          <template #default="{ row }">
            <div style="font-weight:600;">{{ row.name }}</div>
            <div class="muted" style="font-size:11.5px;">{{ row.tplId }} · {{ row.desc }}</div>
          </template>
        </el-table-column>
        <el-table-column label="适用" width="120">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.matchType === '项目' ? 'primary' : (row.matchType === '班组' ? 'success' : 'info')">
              {{ matchLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="条目（量化/监控/重点）" width="190" align="center">
          <template #default="{ row }">
            <span style="font-family:var(--biz-font-num);">{{ row.qCount }} / {{ row.mCount }} / {{ row.kCount }}</span>
            <div class="muted" style="font-size:11px;">权重由提报人填</div>
          </template>
        </el-table-column>
        <el-table-column label="校验" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.checkOk ? 'success' : 'danger'" effect="plain">
              {{ row.checkOk ? '通过' : '不通过' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.enabled ? 'primary' : 'info'" effect="plain">
              {{ row.enabled ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新" width="150">
          <template #default="{ row }">
            <div style="font-size:11.5px;">{{ row.updatedAt }}</div>
            <div class="muted" style="font-size:11px;">{{ row.updatedBy }} · v{{ row.version }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="right">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="!canEdit" @click="openEdit(row)">编辑</el-button>
            <el-button link :type="row.enabled ? 'warning' : 'success'" :disabled="!canEdit" @click="onToggle(row)">
              {{ row.enabled ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer v-model="ed.visible" :title="ed.tplId ? `编辑模板 · ${ed.name}` : '新增计划模板'" size="1080px">
      <div v-if="ed.errors.length" class="chk-err">
        <div style="font-weight:600;margin-bottom:4px;">还有 {{ ed.errors.length }} 处要改</div>
        <div v-for="(e, i) in ed.errors" :key="i">· {{ e }}</div>
      </div>

      <el-form label-width="92px" style="margin-top:6px;">
        <el-row :gutter="16">
          <el-col :span="10">
            <el-form-item label="模板名称" required>
              <el-input v-model="ed.name" maxlength="20" show-word-limit placeholder="如：客服组月度计划" />
            </el-form-item>
          </el-col>
          <el-col :span="7">
            <el-form-item label="适用类型" required>
              <el-select v-model="ed.matchType" style="width:100%">
                <el-option label="项目（项目经理）" value="项目" />
                <el-option label="班组" value="班组" />
                <el-option label="职能（兜底）" value="职能" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="7">
            <el-form-item label="班组" :required="ed.matchType === '班组'">
              <el-select v-model="ed.matchSuffix" :disabled="ed.matchType !== '班组'" style="width:100%">
                <el-option label="T1 客服" value="1" />
                <el-option label="T2 工程" value="2" />
                <el-option label="T3 秩序" value="3" />
                <el-option label="T4 环境" value="4" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="说明">
          <el-input v-model="ed.desc" maxlength="60" placeholder="一句话说明这套模板管什么" />
        </el-form-item>
        <el-form-item label="权重">
          <div class="wtip">
            模板不设权重。提报人在新建计划时为每一项填权重，合计必须正好 100%；
            运营管理部审核时可以调整。<b>监控指标不占权重</b>，只扣分。
          </div>
        </el-form-item>
      </el-form>

      <div v-for="sec in SECTIONS" :key="sec.key" class="sec">
        <div class="sec__hd">
          <h4>{{ sec.name }}</h4>
          <span class="desc">{{ sec.note }}</span>
          <span class="spacer" />
          <span class="wsum" :class="sec.key === 'm' ? '' : (ed[sec.key].length ? 'is-ok' : 'is-warn')">
            {{ ed[sec.key].length }} 条{{ sec.key === 'm' ? '（权重恒 0）' : (ed[sec.key].length ? '' : ' · 至少 1 条') }}
          </span>
          <el-button size="small" :icon="'Plus'" @click="addItem(sec.key)">加一条</el-button>
        </div>

        <el-table :data="ed[sec.key]" size="small" style="width:100%">
          <el-table-column label="#" width="46" align="center">
            <template #default="{ $index }">{{ $index + 1 }}</template>
          </el-table-column>
          <el-table-column label="考核项" :width="sec.key === 'm' ? 190 : 220">
            <template #default="{ row }">
              <el-input v-model="row.name" size="small" maxlength="40" placeholder="名称" />
            </template>
          </el-table-column>
          <el-table-column v-if="sec.key === 'm'" label="评价标准（只可改文字，系统不校验扣分上限）">
            <template #default="{ row }">
              <el-input v-model="row.standard" size="small" type="textarea" :rows="1" autosize
                placeholder="如：部门员工每主动离职 1 人，考核总分扣 0.05 分，最高扣 0.2 分" />
            </template>
          </el-table-column>
          <template v-else>
            <!-- 单位只对量化指标有意义：重点工作写的是文字，没有"元/件"这种量纲 -->
            <el-table-column v-if="sec.key === 'q'" label="单位" width="90">
              <template #default="{ row }">
                <el-input v-model="row.unit" size="small" placeholder="元" />
              </template>
            </el-table-column>
            <el-table-column v-if="sec.key === 'q'" label="目标默认值" width="120">
              <template #default="{ row }">
                <el-input v-model="row.targetDefault" size="small" placeholder="可空" />
              </template>
            </el-table-column>
            <el-table-column v-if="sec.key === 'q'" label="方向" width="96">
              <template #default="{ row }">
                <el-select v-model="row.direction" size="small">
                  <el-option v-for="d in DIRECTION" :key="d.value" :label="d.label" :value="d.value" />
                </el-select>
              </template>
            </el-table-column>
          </template>
          <el-table-column label="操作" width="108" align="right">
            <template #default="{ $index }">
              <el-button link :disabled="$index === 0" @click="move(sec.key, $index, -1)">上移</el-button>
              <el-button link type="danger" @click="removeItem(sec.key, $index)">删</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <template #footer>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="muted" style="font-size:12px;">
            保存即生效，只影响之后新建的计划；已提报的计划按提报时的快照走。
          </span>
          <span style="flex:1;" />
          <el-button @click="ed.visible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">保存模板</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  PLAN_DIRECTION_OPT, PLAN_SECTIONS, canEditPlanTpl, planTplCheck, planTplStats,
  queryPlanTpls, savePlanTpl, togglePlanTpl
} from '@/api'

const SECTIONS = PLAN_SECTIONS
const DIRECTION = PLAN_DIRECTION_OPT
const canEdit = computed(() => canEditPlanTpl())

const rows = ref([])
const st = ref({ total: 0, enabled: 0, disabled: 0, items: 0, broken: 0 })
const kw = ref('')
const saving = ref(false)

const ed = reactive({
  visible: false, tplId: '', name: '', desc: '', matchType: '班组', matchSuffix: '1',
  q: [], m: [], k: [], errors: []
})

function matchLabel(row) {
  if (row.matchType === '项目') return '项目部'
  if (row.matchType === '班组') return `班组 T${row.matchSuffix}`
  return '职能兜底'
}

async function load() {
  try {
    rows.value = await queryPlanTpls({ kw: kw.value })
    st.value = await planTplStats()
  } catch (e) {
    ElMessage.error(e?.message || '模板列表加载失败')
  }
}

function openCreate() {
  Object.assign(ed, {
    visible: true, tplId: '', name: '', desc: '', matchType: '班组', matchSuffix: '1', errors: [],
    q: [], m: [], k: []
  })
  ed.q.push(newItem('q'))
  ed.m.push(newItem('m'))
  ed.k.push(newItem('k'))
}

function newItem(sec) {
  return {
    itemId: '', section: sec, name: '', standard: '',
    direction: 1, targetDefault: '', unit: '', enabled: true
  }
}

function openEdit(row) {
  ed.visible = true
  ed.tplId = row.tplId
  ed.name = row.name
  ed.desc = row.desc
  ed.matchType = row.matchType
  ed.matchSuffix = row.matchSuffix || '1'
  ed.errors = []
  ed.q = row.items.filter(i => i.section === 'q').map(i => ({ ...i }))
  ed.m = row.items.filter(i => i.section === 'm').map(i => ({ ...i }))
  ed.k = row.items.filter(i => i.section === 'k').map(i => ({ ...i }))
}

function addItem(sec) {
  ed[sec].push(newItem(sec))
}
function removeItem(sec, i) {
  ed[sec].splice(i, 1)
}
function move(sec, i, d) {
  const list = ed[sec]
  const j = i + d
  if (j < 0 || j >= list.length) return
  const [x] = list.splice(i, 1)
  list.splice(j, 0, x)
}

function payload() {
  return {
    name: ed.name,
    desc: ed.desc,
    matchType: ed.matchType,
    matchSuffix: ed.matchSuffix,
    items: [
      ...ed.q.map(x => ({ ...x, section: 'q' })),
      ...ed.m.map(x => ({ ...x, section: 'm' })),
      ...ed.k.map(x => ({ ...x, section: 'k' }))
    ]
  }
}

function onSave() {
  const chk = planTplCheck(payload())
  if (!chk.ok) {
    ed.errors = chk.errs
    ElMessage.error(`还有 ${chk.errs.length} 处要改，看抽屉顶部的清单`)
    return
  }
  ed.errors = []
  saving.value = true
  try {
    const r = savePlanTpl(payload(), ed.tplId)
    ed.visible = false
    ElMessage.success(`已保存「${r.name}」v${r.version}，只影响之后新建的计划`)
    load()
  } catch (e) {
    ed.errors = [e?.message || '保存失败']
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function onToggle(row) {
  const next = !row.enabled
  if (!next) {
    try {
      await ElMessageBox.confirm(
        `停用后新建计划不会再匹配到「${row.name}」，已经提报的计划不受影响。停用不等于删除，随时可以再启用。`,
        '停用模板', { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' }
      )
    } catch { return }
  }
  try {
    togglePlanTpl(row.tplId, next)
    ElMessage.success(next ? '已启用' : '已停用')
    load()
  } catch (e) {
    ElMessage.error(e?.message || '操作失败')
  }
}

onMounted(load)
</script>

<style scoped>
.chk-err {
  margin: 0 0 12px; padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.8;
  background: var(--bg-danger, rgba(227, 77, 89, .08)); color: var(--biz-danger, #e34d59);
  border: 1px solid rgba(227, 77, 89, .25);
}
.wtip {
  font-size: 12px; line-height: 1.75; color: var(--biz-text-2);
  padding: 8px 11px; border-radius: 7px; background: var(--biz-bg-fill);
}
.wtip b { color: var(--biz-text-1); }
.sec { margin-top: 18px; }
.sec__hd { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.sec__hd h4 { margin: 0; font-size: 14px; }
.sec__hd .desc { font-size: 12px; color: var(--biz-text-3); }
.sec__hd .spacer { flex: 1; }
.wsum { font-size: 12px; font-family: var(--biz-font-num); }
.is-ok { color: var(--biz-success, #12b98a); }
.is-warn { color: var(--biz-warning, #d98a1f); }
</style>
