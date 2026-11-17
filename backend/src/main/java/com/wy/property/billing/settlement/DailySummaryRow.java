package com.wy.property.billing.settlement;

import java.math.BigDecimal;
import java.time.LocalDate;

/** 日结汇总行（一天一行）。 */
public class DailySummaryRow {

    private LocalDate bizDate;
    private Long txnCount;
    private BigDecimal totalAmount;
    private BigDecimal cashAmount;
    private Long noPointCount;
    private BigDecimal noPointAmount;

    public LocalDate getBizDate() {
        return bizDate;
    }

    public void setBizDate(LocalDate bizDate) {
        this.bizDate = bizDate;
    }

    public Long getTxnCount() {
        return txnCount;
    }

    public void setTxnCount(Long txnCount) {
        this.txnCount = txnCount;
    }

    public BigDecimal getTotalAmount() {
        return totalAmount;
    }

    public void setTotalAmount(BigDecimal totalAmount) {
        this.totalAmount = totalAmount;
    }

    public BigDecimal getCashAmount() {
        return cashAmount;
    }

    public void setCashAmount(BigDecimal cashAmount) {
        this.cashAmount = cashAmount;
    }

    public Long getNoPointCount() {
        return noPointCount;
    }

    public void setNoPointCount(Long noPointCount) {
        this.noPointCount = noPointCount;
    }

    public BigDecimal getNoPointAmount() {
        return noPointAmount;
    }

    public void setNoPointAmount(BigDecimal noPointAmount) {
        this.noPointAmount = noPointAmount;
    }
}
