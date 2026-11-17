package com.wy.property.common.error;

/** 未登录或令牌无效。契约映射 401 / 40101。 */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }
}
