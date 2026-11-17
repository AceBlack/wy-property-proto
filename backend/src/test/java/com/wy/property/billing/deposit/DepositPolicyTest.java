package com.wy.property.billing.deposit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 押金政策三条规则的边界。 */
class DepositPolicyTest {

    @Test
    @DisplayName("禁止收现金押金")
    void cashCollectionIsRejected() {
        assertThatThrownBy(() -> DepositPolicy.assertCollectMethod("现金"))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("禁止收取现金押金");
    }

    @Test
    @DisplayName("银行代扣、转账等非现金方式放行")
    void nonCashCollectionIsAllowed() {
        assertThatCode(() -> DepositPolicy.assertCollectMethod("银行代扣")).doesNotThrowAnyException();
        assertThatCode(() -> DepositPolicy.assertCollectMethod("银行转账")).doesNotThrowAnyException();
        assertThatCode(() -> DepositPolicy.assertCollectMethod("微信")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("方式为空或未知一律拒绝，不默认成某个方式")
    void unknownMethodIsRejected() {
        assertThatThrownBy(() -> DepositPolicy.assertCollectMethod(null))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("必须指定收款方式");
        assertThatThrownBy(() -> DepositPolicy.assertCollectMethod(" "))
                .isInstanceOf(DepositPolicyViolationException.class);
        assertThatThrownBy(() -> DepositPolicy.assertCollectMethod("支票"))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("不支持");
    }

    @Test
    @DisplayName("退款必须原路：方式相同放行，不同拒绝")
    void refundMustFollowOriginalChannel() {
        List<String> collected = List.of("银行代扣");

        assertThatCode(() -> DepositPolicy.assertRefundMethod(collected, "银行代扣"))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> DepositPolicy.assertRefundMethod(collected, "微信"))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("必须原路");
    }

    @Test
    @DisplayName("禁止现金退押金（即使原来是现金收的）")
    void cashRefundIsRejected() {
        assertThatThrownBy(() -> DepositPolicy.assertRefundMethod(List.of("银行代扣"), "现金"))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("禁止现金退押金");
        assertThatThrownBy(() -> DepositPolicy.assertRefundMethod(List.of("现金"), "现金"))
                .isInstanceOf(DepositPolicyViolationException.class);
    }

    @Test
    @DisplayName("没有收款流水不能退款")
    void refundWithoutCollectionIsRejected() {
        assertThatThrownBy(() -> DepositPolicy.assertRefundMethod(List.of(), "银行代扣"))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("没有收款流水");
    }

    @Test
    @DisplayName("只能退给原付款人")
    void refundOnlyToOriginalPayer() {
        assertThatCode(() -> DepositPolicy.assertRefundPayer("OW0001", "OW0001"))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> DepositPolicy.assertRefundPayer("OW0001", "OW0002"))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("原付款人");
        assertThatThrownBy(() -> DepositPolicy.assertRefundPayer("OW0001", null))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("必须指定退款对象");
    }
}
