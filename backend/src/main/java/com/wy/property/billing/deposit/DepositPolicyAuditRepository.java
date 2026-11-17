package com.wy.property.billing.deposit;

import com.wy.property.common.money.Money;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;

/**
 * 押金政策的历史体检（只读）。
 *
 * <p>政策不追溯改历史数据——改了就失真、审计也查不出原貌。
 * 这里只回答两个问题：哪些是政策前的现金押金？有没有没原路退的？</p>
 */
@Repository
public class DepositPolicyAuditRepository {

    private final DepositPolicyAuditMapper mapper;
    private final TenantTransactionTemplate tenantTx;

    public DepositPolicyAuditRepository(DepositPolicyAuditMapper mapper, TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.tenantTx = tenantTx;
    }

    public DepositPolicyAudit audit() {
        List<DepositCashViolationRow> cashRows = tenantTx.execute(mapper::selectCashViolations);
        List<DepositMethodMismatchRow> mismatchRows = tenantTx.execute(mapper::selectMethodMismatches);

        BigDecimal cashIn = BigDecimal.ZERO;
        BigDecimal cashOut = BigDecimal.ZERO;
        List<DepositPolicyAudit.CashViolation> cashViolations = new java.util.ArrayList<>(cashRows.size());
        for (DepositCashViolationRow row : cashRows) {
            BigDecimal amount = Money.of(row.getAmount());
            cashViolations.add(new DepositPolicyAudit.CashViolation(
                    row.getDepositId(), row.getDepositNo(), row.getDirection(),
                    amount, row.getMethod(), row.getOccurredAt()));
            if ("I".equals(row.getDirection())) {
                cashIn = cashIn.add(amount);
            } else if ("O".equals(row.getDirection())) {
                cashOut = cashOut.add(amount);
            }
        }

        List<DepositPolicyAudit.MethodMismatch> mismatches = mismatchRows.stream()
                .map(row -> new DepositPolicyAudit.MethodMismatch(
                        row.getDepositId(), row.getDepositNo(),
                        split(row.getCollectMethods()), split(row.getRefundMethods())))
                .toList();

        return new DepositPolicyAudit(List.copyOf(cashViolations), mismatches,
                Money.of(cashIn), Money.of(cashOut));
    }

    private static List<String> split(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
