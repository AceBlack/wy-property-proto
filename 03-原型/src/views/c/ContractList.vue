<template>
  <div class="page">
    <div class="proto-note">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>合同管理 · 统一合同台账</b>：<b>劳动合同 / 物业服务协议 / 运维服务 / 多种经营 / 租赁协议 / 采购协议</b>
        六个一级主项、21 个子类，共用一张表和一套状态机，差异只在「类型 → 子类」与关联对象上；
        树轴按<b>合同类型</b>切（不是空间树），因为合同的第一诉求是「按类找、按到期盯」。
        <b>{{ summary.expiring }} 份 90 天内到期</b>、<b>{{ summary.expired }} 份已到期</b>进常用视图。
      </div>
    </div>

    <div class="panel" style="margin-top:16px;">
      <div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));">
        <div class="dstat">
          <div class="dstat__k">合同总数</div>
          <div class="dstat__v">{{ summary.total }}<span class="unit">份</span></div>
          <div class="dstat__s">收入 {{ summary.incomeCount }} · 支出 {{ summary.expenseTotalCount }}</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">收入合同（期间额）</div>
          <div class="dstat__v">{{ wan(summary.incomeAmount) }}<span class="unit">元</span></div>
          <div class="dstat__s">
            其中计入收入 {{ summary.incomeCountedCount }} 份 · {{ wan(summary.incomeCountedAmount) }} 元
          </div>
        </div>
        <div class="dstat">
          <div class="dstat__k">支出合同（期间额）</div>
          <div class="dstat__v is-warn">{{ wan(summary.expenseTotalAmount) }}<span class="unit">元</span></div>
          <div class="dstat__s">劳动合同 / 运维服务 / 采购协议，只进成本</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">年化商业合作收入</div>
          <div class="dstat__v">{{ wan(summary.operationAmount) }}<span class="unit">元</span></div>
          <div class="dstat__s">{{ summary.operationCount }} 份经营合同 · 已扣公共收益</div>
        </div>
        <div class="dstat">
          <div class="dstat__k">到期 / 待审批</div>
          <div class="dstat__v" :class="summary.expiring > 0 ? 'is-warn' : ''">
            {{ summary.expiring }} / {{ summary.expired }} / {{ summary.pending }}
            <span class="unit">份</span>
          </div>
          <div class="dstat__s">90 天内 / 已到期 / 待审批</div>
        </div>
      </div>
      <div class="sum-note">
        口径：合同总额是<b>期间总额</b>，不是一个月的钱；收入与支出必须分列 ——
        85 份合同里 {{ summary.expenseTotalCount }} 份是支出（{{ wan(summary.expenseTotalAmount) }} 元），
        混在一起看会以为公司收了 {{ wan(summary.amount) }} 元。
        <br />
        另有 {{ summary.expenseCount - summary.expenseTotalCount }} 份物业服务协议标了「不计入」：
        它们的钱已经按物业费账单逐月收过，合同只做登记、不再重复计一笔收入 ——
        <b>方向看合同类型，是否计收入看「收入分类」</b>，两者不是一回事。
        收入看「年化商业合作收入」（{{ summary.operationCount }} 份经营合同，扣掉归业主的公共收益
        ¥{{ wan(summary.publicRevenue) }}）。
      </div>
    </div>

    <div class="ia is-flat" style="margin-top:16px;">
      <div class="ia__main">
        <div class="panel">
          <div class="qvwrap">
            <QuickViews v-model="query.vf" :items="quickViews" hint="快捷视图与下方筛选可叠加" @change="run" />
          </div>

          <el-form :model="query" class="filter-bar" label-width="56px" @submit.prevent>
            <el-form-item label="方向">
              <el-select v-model="query.direction" placeholder="全部" clearable style="width:92px" @change="onDirection">
                <el-option v-for="o in CONTRACT_DIRECTIONS" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="query.ctype" placeholder="全部" clearable style="width:118px" @change="onType">
                <el-option v-for="o in typeOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="子类型">
              <el-select v-model="query.csub" placeholder="全部" clearable :disabled="!query.ctype" style="width:126px">
                <el-option v-for="o in subOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="query.status" placeholder="全部" clearable style="width:92px">
                <el-option v-for="o in statusOpts" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="收入分类">
              <el-select v-model="query.incomeCategory" placeholder="全部" clearable style="width:104px">
                <el-option v-for="o in CONTRACT_INCOME_CATEGORIES" :key="o" :label="o" :value="o" />
              </el-select>
            </el-form-item>
            <el-form-item label="项目">
              <el-select v-model="query.communityId" placeholder="全部" clearable style="width:104px">
                <el-option v-for="o in communities" :key="o.id" :label="o.name" :value="o.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="关键字">
              <el-input v-model="query.kw" placeholder="合同号 / 名称 / 相对方" clearable style="width:142px" @keyup.enter="search" />
            </el-form-item>
            <el-form-item class="acts">
              <el-button :icon="'Search'" @click="run">查询</el-button>
              <el-button :icon="'RefreshLeft'" @click="reset">重置</el-button>
            </el-form-item>
          </el-form>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="scopebar">
            <span class="scopebar__i is-last">{{ scopeText }}</span>
            <span v-if="vnLabel" class="scopebar__vf">{{ vnLabel }}</span>
            <span v-if="query.kw" class="scopebar__vf">关键字 {{ query.kw }}</span>
            <span class="spacer" />
            <span class="scopebar__sum">
              本范围 <b>{{ total }}</b> 份
            </span>
            <el-button link type="primary" :disabled="!hasScope" @click="clearScope">清除范围</el-button>
          </div>

          <div class="toolbar">
            <el-button type="primary" :icon="'Plus'" @click="$router.push('/c/contracts/new')">新建合同</el-button>
            <el-button :icon="'Download'" :disabled="!rows.length" @click="onExport">导出</el-button>
            <el-button :icon="'Coin'" @click="$router.push('/b/public-revenue')">公共收益台账</el-button>
            <span class="spacer" />
            <el-button :icon="'Refresh'" circle title="刷新" @click="load" />
            <span class="muted" style="font-size:12.5px;">共 {{ total }} 份合同</span>
          </div>

          <el-table v-loading="loading" :data="rows" style="width:100%" max-height="calc(100vh - 500px)"
            :row-class-name="rowClass" @row-click="onRow">
            <el-table-column label="合同" min-width="220">
              <template #default="{ row }">
                <div class="nowrap">{{ row.name }}</div>
                <div class="ps-sub">{{ row.contractNo }}</div>
              </template>
            </el-table-column>
            <el-table-column label="方向 / 类型" min-width="132">
              <template #default="{ row }">
                <div class="nowrap">
                  <span class="tag" :class="row.direction === '收入' ? 'tag--success' : 'tag--muted'">{{ row.direction }}</span>
                  {{ row.type }}
                </div>
                <div class="ps-sub">{{ row.subtype }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="partyB" label="相对方" min-width="120" show-overflow-tooltip />
            <el-table-column prop="communityName" label="项目" min-width="104" show-overflow-tooltip />
            <el-table-column label="收入归属" width="140">
              <template #default="{ row }">
                <span class="tag" :class="incomeTone(row.incomeCategory)">{{ row.incomeCategory }}</span>
                <div class="ps-sub">{{ row.categoryName }}</div>
                <div v-if="row.incomeCategory === '多种经营'" class="ps-sub">
                  公共收益 ¥{{ wan(row.publicRevenue) }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="合同金额" min-width="92" align="right">
              <template #default="{ row }"><span class="num">¥{{ wan(row.amount) }}</span></template>
            </el-table-column>
            <el-table-column label="年化经营收入" min-width="108" align="right">
              <template #default="{ row }">
                <span v-if="row.incomeCategory === '多种经营'" class="num money">{{ wan(row.annualRevenue) }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="履行期" min-width="92">
              <template #default="{ row }">
                <div class="nowrap">{{ row.startDate }}</div>
                <div class="ps-sub">{{ row.endDate }}</div>
              </template>
            </el-table-column>
            <el-table-column label="状态" min-width="104">
              <template #default="{ row }">
                <StatusTag domain="contract" :value="row.status" />
                <!-- 审批中显示卡在哪个节点：以前只有合同状态「待审批」，看不出审到第几级 -->
                <div v-if="apMap.get(row.contractId)" class="ps-sub is-ap">
                  {{ apMap.get(row.contractId).currentNode }} · 等 {{ apMap.get(row.contractId).waitHours }}h
                </div>
                <div v-else class="ps-sub" :class="{ 'is-expire': row.status === '即将到期' || row.status === '已到期' }">{{ restText(row) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" @click.stop="onRow(row)">详情</el-button>
                <el-button link type="primary" v-if="canChange(row)" @click.stop="openChange(row)">变更</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <EmptyState type="search" desc="换个筛选条件，或清除范围重新查看">
                <template #action><el-button @click="reset">清除筛选条件</el-button></template>
              </EmptyState>
            </template>
          </el-table>

          <div class="table-foot">
            <el-pagination v-model:current-page="pageNo" v-model:page-size="size"
              :page-sizes="PAGE_SIZES" :total="total" layout="total, sizes, prev, pager, next, jumper" />
          </div>
        </div>
      </div>
    </div>

    <DetailDrawer
      v-model="detailVisible" :loading="detailLoading"
      :title="detailData ? detailData.contract.name : ''"
      :subtitle="detailData ? `${detailData.contract.contractNo} · ${detailData.contract.type} / ${detailData.contract.subtype} · ${detailData.contract.communityName}` : ''"
      :status="detailData?.contract?.status" status-domain="contract"
    >
      <template v-if="detailData">
        <div class="grid g4">
          <div class="dstat"><div class="dstat__k">合同金额</div><div class="dstat__v">¥{{ wan(detailData.contract.amount) }}</div></div>
          <div class="dstat"><div class="dstat__k">付款周期</div><div class="dstat__v">{{ detailData.contract.payCycle }}</div></div>
          <div class="dstat"><div class="dstat__k">附件</div><div class="dstat__v">{{ detailData.contract.attachments }}<span class="unit">份</span></div></div>
          <div class="dstat">
            <div class="dstat__k">剩余期限</div>
            <div class="dstat__v" :class="detailData.contract.status === '即将到期' || detailData.contract.status === '已到期' ? 'is-warn' : ''">
              {{ restText(detailData.contract) }}
            </div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>合同信息</h4></div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">合同编号</span><span class="dl__v">{{ detailData.contract.contractNo }}</span></div>
          <div class="dl__i"><span class="dl__k">合同类型</span><span class="dl__v">{{ detailData.contract.type }} / {{ detailData.contract.subtype }}</span></div>
          <div class="dl__i"><span class="dl__k">所属项目</span><span class="dl__v">{{ detailData.contract.communityName }}</span></div>
          <div class="dl__i"><span class="dl__k">相对方</span><span class="dl__v">{{ detailData.contract.partyB }}</span></div>
          <div class="dl__i"><span class="dl__k">联系人</span><span class="dl__v">{{ detailData.contract.contact }} · {{ maskPhone(detailData.contract.phone) }}</span></div>
          <div class="dl__i"><span class="dl__k">签订日期</span><span class="dl__v">{{ detailData.contract.signDate }}</span></div>
          <div class="dl__i"><span class="dl__k">生效日期</span><span class="dl__v">{{ detailData.contract.startDate }}</span></div>
          <div class="dl__i"><span class="dl__k">到期日期</span><span class="dl__v">{{ detailData.contract.endDate }}</span></div>
          <div class="dl__i"><span class="dl__k">合同责任人</span><span class="dl__v">{{ detailData.contract.owner }}</span></div>
          <div class="dl__i is-full"><span class="dl__k">备注</span><span class="dl__v">{{ detailData.contract.remark || '—' }}</span></div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>收入归属</h4>
          <span class="desc">
            {{ detailData.contract.incomeCategory === '多种经营'
              ? '经营性合同：收入进「商业合作」分项，扣归业主的公共收益后年化计入'
              : (detailData.contract.incomeCategory === '主营业务'
                ? '物业费口径的主营收入，不并入多种经营'
                : '支出合同：只进成本，不进任何收入口径') }}
          </span>
        </div>
        <div class="dl">
          <div class="dl__i"><span class="dl__k">收入分类</span><span class="dl__v">
            <span class="tag" :class="incomeTone(detailData.contract.incomeCategory)">{{ detailData.contract.incomeCategory }}</span>
          </span></div>
          <div class="dl__i"><span class="dl__k">合同金额</span><span class="dl__v">¥{{ wan(detailData.contract.amount) }}（{{ detailData.contract.contractMonths }} 个月总额）</span></div>
          <div class="dl__i"><span class="dl__k">公共收益</span><span class="dl__v">
            <template v-if="detailData.contract.incomeCategory === '多种经营'">
              ¥{{ wan(detailData.contract.publicRevenue) }}
              <span class="muted" style="margin-left:6px;">{{ detailData.contract.publicRevenueNote || '归业主部分' }}</span>
            </template>
            <span v-else class="muted">不适用</span>
          </span></div>
          <div class="dl__i"><span class="dl__k">年化商业合作收入</span><span class="dl__v">
            <b v-if="detailData.contract.incomeCategory === '多种经营'" class="money">¥{{ wan(detailData.contract.annualRevenue) }}</b>
            <span v-else class="muted">—</span>
          </span></div>
        </div>
        <div v-if="detailData.contract.incomeCategory === '多种经营'" class="inc-note">
          算法：(合同金额 − 公共收益) ÷ 期间月数 × 12 = ({{ wan(detailData.contract.amount) }} −
          {{ wan(detailData.contract.publicRevenue) }}) ÷ {{ detailData.contract.contractMonths }} × 12。
          计入「全年收益」时还要乘当年覆盖月数 ÷ 12 —— 跨年合同不会把整年收入挤进签约当年。
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>审批</h4>
          <span class="desc">
            {{ approvalCards.length
              ? `${approvalCards.length} 张审批单 · 最近：${approvalCards[0].approvalNo}`
              : '暂无审批单' }}
          </span>
        </div>
        <div v-if="!approvalCards.length" class="ap-empty">
          这份合同没有对应审批单。审批单在建档 / 变更提交时自动生成，去
          <el-button link type="primary" @click="$router.push('/c/todo')">待办中心</el-button>
          可看全部在途审批。
        </div>
        <div v-for="a in approvalCards" :key="a.approvalId" class="ap" :class="{ 'is-live': a.live }">
          <div class="ap__hd">
            <span class="ap__no">{{ a.approvalNo }}</span>
            <span class="tag" :class="apTone(a.status)">{{ a.status }}</span>
            <span v-if="a.live" class="ap__cur">卡在「{{ a.currentNode }}」· 已等 {{ a.waitHours }} 小时</span>
            <span v-else class="ap__cur is-muted">{{ a.applyTime }} 提交</span>
            <span class="spacer" />
            <el-button v-if="a.live" link type="primary" size="small"
              @click="$router.push(`/c/approval/${a.approvalId}`)">去处理 →</el-button>
          </div>
          <div class="ap__flow">
            <div v-for="(n, i) in a.nodes" :key="i" class="ap__node" :class="'is-' + n.st">
              <span class="ap__dot" />
              <div class="ap__body">
                <div class="ap__name">
                  {{ n.node }}
                  <span class="ap__act">{{ n.action === '待处理' ? (n.st === 'now' ? '当前' : '待流转') : n.action }}</span>
                </div>
                <div class="ap__meta">
                  {{ n.handler || '待指派' }}<template v-if="n.time"> · {{ n.time }}</template>
                </div>
                <div v-if="n.comment" class="ap__cmt">{{ n.comment }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>变更留痕</h4>
          <span class="desc">共 {{ changeRows.length }} 条 · 审批通过才回写合同</span>
        </div>
        <div v-if="changeRows.length" class="tl">
          <div v-for="c in changeRows" :key="c.changeId" class="tl__i" :class="{ 'is-done': c.status === '已生效' }">
            <div class="tl__t">
              {{ c.type }} · {{ c.changeNo }}
              <span class="ps-sub" style="display:inline;margin-left:6px;">{{ c.status }}</span>
            </div>
            <div class="tl__m">{{ c.reason }} · {{ c.applicant }} 申请 · {{ c.applyTime }}</div>
          </div>
        </div>
        <div v-else class="rel"><span class="rel__note">该合同暂无变更记录；续签、调价、延期都要走这里的变更审批</span></div>

        <div class="sec__hd" style="margin-top:18px;">
          <h4>关联对象</h4><span class="desc">{{ refTypeLabel(detailData.contract.refType) }}</span>
        </div>
        <div class="dl" v-if="detailData.ref">
          <div class="dl__i"><span class="dl__k">对象编号</span><span class="dl__v">{{ detailData.contract.refId }}</span></div>
          <div class="dl__i"><span class="dl__k">对象名称</span><span class="dl__v">{{ refName(detailData) }}</span></div>
          <div class="dl__i"><span class="dl__k">所在项目</span><span class="dl__v">{{ detailData.ref.communityName || detailData.contract.communityName }}</span></div>
        </div>
        <div v-else class="rel">
          <span class="rel__note">该合同未绑定具体对象（多为集团级框架协议），履约跟踪以合同履行记录为准</span>
        </div>

        <div class="sec__hd" style="margin-top:18px;"><h4>履约节点</h4><span class="desc">签订 → 生效 → 到期</span></div>
        <div class="tl">
          <div v-for="(l, i) in detailData.timeline" :key="i" class="tl__i" :class="{ 'is-done': l.done }">
            <div class="tl__t">{{ l.title }}</div>
            <div class="tl__m">{{ l.memo }}</div>
          </div>
        </div>

        <div class="rel">
          <el-button v-if="detailData.contract.refType === 'house'" size="small" @click="jump('/a/houses', 'house:' + detailData.contract.refId)">房屋台账</el-button>
          <el-button v-if="detailData.contract.refType === 'parking'" size="small" @click="jump('/a/vehicles', 'park:' + detailData.contract.refId)">车位与车辆</el-button>
          <el-button v-if="detailData.contract.refType === 'employee'" size="small" @click="jump('/c/employee', 'employee:' + detailData.contract.refId)">员工档案</el-button>
          <span class="rel__note">六个一级主项共用状态机，差异只在类型与关联对象上；续签必须发起审批，不允许在原合同上改期限</span>
        </div>
      </template>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
        <el-button @click="doDownloadAttachments(detailData.contract)">下载附件</el-button>
        <el-button
          v-if="detailData?.contract?.status === '履行中'"
          @click="openChange(detailData.contract, '提前终止')"
        >终止合同</el-button>
        <el-button type="primary" :disabled="!!detailData?.contract?.changePending" @click="openChange(detailData.contract, '续签')">发起续签</el-button>
      </template>
    </DetailDrawer>

    <!-- C4 合同变更：变更单 + 审批单，通过后才回写合同 -->
    <el-dialog v-model="changeVisible" title="发起合同变更" width="560">
      <el-form ref="chRef" :model="chForm" :rules="chRules" label-width="96px">
        <el-form-item label="合同">
          <span>{{ chContract?.name }}</span>
          <span class="ps-sub" style="margin-left:8px;">{{ chContract?.contractNo }}</span>
        </el-form-item>
        <el-form-item label="变更类型" prop="type">
          <el-select v-model="chForm.type" style="width:100%">
            <el-option v-for="t in CONTRACT_CHANGE_TYPES" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="chForm.type !== '提前终止'" label="新合同金额">
          <el-input v-model.number="chForm.amount" placeholder="留空表示不变"><template #append>元</template></el-input>
        </el-form-item>
        <el-form-item v-if="chForm.type === '期限变更' || chForm.type === '续签'" label="新到期日">
          <el-date-picker v-model="chForm.endDate" type="date" value-format="YYYY-MM-DD" style="width:100%"
            placeholder="留空表示不变" />
        </el-form-item>
        <el-form-item v-if="chForm.type === '主体变更'" label="新乙方">
          <el-input v-model="chForm.partyB" placeholder="留空表示不变" />
        </el-form-item>
        <el-form-item label="变更原因" prop="reason">
          <el-input v-model="chForm.reason" type="textarea" :rows="3" placeholder="必填，会写进变更留痕" />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon
          title="提交后生成变更单与审批单，审批通过才回写合同；原合同不允许直接改。" />
      </el-form>
      <template #footer>
        <el-button @click="changeVisible = false">取消</el-button>
        <el-button type="primary" @click="submitChange">提交变更审批</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  CONTRACT_CHANGE_TYPES, CONTRACT_DIRECTIONS, CONTRACT_INCOME_CATEGORIES, PAGE_SIZES,
  communityOpts, contractApprovalOf, contractAttachmentRows, contractChanges,
  contractStatusOpts, contractSubtypeOpts, contractSummary, contractTypeOpts, contractTypeTree,
  contractVirtualNodes, getContractDetail, queryContracts, submitContractChange
} from '@/api'
import { useDetail, useListQuery } from '@/composables/useQuery'
import { useFocusLanding } from '@/composables/useFocus'
import QuickViews from '@/components/QuickViews.vue'
import DetailDrawer from '@/components/DetailDrawer.vue'
import StatusTag from '@/components/StatusTag.vue'
import EmptyState from '@/components/EmptyState.vue'
import { maskPhone, wan } from '@/utils/format'
import { exportList } from '@/utils/export'

const router = useRouter()
const route = useRoute()
const BLANK = { ctype: '', csub: '', vf: '' }
const BLANK_ALL = { ...BLANK, direction: '', communityId: '', status: '', incomeCategory: '', kw: '' }


/* 导出：只提交任务，文件在下载中心生成与下载 */
/** 收入分类的标签色：经营（蓝）/ 主营（绿）/ 支出（灰）—— 一眼分清哪列数字算收入 */
const INCOME_TONE = { 多种经营: 'tag--primary', 主营业务: 'tag--success', 不计入: 'tag--muted' }
const incomeTone = c => INCOME_TONE[c] || 'tag--muted'

const EXPORT_COLS = [
  { prop: 'contractId', label: '合同编号' },
  { prop: 'name', label: '合同名称' },
  { prop: 'direction', label: '收支方向' },
  { prop: 'type', label: '类型' },
  { prop: 'partyB', label: '相对方' },
  { prop: 'communityName', label: '项目' },
  { prop: 'incomeCategory', label: '收入分类' },
  { prop: 'categoryName', label: '分类（字典二级）' },
  { prop: 'amount', label: '合同金额' },
  { prop: 'publicRevenue', label: '公共收益' },
  { prop: 'annualRevenue', label: '年化经营收入' },
  { prop: 'startDate', label: '生效日' },
  { prop: 'endDate', label: '到期日' },
  { prop: 'status', label: '状态' }
]
function onExport() {
  exportList({ name: '合同管理', source: '/c/contracts', columns: EXPORT_COLS, rows: rows.value, filters: { ...query } })
}

const { rows, total, pageNo, size, loading, query, load, search } = useListQuery(
  queryContracts, { immediate: false, filters: { ...BLANK_ALL } }
)

/**
 * 列表里的「卡在哪个节点」：只在途审批单，已通过的历史单不占位。
 * 一次把当前页扫一遍，避免模板里对每行各查一遍。
 */
const apMap = computed(() => {
  const m = new Map()
  for (const r of rows.value) {
    const a = contractApprovalOf(r.contractId)
    if (a) m.set(r.contractId, a)
  }
  return m
})

/** 审批单状态标签色 */
const AP_TONE = { 待审批: 'tag--warning', 审批中: 'tag--warning', 已通过: 'tag--success', 已驳回: 'tag--danger', 已撤回: 'tag--muted' }
const apTone = st => AP_TONE[st] || 'tag--muted'

/**
 * 详情里的审批卡：给每个节点算状态。
 * 「待处理」的节点有两种：当前该谁办（now）、还没轮到（wait）——
 * 都画成一个灰点的话，看不出流程走到哪了。
 */
const approvalCards = computed(() => {
  const list = detailData.value?.approvals || []
  return list.map(a => {
    let hit = false
    const nodes = (a.flow || []).map(n => {
      let st = 'done'
      if (n.action === '驳回') st = 'reject'
      else if (n.action === '撤回') st = 'void'
      else if (n.action === '待处理') {
        if (!hit) { st = 'now'; hit = true } else st = 'wait'
      }
      return { ...n, st }
    })
    return { ...a, nodes, live: ['待审批', '审批中'].includes(a.status) }
  })
})

const vnodes = contractVirtualNodes()
/* KPI 汇总：mock 同步、http 异步，统一 await；失败保留旧值 */
const summary = ref({ total: 0, amount: 0, running: 0, expiring: 0, expired: 0, pending: 0 })
async function syncSummary() {
  try { summary.value = await contractSummary() } catch { /* 保留旧值 */ }
}
syncSummary()
/* 快捷视图：原左树的虚拟视图节点搬到这里（6 个状态视图 + 全部） */
const quickViews = [{ key: '', label: '全部', n: summary.value.total }, ...vnodes]
const expiringN = vnodes.find(v => v.key === 'expiring')?.n || 0
const statusOpts = contractStatusOpts()
/* 类型两级：先选方向，类型下拉只给这个方向下有的类型 ——
   收入里不会出现「保洁服务外包」，支出里也不会出现「广告位租赁」 */
const typeOpts = computed(() =>
  query.direction ? contractTypeTree(query.direction).map(t => t.type) : contractTypeOpts())
const communities = communityOpts()
/* 子类型随类型联动 */
const subOpts = computed(() => (query.ctype ? contractSubtypeOpts(query.ctype) : []))
function onDirection() { query.ctype = ''; query.csub = ''; run() }
function onType() { query.csub = ''; run() }

const highlightId = ref('')
const vnLabel = computed(() => (query.vf ? (quickViews.find(v => v.key === query.vf)?.label || '') : ''))
function run() { search() }

const hasScope = computed(() => !!(query.direction || query.ctype || query.csub || query.vf || query.communityId || query.status || query.kw))
const scopeText = computed(() => {
  const parts = []
  if (query.direction) parts.push(query.direction + '合同')
  if (query.ctype) parts.push(query.ctype)
  if (query.csub) parts.push(query.csub)
  if (query.communityId) parts.push((communities.find(c => c.id === query.communityId) || {}).name || '')
  return parts.filter(Boolean).join(' · ') || '全部合同'
})
const { data: detailData, visible: detailVisible, loading: detailLoading, open: openDetail } = useDetail(getContractDetail)

/* B 级补齐：下载合同附件 —— 原型无真实文件，按附件份数生成「附件清单」走下载中心 */
function doDownloadAttachments(c) {
  try {
    const rows = contractAttachmentRows(c.contractId)
    exportList({
      name: `${c.contractNo} 附件清单`, source: '/c/contracts',
      columns: [
        { prop: 'no', label: '序号' }, { prop: 'name', label: '附件名称' },
        { prop: 'file', label: '文件名' }, { prop: 'size', label: '大小' },
        { prop: 'uploadAt', label: '上传日期' }
      ],
      rows, filters: { contractId: c.contractId }
    })
  } catch (e) { ElMessage.error(e?.message || '下载失败') }
}

const REF_LABEL = { house: '房屋', parking: '车位', employee: '员工' }
function refTypeLabel(t) { return REF_LABEL[t] || '未绑定' }
function refName(d) {
  const r = d.ref
  if (!r) return '—'
  return r.fullName || r.parkNo || r.name || '—'
}
function restText(c) {
  if (c.restDays === null) return '—'
  if (c.restDays < 0) return `已过期 ${Math.abs(c.restDays)} 天`
  if (c.restDays === 0) return '今天到期'
  return `剩余 ${c.restDays} 天`
}

function clearScope() {
  Object.assign(query, BLANK_ALL)
  run()
}
function reset() { clearScope() }

function onRow(row) { openDetail(row.contractId) }
function rowClass({ row }) { return row.contractId === highlightId.value ? 'row--focus' : '' }
function jump(path, focus) { router.push(`${path}?focus=${focus}`) }
function soon(name) { ElMessage(`${name}：B 级能力，原型阶段仅提示`) }

/* ---------- C4 合同变更 ---------- */
const changeVisible = ref(false)
const chRef = ref()
const chContract = ref(null)
const chForm = ref({ type: '金额变更', amount: null, endDate: '', partyB: '', reason: '' })
const chRules = {
  type: [{ required: true, message: '请选择变更类型', trigger: 'change' }],
  reason: [{ required: true, message: '请填写变更原因', trigger: 'blur' }]
}
const changeRows = ref([])
watch(detailData, d => { changeRows.value = d?.contract ? contractChanges(d.contract.contractId) : [] })

function canChange(row) {
  return ['履行中', '即将到期', '待生效'].includes(row.status) && !row.changePending
}
function openChange(c, type = '金额变更') {
  if (!c) return
  if (['已到期', '已终止'].includes(c.status)) { ElMessage.warning(`合同状态「${c.status}」，不能再发起变更`); return }
  chContract.value = c
  chForm.value = { type: type || '金额变更', amount: null, endDate: '', partyB: '', reason: '' }
  changeVisible.value = true
}
async function submitChange() {
  try { await chRef.value?.validate() } catch { return }
  try {
    const res = submitContractChange(chContract.value.contractId, {
      type: chForm.value.type,
      patch: { amount: chForm.value.amount, endDate: chForm.value.endDate, partyB: chForm.value.partyB },
      reason: chForm.value.reason
    })
    ElMessage.success(`已生成变更单 ${res.change.changeNo}，审批单 ${res.approval.approvalNo}（待审批）`)
    changeVisible.value = false
    await syncSummary()
    load()
    if (detailVisible.value) openDetail(chContract.value.contractId)
  } catch (e) { ElMessage.error(e?.message || '提交失败') }
}

/* ---------- 落地：focus 锚点 + vf 虚拟节点 ---------- */
useFocusLanding(async ({ focus, open, location }) => {
  highlightId.value = ''
  const vf = String(route.query.vf || '')
  if (vf && vnodes.some(v => v.key === vf)) {
    Object.assign(query, BLANK_ALL)
    Object.assign(query, { vf })
    await load()
    return
  }
  if (focus && location && focus.type === 'contract') {
    Object.assign(query, BLANK_ALL)
    Object.assign(query, {
      ctype: location.ctype || '',
      csub: location.csub || '',
      communityId: location.communityId || ''
    })
    await load()
    highlightId.value = focus.id
    if (open) openDetail(focus.id)
    return
  }
  Object.assign(query, BLANK_ALL)
  await load()
})
</script>

<style scoped>
.sum-note { margin-top: 8px; font-size: 11.5px; color: var(--biz-text-3); }
.ps-sub { font-size: 11px; color: var(--biz-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ps-sub.is-expire { color: var(--biz-danger); }
.num { font-family: var(--biz-font-num); }

/* 收入归属的说明条：算法要写在页面上，不然没人知道年化是怎么来的 */
.inc-note {
  margin-top: 10px; padding: 9px 12px; border-radius: 7px; font-size: 12px; line-height: 1.8;
  background: rgba(91, 108, 255, .06); color: var(--biz-text-3);
}
.dstat__s { margin-top: 2px; font-size: 11px; color: var(--biz-text-4, #a6adc1); line-height: 1.5; }

/* ---------------- 审批段 ---------------- */
.ap-empty {
  padding: 10px 12px; border-radius: 7px; font-size: 12.5px; line-height: 1.8;
  background: var(--biz-bg-fill); color: var(--biz-text-3);
}
.ap {
  margin-top: 10px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--biz-border, #eef0f6); background: var(--biz-bg-card, #fff);
}
.ap.is-live { border-color: rgba(217, 138, 31, .38); background: rgba(217, 138, 31, .04); }
.ap__hd { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ap__no { font-family: var(--biz-font-num); font-size: 12.5px; font-weight: 600; }
.ap__cur { font-size: 11.5px; color: var(--biz-warning, #d98a1f); }
.ap__cur.is-muted { color: var(--biz-text-3); }
.ap__flow { margin-top: 10px; padding-left: 4px; }
.ap__node { position: relative; display: flex; gap: 10px; padding: 0 0 12px 14px; }
.ap__node:last-child { padding-bottom: 0; }
/* 竖线：把节点串成一条流程 */
.ap__node::before {
  content: ''; position: absolute; left: 3px; top: 12px; bottom: 0; width: 1px;
  background: var(--biz-border, #eef0f6);
}
.ap__node:last-child::before { display: none; }
.ap__dot {
  position: absolute; left: 0; top: 4px; width: 7px; height: 7px; border-radius: 50%;
  background: var(--biz-border, #dfe3ee);
}
.ap__node.is-done .ap__dot { background: #12b98a; }
.ap__node.is-now .ap__dot { background: var(--biz-warning, #d98a1f); box-shadow: 0 0 0 3px rgba(217, 138, 31, .18); }
.ap__node.is-reject .ap__dot { background: var(--biz-danger, #e34d59); }
.ap__node.is-wait .ap__dot, .ap__node.is-void .ap__dot { background: #dfe3ee; }
.ap__name { font-size: 12.5px; color: var(--biz-text-1); display: flex; align-items: center; gap: 6px; }
.ap__node.is-wait .ap__name { color: var(--biz-text-3); }
.ap__act {
  padding: 0 5px; border-radius: 3px; font-size: 10.5px; background: var(--biz-bg-fill);
  color: var(--biz-text-3);
}
.ap__node.is-done .ap__act { background: rgba(18, 185, 138, .1); color: #12b98a; }
.ap__node.is-now .ap__act { background: rgba(217, 138, 31, .12); color: var(--biz-warning, #d98a1f); }
.ap__node.is-reject .ap__act { background: rgba(227, 77, 89, .1); color: var(--biz-danger, #e34d59); }
.ap__meta { margin-top: 1px; font-size: 11.5px; color: var(--biz-text-3); }
.ap__cmt { margin-top: 2px; font-size: 11.5px; color: var(--biz-text-2); line-height: 1.6; }
.ps-sub.is-ap { color: var(--biz-warning, #d98a1f); }
</style>
