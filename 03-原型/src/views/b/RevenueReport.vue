<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>经营报表</b>：三率不是三个百分比，是<b>同一套数的三种切法</b>，所以一次算完 ——
        <b>应收</b>按账期铺（不看有没有开单）、<b>已收</b>与<b>减免</b>来自同一张矩阵、
        <b>未收 = 应收 − 已收 − 减免</b>（<b>不减到 0</b>：超额收款会显示负数，那是有用的信息）。
        <br />
        报表自带一条自检线：<code>已收 + 减免 + 未收 = 应收</code>。对不上就说明矩阵里有孤儿流水，
        或者某期应收算错了 —— 这条线不通过时，下面的百分比一个都不能信。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <el-form class="filter-bar" label-width="64px" @submit.prevent>
        <el-form-item label="账期">
          <el-date-picker v-model="from" type="month" value-format="YYYY-MM" style="width:118px" :clearable="false" />
          <span class="rng">至</span>
          <el-date-picker v-model="to" type="month" value-format="YYYY-MM" style="width:118px" :clearable="false" />
        </el-form-item>
        <el-form-item label="项目">
          <el-select v-model="communityId" placeholder="全部项目" clearable style="width:132px">
            <el-option v-for="c in cmOpts" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="收费项">
          <el-select v-model="itemId" style="width:150px">
            <el-option v-for="i in itemOpts" :key="i.value" :label="i.label" :value="i.value" />
          </el-select>
        </el-form-item>
        <el-form-item class="acts" style="margin-left:auto;">
          <el-button :icon="'Download'" @click="onExport">导出报表</el-button>
        </el-form-item>
      </el-form>
    </div>

    <el-tabs v-model="tab" style="margin-top:6px;">
      <!-- ============ 三率 ============ -->
      <el-tab-pane label="三率与清欠" name="rate">
        <div class="grid" style="margin-top:12px;grid-template-columns:repeat(6,minmax(0,1fr));">
          <div class="panel rsum" data-card="r-rcv">
            <div class="rsum__l">应收</div>
            <div class="rsum__v">¥ {{ wan(rate.receivable) }}</div>
            <div class="rsum__s">{{ rate.houses }} 户 × {{ rate.periods }} 期</div>
          </div>
          <div class="panel rsum" data-card="r-paid">
            <div class="rsum__l">已收</div>
            <div class="rsum__v">¥ {{ wan(rate.received) }}</div>
            <div class="rsum__s">矩阵流水，含预缴与清欠</div>
          </div>
          <div class="panel rsum" data-card="r-waive">
            <div class="rsum__l">减免</div>
            <div class="rsum__v">¥ {{ wan(rate.waived) }}</div>
            <div class="rsum__s">应收不减，单列扣分母</div>
          </div>
          <div class="panel rsum" data-card="r-unpaid">
            <div class="rsum__l">未收</div>
            <div class="rsum__v" :class="rate.unpaid > 0 ? 'money--out' : ''">¥ {{ wan(rate.unpaid) }}</div>
            <div class="rsum__s">{{ rate.unpaid < 0 ? '负数 = 超额收款' : '欠费余额' }}</div>
          </div>
          <div class="panel rsum" data-card="r-collect">
            <div class="rsum__l">收缴率</div>
            <div class="rsum__v">{{ rate.collectionRate }}<span class="unit">%</span></div>
            <div class="rsum__s">已收 ÷ (应收 − 减免)</div>
          </div>
          <div class="panel rsum" data-card="r-arrears">
            <div class="rsum__l">欠费率</div>
            <div class="rsum__v" :class="rate.arrearsRate > 10 ? 'money--out' : ''">{{ rate.arrearsRate }}<span class="unit">%</span></div>
            <div class="rsum__s">1 − 收缴率</div>
          </div>
        </div>

        <!-- 自检线：不通过时百分比全部作废 -->
        <div class="check" :class="rate.identity.ok ? 'is-ok' : 'is-bad'">
          <b>{{ rate.identity.ok ? '✓ 恒等式成立' : '✗ 恒等式不成立，下面的百分比不能用' }}</b>
          <span>
            已收 ¥{{ money(rate.received) }} + 减免 ¥{{ money(rate.waived) }} + 未收 ¥{{ money(rate.unpaid) }}
            = ¥{{ money(rate.received + rate.waived + rate.unpaid) }}，
            应收 ¥{{ money(rate.receivable) }}
            <template v-if="!rate.identity.ok">（差 ¥{{ money(rate.identity.diff) }}）</template>
          </span>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="panel rsum is-soft">
            <div class="rsum__l">预缴率（{{ to }} 之后 12 期）</div>
            <div class="rsum__v">{{ rate.prepayRate }}<span class="unit">%</span></div>
            <div class="rsum__s">已预收 ¥{{ money(rate.prepayReceived) }} / 应收 ¥{{ money(rate.prepayReceivable) }}</div>
          </div>
          <div class="panel rsum is-soft">
            <div class="rsum__l">清欠额（{{ from }} 之前）</div>
            <div class="rsum__v">¥ {{ wan(rate.clearingAmount) }}</div>
            <div class="rsum__s">本期收回的历史欠费，不算本期收缴率</div>
          </div>
          <div class="panel rsum is-soft">
            <div class="rsum__l">现金收入（按收款日）</div>
            <div class="rsum__v">¥ {{ wan(rate.cashIncome) }}</div>
            <div class="rsum__s">与归属口径并行，可互相勾稽</div>
          </div>
          <div class="panel rsum is-soft">
            <div class="rsum__l">超额收款户</div>
            <div class="rsum__v">{{ rate.overpaid }}<span class="unit">户</span></div>
            <div class="rsum__s">未收为负，通常是预缴冲到了已收满的期</div>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>按账期</h4>
            <span class="desc">哪一期掉下去，一眼能看出来</span>
          </div>
          <el-table :data="rate.byPeriod" size="small" max-height="320">
            <el-table-column prop="period" label="账期" width="96" />
            <el-table-column label="应收" width="130" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.receivable) }}</span></template>
            </el-table-column>
            <el-table-column label="已收" width="130" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.received) }}</span></template>
            </el-table-column>
            <el-table-column label="减免" width="110" align="right">
              <template #default="{ row }"><span class="num">{{ row.waived ? '¥' + money(row.waived) : '—' }}</span></template>
            </el-table-column>
            <el-table-column label="未收" width="130" align="right">
              <template #default="{ row }">
                <span class="num" :class="row.unpaid > 0 ? 'money--out' : ''">¥{{ money(row.unpaid) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="收缴率" min-width="180">
              <template #default="{ row }">
                <div class="rbar">
                  <i :style="{ width: Math.min(100, rowRate(row)) + '%' }" :class="{ 'is-low': rowRate(row) < 70 }" />
                  <span>{{ rowRate(row) }}%</span>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>欠费 TOP 8</h4>
            <span class="desc">按未收金额倒序，负数在最后（超额收款）</span>
          </div>
          <el-table :data="rate.topDebtors" size="small" max-height="300">
            <el-table-column prop="houseName" label="房屋" min-width="200" show-overflow-tooltip />
            <el-table-column label="应收" width="130" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.receivable) }}</span></template>
            </el-table-column>
            <el-table-column label="已收" width="130" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.received) }}</span></template>
            </el-table-column>
            <el-table-column label="未收" width="130" align="right">
              <template #default="{ row }">
                <span class="num" :class="row.unpaid > 0 ? 'money--out' : ''">¥{{ money(row.unpaid) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="110">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.unpaid > 0 ? 'danger' : 'success'">
                  {{ row.unpaid > 0 ? '欠费' : '超额' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============ 收支与结余 ============ -->
      <el-tab-pane label="收支与结余" name="pl">
        <div class="grid" style="margin-top:12px;grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="panel rsum" data-card="p-inc">
            <div class="rsum__l">收入合计</div>
            <div class="rsum__v">¥ {{ wan(pl.incomeTotal) }}</div>
            <div class="rsum__s">账单实收 + 合同 + 临时 + 补录</div>
          </div>
          <div class="panel rsum" data-card="p-exp">
            <div class="rsum__l">支出合计</div>
            <div class="rsum__v money--out">¥ {{ wan(pl.expenseTotal) }}</div>
            <div class="rsum__s">报销 + 工资 + 合同摊 + 补录</div>
          </div>
          <div class="panel rsum" data-card="p-bal">
            <div class="rsum__l">结余</div>
            <div class="rsum__v" :class="pl.balance < 0 ? 'money--out' : ''">¥ {{ wan(pl.balance) }}</div>
            <div class="rsum__s">
              {{ pl.balance < 0 ? '收入不足支出 · 见页脚「演示数据说明」' : '收入 − 支出 · 不含押金（负债）' }}
            </div>
          </div>
          <div class="panel rsum" data-card="p-margin">
            <div class="rsum__l">结余率</div>
            <div class="rsum__v">{{ pl.margin }}<span class="unit">%</span></div>
            <div class="rsum__s">结余 ÷ 收入</div>
          </div>
        </div>

        <div class="two" style="margin-top:16px;">
          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;"><h4>收入分项</h4><span class="desc">{{ pl.incomeRows.length }} 个分类</span></div>
            <el-table :data="pl.incomeRows" size="small" max-height="380">
              <el-table-column label="分类" min-width="150">
                <template #default="{ row }">
                  <div class="nowrap">{{ row.name }}</div>
                  <div class="ps-sub">{{ row.parentName }}</div>
                </template>
              </el-table-column>
              <el-table-column label="金额" width="130" align="right">
                <template #default="{ row }"><span class="num money">¥{{ money(row.amount) }}</span></template>
              </el-table-column>
              <el-table-column label="占比" width="76" align="right">
                <template #default="{ row }">{{ incPct(row.amount) }}%</template>
              </el-table-column>
            </el-table>
          </div>

          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;"><h4>支出分项</h4><span class="desc">{{ pl.expenseRows.length }} 个分类</span></div>
            <el-table :data="pl.expenseRows" size="small" max-height="380">
              <el-table-column label="分类" min-width="150">
                <template #default="{ row }">
                  <div class="nowrap">{{ row.name }}</div>
                  <div class="ps-sub">{{ row.parentName }}</div>
                </template>
              </el-table-column>
              <el-table-column label="金额" width="130" align="right">
                <template #default="{ row }"><span class="num money--out">¥{{ money(row.amount) }}</span></template>
              </el-table-column>
              <el-table-column label="占比" width="76" align="right">
                <template #default="{ row }">{{ expPct(row.amount) }}%</template>
              </el-table-column>
            </el-table>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>按月趋势</h4>
            <span class="desc">结余为负的月份标红 —— 单月亏损不是问题，连续三个月才是</span>
          </div>
          <el-table :data="pl.byMonth" size="small" max-height="300">
            <el-table-column prop="period" label="账期" width="96" />
            <el-table-column label="收入" width="140" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.income) }}</span></template>
            </el-table-column>
            <el-table-column label="支出" width="140" align="right">
              <template #default="{ row }"><span class="num money--out">¥{{ money(row.expense) }}</span></template>
            </el-table-column>
            <el-table-column label="结余" width="140" align="right">
              <template #default="{ row }">
                <span class="num" :class="{ 'money--out': row.balance < 0 }">¥{{ money(row.balance) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="水位" min-width="160">
              <template #default="{ row }">
                <div class="rbar">
                  <i :style="{ width: monthPct(row) + '%' }" :class="{ 'is-low': row.balance < 0 }" />
                  <span>{{ monthPct(row) }}%</span>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============ 减免分析 ============ -->
      <el-tab-pane label="减免分析" name="waive">
        <div class="grid" style="margin-top:12px;grid-template-columns:repeat(5,minmax(0,1fr));">
          <div class="panel rsum" data-card="w-total">
            <div class="rsum__l">减免总额</div>
            <div class="rsum__v">¥ {{ wan(waive.total) }}</div>
            <div class="rsum__s">{{ waive.reasons.length }} 个原因</div>
          </div>
          <div class="panel rsum" data-card="w-count">
            <div class="rsum__l">笔数</div>
            <div class="rsum__v">{{ waive.count }}<span class="unit">笔</span></div>
            <div class="rsum__s">一张账单分两次减 = 两笔</div>
          </div>
          <div class="panel rsum" data-card="w-houses">
            <div class="rsum__l">涉及户数</div>
            <div class="rsum__v">{{ waive.houses }}<span class="unit">户</span></div>
            <div class="rsum__s">占应收户数的 {{ houseShare }}%</div>
          </div>
          <div class="panel rsum" data-card="w-avg">
            <div class="rsum__l">单笔均值</div>
            <div class="rsum__v">¥ {{ money(waive.avg) }}</div>
            <div class="rsum__s">看是否有"一笔抹掉"的异常</div>
          </div>
          <div class="panel rsum" data-card="w-over">
            <div class="rsum__l">超免审额度</div>
            <div class="rsum__v" :class="waive.overLimitCount > 0 ? 'money--out' : ''">{{ waive.overLimitCount }}<span class="unit">笔</span></div>
            <div class="rsum__s">超过该原因的审批线，必须有依据</div>
          </div>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:1.4fr 1fr;">
          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;">
              <h4>按原因</h4>
              <span class="desc">政策性让的，还是差错改出来的 —— 两者的钱一样多，性质不一样</span>
            </div>
            <el-table :data="waive.reasons" size="small" max-height="360">
              <el-table-column label="原因" min-width="150">
                <template #default="{ row }">
                  <div class="nowrap">{{ row.name }}</div>
                  <div class="ps-sub">{{ row.type }}<template v-if="row.countInAssess"> · 计入考核</template></div>
                </template>
              </el-table-column>
              <el-table-column prop="count" label="笔数" width="70" align="right" />
              <el-table-column label="金额" width="130" align="right">
                <template #default="{ row }"><span class="num money--out">¥{{ money(row.amount) }}</span></template>
              </el-table-column>
              <el-table-column label="占比" width="90" align="right">
                <template #default="{ row }">
                  <div class="rbar">
                    <i :style="{ width: Math.max(2, row.share) + '%' }" />
                    <span>{{ row.share }}%</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="超额度" width="80" align="right">
                <template #default="{ row }">
                  <span :class="{ 'money--out': row.overLimit > 0 }">{{ row.overLimit || '—' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;"><h4>按账期</h4><span class="desc">哪一期放宽了口子</span></div>
            <el-table :data="waive.byPeriod" size="small" max-height="360">
              <el-table-column prop="period" label="账期" width="96" />
              <el-table-column prop="count" label="笔数" width="70" align="right" />
              <el-table-column label="金额" min-width="110" align="right">
                <template #default="{ row }"><span class="num money--out">¥{{ money(row.amount) }}</span></template>
              </el-table-column>
            </el-table>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>金额最大的 {{ waive.detail.length }} 笔</h4>
            <span class="desc">逐笔查在账单页；这里只看"哪几笔最贵"</span>
          </div>
          <el-table :data="waive.detail" size="small" max-height="320">
            <el-table-column prop="houseName" label="房屋" min-width="170" />
            <el-table-column prop="period" label="账期" width="90" />
            <el-table-column prop="itemName" label="科目" width="130" />
            <el-table-column prop="reasonName" label="原因" width="120" />
            <el-table-column label="金额" width="110" align="right">
              <template #default="{ row }"><span class="num money--out">¥{{ money(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column prop="at" label="时间" width="130" />
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============ 欠费与账龄 ============ -->
      <el-tab-pane label="欠费与账龄" name="aging">
        <div class="panel aging-bar" style="margin-top:12px;">
          <div class="aging-bar__hd">
            <span>截至 <b>{{ aging.asOf }}</b> · 共 <b>{{ aging.count }}</b> 张 / <b>{{ aging.houses }}</b> 户 / <b>¥{{ money(aging.total) }}</b></span>
            <span class="desc">与「报表中心 · 欠费账龄」同分档，但这里是<b>实时</b>算；那边读跑批快照，同一 statDate 反复看不会变</span>
          </div>
          <div class="aging-bar__bars">
            <div v-for="r in aging.rows" :key="r.bucket" class="aging-seg" :data-bucket="r.bucket">
              <div class="aging-seg__t">{{ r.bucket }}</div>
              <div class="aging-seg__v">¥{{ wan(r.amount) }}</div>
              <div class="aging-seg__p">{{ r.share }}% · {{ r.houses }} 户</div>
            </div>
          </div>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:1.3fr 1fr;">
          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;">
              <h4>分档明细</h4>
              <span class="desc">90 天以上收不回来，基本就是坏账</span>
            </div>
            <el-table :data="aging.rows" size="small" max-height="320">
              <el-table-column prop="bucket" label="账龄" width="110" />
              <el-table-column prop="count" label="账单数" width="86" align="right" />
              <el-table-column prop="houses" label="户数" width="76" align="right" />
              <el-table-column label="金额" width="130" align="right">
                <template #default="{ row }"><span class="num" :class="{ 'money--out': isBadAging(row.bucket) }">¥{{ money(row.amount) }}</span></template>
              </el-table-column>
              <el-table-column label="占比" min-width="130">
                <template #default="{ row }">
                  <div class="rbar">
                    <i :style="{ width: Math.max(2, row.share) + '%' }" :class="{ 'is-low': isBadAging(row.bucket) }" />
                    <span>{{ row.share }}%</span>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;"><h4>按项目</h4><span class="desc">三个项目谁欠得最多</span></div>
            <el-table :data="aging.byCommunity" size="small" max-height="320">
              <el-table-column prop="name" label="项目" min-width="110" />
              <el-table-column prop="houses" label="户数" width="76" align="right" />
              <el-table-column label="欠费" min-width="120" align="right">
                <template #default="{ row }"><span class="num money--out">¥{{ money(row.amount) }}</span></template>
              </el-table-column>
            </el-table>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>欠得最久的 8 笔</h4>
            <span class="desc">催缴从这里往下打，不是从金额最大的往下打</span>
          </div>
          <el-table :data="aging.oldest" size="small" max-height="300">
            <el-table-column prop="billId" label="账单号" width="120" />
            <el-table-column prop="period" label="账期" width="90" />
            <el-table-column prop="dueDate" label="到期日" width="110" />
            <el-table-column prop="aging" label="账龄" width="100" />
            <el-table-column prop="overdueDays" label="逾期天数" width="96" align="right" />
            <el-table-column label="欠费" min-width="110" align="right">
              <template #default="{ row }"><span class="num money--out">¥{{ money(row.unpaid) }}</span></template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============ 押金在账 ============ -->
      <el-tab-pane label="押金在账" name="deposit">
        <div class="grid" style="margin-top:12px;grid-template-columns:repeat(4,minmax(0,1fr));">
          <div class="panel rsum" data-card="d-in">
            <div class="rsum__l">期间收取</div>
            <div class="rsum__v">¥ {{ wan(depo.received) }}</div>
            <div class="rsum__s">收进来是负债，不是收入</div>
          </div>
          <div class="panel rsum" data-card="d-out">
            <div class="rsum__l">期间退还</div>
            <div class="rsum__v">¥ {{ wan(depo.refunded) }}</div>
            <div class="rsum__s">按退款日归期</div>
          </div>
          <div class="panel rsum" data-card="d-cut">
            <div class="rsum__l">扣转收入</div>
            <div class="rsum__v">¥ {{ wan(depo.deducted) }}</div>
            <div class="rsum__s">只有这一段是公司的钱</div>
          </div>
          <div class="panel rsum" data-card="d-bal">
            <div class="rsum__l">期末在账</div>
            <div class="rsum__v">¥ {{ wan(depo.balance) }}</div>
            <div class="rsum__s">截至 {{ depo.to }}，别人的钱</div>
          </div>
        </div>

        <div class="check" :class="depo.identity.ok ? 'is-ok' : 'is-bad'">
          <b>{{ depo.identity.ok ? '✓ 台账恒等式成立（全量）' : '✗ 有押金去向不明，台账不能用' }}</b>
          <span>
            收 ¥{{ money(depo.identity.received) }} = 退 ¥{{ money(depo.identity.refunded) }}
            + 扣 ¥{{ money(depo.identity.deducted) }} + 在账 ¥{{ money(depo.identity.balance) }}
            <template v-if="!depo.identity.ok">（差 ¥{{ money(depo.identity.diff) }}）</template>
            <template v-else>；区间截断后上面四个数不必相等，所以自检用全量算</template>
          </span>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="sec__hd" style="margin:0 0 10px;">
            <h4>按押金类型</h4>
            <span class="desc">五类押金各自沉淀多少，清退时要按类型对账</span>
          </div>
          <el-table :data="depo.byType" size="small" max-height="380">
            <el-table-column prop="type" label="类型" min-width="130" />
            <el-table-column prop="count" label="笔数" width="76" align="right" />
            <el-table-column label="期间收取" width="120" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.received) }}</span></template>
            </el-table-column>
            <el-table-column label="期间退还" width="120" align="right">
              <template #default="{ row }"><span class="num">¥{{ money(row.refunded) }}</span></template>
            </el-table-column>
            <el-table-column label="扣转收入" width="110" align="right">
              <template #default="{ row }"><span class="num">{{ row.deducted ? '¥' + money(row.deducted) : '—' }}</span></template>
            </el-table-column>
            <el-table-column label="在账余额" width="130" align="right">
              <template #default="{ row }"><span class="num money">¥{{ money(row.balance) }}</span></template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============ 预算对比 ============ -->
      <el-tab-pane label="预算对比" name="budget">
        <div class="panel" style="margin-top:12px;">
          <div class="aging-bar__hd" style="margin-bottom:0;">
            <span>{{ bud.scopeNote }}</span>
            <span class="desc">
              收入看<b>完成率</b>（低 = 没收到），支出看<b>执行率</b>（高 = 花超了）——
              同一个除法，两个方向，别混着念
            </span>
          </div>
        </div>

        <div class="grid" style="margin-top:12px;grid-template-columns:repeat(3,minmax(0,1fr));">
          <div class="panel rsum" data-card="b-in-b">
            <div class="rsum__l">收入预算</div>
            <div class="rsum__v">¥ {{ wan(bud.income.budgetTotal) }}</div>
            <div class="rsum__s">{{ bud.months }} 个月</div>
          </div>
          <div class="panel rsum" data-card="b-in-a">
            <div class="rsum__l">收入实际</div>
            <div class="rsum__v">¥ {{ wan(bud.income.actualTotal) }}</div>
            <div class="rsum__s">与「收支分项」同源，不另算</div>
          </div>
          <div class="panel rsum" data-card="b-in-r">
            <div class="rsum__l">收入完成率</div>
            <div class="rsum__v" :class="bud.income.rate < 90 ? 'money--out' : ''">
              {{ bud.income.rate == null ? '—' : bud.income.rate }}<span v-if="bud.income.rate != null" class="unit">%</span>
            </div>
            <div class="rsum__s">欠收 {{ bud.income.shortCount }} 项</div>
          </div>
        </div>

        <div class="grid" style="margin-top:12px;grid-template-columns:repeat(3,minmax(0,1fr));">
          <div class="panel rsum" data-card="b-ex-b">
            <div class="rsum__l">支出预算</div>
            <div class="rsum__v">¥ {{ wan(bud.expense.budgetTotal) }}</div>
            <div class="rsum__s">{{ bud.months }} 个月</div>
          </div>
          <div class="panel rsum" data-card="b-ex-a">
            <div class="rsum__l">支出实际</div>
            <div class="rsum__v">¥ {{ wan(bud.expense.actualTotal) }}</div>
            <div class="rsum__s">报销 + 工资 + 合同摊 + 补录</div>
          </div>
          <div class="panel rsum" data-card="b-ex-r">
            <div class="rsum__l">支出执行率</div>
            <div class="rsum__v" :class="bud.expense.rate > 100 ? 'money--out' : ''">
              {{ bud.expense.rate == null ? '—' : bud.expense.rate }}<span v-if="bud.expense.rate != null" class="unit">%</span>
            </div>
            <div class="rsum__s">超支 {{ bud.expense.overCount }} 项</div>
          </div>
        </div>

        <div v-if="unbudgeted" class="check is-bad">
          <b>有支出没编预算</b>
          <span>
            {{ bud.expense.unbudgetedCount }} 项 / ¥{{ money(bud.expense.unbudgetedAmount) }} ——
            这类钱在预算表上不存在，到了月底没人能解释它从哪来
          </span>
        </div>

        <div class="grid" style="margin-top:16px;grid-template-columns:1fr 1fr;">
          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;">
              <h4>收入 · 完成率</h4>
              <span class="desc">低于 90% 标红：这个月的钱没进来</span>
            </div>
            <el-table :data="bud.income.rows" size="small" max-height="420">
              <el-table-column label="科目" min-width="130">
                <template #default="{ row }">
                  <div class="nowrap">{{ row.name }}</div>
                  <div class="ps-sub">{{ row.parentName || '—' }}</div>
                </template>
              </el-table-column>
              <el-table-column label="预算" width="110" align="right">
                <template #default="{ row }"><span class="num">{{ row.budget == null ? '未编' : '¥' + money(row.budget) }}</span></template>
              </el-table-column>
              <el-table-column label="实际" width="110" align="right">
                <template #default="{ row }"><span class="num">¥{{ money(row.actual) }}</span></template>
              </el-table-column>
              <el-table-column label="差额" width="106" align="right">
                <template #default="{ row }">
                  <span class="num" :class="{ 'money--out': row.diff != null && row.diff < 0 }">
                    {{ row.diff == null ? '—' : (row.diff >= 0 ? '+' : '') + money(row.diff) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="完成率" width="96" align="right">
                <template #default="{ row }">
                  <span :class="{ 'money--out': row.rate != null && row.rate < 90 }">{{ row.rate == null ? '—' : row.rate + '%' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="92">
                <template #default="{ row }">
                  <span class="tagx" :class="statusClass(row.status)">{{ row.status }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <div class="panel">
            <div class="sec__hd" style="margin:0 0 10px;">
              <h4>支出 · 执行率</h4>
              <span class="desc">超过 100% 标红：这个月花超了</span>
            </div>
            <el-table :data="bud.expense.rows" size="small" max-height="420">
              <el-table-column label="科目" min-width="130">
                <template #default="{ row }">
                  <div class="nowrap">{{ row.name }}</div>
                  <div class="ps-sub">{{ row.parentName || '—' }}</div>
                </template>
              </el-table-column>
              <el-table-column label="预算" width="110" align="right">
                <template #default="{ row }"><span class="num">{{ row.budget == null ? '未编' : '¥' + money(row.budget) }}</span></template>
              </el-table-column>
              <el-table-column label="实际" width="110" align="right">
                <template #default="{ row }"><span class="num money--out">¥{{ money(row.actual) }}</span></template>
              </el-table-column>
              <el-table-column label="差额" width="106" align="right">
                <template #default="{ row }">
                  <span class="num" :class="{ 'money--out': row.diff != null && row.diff > 0 }">
                    {{ row.diff == null ? '—' : (row.diff >= 0 ? '+' : '') + money(row.diff) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="执行率" width="96" align="right">
                <template #default="{ row }">
                  <span :class="{ 'money--out': row.rate != null && row.rate > 100 }">{{ row.rate == null ? '—' : row.rate + '%' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="96">
                <template #default="{ row }">
                  <span class="tagx" :class="statusClass(row.status)">{{ row.status }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <div class="legal">
      <b>三个口径不能混</b>：<br />
      · <b>收缴率</b>看"该收的收回来多少"，分母是应收 − 减免；<br />
      · <b>预缴率</b>看"未来的钱提前收了多少"，它拉高收缴率但不会拉高当期现金水位；<br />
      · <b>清欠额</b>是本期收回的历史欠费，它让收缴率好看但和本期应收无关 —— 三者混算，报表就失去解释力。
      <br /><br />
      <b>演示数据说明</b>：<br />
      · 账单只覆盖 2026-08 之后，所以默认区间取最近 3 期；往前看时"没开单的月份"仍按面积计应收，
      收缴率会明显下降 —— 这是数据边界，不是收缴水平；<br />
      · 预缴为演示种子（80 户 × 6 期），正式上线后全部来自真实收款；<br />
      · 在管 756 户的物业费规模与数据集里 120 人的薪酬规模不匹配，所以结余为负是数据问题，
      不是口径问题 —— 换成真实数据后这一项才有解释力。
      <br /><br />
      <b>税费口径</b>：本页金额均为<b>含税口径</b>，未做价税分离（收入里含应缴增值税，成本里含进项税）。
      纳税人身份、物业费/租赁税目、水电是转售还是代收代付这三条定下来之后，再出「税额 / 不含税额」两列 ——
      参见 <code>口径待确认-税费.md</code>。现在先别拿这里的数字直接填纳税申报表。
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import {
  agingReport, communityOpts, depositReport, feeItemRows, incomeExpenseReport,
  budgetVsActual, threeRateReport, waiveAnalysis
} from '@/api'
import { exportList } from '@/utils/export'
import { money, wan } from '@/utils/format'

const cmOpts = communityOpts()
/* 只列有月度应收的收费项 —— 水电按账单缴，三率对它不成立 */
const itemOpts = feeItemRows()
  .filter(i => ['按面积', '按车位', '按户'].includes(i.calcType) && i.cycle === '月')
  .map(i => ({ value: i.itemId, label: i.name }))

/* 默认最近 3 个账期：演示数据集的账单只覆盖 2026-08 之后，
   往前看会把"没开单的月份"也算进应收，收缴率会掉到 30% 多 —— 那是数据边界，不是收缴水平 */
const from = ref('2026-08')
const to = ref('2026-10')
const communityId = ref('')
const itemId = ref('FI01')
const tab = ref('rate')

const rate = computed(() => {
  try {
    return threeRateReport({ from: from.value, to: to.value, communityId: communityId.value, itemId: itemId.value })
  } catch (e) {
    return {
      receivable: 0, received: 0, waived: 0, unpaid: 0, collectionRate: 0, arrearsRate: 0,
      prepayRate: 0, prepayReceived: 0, prepayReceivable: 0, clearingAmount: 0, cashIncome: 0,
      periods: 0, houses: 0, byPeriod: [], topDebtors: [], overpaid: 0,
      identity: { ok: true, diff: 0 }, error: e?.message || '统计失败'
    }
  }
})

const pl = computed(() => {
  try {
    return incomeExpenseReport({ from: from.value, to: to.value, communityId: communityId.value })
  } catch (e) {
    return { incomeRows: [], expenseRows: [], incomeTotal: 0, expenseTotal: 0, balance: 0, margin: 0, byMonth: [] }
  }
})

/* 减免分析：与三率同区间，口径见 api.js 的 waiveAnalysis */
const waive = computed(() => {
  try {
    return waiveAnalysis({ from: from.value, to: to.value, communityId: communityId.value })
  } catch (e) {
    return { total: 0, count: 0, houses: 0, avg: 0, overLimitCount: 0, reasons: [], byPeriod: [], detail: [], error: e?.message }
  }
})

/* 账龄：实时口径，不接账期筛选 —— 它看的是"此刻欠了多久"，与统计区间无关 */
const aging = computed(() => {
  try {
    return agingReport({ communityId: communityId.value })
  } catch (e) {
    return { asOf: '', total: 0, count: 0, houses: 0, rows: [], byCommunity: [], oldest: [], error: e?.message }
  }
})

/* 押金：账期区间转成日期区间（收/退/扣各按自己的日期归期） */
const endOfMonth = p => {
  const [y, m] = String(p).split('-').map(Number)
  const d = new Date(y, m, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const depo = computed(() => {
  try {
    return depositReport({ from: `${from.value}-01`, to: endOfMonth(to.value), communityId: communityId.value })
  } catch (e) {
    return { from: '', to: '', received: 0, refunded: 0, deducted: 0, balance: 0, byType: [], identity: { ok: true, diff: 0, received: 0, refunded: 0, deducted: 0, balance: 0 }, error: e?.message }
  }
})

/* 预算对比：实际数复用收支分项，预算来自 mock/budgets.json（人审定的数） */
const bud = computed(() => {
  try {
    return budgetVsActual({ from: from.value, to: to.value, communityId: communityId.value })
  } catch (e) {
    const empty = { rows: [], budgetTotal: 0, actualTotal: 0, rate: null, diff: null, overCount: 0, shortCount: 0, unbudgetedCount: 0, unbudgetedAmount: 0 }
    return { from: '', to: '', months: 0, scope: 'group', scopeNote: e?.message || '', income: empty, expense: empty, error: e?.message }
  }
})
const unbudgeted = computed(() => bud.value.expense.unbudgetedCount > 0)
const statusClass = st => ({
  达成: 'is-ok', 正常: 'is-ok', 接近: 'is-warn', 欠收: 'is-bad', 超支: 'is-bad', 未编预算: 'is-mute'
}[st] || 'is-mute')

const houseShare = computed(() => {
  const base = rate.value.houses || 0
  return base > 0 ? Math.round(waive.value.houses / base * 1000) / 10 : 0
})
/* 91 天以上都标红：过了 90 天还没收回来，基本就是坏账 */
const isBadAging = b => b === '91-180天' || b === '180天以上'

const rowRate = r => {
  const base = r.receivable - r.waived
  return base > 0 ? Math.round(r.received / base * 1000) / 10 : 0
}
const incPct = n => (pl.value.incomeTotal ? Math.round(n / pl.value.incomeTotal * 1000) / 10 : 0)
const expPct = n => (pl.value.expenseTotal ? Math.round(n / pl.value.expenseTotal * 1000) / 10 : 0)
/* 水位：正结余按「结余 ÷ 收入」画；负结余按「缺口 ÷ 支出」画 ——
   两者用同一个分母会把亏损月份全部画成满格，看不出谁更糟 */
const monthPct = r => {
  const base = r.balance >= 0 ? r.income : r.expense
  if (!base) return 0
  return Math.max(2, Math.min(100, Math.round(Math.abs(r.balance) / base * 100)))
}

function onExport() {
  if (tab.value === 'waive') {
    exportList({
      name: `减免分析 ${from.value}_${to.value}`, source: '/b/revenue-report',
      columns: [
        { prop: 'name', label: '减免原因' }, { prop: 'type', label: '性质' },
        { prop: 'count', label: '笔数' }, { prop: 'amount', label: '金额' },
        { prop: 'share', label: '占比%' }, { prop: 'overLimit', label: '超免审额度笔数' }
      ],
      rows: waive.value.reasons,
      filters: { from: from.value, to: to.value, communityId: communityId.value }
    })
    return
  }
  if (tab.value === 'aging') {
    exportList({
      name: `欠费账龄 ${aging.value.asOf}`, source: '/b/revenue-report',
      columns: [
        { prop: 'bucket', label: '账龄' }, { prop: 'count', label: '账单数' },
        { prop: 'houses', label: '户数' }, { prop: 'amount', label: '金额' },
        { prop: 'share', label: '占比%' }
      ],
      rows: aging.value.rows,
      filters: { communityId: communityId.value, asOf: aging.value.asOf }
    })
    return
  }
  if (tab.value === 'deposit') {
    exportList({
      name: `押金在账 ${from.value}_${to.value}`, source: '/b/revenue-report',
      columns: [
        { prop: 'type', label: '押金类型' }, { prop: 'count', label: '笔数' },
        { prop: 'received', label: '期间收取' }, { prop: 'refunded', label: '期间退还' },
        { prop: 'deducted', label: '扣转收入' }, { prop: 'balance', label: '在账余额' }
      ],
      rows: depo.value.byType,
      filters: { from: from.value, to: to.value, communityId: communityId.value }
    })
    return
  }
  if (tab.value === 'budget') {
    exportList({
      name: `预算对比 ${from.value}_${to.value}`, source: '/b/revenue-report',
      columns: [
        { prop: 'direction', label: '方向' }, { prop: 'parentName', label: '一级分类' },
        { prop: 'name', label: '科目' }, { prop: 'budget', label: '预算' },
        { prop: 'actual', label: '实际' }, { prop: 'diff', label: '差额' },
        { prop: 'rate', label: '完成率/执行率%' }, { prop: 'status', label: '状态' }
      ],
      rows: [
        ...bud.value.income.rows.map(r => ({ ...r, direction: '收入' })),
        ...bud.value.expense.rows.map(r => ({ ...r, direction: '支出' }))
      ],
      filters: { from: from.value, to: to.value, communityId: communityId.value }
    })
    return
  }
  if (tab.value === 'rate') {
    exportList({
      name: `三率报表 ${from.value}_${to.value}`, source: '/b/revenue-report',
      columns: [
        { prop: 'period', label: '账期' }, { prop: 'receivable', label: '应收' },
        { prop: 'received', label: '已收' }, { prop: 'waived', label: '减免' },
        { prop: 'unpaid', label: '未收' }
      ],
      rows: rate.value.byPeriod,
      filters: { from: from.value, to: to.value, communityId: communityId.value, itemId: itemId.value }
    })
    return
  }
  exportList({
    name: `收支分项 ${from.value}_${to.value}`, source: '/b/revenue-report',
    columns: [
      { prop: 'kind', label: '方向' }, { prop: 'parentName', label: '一级分类' },
      { prop: 'name', label: '分类' }, { prop: 'amount', label: '金额' }
    ],
    rows: [
      ...pl.value.incomeRows.map(r => ({ ...r, kind: '收入' })),
      ...pl.value.expenseRows.map(r => ({ ...r, kind: '支出' }))
    ],
    filters: { from: from.value, to: to.value, communityId: communityId.value }
  })
}
</script>

<style scoped>
.rng { margin: 0 6px; color: var(--biz-text-3); font-size: 12px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.check {
  margin-top: 12px; padding: 10px 14px; border-radius: 10px;
  display: flex; flex-direction: column; gap: 3px; font-size: 12.5px;
}
.check.is-ok { background: #f0f9eb; border: 1px solid #c8e6b8; color: #3f7f2a; }
.check.is-bad { background: #fff5f5; border: 1px solid #f5c2c2; color: #a33; }
.check span { font-size: 12px; opacity: .9; }

.rbar { display: flex; align-items: center; gap: 8px; }
.rbar i {
  flex: 1; height: 6px; border-radius: 3px; background: var(--el-color-primary);
  min-width: 2px; display: block;
}
.rbar i.is-low { background: var(--biz-danger); }
.rbar span { flex: 0 0 44px; text-align: right; font-family: var(--biz-font-num); font-size: 12px; color: var(--biz-text-3); }

.aging-bar__hd {
  display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--biz-text-2); margin-bottom: 12px;
}
.aging-bar__hd .desc { font-size: 12px; color: var(--biz-text-3); }
.aging-bar__bars { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.aging-seg {
  padding: 10px 12px; border-radius: 10px; background: #f7f9fc;
  border: 1px solid var(--biz-border-light);
}
.aging-seg__t { font-size: 12px; color: var(--biz-text-3); }
.aging-seg__v { font-family: var(--biz-font-num); font-size: 16px; font-weight: 600; margin: 2px 0; }
.aging-seg__p { font-size: 11.5px; color: var(--biz-text-3); }
.aging-seg[data-bucket="91-180天"], .aging-seg[data-bucket="180天以上"] {
  background: #fff5f5; border-color: #f5c2c2;
}
.aging-seg[data-bucket="91-180天"] .aging-seg__v, .aging-seg[data-bucket="180天以上"] .aging-seg__v {
  color: #a33;
}

.tagx {
  display: inline-block; padding: 0 7px; border-radius: 8px; font-size: 12px; line-height: 20px;
  border: 1px solid transparent;
}
.tagx.is-ok { background: #f0f9eb; border-color: #c8e6b8; color: #3f7f2a; }
.tagx.is-warn { background: #fdf6ec; border-color: #f5dab1; color: #a6700f; }
.tagx.is-bad { background: #fff5f5; border-color: #f5c2c2; color: #a33; }
.tagx.is-mute { background: #f4f4f5; border-color: #e4e4e7; color: #8a8a8f; }

.legal {
  margin-top: 14px; padding: 12px 16px; border-radius: 10px;
  background: #f7f9fc; border: 1px solid var(--biz-border-light);
  font-size: 12px; line-height: 1.85; color: var(--biz-text-3);
}
.legal b { color: var(--biz-text-2); }
</style>
