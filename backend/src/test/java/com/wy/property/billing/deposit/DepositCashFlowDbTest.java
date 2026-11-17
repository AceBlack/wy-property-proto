package com.wy.property.billing.deposit;

import com.wy.property.common.tenant.TenantContext;
import com.wy.property.support.DbTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 押金现金日结：只算 I/O 两向的现金，D 向（扣除/没收）不进来。
 *
 * <p>这组数字是"如果日结并入押金，抽屉会多出多少钱"的实测答案：
 * 2026 全年押金现金流入仅 1,800 元，退还 590 元，净 1,210 元——金额小，
 * 但规则错一次，收银员每天都要解释短款长款。</p>
 */
class DepositCashFlowDbTest extends DbTestSupport {

    private static final LocalDate YEAR_START = LocalDate.of(2026, 1, 1);
    private static final LocalDate YEAR_END = LocalDate.of(2026, 12, 31);

    @Autowired
    private DepositCashFlowRepository repository;

    @Test
    @DisplayName("2026 全年押金现金：收 1,800 / 退 590 / 净 1,210，非现金 1,003,748")
    void yearCashTotals() {
        DepositCashReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(YEAR_START, YEAR_END, null));

        assertThat(report.cashInTotal()).isEqualByComparingTo("1800.00");
        assertThat(report.cashOutTotal()).isEqualByComparingTo("590.00");
        assertThat(report.cashNetTotal()).isEqualByComparingTo("1210.00");
        assertThat(report.nonCashInTotal()).isEqualByComparingTo("1003748.00");
        assertThat(report.nonCashOutTotal()).isEqualByComparingTo("407248.00");
        assertThat(report.days()).hasSize(149);
    }

    @Test
    @DisplayName("D 向不计入现金流：笔数只算 I/O（246 笔），不是含扣除的 260 笔")
    void deductIsNotCashFlow() {
        DepositCashReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(YEAR_START, YEAR_END, null));

        long txn = report.days().stream().mapToLong(DepositCashReport.Day::txnCount).sum();
        assertThat(txn).isEqualTo(246L);
        // 扣除/没收 14 笔 19,073 元是负债转收入，不能出现在现金收付里
        java.math.BigDecimal cashFlowTotal = report.cashInTotal()
                .add(report.cashOutTotal())
                .add(report.nonCashInTotal())
                .add(report.nonCashOutTotal());
        assertThat(cashFlowTotal).isEqualByComparingTo("1413386.00");
        assertThat(cashFlowTotal).isNotEqualByComparingTo("1432459.00"); // 含 D 向会是这个数
    }

    @Test
    @DisplayName("单日示例：2026-06-05 现金 40、代扣 57,030")
    void singleDayDetail() {
        LocalDate day = LocalDate.of(2026, 6, 5);
        DepositCashReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(day, day, null));

        assertThat(report.days()).hasSize(1);
        DepositCashReport.Day row = report.days().get(0);
        assertThat(row.cashIn()).isEqualByComparingTo("40.00");
        assertThat(row.cashOut()).isEqualByComparingTo("0.00");
        assertThat(row.cashNet()).isEqualByComparingTo("40.00");
        assertThat(row.nonCashIn()).isEqualByComparingTo("57030.00");
        assertThat(row.cashByPayPoint()).containsEntry("前台", new BigDecimal("40.00"));
    }

    @Test
    @DisplayName("逐日净额 = 收 − 退，且各日相加等于区间合计")
    void daysAreConsistent() {
        DepositCashReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(YEAR_START, YEAR_END, null));

        BigDecimal in = BigDecimal.ZERO;
        BigDecimal out = BigDecimal.ZERO;
        for (DepositCashReport.Day day : report.days()) {
            assertThat(day.cashNet()).isEqualByComparingTo(day.cashIn().subtract(day.cashOut()));
            in = in.add(day.cashIn());
            out = out.add(day.cashOut());
        }
        assertThat(in).isEqualByComparingTo(report.cashInTotal());
        assertThat(out).isEqualByComparingTo(report.cashOutTotal());
    }

    @Test
    @DisplayName("按项目过滤：各项目现金相加等于全租户")
    void filterByCommunity() {
        BigDecimal cashNet = BigDecimal.ZERO;
        for (String communityId : new String[]{"P01", "P02", "P03"}) {
            DepositCashReport part = TenantContext.runAs(TENANT_DEMO,
                    () -> repository.query(YEAR_START, YEAR_END, communityId));
            cashNet = cashNet.add(part.cashNetTotal());
        }
        assertThat(cashNet).isEqualByComparingTo("1210.00");
    }
}
