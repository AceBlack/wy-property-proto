package com.wy.property.billing.deposit;

import com.wy.property.common.tenant.TenantContext;
import com.wy.property.support.DbTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/** 押金三向流水：balance = ΣI − ΣO − ΣD。 */
class DepositFlowDbTest extends DbTestSupport {

    @Autowired
    private DepositFlowRepository repository;

    @Test
    @DisplayName("全租户押金恒等式：Σbalance = ΣI − ΣO − ΣD = 665,637.00")
    void tenantIdentityHolds() {
        DepositFlowReport report = TenantContext.runAs(TENANT_DEMO, () -> repository.query(null));

        assertThat(report.depositCount()).isEqualTo(352L);
        assertThat(report.inTotal()).isEqualByComparingTo("1619548.00");
        assertThat(report.outTotal()).isEqualByComparingTo("877438.00");
        assertThat(report.deductTotal()).isEqualByComparingTo("76473.00");
        assertThat(report.balanceTotal()).isEqualByComparingTo("665637.00");
        assertThat(report.difference()).isEqualByComparingTo("0.00");

        // 恒等式本身：ΣI − ΣO − ΣD 与 Σbalance 必须一致
        BigDecimal identity = report.inTotal()
                .subtract(report.outTotal())
                .subtract(report.deductTotal());
        assertThat(identity).isEqualByComparingTo(report.balanceTotal());
    }

    @Test
    @DisplayName("逐笔押金都平：balance − (I − O − D) = 0")
    void everyDepositBalances() {
        DepositFlowReport report = TenantContext.runAs(TENANT_DEMO, () -> repository.query(null));

        assertThat(report.flows()).hasSize(352);
        assertThat(report.flows())
                .allSatisfy(flow -> assertThat(flow.difference())
                        .as("押金 %s 的余额与流水", flow.depositNo())
                        .isEqualByComparingTo("0.00"));
    }

    @Test
    @DisplayName("逐笔金额相加等于汇总，没有漏行")
    void flowsSumToTotals() {
        DepositFlowReport report = TenantContext.runAs(TENANT_DEMO, () -> repository.query(null));

        assertThat(report.flows().stream()
                .map(DepositFlowReport.Flow::balance)
                .reduce(BigDecimal.ZERO, BigDecimal::add))
                .isEqualByComparingTo(report.balanceTotal());
        assertThat(report.flows().stream()
                .map(DepositFlowReport.Flow::inAmount)
                .reduce(BigDecimal.ZERO, BigDecimal::add))
                .isEqualByComparingTo(report.inTotal());
    }

    @Test
    @DisplayName("按项目过滤后仍各自平和，且各项目相加等于全租户")
    void filterByCommunity() {
        BigDecimal balanceSum = BigDecimal.ZERO;
        long count = 0L;
        for (String communityId : new String[]{"P01", "P02", "P03"}) {
            DepositFlowReport part = TenantContext.runAs(TENANT_DEMO, () -> repository.query(communityId));
            assertThat(part.difference()).isEqualByComparingTo("0.00");
            assertThat(part.flows()).allSatisfy(flow ->
                    assertThat(flow.difference()).isEqualByComparingTo("0.00"));
            balanceSum = balanceSum.add(part.balanceTotal());
            count += part.depositCount();
        }

        assertThat(balanceSum).isEqualByComparingTo("665637.00");
        assertThat(count).isEqualTo(352L);
    }
}
