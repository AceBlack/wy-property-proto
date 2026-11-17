package com.wy.property.common.period;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.YearMonth;
import java.time.format.DateTimeParseException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PeriodRangeTest {

    @Test
    @DisplayName("跨年账期：2025-12 ~ 2026-01 两端都含，相邻月份不能混进来")
    void crossYearBoundary() {
        PeriodRange range = PeriodRange.of("2025-12", "2026-01");

        assertThat(range.contains(YearMonth.of(2025, 12))).isTrue();
        assertThat(range.contains(YearMonth.of(2026, 1))).isTrue();
        assertThat(range.contains(YearMonth.of(2025, 11))).isFalse();
        assertThat(range.contains(YearMonth.of(2026, 2))).isFalse();
        assertThat(range.fromPeriod()).isEqualTo("2025-12");
        assertThat(range.toPeriod()).isEqualTo("2026-01");
    }

    @Test
    @DisplayName("自然年区间")
    void wholeYear() {
        PeriodRange range = PeriodRange.year(2026);

        assertThat(range.fromPeriod()).isEqualTo("2026-01");
        assertThat(range.toPeriod()).isEqualTo("2026-12");
        assertThat(range.contains(YearMonth.of(2026, 12))).isTrue();
        assertThat(range.contains(YearMonth.of(2027, 1))).isFalse();
    }

    @Test
    @DisplayName("起止反了要立刻报错，不能静默返回空集")
    void rejectsInvertedRange() {
        assertThatThrownBy(() -> PeriodRange.of("2026-12", "2026-01"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("晚于");
    }

    @Test
    @DisplayName("非法账期格式直接报错")
    void rejectsMalformedPeriod() {
        assertThatThrownBy(() -> PeriodRange.of("2026-13", "2026-12"))
                .isInstanceOf(DateTimeParseException.class);
        assertThatThrownBy(() -> PeriodRange.of("2026/01", "2026-12"))
                .isInstanceOf(DateTimeParseException.class);
    }
}
