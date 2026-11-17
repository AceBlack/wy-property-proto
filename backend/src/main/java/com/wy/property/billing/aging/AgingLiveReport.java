package com.wy.property.billing.aging;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 实时账龄报表（契约 {@code AgingLive}）。
 *
 * <p>与 {@link AgingReport} 的区别：这里多了房屋数、占比、按项目拆分和最久欠费清单，
 * 是给前端一张表直接画的；{@code AgingReport} 是给内部对账用的最小口径。</p>
 *
 * @param totalHouses 涉及的房屋数（去重，不是各档相加——一套房可能欠多期）
 */
public record AgingLiveReport(
        LocalDate asOf,
        long totalCount,
        long totalHouses,
        BigDecimal totalOwed,
        List<Row> rows,
        List<CommunityRow> byCommunity,
        List<Oldest> oldest) {

    /**
     * @param share 占比（百分数，保留 2 位）；总额为 0 时给 0 而不是 null，
     *              前端画进度条不接受 null
     */
    public record Row(AgingBucket bucket, long count, long houses, BigDecimal amount, BigDecimal share) {
    }

    public record CommunityRow(String communityId, String name, long houses, BigDecimal amount) {
    }

    /**
     * @param overdueDays asOf − dueDate，未到期时为负数
     */
    public record Oldest(String billId, String period, LocalDate dueDate,
                         AgingBucket aging, int overdueDays, BigDecimal unpaid) {
    }
}
