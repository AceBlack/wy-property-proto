package com.wy.property.billing.daily;

import com.wy.property.billing.aging.AgingRepository;
import com.wy.property.billing.community.CommunityGuard;
import com.wy.property.common.money.Money;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 经营日报：收入 / 押金往来 / 押金退款 三段 + 收款点七格 + 差额自检。
 *
 * <p>差额口径（2026-11-18 确认）：<b>收款点全方式</b>，含押金收退。
 * 也就是说差额为 0 表示"前台经手的所有钱都能在收款点上找到出处"，
 * 不代表抽屉里的现金对得上——抽屉现金看"现金 / 车辆现金"两格。</p>
 */
@Repository
public class DailyRevenueRepository {

    /** 契约与《费用与财务体系》一致的七个固定位，顺序固定。 */
    private static final List<String> SLOT_ORDER = List.of(
            "现金", "车辆现金", "POS刷卡", "车辆POS", "转账", "车辆云平台", "线上支付");

    /** 预存抵扣不是新收到的钱，但账单确实销了；单独一格，否则差额永远不为 0。 */
    private static final String SLOT_PREPAID = "预存抵扣";

    private final DailyRevenueMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public DailyRevenueRepository(DailyRevenueMapper mapper,
                                  CommunityGuard communityGuard,
                                  TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    public DailyRevenueReport query(YearMonth month, String communityId) {
        communityGuard.assertVisible(communityId);

        LocalDate firstDay = month.atDay(1);
        int dayCount = month.lengthOfMonth();
        OffsetDateTime fromTs = firstDay.atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();
        OffsetDateTime toTs = firstDay.plusMonths(1).atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();

        List<DailyIncomeRow> incomeRows = tenantTx.execute(
                () -> mapper.selectIncome(fromTs, toTs, communityId));
        List<DailyDepositRow> depositRows = tenantTx.execute(
                () -> mapper.selectDeposits(fromTs, toTs, communityId));
        List<DailyPayPointRow> payPointRows = tenantTx.execute(
                () -> mapper.selectPayPoints(fromTs, toTs, communityId));

        List<LocalDate> days = new ArrayList<>(dayCount);
        Map<LocalDate, Integer> index = new LinkedHashMap<>();
        for (int i = 1; i <= dayCount; i++) {
            LocalDate day = month.atDay(i);
            days.add(day);
            index.put(day, i - 1);
        }

        // 收入段：科目 → 每日金额
        Map<String, BigDecimal[]> income = new TreeMap<>();
        for (DailyIncomeRow row : incomeRows) {
            income.computeIfAbsent(row.getCategory(), k -> zeros(dayCount))
                    [index.get(row.getDay())] = income.get(row.getCategory())[index.get(row.getDay())]
                    .add(Money.of(row.getAmount()));
        }

        // 往来 / 退款段
        Map<String, BigDecimal[]> liaison = new TreeMap<>();
        Map<String, BigDecimal[]> refund = new TreeMap<>();
        for (DailyDepositRow row : depositRows) {
            Map<String, BigDecimal[]> target = "I".equals(row.getDirection()) ? liaison : refund;
            int i = index.get(row.getDay());
            BigDecimal[] arr = target.computeIfAbsent(row.getType(), k -> zeros(dayCount));
            arr[i] = arr[i].add(Money.of(row.getAmount()));
        }

        // 收款点：七格 + 预存抵扣；同时按来源拆出"不含押金"的合计
        Map<String, BigDecimal[]> slots = new LinkedHashMap<>();
        Map<String, BigDecimal[]> paymentSlots = new LinkedHashMap<>();
        for (DailyPayPointRow row : payPointRows) {
            int i = index.get(row.getDay());
            BigDecimal amount = Money.of(row.getAmount());
            BigDecimal[] all = slots.computeIfAbsent(row.getSlot(), k -> zeros(dayCount));
            all[i] = all[i].add(amount);
            if ("payment".equals(row.getSource())) {
                BigDecimal[] pay = paymentSlots.computeIfAbsent(row.getSlot(), k -> zeros(dayCount));
                pay[i] = pay[i].add(amount);
            }
        }

        // 合计 = 收入 + 往来 − 退款
        BigDecimal[] incomeDaily = zeros(dayCount);
        List<DailyRevenueReport.Line> incomeLines = new ArrayList<>();
        for (Map.Entry<String, BigDecimal[]> e : income.entrySet()) {
            for (int i = 0; i < dayCount; i++) {
                incomeDaily[i] = incomeDaily[i].add(e.getValue()[i]);
            }
            incomeLines.add(line(e.getKey(), "income", e.getValue()));
        }
        BigDecimal[] liaisonDaily = zeros(dayCount);
        List<DailyRevenueReport.Line> liaisonLines = new ArrayList<>();
        for (Map.Entry<String, BigDecimal[]> e : liaison.entrySet()) {
            for (int i = 0; i < dayCount; i++) {
                liaisonDaily[i] = liaisonDaily[i].add(e.getValue()[i]);
            }
            liaisonLines.add(line(e.getKey(), "liaison", e.getValue()));
        }
        BigDecimal[] refundDaily = zeros(dayCount);
        List<DailyRevenueReport.Line> refundLines = new ArrayList<>();
        for (Map.Entry<String, BigDecimal[]> e : refund.entrySet()) {
            for (int i = 0; i < dayCount; i++) {
                refundDaily[i] = refundDaily[i].add(e.getValue()[i]);
            }
            refundLines.add(line(e.getKey(), "refund", e.getValue()));
        }

        BigDecimal[] grandDaily = new BigDecimal[dayCount];
        for (int i = 0; i < dayCount; i++) {
            grandDaily[i] = Money.subtract(
                    Money.add(incomeDaily[i], liaisonDaily[i]), refundDaily[i]);
        }

        // 差额 = 合计 − Σ收款点（全部来源）
        BigDecimal[] diffDaily = new BigDecimal[dayCount];
        List<DailyRevenueReport.Diff.BadDay> badDays = new ArrayList<>();
        BigDecimal diffTotal = BigDecimal.ZERO;
        for (int i = 0; i < dayCount; i++) {
            BigDecimal pointSum = BigDecimal.ZERO;
            for (BigDecimal[] arr : slots.values()) {
                pointSum = pointSum.add(arr[i]);
            }
            diffDaily[i] = Money.subtract(grandDaily[i], pointSum);
            diffTotal = diffTotal.add(diffDaily[i]);
            if (!Money.isZero(diffDaily[i])) {
                badDays.add(new DailyRevenueReport.Diff.BadDay(days.get(i), diffDaily[i]));
            }
        }

        List<DailyRevenueReport.PayPoint> payPoints = new ArrayList<>();
        for (String slot : SLOT_ORDER) {
            BigDecimal[] arr = slots.getOrDefault(slot, zeros(dayCount));
            payPoints.add(new DailyRevenueReport.PayPoint(slot, toList(arr), sum(arr)));
        }
        if (slots.containsKey(SLOT_PREPAID)) {
            BigDecimal[] arr = slots.get(SLOT_PREPAID);
            payPoints.add(new DailyRevenueReport.PayPoint(SLOT_PREPAID, toList(arr), sum(arr)));
        }

        BigDecimal[] paymentDaily = zeros(dayCount);
        for (BigDecimal[] arr : paymentSlots.values()) {
            for (int i = 0; i < dayCount; i++) {
                paymentDaily[i] = paymentDaily[i].add(arr[i]);
            }
        }
        int activeDays = 0;
        for (BigDecimal value : paymentDaily) {
            if (!Money.isZero(value)) {
                activeDays++;
            }
        }

        List<DailyRevenueReport.Group> groups = List.of(
                new DailyRevenueReport.Group("income", "营业收入", incomeLines,
                        toList(incomeDaily), sum(incomeDaily)),
                new DailyRevenueReport.Group("liaison", "押金收取（负债）", liaisonLines,
                        toList(liaisonDaily), sum(liaisonDaily)),
                new DailyRevenueReport.Group("refund", "押金退还", refundLines,
                        toList(refundDaily), sum(refundDaily)));

        return new DailyRevenueReport(
                month.toString(),
                days,
                groups,
                new DailyRevenueReport.Amounts(toList(grandDaily), sum(grandDaily)),
                payPoints,
                new DailyRevenueReport.Diff(toList(diffDaily), Money.of(diffTotal),
                        badDays.isEmpty(), badDays),
                new DailyRevenueReport.Summary(
                        sum(incomeDaily), sum(liaisonDaily), sum(refundDaily), sum(grandDaily),
                        sum(paymentDaily), dayCount, activeDays));
    }

    private static DailyRevenueReport.Line line(String category, String group, BigDecimal[] arr) {
        return new DailyRevenueReport.Line(category, category, group, toList(arr), sum(arr));
    }

    private static BigDecimal[] zeros(int n) {
        BigDecimal[] arr = new BigDecimal[n];
        java.util.Arrays.fill(arr, Money.zero());
        return arr;
    }

    private static List<BigDecimal> toList(BigDecimal[] arr) {
        List<BigDecimal> list = new ArrayList<>(arr.length);
        for (BigDecimal v : arr) {
            list.add(Money.of(v));
        }
        return List.copyOf(list);
    }

    private static BigDecimal sum(BigDecimal[] arr) {
        BigDecimal total = BigDecimal.ZERO;
        for (BigDecimal v : arr) {
            total = total.add(v);
        }
        return Money.of(total);
    }
}
