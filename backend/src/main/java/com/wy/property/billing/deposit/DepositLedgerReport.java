package com.wy.property.billing.deposit;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 押金台账（契约 {@code DepositLedger}）。
 *
 * <p>期间数与余额是两个口径，别混：{@code received/refunded/deducted} 只看区间内发生的流水；
 * {@code balance} 是"截至 to 的累计余额"。{@code identity} 又是第三个口径——全量，用来验恒等式。</p>
 *
 * @param identityDiff 收 − (退 + 扣 + 在账)，不为 0 说明台账不平
 */
public record DepositLedgerReport(
        LocalDate from,
        LocalDate to,
        BigDecimal received,
        BigDecimal refunded,
        BigDecimal deducted,
        BigDecimal balance,
        List<TypeRow> byType,
        Identity identity) {

    public record TypeRow(String type, long count,
                          BigDecimal received, BigDecimal refunded, BigDecimal deducted, BigDecimal balance) {
    }

    public record Identity(BigDecimal received, BigDecimal refunded, BigDecimal deducted,
                           BigDecimal balance, BigDecimal diff, boolean ok) {
    }
}
