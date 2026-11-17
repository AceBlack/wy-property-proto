package com.wy.property.billing.collection;

import java.math.BigDecimal;

/** 三率查询的 SQL 行结果（一个项目一行）。 */
public class CollectionRateRow {

    private String communityId;
    private String communityName;
    private BigDecimal payable;
    private BigDecimal waiveAmount;
    private BigDecimal paidAmount;
    private Long billCount;

    public String getCommunityId() {
        return communityId;
    }

    public void setCommunityId(String communityId) {
        this.communityId = communityId;
    }

    public String getCommunityName() {
        return communityName;
    }

    public void setCommunityName(String communityName) {
        this.communityName = communityName;
    }

    public BigDecimal getPayable() {
        return payable;
    }

    public void setPayable(BigDecimal payable) {
        this.payable = payable;
    }

    public BigDecimal getWaiveAmount() {
        return waiveAmount;
    }

    public void setWaiveAmount(BigDecimal waiveAmount) {
        this.waiveAmount = waiveAmount;
    }

    public BigDecimal getPaidAmount() {
        return paidAmount;
    }

    public void setPaidAmount(BigDecimal paidAmount) {
        this.paidAmount = paidAmount;
    }

    public Long getBillCount() {
        return billCount;
    }

    public void setBillCount(Long billCount) {
        this.billCount = billCount;
    }
}
