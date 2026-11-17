package com.wy.property.billing.deposit;

import java.math.BigDecimal;

/** 押金现金流的 SQL 行结果（按营业日 × 收款点 × 是否现金）。 */
public class DepositCashRow {

    private java.time.LocalDate bizDate;
    private String payPoint;
    private Boolean cash;
    private Long txnCount;
    private BigDecimal inAmount;
    private BigDecimal outAmount;

    public java.time.LocalDate getBizDate() {
        return bizDate;
    }

    public void setBizDate(java.time.LocalDate bizDate) {
        this.bizDate = bizDate;
    }

    public String getPayPoint() {
        return payPoint;
    }

    public void setPayPoint(String payPoint) {
        this.payPoint = payPoint;
    }

    public Boolean getCash() {
        return cash;
    }

    public void setCash(Boolean cash) {
        this.cash = cash;
    }

    public Long getTxnCount() {
        return txnCount;
    }

    public void setTxnCount(Long txnCount) {
        this.txnCount = txnCount;
    }

    public BigDecimal getInAmount() {
        return inAmount;
    }

    public void setInAmount(BigDecimal inAmount) {
        this.inAmount = inAmount;
    }

    public BigDecimal getOutAmount() {
        return outAmount;
    }

    public void setOutAmount(BigDecimal outAmount) {
        this.outAmount = outAmount;
    }
}
