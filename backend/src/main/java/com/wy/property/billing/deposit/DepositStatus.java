package com.wy.property.billing.deposit;

import java.util.Map;

/**
 * 押金状态。
 *
 * <p>库里 9 态、契约 7 态，差 3 个。这里把两边都收进来，映射集中在 {@link #contractLabel()}，
 * 免得前端、报表、接口各写一份判断。</p>
 *
 * <p><b>状态只表达"钱在哪"，不表达"扣了多少"</b>：扣款事实在 {@code deposit_txn.direction='D'}，
 * 不要靠状态反推金额。</p>
 */
public enum DepositStatus {

    /** 应收未收：属于收费流程，不属于押金台账。契约没有这一态。 */
    PENDING_COLLECT("待收", "待收"),
    IN_CUSTODY("在押", "在押"),
    DECORATING("装修中", "装修中"),
    OVERDUE("已逾期", "已逾期"),
    /** 已审批、等打款。契约有，CCK 约束里没有——落库前必须改约束。 */
    PENDING_REFUND("待退款", "待退款"),
    /** 扣了一部分、**还能再退**（2026-11-18 确认）：余额必须 > 0。 */
    PARTIAL_DEDUCT("部分扣除", "部分扣除"),
    /** 退了一部分、余额仍 > 0。契约没有这一态。 */
    PARTIAL_REFUND("部分退还", "部分退还"),
    REFUNDED("已退还", "已退还"),
    FORFEITED("已没收", "已没收"),
    /** 了结态：扣完 + 退完，余额 0。契约没有，按有无退款派生成已退还/已没收。 */
    CLOSED("已结清", "已退还");

    private static final Map<String, DepositStatus> BY_DB = Map.of(
            "待收", PENDING_COLLECT,
            "在押", IN_CUSTODY,
            "装修中", DECORATING,
            "已逾期", OVERDUE,
            "待退款", PENDING_REFUND,
            "部分扣除", PARTIAL_DEDUCT,
            "部分退还", PARTIAL_REFUND,
            "已退还", REFUNDED,
            "已没收", FORFEITED,
            "已结清", CLOSED);

    private final String dbValue;
    private final String contractLabel;

    DepositStatus(String dbValue, String contractLabel) {
        this.dbValue = dbValue;
        this.contractLabel = contractLabel;
    }

    public String dbValue() {
        return dbValue;
    }

    public String contractLabel() {
        return contractLabel;
    }

    /** 是不是"钱还在公司账上"（计入在账余额）。 */
    public boolean isOnBook() {
        return this == IN_CUSTODY || this == DECORATING || this == OVERDUE
                || this == PENDING_REFUND || this == PARTIAL_DEDUCT || this == PARTIAL_REFUND;
    }

    public static DepositStatus fromDb(String value) {
        DepositStatus status = BY_DB.get(value);
        if (status == null) {
            throw new IllegalArgumentException("未知押金状态：" + value);
        }
        return status;
    }
}
