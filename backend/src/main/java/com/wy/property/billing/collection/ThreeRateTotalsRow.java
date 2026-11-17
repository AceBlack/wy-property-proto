package com.wy.property.billing.collection;

import java.math.BigDecimal;

/** 三率总额行。 */
public class ThreeRateTotalsRow {

    private BigDecimal receivable;
    private BigDecimal received;
    private BigDecimal waived;
    private Long houses;
    private Long overpaid;

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

    public Long getHouses() {
        return houses;
    }

    public void setHouses(Long houses) {
        this.houses = houses;
    }

    public Long getOverpaid() {
        return overpaid;
    }

    public void setOverpaid(Long overpaid) {
        this.overpaid = overpaid;
    }
}
