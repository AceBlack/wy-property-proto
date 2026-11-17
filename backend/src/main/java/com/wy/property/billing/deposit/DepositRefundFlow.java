package com.wy.property.billing.deposit;

import com.wy.property.common.money.Money;

import java.math.BigDecimal;

/**
 * 押金退款的状态机（2026-11-18 确认：审批 → 待打款 → 已打款）。
 *
 * <p>只做状态判断与金额校验，不碰数据库：落库需要 DDL（见
 * {@code 08-开发设计/06-押金现金与日结口径建议.md} §七），表结构没解冻前不硬写。</p>
 *
 * <pre>
 * 在押 / 装修中 / 已逾期 / 部分扣除 / 部分退还（余额 &gt; 0）
 *    └─ 申请退款（审批通过）→ 待退款
 *         └─ 打款（写 O 向流水）
 *              ├─ 余额归 0 → 已退还
 *              └─ 余额 &gt; 0 → 部分退还
 * </pre>
 */
public final class DepositRefundFlow {

    private DepositRefundFlow() {
    }

    /** 能不能发起退款：钱必须在账、且有余额。 */
    public static boolean canRequest(DepositStatus status, BigDecimal balance) {
        if (status == null || !status.isOnBook()) {
            return false;
        }
        return Money.compare(balance, BigDecimal.ZERO) > 0;
    }

    public static void assertCanRequest(DepositStatus status, BigDecimal balance) {
        if (status == DepositStatus.PENDING_REFUND) {
            throw new DepositPolicyViolationException("该押金已有退款在途（待退款），不能重复申请");
        }
        if (status == DepositStatus.PENDING_COLLECT) {
            throw new DepositPolicyViolationException("押金尚未收取，不能退款");
        }
        if (status != null && !status.isOnBook()) {
            throw new DepositPolicyViolationException("当前状态不允许退款：" + status.dbValue());
        }
        if (Money.compare(balance, BigDecimal.ZERO) <= 0) {
            throw new DepositPolicyViolationException("押金余额为 0，没有可退金额");
        }
    }

    /** 申请退款金额校验：只能退余额以内。 */
    public static void assertRefundAmount(BigDecimal balance, BigDecimal amount) {
        BigDecimal requested = amount == null ? Money.of(balance) : Money.of(amount);
        if (Money.compare(requested, BigDecimal.ZERO) <= 0) {
            throw new DepositPolicyViolationException("退款金额必须大于 0");
        }
        if (Money.compare(requested, balance) > 0) {
            throw new DepositPolicyViolationException(
                    "退款金额 " + requested + " 超过可退余额 " + Money.of(balance));
        }
    }

    /** 审批通过 → 待打款。 */
    public static DepositStatus afterApproval() {
        return DepositStatus.PENDING_REFUND;
    }

    /**
     * 打款后的状态。
     *
     * @param remaining 打款后余额（= 打款前余额 − 本次退款）
     */
    public static DepositStatus afterPayout(BigDecimal remaining) {
        if (Money.compare(remaining, BigDecimal.ZERO) < 0) {
            throw new DepositPolicyViolationException("打款后余额为负，说明金额算错了");
        }
        return Money.compare(remaining, BigDecimal.ZERO) == 0
                ? DepositStatus.REFUNDED
                : DepositStatus.PARTIAL_REFUND;
    }

    /** 只有"待退款"能打款；直接对在押押金打款等于绕过审批。 */
    public static void assertPayable(DepositStatus status) {
        if (status != DepositStatus.PENDING_REFUND) {
            throw new DepositPolicyViolationException(
                    "只有待退款的押金能打款，当前状态：" + (status == null ? "空" : status.dbValue()));
        }
    }

    /** 提交人不能审批自己提交的退款（契约 §六 第 9 条同一条规矩）。 */
    public static void assertApproverDifferent(String applicant, String approver) {
        if (applicant == null || applicant.isBlank()) {
            throw new DepositPolicyViolationException("退款申请必须有经办人");
        }
        if (approver == null || approver.isBlank()) {
            throw new DepositPolicyViolationException("退款必须指定审批人");
        }
        if (applicant.equals(approver)) {
            throw new DepositPolicyViolationException("提交人不能审批自己提交的退款申请");
        }
    }
}
