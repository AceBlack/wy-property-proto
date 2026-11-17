package com.wy.property.billing.deposit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 押金退款状态机（审批 → 待打款 → 已打款）。 */
class DepositRefundFlowTest {

    private static final BigDecimal BALANCE = new BigDecimal("3000.00");

    @Test
    @DisplayName("在押、装修中、已逾期、部分扣除都能发起退款")
    void canRequestFromOnBookStatuses() {
        for (DepositStatus status : new DepositStatus[]{
                DepositStatus.IN_CUSTODY, DepositStatus.DECORATING, DepositStatus.OVERDUE,
                DepositStatus.PARTIAL_DEDUCT, DepositStatus.PARTIAL_REFUND}) {
            assertThat(DepositRefundFlow.canRequest(status, BALANCE)).as(status.dbValue()).isTrue();
        }
    }

    @Test
    @DisplayName("余额为 0 或已了结的押金不能发起退款")
    void cannotRequestWhenNothingToRefund() {
        assertThat(DepositRefundFlow.canRequest(DepositStatus.IN_CUSTODY, BigDecimal.ZERO)).isFalse();
        assertThat(DepositRefundFlow.canRequest(DepositStatus.REFUNDED, BALANCE)).isFalse();
        assertThat(DepositRefundFlow.canRequest(DepositStatus.PENDING_COLLECT, BALANCE)).isFalse();
        assertThat(DepositRefundFlow.canRequest(DepositStatus.FORFEITED, BALANCE)).isFalse();
    }

    @Test
    @DisplayName("待退款不能重复申请（防止一笔押金退两次）")
    void cannotRequestTwice() {
        assertThatThrownBy(() -> DepositRefundFlow.assertCanRequest(DepositStatus.PENDING_REFUND, BALANCE))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("重复申请");
    }

    @Test
    @DisplayName("退款金额可以留空（全退），但不能超余额")
    void refundAmountValidation() {
        assertThatCode(() -> DepositRefundFlow.assertRefundAmount(BALANCE, null)).doesNotThrowAnyException();
        assertThatCode(() -> DepositRefundFlow.assertRefundAmount(BALANCE, BALANCE)).doesNotThrowAnyException();
        assertThatThrownBy(() -> DepositRefundFlow.assertRefundAmount(BALANCE, new BigDecimal("3000.01")))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("超过可退余额");
        assertThatThrownBy(() -> DepositRefundFlow.assertRefundAmount(BALANCE, BigDecimal.ZERO))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("必须大于 0");
    }

    @Test
    @DisplayName("打款后按余额判终态：退完→已退还，还有余→部分退还")
    void payoutStatus() {
        assertThat(DepositRefundFlow.afterApproval()).isEqualTo(DepositStatus.PENDING_REFUND);
        assertThat(DepositRefundFlow.afterPayout(new BigDecimal("0.00"))).isEqualTo(DepositStatus.REFUNDED);
        assertThat(DepositRefundFlow.afterPayout(new BigDecimal("500.00"))).isEqualTo(DepositStatus.PARTIAL_REFUND);
        assertThatThrownBy(() -> DepositRefundFlow.afterPayout(new BigDecimal("-0.01")))
                .isInstanceOf(DepositPolicyViolationException.class);
    }

    @Test
    @DisplayName("没审批不能直接打款")
    void payoutRequiresApproval() {
        assertThatCode(() -> DepositRefundFlow.assertPayable(DepositStatus.PENDING_REFUND))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> DepositRefundFlow.assertPayable(DepositStatus.IN_CUSTODY))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("只有待退款");
    }

    @Test
    @DisplayName("提交人不能审批自己提交的退款")
    void applicantCannotApproveOwnRequest() {
        assertThatCode(() -> DepositRefundFlow.assertApproverDifferent("E001", "E002"))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> DepositRefundFlow.assertApproverDifferent("E001", "E001"))
                .isInstanceOf(DepositPolicyViolationException.class)
                .hasMessageContaining("不能审批自己");
        assertThatThrownBy(() -> DepositRefundFlow.assertApproverDifferent(null, "E002"))
                .isInstanceOf(DepositPolicyViolationException.class);
    }

    @Test
    @DisplayName("库里的 9 态映射到契约 7 态，映射写在一处")
    void statusMapping() {
        assertThat(DepositStatus.fromDb("部分扣除").contractLabel()).isEqualTo("部分扣除");
        assertThat(DepositStatus.fromDb("已结清").contractLabel()).isEqualTo("已退还");
        assertThat(DepositStatus.fromDb("待退款").contractLabel()).isEqualTo("待退款");
        assertThat(DepositStatus.fromDb("在押").isOnBook()).isTrue();
        assertThat(DepositStatus.fromDb("已没收").isOnBook()).isFalse();
        assertThatThrownBy(() -> DepositStatus.fromDb("已退"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
