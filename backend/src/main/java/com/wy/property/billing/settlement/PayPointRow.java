package com.wy.property.billing.settlement;

import java.math.BigDecimal;
import java.time.LocalDate;

/** 日结按收款点拆分行。 */
public class PayPointRow {

    private LocalDate bizDate;
    private String payPoint;
    private Long txnCount;
    private BigDecimal amount;

    public LocalDate getBizDate() {
        return bizDate;
    }

    public void setBizDate(LocalDate bizDate) {
        this.bizDate = bizDate;
    }

    public String getPayPoint() {
        return payPoint;
    }

    public void setPayPoint(String payPoint) {
        this.payPoint = payPoint;
    }

    public Long getTxnCount() {
        return txnCount;
    }

    public void setTxnCount(Long txnCount) {
        this.txnCount = txnCount;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }
}
