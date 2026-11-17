package com.wy.property.billing.report;

import com.wy.property.billing.deposit.DepositLedgerReport;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** 契约 {@code DepositLedger} 的响应体。 */
public record DepositLedgerResponse(
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

    public static DepositLedgerResponse from(DepositLedgerReport report) {
        return new DepositLedgerResponse(
                report.from(), report.to(),
                report.received(), report.refunded(), report.deducted(), report.balance(),
                report.byType().stream()
                        .map(t -> new TypeRow(t.type(), t.count(),
                                t.received(), t.refunded(), t.deducted(), t.balance()))
                        .toList(),
                new Identity(report.identity().received(), report.identity().refunded(),
                        report.identity().deducted(), report.identity().balance(),
                        report.identity().diff(), report.identity().ok()));
    }
}
