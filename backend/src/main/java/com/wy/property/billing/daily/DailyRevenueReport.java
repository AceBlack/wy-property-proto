package com.wy.property.billing.daily;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * 经营日报（契约 {@code DailyRevenue}）。
 *
 * <p>三段结构：<b>收入 → 往来款（押金收取）→ 退款（押金退还）</b>，
 * {@code 合计 = 收入 + 往来 − 退款}。押金收进来是钱、不是收入，所以不能并进收入段。</p>
 *
 * <p>差额 = 合计 − Σ各收款点（<b>全部方式</b>，含押金收退）。
 * 2026-11-18 口径确认：对的是"前台经手的账"，不是"抽屉里的现金"；
 * 抽屉现金另看"现金 / 车辆现金"两格。</p>
 *
 * @param badDays 差额不为 0 的日期：交班当天就要查（长短款，或某笔收款漏录收款点）
 */
public record DailyRevenueReport(
        String month,
        List<LocalDate> days,
        List<Group> groups,
        Amounts grand,
        List<PayPoint> payPoints,
        Diff diff,
        Summary summary) {

    /** 三段之一；subtotal 与 days 等长。 */
    public record Group(String key, String name, List<Line> rows,
                        List<BigDecimal> subtotal, BigDecimal total) {
    }

    /** 一行科目，amounts 与 days 等长、下标对齐。 */
    public record Line(String code, String name, String group,
                       List<BigDecimal> amounts, BigDecimal total) {
    }

    public record Amounts(List<BigDecimal> amounts, BigDecimal total) {
    }

    public record PayPoint(String name, List<BigDecimal> amounts, BigDecimal total) {
    }

    public record Diff(List<BigDecimal> amounts, BigDecimal total, boolean ok, List<BadDay> badDays) {
        public record BadDay(LocalDate day, BigDecimal diff) {
        }
    }

    /** @param cash 收款点合计，**不含押金**（契约口径） */
    public record Summary(BigDecimal income, BigDecimal liaison, BigDecimal refund,
                          BigDecimal grand, BigDecimal cash, int days, int activeDays) {
    }
}
