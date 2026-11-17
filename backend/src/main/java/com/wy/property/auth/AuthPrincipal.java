package com.wy.property.auth;

/**
 * 已认证身份。
 *
 * <p>JWT 只带身份与角色，<b>不带数据范围</b>（契约 securitySchemes 的原话）。
 * 这里的 {@code communityScope} 是"当前会话被限定在某个项目"，
 * 用于 pm / 管家这类角色；集团角色为 null，表示全部项目。</p>
 */
public record AuthPrincipal(long tenantId, String userId, String role, String communityScope) {

    public boolean hasCommunityScope() {
        return communityScope != null && !communityScope.isBlank();
    }
}
