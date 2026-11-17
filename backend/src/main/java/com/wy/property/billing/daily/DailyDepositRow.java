package com.wy.property.billing.daily;

import java.math.BigDecimal;
import java.time.LocalDate;

/** 押金段行：押金类型 × 日 × 方向（I 收取 / O 退还）。 */
public class DailyDepositRow {

    private String type;
    private String direction;
    private LocalDate day;
    private BigDecimal amount;

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getDirection() {
        return direction;
    }

    public void setDirection(String direction) {
        this.direction = direction;
    }

    public LocalDate getDay() {
        return day;
    }

    public void setDay(LocalDate day) {
        this.day = day;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }
}
