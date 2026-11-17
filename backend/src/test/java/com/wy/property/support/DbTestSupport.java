package com.wy.property.support;

import com.wy.property.common.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * 连真库的比对测试基类。
 *
 * <p>刻意不用 H2 / 内存库：这四条查询的正确性来自 PostgreSQL 的 numeric 行为、
 * RLS 和 FILTER 聚合，换库测等于没测。库不在就红，不能静默跳过。</p>
 *
 * <p>库连接见 {@code application.yml}，可用环境变量 {@code WY_DB_*} 覆盖。</p>
 */
@SpringBootTest
public abstract class DbTestSupport {

    /** 演示租户（库里唯一有数据的租户）。 */
    protected static final long TENANT_DEMO = 1L;

    /** 不存在的租户：用来验证 RLS 不会把别家数据漏出来。 */
    protected static final long TENANT_FOREIGN = 2L;

    @AfterEach
    void clearTenant() {
        TenantContext.clear();
    }
}
