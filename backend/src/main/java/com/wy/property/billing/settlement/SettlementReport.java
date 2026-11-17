package com.wy.property.billing.settlement;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 日结报表（区间内逐日）。
 *
 * @param difference 区间差额，自检要求为 0
 */
public record SettlementReport(
        LocalDate from,
        LocalDate to,
        List<DailySettlement> days,
        long txnCount,
        BigDecimal totalAmount,
        BigDecimal cashAmount,
        BigDecimal difference) {
}
