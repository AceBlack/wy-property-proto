<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>组织与权限 · 纯 RBAC</b>：权限只挂在<b>角色</b>上（{{ summary.roleCount }} 个角色 / {{ summary.permCount }} 个权限位），人只挂角色——改权限即改角色，不逐人授权。
        员工的角色与班组由<b>岗位反推</b>（数据里员工只到项目部，班组是执行层），所以左侧组织树能展开到第 4 层。
        <b>数据权限按项目级五档</b>：全部项目 / 指定项目 / 本项目 / 本部门 / 仅本人——这正是「为什么这个账号只看得到翡翠城」的答案。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid g4">
        <div class="dstat"><div class="dstat__k">成员总数</div><div class="dstat__v">{{ summary.total }}<span class="unit">人</span></div></div>
        <div class="dstat"><div class="dstat__k">在职 / 试用</div><div class="dstat__v">{{ summary.onjob }}<span class="unit">/ {{ summary.probation }}</span></div></div>
        <div class="dstat"><div class="dstat__k">组织节点</div><div class="dstat__v">{{ summary.orgCount }}<span class="unit">个（含 {{ summary.teamCount }} 班组）</span></div></div>
        <div class="dstat"><div class="dstat__k">未分配角色</div><div class="dstat__v" :class="summary.noRole > 0 ? 'is-warn' : ''">{{ summary.noRole }}<span class="unit">人</span></div></div>
      </div>
      <div class="sum-note">
        口径：角色数 {{ summary.roleCount }} · 权限位 {{ summary.permCount }}（域 → 功能 → 操作）· 数据范围受限（仅本人 {{ summary.selfOnly }} 人 / 本部门 {{ summary.deptOnly }} 人 / 可见全部项目 {{ summary.groupAll }} 人）。
        员工 120 人全部有岗位，角色由岗位反推（项目部「总经理」按项目经理计，集团总经理只保留总部 1 人），故未分配角色为 0。
        劳动合同已到期 {{ summary.contractExpired }} 人：演示数据未做续签滚续，到期日停在 2022–2025，表格里标红即为此。
      </div>
    </div>

    <div class="ia" :class="{ 'is-collapsed': treeCollapsed }" style="margin-top:16px;">
      <div class="ia__tree">
        <SpaceTree
          :title="treeTitle" :tree-title="treeSubTitle"
          :nodes="curTree" :virtual="curVnodes"
          :placeholder="treePlaceholder"
          :active-id="activeId" :active-vn="activeVn"
          @pick="onPick" @collapse="treeCollapsed = true"
        />
      </div>

      <div class="ia__main">
        <el-button v-if="treeCollapsed" class="ia__handle" size="small" :icon="'Expand'" @click="treeCollapsed = false">
          展开{{ treeTitle }}
        </el-button>

        <div class="panel">
          <div class="tabsbar">
            <el-radio-group v-model="tab" size="small" @change="onTab">
              <el-radio-button value="member">成员</el-radio-button>
              <el-radio-button value="role">角色权限</el-radio-button>
              <el-radio-button value="scope">数据权限</el-radio-button>
            </el-radio-group>
            <span class="spacer" />
            <span class="tabsbar__hint">{{ tabHint }}</span>
          </div>

          <div class="scopebar">
            <template v-if="scopePath.length">
              <span v-for="(p, i) in scopePath" :key="p">
                <span class="scopebar__i" :class="{ 'is-last': i === scopePath.length - 1 }" @click="onCrumb(i)">{{ p }}</span>
                <span v-if="i < scopePath.length - 1" class="scopebar__sep">/</span>
              </span>
            </template>
            <span v-else class="scopebar__i is-last">{{ emptyScopeText }}</span>
            <span v-if="activeVn" class="scopebar__vf">{{ vnLabel }}</span>
            <span class="spacer" />
            <span class="scopebar__hint">{{ scopeHint }}</span>
            <el-button link type="primary" @click="clearScope">清除范围</el-button>
          </div>

          <!-- Tab1 成员：角色 / 状态 / 用工类型 / 关键字 -->
          <el-form v-if="tab === 'member'" :model="query" class="filter-bar" label-width="52px" @submit.prevent>
            <el-form-item label="角色">
              <el-select v-model="query.roleId" placeholder="全部" clearable style="width:104px">
                <el-option v-for="o in roleOptsData" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:76px">
                <el-option v-for="o in statusOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="姓名 / 工号 / 岗位" clearable style="width:132px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="search">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>

          <!-- Tab2 角色权限：层级 / 关键字 -->
          <el-form v-else-if="tab === 'role'" :model="roleFilter" class="filter-bar" label-width="52px" @submit.prevent>
            <el-form-item label="层级">
              <el-select v-model="roleFilter.scope" placeholder="全部" clearable style="width:88px">
                <el-option label="集团级" value="集团" />
                <el-option label="项目级" value="项目" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="roleFilter.kw" placeholder="角色名 / 说明" clearable style="width:150px" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'RefreshLeft'" @click="resetRole">重置</el-button>
            </el-form-item>
          </el-form>

          <!-- Tab3 数据权限：范围档位 -->
          <el-form v-else :model="scopeFilter" class="filter-bar" label-width="52px" @submit.prevent>
            <el-form-item label="范围">
              <el-select v-model="scopeFilter.dataScope" placeholder="全部" clearable style="width:104px">
                <el-option v-for="o in scopeOptsData" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="scopeFilter.kw" placeholder="角色名 / 说明" clearable style="width:150px" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'RefreshLeft'" @click="resetScope">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-button v-if="tab === 'member'" type="primary" :icon="'Plus'" @click="openEmp">新增成员</el-button>
            <el-button v-else type="primary" :icon="'Plus'" @click="openRoleCreate">新增角色</el-button>
            <el-button :icon="'Download'" :disabled="!exportRows.length" @click="onExport">导出</el-button>
            <span class="spacer" />
            <el-button v-if="tab === 'member'" :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">{{ totalText }}</span>
          </div>

          <!-- Tab1 成员 -->
          <el-table v-if="tab === 'member'" v-loading="loading" :data="rows" style="width:100%"
            max-height="calc(100vh - 500px)" :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="姓名 / 工号" min-min-width="130">
              <template #default="{ row }">
                <div class="nowrap">{{ row.name }}</div>
                <div class="ps-sub">{{ row.empNo }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="position" label="岗位" min-width="84" show-overflow-tooltip />
            <el-table-column label="角色" min-width="100" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="nowrap">{{ row.roleName }}</div>
                <div class="ps-sub">{{ row.permCount }} 个权限位</div>
              </template>
            </el-table-column>
            <el-table-column label="数据范围" min-width="96">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="scopeTagType(row.dataScope)">{{ row.dataScope || '—' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="所属组织" min-min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                <div class="nowrap">{{ row.orgName }}</div>
                <div class="ps-sub">{{ row.projName }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="level" label="职级" min-width="68" />
            <el-table-column label="状态" min-width="76">
              <template #default="{ row }"><StatusTag domain="employee" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="入职 / 合同" min-width="104">
              <template #default="{ row }">
                <div class="nowrap">{{ row.entryDate }}</div>
                <div class="ps-sub" :class="{ 'is-warn': row.contractExpired }">至 {{ row.contractEnd }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="84" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <EmptyState type="search" desc="换个筛选条件，或清除范围重新查看">
                <template #action><el-button @click="reset">清除筛选条件</el-button></template>
              </EmptyState>
            </template>
          </el-table>

          <!-- Tab2 角色权限 -->
          <el-table v-else-if="tab === 'role'" :data="roleRowsData" style="width:100%"
            max-height="calc(100vh - 500px)" :row-class-name="rowClass" @row-click="onRoleRow">
            <el-table-column label="角色" min-min-width="160">
              <template #default="{ row }">
                <div class="nowrap">{{ row.name }}</div>
                <div class="ps-sub">{{ row.roleId }}</div>
              </template>
            </el-table-column>
            <el-table-column label="层级" min-width="72">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.scope === '集团' ? 'primary' : 'info'">{{ row.scope }}级</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="人数" min-width="72">
              <template #default="{ row }">{{ row.userCount }}<span class="ps-sub">人</span></template>
            </el-table-column>
            <el-table-column label="数据范围" min-width="104">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="scopeTagType(row.dataScope)">{{ row.dataScope }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="权限位" min-width="88">
              <template #default="{ row }">{{ row.permCount }}<span class="ps-sub">/ {{ summary.permCount }}</span></template>
            </el-table-column>
            <el-table-column label="覆盖度" min-width="120">
              <template #default="{ row }">
                <el-progress :percentage="row.coverage" :stroke-width="8" :show-text="false" />
                <div class="ps-sub">{{ row.coverage }}%</div>
              </template>
            </el-table-column>
            <el-table-column label="涉及业务域" min-min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.domains.join('、') || '—' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="84" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRoleRow(row)">权限</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- Tab3 数据权限 -->
          <el-table v-else :data="scopeRowsData" style="width:100%"
            max-height="calc(100vh - 500px)" :row-class-name="rowClass" @row-click="onRoleRow">
            <el-table-column label="角色" min-min-width="160">
              <template #default="{ row }">
                <div class="nowrap">{{ row.name }}</div>
                <div class="ps-sub">{{ row.roleId }} · {{ row.scope }}级</div>
              </template>
            </el-table-column>
            <el-table-column label="数据范围" min-width="100">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="scopeTagType(row.dataScope)">{{ row.dataScope }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="可见项目" min-min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ row.visibleText }}</template>
            </el-table-column>
            <el-table-column label="影响人数" min-width="92">
              <template #default="{ row }">{{ row.userCount }}<span class="ps-sub">人</span></template>
            </el-table-column>
            <el-table-column label="口径说明" min-min-width="120" show-overflow-tooltip>
              <template #default="{ row }">{{ row.scopeMemo }}</template>
            </el-table-column>
            <el-table-column label="操作" width="84" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRoleRow(row)">详情</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div v-if="tab === 'member'" class="table-foot">
            <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
              :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
          </div>
        </div>
      </div>
    </div>

    <!-- 成员抽屉 -->
    <DetailDrawer
      v-model="mVisible" :loading="mLoading"
      :title="mData ? `${mData.member.name} · ${mData.member.position}` : ''"
      :subtitle="mData ? `${mData.member.empNo} · ${mData.org.path}` : ''"
      :status="mData?.member?.status" status-domain="employee"
    >
      <template v-if="mData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">月薪</div><div class="dstat__v">{{ money(mData.member.monthlySalary) }}<span class="unit">元</span></div></div>
          <div class="dstat"><div class="dstat__k">绩效分</div><div class="dstat__v">{{ mData.member.score }}<span class="unit">分</span></div></div>
          <div class="dstat"><div class="dstat__k">本月迟到</div><div class="dstat__v" :class="mData.attendance.late >= 3 ? 'is-warn' : ''">{{ mData.attendance.late }}<span class="unit">次</span></div></div>
          <div class="dstat"><div class="dstat__k">合同剩余</div>
            <div class="dstat__v" :class="mData.contract.left < 0 ? 'is-warn' : ''">
              {{ mData.contract.left < 0 ? '已过期' : mData.contract.left }}<span class="unit">{{ mData.contract.left < 0 ? '' : '天' }}</span>
            </div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>任职与角色</h4><span class="desc">纯 RBAC：权限随角色，不单独授权</span></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">所属组织</span><span class="dl__v">{{ mData.org.path }}</span></div>
          <div class="dl__i"><span class="dl__k">直属上级</span><span class="dl__v">{{ mData.member.manager || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">岗位 / 职级</span><span class="dl__v">{{ mData.member.position }} · {{ mData.member.level }}</span></div>
          <div class="dl__i"><span class="dl__k">用工类型</span><span class="dl__v">{{ mData.member.empType }}</span></div>
          <div class="dl__i"><span class="dl__k">角色</span><span class="dl__v">{{ mData.role?.name || '未分配' }}（{{ mData.role?.scope }}级）</span></div>
          <div class="dl__i"><span class="dl__k">可见数据</span><span class="dl__v">{{ mData.role?.scopeText || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">手机号</span><span class="dl__v">{{ maskPhone(mData.member.phone) }}</span></div>
          <div class="dl__i"><span class="dl__k">入职 / 转正</span><span class="dl__v">{{ mData.member.entryDate }} / {{ mData.member.regularDate }}</span></div>
        </div>

        <div style="margin-top:18px;">
          <div class="sec__hd"><h4>权限概览</h4>
            <span class="desc">已授权 {{ mData.matrix.granted }} / {{ mData.matrix.total }} 个权限位（{{ mData.matrix.coverage }}%）</span>
          </div>
          <div class="permgrp">
            <div v-for="g in mData.matrix.groups" :key="g.domain" class="permgrp__i">
              <span class="permgrp__n">{{ g.domainName }}</span>
              <span class="permgrp__v">{{ grantedOf(g) }} / {{ totalOf(g) }}</span>
              <el-progress class="permgrp__bar" :percentage="pctOf(g)" :stroke-width="6" :show-text="false" />
            </div>
          </div>
        </div>

        <div class="rel">
          <span class="rel__note">
            权限改在角色上：调整「{{ mData.role?.name || '未分配' }}」即同步影响全部 {{ mData.role?.userCount || 0 }} 名同岗位成员；
            员工不单独立例外，避免出现「说不清谁给了他这个权限」。
          </span>
        </div>
      </template>
      <template #footer>
        <el-button @click="mVisible = false">关闭</el-button>
        <el-button @click="jump('/c/payroll', 'emp:' + (mData?.member?.empId || ''))">工资表</el-button>
        <el-button type="primary" @click="openRoleChange">调整角色</el-button>
      </template>
    </DetailDrawer>

    <!-- B 级补齐：调整成员角色（纯 RBAC，改角色即改权限与数据范围） -->
    <el-dialog v-model="roleChangeVisible" title="调整成员角色" width="520">
      <el-form label-width="96px">
        <el-form-item label="成员">
          <span>{{ rcEmp?.name }}</span>
          <span class="muted" style="margin-left:8px;font-size:12px;">{{ rcEmp?.empNo }} · {{ rcEmp?.position }}</span>
        </el-form-item>
        <el-form-item label="当前角色">
          <el-tag effect="plain">{{ rcEmp?.roleName }}</el-tag>
          <span class="muted" style="margin-left:8px;font-size:12px;">
            {{ rcEmp?.dataScope }} · {{ rcEmp?.permCount }} 个权限位
          </span>
        </el-form-item>
        <el-form-item label="调整为">
          <el-select v-model="rcRoleId" filterable style="width:100%" placeholder="选择新角色">
            <el-option
              v-for="r in allRoles" :key="r.roleId"
              :label="`${r.name}（${r.dataScope} · ${r.permCount} 项）`" :value="r.roleId"
            />
          </el-select>
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon
          title="纯 RBAC：改角色即改权限与数据范围，对该成员立即生效（原型为内存态，刷新还原）。" />
      </el-form>
      <template #footer>
        <el-button @click="roleChangeVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRoleChange">确认调整</el-button>
      </template>
    </el-dialog>

    <!-- 角色抽屉 -->
    <DetailDrawer
      v-model="rVisible" :loading="rLoading"
      :title="rData ? `${rData.role.name} · ${rData.role.roleId}` : ''"
      :subtitle="rData ? `${rData.role.scope}级 · ${rData.role.userCount} 人 · ${rData.role.permCount} 个权限位` : ''"
      :status="rData?.role?.dataScope" status-domain="employee"
    >
      <template v-if="rData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">适用层级</div><div class="dstat__v">{{ rData.role.scope }}<span class="unit">级</span></div></div>
          <div class="dstat"><div class="dstat__k">已授权</div><div class="dstat__v">{{ rData.role.permCount }}<span class="unit">/ {{ rData.matrix.total }}</span></div></div>
          <div class="dstat"><div class="dstat__k">覆盖度</div><div class="dstat__v">{{ rData.matrix.coverage }}<span class="unit">%</span></div></div>
          <div class="dstat"><div class="dstat__k">影响人数</div><div class="dstat__v">{{ rData.role.userCount }}<span class="unit">人</span></div></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>可见数据范围</h4><span class="desc">项目级五档</span></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">数据范围</span><span class="dl__v">{{ rData.role.dataScope }}</span></div>
          <div class="dl__i"><span class="dl__k">可见项目</span><span class="dl__v">{{ rData.visible }}</span></div>
          <div class="dl__i"><span class="dl__k">对应岗位</span><span class="dl__v">{{ rData.role.positions.join('、') || '—' }}</span></div>
          <div class="dl__i"><span class="dl__k">角色说明</span><span class="dl__v">{{ rData.role.desc }}</span></div>
        </div>

        <div style="margin-top:18px;">
          <div class="sec__hd">
            <h4>权限矩阵</h4><span class="desc">域 → 功能 → 查看 / 操作</span>
            <span class="spacer" />
            <el-tag v-if="rolePermsDirty(rData.role.roleId)" size="small" type="warning" effect="plain">本会话已修改</el-tag>
            <template v-if="editing">
              <el-button size="small" @click="selectAll(true)">全选</el-button>
              <el-button size="small" @click="selectAll(false)">清空</el-button>
              <span class="muted" style="font-size:12.5px;">已选 {{ grantedCount }} / {{ totalPerms }}</span>
            </template>
          </div>
          <div v-for="g in rData.matrix.groups" :key="g.domain" class="permgrp">
            <div class="permgrp__hd">
              {{ g.domainName }}
              <el-checkbox
                v-if="editing" size="small" style="margin-left:10px;"
                :model-value="domainAllOn(g)" @change="v => toggleDomain(g, v)"
              >本域全选</el-checkbox>
            </div>
            <div v-for="f in g.funcs" :key="f.func" class="permfunc">
              <span class="permfunc__n">{{ f.funcName }}</span>
              <span class="permfunc__ops">
                <template v-for="o in f.ops" :key="o.code">
                  <el-checkbox v-if="editing" v-model="editMap[o.code]" size="small">{{ o.opName }}</el-checkbox>
                  <el-tag v-else size="small" effect="plain"
                    :type="o.on ? 'success' : 'info'" :class="{ 'is-off': !o.on }">{{ o.opName }}</el-tag>
                </template>
              </span>
            </div>
          </div>
        </div>

        <div v-if="rData.members.length" style="margin-top:18px;">
          <div class="sec__hd"><h4>成员样本</h4><span class="desc">共 {{ rData.role.userCount }} 人，列前 6</span></div>
          <el-table :data="rData.members" size="small" max-height="180">
            <el-table-column prop="name" label="姓名" width="80" />
            <el-table-column prop="position" label="岗位" width="90" />
            <el-table-column prop="orgName" label="所属组织" min-width="120" show-overflow-tooltip />
          </el-table>
        </div>

        <div class="rel">
          <span class="rel__note">
            {{ rData.role.dataScope === '仅本人'
              ? '仅本人：只能看到自己产生的数据（工单处理人 = 自己、巡检任务执行人 = 自己）。'
              : rData.role.dataScope === '本部门'
                ? '本部门：范围收在本班组 / 本部门，跨部门数据不可见。'
                : rData.role.dataScope === '指定项目'
                  ? '指定项目：白名单制，只开放勾选的项目，新增项目不会自动进入。'
                  : rData.role.dataScope === '全部项目'
                    ? '全部项目：集团口径，新增项目自动纳入，慎用于含业主隐私的域。'
                    : '本项目：随任职项目变化，调岗即自动切换，无需改权限。' }}
            原型不做写操作持久化，修改仅本地生效、刷新还原。
          </span>
        </div>
      </template>
      <template #footer>
        <el-button @click="rVisible = false">关闭</el-button>
        <el-button v-if="!editing" @click="viewMembers(rData?.role?.roleId)">查看成员</el-button>
        <template v-if="editing">
          <el-button @click="cancelEdit">取消</el-button>
          <el-button type="primary" @click="savePerms">保存（{{ grantedCount }} 项）</el-button>
        </template>
        <el-button v-else type="primary" @click="startEdit">编辑权限</el-button>
      </template>
    </DetailDrawer>

    <!-- E1：新增成员 -->
    <el-dialog v-model="empVisible" title="新增成员" width="560">
      <el-form ref="empRef" :model="empForm" :rules="empRules" label-width="88px">
        <el-form-item label="姓名" prop="name">
          <el-input v-model="empForm.name" placeholder="请输入姓名" style="width:200px" />
        </el-form-item>
        <el-form-item label="所属组织" prop="orgId">
          <el-select v-model="empForm.orgId" filterable style="width:280px">
            <el-option v-for="o in orgOptions()" :key="o.orgId" :label="o.label" :value="o.orgId" />
          </el-select>
        </el-form-item>
        <el-form-item label="岗位" prop="position">
          <el-select v-model="empForm.position" filterable allow-create style="width:200px">
            <el-option v-for="t in posOpts" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="empForm.phone" placeholder="11 位手机号" style="width:200px" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="empForm.email" placeholder="选填" style="width:240px" />
        </el-form-item>
        <el-form-item label="入职日期">
          <el-date-picker v-model="empForm.hireDate" type="date" value-format="YYYY-MM-DD" style="width:200px" />
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="empForm.status">
            <el-radio v-for="t in ['在职', '试用', '待入职']" :key="t" :value="t">{{ t }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="empVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEmp">保存</el-button>
      </template>
    </el-dialog>

    <!-- E1：新增角色 -->
    <el-dialog v-model="roleVisible" title="新增角色" width="600">
      <el-form ref="roleRef" :model="roleForm" :rules="roleRules" label-width="88px">
        <el-form-item label="角色名称" prop="name">
          <el-input v-model="roleForm.name" placeholder="如 项目财务主管" style="width:240px" />
        </el-form-item>
        <el-form-item label="适用范围" prop="scope">
          <el-radio-group v-model="roleForm.scope">
            <el-radio v-for="t in ['集团级', '项目级']" :key="t" :value="t">{{ t }}</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="数据范围" prop="dataScope">
          <el-select v-model="roleForm.dataScope" style="width:200px">
            <el-option v-for="t in dataScopeOptsOf()" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="权限位">
          <el-select v-model="roleForm.perms" multiple collapse-tags filterable style="width:100%" placeholder="可留空，建后再在权限矩阵里勾选">
            <el-option v-for="p in permOptions" :key="p.code" :label="p.label" :value="p.code" />
          </el-select>
          <div class="muted" style="font-size:12px;margin-top:4px;">已选 {{ roleForm.perms.length }} / {{ permOptions.length }} 个权限位</div>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="roleForm.desc" type="textarea" :rows="2" placeholder="该角色的职责边界" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRole">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { currentRoleId, rolePermsDirty, saveRolePerms } from '@/utils/auth'
import {
  PAGE_SIZES, createEmployee, createRole, dataScopeOpts, dataScopeOptsOf, dataScopeTree,
  empStatusOpts, filterRoles, getMemberDetail, getRoleDetail, orgOptions, orgSummary, orgTree,
  orgVirtualNodes, orgTypeOpts, permCodeOpts, positionOpts, queryOrgMembers, roleOpts, roleRows,
  roleTree, syncRolePermsRow, updateEmployeeRole,
  roleVirtualNodes, scopeVirtualNodes
} from '@/utils/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { pathOf, useFocusLanding } from '@/composables/useFocus'
import SpaceTree from '@/components/SpaceTree.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { maskPhone, money } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()

const BLANK = { orgId: '', vf: '', roleId: '', status: '', empType: '', dataScope: '', kw: '' }
const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryOrgMembers, { immediate: false, filters: { ...BLANK } }
)

const summary = orgSummary()
const roleOptsData = roleOpts()
const statusOpts = empStatusOpts()
const scopeOptsData = dataScopeOpts()
const allRoles = ref(roleRows())   // E1：新增角色后需刷新，故用 ref

const MEMBER_TREE = orgTree()
const ROLE_TREE = roleTree()
const SCOPE_TREE = dataScopeTree()
const MEMBER_VN = orgVirtualNodes()
const ROLE_VN = roleVirtualNodes()
const SCOPE_VN = scopeVirtualNodes()

const tab = ref('member')
const treeCollapsed = ref(false)
const activeId = ref('')
const activeChain = ref([])
const activeVn = ref('')
const scopePath = ref([])
const highlightId = ref('')

const roleFilter = reactive({ scope: '', roleId: '', vf: '', kw: '' })
const scopeFilter = reactive({ dataScope: '', roleId: '', vf: '' })

const curTree = computed(() => tab.value === 'member' ? MEMBER_TREE : tab.value === 'role' ? ROLE_TREE : SCOPE_TREE)
const curVnodes = computed(() => tab.value === 'member' ? MEMBER_VN : tab.value === 'role' ? ROLE_VN : SCOPE_VN)
const vnLabel = computed(() => curVnodes.value.find(v => v.key === activeVn.value)?.label || '')

const treeTitle = computed(() => tab.value === 'member' ? '组织范围' : tab.value === 'role' ? '角色范围' : '数据范围')
const treeSubTitle = computed(() => tab.value === 'member' ? '集团 / 项目 / 部门 / 班组'
  : tab.value === 'role' ? '适用层级 → 角色' : '五档 → 角色')
const treePlaceholder = computed(() => tab.value === 'member' ? '搜组织 / 班组' : '搜角色 / 范围')
const emptyScopeText = computed(() => tab.value === 'member' ? '全部成员' : '全部角色')
const scopeHint = computed(() => tab.value === 'member' ? '树定组织 · 筛选定属性'
  : tab.value === 'role' ? '点角色看权限矩阵' : '点范围看谁能看到什么')
const tabHint = computed(() => tab.value === 'member'
  ? `按组织查人（${summary.total} 人）`
  : tab.value === 'role'
    ? `按角色查权限（${summary.roleCount} 个角色 / ${summary.permCount} 个权限位）`
    : '按数据范围查可见性——同一张表，不同角色看到的行不同')

/** Tab2 / Tab3 不需要分页，直接本地过滤；roleVersion 用于新增角色后强制重算（ROLE_ROWS 是模块级数组，不自带响应） */
const roleVersion = ref(0)
const roleRowsData = computed(() => { void roleVersion.value; return filterRoles({ ...roleFilter }) })
const scopeRowsData = computed(() => { void roleVersion.value; return filterRoles({ ...scopeFilter }).map(r => ({
  ...r,
  visibleText: r.dataScope === '指定项目' ? r.communityNames.join('、')
    : r.dataScope === '全部项目' ? `全部 ${r.communityNames.length || 3} 个项目`
      : r.dataScope === '本项目' ? '任职所在项目'
        : r.dataScope === '本部门' ? '本班组 / 本部门'
          : '仅本人产生的数据',
  scopeMemo: r.dataScope === '全部项目' ? '新增项目自动纳入，慎用于含业主隐私的域'
    : r.dataScope === '指定项目' ? '白名单制，新增项目不会自动进入'
      : r.dataScope === '本项目' ? '随任职项目变化，无需单独改权限'
        : r.dataScope === '本部门' ? '跨部门数据不可见'
          : '工单/巡检按处理人过滤'
})) })
const totalText = computed(() => tab.value === 'member'
  ? `共 ${total.value} 名成员`
  : `共 ${(tab.value === 'role' ? roleRowsData.value : scopeRowsData.value).length} 个角色`)

const { data: mData, visible: mVisible, loading: mLoading, open: openMember } = useDetail(getMemberDetail)

/* B 级补齐：调整角色（覆盖表优先于岗位反推；改完刷新成员列表与角色人数） */
const roleChangeVisible = ref(false)
const rcEmp = ref(null)
const rcRoleId = ref('')
function openRoleChange() {
  const m = mData.value?.member
  if (!m) return
  rcEmp.value = m
  rcRoleId.value = ''
  roleChangeVisible.value = true
}
function saveRoleChange() {
  if (!rcRoleId.value) { ElMessage.warning('请选择新角色'); return }
  try {
    const r = updateEmployeeRole(rcEmp.value.empId, rcRoleId.value)
    ElMessage.success(`已将「${r.name}」从「${r.from}」调整为「${r.roleName}」（${r.dataScope} · ${r.permCount} 项）`)
    roleChangeVisible.value = false
    allRoles.value = roleRows()
    roleVersion.value++
    search()
    openMember(rcEmp.value.empId)
  } catch (e) { ElMessage.error(e?.message || '调整失败') }
}
const { data: rData, visible: rVisible, loading: rLoading, open: openRole } = useDetail(getRoleDetail)

function scopeTagType(ds) {
  return ({ 全部项目: 'danger', 指定项目: 'warning', 本项目: 'primary', 本部门: 'info', 仅本人: 'muted' })[ds] || 'info'
}
function grantedOf(g) { return g.funcs.reduce((s, f) => s + f.ops.filter(o => o.on).length, 0) }
function totalOf(g) { return g.funcs.reduce((s, f) => s + f.ops.length, 0) }
function pctOf(g) { const t = totalOf(g); return t ? Math.round((grantedOf(g) / t) * 100) : 0 }

function onTab() {
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  highlightId.value = ''
  Object.assign(roleFilter, { scope: '', roleId: '', vf: '', kw: '' })
  Object.assign(scopeFilter, { dataScope: '', roleId: '', vf: '' })
  Object.assign(query, { ...BLANK })
  if (tab.value === 'member') search()
}

function onPick(node) {
  if (node.kind === 'virtual') {
    activeId.value = ''
    activeChain.value = []
    // 「全部」是回到全量的入口，不该在范围条上挂一个「全部成员」的帽子
    activeVn.value = node.key === 'all' ? '' : node.key
    scopePath.value = []
  } else {
    activeId.value = node.id
    activeChain.value = node.chain || [node.id]
    activeVn.value = ''
    scopePath.value = node.path || []
  }
  if (tab.value === 'member') {
    Object.assign(query, BLANK)
    Object.assign(query, node.patch || {})
    search()
  } else if (tab.value === 'role') {
    Object.assign(roleFilter, { scope: '', roleId: '', vf: '', kw: '' })
    Object.assign(roleFilter, node.patch || {})
    // 点角色叶子直接开权限矩阵，省一次点击
    if (node.patch?.roleId) openRole(node.patch.roleId)
  } else {
    Object.assign(scopeFilter, { dataScope: '', roleId: '', vf: '' })
    Object.assign(scopeFilter, node.patch || {})
    if (node.patch?.roleId) openRole(node.patch.roleId)
  }
}

function onCrumb(index) {
  if (index >= activeChain.value.length - 1) return
  const id = activeChain.value[index]
  const node = flatNode(id)
  if (!node) return
  activeId.value = id
  activeChain.value = activeChain.value.slice(0, index + 1)
  scopePath.value = scopePath.value.slice(0, index + 1)
  activeVn.value = ''
  if (tab.value === 'member') {
    Object.assign(query, BLANK)
    Object.assign(query, node.patch || {})
    search()
  } else if (tab.value === 'role') {
    Object.assign(roleFilter, { scope: '', roleId: '', vf: '', kw: '' })
    Object.assign(roleFilter, node.patch || {})
  } else {
    Object.assign(scopeFilter, { dataScope: '', roleId: '', vf: '' })
    Object.assign(scopeFilter, node.patch || {})
  }
}

function clearScope() {
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  if (tab.value === 'member') { Object.assign(query, { ...BLANK }); search() }
  else if (tab.value === 'role') Object.assign(roleFilter, { scope: '', roleId: '', vf: '', kw: '' })
  else Object.assign(scopeFilter, { dataScope: '', roleId: '', vf: '' })
}
function reset() {
  Object.assign(query, { ...BLANK })
  activeId.value = ''
  activeChain.value = []
  activeVn.value = ''
  scopePath.value = []
  search()
}
function resetRole() { Object.assign(roleFilter, { scope: '', roleId: '', vf: '', kw: '' }) }
function resetScope() { Object.assign(scopeFilter, { dataScope: '', roleId: '', vf: '' }) }

function onRow(row) { highlightId.value = row.empId; openMember(row.empId) }
function onRoleRow(row) { highlightId.value = row.roleId; openRole(row.roleId) }
function rowClass({ row }) {
  const id = tab.value === 'member' ? row.empId : row.roleId
  return id === highlightId.value ? 'row--focus' : ''
}
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }

/* ---------- E1 新增成员 / 新增角色（内存态） ---------- */
const empVisible = ref(false)
const empRef = ref(null)
const empForm = ref({ name: '', orgId: '', position: '', phone: '', email: '', hireDate: '', status: '在职' })
const empRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  orgId: [{ required: true, message: '请选择所属组织', trigger: 'change' }],
  position: [{ required: true, message: '请选择岗位', trigger: 'change' }],
  phone: [{ pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确，应为 11 位', trigger: 'blur' }]
}
const posOpts = positionOpts()
function openEmp() {
  empForm.value = { name: '', orgId: '', position: '', phone: '', email: '', hireDate: '', status: '在职' }
  empVisible.value = true
}
async function saveEmp() {
  try {
    await empRef.value.validate()
    const r = createEmployee({ ...empForm.value })
    ElMessage.success(`已新增成员「${r.name}」（${r.position}）`)
    empVisible.value = false
    search()
  } catch (e) { if (e?.message) ElMessage.error(e.message) }
}

const roleVisible = ref(false)
const roleRef = ref(null)
const permOptions = permCodeOpts()
const roleForm = ref({ name: '', scope: '项目级', dataScope: '本项目', perms: [], desc: '' })
const roleRules = {
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  scope: [{ required: true, message: '请选择适用范围', trigger: 'change' }],
  dataScope: [{ required: true, message: '请选择数据范围', trigger: 'change' }]
}
function openRoleCreate() {
  roleForm.value = { name: '', scope: '项目级', dataScope: '本项目', perms: [], desc: '' }
  roleVisible.value = true
}
async function saveRole() {
  try {
    await roleRef.value.validate()
    const r = createRole({ ...roleForm.value })
    ElMessage.success(`已新增角色「${r.name}」，${r.permCount} 个权限位`)
    roleVisible.value = false
    allRoles.value = roleRows()
    roleVersion.value++
    summary.value = orgSummary()
  } catch (e) { if (e?.message) ElMessage.error(e.message) }
}

/* ---------- E2 角色权限矩阵：可编辑并保存（保存后菜单与页面守卫立即生效） ---------- */
const editing = ref(false)
const editMap = reactive({})
const grantedCount = computed(() => Object.values(editMap).filter(Boolean).length)
const totalPerms = computed(() => Object.keys(editMap).length)

function startEdit() {
  const m = {}
  for (const g of (rData.value?.matrix?.groups || [])) {
    for (const f of g.funcs) for (const o of f.ops) m[o.code] = !!o.on
  }
  Object.keys(editMap).forEach(k => delete editMap[k])
  Object.assign(editMap, m)
  editing.value = true
}
function cancelEdit() { editing.value = false }
function selectAll(v) { for (const k of Object.keys(editMap)) editMap[k] = v }
function domainAllOn(g) { return g.funcs.every(f => f.ops.every(o => editMap[o.code])) }
function toggleDomain(g, v) {
  for (const f of g.funcs) for (const o of f.ops) editMap[o.code] = v
}
async function savePerms() {
  const roleId = rData.value?.role?.roleId
  if (!roleId) return
  const codes = Object.keys(editMap).filter(k => editMap[k])
  // 改自己正在用的角色会立刻收紧菜单，先确认一次，避免把自己锁在门外
  if (roleId === currentRoleId.value) {
    try {
      await ElMessageBox.confirm(
        `「${rData.value.role.name}」是你当前登录的身份。保存后菜单与可访问页面会立即按新权限收紧，可能连本页都进不去（原型为内存态，刷新即还原）。`,
        '正在修改当前登录角色', { confirmButtonText: '确认保存', cancelButtonText: '再想想', type: 'warning' }
      )
    } catch { return }
  }
  saveRolePerms(roleId, codes)
  syncRolePermsRow(roleId)
  roleVersion.value++
  editing.value = false
  ElMessage.success(
    `已保存「${rData.value.role.name}」${codes.length} 个权限位：菜单与页面访问立即生效（原型阶段为内存态，刷新还原）`
  )
  await openRole(roleId)
}

/* 导出：按当前 Tab 提交任务，文件在下载中心生成与下载 */
const COL_MEMBER = [
  { prop: 'empId', label: '工号' }, { prop: 'name', label: '姓名' },
  { prop: 'position', label: '岗位' }, { prop: 'orgName', label: '所属组织' },
  { prop: 'roleName', label: '角色' }, { prop: 'empType', label: '用工类型' },
  { prop: 'status', label: '状态' }, { prop: 'phone', label: '手机号' }
]
const COL_ROLE = [
  { prop: 'roleId', label: '角色编号' }, { prop: 'name', label: '角色名称' },
  { prop: 'scope', label: '适用层级' }, { prop: 'dataScope', label: '数据范围' },
  { prop: 'permCount', label: '权限位数' }, { prop: 'userCount', label: '成员数' },
  { prop: 'desc', label: '说明' }
]
const COL_SCOPE = [
  { prop: 'roleId', label: '角色编号' }, { prop: 'name', label: '角色名称' },
  { prop: 'dataScope', label: '数据范围' }, { prop: 'visibleText', label: '可见范围' },
  { prop: 'scopeMemo', label: '口径说明' }
]
const exportRows = computed(() =>
  tab.value === 'member' ? rows.value
    : tab.value === 'role' ? roleRowsData.value
      : scopeRowsData.value)
function onExport() {
  const meta = {
    member: { name: '组织成员', cols: COL_MEMBER },
    role: { name: '角色权限清单', cols: COL_ROLE },
    scope: { name: '数据范围清单', cols: COL_SCOPE }
  }[tab.value]
  exportList({
    name: meta.name, source: '/e/org', columns: meta.cols,
    rows: exportRows.value, filters: { tab: tab.value }
  })
}
function viewMembers(roleId) {
  if (!roleId) return
  tab.value = 'member'
  onTab()
  Object.assign(query, { ...BLANK, roleId })
  search()
  ElMessage.success(`已切到「成员」，按角色 ${allRoles.find(r => r.roleId === roleId)?.name || roleId} 过滤`)
}

/** 三棵树共用一份扁平索引，面包屑回退要能取到节点 */
function flatNode(id) {
  for (const t of [MEMBER_TREE, ROLE_TREE, SCOPE_TREE]) {
    let hit = null
    const walk = list => list.forEach(n => {
      if (hit) return
      if (n.id === id) { hit = n; return }
      if (n.children?.length) walk(n.children)
    })
    walk(t)
    if (hit) return hit
  }
  return null
}

/* ---------- 跨页锚点：emp:EM0001 落到成员，role:R-PM 落到角色权限 ---------- */
useFocusLanding(async ({ focus, open }) => {
  highlightId.value = ''
  if (focus?.type === 'role') {
    tab.value = 'role'
    onTab()
    highlightId.value = focus.id
    if (open) openRole(focus.id)
    return
  }
  if (focus?.type === 'emp') {
    tab.value = 'member'
    onTab()
    if (open) openMember(focus.id)
    return
  }
  if (tab.value === 'member') search()
})

// orgTypeOpts 供组织类型筛选备用（当前由树承担层级，保留取数口径避免误删）
void orgTypeOpts
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.tabsbar { display: flex; align-items: center; gap: 8px; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--biz-border); }
.tabsbar__hint { font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; }
.is-warn { color: var(--biz-danger); }
.permgrp { margin-top: 8px; border: 1px solid var(--biz-border); border-radius: 6px; overflow: hidden; }
.permgrp__hd { padding: 5px 10px; font-size: 12px; font-weight: 600; color: var(--biz-text-1); background: var(--biz-bg-hover); }
.permgrp__i { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--biz-border); }
.permgrp__i:last-child { border-bottom: 0; }
.permgrp__n { font-size: 12px; color: var(--biz-text-2); width: 120px; flex: none; }
.permgrp__v { font-size: 11.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); width: 48px; flex: none; }
.permgrp__bar { flex: 1; }
.permfunc { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-top: 1px solid var(--biz-border); }
.permgrp__hd + .permfunc { border-top: 0; }
.permfunc__n { font-size: 12px; color: var(--biz-text-2); width: 104px; flex: none; }
.permfunc__ops { display: flex; gap: 4px; flex-wrap: wrap; }
.permfunc__ops :deep(.el-tag.is-off) { opacity: .45; }
</style>
