package com.wy.property.billing.deposit;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 押金政策的历史体检结果。
 *
 * <p>政策从 2026-11-18 起执行，之前的数据不追溯改（改了就失真），
 * 但必须能一眼看见"哪些是政策前的现金押金"——审计问起来要答得出。</p>
 *
 * @param cashInTotal  历史现金收押金合计
 * @param cashOutTotal 历史现金退押金合计
 */
public record DepositPolicyAudit(
        List<CashViolation> cashViolations,
        List<MethodMismatch> methodMismatches,
        BigDecimal cashInTotal,
        BigDecimal cashOutTotal) {

    /** 收了或退了现金押金。direction：I 收 / O 退。 */
    public record CashViolation(long depositId, String depositNo, String direction,
                                BigDecimal amount, String method, LocalDate occurredAt) {
    }

    /** 退款方式不在收款方式集合里，说明没原路退。 */
    public record MethodMismatch(long depositId, String depositNo,
                                 List<String> collectMethods, List<String> refundMethods) {
    }
}
