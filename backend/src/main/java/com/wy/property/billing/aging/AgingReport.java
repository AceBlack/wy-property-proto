package com.wy.property.billing.aging;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 账龄报表。
 *
 * @param referenceDate 计算基准日（账龄 = 基准日 − due_date）
 * @param buckets       固定 5 档，无数据的档给 0，不省略——前端不必自己补空档
 */
public record AgingReport(LocalDate referenceDate,
                          List<Bucket> buckets,
                          long totalCount,
                          BigDecimal totalOwed) {

    /**
     * @param owedAmount 未结清金额 = payable − waive_amount − paid_amount
     * @param houses     涉及的房屋数（车位账单没有 house_id，不计数）
     */
    public record Bucket(AgingBucket bucket, long billCount, long houses, BigDecimal owedAmount) {
    }
}
