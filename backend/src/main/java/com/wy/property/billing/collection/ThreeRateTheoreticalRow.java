package com.wy.property.billing.collection;

import java.math.BigDecimal;

/**
 * 理论应收行（账期 × 用途）。
 *
 * @param gaps 没有价目的"对象 × 月"数：这部分算不出应收，必须单独暴露，
 *             否则会被当成"应收 0"，把收缴率算成天文数字
 */
public class ThreeRateTheoreticalRow {

    private String period;
    private String usage;
    private Long houses;
    private BigDecimal receivable;
    private Long gaps;

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

    public Long getGaps() {
        return gaps;
    }

    public void setGaps(Long gaps) {
        this.gaps = gaps;
    }
}
