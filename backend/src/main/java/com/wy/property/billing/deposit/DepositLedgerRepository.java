package com.wy.property.billing.deposit;

import com.wy.property.billing.aging.AgingRepository;
import com.wy.property.billing.community.CommunityGuard;
import com.wy.property.common.money.Money;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * 押金台账报表（契约 {@code /reports/deposit-ledger}）。
 *
 * <p>三个口径必须分开：期间发生额、截至日的累计余额、全量恒等式。
 * 混用任何一个，报表都会"看着对、对账不对"。</p>
 */
@Repository
public class DepositLedgerRepository {

    private final DepositLedgerMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public DepositLedgerRepository(DepositLedgerMapper mapper,
                                   CommunityGuard communityGuard,
                                   TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    public DepositLedgerReport query(LocalDate from, LocalDate to, String communityId) {
        if (from.isAfter(to)) {
            throw new IllegalArgumentException("起始日不能晚于结束日：" + from + " > " + to);
        }
        communityGuard.assertVisible(communityId);

        OffsetDateTime fromTs = from.atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();
        OffsetDateTime toTs = to.plusDays(1).atStartOfDay(AgingRepository.BUSINESS_ZONE).toOffsetDateTime();

        List<DepositLedgerTypeRow> rows = tenantTx.execute(() -> mapper.selectByType(fromTs, toTs, communityId));
        DepositIdentityRow identityRow = tenantTx.execute(() -> mapper.selectIdentity(communityId));

        BigDecimal received = BigDecimal.ZERO;
        BigDecimal refunded = BigDecimal.ZERO;
        BigDecimal deducted = BigDecimal.ZERO;
        BigDecimal balance = BigDecimal.ZERO;
        for (DepositLedgerTypeRow row : rows) {
            received = received.add(Money.of(row.getReceived()));
            refunded = refunded.add(Money.of(row.getRefunded()));
            deducted = deducted.add(Money.of(row.getDeducted()));
            balance = balance.add(Money.of(row.getBalance()));
        }

        List<DepositLedgerReport.TypeRow> byType = rows.stream()
                .map(row -> new DepositLedgerReport.TypeRow(
                        row.getType(),
                        row.getDepositCount() == null ? 0L : row.getDepositCount(),
                        Money.of(row.getReceived()), Money.of(row.getRefunded()),
                        Money.of(row.getDeducted()), Money.of(row.getBalance())))
                .toList();

        BigDecimal allReceived = Money.of(identityRow == null ? null : identityRow.getReceived());
        BigDecimal allRefunded = Money.of(identityRow == null ? null : identityRow.getRefunded());
        BigDecimal allDeducted = Money.of(identityRow == null ? null : identityRow.getDeducted());
        BigDecimal allBalance = Money.of(identityRow == null ? null : identityRow.getBalance());
        BigDecimal diff = Money.subtract(allReceived, Money.add(allRefunded, Money.add(allDeducted, allBalance)));

        return new DepositLedgerReport(from, to,
                Money.of(received), Money.of(refunded), Money.of(deducted), Money.of(balance),
                byType,
                new DepositLedgerReport.Identity(allReceived, allRefunded, allDeducted, allBalance,
                        diff, Money.isZero(diff)));
    }
}
