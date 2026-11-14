<template>
  <div class="page pos-standalone">
    <!-- 独立页顶栏：全屏收银时不显示后台菜单，这里给出项目、收银员与退出入口 -->
    <div class="pos-bar">
      <div class="pos-bar__logo"><span class="dot">收</span>收银台</div>
      <span class="pos-bar__sep" />
      <span class="pos-bar__meta">{{ scopeName }} · 收银员 王芳 · 早班</span>
      <span class="spacer" />
      <span class="pos-bar__time">{{ nowText }}</span>
      <el-button size="small" @click="$router.push('/b/dashboard')">退出收银台</el-button>
    </div>

    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>收银台</b>：左边找人、中间按业务收、右边结账，不换页、不弹窗。
        三类业务的规则不同，所以形态也不同 ——
        <b>物业费能欠</b>（账期格子，红几格就是欠几期）、
        <b>车位费不欠但会失效</b>（到期车牌停月租，只能按周期续）、
        <b>水电按量且按业态计价</b>（预充买量 / 抄表账单 / 国网自缴，由项目配置决定）。
      </div>
    </div>

    <div v-if="p || isWalkin" class="pos">
      <!-- ============ 左：客户 ============ -->
      <div class="panel pos-left">
        <div class="panel__hd">
          <h3>客户</h3>
          <span class="desc">{{ resultList.length }} 位</span>
        </div>
        <div class="pos-left__tools">
          <el-input v-model="kw" clearable size="small" placeholder="房号 / 姓名 / 手机号" :prefix-icon="'Search'" />
          <el-select v-model="bldgId" size="small" clearable placeholder="全部楼栋" style="margin-top:6px;">
            <el-option v-for="b in bldgOpts" :key="b.value" :label="b.label" :value="b.value" />
          </el-select>
          <el-select v-if="bldgId" v-model="unitId" size="small" clearable placeholder="全部单元" style="margin-top:6px;">
            <el-option v-for="u in unitOpts" :key="u.value" :label="u.label" :value="u.value" />
          </el-select>
        </div>
        <div class="olist">
          <!-- 散客常驻入口：摆摊、场地、赔偿这类收款没有业主档案，不能硬挂一户 -->
          <div
            class="oitem oitem--walkin" :class="{ 'is-on': isWalkin }"
            @click="pick(WALKIN)"
          >
            <div class="oitem__ava oitem__ava--walkin">散</div>
            <div class="oitem__b">
              <div class="oitem__n">散客 / 外来人员</div>
              <div class="oitem__d">摆摊、场地、临时事项 · 不挂户</div>
            </div>
          </div>
          <div class="olist__div" />
          <div
            v-for="o in resultList" :key="o.ownerId"
            class="oitem" :class="{ 'is-on': o.ownerId === ownerId }"
            @click="pick(o.ownerId)"
          >
            <div class="oitem__ava">{{ o.name.slice(0, 1) }}</div>
            <div class="oitem__b">
              <div class="oitem__n">{{ o.name }}<span class="oitem__t">{{ o.ownerType }}</span></div>
              <div class="oitem__d">{{ roomOfScope(o) || cashierOwnerRoom(o.ownerId) || (o.houseIds.length + ' 套房') }}</div>
            </div>
            <div class="oitem__r">
              <div class="oitem__m">{{ money(quickDebt(o.ownerId)) }}</div>
              <div class="oitem__s">欠费</div>
            </div>
          </div>
          <EmptyState v-if="!resultList.length" type="search" desc="未找到匹配的客户" />
        </div>
      </div>

      <!-- ============ 中：三类业务 + 加收 ============ -->
      <div class="pos-mid">
        <!-- 客户条：业主形态（有房、有账期、有车位、有表计） -->
        <div v-if="!isWalkin" class="panel who">
          <div class="who__a">{{ p.owner.name.slice(0, 1) }}</div>
          <div class="who__m">
            <div class="who__n">
              {{ p.owner.name }}
              <span class="tagm tagm--b">{{ activeHouse?.usage || '—' }}</span>
              <span v-if="periodDebtCount" class="tagm tagm--r">物业费欠 {{ periodDebtCount }} 期</span>
            </div>
            <div class="who__s">
              {{ activeHouse?.fullName || '—' }} · {{ activeHouse?.area || 0 }}㎡
              <template v-if="p.houses.length > 1"> · 名下 {{ p.houses.length }} 套房</template>
            </div>
          </div>
          <div class="who__kpi">
            <div><div class="k">本月应收</div><div class="v">{{ money(activeHouse?.area ? activeHouse.area * 2.8 : 0) }}</div></div>
            <div><div class="k">欠费合计</div><div class="v is-red">{{ money(quickDebt(ownerId)) }}</div></div>
            <div><div class="k">车位</div><div class="v">{{ activePark?.parkNo || '无' }}</div></div>
          </div>
        </div>

        <!-- 客户条：散客形态 —— 没有房、没有账期，只要"谁交的钱"和"算哪个项目" -->
        <div v-else class="panel who who--guest">
          <div class="who__a who__a--guest">散</div>
          <div class="who__m">
            <div class="who__n">
              散客 / 外来人员
              <span class="tagm tagm--y">不挂户</span>
            </div>
            <div class="who__s">摆摊费、场地租用、赔偿款 —— 有收款流水、计入收入，不进应收与收缴率</div>
          </div>
          <div class="guestf">
            <el-input v-model="guest.name" size="small" maxlength="40" placeholder="姓名 / 单位（必填）" style="width:170px" />
            <el-input v-model="guest.phone" size="small" maxlength="11" placeholder="手机号（选填）" style="width:132px" />
            <el-select v-model="guest.communityId" size="small" placeholder="所属项目" style="width:146px">
              <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </div>
        </div>
        <div v-if="isWalkin && guestErr" class="guestwarn">
          <el-icon><InfoFilled /></el-icon>{{ guestErr }}（填完才能收款）
        </div>

        <template v-if="!isWalkin">

        <!-- ① 物业服务费：能欠 → 账期格子；没出账的月份点了就是预缴 -->
        <div class="panel blk">
          <div class="blk__hd">
            <b>物业服务费</b>
            <span class="blk__sub">2.8 元/㎡ · {{ money(activeHouse?.area ? activeHouse.area * 2.8 : 0) }} / 月</span>
            <span class="md md--due">按账期 · 可欠费 · 可预缴</span>
            <span v-if="pickSummary.count" class="blk__pick">
              已选 <b>{{ pickSummary.count }}</b> 期 ·
              <b>¥{{ money(pickSummary.amount) }}</b>
              <i>{{ pickSummary.first === pickSummary.last ? pickSummary.first : pickSummary.first + ' ~ ' + pickSummary.last }}</i>
            </span>
            <span class="spacer" />
            <el-button v-if="periodDebtCount" link type="primary" size="small" @click="selectAllPeriodDebt">
              全选欠费（{{ periodDebtCount }}）
            </el-button>
          </div>

          <!-- 欠费段：该收的。已收的月份也留着，业主说"我交过了"能当场指给他看 -->
          <div class="pseg pseg--past">
            <span class="pseg__t">欠费与当期</span>
            <span class="pseg__hint">{{ periodDebtCount ? `未结清 ${periodDebtCount} 期` : '无欠费' }}</span>
          </div>
          <div class="pgrid">
            <div
              v-for="c in pastCells" :key="c.period"
              class="pcell"
              :class="['is-' + cellTone(c), { 'is-picked': c.picked }]"
              @click="togglePeriod(c)"
            >
              <div class="pcell__m">{{ c.period }}</div>
              <div class="pcell__v">{{ money(c.bill ? c.bill.unpaid : c.receivable) }}</div>
              <div class="pcell__s">{{ cellLabel(c) }}</div>
              <span v-if="c.bill" class="pcell__bill">{{ c.billId.slice(-4) }}</span>
            </div>
          </div>

          <!-- 预缴段：未来 12 个月。点选或按档位一把选，按钮上的金额就是下面格子的合计 -->
          <div class="pseg">
            <span class="pseg__t">未来 12 个月 · 可预缴</span>
            <span class="pseg__hint">从当期起连续选，已收清的自动跳过</span>
            <span class="spacer" />
            <div class="pquick">
              <span
                v-for="q in QUICK_MONTHS" :key="q"
                :class="{ 'is-on': appliedQuick === q }"
                @click="applyQuick(q)"
              >
                {{ q }} 个月 <i>¥{{ money(quickPlan(q).amount) }}</i>
              </span>
              <span v-if="pickSummary.count" class="pquick__clear" @click="clearPeriodSelection">清空</span>
            </div>
          </div>
          <div class="pgrid">
            <div
              v-for="c in futureCells" :key="c.period"
              class="pcell"
              :class="['is-' + cellTone(c), { 'is-picked': c.picked }]"
              @click="togglePeriod(c)"
            >
              <div class="pcell__m">{{ c.period }}</div>
              <div class="pcell__v">{{ money(c.bill ? c.bill.unpaid : c.receivable) }}</div>
              <div class="pcell__s">{{ cellLabel(c) }}</div>
              <span v-if="c.bill" class="pcell__bill">{{ c.billId.slice(-4) }}</span>
            </div>
          </div>
          <div class="blk__foot">
            点红格收欠费，点虚线格是<b>预缴</b>（收完即记已收，不生成账单）；
            快捷档从<b>最早未收清的一期</b>起连续选，已收清的直接跳过
          </div>
        </div>

        <!-- ② 车位：不欠费，到期失效 → 有效期 + 续期 -->
        <div class="panel blk">
          <div class="blk__hd">
            <b>车位管理服务费</b>
            <span class="blk__sub" v-if="parkInfo">{{ parkInfo.monthly }} 元/月</span>
            <span class="md md--cyc">按周期 · 不欠费</span>
            <span class="spacer" />
            <span class="blk__tip">到期未续：车牌自动停月租，按临停计费</span>
          </div>
          <div v-if="parkInfo && !parkInfo.error" class="park">
            <div class="park__i">{{ (parkInfo.zone || 'B1').slice(0, 2) }}</div>
            <div class="park__m">
              <div class="park__n">
                {{ parkInfo.parkNo }} · {{ parkInfo.parkType || '地下' }} · {{ parkInfo.plateNo || '未绑定车牌' }}
                <span class="tagm" :class="parkInfo.expired ? 'tagm--r' : 'tagm--g'">
                  {{ parkInfo.expired ? '已失效' : '生效中' }}
                </span>
                <span v-if="!parkInfo.expired" class="tagm tagm--y">剩 {{ parkInfo.daysLeft }} 天</span>
              </div>
              <div class="park__s">
                有效期至 <b>{{ parkInfo.oldExpire }}</b>
                <template v-if="parkInfo.expired"> · 已过期，续费从今天起算</template>
              </div>
            </div>
            <div class="park__act">
              <span
                v-for="m in [1, 3, 6, 12]" :key="m"
                :class="{ 'is-on': parkMonths === m }"
                @click="parkMonths = m"
              >续 {{ m }} 月</span>
              <el-button type="primary" size="small" style="margin-left:6px;" @click="addParkRenew">
                加入 · {{ parkPreview ? money(parkPreview.amount) : '—' }}
              </el-button>
            </div>
          </div>
          <div v-else-if="parkInfo" class="blk__empty">{{ parkInfo.error }}</div>
          <div v-else class="blk__empty">该客户名下没有车位</div>
        </div>

        <!-- ③ 水电：按业态计价，三种形态 -->
        <div class="panel blk">
          <div class="blk__hd">
            <b>水电</b>
            <span class="blk__sub">单价按业态自动取价</span>
            <span class="spacer" />
            <span class="blk__tip">本项目：电={{ utilityModeText(utilityCards[0]?.mode) }} · 水={{ utilityModeText(utilityCards[1]?.mode) }}</span>
          </div>
          <div class="util">
            <div v-for="card in utilityCards" :key="card.meterType" class="ucard" :class="{ 'is-off': card.mode === 'none' }">
              <div class="ucard__hd">
                <b>{{ card.meterType === '电表' ? '电费' : '水费' }}</b>
                <span v-if="card.price" class="ucard__price">{{ card.price.price }} 元/{{ card.unitShort }} · {{ card.price.tierName }}</span>
                <span v-if="card.price?.isOverride" class="tagm tagm--y">单人价</span>
                <el-button v-if="card.mode !== 'none' && card.price" link type="primary" size="small" @click="openPriceSwitch(card)">切换</el-button>
                <span class="spacer" />
                <span class="md" :class="card.mode === 'card' ? 'md--pre' : card.mode === 'meter' ? 'md--meter' : 'md--off'">
                  {{ utilityModeText(card.mode) }}
                </span>
              </div>

              <div v-if="card.mode === 'none'" class="ucard__off">
                <template v-if="card.priceErr">{{ card.priceErr }}</template>
                <template v-else>本项目该项由业主自缴，不产生应收、不收款、不计收入</template>
              </div>

              <template v-else-if="card.mode === 'meter'">
                <div v-if="card.dueBills.length" class="olist2">
                  <div
                    v-for="b in card.dueBills" :key="b.billId"
                    class="orow" :class="{ 'is-picked': sel.some(s => s.billId === b.billId) }"
                    @click="toggleUtilityBill(card, b)"
                  >
                    <span class="orow__p">{{ b.period }}</span>
                    <span class="orow__q">{{ b.quantity }} {{ card.unitShort }} × {{ card.price?.price || b.price }}</span>
                    <span class="orow__a">{{ money(b.unpaid) }}</span>
                    <span class="orow__st">{{ b.status }}</span>
                  </div>
                </div>
                <div v-else class="ucard__off">本期暂无待缴账单（抄表后自动推单）</div>
              </template>

              <template v-else>
                <div v-if="card.priceErr" class="ucard__off">{{ card.priceErr }}</div>
                <template v-else>
                  <div class="ucard__b">
                    <el-input-number
                      v-model="utilityInput[card.key].amount" :min="0" :precision="2" :step="100" :controls="false"
                      size="small" style="flex:1;" placeholder="金额"
                      @change="v => onUtilAmount(card, v)"
                    />
                    <span class="ucard__eq">⇄</span>
                    <el-input-number
                      v-model="utilityInput[card.key].qty" :min="0" :precision="2" :step="50" :controls="false"
                      size="small" style="flex:1;" :placeholder="card.unitShort"
                      @change="v => onUtilQty(card, v)"
                    />
                    <el-button size="small" type="primary" plain @click="addUtilityCharge(card)">加入</el-button>
                  </div>
                  <div class="ucard__f">
                    <template v-if="utilityInput[card.key].amount > 0 && utilityInput[card.key].qty > 0">
                      <b>{{ money(utilityInput[card.key].amount) }}</b> 元 =
                      <b>{{ utilityInput[card.key].qty }}</b> {{ card.unitShort }}
                      <span class="ucard__hint">（任一格改，另一格自动换算）</span>
                    </template>
                    <template v-else>输金额或用量任一即可，另一项自动换算</template>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </div>

        </template>

        <!-- ④ 加收：其他科目 / 押金 / 临时收费
             放中栏不放右栏：右栏职责是"结账"，加收是"选收什么"；
             而且右栏 320px 一条条堆表单，加完还得往上翻着看清单
             散客模式只留「临时收费」—— 其他科目与押金都要挂房屋才落得了库 -->
        <div class="panel blk addblk">
          <div class="blk__hd">
            <b>加收</b>
            <span class="blk__sub">不进账期、不产生欠费的一次性收款</span>
            <span class="spacer" />
            <div class="addtabs">
              <span v-if="!isWalkin" :class="{ 'is-on': extraPanel === 'item' }" @click="toggleExtraPanel('item')">其他科目</span>
              <span v-if="!isWalkin" :class="{ 'is-on': extraPanel === 'deposit' }" @click="toggleExtraPanel('deposit')">押金</span>
              <span :class="{ 'is-on': extraPanel === 'temp' }" @click="toggleExtraPanel('temp')">临时收费</span>
            </div>
          </div>

          <div v-if="extraPanel === 'item'" class="addrow">
            <el-select v-model="extraForm.itemId" placeholder="选择收费科目" style="width:232px;" @change="syncExtraAmount">
              <el-option v-for="o in extraItemOpts" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-input-number v-model="extraForm.itemQty" :min="1" :controls="false" style="width:82px;"
              placeholder="数量" @change="syncExtraAmount" />
            <el-input-number v-model="extraForm.itemAmount" :min="0" :precision="2" :controls="false"
              style="width:128px;" placeholder="金额" />
            <span class="addrow__eq">元</span>
            <el-button type="primary" plain @click="addExtraItem">加入</el-button>
            <span class="addrow__tip">金额按「单价 × 数量」自动带出，可微调</span>
          </div>

          <div v-else-if="extraPanel === 'deposit'" class="addrow">
            <el-select v-model="extraForm.depositType" style="width:190px;" @change="onDepositType">
              <el-option v-for="o in extraDepositOpts" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-input-number v-if="extraDepositDef?.byQuantity" v-model="extraForm.depositQty" :min="1"
              :controls="false" style="width:74px;" placeholder="数量" />
            <!-- 金额按约定的类型（履约 / 租约）必须手填：押金基数不能靠猜，退的时候按它算 -->
            <el-input-number v-if="!isFixedDeposit" v-model="extraForm.depositAmount" :min="0" :precision="2"
              :controls="false" style="width:120px;" placeholder="约定金额" />
            <span class="addrow__amt">{{ money(extraDepositAmount) }}</span>
            <span class="addrow__eq">元</span>
            <el-button type="primary" plain @click="addDeposit">加入</el-button>
            <span class="addrow__tip is-warn">
              {{ isFixedDeposit ? '按标准额收取，金额不可改' : '按合同/租约填写，备注写清编号' }}；只收不退，退还走押金台账
            </span>
          </div>

          <div v-else-if="extraPanel === 'temp'" class="addrow">
            <el-input v-model="extraForm.tempName" placeholder="事项（摆摊费 / 场地 / 赔偿款）" style="width:232px;" />
            <el-input-number v-model="extraForm.tempAmount" :min="0" :precision="2" :controls="false"
              style="width:128px;" placeholder="金额" />
            <span class="addrow__eq">元</span>
            <el-button type="primary" plain @click="addTempCharge">加入</el-button>
            <el-input v-model="extraForm.tempNote" placeholder="说明（摊位号 / 位置，选填）" style="flex:1;" />
          </div>

          <div v-if="extraPanel === 'temp'" class="temphint">
            <template v-if="isWalkin">
              付款方：<b>{{ guest.name || '未填写' }}</b> · 按「外部人员」入账，不挂户、不进应收
            </template>
            <template v-else>
              付款方：<b>{{ p?.owner?.name }}</b> · 记在该业主名下（外来人员请从左上角切「散客」）
            </template>
          </div>

          <div v-if="!extraPanel" class="addrow addrow--hint">选一个类型开始加收：{{ isWalkin ? '临时收费' : '其他科目 / 押金 / 临时收费' }}</div>
        </div>

        <!-- 散客：最近几笔外来收款 —— "我上午交过了"要能当场翻出来 -->
        <div v-if="isWalkin" class="panel blk">
          <div class="blk__hd">
            <b>最近散客收款</b>
            <span class="blk__sub">近 {{ guestRecent.length }} 笔 · 外来人员</span>
            <span class="spacer" />
            <el-button link type="primary" size="small" @click="$router.push('/b/temp-charges')">临时收费台账</el-button>
          </div>
          <div class="recent">
            <div v-for="t in guestRecent" :key="t.chargeId" class="rrow">
              <span class="rrow__t">{{ t.payTime || t.createdAt }}</span>
              <span class="rrow__n">{{ t.partyName }} · {{ t.reason }}</span>
              <span class="rrow__w">{{ t.status }}</span>
              <span class="rrow__a">{{ money(t.amount) }}</span>
            </div>
            <div v-if="!guestRecent.length" class="blk__empty">还没有外来人员的收费记录</div>
          </div>
        </div>

        <!-- ⑤ 本户收款记录：业主说"我上个月交过"时当场核对 -->
        <div v-if="!isWalkin" class="panel blk">
          <div class="blk__hd">
            <b>本户收款记录</b>
            <span class="blk__sub">近 {{ recentPaid.length }} 笔 · 有争议时当场核对</span>
          </div>
          <div class="recent">
            <div v-for="b in recentPaid" :key="b.billId" class="rrow">
              <span class="rrow__t">{{ b.payTime }}</span>
              <span class="rrow__n">{{ b.itemName }} · {{ b.period }}</span>
              <span class="rrow__w">{{ b.payMethod }}</span>
              <span class="rrow__a">{{ money(b.paidAmount) }}</span>
            </div>
            <div v-if="!recentPaid.length" class="blk__empty">该客户暂无收款记录</div>
          </div>
        </div>
      </div>

      <!-- ============ 右：结算 ============ -->
      <div class="panel pos-right">
        <div class="panel__hd">
          <h3>本次收款</h3>
          <span class="desc">{{ pickedCount }} 项</span>
        </div>

        <div class="cart">
          <div v-for="b in sel" :key="b.billId" class="ci">
            <span class="ci__x" @click="sel = sel.filter(x => x.billId !== b.billId)">×</span>
            <div class="ci__m">
              <div class="ci__n">{{ b.itemName }}</div>
              <div class="ci__s">{{ b.period }} · {{ b.status }}</div>
            </div>
            <div class="ci__v">{{ money(b.unpaid) }}</div>
          </div>
          <div v-for="e in cartExtras" :key="e.key" class="ci">
            <span class="ci__x" @click="removeExtraRow(e)">×</span>
            <div class="ci__m">
              <div class="ci__n">
                {{ e.title }}
                <span v-if="e.type === 'deposit'" class="tagm tagm--y">不计收入</span>
                <span v-if="e.type === 'prepay'" class="tagm tagm--b">预缴 {{ e.count }} 期</span>
                <span v-if="e.type === 'temp' && isWalkin" class="tagm tagm--y">散客</span>
              </div>
              <div class="ci__s">{{ e.sub }}</div>
            </div>
            <div class="ci__v">{{ money(e.amount) }}</div>
          </div>
          <div v-if="!pickedCount" class="cart__empty">
            {{ isWalkin ? '在「临时收费」里填事项和金额，加入即可' : '点中间的账期格子 / 续期 / 充值，或在「加收」里选科目' }}
          </div>
        </div>

        <!-- 合计：收入与押金分开 -->
        <div class="sum">
          <div class="sum__r"><span>收入类合计</span><b>{{ money(incomeSubtotal) }}</b></div>
          <!-- 减免：金额 + 原因 + 依据。原因不是可选项 —— 报表要按原因统计"让了多少、为什么让" -->
          <div class="sum__r sum__r--waive">
            <span>减免</span>
            <span class="waive-fld">
              <el-input-number v-model="discount" :min="0" :max="incomeSubtotal" :step="10" size="small"
                :controls="false" style="width:88px;" />
              <el-select v-model="waiveReasonId" size="small" placeholder="减免原因（必选）" clearable
                :disabled="!(discount > 0)" style="width:132px;">
                <el-option v-for="o in waiveOptsHere" :key="o.value" :label="o.label" :value="o.value">
                  <span>{{ o.label }}</span>
                  <span class="opt-sub">{{ o.type }}{{ o.approveAbove ? ' · 免审 ≤' + o.approveAbove : '' }}</span>
                </el-option>
              </el-select>
            </span>
          </div>
          <div v-if="discount > 0" class="waive-note">
            <el-input v-model="waiveNote" size="small"
              :placeholder="waiveNeedNote ? '减免依据（必填：审批单号 / 会议纪要 / 证明编号）' : '减免说明（选填）'" />
            <div v-if="waiveOverLimit" class="waive-note__warn">
              「{{ waiveReason?.label }}」免审额度 ¥{{ money(waiveReason.approveAbove) }}，本次已超出，必须填写依据
            </div>
            <div v-else-if="waiveReason?.needProof" class="waive-note__tip">
              该原因需凭证：请在此填写依据，纸质件随单归档
            </div>
          </div>
          <div class="sum__r"><span>押金（负债，不计收入）</span><b class="is-muted">{{ money(depositIncomeTotal) }}</b></div>
          <div class="sum__total">
            <span>本次实收</span>
            <b>¥ {{ money(payableTotal) }}</b>
          </div>
        </div>

        <!-- 支付方式 -->
        <div class="sec__hd" style="margin:0 0 8px;"><h4>支付方式</h4><span class="desc">最多 {{ PAY_SPLIT_MAX }} 种</span></div>
        <div class="splits" :key="splitKey">
          <div v-for="(row, i) in splitRows" :key="i" class="split-row">
            <el-select v-model="row.method" size="small" style="width:98px">
              <el-option v-for="m in PAY_METHODS" :key="m" :label="m" :value="m"
                :disabled="m !== row.method && isMethodUsed(m)" />
            </el-select>
            <el-input-number v-model="row.amount" :min="0" :max="999999" :precision="2" :step="10"
              size="small" controls-position="right" style="flex:1;" @change="onAmountChange" />
            <span class="split-row__x" :class="{ 'is-disabled': splitRows.length === 1 }" @click="splitRows.length > 1 && removeSplit(i)">×</span>
          </div>
          <el-button link type="primary" size="small" :disabled="splitRows.length >= PAY_SPLIT_MAX" @click="addSplit">
            + 再加一种方式
          </el-button>
        </div>

        <div class="split-check" :class="!pickedCount ? '' : (splitCheck.ok ? 'is-ok' : 'is-warn')">
          <span v-if="pickedCount">
            已分配 ¥{{ money(splitCheck.sum) }} / 实收 ¥{{ money(splitCheck.total) }}
          </span>
          <span v-else>尚未选择收费项</span>
          <span class="split-check__m">{{ !pickedCount ? '' : (splitCheck.ok ? '✓ 可以收款' : splitCheck.msg) }}</span>
        </div>

        <div class="pay-actions">
          <el-button style="width:88px;" @click="reset">清空</el-button>
          <el-button type="primary" style="flex:1;" :disabled="!canPay" :loading="paying" @click="confirmPay">
            收款（F2）
          </el-button>
        </div>

        <div v-if="lastResult" class="pay-done">
          <div class="pay-done__h">
            <b>收款成功</b>
            <span class="muted">{{ lastResult.batchNo }}</span>
          </div>
          <div class="pay-done__b">
            ¥{{ money(lastResult.received) }} · {{ lastResult.count }} 笔账单
            <template v-if="lastResult.discount > 0">（含减免 ¥{{ money(lastResult.discount) }}）</template>
          </div>
          <div class="pay-done__s">{{ lastResult.methodText }}</div>

          <!-- 开具票据：就在收款结果里开完，不让人为了开一张收据再跳一次页面 -->
          <div v-if="lastResult.payments?.length" class="tk">
            <div class="tk__hd">
              <span>开具票据</span>
              <span class="spacer" />
              <el-button link type="primary" size="small" @click="$router.push('/b/payments')">查看流水</el-button>
            </div>

            <template v-if="!ticket.done">
              <div class="tk__row">
                <el-checkbox v-model="ticket.receipt">收据</el-checkbox>
                <el-checkbox v-model="ticket.invoice">发票</el-checkbox>
                <span class="tk__hint">可只开其一，也可都开</span>
              </div>

              <div class="tk__row">
                <span class="tk__k">购买方</span>
                <el-select v-model="ticket.profileId" size="small" style="flex:1" :disabled="ticket.multiHouse">
                  <el-option value="__owner__" :label="ticket.multiHouse ? '多房合并 · 按各自房主开具' : '按房主开具（默认）'" />
                  <el-option
                    v-for="pf in ticket.profiles" :key="pf.profileId || pf.title"
                    :label="`${pf.title}${pf.roleLabel ? '（' + pf.roleLabel + '）' : ''}`"
                    :value="pf.profileId || '__adhoc__'"
                  />
                </el-select>
              </div>

              <div class="tk__row">
                <span class="tk__k">项目</span>
                <el-select v-model="ticket.itemName" size="small" filterable allow-create style="flex:1"
                  placeholder="按各笔流水的实际科目">
                  <el-option value="" label="按各笔流水的实际科目（推荐）" />
                  <el-option v-for="it in ticketItemOpts" :key="it.value"
                    :label="`${it.label}（税率 ${it.taxRate}%）`" :value="it.value" />
                </el-select>
              </div>

              <el-button
                type="primary" size="small" :loading="ticket.loading"
                style="width:100%;margin-top:6px" @click="doIssueTicket"
              >开具{{ ticketLabel }}</el-button>
            </template>

            <template v-else>
              <div class="tk__ok">
                <!-- 一次收 N 笔会出 N 张收据（+ N 张发票），全列出来会把右栏撑爆：
                     只列前 3 张，其余给汇总 -->
                <div v-for="t in ticket.created.slice(0, 3)" :key="t.invoiceId" class="tk__item">
                  <el-tag size="small" effect="plain" :type="t.isReceipt ? 'success' : 'primary'">
                    {{ t.isReceipt ? '收据' : '发票' }}
                  </el-tag>
                  <span class="mono">{{ t.invoiceNo }}</span>
                  <span class="tk__amt">¥ {{ money(t.amount) }}</span>
                </div>
                <div v-if="ticket.created.length > 3" class="tk__more">
                  共 {{ ticket.created.length }} 张（每笔流水一张，收据按房拆）
                </div>
              </div>
              <div class="tk__f">
                <el-button v-if="ticket.receiptDoc" link type="primary" size="small" @click="openPrint(ticket.receiptDoc)">
                  打印收据
                </el-button>
                <el-button link type="primary" size="small" @click="$router.push('/b/invoices')">票据台账</el-button>
              </div>
            </template>
          </div>
          <!-- 非账单收款（充值 / 续期 / 押金 / 临时收费）没有 payId 可挂，开票去台账 -->
          <div v-else class="tk">
            <div class="tk__hd">
              <span>开具票据</span>
              <span class="spacer" />
              <el-button link type="primary" size="small" @click="$router.push('/b/payments')">查看流水</el-button>
            </div>
            <div class="tk__more" style="margin-top:6px;">
              这类收款不走账单，请在「票据台账」按流水开票
            </div>
          </div>
        </div>

        <div class="tip">
          <el-icon><InfoFilled /></el-icon>
          <span>一次收款可跨多套房、多类业务；收据按房拆分打印，押金不进收入表。</span>
        </div>
      </div>
    </div>

    <!-- 临时收费：建单 + 收款一步做完，与账单收款完全独立 -->
    <TempChargeDialog v-model="tcOpen" @done="onTempPaid" />
    <!-- 收据打印：走「开票设置 → 票据模板」的参数，针打套打 -->
    <ReceiptPrint v-model="printVisible" :invoice="printDoc" />

    <TenantSupplementDrawer
      v-model="tsVisible" :tenant="tsTarget" @saved="onTenantSaved"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  PAY_METHODS, PAY_SPLIT_MAX, canCollect, canEditTempCharges,
  cashierBuildingOpts, cashierExtraItemOpts, cashierOwnerList, cashierOwnerRoom, cashierPeriodRows,
  cashierUnitOpts, collectDeposit, communityOpts, communityUtilityOf, createPrepayCollect, createPrepayForPeriod, createUtilityCharge, debtOf,
  depositCollectTypeOpts, feeItemCategoryRows, houseOptions, invoiceItemNameOpts,
  invoiceProfilesOfHouse, isDebt, isReceivableItem, issueInvoice, ownerProfile,
  parkingRenewQuote, payBills, paySplitCheck, payTempCharge, prepayPlan,
  recentTempCharges,
  renewParking, saveTempCharge, setHouseUtilityPrice, tenantsOfOwner,
  utilityBillsOf, utilityPriceOf, utilityQuote, utilityQuoteAt, utilityTierRows, waiveReasonOpts, waiveReasonOptsFor
} from '@/utils/api'
import TempChargeDialog from '@/components/TempChargeDialog.vue'
import ReceiptPrint from '@/components/ReceiptPrint.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import TenantSupplementDrawer from '@/components/TenantSupplementDrawer.vue'
import SensitiveText from '@/components/SensitiveText.vue'
import { money } from '@/utils/format'

/* 独立页顶栏用：项目名与当前时间（进来一次取一次就够，不必每秒跳） */
const scopeName = ref('全部项目')
const nowText = ref('')
{
  const d = new Date()
  nowText.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  try {
    const raw = localStorage.getItem('wy_proto_scope')
    if (raw) scopeName.value = JSON.parse(raw)?.name || '全部项目'
  } catch { /* 读不到就用默认 */ }
}

const kw = ref('')
/** 散客的虚拟客户 ID：不指向任何业主档案，只作为"当前收款对象"的标记 */
const WALKIN = '__walkin__'
const ownerId = ref('OW00001')
const isWalkin = computed(() => ownerId.value === WALKIN)
const houseFilter = ref('__all')
const sel = ref([])
const discount = ref(0)
const remark = ref('')
const paying = ref(false)
const tableRef = ref()
/* 收款后要重算「待收账单」：只改账单字段不会让 computed 的 filter 重跑 */
const payVer = ref(0)
const lastResult = ref(null)
/* 临时收费弹窗：不选账单单据，直接建单 + 收款 */
/* ---------- 预收 / 充值（批 2） ---------- */
const mode = ref('bill')
const houseOpts = houseOptions(400)
const waiveOpts = waiveReasonOpts()
/* 收银台右栏的减免（与预缴面板的 pp.waiveReasonId 分开：那是单笔预收的减免） */
const waiveReasonId = ref('')
const waiveNote = ref('')
const pp = reactive({
  houseId: '', itemId: '', meter: false, months: 1, inputMode: 'amount',
  amount: 0, qty: 0, waive: 0, waiveReasonId: '',
  payMethod: '微信支付', preview: null, result: null, saving: false, planMode: 'even'
})
const ppHouse = computed(() => houseOpts.find(h => h.houseId === pp.houseId) || null)

/* 可收项：有月度应收的进"按月"；水电按项目配置决定能不能充（A 类直接禁用） */
const ppItemOpts = computed(() => {
  if (!pp.houseId) return []
  const cid = ppHouse.value?.communityId || ''
  return feeItemCategoryRows().filter(r => r.status === '启用').map(r => {
    if (r.meterType) {
      const key = r.meterType === '电表' ? 'elec' : 'water'
      const m = communityUtilityOf(cid)[key]
      return { itemId: r.itemId, label: `${r.name}（充值 ${r.price}${r.unit}）`, meter: true, disabled: m === 'none', mode: m }
    }
    const recv = isReceivableItem(r.itemId)
    return { itemId: r.itemId, label: recv ? `${r.name}（月费）` : `${r.name}`, meter: false, disabled: !recv }
  })
})

function onPickHouse() {
  Object.assign(pp, { itemId: '', amount: 0, qty: 0, waive: 0, waiveReasonId: '', preview: null, result: null })
}

function onItemChange() {
  const opt = ppItemOpts.value.find(o => o.itemId === pp.itemId)
  pp.result = null
  pp.preview = null
  pp.amount = 0
  pp.qty = 0
  pp.meter = !!opt?.meter
  if (!opt) return
  if (opt.meter) { pp.inputMode = 'amount'; return }
  onMonthsChange()
}

/* 非计量项：输月份 → 金额 = 月应收 × 月数（可再手改，改了就按逐月冲抵） */
function onMonthsChange() {
  if (!pp.houseId || !pp.itemId) return
  try {
    const plan = prepayPlan({ houseId: pp.houseId, itemId: pp.itemId, months: pp.months })
    pp.amount = plan.amount
    pp.preview = plan
    pp.planMode = 'even'
    pp.result = null
  } catch (e) { ElMessage.error(e?.message || '计算失败'); pp.preview = null }
}

/* 金额/用量变化：计量项换算，非计量项只判断是否还等额 */
function recalc() {
  const opt = ppItemOpts.value.find(o => o.itemId === pp.itemId)
  if (!opt) return
  try {
    if (opt.meter) {
      const q = utilityQuote({
        itemId: pp.itemId,
        amount: pp.inputMode === 'amount' ? pp.amount : undefined,
        qty: pp.inputMode === 'qty' ? pp.qty : undefined
      })
      pp.preview = { monthly: 0, amount: q.amount, qty: q.qty, unitPrice: q.unitPrice, unit: q.unit, details: null }
      if (pp.inputMode === 'amount') pp.qty = q.qty
      else pp.amount = q.amount
      return
    }
    if (!pp.preview) return
    const monthly = pp.preview.monthly
    pp.planMode = Math.abs(pp.amount - monthly * pp.months) < 0.01 ? 'even' : 'fifo'
  } catch (e) { pp.preview = null }
}

function onQtyChange() {
  pp.inputMode = 'qty'
  recalc()
}

const canPrepay = computed(() => canCollect() && !!pp.houseId && !!pp.itemId && Number(pp.amount) > 0
  && (!pp.waive || !!pp.waiveReasonId))

function resetPrepay() {
  Object.assign(pp, {
    houseId: '', itemId: '', meter: false, months: 1, inputMode: 'amount', amount: 0, qty: 0,
    waive: 0, waiveReasonId: '', preview: null, result: null, planMode: 'even'
  })
}

async function doPrepay() {
  const opt = ppItemOpts.value.find(o => o.itemId === pp.itemId)
  if (!opt) return
  pp.saving = true
  try {
    if (opt.meter) {
      const row = createUtilityCharge({
        houseId: pp.houseId, itemId: pp.itemId,
        amount: pp.inputMode === 'amount' ? pp.amount : undefined,
        qty: pp.inputMode === 'qty' ? pp.qty : undefined,
        payMethod: pp.payMethod
      })
      pp.result = { collectId: row.chargeId, amount: row.amount, payMethod: row.payMethod, mode: 'charge', details: [{ period: '充值', amount: row.amount }] }
      ElMessage.success(`已充值 ${row.qty} ${row.unit}，收款 ${money(row.amount)}`)
    } else {
      const c = createPrepayCollect({
        houseId: pp.houseId, itemId: pp.itemId, months: pp.months, amount: pp.amount,
        payMethod: pp.payMethod, waive: pp.waive, waiveReasonId: pp.waiveReasonId
      })
      pp.result = c
      ElMessage.success(`已收款 ${money(c.amount)}，${c.mode === 'even' ? `平摊到 ${c.details.length} 个账期` : '按欠费逐月冲抵'}`)
    }
    pp.preview = null
    pp.amount = 0
    pp.qty = 0
    pp.waive = 0
    pp.waiveReasonId = ''
  } catch (e) {
    ElMessage.error(e?.message || '收款失败')
  } finally {
    pp.saving = false
  }
}

const tcOpen = ref(false)

/* ---------------- 收款后同页开票 ----------------
 * 收据与发票是**两个独立状态**（`receiptStatus` / `invoiceStatus`），不是"开没开票"一个开关：
 * 只开收据的笔数不少，合成一个状态会让台账查不出"还差一张发票"。
 */
const ticket = reactive({
  receipt: true, invoice: false,
  profileId: '__owner__', itemName: '',
  profiles: [], multiHouse: false,
  loading: false, done: false, created: [], receiptDoc: null
})
const ticketItemOpts = invoiceItemNameOpts()
const ticketLabel = computed(() => {
  const n = (ticket.receipt ? 1 : 0) + (ticket.invoice ? 1 : 0)
  if (n === 2) return '收据 + 发票'
  if (n === 1) return ticket.receipt ? '收据' : '发票'
  return '票据'
})

async function initTicket(res) {
  const houses = [...new Set((res.payments || []).map(p => p.houseId).filter(Boolean))]
  ticket.multiHouse = houses.length > 1
  ticket.profileId = '__owner__'
  ticket.itemName = ''
  ticket.created = []
  ticket.receiptDoc = null
  ticket.done = false
  ticket.receipt = true
  ticket.invoice = false
  ticket.profiles = []
  /* 多房合并没法共用一条抬头档案：收据按房拆，各自按房主开 */
  if (!ticket.multiHouse && houses.length === 1) {
    try { ticket.profiles = await invoiceProfilesOfHouse(houses[0]) } catch { ticket.profiles = [] }
  }
}

async function doIssueTicket() {
  if (!ticket.receipt && !ticket.invoice) {
    ElMessage.warning('至少勾一种票据；都不开就点「查看流水」，之后仍可在票据台账补开')
    return
  }
  ticket.loading = true
  try {
    const types = []
    if (ticket.receipt) types.push('收据')
    if (ticket.invoice) types.push('电子发票')
    const res = issueInvoice((lastResult.value?.payments || []).map(p => p.payId), types, {
      profileId: ticket.profileId === '__owner__' || ticket.profileId === '__adhoc__' ? '' : ticket.profileId,
      itemName: ticket.itemName
    })
    ticket.created = res.created
    ticket.receiptDoc = res.receipts[0] || null
    ticket.done = true
    ElMessage.success(`已开具 ${res.count} 张 ${types.join(' / ')}`)
  } catch (e) {
    ElMessage.error(e?.message || '开票失败')
  } finally {
    ticket.loading = false
  }
}

/* 收据打印预览 */
const printVisible = ref(false)
const printDoc = ref(null)
function openPrint(doc) {
  printDoc.value = doc
  printVisible.value = true
}
const canTemp = computed(() => canEditTempCharges())
function onTempPaid(res) {
  ElMessage.success(`临时收费已入账 ¥${money(res.charge.amount)}，可在「临时收费」台账查看`)
}

/** 金额行。默认一行、金额跟实收走 —— 绝大多数收款是单方式全额 */
const splitRows = ref([{ method: '微信支付', amount: 0 }])
/* 金额行的重建标记：el-input-number 内部有 currentValue 缓存，外部把 amount 改回 0
   时输入框不一定跟着清（截图里收款后还留着上一笔的 1981.01）。换 key 强制重建最稳 */
const splitKey = ref(0)

const p = computed(() => ownerProfile(ownerId.value))

/* 在住租户：租户代缴物业费时，前台可当场补充/修正其信息（保存即生效） */
const tenantVer = ref(0)
const ownerTenants = computed(() => { void tenantVer.value; return tenantsOfOwner(ownerId.value) })
const tsVisible = ref(false)
const tsTarget = ref(null)
function openTenantSupplement(t) {
  tsTarget.value = t
  tsVisible.value = true
}
function onTenantSaved() {
  tenantVer.value++
  ElMessage.success('租户信息已更新，收费对象不变（账单仍归业主）')
}
const houseName = id => p.value.houses.find(h => h.houseId === id)?.fullName || id
const roomOf = id => p.value.houses.find(h => h.houseId === id)?.room || ''
// 合并收费表格里省掉项目名，避免一列被撑爆
const shortHouse = id => (houseName(id) || '').replace(/^\S+\s+/, '')

// 左栏结果：有关键字搜业主，否则给 4 个演示对象 + 欠费最高的 5 位
// 左栏检索：演示对象 / 欠费 Top5 / 关键字 / 楼栋·单元，全部收归 api
const resultList = computed(() =>
  cashierOwnerList(kw.value, { buildingId: bldgId.value, unitId: unitId.value })
)

/* 楼栋 / 单元：只作用于左栏选人（A 方案），不新增栅格列，中栏账单宽度不变 */
const bldgId = ref('')
const unitId = ref('')
const bldgOpts = cashierBuildingOpts()
const unitOpts = computed(() => cashierUnitOpts(bldgId.value))
const scopeText = computed(() => {
  if (!bldgId.value) return ''
  const b = bldgOpts.find(x => x.value === bldgId.value)
  const u = unitOpts.value.find(x => x.value === unitId.value)
  return `${b?.label || '已选楼栋'}${u ? ' · ' + u.label : ''} · ${resultList.value.length} 位业主`
})
function clearLocals() { bldgId.value = ''; unitId.value = '' }
function roomOfScope(o) {
  if (!bldgId.value) return ''
  const full = cashierOwnerRoom(o.ownerId, { buildingId: bldgId.value, unitId: unitId.value })
  return full ? full.replace(/^\S+\s+/, '') : ''
}
watch(bldgId, () => { unitId.value = '' })
// 换范围后当前业主可能已不在结果里，自动落到第一位，避免中/右栏停在范围外的人
watch([bldgId, unitId], () => {
  const list = resultList.value
  if (list.length && !list.some(o => o.ownerId === ownerId.value)) ownerId.value = list[0].ownerId
})

const debtRows = computed(() => {
  void payVer.value
  return (p.value?.bills || []).filter(isDebt).map(b => ({ ...b, room: roomOf(b.houseId) }))
    .sort((a, b) => b.overdueDays - a.overdueDays)
})
const shownRows = computed(() =>
  houseFilter.value === '__all' ? debtRows.value : debtRows.value.filter(b => b.houseId === houseFilter.value)
)

const sum = computed(() => {
  const rows = sel.value
  return {
    payable: rows.reduce((s, b) => s + (b.payable || 0), 0),
    lateFee: rows.reduce((s, b) => s + (b.lateFee || 0), 0),
    unpaid: rows.reduce((s, b) => s + (b.unpaid || 0), 0)
  }
})
/* payableTotal 移到 POS 段：它要同时算上账单与加收，定义顺序跟着数据走 */

/* 校验口径与数据层同一份实现：页面提示与提交拦截不可能说两套话。
   一笔都没勾时不报错 —— 收款成功后 sel 被清空，若继续校验，右栏会立刻变红，
   看着像刚刚那笔出错了 */
/* splitCheck 同样移后 */
const isMethodUsed = m => splitRows.value.some(r => r.method === m)


/* canPay 同样移后 */

/* 只在换业主时清结果条。跟着 sel 一起清的话，收款后 sel 被清空，
   "收款成功"提示会瞬间消失（第一版就是这样，用户完全看不到结果） */
/* 换客户必须清空清单：上一单的车位、押金留在里面，会跟着别人的账一起收掉 */
watch(() => ownerId.value, () => {
  lastResult.value = null
  sel.value = []
  extras.value = []
  extraPanel.value = ''
  discount.value = 0
  remark.value = ''
})

function addSplit() {
  if (splitRows.value.length >= PAY_SPLIT_MAX) return
  const used = new Set(splitRows.value.map(r => r.method))
  const next = PAY_METHODS.find(m => !used.has(m)) || '现金'
  /* 从金额最大的一行分一半出来，让新行立刻有数 —— 加完马上报红
     「金额必须大于 0」，是最容易让人放弃组合支付的地方 */
  const host = splitRows.value.reduce((m, r) => (r.amount > m.amount ? r : m), splitRows.value[0])
  const half = Math.round((Number(host.amount) || 0) / 2 * 100) / 100
  host.amount = Math.round(((Number(host.amount) || 0) - half) * 100) / 100
  splitRows.value.push({ method: next, amount: half })
}
function removeSplit(i) {
  if (splitRows.value.length === 1) return
  splitRows.value.splice(i, 1)
}
function onAmountChange() { /* el-input-number 双向绑定即生效，这里只留钩子便于以后加千分位 */ }

/* 收款成功 / 清空之后回到「一行、零金额」。
   这里不要读 payableTotal —— sel 刚被清空，computed 的求值时机不好把控，
   出现过金额停在上一笔的旧值上（截图里 1981.01 一直留着）；直接给 0 最稳 */
function resetSplits() {
  splitRows.value = [{ method: '微信支付', amount: 0 }]
  splitKey.value++
}

function quickDebt(id) {
  if (id === WALKIN) return 0
  return debtOf(p.value?.ownerId === id ? p.value.bills : ownerBills(id))
}
const billCache = new Map()
function ownerBills(id) {
  if (!billCache.has(id)) billCache.set(id, ownerProfile(id)?.bills || [])
  return billCache.get(id)
}

function pick(id) {
  ownerId.value = id
  houseFilter.value = '__all'
  discount.value = 0
  sel.value = []
  lastResult.value = null
  splitKey.value++
}

function onSel(rows) { sel.value = rows }

// 账单变化后默认全选（收银台默认“全收”）
watch(shownRows, async () => {
  await nextTick()
  tableRef.value?.clearSelection()
  tableRef.value?.toggleAllSelection()
}, { immediate: true })

watch(houseFilter, () => { discount.value = 0 })

function reset() {
  discount.value = 0
  remark.value = ''
  sel.value = []
  extras.value = []
  extraPanel.value = ''
  tableRef.value?.clearSelection()
  resetSplits()
}


/* ============================================================
 * 三栏 POS（2026-11-13）
 * ------------------------------------------------------------
 * 中间不是一个通用表格，而是三类业务各自的形态 —— 因为它们的规则不同：
 *   物业费  账单制、按月、**能欠**        → 账期格子（红几格 = 欠几期）
 *   车位费  周期制、**不欠费**、到期失效  → 有效期 + 续期（不是"补哪几期"）
 *   水电    按量、按业态计价              → 预充换算 / 抄表待缴 / 自缴不参与
 *
 * 账单仍走原链路（sel → payBills），非账单类收进 extras。
 * 分两条路是因为落库方式不同：账单要销账，续期要改有效期，押金要进负债表。
 * ============================================================ */

/** 当前操作的房屋：多套房时取右边房号切换，否则取第一套 */
const activeHouse = computed(() => {
  const hs = p.value?.houses || []
  if (!hs.length) return null
  if (houseFilter.value === '__all') return hs[0]
  return hs.find(h => h.houseId === houseFilter.value) || hs[0]
})

/** 当前房屋的车位：车位费按车位收，不按房屋 —— 一户可能两个车位 */
const activePark = computed(() => {
  const ps = p.value?.parkings || []
  if (!ps.length) return null
  const h = activeHouse.value
  return ps.find(x => x.houseId === h?.houseId) || ps[0]
})

/* 减免原因按当前房屋所属项目过滤：政策性减免常只针对某个小区，
   让它在别的项目也能选，前台就拿一个不适用的依据去减免 */
const waiveOptsHere = computed(() => waiveReasonOptsFor(activeHouse.value?.communityId || ''))
const waiveReason = computed(() => waiveOptsHere.value.find(o => o.value === waiveReasonId.value) || null)
const waiveOverLimit = computed(() => {
  const r = waiveReason.value
  const d = Number(discount.value) || 0
  return !!r && Number(r.approveAbove) > 0 && d > Number(r.approveAbove)
})
/* 需凭证 / 超免审额度 → 依据必填。字典上写了"需凭证"却不拦，这个字段就是装饰 */
const waiveNeedNote = computed(() =>
  (Number(discount.value) || 0) > 0 && (waiveOverLimit.value || !!waiveReason.value?.needProof))

/* ---------------- ① 物业费：账期格子 ---------------- */
/* 预缴段铺 12 期：业主提前交一年是常态，之前只有 2~3 期可点，等于做不了年缴 */
const PERIOD_FUTURE = 12
/** 快捷缴费月数：点一下选连续 N 期，金额当场算出来写在按钮上 */
const QUICK_MONTHS = [3, 6, 12]

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const periodWindow = computed(() => {
  void payVer.value
  const h = activeHouse.value
  if (!h) return { current: '', rows: [] }
  try { return cashierPeriodRows({ houseId: h.houseId, itemId: 'FI01', future: PERIOD_FUTURE }) }
  catch { return { current: '', rows: [] } }
})

const periodCells = computed(() => {
  void payVer.value
  const h = activeHouse.value
  if (!h) return []
  return periodWindow.value.rows.map(r => {
    const bill = (p.value?.bills || []).find(b => b.houseId === h.houseId && b.itemId === 'FI01'
      && b.period === r.period && isDebt(b))
    return {
      ...r,
      bill,
      billId: bill?.billId || '',
      picked: bill
        ? sel.value.some(x => x.billId === bill.billId)
        : extras.value.some(e => e.key === `prepay-${h.houseId}-${r.period}`)
    }
  })
})

/** 欠费段（含当期）与预缴段分开渲染：一段是"该收的"，一段是"能提前收的" */
const pastCells = computed(() => periodCells.value.filter(c => c.segment !== 'future'))
const futureCells = computed(() => periodCells.value.filter(c => c.segment === 'future'))

/**
 * 未结清期数。
 * 只数"有账单的"会和格子对不上：矩阵里 2025-11 就有应收、账单却只开到最近两期，
 * 于是格子红了 11 格、块头写"欠 2 期"，前台第一句就会被业主问住。
 * 口径统一成：谁还有未收金额，就算一期。
 */
const periodDebtCount = computed(() =>
  periodCells.value.filter(c => c.segment !== 'future' && Number(c.bill ? c.bill.unpaid : c.unpaid) > 0).length)

/** 已收清的格子：不能再点，快捷选择也要跳过 */
const isSettledCell = c => !c.bill && (c.status === '已收' || c.status === '已减免')
/** 逾期/部分收的格子，应收是"还差多少"而不是月费 */
const cellDue = c => (Number(c.unpaid) > 0 ? c.unpaid : c.receivable)

/**
 * 已选账期总览：欠费（销账）与预缴（未来）都算，一格一期。
 * 金额对的是"右栏要收多少"，所以账单用账单的未缴，预缴用该期应收。
 */
const pickSummary = computed(() => {
  const rows = periodCells.value.filter(c => c.picked)
  return {
    count: rows.length,
    amount: r2(rows.reduce((s, c) => s + (c.bill ? c.bill.unpaid : cellDue(c)), 0)),
    first: rows[0]?.period || '',
    last: rows[rows.length - 1]?.period || ''
  }
})

/**
 * 快捷缴费 N 期：从**当期**起连续取 N 期未收清的月份。
 * 只跳过已收清的，不往欠费段里捞 —— 清欠有「全选欠费」和点格子两条路，
 * 把欠费混进来会让"12 个月"变成"12 期（含去年欠的）"，金额对不上预期。
 * 当期已收就自动顺延到下个月，所以"12 个月"永远凑满 12 个还没交的月份。
 */
function quickPlan(n) {
  const pool = periodCells.value
    .filter(c => c.segment !== 'past' && !isSettledCell(c))
    .slice(0, n)
  return {
    count: pool.length,
    amount: r2(pool.reduce((s, c) => s + (c.bill ? c.bill.unpaid : cellDue(c)), 0)),
    first: pool[0]?.period || '',
    last: pool[pool.length - 1]?.period || ''
  }
}

/* 哪个快捷档是当前生效的：手点格子后要清掉，否则按钮一直亮着像没点上 */
const appliedQuick = ref(0)

function prepayRow(c, h) {
  return {
    key: `prepay-${h.houseId}-${c.period}`,
    type: 'prepay',
    title: '物业服务费（预缴）',
    sub: `${c.period} · 提前缴纳，收后即记已收`,
    amount: cellDue(c),
    meta: { houseId: h.houseId, itemId: 'FI01', period: c.period }
  }
}

/** 清掉本户已选的账期（账单 + 预缴），换档或重选时先清再选 */
function clearPeriodSelection() {
  const h = activeHouse.value
  if (!h) return
  appliedQuick.value = 0
  sel.value = sel.value.filter(b => !(b.houseId === h.houseId && b.itemId === 'FI01'))
  extras.value = extras.value.filter(e => !(e.type === 'prepay' && e.meta.houseId === h.houseId))
}

function applyQuick(n) {
  const h = activeHouse.value
  if (!h) return
  clearPeriodSelection()
  const pool = periodCells.value
    .filter(c => c.segment !== 'past' && !isSettledCell(c))
    .slice(0, n)
  if (!pool.length) { ElMessage.info('没有可收的账期'); return }
  for (const c of pool) {
    if (c.bill) sel.value.push({ ...c.bill, room: h.room || '' })
    else extras.value.push(prepayRow(c, h))
  }
  appliedQuick.value = n
  if (pool.length < n) ElMessage.info(`只凑到 ${pool.length} 期（其余已收清）`)
}

/* 本户近期收款：业主说"我上个月交过"的时候，前台要能当场翻出来 */
const recentPaid = computed(() => (p.value?.bills || [])
  .filter(b => b.payTime && (b.paidAmount || 0) > 0)
  .sort((a, b) => String(b.payTime).localeCompare(String(a.payTime)))
  .slice(0, 6))

/**
 * 格子的状态与配色。
 * 判据优先看**有没有未缴账单**：矩阵按"当前月"判断未到期，
 * 但账单可能已经开出来并开始计滞纳金 —— 那种情况必须显示欠费、且能点着收。
 * 两套判据混用会出现"格子说未到期、账单说逾期"，前台不敢点。
 */
function cellLabel(c) {
  if (c.bill) return '欠费'
  if (c.picked) return '已选'
  if (c.status === '已收' || c.status === '已减免') return c.status
  if (c.status === '部分收') return '部分收'
  return c.segment === 'future' ? '可预缴' : c.status
}
function cellTone(c) {
  if (c.bill) return 'due'
  if (c.status === '已收' || c.status === '已减免') return 'paid'
  if (c.status === '部分收') return 'due'
  if (c.status === '未到期') return 'fut'
  return 'due'
}

/**
 * 点格子 = 收这一期。
 * 有账单 → 走销账；没账单但也没收过 → 走**预缴**（实际业务里物业费大都是提前收的）。
 * 已收清的格子点不动；部分收的按"还差多少"预缴，不按整月月费。
 */
function togglePeriod(cell) {
  const h = activeHouse.value
  if (!h) return
  appliedQuick.value = 0

  if (cell.bill) {
    const i = sel.value.findIndex(x => x.billId === cell.billId)
    if (i >= 0) sel.value.splice(i, 1)
    else sel.value.push({ ...cell.bill, room: h.room || '' })
    return
  }
  if (isSettledCell(cell)) {
    ElMessage.info(`${cell.period} 已收清`)
    return
  }
  const key = `prepay-${h.houseId}-${cell.period}`
  const i = extras.value.findIndex(e => e.key === key)
  if (i >= 0) { extras.value.splice(i, 1); return }
  extras.value.push(prepayRow(cell, h))
}

/**
 * 一键收齐欠费。
 * 有账单的走销账，没出账单的走补缴（写矩阵，不补开账单）——
 * 现实里历史欠费常常只出了最近几期的单，前台不能因此把前面 9 期留在系统外。
 */
function selectAllPeriodDebt() {
  const h = activeHouse.value
  if (!h) return
  appliedQuick.value = 0
  const hasBill = new Set(sel.value.map(x => x.billId))
  const hasPrepay = new Set(extras.value.filter(e => e.type === 'prepay').map(e => e.key))
  for (const c of periodCells.value) {
    if (c.segment === 'future') continue
    if (!(Number(c.bill ? c.bill.unpaid : c.unpaid) > 0)) continue
    if (c.bill) {
      if (!hasBill.has(c.billId)) sel.value.push({ ...c.bill, room: h.room || '' })
    } else if (!hasPrepay.has(`prepay-${h.houseId}-${c.period}`)) {
      extras.value.push(prepayRow(c, h))
    }
  }
}

/* ---------------- ② 车位：有效期 + 续期 ---------------- */
const parkMonths = ref(3)
const parkInfo = computed(() => {
  /* 收款后要重算：续期改的是 PV_ROWS 里的 expireDate，
     parkingsOfOwner 返回的仍是同一批对象引用，不加这个依赖界面会停在旧日期 */
  void payVer.value
  const pk = activePark.value
  if (!pk) return null
  try {
    return { ...parkingRenewQuote(pk.parkId, 1), parkType: pk.parkType, zone: pk.zone, error: '' }
  } catch (e) {
    return { parkId: pk.parkId, parkNo: pk.parkNo, plateNo: pk.plateNo || '', error: e.message }
  }
})
const parkPreview = computed(() => {
  const pk = activePark.value
  if (!pk) return null
  try { return parkingRenewQuote(pk.parkId, parkMonths.value) } catch { return null }
})

function addParkRenew() {
  const q = parkPreview.value
  if (!q) { ElMessage.error(parkInfo.value?.error || '无法计算续期'); return }
  if (extras.value.some(e => e.type === 'park' && e.meta.parkId === q.parkId)) {
    ElMessage.warning('该车位已在本次收款里，换个月数请先移除')
    return
  }
  extras.value.push({
    key: 'park-' + q.parkId,
    type: 'park',
    title: '车位管理服务费',
    sub: `续 ${q.months} 月 · ${q.oldExpire} → ${q.newExpire}`,
    amount: q.amount,
    meta: q
  })
}

/* ---------------- ③ 水电：三种形态 ---------------- */
const utilityCards = computed(() => {
  void payVer.value
  const h = activeHouse.value
  if (!h) return []
  const cfg = communityUtilityOf(h.communityId) || { elec: 'none', water: 'none' }
  return ['电表', '水表'].map(mt => {
    const key = mt === '电表' ? 'elec' : 'water'
    const mode = cfg[key] || 'none'
    let price = null
    let priceErr = ''
    try { price = utilityPriceOf(h.houseId, mt) } catch (e) { priceErr = e.message }
    return {
      meterType: mt, key, mode, price, priceErr,
      itemId: mt === '电表' ? 'FI06' : 'FI05',
      dueBills: mode === 'meter' ? utilityBillsOf(h.houseId, mt) : [],
      unitShort: mt === '电表' ? '度' : '吨'
    }
  })
})

/* 电、水分开存：同一个输入框状态会让"输 500 元电费"顺带把水费的度数也改了 */
const utilityInput = reactive({
  elec: { amount: 0, qty: 0 },
  water: { amount: 0, qty: 0 }
})

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** 三种水电模式的中文名，模板里少写三个三元 */
const utilityModeText = m =>
  m === 'card' ? '预充买量' : m === 'meter' ? '抄表账单' : m === 'none' ? '系统不参与' : '—'

/**
 * 金额 / 用量双向实时换算。
 * 只靠下面一行提示文字不够 —— 前台输 500 时要知道"这是多少度"，
 * 输 800 度时也要立刻看到"该收多少钱"，否则得自己按计算器。
 */
function onUtilAmount(card, v) {
  const a = Number(v) || 0
  const st = utilityInput[card.key]
  if (!card.price || !a) { st.qty = 0; return }
  st.qty = round2(a / card.price.price)
}
function onUtilQty(card, v) {
  const q = Number(v) || 0
  const st = utilityInput[card.key]
  if (!card.price || !q) { st.amount = 0; return }
  st.amount = round2(q * card.price.price)
}

function toggleUtilityBill(card, bill) {
  const i = sel.value.findIndex(x => x.billId === bill.billId)
  if (i >= 0) sel.value.splice(i, 1)
  else sel.value.push({ ...bill, room: activeHouse.value?.room || '' })
}

function addUtilityCharge(card) {
  if (!card.price) { ElMessage.error(card.priceErr || '该表计没有配置价格'); return }
  const st = utilityInput[card.key]
  let q
  try {
    q = utilityQuoteAt(card.price.price, card.unitShort,
      st.amount > 0 ? { amount: st.amount } : { qty: st.qty })
  } catch (e) { ElMessage.error(e.message); return }
  const dup = extras.value.findIndex(e => e.type === 'utility' && e.meta.itemId === card.itemId)
  const row = {
    key: 'util-' + card.itemId,
    type: 'utility',
    title: card.meterType === '电表' ? '电费充值' : '水费充值',
    sub: `${q.qty} ${card.unitShort} · ${card.price.price} 元/${card.unitShort} · ${card.price.tierName}`,
    amount: q.amount,
    meta: { itemId: card.itemId, qty: q.qty, unitPrice: card.price.price, priceId: card.price.priceId, tierName: card.price.tierName }
  }
  if (dup >= 0) extras.value.splice(dup, 1, row)
  else extras.value.push(row)
  st.amount = 0
  st.qty = 0
}

/* 改单人价：默认按业态取价，例外才改，且必须写原因 */
const priceDlg = reactive({ open: false, meterType: '', houseId: '', priceId: '', reason: '', tiers: [] })
function openPriceSwitch(card) {
  if (!activeHouse.value || !card.price) return
  Object.assign(priceDlg, {
    open: true,
    meterType: card.meterType,
    houseId: activeHouse.value.houseId,
    priceId: card.price.priceId,
    reason: '',
    tiers: utilityTierRows({ communityId: activeHouse.value.communityId, meterType: card.meterType })
  })
}
function confirmPriceSwitch() {
  try {
    setHouseUtilityPrice(priceDlg.houseId, priceDlg.meterType, priceDlg.priceId, priceDlg.reason)
    ElMessage.success('已切换该户价档，本次充值按新单价结算')
    priceDlg.open = false
  } catch (e) { ElMessage.error(e?.message || '切换失败') }
}

/* ---------------- ④ 加收：其他科目 / 押金 / 临时收费 ---------------- */
const extras = ref([])
const extraPanel = ref('')
const extraItemOpts = cashierExtraItemOpts()
const extraDepositOpts = depositCollectTypeOpts()

const extraForm = reactive({
  itemId: '', itemQty: 1, itemAmount: 0,
  depositType: '门禁卡押金', depositQty: 1, depositAmount: 0,
  tempName: '', tempAmount: 0, tempNote: ''
})

const extraDepositDef = computed(() => extraDepositOpts.find(o => o.value === extraForm.depositType) || null)
/* 有标准额就按标准额 × 数量；没有（履约/租约）必须按合同填，不能拿 0 充数 */
const isFixedDeposit = computed(() => Number(extraDepositDef.value?.standardAmount) > 0)
const extraDepositAmount = computed(() => {
  const d = extraDepositDef.value
  if (!d) return 0
  if (Number(d.standardAmount) > 0) {
    const q = d.byQuantity ? Math.max(1, Number(extraForm.depositQty) || 1) : 1
    return Math.round(d.standardAmount * q * 100) / 100
  }
  return Math.round((Number(extraForm.depositAmount) || 0) * 100) / 100
})
function onDepositType() {
  const d = extraDepositDef.value
  extraForm.depositQty = 1
  extraForm.depositAmount = 0
  /* 切到不要工期的类型时把旧的金额清掉，否则会把上一个类型的大小带过去 */
  if (!d) return
}

function toggleExtraPanel(k) { extraPanel.value = extraPanel.value === k ? '' : k }

/** 选了科目就按单价×数量带出金额 —— 留个 0.00 在那儿，没人知道该填什么 */
function syncExtraAmount() {
  const opt = extraItemOpts.find(o => o.value === extraForm.itemId)
  if (!opt) return
  const qty = Number(extraForm.itemQty) || 1
  extraForm.itemAmount = round2(opt.price * qty)
}

function addExtraItem() {
  if (isWalkin.value) { ElMessage.warning('其他科目要挂房屋计费，散客请用「临时收费」'); return }
  const opt = extraItemOpts.find(o => o.value === extraForm.itemId)
  if (!opt) { ElMessage.error('请先选择收费科目'); return }
  const qty = Number(extraForm.itemQty) || 1
  const amount = Number(extraForm.itemAmount) > 0 ? Number(extraForm.itemAmount) : opt.price * qty
  extras.value.push({
    key: 'other-' + Date.now(),
    type: 'other',
    title: opt.label.split('（')[0],
    sub: `其他收费科目 × ${qty}`,
    amount: Math.round(amount * 100) / 100,
    meta: { itemId: opt.value, itemName: opt.label.split('（')[0], qty }
  })
  Object.assign(extraForm, { itemId: '', itemQty: 1, itemAmount: 0 })
  extraPanel.value = ''
}

function addDeposit() {
  if (isWalkin.value) { ElMessage.warning('押金要挂到房屋台账上，散客请用「临时收费」'); return }
  const amount = extraDepositAmount.value
  if (!(amount > 0)) {
    ElMessage.error(isFixedDeposit.value ? '押金类型没有标准金额' : '金额按约定：请填写合同/租约约定的押金金额')
    return
  }
  const d = extraDepositDef.value
  const q = d?.byQuantity ? Math.max(1, Number(extraForm.depositQty) || 1) : 1
  extras.value.push({
    key: 'dep-' + Date.now(),
    type: 'deposit',
    title: extraForm.depositType,
    sub: `${d?.byQuantity ? '数量 ' + q + ' · ' : ''}${d?.needCheck ? '需验收' : '退卡/退牌即退'} · 可退，不计收入`,
    amount,
    meta: { type: extraForm.depositType, quantity: q, amount }
  })
  Object.assign(extraForm, { depositQty: 1, depositAmount: 0 })
  extraPanel.value = ''
}

function addTempCharge() {
  const name = String(extraForm.tempName || '').trim()
  if (!name) { ElMessage.error('临时收费必须写事项'); return }
  if (!(Number(extraForm.tempAmount) > 0)) { ElMessage.error('金额必须大于 0'); return }
  extras.value.push({
    key: 'tmp-' + Date.now(),
    type: 'temp',
    title: name,
    sub: '临时收费 · 需写说明',
    amount: Math.round(Number(extraForm.tempAmount) * 100) / 100,
    meta: { itemName: name, note: extraForm.tempNote }
  })
  Object.assign(extraForm, { tempName: '', tempAmount: 0, tempNote: '' })
  /* 散客多半一次要加好几笔（摊位费 + 押金卡），面板不收起 */
  extraPanel.value = isWalkin.value ? 'temp' : ''
}

function removeExtra(key) { extras.value = extras.value.filter(e => e.key !== key) }

/* ============================================================
 * ⑤ 散客 / 外来人员（2026-11-13）
 * ------------------------------------------------------------
 * 摆摊费、场地租用这类钱，付款方根本不是业主 —— 是门口摆摊的、来租场地的、
 * 施工队赔玻璃的。他们既没有业主档案，也没有房屋，挂不到任何应收上。
 *
 * 所以不硬塞进"业主"：左栏给一个固定的散客入口，中栏切到散客形态
 * （只有临时收费，没有物业费/车位/水电），收款时落 `partyType: '外部'`。
 * 硬挂一个业主会污染那户的收款流水，业主来查账时说不清。
 * ============================================================ */
const cmOpts = communityOpts()
const guest = reactive({ name: '', phone: '', communityId: cmOpts[0]?.id || '' })

/** 散客的必填校验。放在这里而不是提交时弹错，前台填到一半就知道差什么 */
const guestErr = computed(() => {
  if (!isWalkin.value) return ''
  if (!String(guest.name || '').trim()) return '请填写付款人姓名或单位'
  if (guest.phone && !/^1\d{10}$/.test(String(guest.phone).trim())) return '手机号应为 11 位'
  if (!guest.communityId) return '请选择所属项目'
  return ''
})

/** 落库时的付款方：散客走「外部」，业主走档案，两者字段口径不同 */
function payerOf() {
  if (isWalkin.value) {
    return {
      partyType: '外部',
      partyName: String(guest.name || '').trim(),
      partyPhone: String(guest.phone || '').trim(),
      communityId: guest.communityId,
      houseId: ''
    }
  }
  return {
    partyType: '业主',
    ownerId: ownerId.value,
    partyName: p.value?.owner?.name || '',
    houseId: activeHouse.value?.houseId || '',
    communityId: activeHouse.value?.communityId || ''
  }
}

/* 散客进来就默认打开临时收费；业主那边不默认展开，保持原来的"先看业务再决定加收" */
watch(isWalkin, v => {
  extraPanel.value = v ? 'temp' : ''
  if (v) { sel.value = []; discount.value = 0 }
})

/* 最近几笔外来收款：同一个摊位一天来两趟很常见，前台要能当场对上，
   也要能回答"我上午交过了" —— 所以切到散客就摆出来，收完款跟着刷新 */
const guestRecent = computed(() => {
  void payVer.value
  return recentTempCharges({ partyType: '外部', limit: 6 })
})

/* ---------------- 合计：收入与押金分开 ---------------- */
/**
 * 右栏清单：预缴按房合并成一行。
 * 「12 个月」快捷选择会产生 12 条预缴项，一条条列会撑爆右栏；
 * 合并成「2026-12 ~ 2027-11 · 共 12 期」一行 —— 金额照旧逐期落库，销账不受影响。
 */
const cartExtras = computed(() => {
  const out = []
  const groups = new Map()
  for (const e of extras.value) {
    if (e.type !== 'prepay') { out.push(e); continue }
    const hid = e.meta.houseId
    let g = groups.get(hid)
    if (!g) {
      g = { key: 'prepay-group-' + hid, type: 'prepay', title: e.title, amount: 0, group: true, periods: [], houseId: hid }
      groups.set(hid, g)
      out.push(g)
    }
    g.periods.push(e.meta.period)
    g.amount = r2(g.amount + e.amount)
  }
  for (const g of groups.values()) {
    g.count = g.periods.length
    g.sub = g.count === 1
      ? `${g.periods[0]} · 提前缴纳，收后即记已收`
      : `${g.periods[0]} ~ ${g.periods[g.periods.length - 1]} · 共 ${g.count} 期 · 收后即记已收`
  }
  return out
})
function removeExtraRow(e) {
  if (!e.group) { removeExtra(e.key); return }
  extras.value = extras.value.filter(x => !(x.type === 'prepay' && x.meta.houseId === e.houseId))
}

const billTotal = computed(() => sel.value.reduce((s, b) => s + (b.unpaid || 0), 0))
const extraIncomeTotal = computed(() =>
  extras.value.filter(e => e.type !== 'deposit').reduce((s, e) => s + e.amount, 0))
const depositIncomeTotal = computed(() =>
  extras.value.filter(e => e.type === 'deposit').reduce((s, e) => s + e.amount, 0))
const incomeSubtotal = computed(() => billTotal.value + extraIncomeTotal.value)

/* 实收 = 收入类 − 减免 + 押金。押金必须算进"要收多少钱"，
   但不能算进收入 —— 这两个数在报表里是两回事，界面上也得分开列。 */
const payableTotal = computed(() => Math.max(0,
  incomeSubtotal.value - (discount.value || 0) + depositIncomeTotal.value))

/* 校验口径与数据层同一份实现：页面提示与提交拦截不可能说两套话。
   一笔都没有时不报错 —— 收款成功后会被清空，若继续校验，右栏会立刻变红，
   看着像刚刚那笔出错了 */
const splitCheck = computed(() => {
  /* 先无条件读一次 payableTotal：放在 if 后面读，会在"没有选中项"的那个分支里
     漏掉依赖，之后加收再变更时这个 computed 不会重算 —— 表现就是金额已经变了，
     校验还在用旧总额，点收款被"超出 ¥410"拦住 */
  const total = payableTotal.value
  const count = sel.value.length + extras.value.length
  if (!count) return { ok: true, rows: [], sum: 0, total: 0, diff: 0, msg: '' }
  return paySplitCheck(splitRows.value, total)
})

/* 单行时金额跟随实收；多行时不动用户已填的值。
   必须放在 payableTotal 之后：watch 注册时会立刻跑一次 getter 收依赖，
   提前注册就会撞上 TDZ（Cannot access before initialization）。 */
watch(() => payableTotal.value, v => {
  if (splitRows.value.length === 1) splitRows.value[0].amount = v
})

const canPay = computed(() =>
  (sel.value.length + extras.value.length) > 0 && splitCheck.value.ok && !paying.value
  && !guestErr.value
  /* 减免必须选原因；需凭证/超额度时必须写依据。否则提交会被数据层拦住，
     但按钮亮着让人白点一次，体验更差 */
  && (!(Number(discount.value) > 0) || (!!waiveReasonId.value && (!waiveNeedNote.value || !!String(waiveNote.value).trim()))))

const pickedCount = computed(() => sel.value.length + extras.value.length)


/**
 * 把支付拆分压到指定金额。
 * payBills 只认账单部分，而前台看到的实收里还含车位续期、充电、押金 ——
 * 直接传全额会被它判成"超出"，所以账单那一笔要单独配平。
 * 最后一条吸收误差，避免 0.01 的尾差让校验通不过。
 */
function fitSplits(rows, target) {
  const sum = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  if (Math.abs(sum - target) < 0.01) return rows.map(r => ({ ...r }))
  if (sum <= 0 || rows.length === 1) return [{ method: rows[0].method, amount: target }]
  let acc = 0
  return rows.map((r, i) => {
    const isLast = i === rows.length - 1
    const v = isLast
      ? Math.round((target - acc) * 100) / 100
      : Math.round((Number(r.amount) || 0) / sum * target * 100) / 100
    acc = Math.round((acc + v) * 100) / 100
    return { method: r.method, amount: v }
  })
}

async function confirmPay() {
  if (!canPay.value) return
  const actual = payableTotal.value
  paying.value = true
  try {
    const done = []
    let res = null

    /* ① 账单：物业费账期、抄表水电待缴单 —— 走原链路，收款即销账 */
    const billIds = sel.value.map(b => b.billId)
    if (billIds.length) {
      /* 减免只作用在账单上（物业费减免是常态），不能拿去冲车位或押金 */
      const disc = Math.min(discount.value || 0, billTotal.value)
      const billTarget = Math.max(0, Math.round((billTotal.value - disc) * 100) / 100)
      res = payBills({
        billIds,
        splits: fitSplits(splitRows.value, billTarget),
        discount: disc,
        waiveReasonId: disc > 0 ? waiveReasonId.value : '',
        waiveNote: disc > 0 ? waiveNote.value : '',
        remark: remark.value
      })
      done.push(`${res.count} 笔账单已销账`)
    }

    /* ② 非账单项：落库方式各不相同，不能混进 payBills ——
          续期要改有效期、押金要进负债表、充值要存单价快照，都不是"销账" */
    for (const e of extras.value) {
      if (e.type === 'park') {
        const r = renewParking(e.meta.parkId, e.meta.months)
        done.push(`车位 ${r.parkNo} 续至 ${r.newExpire}`)
      } else if (e.type === 'utility') {
        const r = createUtilityCharge({
          houseId: activeHouse.value.houseId,
          itemId: e.meta.itemId,
          amount: e.amount,
          payMethod: splitRows.value[0]?.method || '微信支付'
        })
        done.push(`${r.itemName}充值 ${r.qty} ${r.unit}`)
      } else if (e.type === 'prepay') {
        const r = createPrepayForPeriod(e.meta)
        done.push(`${r.period} 预缴 ¥${money(r.amount)}`)
      } else if (e.type === 'deposit') {
        const r = collectDeposit({
          houseId: activeHouse.value.houseId,
          type: e.meta.type,
          quantity: e.meta.quantity,
          amount: e.meta.amount,
          remark: remark.value,
          /* 押金跟着这一单的收款方式走：客户刷 POS 交押金，流水记 POS、押金台账记现金，
             日报里这两笔就分到两个收款点，差额当场对不平。
             收款点是「谁在收」，收银台收的永远是前台。 */
          payMethod: splitRows.value[0]?.method || '现金',
          payPoint: '前台'
        })
        done.push(`${r.type} ¥${money(r.amount)}（不计收入）`)
      } else {
        /* 临时收费 / 其他科目都落「临时收费」台账：它没有应收，不进收缴率。
           reason 必须带 —— 数据层拿它校验，也拿它做收入分项，漏了直接报错。
           **建单之后必须再收一次款**：只 saveTempCharge 的话台账停在「待收款」，
           钱进了抽屉、系统里却没有这笔现金收入，日结会对不上。 */
        const itemName = e.meta.itemName || e.title
        const payMethod = splitRows.value[0]?.method || '微信支付'
        const tc = saveTempCharge({
          ...payerOf(),
          reason: itemName,
          itemName,
          amount: e.amount,
          payMethod,
          remark: e.meta.note || remark.value || '收银台加收'
        })
        payTempCharge(tc.chargeId, {
          splits: [{ method: payMethod, amount: e.amount }],
          remark: e.meta.note || ''
        })
        done.push(`${e.title} ¥${money(e.amount)}`)
      }
    }

    lastResult.value = res
      ? { ...res, received: actual, extraCount: extras.value.length }
      : { received: actual, count: 0, batchNo: 'AD' + String(Date.now()).slice(-8),
          methodText: isWalkin.value
            ? `散客 ${guest.name} · 临时收费（不进收缴率）`
            : '非账单收入（充值 / 续期 / 押金 / 临时收费）',
          items: extras.value.map(e => ({ title: e.title, amount: e.amount })) }
    if (res) await initTicket(res)
    payVer.value++
    ElMessage.success(`收款 ¥${money(actual)}${done.length ? ' · ' + done.join('，') : ''}`)
    sel.value = []
    extras.value = []
    /* 散客多半接着收下一个摊位，面板留在临时收费上 */
    extraPanel.value = isWalkin.value ? 'temp' : ''
    discount.value = 0
    waiveReasonId.value = ''
    waiveNote.value = ''
    remark.value = ''
    resetSplits()
  } catch (e) {
    ElMessage.error(e?.message || '收款失败')
  } finally {
    paying.value = false
  }
}
</script>

<style scoped>
.search-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.search-row .spacer { flex: 1; }
.quick { display: flex; align-items: center; gap: 3px; }

.cashier {
  display: grid; grid-template-columns: 284px minmax(0, 1fr) 320px;
  gap: 16px; margin-top: 16px; align-items: start;
}
.side { padding: 16px; }
.side-r { padding: 16px; position: sticky; top: 0; }

.olist { max-height: 520px; overflow-y: auto; margin: 0 -6px; padding: 0 6px; }
/* 楼栋 / 单元：左栏内联，不占中栏宽度 */
.locals { margin: 2px 0 8px; }
.locals__hint {
  display: flex; align-items: center; gap: 6px; margin-top: 6px;
  font-size: 11.5px; color: var(--biz-text-3);
}
.locals__hint .ellip { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oitem {
  display: flex; align-items: center; gap: 10px; padding: 9px 10px;
  border-radius: 8px; cursor: pointer; transition: background .15s;
}
.oitem:hover { background: var(--biz-bg-hover); }
.oitem.is-on { background: rgba(91,108,255,.08); box-shadow: inset 0 0 0 1px rgba(91,108,255,.28); }
.oitem__ava {
  width: 32px; height: 32px; flex: 0 0 32px; border-radius: 50%;
  background: var(--biz-gradient); color: #fff; display: grid; place-items: center;
  font-size: 13px; font-weight: 600;
}
.oitem__b { flex: 1; min-width: 0; }
.oitem__n { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
.oitem__t { font-size: 10.5px; color: var(--biz-text-3); background: var(--biz-bg-fill); border-radius: 999px; padding: 0 6px; }
.oitem__d { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.oitem__r { text-align: right; flex: 0 0 auto; }
.oitem__m { font-family: var(--biz-font-num); font-size: 13px; font-weight: 600; color: var(--biz-danger); white-space: nowrap; }
.oitem__s { font-size: 10.5px; color: var(--biz-text-3); }

.hcell { display: flex; align-items: center; gap: 6px; min-width: 0; }
.late { font-size: 10.5px; color: var(--biz-text-3); font-weight: 400; }

.sumline {
  display: flex; align-items: center; gap: 8px;
  padding-top: 12px; font-size: 12.5px; color: var(--biz-text-2);
}
.sumline .spacer { flex: 1; }
.sumline .dot { color: var(--biz-text-4); }

.pay-box { background: var(--biz-bg-fill); border-radius: 10px; padding: 14px; }
.pay-line { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--biz-text-2); padding: 6px 0; }
.pay-total {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-top: 8px; padding-top: 12px; border-top: 1px dashed var(--biz-border);
  font-size: 13px; color: var(--biz-text-1);
}
.pay-total b { font-size: 22px; color: var(--el-color-primary); font-family: var(--biz-font-num); }

.splits { display: flex; flex-direction: column; gap: 8px; }
.split-row { display: flex; align-items: center; gap: 8px; }
.split-foot { display: flex; align-items: center; gap: 8px; }
.split-foot .spacer { flex: 1; }
.split-check {
  display: flex; flex-direction: column; gap: 2px;
  margin-top: 10px; padding: 8px 10px; border-radius: 8px;
  font-size: 12px; background: var(--biz-bg-fill);
}
.split-check.is-ok { color: var(--biz-success, #2f9e6e); }
.split-check.is-warn { color: var(--biz-danger, #d64545); }
.split-check .money { font-family: var(--biz-font-num); }
.split-check__m { font-size: 11.5px; opacity: .9; }

.pay-done {
  margin-top: 12px; padding: 10px 12px; border-radius: 8px;
  background: rgba(47,158,110,.08); border: 1px solid rgba(47,158,110,.25);
}
.pay-done__h { display: flex; align-items: baseline; gap: 8px; font-size: 13px; color: var(--biz-success, #2f9e6e); }
.pay-done__h .muted { font-size: 11px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.pay-done__b { font-size: 12.5px; color: var(--biz-text-1); margin-top: 4px; }
.pay-done__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.pay-done__f { margin-top: 6px; }

/* 收款结果里的开票区 */
.tk { margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(47,158,110,.3); }
.tk__hd { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--biz-text-1); font-weight: 600; }
.tk__hd .spacer { flex: 1; }
.tk__row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.tk__k { font-size: 12px; color: var(--biz-text-3); width: 44px; flex: 0 0 44px; }
.tk__hint { font-size: 11px; color: var(--biz-text-3); }
.tk__ok { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; }
.tk__item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.tk__amt { margin-left: auto; font-family: var(--biz-font-num); color: var(--biz-text-2); }
.tk__f { margin-top: 4px; }
.tk__more { font-size: 11.5px; color: var(--biz-text-3); }

.pay-actions { display: flex; gap: 8px; margin-top: 18px; }
.tip {
  display: flex; gap: 8px; margin-top: 14px; padding: 10px;
  background: rgba(91,108,255,.06); border-radius: 8px;
  font-size: 11.5px; color: #5a6488; line-height: 1.6;
}
.is-danger { color: var(--biz-danger); }

.tenant-card {
  margin-top: 14px; padding: 12px 12px 10px; border-radius: 10px;
  border: 1px solid var(--biz-border-light); background: var(--biz-bg-fill);
}
.tenant-card__hd { display: flex; align-items: baseline; gap: 8px; }
.tenant-card__hd h4 { margin: 0; font-size: 13px; color: var(--biz-text-1); }
.tenant-card__hd .desc { font-size: 11px; color: var(--biz-text-3); }
.tenant-card__empty { font-size: 11.5px; color: var(--biz-text-3); margin-top: 8px; line-height: 1.6; }
.tenant-card__more { font-size: 11px; color: var(--biz-text-3); margin-top: 4px; }
.tenant-card__tip { font-size: 10.5px; color: var(--biz-text-3); margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--biz-border); }
.tline { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.tline__b { flex: 1; min-width: 0; }
.tline__n { font-size: 12.5px; color: var(--biz-text-1); display: flex; gap: 6px; align-items: baseline; }
.tline__r { font-size: 11px; color: var(--biz-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tline__m { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; }
.tline__m .is-warn { color: var(--biz-danger); }

/* ---------- 预收 / 充值（批 2） ---------- */
.mode-row {
  display: flex; align-items: center; gap: 14px;
  margin-top: 16px; padding: 10px 14px;
  background: var(--biz-bg-2); border-radius: 10px;
}
.mode-row .desc { font-size: 12px; color: var(--biz-text-3); }
.pp { margin-top: 16px; padding: 16px 18px; }
.pp__hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
.pp__hd .desc { font-size: 12px; color: var(--biz-text-3); }
.pp__form { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.pp__f { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pp__f label { font-size: 12px; color: var(--biz-text-2); }
.pp__f .req { color: #d9534f; }
.pp__seg { display: flex; }
.pp__preview { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: var(--biz-bg-2); }
.pp__nums { display: flex; flex-wrap: wrap; gap: 26px; }
.pp__nums .k { font-size: 12px; color: var(--biz-text-3); margin-right: 6px; }
.pp__nums b { font-family: var(--biz-font-num); font-size: 15px; }
.pp__nums b.is-ok { color: #2f9e6e; }
.pp__detail { margin-top: 12px; }
.pp__detail-hd { font-size: 12px; color: var(--biz-text-3); margin-bottom: 6px; }
.pp__detail-b { display: flex; flex-wrap: wrap; gap: 8px; }
.pp__chip {
  font-size: 12px; font-family: var(--biz-font-num);
  padding: 3px 8px; border-radius: 6px; background: #fff; border: 1px solid var(--biz-border);
}
.pp__foot { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.pp__foot .warn { font-size: 12px; color: #d98a1f; }
.pp__foot .spacer { flex: 1; }
.pp__result { margin-top: 14px; padding: 12px 14px; border-radius: 10px; border: 1px solid #2f9e6e33; background: #2f9e6e0d; }
.pp__result-hd { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.pp__result-hd .desc { font-size: 12px; color: var(--biz-text-3); }

/* ============================================================
 * 三栏 POS（2026-11-13）
 * 中栏三块各按业务规则造型：账期格子 / 有效期条 / 换算卡。
 * 统一卡片、统一圆角，但内部形态不同 —— 规则不同的东西长得一样，
 * 前台就得在脑子里做翻译。
 * ============================================================ */
.pos {
  display: grid;
  grid-template-columns: 262px minmax(0, 1fr) 322px;
  gap: 14px;
  margin-top: 14px;
  align-items: start;
}
.pos-left, .pos-right { padding: 14px; }
.pos-left { position: sticky; top: 0; }
.pos-right { position: sticky; top: 0; }
.pos-mid { display: flex; flex-direction: column; gap: 12px; min-width: 0; }

.pos-left__tools { margin: -4px 0 8px; }

/* 客户条 */
.who { display: flex; align-items: center; gap: 14px; padding: 12px 16px; }
.who__a {
  width: 42px; height: 42px; flex: 0 0 42px; border-radius: 12px;
  background: var(--biz-gradient); color: #fff; display: grid; place-items: center;
  font-size: 15px; font-weight: 600;
}
.who__m { flex: 1; min-width: 0; }
.who__n { font-size: 15.5px; font-weight: 600; display: flex; align-items: center; gap: 7px; }
.who__s { font-size: 12px; color: var(--biz-text-3); margin-top: 3px; }
.who__kpi { display: flex; gap: 22px; }
.who__kpi .k { font-size: 11.5px; color: var(--biz-text-3); white-space: nowrap; }
.who__kpi .v { font-family: var(--biz-font-num); font-size: 16.5px; font-weight: 600; margin-top: 1px; }
.who__kpi .v.is-red { color: var(--biz-danger); }

/* 业务块 */
.blk { padding: 12px 14px 14px; }
.blk__hd { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
.blk__hd b { font-size: 13px; }
.blk__sub { font-size: 11.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.blk__tip { font-size: 11px; color: var(--biz-text-3); }
.blk__empty { padding: 14px 0 4px; font-size: 12px; color: var(--biz-text-3); text-align: center; }
.blk .spacer { flex: 1; }

/* 模式小标签 */
.md { font-size: 10.5px; padding: 1px 6px; border-radius: 4px; line-height: 16px; }
.md--due { background: #fdeceb; color: #c9433f; }
.md--cyc { background: #eef0ff; color: #4a58d8; }
.md--pre { background: #fdf3e3; color: #a76b13; }
.md--meter { background: #e8f7f0; color: #1f7a53; }
.md--off { background: #eef0f4; color: #7b8399; }

.tagm { font-size: 10.5px; padding: 0 5px; border-radius: 4px; line-height: 16px; font-weight: 400; }
.tagm--r { background: #fdeceb; color: #c9433f; }
.tagm--g { background: #e8f7f0; color: #1f7a53; }
.tagm--y { background: #fdf3e3; color: #a76b13; }
.tagm--b { background: #eef0ff; color: #4a58d8; }

/* ① 账期格子 */
.pgrid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 12px; }
.pcell {
  border: 1px solid var(--biz-border); border-radius: 8px;
  padding: 9px 10px; background: #fff; cursor: pointer;
  transition: border-color .15s, box-shadow .15s; position: relative;
}
.pcell:hover { border-color: var(--el-color-primary); }
.pcell__m { font-size: 10.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.pcell__v { font-size: 12.5px; font-family: var(--biz-font-num); font-weight: 600; margin-top: 3px; }
.pcell__s { font-size: 10px; margin-top: 2px; color: var(--biz-text-3); }
.pcell__bill {
  position: absolute; top: 6px; right: 7px; font-size: 9.5px; line-height: 13px;
  padding: 0 4px; border-radius: 3px; background: #eef0ff; color: #4a58d8;
}
.pcell.is-paid { background: #f3faf6; border-color: #cfe9dd; }
.pcell.is-paid .pcell__v { color: var(--biz-success, #2f9e6e); }
.pcell.is-due { background: #fdf4f3; border-color: #f4d3d0; }
.pcell.is-due .pcell__v { color: var(--biz-danger); }
.pcell.is-fut { background: var(--biz-bg-fill); border-style: dashed; }
.pcell.is-fut .pcell__v { color: var(--biz-text-3); }
.pcell.is-picked {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px rgba(91,108,255,.18);
  background: #fbfbff;
}

/* ② 车位有效期 */
.park { display: flex; align-items: center; gap: 14px; margin-top: 10px; }
.park__i {
  width: 38px; height: 38px; flex: 0 0 38px; border-radius: 10px;
  background: #eef0ff; color: #4a58d8; display: grid; place-items: center;
  font-size: 13px; font-weight: 600; font-family: var(--biz-font-num);
}
.park__m { flex: 1; min-width: 0; }
.park__n { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.park__s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 3px; font-family: var(--biz-font-num); }
.park__s b { color: var(--biz-text-1); }
.park__act { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.park__act > span {
  font-size: 12px; padding: 6px 10px; border: 1px solid var(--biz-border);
  border-radius: 7px; color: var(--biz-text-2); cursor: pointer; background: #fff;
}
.park__act > span.is-on {
  border-color: var(--el-color-primary); color: var(--el-color-primary);
  background: rgba(91,108,255,.08); font-weight: 500;
}

/* ③ 水电 */
.util { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.ucard {
  border: 1px solid var(--biz-border); border-radius: 9px;
  padding: 11px 12px; display: flex; flex-direction: column; gap: 9px;
}
.ucard.is-off { background: var(--biz-bg-fill); border-style: dashed; }
.ucard__hd { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ucard__hd b { font-size: 12.5px; }
.ucard__price { font-size: 11.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.ucard__off { font-size: 11.5px; color: var(--biz-text-3); line-height: 1.7; padding: 6px 0; }
.ucard__b { display: flex; align-items: center; gap: 7px; }
.ucard__eq { color: var(--biz-text-3); font-size: 13px; }
.ucard__f { font-size: 11px; color: var(--biz-text-3); }

/* 抄表待缴单 */
.olist2 { display: flex; flex-direction: column; gap: 5px; }
.orow {
  display: flex; align-items: center; gap: 9px;
  font-size: 11.5px; padding: 6px 9px; border-radius: 7px;
  background: var(--biz-bg-fill); cursor: pointer;
  border: 1px solid transparent;
}
.orow:hover { border-color: var(--biz-border); }
.orow.is-picked { background: #fdf4f3; border-color: #f4d3d0; }
.orow__p { font-family: var(--biz-font-num); color: var(--biz-text-2); flex: 0 0 60px; }
.orow__q { color: var(--biz-text-3); font-family: var(--biz-font-num); flex: 1; }
.orow__a { font-family: var(--biz-font-num); font-weight: 600; }
.orow__st { font-size: 10.5px; color: var(--biz-danger); flex: 0 0 auto; }

/* 右栏清单 */
.cart { margin: 8px -4px 10px; max-height: 260px; overflow-y: auto; padding: 0 4px; }
.ci { display: flex; gap: 9px; align-items: flex-start; padding: 8px 6px; border-radius: 7px; }
.ci:hover { background: var(--biz-bg-hover); }
.ci__x {
  width: 16px; height: 16px; flex: 0 0 16px; border-radius: 50%;
  background: var(--biz-bg-fill); color: var(--biz-text-3); font-size: 11px;
  display: grid; place-items: center; cursor: pointer; margin-top: 1px;
}
.ci__m { flex: 1; min-width: 0; }
.ci__n { font-size: 12.5px; font-weight: 500; display: flex; align-items: center; gap: 5px; }
.ci__s { font-size: 11px; color: var(--biz-text-3); margin-top: 2px; font-family: var(--biz-font-num); }
.ci__v { font-family: var(--biz-font-num); font-size: 13px; font-weight: 600; }
.cart__empty { padding: 18px 8px; text-align: center; font-size: 12px; color: var(--biz-text-3); line-height: 1.7; }

/* 加收面板 */
.add { border: 1px solid var(--biz-border); border-radius: 9px; overflow: hidden; margin-bottom: 12px; }
.add__tabs { display: flex; background: var(--biz-bg-fill); }
.add__tabs > span {
  flex: 1; text-align: center; font-size: 12px; padding: 7px 0;
  color: var(--biz-text-2); cursor: pointer;
}
.add__tabs > span.is-on {
  background: #fff; color: var(--el-color-primary); font-weight: 500;
  box-shadow: inset 0 -2px 0 var(--el-color-primary);
}
.add__body { padding: 9px 10px; display: flex; flex-direction: column; gap: 7px; }
.add__row { display: flex; align-items: center; gap: 7px; }
.add__amt { font-family: var(--biz-font-num); font-weight: 600; flex: 1; }
.add__warn { font-size: 10.5px; color: #a76b13; line-height: 1.6; }
.add__more { font-size: 10.5px; color: var(--biz-text-3); display: flex; align-items: center; gap: 2px; }

/* 合计 */
.sum { border-top: 1px solid var(--biz-border-light); padding-top: 10px; margin-bottom: 12px; }
.sum__r { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--biz-text-2); padding: 4px 0; }
.sum__r b { font-family: var(--biz-font-num); font-weight: 500; color: var(--biz-text-1); }
.sum__r b.is-muted { color: var(--biz-text-3); }
.waive-fld { display: flex; align-items: center; gap: 6px; }
.opt-sub { float: right; margin-left: 10px; color: var(--biz-text-3); font-size: 11px; }
.waive-note { margin: 2px 0 6px; }
.waive-note__warn {
  margin-top: 4px; font-size: 11.5px; color: #a33;
  background: #fff5f5; border: 1px solid #f5c2c2; border-radius: 6px; padding: 4px 8px;
}
.waive-note__tip { margin-top: 4px; font-size: 11.5px; color: var(--biz-text-3); }
.sum__total {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-top: 7px; padding-top: 9px; border-top: 1px dashed var(--biz-border);
}
.sum__total span { font-size: 13px; color: var(--biz-text-2); }
.sum__total b {
  font-family: var(--biz-font-num); font-size: 26px; font-weight: 600;
  color: var(--biz-danger); letter-spacing: -.5px;
}

.split-row__x {
  width: 20px; flex: 0 0 20px; text-align: center; cursor: pointer;
  color: var(--biz-text-3); font-size: 14px; line-height: 24px;
}
.split-row__x:hover { color: var(--biz-danger); }
.split-row__x.is-disabled { cursor: not-allowed; opacity: .35; }

.pay-actions { display: flex; gap: 8px; margin-top: 12px; }
.pay-actions .el-button { height: 42px; }

@media (max-width: 1440px) {
  .pos { grid-template-columns: 240px minmax(0, 1fr) 300px; }
  .pgrid { grid-template-columns: repeat(4, 1fr); }
}

/* 块脚注 */
.blk__foot { margin-top: 10px; font-size: 11px; color: var(--biz-text-3); }
.blk__foot b { color: var(--biz-text-2); font-weight: 500; }

/* 加收：中栏一行式 */
.addblk .blk__hd { align-items: center; }
.addtabs { display: flex; gap: 0; border: 1px solid var(--biz-border); border-radius: 7px; overflow: hidden; }
.addtabs > span {
  font-size: 12px; padding: 5px 12px; color: var(--biz-text-2);
  cursor: pointer; background: #fff; border-right: 1px solid var(--biz-border);
}
.addtabs > span:last-child { border-right: none; }
.addtabs > span:hover { background: var(--biz-bg-hover); }
.addtabs > span.is-on { background: var(--el-color-primary); color: #fff; font-weight: 500; }
.addrow { display: flex; align-items: center; gap: 8px; margin-top: 11px; flex-wrap: wrap; }
.addrow__eq { font-size: 12px; color: var(--biz-text-3); }
.addrow__amt { font-family: var(--biz-font-num); font-size: 14px; font-weight: 600; min-width: 76px; }
.addrow__tip { font-size: 11px; color: var(--biz-text-3); }
.addrow__tip.is-warn { color: #a76b13; }
.addrow--hint { font-size: 12px; color: var(--biz-text-3); padding: 6px 0 2px; }
.ucard__hint { color: var(--biz-text-3); }

/* 独立页（无后台外壳） */
.pos-standalone { padding: 14px 20px 20px; }
.pos-bar {
  display: flex; align-items: center; gap: 12px;
  height: 46px; padding: 0 16px; margin-bottom: 12px;
  background: #fff; border-radius: 10px;
  box-shadow: 0 1px 3px rgba(31,37,64,.05);
}
.pos-bar__logo { display: flex; align-items: center; gap: 8px; font-size: 14.5px; font-weight: 600; }
.pos-bar__logo .dot {
  width: 22px; height: 22px; border-radius: 7px;
  background: var(--biz-gradient); color: #fff;
  display: grid; place-items: center; font-size: 11.5px;
}
.pos-bar__sep { width: 1px; height: 18px; background: var(--biz-border); }
.pos-bar__meta { font-size: 12.5px; color: var(--biz-text-3); }
.pos-bar__time { font-size: 12.5px; color: var(--biz-text-2); font-family: var(--biz-font-num); }

.recent { margin-top: 10px; }
.rrow {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; padding: 6px 0; color: var(--biz-text-2);
  border-bottom: 1px dashed var(--biz-border-light);
}
.rrow:last-child { border-bottom: none; }
.rrow__t { font-family: var(--biz-font-num); color: var(--biz-text-3); flex: 0 0 88px; }
.rrow__n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rrow__w { color: var(--biz-text-3); flex: 0 0 64px; }
.rrow__a { font-family: var(--biz-font-num); font-weight: 600; flex: 0 0 78px; text-align: right; }

/* ---------- 账期两段 + 快捷缴费（2026-11-13） ---------- */
.pseg { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.pseg--past { margin-top: 10px; }
.pseg__t { font-size: 11.5px; font-weight: 500; color: var(--biz-text-2); }
.pseg__hint { font-size: 11px; color: var(--biz-text-3); }
.pseg__sum {
  display: flex; align-items: baseline; gap: 4px;
  font-size: 11.5px; color: var(--biz-text-2);
}
/* 已选期数/合计：放在块头，跟"该收多少"对齐，不塞在某个分段里 */
.blk__pick {
  display: flex; align-items: baseline; gap: 4px;
  padding: 1px 8px; border-radius: 6px;
  background: rgba(91,108,255,.08);
  font-size: 11.5px; color: var(--biz-text-2);
}
.blk__pick b { font-family: var(--biz-font-num); color: var(--el-color-primary); font-size: 13px; }
.blk__pick i { font-style: normal; font-size: 10.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.pseg__sum b { font-family: var(--biz-font-num); color: var(--el-color-primary); }
.pseg__sum b.is-amt { font-size: 14px; }
.pseg__sum i { font-style: normal; font-size: 10.5px; color: var(--biz-text-3); font-family: var(--biz-font-num); }
.pseg .spacer { flex: 1; }
.pquick { display: flex; align-items: center; gap: 6px; }
.pquick > span {
  display: flex; align-items: center; gap: 4px;
  font-size: 11.5px; padding: 4px 8px; border-radius: 6px;
  border: 1px solid var(--biz-border); background: #fff;
  color: var(--biz-text-2); cursor: pointer; transition: all .15s;
}
.pquick > span i { font-style: normal; font-family: var(--biz-font-num); font-size: 11px; color: var(--biz-text-3); }
.pquick > span:hover { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.pquick > span.is-on {
  border-color: var(--el-color-primary); background: rgba(91,108,255,.08);
  color: var(--el-color-primary); font-weight: 500;
}
.pquick > span.is-on i { color: var(--el-color-primary); }
.pquick > span.pquick__clear { border-style: dashed; color: var(--biz-text-3); }
.pquick > span.pquick__clear:hover { color: var(--biz-danger); border-color: var(--biz-danger); }
.pseg + .pgrid { margin-top: 8px; }

/* ---------- 散客 / 外来人员（2026-11-13） ---------- */
.oitem--walkin { margin-bottom: 2px; }
.oitem__ava--walkin { background: linear-gradient(135deg, #f0a020, #e2820f); }
.olist__div { height: 1px; background: var(--biz-border-light); margin: 6px 6px 8px; }
.who--guest { border: 1px dashed #f2cd80; background: #fffdf7; }
.who__a--guest { background: linear-gradient(135deg, #f0a020, #e2820f); }
.guestf { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.guestwarn {
  display: flex; align-items: center; gap: 6px; margin-top: -4px;
  padding: 8px 12px; border-radius: 8px;
  background: #fdf3e3; color: #a76b13; font-size: 12px;
}
.temphint { margin-top: 8px; font-size: 11px; color: var(--biz-text-3); }
.temphint b { color: var(--biz-text-2); font-weight: 500; }
</style>
