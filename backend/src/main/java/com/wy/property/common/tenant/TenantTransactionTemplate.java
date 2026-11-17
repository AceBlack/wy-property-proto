package com.wy.property.common.tenant;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.function.Supplier;

/**
 * 所有业务查询/写入的唯一入口：开事务 → {@code SET LOCAL app.tenant_id} → 执行。
 *
 * <p>三条硬约束：</p>
 * <ol>
 *   <li><b>必须事务级</b>：用 {@code set_config(..., true)}（等价 SET LOCAL），
 *       连接归还池子后自动失效。会话级 SET 会在池子复用连接时把上一个租户带过来。</li>
 *   <li><b>必须 autoCommit=false</b>：否则 SET LOCAL 立即失效，RLS 拿不到租户而报 42501。</li>
 *   <li><b>参数化</b>：租户 ID 走绑定参数，不拼字符串。</li>
 * </ol>
 */
@Component
public class TenantTransactionTemplate {

    private final TransactionTemplate transactionTemplate;
    private final JdbcTemplate jdbcTemplate;

    public TenantTransactionTemplate(PlatformTransactionManager transactionManager, JdbcTemplate jdbcTemplate) {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.jdbcTemplate = jdbcTemplate;
    }

    public <T> T execute(Supplier<T> work) {
        long tenantId = TenantContext.require();
        return transactionTemplate.execute(status -> {
            setLocalTenant(tenantId);
            return work.get();
        });
    }

    /** 事务内重设租户：同一事务里串租户在 RLS 下不会报错，靠这里主动拦。 */
    private void setLocalTenant(long tenantId) {
        jdbcTemplate.queryForObject(
                "select set_config('app.tenant_id', ?, true)",
                String.class,
                Long.toString(tenantId));
    }
}
