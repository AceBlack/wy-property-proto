package com.wy.property.billing.daily;

import java.math.BigDecimal;
import java.time.LocalDate;

/** 收款点行（含来源：收款流水 / 押金流水）。 */
public class DailyPayPointRow {

    private LocalDate day;
    private String slot;
    private String source;
    private BigDecimal amount;

    public LocalDate getDay() {
        return day;
    }

    public void setDay(LocalDate day) {
        this.day = day;
    }

    public String getSlot() {
        return slot;
    }

    public void setSlot(String slot) {
        this.slot = slot;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public void setAmount(BigDecimal amount) {
        this.amount = amount;
    }
}
