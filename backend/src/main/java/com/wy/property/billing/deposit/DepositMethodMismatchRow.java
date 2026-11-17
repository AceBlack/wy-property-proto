package com.wy.property.billing.deposit;

/** 退款方式与收款方式不一致的押金（用逗号拼接，避免依赖 PG 数组映射）。 */
public class DepositMethodMismatchRow {

    private Long depositId;
    private String depositNo;
    private String collectMethods;
    private String refundMethods;

    public Long getDepositId() {
        return depositId;
    }

    public void setDepositId(Long depositId) {
        this.depositId = depositId;
    }

    public String getDepositNo() {
        return depositNo;
    }

    public void setDepositNo(String depositNo) {
        this.depositNo = depositNo;
    }

    public String getCollectMethods() {
        return collectMethods;
    }

    public void setCollectMethods(String collectMethods) {
        this.collectMethods = collectMethods;
    }

    public String getRefundMethods() {
        return refundMethods;
    }

    public void setRefundMethods(String refundMethods) {
        this.refundMethods = refundMethods;
    }
}
