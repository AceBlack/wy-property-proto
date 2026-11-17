package com.wy.property.billing.deposit;

import java.math.BigDecimal;
import java.util.List;

/**
 * 押金三向流水报表。
 *
 * <pre>
 * 单笔：balance = ΣI − ΣO − ΣD
 * 全租户：Σ(balance) = ΣI − ΣO − ΣD = 押金在账总额
 * </pre>
 *
 * @param difference Σbalance − (ΣI − ΣO − ΣD)，自检要求为 0
 */
public record DepositFlowReport(
        List<Flow> flows,
        long depositCount,
        BigDecimal balanceTotal,
        BigDecimal inTotal,
        BigDecimal outTotal,
        BigDecimal deductTotal,
        BigDecimal difference) {

    /**
     * @param calculated 流水算出来的余额 = in − out − deduct
     * @param difference 物化余额 − 流水余额，不为 0 即该笔押金对不上账
     */
    public record Flow(long depositId,
                       String depositNo,
                       String communityId,
                       String status,
                       BigDecimal balance,
                       BigDecimal inAmount,
                       BigDecimal outAmount,
                       BigDecimal deductAmount,
                       BigDecimal calculated,
                       BigDecimal difference) {
    }
}
