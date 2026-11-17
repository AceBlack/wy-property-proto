package com.wy.property.billing;

import com.wy.property.billing.aging.AgingRepository;
import com.wy.property.billing.collection.CollectionRateRepository;
import com.wy.property.billing.deposit.DepositFlowRepository;
import com.wy.property.billing.settlement.SettlementRepository;
import com.wy.property.common.period.PeriodRange;
import com.wy.property.common.tenant.TenantContext;
import com.wy.property.common.tenant.TenantNotSetException;
import com.wy.property.support.DbTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 租户隔离：RLS 必须真的生效，而且不能靠"应用层记得设租户"这种纪律。
 *
 * <p>这些用例对应 {@code 01-数据库设计} §2.7 的验收要求，也是交接单验收标准第 2 条。</p>
 */
class TenantIsolationDbTest extends DbTestSupport {

    @Autowired
    private CollectionRateRepository collectionRateRepository;
    @Autowired
    private AgingRepository agingRepository;
    @Autowired
    private SettlementRepository settlementRepository;
    @Autowired
    private DepositFlowRepository depositFlowRepository;
    @Autowired
    private JdbcTemplate jdbcTemplate;
    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    @DisplayName("没有租户上下文时四个查询全部拒绝，而不是给默认租户")
    void noTenantContextIsRejected() {
        assertThatThrownBy(() -> collectionRateRepository.query(PeriodRange.year(2026), null))
                .isInstanceOf(TenantNotSetException.class);
        assertThatThrownBy(() -> agingRepository.query(LocalDate.of(2026, 11, 18), null))
                .isInstanceOf(TenantNotSetException.class);
        assertThatThrownBy(() -> settlementRepository.queryDay(LocalDate.of(2026, 8, 6), null))
                .isInstanceOf(TenantNotSetException.class);
        assertThatThrownBy(() -> depositFlowRepository.query(null))
                .isInstanceOf(TenantNotSetException.class);
    }

    @Test
    @DisplayName("别家租户看不到本租户任何数据（空集，不是报错）")
    void foreignTenantSeesNothing() {
        long bills = TenantContext.runAs(TENANT_FOREIGN,
                () -> collectionRateRepository.query(PeriodRange.year(2026), null).total().billCount());
        long unclosed = TenantContext.runAs(TENANT_FOREIGN,
                () -> agingRepository.query(LocalDate.of(2026, 11, 18), null).totalCount());
        long deposits = TenantContext.runAs(TENANT_FOREIGN,
                () -> depositFlowRepository.query(null).depositCount());
        int days = TenantContext.runAs(TENANT_FOREIGN,
                () -> settlementRepository.query(LocalDate.of(2026, 8, 6),
                        LocalDate.of(2026, 11, 15), null).days().size());

        assertThat(bills).isZero();
        assertThat(unclosed).isZero();
        assertThat(deposits).isZero();
        assertThat(days).isZero();
    }

    @Test
    @DisplayName("连接复用时不得串租户（事务级 SET LOCAL，不是会话级 SET）")
    void pooledConnectionDoesNotLeakTenant() {
        long first = TenantContext.runAs(TENANT_DEMO,
                () -> collectionRateRepository.query(PeriodRange.year(2026), null).total().billCount());
        long foreign = TenantContext.runAs(TENANT_FOREIGN,
                () -> collectionRateRepository.query(PeriodRange.year(2026), null).total().billCount());
        long again = TenantContext.runAs(TENANT_DEMO,
                () -> collectionRateRepository.query(PeriodRange.year(2026), null).total().billCount());

        assertThat(first).isEqualTo(4308L);
        assertThat(foreign).isZero();
        assertThat(again).isEqualTo(4308L);
    }

    @Test
    @DisplayName("绕过仓储直接查表也会被数据库拦下（42501），RLS 不靠应用层兜底")
    void databaseRejectsQueryWithoutTenant() {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);

        assertThatThrownBy(() -> tx.execute(status ->
                jdbcTemplate.queryForObject("select count(*) from bill", Long.class)))
                .hasStackTraceContaining("app.tenant_id");
    }

    @Test
    @DisplayName("业务连接不是超级用户（超级用户会静默绕过 RLS）")
    void applicationRoleIsNotSuperuser() {
        Boolean superuser = jdbcTemplate.queryForObject(
                "select rolsuper from pg_roles where rolname = current_user", Boolean.class);

        assertThat(superuser).isFalse();
    }
}
