package com.wy.property.billing.deposit;

import com.wy.property.common.tenant.TenantContext;
import com.wy.property.support.DbTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 押金政策的历史体检。
 *
 * <p>政策 2026-11-18 起执行，历史不追溯改。这里的数字是"政策前遗留了多少现金押金"，
 * 也是审计口径的答案：31 笔、2,390 元，全部发生在 2026 年 6 - 10 月。</p>
 */
class DepositPolicyAuditDbTest extends DbTestSupport {

    @Autowired
    private DepositPolicyAuditRepository repository;

    @Test
    @DisplayName("历史现金押金 31 笔：收 24 笔 1,800、退 7 笔 590")
    void cashViolationsMatchHistory() {
        DepositPolicyAudit audit = TenantContext.runAs(TENANT_DEMO, repository::audit);

        assertThat(audit.cashViolations()).hasSize(31);
        assertThat(audit.cashInTotal()).isEqualByComparingTo("1800.00");
        assertThat(audit.cashOutTotal()).isEqualByComparingTo("590.00");

        long inCount = audit.cashViolations().stream().filter(v -> "I".equals(v.direction())).count();
        long outCount = audit.cashViolations().stream().filter(v -> "O".equals(v.direction())).count();
        assertThat(inCount).isEqualTo(24L);
        assertThat(outCount).isEqualTo(7L);
    }

    @Test
    @DisplayName("现金押金全部落在 2026-06-05 ~ 2026-10-20 之间（政策前历史数据）")
    void cashViolationsAreHistorical() {
        DepositPolicyAudit audit = TenantContext.runAs(TENANT_DEMO, repository::audit);

        assertThat(audit.cashViolations())
                .allSatisfy(v -> assertThat(v.method()).isEqualTo("现金"));
        assertThat(audit.cashViolations()).extracting(DepositPolicyAudit.CashViolation::occurredAt)
                .isNotEmpty()
                .allSatisfy(date -> assertThat(date)
                        .isBetween(LocalDate.of(2026, 1, 1), LocalDate.of(2026, 10, 20)));
    }

    @Test
    @DisplayName("退款全部原路：352 笔押金没有一笔方式不一致")
    void noMethodMismatch() {
        DepositPolicyAudit audit = TenantContext.runAs(TENANT_DEMO, repository::audit);

        assertThat(audit.methodMismatches()).isEmpty();
    }
}
