package com.wy.property.web;

/**
 * 统一响应封套，与契约 {@code Envelope} 一致：{@code code=0} 表示成功。
 *
 * @param data 成功时为业务数据；失败时为 {@code null}（错误走 {@link ApiError}）
 */
public record ApiResponse<T>(int code, String message, T data) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(0, "ok", data);
    }
}
