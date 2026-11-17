package com.wy.property.common.time;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;

/**
 * 业务时区。财务系统只有一个营业日定义，别用机器本地时区——服务器跑在 UTC 时会差一天。
 */
public final class BusinessZone {

    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private BusinessZone() {
    }

    public static LocalDate today() {
        return LocalDate.now(ZONE);
    }

    /**
     * 把数据库返回的时间转成 +08:00 再出 JSON。
     *
     * <p>PG 的 timestamptz 经 JDBC 可能以 UTC（{@code ...Z}）返回。序列化出去后，
     * 前端若不换算就会把 {@code 2026-10-13 00:00 +08} 显示成 {@code 2026-10-12 16:00}——
     * 账期、缴费时间这类字段差一天，对账时非常难解释。</p>
     */
    public static OffsetDateTime toBusinessOffset(OffsetDateTime value) {
        return value == null ? null : value.atZoneSameInstant(ZONE).toOffsetDateTime();
    }
}
