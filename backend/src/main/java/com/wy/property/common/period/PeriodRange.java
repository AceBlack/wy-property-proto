package com.wy.property.common.period;

import java.time.YearMonth;
import java.util.Objects;

/**
 * 账期区间，两端闭区间（{@code bill.period} 是 {@code YYYY-MM} 的 char(7)）。
 *
 * <p>跨年是常态：{@code 2025-12 ~ 2026-01} 必须能查，且不能把 {@code 2025-11} 或
 * {@code 2026-02} 带进来。字符串比较因为格式定长有序，可以直接用，但入参必须校验。</p>
 */
public record PeriodRange(YearMonth from, YearMonth to) {

    public PeriodRange {
        Objects.requireNonNull(from, "账期起始不能为空");
        Objects.requireNonNull(to, "账期结束不能为空");
        if (from.isAfter(to)) {
            throw new IllegalArgumentException("账期起始晚于结束：" + from + " > " + to);
        }
    }

    public static PeriodRange of(YearMonth from, YearMonth to) {
        return new PeriodRange(from, to);
    }

    public static PeriodRange of(String from, String to) {
        return new PeriodRange(YearMonth.parse(from), YearMonth.parse(to));
    }

    /** 自然年：{@code year(2026)} → 2026-01 ~ 2026-12。 */
    public static PeriodRange year(int year) {
        return new PeriodRange(YearMonth.of(year, 1), YearMonth.of(year, 12));
    }

    public String fromPeriod() {
        return from.toString();
    }

    public String toPeriod() {
        return to.toString();
    }

    public boolean contains(YearMonth period) {
        return !period.isBefore(from) && !period.isAfter(to);
    }
}
