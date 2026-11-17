package com.wy.property.common.tenant;

/** 未设置租户就访问数据：宁可报错，也不能拿默认租户凑合。 */
public class TenantNotSetException extends RuntimeException {

    public TenantNotSetException(String message) {
        super(message);
    }
}
