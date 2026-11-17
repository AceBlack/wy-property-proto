package com.wy.property.billing.settlement;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;

/**
 * 一天的交班数据。
 *
 * @param byPayPoint 收款点 → 金额（前台 / 南门 / 车辆云平台 …），交班时按点对现金
 * @param difference 差额 = 当日收款总额 − Σ各收款点金额。**必须为 0**，
 *                   不为 0 说明有收款没归到收款点（或归到了不存在的点），交班对不上账
 */
public record DailySettlement(
        LocalDate bizDate,
        long txnCount,
        BigDecimal totalAmount,
        BigDecimal cashAmount,
        Map<String, BigDecimal> byPayPoint,
        BigDecimal payPointTotal,
        BigDecimal difference) {
}
