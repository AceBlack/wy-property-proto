package com.wy.property.common.money;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 金额口径的唯一实现。所有比较、舍入都从这里走，别在业务代码里各自 {@code doubleValue()}。
 *
 * <p>踩过的坑：{@code 210.64 >= 300.92 - 90.28} 在 double 下是 false。
 * 因此<b>比较一律转整数分</b>，<b>舍入一律 HALF_UP scale=2</b>。</p>
 */
public final class Money {

    public static final int SCALE = 2;
    public static final RoundingMode ROUNDING = RoundingMode.HALF_UP;
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private Money() {
    }

    public static BigDecimal zero() {
        return BigDecimal.ZERO.setScale(SCALE, ROUNDING);
    }

    /** 归一化到分。null 视为 0——报表里"没有发生"就是 0，不是空。 */
    public static BigDecimal of(BigDecimal value) {
        return value == null ? zero() : value.setScale(SCALE, ROUNDING);
    }

    public static BigDecimal of(String value) {
        return of(new BigDecimal(value));
    }

    public static BigDecimal round(BigDecimal value) {
        return of(value);
    }

    public static BigDecimal add(BigDecimal a, BigDecimal b) {
        return of(nullToZero(a).add(nullToZero(b)));
    }

    public static BigDecimal subtract(BigDecimal a, BigDecimal b) {
        return of(nullToZero(a).subtract(nullToZero(b)));
    }

    public static BigDecimal multiply(BigDecimal a, BigDecimal b) {
        return of(nullToZero(a).multiply(nullToZero(b)));
    }

    /** 转整数分：比较大小、判等都用它，不要直接比 BigDecimal/double。 */
    public static long toCents(BigDecimal value) {
        return of(value).movePointRight(SCALE).longValueExact();
    }

    public static int compare(BigDecimal a, BigDecimal b) {
        return Long.compare(toCents(a), toCents(b));
    }

    public static boolean isZero(BigDecimal value) {
        return toCents(value) == 0L;
    }

    /**
     * 比率（例如收缴率），返回百分数，保留 2 位。
     *
     * <p>分母为 0 时返回 {@code null}：零应收不等于"收缴率 0%"，
     * 前者是"无应收"，后者是"一分没收"。两者混在一起，报表会误导人。</p>
     */
    public static BigDecimal percent(BigDecimal numerator, BigDecimal denominator) {
        BigDecimal den = nullToZero(denominator);
        if (isZero(den)) {
            return null;
        }
        return nullToZero(numerator)
                .multiply(HUNDRED)
                .divide(den, 6, ROUNDING)
                .setScale(SCALE, ROUNDING);
    }

    private static BigDecimal nullToZero(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }
}
