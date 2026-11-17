package com.wy.property.billing.aging;

import java.math.BigDecimal;

/** 账龄按项目汇总行。 */
public class AgingCommunityRow {

    private String communityId;
    private String communityName;
    private Long houses;
    private BigDecimal owedAmount;

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

    public Long getHouses() {
        return houses;
    }

    public void setHouses(Long houses) {
        this.houses = houses;
    }

    public BigDecimal getOwedAmount() {
        return owedAmount;
    }

    public void setOwedAmount(BigDecimal owedAmount) {
        this.owedAmount = owedAmount;
    }
}
