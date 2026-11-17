package com.wy.property.billing.collection;

import java.math.BigDecimal;

/** 三率按房屋用途行（住宅 / 商业 / 公寓）。 */
public class ThreeRateUsageRow {

    private String usage;
    private Long houses;
    private BigDecimal receivable;
    private BigDecimal received;
    private BigDecimal waived;

    public String getUsage() {
        return usage;
    }

    public void setUsage(String usage) {
        this.usage = usage;
    }

    public Long getHouses() {
        return houses;
    }

    public void setHouses(Long houses) {
        this.houses = houses;
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
