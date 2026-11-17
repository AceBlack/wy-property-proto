package com.wy.property.billing.report;

import com.wy.property.billing.daily.DailyRevenueReport;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** 契约 {@code DailyRevenue} 的响应体。 */
public record DailyRevenueResponse(
        String month,
        List<LocalDate> days,
        List<Group> groups,
        Amounts grand,
        List<PayPoint> payPoints,
        Diff diff,
        Summary summary) {

    public record Group(String key, String name, List<Line> rows,
                        List<BigDecimal> subtotal, BigDecimal total) {
    }

    public record Line(String code, String name, String group,
                       List<BigDecimal> amounts, BigDecimal total) {
    }

    public record Amounts(List<BigDecimal> amounts, BigDecimal total) {
    }

    public record PayPoint(String name, List<BigDecimal> amounts, BigDecimal total) {
    }

    public record Diff(List<BigDecimal> amounts, BigDecimal total, boolean ok,
                       List<BadDay> badDays) {
        public record BadDay(LocalDate day, BigDecimal diff) {
        }
    }

    public record Summary(BigDecimal income, BigDecimal liaison, BigDecimal refund,
                          BigDecimal grand, BigDecimal cash, int days, int activeDays) {
    }

    public static DailyRevenueResponse from(DailyRevenueReport r) {
        return new DailyRevenueResponse(
                r.month(),
                r.days(),
                r.groups().stream()
                        .map(g -> new Group(g.key(), g.name(),
                                g.rows().stream()
                                        .map(l -> new Line(l.code(), l.name(), l.group(),
                                                l.amounts(), l.total()))
                                        .toList(),
                                g.subtotal(), g.total()))
                        .toList(),
                new Amounts(r.grand().amounts(), r.grand().total()),
                r.payPoints().stream()
                        .map(p -> new PayPoint(p.name(), p.amounts(), p.total()))
                        .toList(),
                new Diff(r.diff().amounts(), r.diff().total(), r.diff().ok(),
                        r.diff().badDays().stream()
                                .map(b -> new Diff.BadDay(b.day(), b.diff()))
                                .toList()),
                new Summary(r.summary().income(), r.summary().liaison(), r.summary().refund(),
                        r.summary().grand(), r.summary().cash(),
                        r.summary().days(), r.summary().activeDays()));
    }
}
