package com.wy.property.billing.report;

import com.wy.property.billing.collection.ThreeRateReport;

import java.math.BigDecimal;
import java.util.List;

/**
 * 契约 {@code ThreeRate} 的响应体。
 *
 * <p>{@code billedReceivable} / {@code billingGap} / {@code billedCollectionRate} /
 * {@code pricingGaps} 是契约外补充字段：现有库里价目和账单都不全，
 * 只给一个"理论收缴率"会让使用方以为系统算错了，必须能一眼看到缺口在哪。</p>
 */
public record ThreeRateResponse(
        String from,
        String to,
        String itemId,
        String itemName,
        int periods,
        long houses,
        BigDecimal receivable,
        BigDecimal billedReceivable,
        BigDecimal billingGap,
        long pricingGaps,
        BigDecimal received,
        BigDecimal waived,
        BigDecimal unpaid,
        BigDecimal collectionRate,
        BigDecimal billedCollectionRate,
        BigDecimal arrearsRate,
        BigDecimal waiveRate,
        BigDecimal clearingAmount,
        BigDecimal prepayReceived,
        BigDecimal cashIncome,
        CashAttribution cashByAttribution,
        List<Usage> byUsage,
        List<Period> byPeriod,
        long overpaid,
        Identity identity) {

    public record CashAttribution(BigDecimal current, BigDecimal clearing, BigDecimal prepaid,
                                  BigDecimal noPeriod, BigDecimal total, boolean ok) {
    }

    public record Usage(String usage, long houses, long pricingGaps,
                        BigDecimal receivable, BigDecimal billedReceivable,
                        BigDecimal received, BigDecimal waived, BigDecimal unpaid,
                        BigDecimal collectionRate, BigDecimal billedCollectionRate) {
    }

    public record Period(String period, BigDecimal receivable, BigDecimal billedReceivable,
                         BigDecimal received, BigDecimal waived, BigDecimal unpaid,
                         BigDecimal collectionRate) {
    }

    public record Identity(boolean ok, BigDecimal diff) {
    }

    public static ThreeRateResponse from(ThreeRateReport r) {
        return new ThreeRateResponse(
                r.from(), r.to(), r.itemId(), r.itemName(), r.periods(), r.houses(),
                r.receivable(), r.billedReceivable(), r.billingGap(), r.pricingGaps(),
                r.received(), r.waived(), r.unpaid(),
                r.collectionRate(), r.billedCollectionRate(), r.arrearsRate(), r.waiveRate(),
                r.clearingAmount(), r.prepayReceived(), r.cashIncome(),
                new CashAttribution(r.cashByAttribution().current(), r.cashByAttribution().clearing(),
                        r.cashByAttribution().prepaid(), r.cashByAttribution().noPeriod(),
                        r.cashByAttribution().total(), r.cashByAttribution().ok()),
                r.byUsage().stream()
                        .map(u -> new Usage(u.usage(), u.houses(), u.pricingGaps(),
                                u.receivable(), u.billedReceivable(), u.received(), u.waived(),
                                u.unpaid(), u.collectionRate(), u.billedCollectionRate()))
                        .toList(),
                r.byPeriod().stream()
                        .map(p -> new Period(p.period(), p.receivable(), p.billedReceivable(),
                                p.received(), p.waived(), p.unpaid(), p.collectionRate()))
                        .toList(),
                r.overpaid(),
                new Identity(r.identity().ok(), r.identity().diff()));
    }
}
