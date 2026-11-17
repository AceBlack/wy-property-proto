package com.wy.property.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.wy.property.common.error.UnauthorizedException;
import com.wy.property.common.tenant.TenantContext;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;

/**
 * 认证过滤器：解析 Bearer 令牌，把租户与数据范围挂到当前线程。
 *
 * <p>顺序很重要：先设 {@link TenantContext}（RLS 要靠它），再进业务；
 * 请求结束必须 clear，否则线程池复用会把上一个请求的租户带过去——
 * 这正是会话级 {@code SET} 会泄漏的那个坑，ThreadLocal 也一样要清。</p>
 */
@Component
public class AuthFilter extends OncePerRequestFilter {

    private static final String PREFIX = "Bearer ";

    private final JwtService jwtService;
    private final ObjectMapper objectMapper;

    public AuthFilter(JwtService jwtService, ObjectMapper objectMapper) {
        this.jwtService = jwtService;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        try {
            if (header == null || !header.startsWith(PREFIX)) {
                throw new UnauthorizedException("未登录或令牌缺失");
            }
            AuthPrincipal principal = jwtService.parse(header.substring(PREFIX.length()));
            TenantContext.set(principal.tenantId());
            AccessScope.set(principal);
            chain.doFilter(request, response);
        } catch (UnauthorizedException e) {
            writeUnauthorized(response, e.getMessage());
        } finally {
            TenantContext.clear();
            AccessScope.clear();
        }
    }

    private void writeUnauthorized(HttpServletResponse response, String message) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getWriter(), Map.of(
                "code", 40101,
                "message", message == null ? "登录已过期，请重新登录" : message));
    }
}
