package com.wy.property.billing.deposit;

/**
 * 押金收款方式不符合政策（422 语义）。
 *
 * <p>不是"数据缺失"，是"业务不允许"。所以单独一个异常，别混进参数校验。</p>
 */
public class DepositPolicyViolationException extends RuntimeException {

    public DepositPolicyViolationException(String message) {
        super(message);
    }
}
