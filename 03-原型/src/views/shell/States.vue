<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>异常态与边界规范页</b>：全站 9 类异常分支的唯一参照。文案写死在组件里，页面禁止自拟。
        下方演示区会<b>真实发起请求</b>（数据层注入失败），不是静态截图——改完代码可直接验收。
      </div>
    </div>

    <!-- 一、状态清单 -->
    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd"><h3>九类状态清单</h3><span class="spacer" /><span class="desc">文案与载体一一对应</span></div>
      <el-table :data="STATES" size="small" border stripe>
        <el-table-column prop="name" label="状态" width="96" />
        <el-table-column prop="trigger" label="触发条件" min-width="180" />
        <el-table-column prop="text" label="展示文案" min-width="220" />
        <el-table-column prop="carrier" label="载体" width="180" />
        <el-table-column prop="action" label="配套动作" width="120" />
      </el-table>
    </div>

    <!-- 二、实时演示 -->
    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd">
        <h3>实时演示</h3><span class="spacer" />
        <span class="desc">切换后点击「重新请求」，观察列表区变化</span>
      </div>
      <div class="demo-bar">
        <el-radio-group v-model="demo" size="small" @change="apply">
          <el-radio-button v-for="d in DEMOS" :key="d.key" :value="d.key">{{ d.label }}</el-radio-button>
        </el-radio-group>
        <el-button size="small" type="primary" :icon="'RefreshRight'" @click="load">重新请求</el-button>
        <span v-if="demoNote" class="muted" style="font-size:12px;">{{ demoNote }}</span>
      </div>

      <AsyncBlock
        :loading="loading" :error="error" :error-code="errorCode"
        :empty="!rows.length"
        :empty-type="demo === 'search' ? 'search' : 'empty'"
        :empty-title="demo === 'search' ? '' : '暂无数据'"
        :empty-desc="demo === 'search' ? '换个筛选条件试试' : '还没有业主数据，可先新增一条'"
        :skeleton-rows="3"
        style="margin-top:12px;"
        @retry="load"
      >
        <template #emptyAction>
          <el-button type="primary" size="small" @click="apply('normal')">清除演示条件</el-button>
        </template>
        <el-table :data="rowsView" size="small" border stripe height="200">
          <el-table-column prop="ownerId" label="业主编号" width="110" />
          <el-table-column prop="name" label="姓名" width="90" />
          <el-table-column prop="phone" label="手机号" width="130" />
          <el-table-column prop="houseNamesText" label="名下房屋" min-width="220" />
          <el-table-column prop="creditLevel" label="信用" width="70" />
        </el-table>
        <div class="muted" style="font-size:12px;margin-top:8px;">
          共 {{ total }} 条（演示每页 5 条）
        </div>
      </AsyncBlock>
    </div>

    <!-- 三、表单校验失败 -->
    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd"><h3>表单校验失败</h3><span class="spacer" /><span class="desc">规则来自 utils/rules.js，全站共用</span></div>
      <div class="panel__sub">留空或填错后点「保存」：字段红框红字 + 顶部汇总提示 + 自动滚动到第一个错误项</div>
      <el-form ref="demoForm" :model="demoFormData" :rules="demoRules" label-width="88px" label-position="right">
        <el-row :gutter="24">
          <el-col :span="8">
            <el-form-item label="姓名" prop="name"><el-input v-model="demoFormData.name" placeholder="2–20 个中英文字符" /></el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="手机号" prop="phone"><el-input v-model="demoFormData.phone" placeholder="11 位手机号" /></el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="身份证" prop="idCard"><el-input v-model="demoFormData.idCard" placeholder="18 位，含校验位" /></el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <div style="margin-top:8px;">
        <el-button type="primary" size="small" @click="onDemoSubmit">保存（触发校验）</el-button>
        <el-button size="small" @click="demoForm?.clearValidate()">清除校验</el-button>
      </div>
    </div>

    <!-- 四、边界条件 -->
    <div class="panel" style="margin-top:16px;">
      <div class="panel__hd"><h3>边界条件</h3><span class="spacer" /><span class="desc">验收时逐条核对</span></div>
      <el-table :data="EDGES" size="small" border stripe>
        <el-table-column prop="item" label="场景" width="140" />
        <el-table-column prop="expect" label="期望表现" min-width="380" />
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import AsyncBlock from '@/components/AsyncBlock.vue'
import { useListQuery } from '@/composables/useQuery'
import { getFailMode, queryOwners, setFailMode } from '@/utils/api'
import { idCard, name, phone } from '@/utils/rules'

const STATES = [
  { name: '空数据', trigger: '查询成功且总数 0，无任何筛选条件', text: '暂无数据，可先新增一条', carrier: 'EmptyState type=empty', action: '一个主动作' },
  { name: '筛选无结果', trigger: '查询成功且总数 0，存在筛选条件', text: '没有找到匹配的结果，换个条件试试', carrier: 'EmptyState type=search', action: '清除筛选' },
  { name: '加载中', trigger: '请求进行中', text: '骨架屏 / 表格 loading', carrier: 'AsyncBlock loading', action: '禁用操作' },
  { name: '加载失败', trigger: '网络异常 / 请求被拒', text: '数据加载失败，请检查网络后重试', carrier: 'AsyncBlock error', action: '重试' },
  { name: '接口报错', trigger: 'HTTP 5xx', text: '服务暂时不可用（错误码 500），已记录', carrier: 'AsyncBlock error', action: '重试 + 错误码' },
  { name: '请求超时', trigger: '超过 10s 未响应', text: '请求超时，请稍后重试', carrier: 'AsyncBlock error', action: '重试' },
  { name: '无权限', trigger: 'HTTP 403 / 数据范围外', text: '暂无查看权限，如需开通请联系管理员', carrier: 'EmptyState type=denied', action: '联系管理员' },
  { name: '会话过期', trigger: 'HTTP 401', text: '登录已过期，请重新登录', carrier: '全局拦截器', action: '跳登录页' },
  { name: '表单校验失败', trigger: '提交时字段不合法', text: '字段红框红字 + 顶部「请检查标红的 N 项」', carrier: 'FormShell + rules.js', action: '聚焦首个错误' }
]

const EDGES = [
  { item: '0 条 / 1 条 / 满页', expect: '0 条走空态；1 条时分页器不出现；满页（20/50/100）切换后回到第 1 页' },
  { item: '超长文本', expect: '单元格截断 + tooltip；表单输入受 maxlength 限制并显示字数' },
  { item: '图表全零', expect: '显示空坐标轴与「暂无数据」，不显示空白画布' },
  { item: '分母为 0', expect: '收缴率 / 在线率等比率显示「—」，不显示 0%' },
  { item: '大额金额', expect: '≥ 100 万加千分位，单位统一为元，保留 2 位小数' },
  { item: '跨年账期', expect: '账期筛选支持跨年，排序按账期字符串升序' },
  { item: '并发编辑', expect: '保存冲突（409）提示「数据已被他人修改」，提供刷新重试 —— 待确认是否上乐观锁' },
  { item: '批量操作', expect: '部分成功时给出「成功 N 条，失败 M 条」并支持导出失败明细' }
]

const DEMOS = [
  { key: 'normal', label: '正常', note: '' },
  { key: 'empty', label: '空数据', note: '查询成功但 0 条：给一个主动作（新增）' },
  { key: 'search', label: '筛选无结果', note: '同样 0 条，但给「清除筛选」——两者文案不同是刻意的' },
  { key: 'timeout', label: '请求超时', note: '数据层注入 504' },
  { key: 'server', label: '接口 500', note: '数据层注入 500，同时展示错误码' },
  { key: 'denied', label: '无权限 403', note: '数据层注入 403' },
  { key: 'expired', label: '会话过期 401', note: '正式实现走全局拦截器跳登录，此处仅展示文案' }
]
const demo = ref('normal')
const demoNote = computed(() => DEMOS.find(d => d.key === demo.value)?.note || '')

const { rows, total, loading, error, errorCode, query, load } = useListQuery(queryOwners, { filters: { kw: '' }, size: 5 })
const rowsView = computed(() => rows.value.map(r => ({ ...r, houseNamesText: (r.houseNames || []).join('、') })))

function apply(key) {
  demo.value = key
  const want = ['timeout', 'server', 'denied', 'expired'].includes(key) ? key : 'off'
  const cur = getFailMode()
  if (cur !== 'off' && cur !== want) setFailMode(cur)     // 先关掉当前注入
  if (want !== 'off') setFailMode(want)
  query.kw = (key === 'empty' || key === 'search') ? 'ZZZZ_NO_HIT' : ''
  load()
}

/* ---- 表单校验演示 ---- */
const demoForm = ref()
const demoFormData = ref({ name: '', phone: '', idCard: '' })
const demoRules = { name: name('姓名'), phone: phone('手机号'), idCard: idCard('证件号码') }
async function onDemoSubmit() {
  try {
    await demoForm.value.validate()
    ElMessage.success('校验通过')
  } catch (e) {
    const n = Object.keys(e || {}).length
    ElMessage.error(`请检查标红的 ${n} 项`)
    demoForm.value?.scrollToField?.(Object.keys(e || {})[0])
  }
}
</script>

<style scoped>
.demo-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
</style>
