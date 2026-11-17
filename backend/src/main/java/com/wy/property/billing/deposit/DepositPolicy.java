package com.wy.property.billing.deposit;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 押金收退政策（2026-11-18 业务确认）。
 *
 * <p>三条规则，全部是"拒绝"而不是"警告"：</p>
 * <ol>
 *   <li><b>禁止收现金押金</b>：押金只走银行代扣/转账/微信/支付宝/POS。现金押金会让收银抽屉
 *       与日结对不上，且退押金时无法原路退回。</li>
 *   <li><b>退款必须原路</b>：退款方式必须与该押金的收款方式一致，不能"收代扣、退现金"。</li>
 *   <li><b>退款必须退给原付款人</b>：见 {@link #assertRefundPayer}。注意当前表结构没有
 *       {@code payer_id} / 退款账户字段，这一条只能靠流程与报表核对，字段补齐前不放手。</li>
 * </ol>
 *
 * <p>只做校验，不碰数据库：写操作（收押金 / 退押金）接入时在事务里调用。</p>
 */
public final class DepositPolicy {

    public static final String CASH = "现金";

    /** 允许的押金收退方式。刻意不含"现金"。 */
    public static final Set<String> ALLOWED_METHODS = Set.of(
            "银行代扣", "银行转账", "微信", "支付宝", "POS");

    private DepositPolicy() {
    }

    /** 收押金时校验方式。 */
    public static void assertCollectMethod(String method) {
        if (method == null || method.isBlank()) {
            throw new DepositPolicyViolationException("收押金必须指定收款方式");
        }
        if (CASH.equals(method)) {
            throw new DepositPolicyViolationException(
                    "禁止收取现金押金（政策 2026-11-18）：现金押金无法原路退回，且会让日结抽屉对不上");
        }
        if (!ALLOWED_METHODS.contains(method)) {
            throw new DepositPolicyViolationException("不支持的押金收款方式：" + method);
        }
    }

    /**
     * 退押金时校验方式是否原路。
     *
     * @param collectMethods 该押金历次收款使用过的方式（当前数据每笔只有一种）
     * @param refundMethod   本次退款方式
     */
    public static void assertRefundMethod(Collection<String> collectMethods, String refundMethod) {
        if (refundMethod == null || refundMethod.isBlank()) {
            throw new DepositPolicyViolationException("退押金必须指定退款方式");
        }
        if (CASH.equals(refundMethod)) {
            throw new DepositPolicyViolationException("禁止现金退押金：必须原路退回");
        }
        Set<String> collected = new LinkedHashSet<>(collectMethods == null ? List.of() : collectMethods);
        collected.remove(null);
        if (collected.isEmpty()) {
            throw new DepositPolicyViolationException("该押金没有收款流水，不能退款");
        }
        if (!collected.contains(refundMethod)) {
            throw new DepositPolicyViolationException(
                    "退款必须原路：收款方式为 " + collected + "，退款方式为 " + refundMethod);
        }
    }

    /**
     * 退押金时校验收款人。
     *
     * @param depositOwnerId 押金登记的业主/付款人
     * @param refundPayerId  本次退款对象
     */
    public static void assertRefundPayer(String depositOwnerId, String refundPayerId) {
        if (refundPayerId == null || refundPayerId.isBlank()) {
            throw new DepositPolicyViolationException("退押金必须指定退款对象");
        }
        if (depositOwnerId == null || !depositOwnerId.equals(refundPayerId)) {
            throw new DepositPolicyViolationException(
                    "退押金只允许退给原付款人：" + depositOwnerId + "，实际 " + refundPayerId);
        }
    }
}
