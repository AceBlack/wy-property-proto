package com.wy.property.billing.collection;

import com.wy.property.common.money.Money;

import java.math.BigDecimal;
import java.util.List;

/**
 * 三率口径，全系统唯一实现。
 *
 * <pre>
 * 净应缴 = payable − waive_amount        ← payable 是应缴「原价」，减免单列，别减错
 * 收缴率 = 实收 ÷ 净应缴
 * 排除：已作废（status='已作废'）与已逻辑删除
 * </pre>
 */
public final class CollectionRateCalculator {

    public static final String TOTAL_LABEL = "合计";

    private CollectionRateCalculator() {
    }

    public static CollectionRateResult of(CollectionRateRow row) {
        BigDecimal payable = Money.of(row.getPayable());
        BigDecimal waive = Money.of(row.getWaiveAmount());
        BigDecimal paid = Money.of(row.getPaidAmount());
        return build(row.getCommunityId(), row.getCommunityName(),
                payable, waive, paid, row.getBillCount() == null ? 0L : row.getBillCount());
    }

    public static CollectionRateResult total(List<CollectionRateRow> rows) {
        BigDecimal payable = BigDecimal.ZERO;
        BigDecimal waive = BigDecimal.ZERO;
        BigDecimal paid = BigDecimal.ZERO;
        long count = 0L;
        for (CollectionRateRow row : rows) {
            payable = payable.add(Money.of(row.getPayable()));
            waive = waive.add(Money.of(row.getWaiveAmount()));
            paid = paid.add(Money.of(row.getPaidAmount()));
            count += row.getBillCount() == null ? 0L : row.getBillCount();
        }
        return build(null, TOTAL_LABEL, Money.of(payable), Money.of(waive), Money.of(paid), count);
    }

    private static CollectionRateResult build(String communityId, String communityName,
                                              BigDecimal payable, BigDecimal waive,
                                              BigDecimal paid, long billCount) {
        BigDecimal net = Money.subtract(payable, waive);
        BigDecimal rate = Money.percent(paid, net);
        return new CollectionRateResult(communityId, communityName,
                payable, waive, net, paid, rate, billCount);
    }
}
