package com.wy.property.billing.aging;

import com.wy.property.common.tenant.TenantContext;
import com.wy.property.support.DbTestSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/** 账龄分档：与 psql 基线比对（基准日固定，保证可复算）。 */
class AgingDbTest extends DbTestSupport {

    /** 迁移完成日 = 基线快照日。固定下来，明天跑结果也一样。 */
    private static final LocalDate BASELINE_DATE = LocalDate.of(2026, 11, 18);

    @Autowired
    private AgingRepository repository;

    @Test
    @DisplayName("2026-11-18 账龄五档与基线一致")
    void bucketsMatchBaseline() {
        AgingReport report = TenantContext.runAs(TENANT_DEMO, () -> repository.query(BASELINE_DATE, null));

        assertThat(report.buckets()).hasSize(5);

        assertBucket(report, AgingBucket.NOT_DUE, 0L, "0.00");
        assertBucket(report, AgingBucket.DAYS_0_30, 525L, "152236.02");
        assertBucket(report, AgingBucket.DAYS_31_90, 223L, "65949.10");
        assertBucket(report, AgingBucket.DAYS_91_180, 3L, "1047.62");
        assertBucket(report, AgingBucket.OVER_180, 2L, "723.83");

        assertThat(report.totalCount()).isEqualTo(753L);
        assertThat(report.totalOwed()).isEqualByComparingTo("219956.57");
    }

    @Test
    @DisplayName("档位顺序固定：未到期在最前，180天以上在最后")
    void bucketOrderIsStable() {
        AgingReport report = TenantContext.runAs(TENANT_DEMO, () -> repository.query(BASELINE_DATE, null));

        assertThat(report.buckets()).extracting(AgingReport.Bucket::bucket)
                .containsExactly(AgingBucket.NOT_DUE, AgingBucket.DAYS_0_30,
                        AgingBucket.DAYS_31_90, AgingBucket.DAYS_91_180, AgingBucket.OVER_180);
    }

    @Test
    @DisplayName("基准日早于所有到期日时，全部落在未到期")
    void allNotDueBeforeFirstDueDate() {
        AgingReport report = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(LocalDate.of(2026, 1, 1), null));

        assertBucket(report, AgingBucket.NOT_DUE, 753L, "219956.57");
        assertThat(report.totalCount()).isEqualTo(753L);
    }

    @Test
    @DisplayName("基准日后移不改变总额，只改变档位分布")
    void shiftingReferenceDateKeepsTotals() {
        AgingReport later = TenantContext.runAs(TENANT_DEMO,
                () -> repository.query(BASELINE_DATE.plusDays(30), null));

        assertThat(later.totalCount()).isEqualTo(753L);
        assertThat(later.totalOwed()).isEqualByComparingTo("219956.57");
        long sum = later.buckets().stream().mapToLong(AgingReport.Bucket::billCount).sum();
        assertThat(sum).isEqualTo(753L);
        // 一个月之后，"1-30天"里必然会涌入新的账单，档位分布应当变化
        assertThat(find(later, AgingBucket.DAYS_0_30).billCount())
                .isNotEqualTo(find(TenantContext.runAs(TENANT_DEMO,
                        () -> repository.query(BASELINE_DATE, null)), AgingBucket.DAYS_0_30).billCount());
    }

    @Test
    @DisplayName("按项目过滤：三个项目张数相加等于全租户")
    void filterByCommunity() {
        Map<String, Long> counts = new java.util.HashMap<>();
        for (String communityId : List.of("P01", "P02", "P03")) {
            AgingReport report = TenantContext.runAs(TENANT_DEMO,
                    () -> repository.query(BASELINE_DATE, communityId));
            counts.put(communityId, report.totalCount());
            assertThat(report.buckets()).hasSize(5);
        }

        assertThat(counts.values().stream().mapToLong(Long::longValue).sum()).isEqualTo(753L);
    }

    private static void assertBucket(AgingReport report, AgingBucket bucket, long count, String owed) {
        AgingReport.Bucket row = find(report, bucket);
        assertThat(row.billCount()).as(bucket.label() + " 张数").isEqualTo(count);
        assertThat(row.owedAmount()).as(bucket.label() + " 金额").isEqualByComparingTo(new BigDecimal(owed));
    }

    private static AgingReport.Bucket find(AgingReport report, AgingBucket bucket) {
        Map<AgingBucket, AgingReport.Bucket> byBucket = report.buckets().stream()
                .collect(Collectors.toMap(AgingReport.Bucket::bucket, Function.identity()));
        assertThat(byBucket).containsKey(bucket);
        return byBucket.get(bucket);
    }
}
