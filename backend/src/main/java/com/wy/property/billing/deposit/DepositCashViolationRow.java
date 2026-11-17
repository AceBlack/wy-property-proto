package com.wy.property.billing.deposit;

import java.math.BigDecimal;
import java.time.LocalDate;

/** 现金押金流水行（政策禁止，仅历史数据会命中）。 */
public class DepositCashViolationRow {

    private Long depositId;
    private String depositNo;
    private String direction;
    private BigDecimal amount;
    private String method;
    private LocalDate occurredAt;

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

    public String getDirection() {
        return direction;
    }

    public void setDirection(String direction) {
        this.direction = direction;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }

    public String getMethod() {
        return method;
    }

    public void setMethod(String method) {
        this.method = method;
    }

    public LocalDate getOccurredAt() {
        return occurredAt;
    }

    public void setOccurredAt(LocalDate occurredAt) {
        this.occurredAt = occurredAt;
    }
}
