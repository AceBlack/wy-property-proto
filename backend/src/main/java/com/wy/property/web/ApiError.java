package com.wy.property.web;

import java.util.List;

/**
 * 错误响应，与契约 {@code ErrorResponse} 一致。
 *
 * @param code    五位业务码（40001 参数、40101 未登录、40301 越权…）
 * @param traceId 便于对着日志查这一次请求
 */
public record ApiError(int code, String message, List<Detail> details, String traceId) {

    public record Detail(String id, String reason) {
    }

    public static ApiError of(int code, String message, String traceId) {
        return new ApiError(code, message, null, traceId);
    }
}
