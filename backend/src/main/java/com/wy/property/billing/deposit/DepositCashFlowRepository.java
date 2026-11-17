package com.wy.property.billing.deposit;

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
 * 押金现金日结：回答"收银抽屉里为什么会多出/少了押金那笔钱"。
 *
 * <p>定位是<b>只读读模型</b>：不改 payment、不改 deposit_txn、不改日结现有口径。
 * 是否把押金现金并入交班表的"现金合计"，等口径确认后再改
 * {@code SettlementRepository}（见 08-开发设计/06-押金现金与日结口径建议.md）。</p>
 */
@Repository
public class DepositCashFlowRepository {

    private final DepositCashFlowMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public DepositCashFlowRepository(DepositCashFlowMapper mapper,
                                     CommunityGuard communityGuard,
                                     TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    public DepositCashReport query(LocalDate from, LocalDate to, String communityId) {
        if (from.isAfter(to)) {
            throw new IllegalArgumentException("起始日不能晚于结束日：" + from + " > " + to);
        }
        communityGuard.assertVisible(communityId);

        OffsetDateTime fromTs = from.atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();
        OffsetDateTime toTs = to.plusDays(1).atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();
        List<DepositCashRow> rows = tenantTx.execute(() -> mapper.selectCashFlow(fromTs, toTs, communityId));

        Map<LocalDate, Accumulator> byDay = new TreeMap<>();
        for (DepositCashRow row : rows) {
            Accumulator acc = byDay.computeIfAbsent(row.getBizDate(), Accumulator::new);
            acc.add(row);
        }

        List<DepositCashReport.Day> days = new ArrayList<>(byDay.size());
        BigDecimal cashIn = BigDecimal.ZERO;
        BigDecimal cashOut = BigDecimal.ZERO;
        BigDecimal nonCashIn = BigDecimal.ZERO;
        BigDecimal nonCashOut = BigDecimal.ZERO;

        for (Accumulator acc : byDay.values()) {
            days.add(acc.toDay());
            cashIn = cashIn.add(acc.cashIn);
            cashOut = cashOut.add(acc.cashOut);
            nonCashIn = nonCashIn.add(acc.nonCashIn);
            nonCashOut = nonCashOut.add(acc.nonCashOut);
        }

        BigDecimal cashInFinal = Money.of(cashIn);
        BigDecimal cashOutFinal = Money.of(cashOut);
        return new DepositCashReport(from, to, List.copyOf(days),
                cashInFinal, cashOutFinal, Money.subtract(cashInFinal, cashOutFinal),
                Money.of(nonCashIn), Money.of(nonCashOut));
    }

    private static final class Accumulator {
        private final LocalDate bizDate;
        private long txnCount;
        private BigDecimal cashIn = BigDecimal.ZERO;
        private BigDecimal cashOut = BigDecimal.ZERO;
        private BigDecimal nonCashIn = BigDecimal.ZERO;
        private BigDecimal nonCashOut = BigDecimal.ZERO;
        private final Map<String, BigDecimal> cashByPayPoint = new LinkedHashMap<>();

        private Accumulator(LocalDate bizDate) {
            this.bizDate = bizDate;
        }

        private void add(DepositCashRow row) {
            BigDecimal in = Money.of(row.getInAmount());
            BigDecimal out = Money.of(row.getOutAmount());
            boolean isCash = Boolean.TRUE.equals(row.getCash());
            txnCount += row.getTxnCount() == null ? 0L : row.getTxnCount();

            if (isCash) {
                cashIn = cashIn.add(in);
                cashOut = cashOut.add(out);
                String point = row.getPayPoint() == null ? "(未指定收款点)" : row.getPayPoint();
                cashByPayPoint.merge(point, Money.subtract(in, out), BigDecimal::add);
            } else {
                nonCashIn = nonCashIn.add(in);
                nonCashOut = nonCashOut.add(out);
            }
        }

        private DepositCashReport.Day toDay() {
            BigDecimal in = Money.of(cashIn);
            BigDecimal out = Money.of(cashOut);
            return new DepositCashReport.Day(bizDate, txnCount, in, out,
                    Money.subtract(in, out), Money.of(nonCashIn), Money.of(nonCashOut),
                    Map.copyOf(cashByPayPoint));
        }
    }
}
