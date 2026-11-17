package com.wy.property.billing.settlement;

import com.wy.property.common.tenant.TenantContext;
import com.wy.property.support.DbTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/** 日结：按 paid_at 分营业日，差额必须为 0。 */
class SettlementDbTest extends DbTestSupport {

    private static final LocalDate FIRST_DAY = LocalDate.of(2026, 8, 6);
    private static final LocalDate LAST_DAY = LocalDate.of(2026, 11, 15);

    @Autowired
    private SettlementRepository repository;

    @Test
    @DisplayName("单日交班：2026-08-06 总额、现金、各收款点与 psql 一致")
    void singleDayMatchesBaseline() {
        DailySettlement day = TenantContext.runAs(TENANT_DEMO,
                () -> repository.queryDay(FIRST_DAY, null));

        assertThat(day.bizDate()).isEqualTo(FIRST_DAY);
        assertThat(day.txnCount()).isEqualTo(35L);
        assertThat(day.totalAmount()).isEqualByComparingTo("12866.46");
        assertThat(day.cashAmount()).isEqualByComparingTo("240.00");
        assertThat(day.byPayPoint()).containsOnlyKeys("前台", "停车场", "线上支付");
        assertThat(day.byPayPoint().get("前台")).isEqualByComparingTo("7422.81");
        assertThat(day.byPayPoint().get("停车场")).isEqualByComparingTo("720.00");
        assertThat(day.byPayPoint().get("线上支付")).isEqualByComparingTo("4723.65");
        assertThat(day.payPointTotal()).isEqualByComparingTo("12866.46");
        assertThat(day.difference()).isEqualByComparingTo("0.00");
    }

    @Test
    @DisplayName("区间合计：4070 笔中正常 3619 笔，差额 0")
    void rangeMatchesBaseline() {
        SettlementReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(FIRST_DAY, LAST_DAY, null));

        assertThat(report.days()).hasSize(79);
        assertThat(report.txnCount()).isEqualTo(3619L);
        assertThat(report.totalAmount()).isEqualByComparingTo("1192152.20");
        assertThat(report.cashAmount()).isEqualByComparingTo("157369.37");
        assertThat(report.difference()).isEqualByComparingTo("0.00");
    }

    @Test
    @DisplayName("每一天的差额都是 0（收款全部归到了收款点）")
    void everyDayBalances() {
        SettlementReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(FIRST_DAY, LAST_DAY, null));

        assertThat(report.days())
                .allSatisfy(day -> assertThat(day.difference())
                        .as("%s 差额", day.bizDate())
                        .isEqualByComparingTo("0.00"));
    }

    @Test
    @DisplayName("逐日金额相加等于区间合计")
    void daysSumToRange() {
        SettlementReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(FIRST_DAY, LAST_DAY, null));

        java.math.BigDecimal sum = report.days().stream()
                .map(DailySettlement::totalAmount)
                .reduce(java.math.BigDecimal.ZERO, java.math.BigDecimal::add);
        long count = report.days().stream().mapToLong(DailySettlement::txnCount).sum();

        assertThat(sum).isEqualByComparingTo(report.totalAmount());
        assertThat(count).isEqualTo(report.txnCount());
    }

    @Test
    @DisplayName("没有收款的日子返回空交班表，不是 null")
    void emptyDay() {
        DailySettlement day = TenantContext.runAs(TENANT_DEMO,
                () -> repository.queryDay(LocalDate.of(2026, 1, 1), null));

        assertThat(day.txnCount()).isZero();
        assertThat(day.totalAmount()).isEqualByComparingTo("0.00");
        assertThat(day.byPayPoint()).isEmpty();
        assertThat(day.difference()).isEqualByComparingTo("0.00");
    }
}
