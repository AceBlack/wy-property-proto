package com.wy.property.billing.collection;

import java.math.BigDecimal;

/** 本期现金按归属账期三分。 */
public class ThreeRateCashRow {

    private BigDecimal current;
    private BigDecimal clearing;
    private BigDecimal prepaid;
    private BigDecimal noPeriod;
    private BigDecimal total;

    public BigDecimal getCurrent() {
        return current;
    }

    public void setCurrent(BigDecimal current) {
        this.current = current;
    }

    public BigDecimal getClearing() {
        return clearing;
    }

    public void setClearing(BigDecimal clearing) {
        this.clearing = clearing;
    }

    public BigDecimal getPrepaid() {
        return prepaid;
    }

    public void setPrepaid(BigDecimal prepaid) {
        this.prepaid = prepaid;
    }

    public BigDecimal getNoPeriod() {
        return noPeriod;
    }

    public void setNoPeriod(BigDecimal noPeriod) {
        this.noPeriod = noPeriod;
    }

    public BigDecimal getTotal() {
        return total;
    }

    public void setTotal(BigDecimal total) {
        this.total = total;
    }
}
