package com.wy.property.auth;

import com.wy.property.common.error.UnauthorizedException;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

/**
 * JWT 签发与校验（HS256）。
 *
 * <p>本期只做"身份 + 租户"解析，不做 Redis 黑名单、不做刷新令牌——那些等
 * `/auth/login` 一起接（阶段 1 的第二批）。</p>
 *
 * <p><b>密钥必须由环境变量注入</b>，默认值只用于本地开发。</p>
 */
@Service
public class JwtService {

    private final SecretKey key;
    private final String issuer;

    public JwtService(@Value("${wy.auth.secret}") String secret,
                      @Value("${wy.auth.issuer:wy-property}") String issuer) {
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < 32) {
            throw new IllegalStateException("JWT 密钥至少 32 字节（HS256 要求）");
        }
        this.key = Keys.hmacShaKeyFor(bytes);
        this.issuer = issuer;
    }

    public String issue(long tenantId, String userId, String role, String communityScope) {
        return Jwts.builder()
                .issuer(issuer)
                .subject(userId)
                .claim("tid", tenantId)
                .claim("role", role)
                .claim("cid", communityScope)
                .issuedAt(Date.from(Instant.now()))
                .expiration(Date.from(Instant.now().plus(Duration.ofHours(8))))
                .signWith(key)
                .compact();
    }

    public AuthPrincipal parse(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(issuer)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Object tid = claims.get("tid");
            if (tid == null) {
                throw new UnauthorizedException("令牌缺少租户信息");
            }
            return new AuthPrincipal(
                    Long.parseLong(tid.toString()),
                    claims.getSubject(),
                    (String) claims.get("role"),
                    (String) claims.get("cid"));
        } catch (UnauthorizedException e) {
            throw e;
        } catch (JwtException | IllegalArgumentException e) {
            throw new UnauthorizedException("登录已过期，请重新登录");
        }
    }
}
