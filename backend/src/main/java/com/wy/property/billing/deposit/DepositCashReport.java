package com.wy.property.billing.deposit;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * 押金现金日结（交班用读模型）。
 *
 * <p>押金是负债，不是收入，所以这里<b>只算现金收付</b>，不进营业收入。
 * D 向（扣除/没收）不产生现金流，不在此表；它属于"押金转收入"，见
 * {@code 08-开发设计/06-押金现金与日结口径建议.md}。</p>
 *
 * @param cashInTotal    押金收取的现金合计（收银抽屉进项）
 * @param cashOutTotal   退还押金的现金合计（收银抽屉出项）
 * @param cashNetTotal   = cashIn − cashOut，交班时抽屉应有的净增
 * @param nonCashInTotal 非现金收取（银行代扣/微信…），只备查，不进抽屉
 */
public record DepositCashReport(
        LocalDate from,
        LocalDate to,
        List<Day> days,
        BigDecimal cashInTotal,
        BigDecimal cashOutTotal,
        BigDecimal cashNetTotal,
        BigDecimal nonCashInTotal,
        BigDecimal nonCashOutTotal) {

    /**
     * @param cashByPayPoint 各收款点的现金净额（收 − 退），交班按点核对
     */
    public record Day(LocalDate bizDate,
                      long txnCount,
                      BigDecimal cashIn,
                      BigDecimal cashOut,
                      BigDecimal cashNet,
                      BigDecimal nonCashIn,
                      BigDecimal nonCashOut,
                      Map<String, BigDecimal> cashByPayPoint) {
    }
}
