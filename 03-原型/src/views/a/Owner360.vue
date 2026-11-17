<template>
  <div class="page">
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
            <!-- 标签存的是 tagId：词条改名后这里自动跟着变，页面不存名称 -->
            <span v-for="t in ownerTagList" :key="t.tagId" class="otag" :style="chipStyle(t.color)"
              :title="`${t.category} · ${t.desc || '无说明'}`">
              {{ t.name }}
              <el-icon v-if="canTag" class="otag__x" @click.stop="removeTag(t)"><Close /></el-icon>
            </span>
            <el-popover v-if="canTag" placement="bottom-start" :width="360" trigger="click" v-model:visible="tagPop">
              <template #reference>
                <el-button link type="primary" size="small" :icon="'Plus'">标签</el-button>
              </template>
              <div class="picker">
                <div v-for="g in tagPicker" :key="g.category" class="picker__g">
                  <div class="picker__hd">{{ g.category }}</div>
                  <div class="picker__bd">
                    <span v-for="t in g.tags" :key="t.tagId" class="otag is-pick" :style="chipStyle(t.color)"
                      :class="{ 'is-disabled': t.taken }" :title="t.taken ? '已经打过了' : t.desc"
                      @click="addTag(t)">
                      {{ t.name }}<span v-if="t.taken" class="otag__tick">✓</span>
                    </span>
                  </div>
                </div>
                <div class="picker__ft muted">
                  只能选系统内置的启用词条；要加新词条去
                  <router-link to="/a/owner-tags">业主标签</router-link>（需 e.ownerTags.edit）
                </div>
              </div>
            </el-popover>
            <span v-if="owner.remark" class="muted" style="font-size:12px;">备注：{{ owner.remark }}</span>
          </div>
        </div>
        <div class="ohead__act">
          <el-select v-model="ownerId" filterable style="width:180px;" placeholder="切换业主">
            <el-option v-for="o in demoOwners" :key="o.ownerId" :label="`${o.name} ${o.phone}`" :value="o.ownerId" />
          </el-select>
          <el-popover placement="bottom-end" :width="420" trigger="click" popper-class="bl-pop">
            <template #reference><button class="bl-ibtn" title="这页怎么用">ⓘ</button></template>
            <div class="bl-tip">
              <b>以「业主」而非「房屋」为中心组织。</b>一人多房是本项目的一等公民——头部按业主聚合欠费，
              账单表可按房切换，收银台与催缴从本页直接进入。
            </div>
          </el-popover>
          <el-button :icon="'EditPen'">编辑档案</el-button>
          <el-button :icon="'ChatDotRound'">发通知</el-button>
          <el-button v-if="canCashier" type="primary" :icon="'Money'">去收银台</el-button>
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

        <el-tab-pane label="客户画像" name="profile">
          <div class="sec__hd" style="margin-bottom:12px;">
            <h4>画像信息</h4>
            <span class="desc">
              对齐《客户画像细分表模板》25 列：经济状况 / 政治面貌 / 负面信息为敏感项，默认打码，看明文要权限且留痕
            </span>
            <span class="spacer" />
            <el-button type="primary" :icon="'EditPen'" size="small" @click="openProfile">编辑画像</el-button>
          </div>

          <div class="dl dl--2">
            <div class="dl__i"><span class="dl__k">业主分类</span><span class="dl__v">{{ owner.ownerCategory || '—' }}</span></div>
            <div class="dl__i"><span class="dl__k">结婚纪念日</span><span class="dl__v">{{ owner.weddingDate || '—' }}</span></div>
            <div class="dl__i"><span class="dl__k">单位名称</span><span class="dl__v">{{ owner.employer || '—' }}</span></div>
            <div class="dl__i"><span class="dl__k">职务 / 职业</span><span class="dl__v">{{ owner.jobTitle || '—' }} / {{ owner.occupation || '—' }}</span></div>
            <div class="dl__i is-full"><span class="dl__k">工作地址</span><span class="dl__v">{{ owner.workAddress || '—' }}</span></div>
            <div class="dl__i"><span class="dl__k">兴趣爱好</span><span class="dl__v">{{ owner.hobbies || '—' }}</span></div>
            <div class="dl__i"><span class="dl__k">宠物信息</span><span class="dl__v">{{ owner.pets || '—' }}</span></div>
            <div class="dl__i"><span class="dl__k">家庭经济状况</span><span class="dl__v">
              <SensitiveText :value="owner.economicLevel" field="economicLevel" entity-type="业主"
                :entity-id="owner.ownerId" :entity-name="owner.name" source="/a/owner360" />
            </span></div>
            <div class="dl__i"><span class="dl__k">政治面貌</span><span class="dl__v">
              <SensitiveText :value="owner.politicalStatus" field="politicalStatus" entity-type="业主"
                :entity-id="owner.ownerId" :entity-name="owner.name" source="/a/owner360" />
            </span></div>
          </div>

          <div class="sec__hd" style="margin:18px 0 8px;">
            <h4>评价</h4>
            <span class="desc">负面信息写进来就要能被申诉，所以只给有权限的人看</span>
          </div>
          <div class="dl">
            <div class="dl__i is-full"><span class="dl__k">正面信息</span><span class="dl__v">{{ owner.positiveNotes || '—' }}</span></div>
            <div class="dl__i is-full"><span class="dl__k">负面信息</span><span class="dl__v">
              <SensitiveText :value="owner.negativeNotes" field="negativeNotes" entity-type="业主"
                :entity-id="owner.ownerId" :entity-name="owner.name" source="/a/owner360" />
            </span></div>
          </div>

          <div class="sec__hd" style="margin:18px 0 8px;">
            <h4>房屋级：交付与装修</h4>
            <span class="desc">违规装修挂在房屋上，不挂在人身上——房子卖了，这个标记不该跟着人走</span>
          </div>
          <el-table :data="p.houses" size="small">
            <el-table-column prop="fullName" label="房屋" min-width="170" />
            <el-table-column prop="deliverDate" label="交房日期" width="110" />
            <el-table-column prop="checkinDate" label="乔迁日期" width="110" />
            <el-table-column prop="useStatus" label="入住状态" width="90" />
            <el-table-column label="违规装修" width="100">
              <template #default="{ row }">
                <span class="tag" :class="row.decorationViolation === '无' ? 'tag--muted' : 'tag--warning'">
                  {{ row.decorationViolation || '无' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="处理结果" min-width="210" show-overflow-tooltip>
              <template #default="{ row }">{{ row.decorationResult || '—' }}</template>
            </el-table-column>
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

    <!-- 编辑画像：一条一条走 updateOwnerField（每改一格就写一次，失败只回滚那一格） -->
    <el-dialog v-model="pVisible" title="编辑客户画像" width="640">
      <el-form label-width="104px">
        <div class="sec__hd" style="margin-bottom:8px;"><h4>居住与分类</h4></div>
        <el-form-item label="业主分类">
          <el-radio-group v-model="pForm.ownerCategory">
            <el-radio-button v-for="c in OWNER_CATEGORY" :key="c" :value="c">{{ c }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="结婚纪念日">
          <el-date-picker v-model="pForm.weddingDate" type="date" value-format="YYYY-MM-DD"
            placeholder="未登记就留空" style="width:200px" />
        </el-form-item>

        <div class="sec__hd" style="margin:14px 0 8px;"><h4>职业与经济</h4></div>
        <el-form-item label="单位名称"><el-input v-model="pForm.employer" maxlength="40" style="width:320px" /></el-form-item>
        <el-form-item label="职务 / 职业">
          <el-input v-model="pForm.jobTitle" maxlength="20" placeholder="职务" style="width:150px" />
          <el-input v-model="pForm.occupation" maxlength="20" placeholder="职业" style="width:150px;margin-left:8px" />
        </el-form-item>
        <el-form-item label="工作地址"><el-input v-model="pForm.workAddress" maxlength="60" style="width:420px" /></el-form-item>
        <el-form-item label="家庭经济状况">
          <el-select v-model="pForm.economicLevel" clearable style="width:160px" placeholder="未填写">
            <el-option v-for="v in ECON_LEVELS" :key="v" :label="v" :value="v" />
          </el-select>
          <span class="muted" style="margin-left:8px;font-size:12px;">敏感项 · 只有持 a.sensitive.view 的角色能看到明文</span>
        </el-form-item>

        <div class="sec__hd" style="margin:14px 0 8px;"><h4>偏好与评价</h4></div>
        <el-form-item label="兴趣爱好"><el-input v-model="pForm.hobbies" maxlength="60" placeholder="顿号分隔，如：书法、钓鱼" style="width:420px" /></el-form-item>
        <el-form-item label="宠物信息"><el-input v-model="pForm.pets" maxlength="40" style="width:320px" /></el-form-item>
        <el-form-item label="政治面貌">
          <el-select v-model="pForm.politicalStatus" clearable style="width:160px" placeholder="未填写">
            <el-option v-for="v in POLITICAL_STATUS" :key="v" :label="v" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item label="正面信息">
          <el-input v-model="pForm.positiveNotes" type="textarea" :rows="2" maxlength="120" show-word-limit />
        </el-form-item>
        <el-form-item label="负面信息">
          <el-input v-model="pForm.negativeNotes" type="textarea" :rows="2" maxlength="120" show-word-limit
            placeholder="写进来就要能被申诉：只记事实，不写评价" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pVisible = false">取消</el-button>
        <el-button type="primary" :loading="pSaving" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
const canCashier = computed(() => canVisit('/b/cashier'))
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  demoOwnerList, memberRows, memberSummary, ownerProfile, paymentsOfOwner,
  removeMember, saveMember, setMemberAccess, tenantOfHouse, tenantsOfHouses,
  MEMBER_ACCESS, MEMBER_RELATIONS,
  /* 客户画像：枚举取自数据层，页面不再自己写一份，改枚举只改一处 */
  OWNER_CATEGORY, ECON_LEVELS, POLITICAL_STATUS, updateOwnerField,
  OWNER_TAG_CATEGORIES, ownerTagsOf
} from '@/utils/api'
import { addOwnerTag, queryOwnerTags, removeOwnerTag } from '@/api'
import { canVisit, hasPerm } from '@/utils/auth'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { expireText, money } from '@/utils/format'
import SensitiveText from '@/components/SensitiveText.vue'
import { idCardValid } from '@/utils/rules'

// 四个固定演示对象（与数据集剧本一致）
const demoOwners = demoOwnerList(4)
const ownerId = ref('OW00001')
/* 画像字段是内存态直改（不经过响应式数组），改完靠 ver 让它重算 */
const ver = ref(0)

/* —— 标签：打/摘都要 a.owners.edit（楼管有，受责任范围约束）；维护字典是 e 域的事 —— */
const canTag = ref(true)
const tagPop = ref(false)
const TAG_CHIP = {
  red: { bg: '#fdecec', fg: '#c0392b', bd: '#f5c2c2' },
  orange: { bg: '#fdf1e3', fg: '#b96a12', bd: '#f3d3a8' },
  green: { bg: '#e9f7ee', fg: '#227a41', bd: '#bce3c9' },
  blue: { bg: '#eaf1fb', fg: '#2b5f9e', bd: '#c3d7f0' },
  cyan: { bg: '#e6f6f4', fg: '#0b7a70', bd: '#b3e3dd' },
  gray: { bg: '#f1f2f5', fg: '#5b6472', bd: '#dcdfe6' }
}
const chipStyle = c => {
  const k = TAG_CHIP[c] || TAG_CHIP.gray
  return { background: k.bg, color: k.fg, borderColor: k.bd }
}
const ownerTagList = computed(() => { void ver.value; return ownerTagsOf(owner.value) })
/* 选择弹层按分类分组；已打过的置灰但仍可见——否则打过的词条凭空消失，看着像字典不全 */
const tagPicker = computed(() => {
  void ver.value
  const mine = new Set(owner.value?.tagIds || [])
  return OWNER_TAG_CATEGORIES.map(c => ({
    category: c,
    tags: allTags.value.filter(t => t.category === c).map(t => ({ ...t, taken: mine.has(t.tagId) }))
  })).filter(g => g.tags.length)
})
const allTags = ref([])

async function loadTags() {
  try {
    const r = await queryOwnerTags({ enabled: 'true' })
    allTags.value = r.rows
  } catch { allTags.value = [] }
}
async function addTag(t) {
  if (t.taken) { ElMessage.info(`已经有了「${t.name}」`); return }
  try {
    const r = await addOwnerTag(owner.value.ownerId, t.tagId)
    /* 用服务端回的完整 tagIds 覆盖：不自己做加减，避免并发下前后端不一致 */
    owner.value.tagIds = r.tagIds
    ver.value++
    ElMessage.success(`已给「${owner.value.name}」打上「${t.name}」`)
  } catch (e) {
    ElMessage.error(e?.message || '打标签失败')
  }
}
async function removeTag(t) {
  try {
    const r = await removeOwnerTag(owner.value.ownerId, t.tagId)
    owner.value.tagIds = r.tagIds
    ver.value++
    ElMessage.success(`已摘掉「${t.name}」`)
  } catch (e) {
    ElMessage.error(e?.message || '去标签失败')
  }
}
const p = computed(() => { void ver.value; return ownerProfile(ownerId.value) })
const owner = computed(() => p.value.owner)

/* —— 编辑画像：逐字段提交，失败的字段单独提示，不整单回滚 —— */
const PROFILE_FIELDS = ['ownerCategory', 'weddingDate', 'employer', 'jobTitle', 'occupation',
  'workAddress', 'economicLevel', 'politicalStatus', 'hobbies', 'pets', 'positiveNotes', 'negativeNotes']
const pVisible = ref(false)
const pSaving = ref(false)
const pForm = ref({})
function openProfile() {
  const o = owner.value
  pForm.value = Object.fromEntries(PROFILE_FIELDS.map(k => [k, o[k] ?? '']))
  pVisible.value = true
}
async function saveProfile() {
  const before = owner.value
  const changed = PROFILE_FIELDS.filter(k => String(pForm.value[k] ?? '') !== String(before[k] ?? ''))
  if (!changed.length) { pVisible.value = false; ElMessage.info('画像没有变化'); return }
  pSaving.value = true
  let done = 0
  const failed = []
  for (const k of changed) {
    try {
      await Promise.resolve(updateOwnerField(before.ownerId, k, pForm.value[k] ?? ''))
      done++
    } catch (e) { failed.push(`${k}：${e?.message || '保存失败'}`) }
  }
  pSaving.value = false
  ver.value++
  if (failed.length) {
    ElMessage.error(`已保存 ${done} 项，${failed.length} 项失败（${failed.join('；')}）`)
  } else {
    pVisible.value = false
    ElMessage.success(`画像已更新 ${done} 项`)
  }
}

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

/* 标签权限与字典：进页面拉一次即可（字典很小，且与当前业主无关） */
canTag.value = hasPerm('a.owners.edit')
loadTags()

/* 标签权限与字典：进页面拉一次即可（字典很小，且与当前业主无关） */
canTag.value = hasPerm('a.owners.edit')
loadTags()
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
/* 业主标签：颜色由词条决定（字典里的 color），页面不写死 */
.otag {
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 9px; border-radius: 10px;
  font-size: 12px; line-height: 19px; border: 1px solid transparent; cursor: default;
}
.otag__x { font-size: 11px; cursor: pointer; opacity: .55; }
.otag__x:hover { opacity: 1; }
.otag.is-pick { cursor: pointer; }
.otag.is-pick:hover { filter: brightness(.96); }
.otag.is-disabled { opacity: .45; cursor: not-allowed; }
.otag__tick { font-size: 10px; margin-left: 2px; }
.picker__g + .picker__g { margin-top: 10px; }
.picker__hd { font-size: 12px; color: var(--biz-text-3); margin-bottom: 6px; }
.picker__bd { display: flex; flex-wrap: wrap; gap: 6px; }
.picker__ft { font-size: 12px; margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--biz-border-light); }
/* 业主标签：颜色由词条决定（字典里的 color），页面不写死 */
.otag {
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 9px; border-radius: 10px;
  font-size: 12px; line-height: 19px; border: 1px solid transparent; cursor: default;
}
.otag__x { font-size: 11px; cursor: pointer; opacity: .55; }
.otag__x:hover { opacity: 1; }
.otag.is-pick { cursor: pointer; }
.otag.is-pick:hover { filter: brightness(.96); }
.otag.is-disabled { opacity: .45; cursor: not-allowed; }
.otag__tick { font-size: 10px; margin-left: 2px; }
.picker__g + .picker__g { margin-top: 10px; }
.picker__hd { font-size: 12px; color: var(--biz-text-3); margin-bottom: 6px; }
.picker__bd { display: flex; flex-wrap: wrap; gap: 6px; }
.picker__ft { font-size: 12px; margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--biz-border-light); }

/* ===== 新版骨架（详情页） ===== */
.page { padding: 0 24px 24px; }
.panel { background: transparent; border: 0; box-shadow: none; padding: 0; }
.proto-note { display: none; }
.bl-ibtn {
  appearance: none; border: 1px solid var(--biz-border); background: #fff; width: 32px; height: 32px;
  border-radius: 8px; color: var(--biz-text-3); font-size: 15px; cursor: pointer; font-family: inherit;
}
.bl-ibtn:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.bl-tip { font-size: 12.5px; line-height: 1.8; color: var(--biz-text-2); }
.bl-tip b { color: var(--biz-text-1); font-weight: 500; }

/* 概要头独立成一张白面 */
.ohead { background: #fff; border-radius: 14px; padding: 18px 20px; }

/* dstat → KPI 瓦片 */
.grid.g4 .dstat { background: #fff; border-radius: 14px; padding: 13px 16px 11px; }
.dstat__k { font-size: 12px; color: var(--biz-text-3); }
.dstat__v {
  font-size: 26px; font-weight: 600; letter-spacing: -.02em; margin-top: 6px;
  color: var(--biz-text-1); font-variant-numeric: tabular-nums;
}
.dstat__v .unit { font-size: 12px; font-weight: 400; color: var(--biz-text-3); margin-left: 4px; }
.dstat__v.is-warn { color: var(--biz-danger); }

/* 表格：统一 46 行高、无表头底色 */
:deep(.el-table) {
  --el-table-bg-color: transparent; --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: transparent; background: transparent;
}
:deep(.el-table__header th) {
  background: transparent; font-weight: 400; font-size: 12px; color: var(--biz-text-3);
  border-bottom: 1px solid #F0F2F6; height: 40px; padding: 0;
}
:deep(.el-table--small .el-table__cell) { padding: 0; }
:deep(.el-table__row td.el-table__cell) { height: 46px; padding: 0; border-bottom: 1px solid #F6F7FA; font-size: 13px; }
:deep(.el-table__header th.el-table__cell) { padding: 0; }
:deep(.el-table__row:hover > td) { background: #FAFBFD; }
:deep(.el-table__inner-wrapper::before) { display: none; }
/* 状态：圆点 + 文字 */
:deep(.el-tag) { background: transparent !important; border: 0 !important; padding: 0 !important; height: auto !important; font-size: 12.5px; }
:deep(.el-tag)::before { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; margin-right: 6px; vertical-align: 1px; }

/* 区块小标题 */
.sec__hd h4 { font-size: 14px; font-weight: 500; color: var(--biz-text-1); }
.sec__hd .desc { font-size: 12px; color: var(--biz-text-4); }

/* Tabs 区域贴白面 */
.el-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.el-tabs :deep(.el-tabs__item) { font-size: 13.5px; }
</style>
