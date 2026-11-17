package com.wy.property.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 启动自检：把"超级用户绕过 RLS"这个坑钉死在启动阶段。
 *
 * <p>Docker 官方镜像用 {@code POSTGRES_USER} 建的账号是超级用户，{@code FORCE ROW LEVEL SECURITY}
 * 也拦不住。这种失效是<b>静默</b>的：策略在、FORCE 在、查询不报错，跨租户照样读全表。
 * 与其等上线后查事故，不如连上来就先看 {@code rolsuper}。</p>
 */
@Component
public class RlsStartupGuard implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RlsStartupGuard.class);

    private final JdbcTemplate jdbcTemplate;
    private final boolean requireNonSuperuser;
    private final String requiredSchema;
    private final String businessTimezone;

    public RlsStartupGuard(JdbcTemplate jdbcTemplate,
                           @Value("${wy.db.require-non-superuser:true}") boolean requireNonSuperuser,
                           @Value("${wy.db.required-schema:wy}") String requiredSchema,
                           @Value("${wy.db.business-timezone:Asia/Shanghai}") String businessTimezone) {
        this.jdbcTemplate = jdbcTemplate;
        this.requireNonSuperuser = requireNonSuperuser;
        this.requiredSchema = requiredSchema;
        this.businessTimezone = businessTimezone;
    }

    @Override
    public void run(ApplicationArguments args) {
        Map<String, Object> row = jdbcTemplate.queryForMap(
                "select current_user as db_user, "
                        + "  (select rolsuper from pg_roles where rolname = current_user) as is_superuser, "
                        + "  current_setting('search_path') as search_path, "
                        + "  current_setting('TimeZone') as time_zone");
        String dbUser = String.valueOf(row.get("db_user"));
        boolean superuser = Boolean.TRUE.equals(row.get("is_superuser"));
        String searchPath = String.valueOf(row.get("search_path"));
        String timezone = String.valueOf(row.get("time_zone"));

        if (superuser && requireNonSuperuser) {
            throw new IllegalStateException(
                    "数据库账号 " + dbUser + " 是超级用户，RLS 会被静默绕过。"
                            + "业务连接必须用 wy_app（NOSUPERUSER NOBYPASSRLS）。");
        }
        if (!searchPath.contains(requiredSchema)) {
            throw new IllegalStateException(
                    "search_path 里没有 schema " + requiredSchema + "（当前：" + searchPath + "），"
                            + "检查连接串的 options=-c search_path=...");
        }
        if (!businessTimezone.equals(timezone)) {
            log.warn("会话时区是 {}，与业务时区 {} 不一致；日结按天分档会错位", timezone, businessTimezone);
        }
        log.info("数据库自检通过：user={}, superuser={}, search_path={}, timezone={}",
                dbUser, superuser, searchPath, timezone);
    }
}
