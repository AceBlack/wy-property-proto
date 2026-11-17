package com.wy.property.billing.report;

import com.wy.property.billing.aging.AgingLiveReport;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** 契约 {@code AgingLive} 的响应体。字段名与契约一致，不直接暴露领域模型。 */
public record AgingLiveResponse(
        LocalDate asOf,
        BigDecimal total,
        long count,
        long houses,
        List<Row> rows,
        List<Community> byCommunity,
        List<Oldest> oldest) {

    /** @param share 占比（百分数） */
    public record Row(String bucket, long count, long houses, BigDecimal amount, BigDecimal share) {
    }

    public record Community(String communityId, String name, long houses, BigDecimal amount) {
    }

    public record Oldest(String billId, String period, LocalDate dueDate,
                         String aging, int overdueDays, BigDecimal unpaid) {
    }

    public static AgingLiveResponse from(AgingLiveReport report) {
        return new AgingLiveResponse(
                report.asOf(),
                report.totalOwed(),
                report.totalCount(),
                report.totalHouses(),
                report.rows().stream()
                        .map(r -> new Row(r.bucket().label(), r.count(), r.houses(), r.amount(), r.share()))
                        .toList(),
                report.byCommunity().stream()
                        .map(c -> new Community(c.communityId(), c.name(), c.houses(), c.amount()))
                        .toList(),
                report.oldest().stream()
                        .map(o -> new Oldest(o.billId(), o.period(), o.dueDate(),
                                o.aging().label(), o.overdueDays(), o.unpaid()))
                        .toList());
    }
}
