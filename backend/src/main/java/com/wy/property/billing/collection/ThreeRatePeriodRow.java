package com.wy.property.billing.collection;

import java.math.BigDecimal;

/** 三率按账期行（空月补 0）。 */
public class ThreeRatePeriodRow {

    private String period;
    private BigDecimal receivable;
    private BigDecimal received;
    private BigDecimal waived;

    public String getPeriod() {
        return period;
    }

    public void setPeriod(String period) {
        this.period = period;
    }

    public BigDecimal getReceivable() {
        return receivable;
    }

    public void setReceivable(BigDecimal receivable) {
        this.receivable = receivable;
    }

    public BigDecimal getReceived() {
        return received;
    }

    public void setReceived(BigDecimal received) {
        this.received = received;
    }

    public BigDecimal getWaived() {
        return waived;
    }

    public void setWaived(BigDecimal waived) {
        this.waived = waived;
    }
}
