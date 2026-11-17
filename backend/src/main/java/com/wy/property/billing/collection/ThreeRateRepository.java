package com.wy.property.billing.collection;

import com.wy.property.billing.aging.AgingRepository;
import com.wy.property.billing.community.CommunityGuard;
import com.wy.property.common.money.Money;
import com.wy.property.common.period.PeriodRange;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * 三率报表（契约 {@code /reports/three-rate}）。
 *
 * <p>四个口径同时出现，任何一个混用都会让报表"看着对、对账不对"：</p>
 * <ol>
 *   <li><b>理论应收</b>：面积/户数/车位 × 当期价 × 期数，不看开单；</li>
 *   <li><b>已开单应收 / 已收 / 减免</b>：来自账单；</li>
 *   <li><b>现金收入</b>：按收款日，排除预存抵扣；</li>
 *   <li><b>清欠 / 预收</b>：按归属账期切开本期现金。</li>
 * </ol>
 *
 * <p>收缴率只在"有价范围"内算：缺价用途（当前是商业、公寓）应收算不出来，
 * 若强行按 0 计入分母，实收却算进分子，比率会失真。</p>
 */
@Repository
public class ThreeRateRepository {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final ThreeRateMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public ThreeRateRepository(ThreeRateMapper mapper,
                               CommunityGuard communityGuard,
                               TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    public ThreeRateReport query(PeriodRange range, String itemCode, String communityId) {
        communityGuard.assertVisible(communityId);

        ThreeRateItemRow item = tenantTx.execute(() -> mapper.selectItem(itemCode));
        if (item == null) {
            throw new IllegalArgumentException("收费项不存在：" + itemCode);
        }

        // 《费用与财务体系》批 3：水电走"用量 × 单价"，抄表前不存在应收，硬塞进三率会把水混进来
        if (!"按面积".equals(item.getCalcType())
                && !"按户".equals(item.getCalcType())
                && !"按车位".equals(item.getCalcType())) {
            throw new IllegalArgumentException(
                    "该收费项不参与三率（" + item.getCalcType() + "计费）：" + itemCode);
        }

        String fromPeriod = range.fromPeriod();
        String toPeriod = range.toPeriod();
        OffsetDateTime fromTs = range.from().atDay(1).atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();
        OffsetDateTime toTs = range.to().plusMonths(1).atDay(1)
                .atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();

        List<ThreeRateTheoreticalRow> theoretical = tenantTx.execute(
                () -> mapper.selectTheoretical(item.getCalcType(), item.getId(),
                        range.from().atDay(1), range.to().atDay(1), communityId));
        List<ThreeRateActualRow> actuals = tenantTx.execute(
                () -> mapper.selectActuals(fromPeriod, toPeriod, itemCode, communityId));
        long overpaid = tenantTx.execute(
                () -> mapper.countOverpaid(fromPeriod, toPeriod, itemCode, communityId));
        BigDecimal cashIncomeRaw = tenantTx.execute(
                () -> mapper.selectCashIncome(fromTs, toTs, itemCode, communityId));
        ThreeRateCashRow cash = tenantTx.execute(
                () -> mapper.selectCashAttribution(fromTs, toTs, fromPeriod, toPeriod, itemCode, communityId));

        // 用途 → 期 → 理论应收
        Map<String, Map<String, BigDecimal>> theoreticalByUsage = new LinkedHashMap<>();
        Map<String, Long> housesByUsage = new LinkedHashMap<>();
        for (ThreeRateTheoreticalRow row : theoretical) {
            theoreticalByUsage
                    .computeIfAbsent(row.getUsage(), k -> new TreeMap<>())
                    .merge(row.getPeriod(), Money.of(row.getReceivable()), BigDecimal::add);
            long houses = row.getHouses() == null ? 0L : row.getHouses();
            housesByUsage.merge(row.getUsage(), houses, Math::max);
        }

        // 用途 → 期 → 实际数
        Map<String, Map<String, ThreeRateActualRow>> actualByUsage = new LinkedHashMap<>();
        for (ThreeRateActualRow row : actuals) {
            actualByUsage.computeIfAbsent(row.getUsage(), k -> new TreeMap<>()).put(row.getPeriod(), row);
        }

        // 有价用途：理论应收 > 0。只有它们进合计与收缴率。
        Set<String> pricedUsages = new LinkedHashSet<>();
        for (Map.Entry<String, Map<String, BigDecimal>> e : theoreticalByUsage.entrySet()) {
            BigDecimal sum = e.getValue().values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
            if (sum.signum() > 0) {
                pricedUsages.add(e.getKey());
            }
        }

        BigDecimal receivable = BigDecimal.ZERO;
        BigDecimal billed = BigDecimal.ZERO;
        BigDecimal received = BigDecimal.ZERO;
        BigDecimal waived = BigDecimal.ZERO;
        long houses = 0L;
        for (String usage : pricedUsages) {
            receivable = receivable.add(sum(theoreticalByUsage.get(usage)));
            houses += housesByUsage.getOrDefault(usage, 0L);
            for (ThreeRateActualRow row : actualByUsage.getOrDefault(usage, Map.of()).values()) {
                billed = billed.add(Money.of(row.getBilled()));
                received = received.add(Money.of(row.getReceived()));
                waived = waived.add(Money.of(row.getWaived()));
            }
        }

        long pricingGapHouses = 0L;
        for (String usage : theoreticalByUsage.keySet()) {
            if (!pricedUsages.contains(usage)) {
                pricingGapHouses += housesByUsage.getOrDefault(usage, 0L);
            }
        }

        receivable = Money.of(receivable);
        billed = Money.of(billed);
        received = Money.of(received);
        waived = Money.of(waived);
        BigDecimal unpaid = Money.subtract(receivable, Money.add(received, waived));
        BigDecimal collectionRate = Money.percent(received, Money.subtract(receivable, waived));
        BigDecimal billedCollectionRate = Money.percent(received, Money.subtract(billed, waived));

        // 按用途（全部用途都列，缺价的 rate 为 null）
        List<ThreeRateReport.UsageRow> byUsage = new ArrayList<>();
        Set<String> usages = new java.util.TreeSet<>(theoreticalByUsage.keySet());
        usages.addAll(actualByUsage.keySet());
        for (String usage : usages) {
            BigDecimal uRec = Money.of(sum(theoreticalByUsage.getOrDefault(usage, Map.of())));
            BigDecimal uBilled = BigDecimal.ZERO;
            BigDecimal uReceived = BigDecimal.ZERO;
            BigDecimal uWaived = BigDecimal.ZERO;
            for (ThreeRateActualRow row : actualByUsage.getOrDefault(usage, Map.of()).values()) {
                uBilled = uBilled.add(Money.of(row.getBilled()));
                uReceived = uReceived.add(Money.of(row.getReceived()));
                uWaived = uWaived.add(Money.of(row.getWaived()));
            }
            byUsage.add(new ThreeRateReport.UsageRow(
                    usage,
                    housesByUsage.getOrDefault(usage, 0L),
                    pricedUsages.contains(usage) ? 0L : housesByUsage.getOrDefault(usage, 0L),
                    uRec, Money.of(uBilled), Money.of(uReceived), Money.of(uWaived),
                    Money.subtract(uRec, Money.add(uReceived, uWaived)),
                    Money.isZero(uRec) ? null : Money.percent(uReceived, Money.subtract(uRec, uWaived)),
                    Money.isZero(uBilled) ? null : Money.percent(uReceived, Money.subtract(uBilled, uWaived))));
        }

        // 按账期：月份骨架完整，缺价用途不进应收
        List<ThreeRateReport.PeriodRow> byPeriod = new ArrayList<>();
        for (YearMonth m = range.from(); !m.isAfter(range.to()); m = m.plusMonths(1)) {
            String period = m.toString();
            BigDecimal pRec = BigDecimal.ZERO;
            for (String usage : pricedUsages) {
                pRec = pRec.add(Money.of(theoreticalByUsage.getOrDefault(usage, Map.of())
                        .getOrDefault(period, BigDecimal.ZERO)));
            }
            BigDecimal pBilled = BigDecimal.ZERO;
            BigDecimal pReceived = BigDecimal.ZERO;
            BigDecimal pWaived = BigDecimal.ZERO;
            for (String usage : pricedUsages) {
                ThreeRateActualRow row = actualByUsage.getOrDefault(usage, Map.of()).get(period);
                if (row != null) {
                    pBilled = pBilled.add(Money.of(row.getBilled()));
                    pReceived = pReceived.add(Money.of(row.getReceived()));
                    pWaived = pWaived.add(Money.of(row.getWaived()));
                }
            }
            byPeriod.add(new ThreeRateReport.PeriodRow(period, Money.of(pRec), Money.of(pBilled),
                    Money.of(pReceived), Money.of(pWaived),
                    Money.subtract(pRec, Money.add(pReceived, pWaived)),
                    Money.percent(pReceived, Money.subtract(pRec, pWaived))));
        }

        BigDecimal cashIncome = Money.of(cashIncomeRaw);
        BigDecimal cashTotal = Money.of(cash.getTotal());
        BigDecimal diff = Money.subtract(cashTotal, cashIncome);

        return new ThreeRateReport(
                fromPeriod, toPeriod, itemCode, item.getName(),
                (int) ChronoUnit.MONTHS.between(range.from(), range.to()) + 1,
                houses,
                receivable, billed, Money.subtract(receivable, billed), pricingGapHouses,
                received, waived, unpaid,
                collectionRate, billedCollectionRate,
                collectionRate == null ? null : Money.of(HUNDRED.subtract(collectionRate)),
                Money.percent(waived, receivable),
                Money.of(cash.getClearing()),
                Money.of(cash.getPrepaid()),
                cashIncome,
                new ThreeRateReport.CashAttribution(
                        Money.of(cash.getCurrent()), Money.of(cash.getClearing()),
                        Money.of(cash.getPrepaid()), Money.of(cash.getNoPeriod()),
                        cashTotal, Money.isZero(diff)),
                List.copyOf(byUsage), List.copyOf(byPeriod),
                overpaid,
                new ThreeRateReport.Identity(Money.isZero(diff), diff));
    }

    private static BigDecimal sum(Map<String, BigDecimal> values) {
        return values.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
