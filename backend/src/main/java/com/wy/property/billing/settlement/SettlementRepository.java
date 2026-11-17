package com.wy.property.billing.settlement;

import com.wy.property.billing.aging.AgingRepository;
import com.wy.property.billing.community.CommunityGuard;
import com.wy.property.common.money.Money;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * 日结：按 {@code paid_at} 分营业日，现金收入 = Σ 各收款点。
 *
 * <p>两个时间口径不能混：{@code paid_at} 是钱到账（日结、现金收入），
 * {@code payment.period} 是归属账期（三率）。跨期缴费时两者不同，别拿 period 做日结。</p>
 */
@Repository
public class SettlementRepository {

    private final SettlementMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public SettlementRepository(SettlementMapper mapper,
                                CommunityGuard communityGuard,
                                TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    /** 单日交班表。 */
    public DailySettlement queryDay(LocalDate day, String communityId) {
        SettlementReport report = query(day, day, communityId);
        return report.days().isEmpty()
                ? new DailySettlement(day, 0L, Money.zero(), Money.zero(), Map.of(), Money.zero(), Money.zero())
                : report.days().get(0);
    }

    /**
     * 区间日结（两端含）。
     *
     * @param from 起始营业日
     * @param to   结束营业日
     */
    public SettlementReport query(LocalDate from, LocalDate to, String communityId) {
        if (from.isAfter(to)) {
            throw new IllegalArgumentException("起始日不能晚于结束日：" + from + " > " + to);
        }
        communityGuard.assertVisible(communityId);

        // 营业日边界用 Asia/Shanghai 明确换算，不依赖服务器时区
        OffsetDateTime fromTs = from.atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();
        OffsetDateTime toTs = to.plusDays(1).atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();

        List<DailySummaryRow> summaries = tenantTx.execute(() -> mapper.selectDaily(fromTs, toTs, communityId));
        List<PayPointRow> points = tenantTx.execute(() -> mapper.selectByPayPoint(fromTs, toTs, communityId));

        Map<LocalDate, Map<String, BigDecimal>> pointsByDay = new TreeMap<>();
        for (PayPointRow row : points) {
            String point = row.getPayPoint() == null ? "(未指定收款点)" : row.getPayPoint();
            pointsByDay.computeIfAbsent(row.getBizDate(), k -> new LinkedHashMap<>())
                    .merge(point, Money.of(row.getAmount()), BigDecimal::add);
        }

        List<DailySettlement> days = new ArrayList<>(summaries.size());
        long totalCount = 0L;
        BigDecimal totalAmount = BigDecimal.ZERO;
        BigDecimal totalCash = BigDecimal.ZERO;
        BigDecimal totalDiff = BigDecimal.ZERO;

        for (DailySummaryRow row : summaries) {
            Map<String, BigDecimal> byPoint = pointsByDay.getOrDefault(row.getBizDate(), Map.of());
            BigDecimal pointTotal = byPoint.values().stream()
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            pointTotal = Money.of(pointTotal);
            BigDecimal total = Money.of(row.getTotalAmount());
            BigDecimal diff = Money.subtract(total, pointTotal);

            days.add(new DailySettlement(row.getBizDate(),
                    row.getTxnCount() == null ? 0L : row.getTxnCount(),
                    total,
                    Money.of(row.getCashAmount()),
                    Map.copyOf(byPoint),
                    pointTotal,
                    diff));

            totalCount += row.getTxnCount() == null ? 0L : row.getTxnCount();
            totalAmount = totalAmount.add(total);
            totalCash = totalCash.add(Money.of(row.getCashAmount()));
            totalDiff = totalDiff.add(diff);
        }

        return new SettlementReport(from, to, List.copyOf(days), totalCount,
                Money.of(totalAmount), Money.of(totalCash), Money.of(totalDiff));
    }
}
