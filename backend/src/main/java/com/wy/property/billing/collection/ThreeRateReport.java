package com.wy.property.billing.collection;

import java.math.BigDecimal;
import java.util.List;

/**
 * 三率报表（契约 {@code ThreeRate}），**理论应收口径**。
 *
 * <p>2026-11-18 口径确认：{@code receivable} 按"面积/户数/车位数 × 当期价 × 期数"算，
 * 不看有没有开单。库里价目与账单都不完整，所以三个口径必须并排给出来，否则看不出缺口在哪：</p>
 *
 * <ul>
 *   <li>{@code receivable} 理论应收（应有多少）</li>
 *   <li>{@code billedReceivable} 已开单应收（实际出了多少账）</li>
 *   <li>{@code billingGap} = 理论 − 已开单（开单缺口）</li>
 *   <li>{@code pricingGaps} 没有价目、算不出应收的房屋数——这部分<b>不在</b>上面的合计里</li>
 * </ul>
 *
 * <p>收缴率只在"有价范围"内计算。否则缺价的商业/公寓会以 0 应收参与分母，
 * 却把实收算进分子，比率会变成天文数字。</p>
 */
public record ThreeRateReport(
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
        List<UsageRow> byUsage,
        List<PeriodRow> byPeriod,
        long overpaid,
        Identity identity) {

    public record UsageRow(String usage, long houses, long pricingGaps,
                           BigDecimal receivable, BigDecimal billedReceivable,
                           BigDecimal received, BigDecimal waived, BigDecimal unpaid,
                           BigDecimal collectionRate, BigDecimal billedCollectionRate) {
    }

    public record PeriodRow(String period, BigDecimal receivable, BigDecimal billedReceivable,
                            BigDecimal received, BigDecimal waived, BigDecimal unpaid,
                            BigDecimal collectionRate) {
    }

    public record CashAttribution(BigDecimal current, BigDecimal clearing, BigDecimal prepaid,
                                  BigDecimal noPeriod, BigDecimal total, boolean ok) {
    }

    public record Identity(boolean ok, BigDecimal diff) {
    }
}
