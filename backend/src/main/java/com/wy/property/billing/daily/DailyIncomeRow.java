package com.wy.property.billing.daily;

import java.math.BigDecimal;
import java.time.LocalDate;

/** 收入段行：科目（费用分类）× 日。 */
public class DailyIncomeRow {

    private String category;
    private LocalDate day;
    private BigDecimal amount;

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
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
