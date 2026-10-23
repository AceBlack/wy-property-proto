<template>
  <header class="app-top">
    <el-icon class="top-fold" style="cursor:pointer;color:#8a94b0;font-size:18px;" @click="emit('toggle')">
      <component :is="collapse ? 'Expand' : 'Fold'" />
    </el-icon>

    <el-dropdown trigger="click" @command="switchProject">
      <div class="top-proj">
        <el-icon style="color:#5b6cff;"><OfficeBuilding /></el-icon>
        <span>{{ curName }}</span>
        <el-icon style="color:#b3bad0;"><ArrowDown /></el-icon>
      </div>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="c in communities" :key="c.communityId" :command="c.communityId">
            {{ c.name }}（{{ c.houseCount }} 户）
          </el-dropdown-item>
          <el-dropdown-item command="__all" divided>全部项目</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-tooltip :content="scopeText" placement="bottom">
      <span class="scope-tag" :class="{ 'is-all': scopeMode === '全部项目' }">
        数据范围 · {{ scopeMode }}
      </span>
    </el-tooltip>

    <span class="spacer" />

    <div class="top-icon" title="全局搜索">
      <el-icon><Search /></el-icon>
    </div>
    <div class="top-icon" title="待办提醒">
      <el-icon><Bell /></el-icon>
      <span class="badge">6</span>
    </div>
    <div class="top-icon" title="帮助">
      <el-icon><QuestionFilled /></el-icon>
    </div>

    <el-tooltip content="切换角色视角：菜单与可访问页面会同步变化" placement="bottom">
      <el-dropdown trigger="click" @command="switchRole">
        <div class="top-user">
          <span class="avatar">{{ curRole.label.slice(0, 1) }}</span>
          <span class="nm">{{ curRole.label }}</span>
          <span class="role-tag">{{ curRole.permCount }} 项权限</span>
          <el-icon style="color:#b3bad0;"><ArrowDown /></el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <div class="role-hd">以某角色查看（{{ roleGroups[0].items.length + roleGroups[1].items.length }} 个角色）</div>
            <template v-for="g in roleGroups" :key="g.scope">
              <div class="role-gp">{{ g.scope }}级</div>
              <el-dropdown-item v-for="r in g.items" :key="r.value" :command="r.value">
                <span :class="{ 'is-cur': r.value === curRoleId }">{{ r.label }}</span>
                <span class="role-meta">{{ r.dataScope }} · {{ r.permCount }} 项</span>
              </el-dropdown-item>
            </template>
            <el-dropdown-item divided command="__gotoOrg">去「组织与权限」配置</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </el-tooltip>
  </header>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { communities } from '@/mock'
import { roleSwitchOpts, permLabel, currentScope, scopeHint } from '@/utils/api'
import { canVisit, currentRoleId, needPermOf, setRole } from '@/utils/auth'

defineProps({ collapse: { type: Boolean, default: false } })
const emit = defineEmits(['toggle'])

const route = useRoute()
const router = useRouter()

const curId = ref('__all')
const curName = computed(() => {
  if (curId.value === '__all') return '全部项目'
  const c = communities.find(x => x.communityId === curId.value)
  return c ? c.name : '全部项目'
})
function switchProject(id) { curId.value = id }

/* 数据范围（E4）：随角色实时解析，切角色后列表按新范围重新取数 */
const scopeMode = computed(() => currentScope().mode)
const scopeText = computed(() => scopeHint())

/* ---- 角色视角切换：原型阶段用角色模拟登录身份 ---- */
const roles = roleSwitchOpts()
const roleGroups = computed(() => ['集团', '项目'].map(scope => ({
  scope, items: roles.filter(r => r.scope === scope)
})))
const curRole = computed(() =>
  roles.find(r => r.value === currentRoleId.value) || { label: '未分配角色', permCount: 0 })

function switchRole(cmd) {
  if (cmd === '__gotoOrg') { router.push('/e/org'); return }
  setRole(cmd)
  const r = roles.find(x => x.value === cmd)
  // 切换后若停在无权限页面：与「地址栏直访」行为一致，统一跳 403
  if (!canVisit(route.path)) {
    router.push({
      path: '/error/403',
      query: { from: route.fullPath, need: needPermOf(route.path), role: cmd }
    })
    ElMessage.warning(
      `已切换为「${r?.label}」，当前页面需要「${permLabel(needPermOf(route.path)) || '相应权限'}」，不在其权限范围内`
    )
  } else {
    ElMessage.success(`已切换为「${r?.label}」，左侧菜单与可访问页面已同步更新`)
  }
}
</script>

<style scoped>
.scope-tag {
  font-size: 12px; line-height: 1; padding: 5px 10px; border-radius: 999px;
  background: rgba(91, 108, 255, .10); color: #5b6cff;
  border: 1px solid rgba(91, 108, 255, .25); white-space: nowrap; margin-left: 10px;
}
.scope-tag.is-all {
  background: rgba(120, 130, 150, .10); color: #6b7590; border-color: rgba(120, 130, 150, .25);
}
</style>
