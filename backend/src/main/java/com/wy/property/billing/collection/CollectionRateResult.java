package com.wy.property.billing.collection;

import java.math.BigDecimal;
import java.util.List;

/**
 * 三率结果（一个项目一行，或"合计"一行）。
 *
 * @param payable        应缴原价 Σpayable
 * @param waiveAmount    减免 Σwaive_amount
 * @param netPayable     净应缴 = payable − waiveAmount
 * @param paidAmount     实收 Σpaid_amount
 * @param collectionRate 收缴率（%），净应缴为 0 时为 null
 */
public record CollectionRateResult(
        String communityId,
        String communityName,
        BigDecimal payable,
        BigDecimal waiveAmount,
        BigDecimal netPayable,
        BigDecimal paidAmount,
        BigDecimal collectionRate,
        long billCount) {
}
