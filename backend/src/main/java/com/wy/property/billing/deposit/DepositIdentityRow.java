package com.wy.property.billing.deposit;

import java.math.BigDecimal;

/** 全量恒等式（不受查询区间限制）：收 = 退 + 扣 + 在账。 */
public class DepositIdentityRow {

    private BigDecimal received;
    private BigDecimal refunded;
    private BigDecimal deducted;
    private BigDecimal balance;

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
