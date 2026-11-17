package com.wy.property.auth;

import com.wy.property.common.error.ForbiddenException;

/**
 * 当前请求的数据范围。
 *
 * <p>为什么单独一层：契约要求"无权限 / 超出数据范围 → 403，<b>不是空列表</b>"。
 * 空列表会让前端显示"暂无数据"，运维也查不出是越权。</p>
 */
public final class AccessScope {

    private static final ThreadLocal<AuthPrincipal> CURRENT = new ThreadLocal<>();

    private AccessScope() {
    }

    static void set(AuthPrincipal principal) {
        CURRENT.set(principal);
    }

    static void clear() {
        CURRENT.remove();
    }

    public static AuthPrincipal principal() {
        AuthPrincipal p = CURRENT.get();
        if (p == null) {
            throw new IllegalStateException("AccessScope 未初始化：请求未经过认证过滤器");
        }
        return p;
    }

    /**
     * 校验请求的项目是否在当前范围内。
     *
     * @param communityId 请求指定的项目；null 表示"本租户全部"
     */
    public static void assertCommunity(String communityId) {
        AuthPrincipal p = principal();
        if (!p.hasCommunityScope() || communityId == null || communityId.isBlank()) {
            return;
        }
        if (!p.communityScope().equals(communityId)) {
            throw new ForbiddenException("无权查看「" + communityId + "」的数据：超出当前数据范围");
        }
    }

    /**
     * 解析本次查询真正生效的项目。
     *
     * <p>有范围限定的角色（pm / 管家）不传 communityId 时，<b>必须收敛到自己的项目</b>，
     * 不能放任它查全租户——这是最容易漏的越权口子：默认值等于全部数据。</p>
     *
     * @return 生效的 communityId；null 表示确有必要查全租户（仅集团角色）
     */
    public static String resolveCommunity(String requested) {
        AuthPrincipal p = principal();
        assertCommunity(requested);
        if (p.hasCommunityScope()) {
            return p.communityScope();
        }
        return requested == null || requested.isBlank() ? null : requested;
    }
}
