package com.wy.property.billing.deposit;

import java.math.BigDecimal;

/** 押金台账按类型汇总行。 */
public class DepositLedgerTypeRow {

    private String type;
    private Long depositCount;
    private BigDecimal received;
    private BigDecimal refunded;
    private BigDecimal deducted;
    private BigDecimal balance;

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public Long getDepositCount() {
        return depositCount;
    }

    public void setDepositCount(Long depositCount) {
        this.depositCount = depositCount;
    }

    public BigDecimal getReceived() {
        return received;
    }

    public void setReceived(BigDecimal received) {
        this.received = received;
    }

    public BigDecimal getRefunded() {
        return refunded;
    }

    public void setRefunded(BigDecimal refunded) {
        this.refunded = refunded;
    }

    public BigDecimal getDeducted() {
        return deducted;
    }

    public void setDeducted(BigDecimal deducted) {
        this.deducted = deducted;
    }

    public BigDecimal getBalance() {
        return balance;
    }

    public void setBalance(BigDecimal balance) {
        this.balance = balance;
    }
}
