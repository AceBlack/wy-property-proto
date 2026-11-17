package com.wy.property.common.tenant;

/**
 * 当前请求/线程的租户上下文。
 *
 * <p>只负责"传值"，不负责设到数据库上——设值必须发生在事务里（{@code SET LOCAL}），
 * 见 {@link TenantTransactionTemplate}。会话级 {@code SET} 会让连接池复用连接时串租户。</p>
 */
public final class TenantContext {

    private static final ThreadLocal<Long> CURRENT = new ThreadLocal<>();

    private TenantContext() {
    }

    public static void set(long tenantId) {
        if (tenantId <= 0) {
            throw new IllegalArgumentException("tenantId 必须为正数：" + tenantId);
        }
        CURRENT.set(tenantId);
    }

    public static void clear() {
        CURRENT.remove();
    }

    public static Long peek() {
        return CURRENT.get();
    }

    /** 取当前租户；没有就抛错，绝不用默认值兜底（默认值 = 串租户）。 */
    public static long require() {
        Long v = CURRENT.get();
        if (v == null) {
            throw new TenantNotSetException("当前线程未设置租户上下文，拒绝访问数据");
        }
        return v;
    }

    /** 在指定租户下执行，结束后恢复原值（供测试与定时任务用）。 */
    public static <T> T runAs(long tenantId, java.util.function.Supplier<T> work) {
        Long previous = CURRENT.get();
        set(tenantId);
        try {
            return work.get();
        } finally {
            if (previous == null) {
                CURRENT.remove();
            } else {
                CURRENT.set(previous);
            }
        }
    }
}
