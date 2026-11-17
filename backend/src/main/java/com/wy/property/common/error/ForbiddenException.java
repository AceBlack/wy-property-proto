package com.wy.property.common.error;

/**
 * 越权。契约层映射为 HTTP 403。
 *
 * <p>注意：这里刻意不用"返回空集"来表达越权——空集和"确实没有数据"分不清，
 * 前端会把 403 显示成"暂无数据"，出了问题没人查。</p>
 */
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }
}
