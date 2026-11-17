package com.wy.property.billing.deposit;

import java.math.BigDecimal;

/** 押金三向流水行（一笔押金一行）。 */
public class DepositFlowRow {

    private Long depositId;
    private String depositNo;
    private String communityId;
    private String status;
    private BigDecimal balance;
    private BigDecimal inAmount;
    private BigDecimal outAmount;
    private BigDecimal deductAmount;
    private BigDecimal calculated;

    public Long getDepositId() {
        return depositId;
    }

    public void setDepositId(Long depositId) {
        this.depositId = depositId;
    }

    public String getDepositNo() {
        return depositNo;
    }

    public void setDepositNo(String depositNo) {
        this.depositNo = depositNo;
    }

    public String getCommunityId() {
        return communityId;
    }

    public void setCommunityId(String communityId) {
        this.communityId = communityId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public BigDecimal getBalance() {
        return balance;
    }

    public void setBalance(BigDecimal balance) {
        this.balance = balance;
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

    public BigDecimal getDeductAmount() {
        return deductAmount;
    }

    public void setDeductAmount(BigDecimal deductAmount) {
        this.deductAmount = deductAmount;
    }

    public BigDecimal getCalculated() {
        return calculated;
    }

    public void setCalculated(BigDecimal calculated) {
        this.calculated = calculated;
    }
}
