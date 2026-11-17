package com.wy.property.billing.aging;

import java.math.BigDecimal;

/** 账龄查询的 SQL 行结果。 */
public class AgingBucketRow {

    private String bucket;
    private Long billCount;
    private Long houses;
    private BigDecimal owedAmount;

    public String getBucket() {
        return bucket;
    }

    public void setBucket(String bucket) {
        this.bucket = bucket;
    }

    public Long getBillCount() {
        return billCount;
    }

    public void setBillCount(Long billCount) {
        this.billCount = billCount;
    }

    public BigDecimal getOwedAmount() {
        return owedAmount;
    }

    public Long getHouses() {
        return houses;
    }

    public void setHouses(Long houses) {
        this.houses = houses;
    }

    public void setOwedAmount(BigDecimal owedAmount) {
        this.owedAmount = owedAmount;
    }
}
