package com.wy.property.billing.collection;

import com.wy.property.common.error.ForbiddenException;
import com.wy.property.common.period.PeriodRange;
import com.wy.property.common.tenant.TenantContext;
import com.wy.property.support.DbTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 三率：与 psql 手工查询逐分比对。
 *
 * <p>基线来自 {@code 08-开发设计/sql/migrate/README.md} 与 2026-11-18 的手工查询。</p>
 */
class CollectionRateDbTest extends DbTestSupport {

    @Autowired
    private CollectionRateRepository repository;

    @Test
    @DisplayName("2026 全年三率与 psql 基线完全一致（差一分都不行）")
    void fullYearMatchesBaseline() {
        CollectionRateReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(PeriodRange.year(2026), null));

        assertThat(report.byCommunity()).hasSize(3);

        CollectionRateResult p03 = find(report.byCommunity(), "P03");
        assertThat(p03.communityName()).isEqualTo("星光天地");
        assertThat(p03.payable()).isEqualByComparingTo("603213.54");
        assertThat(p03.waiveAmount()).isEqualByComparingTo("4963.88");
        assertThat(p03.netPayable()).isEqualByComparingTo("598249.66");
        assertThat(p03.paidAmount()).isEqualByComparingTo("508857.56");
        assertThat(p03.collectionRate()).isEqualByComparingTo("85.06");

        CollectionRateResult p01 = find(report.byCommunity(), "P01");
        assertThat(p01.communityName()).isEqualTo("翡翠城");
        assertThat(p01.netPayable()).isEqualByComparingTo("498853.24");
        assertThat(p01.paidAmount()).isEqualByComparingTo("407437.03");
        assertThat(p01.collectionRate()).isEqualByComparingTo("81.67");

        CollectionRateResult p02 = find(report.byCommunity(), "P02");
        assertThat(p02.communityName()).isEqualTo("锦绣家园");
        assertThat(p02.netPayable()).isEqualByComparingTo("326749.70");
        assertThat(p02.paidAmount()).isEqualByComparingTo("275857.61");
        assertThat(p02.collectionRate()).isEqualByComparingTo("84.42");
    }

    @Test
    @DisplayName("合计行：金额相加、收缴率按总额重算（83.73%），作废单不计入")
    void totalMatchesBaseline() {
        CollectionRateReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(PeriodRange.year(2026), null));

        CollectionRateResult total = report.total();
        assertThat(total.payable()).isEqualByComparingTo("1432708.33");
        assertThat(total.waiveAmount()).isEqualByComparingTo("8855.73");
        assertThat(total.netPayable()).isEqualByComparingTo("1423852.60");
        assertThat(total.paidAmount()).isEqualByComparingTo("1192152.20");
        assertThat(total.collectionRate()).isEqualByComparingTo("83.73");
        assertThat(total.billCount()).isEqualTo(4308L);
    }

    @Test
    @DisplayName("按项目过滤只返回该项目")
    void filterByCommunity() {
        CollectionRateReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(PeriodRange.year(2026), "P02"));

        assertThat(report.byCommunity()).hasSize(1);
        assertThat(report.byCommunity().get(0).communityId()).isEqualTo("P02");
        assertThat(report.total().paidAmount()).isEqualByComparingTo("275857.61");
    }

    @Test
    @DisplayName("账期边界：逐月相加必须等于全年，既不重也不漏")
    void monthlyPartitionsSumToYear() {
        CollectionRateReport year = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(PeriodRange.year(2026), null));

        long count = 0L;
        BigDecimal paid = BigDecimal.ZERO;
        BigDecimal payable = BigDecimal.ZERO;
        for (int month = 1; month <= 12; month++) {
            YearMonth m = YearMonth.of(2026, month);
            CollectionRateReport monthly = TenantContext.runAs(TENANT_DEMO,
                    () -> repository.query(PeriodRange.of(m, m), null));
            count += monthly.total().billCount();
            paid = paid.add(monthly.total().paidAmount());
            payable = payable.add(monthly.total().payable());
        }

        assertThat(count).isEqualTo(year.total().billCount());
        assertThat(paid).isEqualByComparingTo(year.total().paidAmount());
        assertThat(payable).isEqualByComparingTo(year.total().payable());
    }

    @Test
    @DisplayName("区间外（2025、2027）返回空集，不是报错也不是全量")
    void outOfRangeIsEmpty() {
        CollectionRateReport before = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(PeriodRange.year(2025), null));
        CollectionRateReport after = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(PeriodRange.year(2027), null));

        assertThat(before.byCommunity()).isEmpty();
        assertThat(before.total().billCount()).isZero();
        assertThat(before.total().collectionRate()).isNull();
        assertThat(after.byCommunity()).isEmpty();
    }

    @Test
    @DisplayName("跨年区间 2025-12 ~ 2026-12 含 2026 数据，且不外溢")
    void crossYearRange() {
        CollectionRateReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(PeriodRange.of("2025-12", "2026-12"), null));

        assertThat(report.total().billCount()).isEqualTo(4308L);
        assertThat(report.total().paidAmount()).isEqualByComparingTo("1192152.20");
    }

    @Test
    @DisplayName("传不属于本租户的项目 → 403，不是空集")
    void foreignCommunityIsForbidden() {
        assertThatThrownBy(() -> TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(PeriodRange.year(2026), "P99")))
                .isInstanceOf(ForbiddenException.class)
                .hasMessageContaining("P99");
    }

    private static CollectionRateResult find(List<CollectionRateResult> rows, String communityId) {
        Map<String, CollectionRateResult> byId = rows.stream()
                .collect(Collectors.toMap(CollectionRateResult::communityId, Function.identity()));
        assertThat(byId).containsKey(communityId);
        return byId.get(communityId);
    }
}
