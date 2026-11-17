package com.wy.property.common.money;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class MoneyTest {

    @Test
    @DisplayName("double 比较会错：210.64 与 300.92-90.28 按分比较必须相等")
    void compareByCentsAvoidsDoubleTrap() {
        // 这条是迁移时踩过的真实数字：double 下 210.6400000000000005 < 210.640000000000015
        assertThat(210.64 >= 300.92 - 90.28).isFalse();
        assertThat(Money.compare(Money.of("210.64"), Money.of("210.64"))).isZero();
        // 300.92 − 90.28 在 double 下是 210.64000000000001，按分比较必须相等
        assertThat(Money.compare(Money.of("210.64"), Money.of("300.92").subtract(Money.of("90.28")))).isZero();
    }

    @Test
    @DisplayName("舍入统一 HALF_UP 到分")
    void roundingIsHalfUp() {
        assertThat(Money.round(new BigDecimal("1.005"))).isEqualByComparingTo("1.01");
        assertThat(Money.round(new BigDecimal("2.675"))).isEqualByComparingTo("2.68");
        assertThat(Money.round(new BigDecimal("210.644"))).isEqualByComparingTo("210.64");
        assertThat(Money.round(new BigDecimal("210.645"))).isEqualByComparingTo("210.65");
    }

    @Test
    @DisplayName("金额转整数分")
    void toCents() {
        assertThat(Money.toCents(Money.of("210.64"))).isEqualTo(21064L);
        assertThat(Money.toCents(null)).isZero();
        assertThat(Money.toCents(new BigDecimal("0.005"))).isEqualTo(1L);
    }

    @Test
    @DisplayName("比率为百分比保留 2 位；分母为 0 返回 null 而不是 0%")
    void percent() {
        assertThat(Money.percent(Money.of("508857.56"), Money.of("598249.66"))).isEqualByComparingTo("85.06");
        assertThat(Money.percent(Money.of("100"), Money.of("300"))).isEqualByComparingTo("33.33");
        assertThat(Money.percent(Money.of("0"), Money.of("0"))).isNull();
        assertThat(Money.percent(Money.of("0"), Money.of("500"))).isEqualByComparingTo("0.00");
    }
}
