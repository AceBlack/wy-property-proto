package com.wy.property.billing.collection;

import java.math.BigDecimal;

/** 实际发生数（账期 × 用途）：已开单应收、已收、减免。 */
public class ThreeRateActualRow {

    private String period;
    private String usage;
    private BigDecimal billed;
    private BigDecimal received;
    private BigDecimal waived;

    public String getPeriod() {
        return period;
    }

    public void setPeriod(String period) {
        this.period = period;
    }

    public String getUsage() {
        return usage;
    }

    public void setUsage(String usage) {
        this.usage = usage;
    }

    public BigDecimal getBilled() {
        return billed;
    }

    public void setBilled(BigDecimal billed) {
        this.billed = billed;
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
