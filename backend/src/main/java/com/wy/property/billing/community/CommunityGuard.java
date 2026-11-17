package com.wy.property.billing.community;

import com.wy.property.common.error.ForbiddenException;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 项目（community）归属校验。
 *
 * <p>为什么要单独一步：RLS 能保证"看不到别家的数据"，但看不到 ≠ 越权。
 * 拿 A 租户的 token 传 B 租户的项目 ID，SQL 只会返回空集，
 * 前端会显示"暂无数据"，运维也查不出来——这正是 {@code 01-数据库设计} §2.7 要求 403 的原因。</p>
 */
@Component
public class CommunityGuard {

    private final JdbcTemplate jdbcTemplate;
    private final TenantTransactionTemplate tenantTx;

    public CommunityGuard(JdbcTemplate jdbcTemplate, TenantTransactionTemplate tenantTx) {
        this.jdbcTemplate = jdbcTemplate;
        this.tenantTx = tenantTx;
    }

    /** 未指定项目时不校验（表示"本租户全部项目"）。 */
    public void assertVisible(String communityId) {
        if (communityId == null || communityId.isBlank()) {
            return;
        }
        Boolean exists = tenantTx.execute(() -> jdbcTemplate.queryForObject(
                "select exists (select 1 from community where community_id = ?)",
                Boolean.class,
                communityId));
        if (!Boolean.TRUE.equals(exists)) {
            throw new ForbiddenException("项目 " + communityId + " 不属于当前租户");
        }
    }
}
