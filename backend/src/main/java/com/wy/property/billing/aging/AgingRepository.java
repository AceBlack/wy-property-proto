package com.wy.property.billing.aging;

import com.wy.property.billing.community.CommunityGuard;
import com.wy.property.common.money.Money;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

@Repository
public class AgingRepository {

    /** 账龄按营业日算，不用机器本地时区——服务器在 UTC 时区时跨日会差一天。 */
    public static final ZoneId BUSINESS_ZONE = com.wy.property.common.time.BusinessZone.ZONE;

    /** 契约规定的"最久欠费"条数。 */
    private static final int OLDEST_LIMIT = 8;

    private final AgingMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public AgingRepository(AgingMapper mapper,
                           CommunityGuard communityGuard,
                           TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    public AgingReport query(String communityId) {
        return query(LocalDate.now(BUSINESS_ZONE), communityId);
    }

    /**
     * 账龄分档。
     *
     * @param referenceDate 基准日，显式传入（不隐式用 now()，否则报表不能复算）
     */
    public AgingReport query(LocalDate referenceDate, String communityId) {
        communityGuard.assertVisible(communityId);
        List<AgingBucketRow> rows = tenantTx.execute(() -> mapper.selectBuckets(referenceDate, communityId));

        List<AgingReport.Bucket> buckets = new ArrayList<>(rows.size());
        long totalCount = 0L;
        BigDecimal totalOwed = BigDecimal.ZERO;
        for (AgingBucketRow row : rows) {
            long count = row.getBillCount() == null ? 0L : row.getBillCount();
            long houses = row.getHouses() == null ? 0L : row.getHouses();
            BigDecimal owed = Money.of(row.getOwedAmount());
            buckets.add(new AgingReport.Bucket(AgingBucket.fromLabel(row.getBucket()), count, houses, owed));
            totalCount += count;
            totalOwed = totalOwed.add(owed);
        }
        return new AgingReport(referenceDate, List.copyOf(buckets), totalCount, Money.of(totalOwed));
    }

    /**
     * 实时账龄报表（契约 {@code /reports/aging-live}）：分档 + 占比 + 按项目 + 最久欠费。
     *
     * <p>与 {@link #query} 共用同一套分档 SQL，不另写一份口径。</p>
     */
    public AgingLiveReport queryLive(LocalDate referenceDate, String communityId) {
        communityGuard.assertVisible(communityId);

        List<AgingBucketRow> bucketRows = tenantTx.execute(() -> mapper.selectBuckets(referenceDate, communityId));
        List<AgingCommunityRow> communityRows = tenantTx.execute(() -> mapper.selectByCommunity(referenceDate, communityId));
        List<AgingOldestRow> oldestRows = tenantTx.execute(() -> mapper.selectOldest(referenceDate, communityId, OLDEST_LIMIT));
        long totalHouses = tenantTx.execute(() -> mapper.countHouses(referenceDate, communityId));

        BigDecimal totalOwed = BigDecimal.ZERO;
        long totalCount = 0L;
        for (AgingBucketRow row : bucketRows) {
            totalCount += row.getBillCount() == null ? 0L : row.getBillCount();
            totalOwed = totalOwed.add(Money.of(row.getOwedAmount()));
        }
        totalOwed = Money.of(totalOwed);

        List<AgingLiveReport.Row> rows = new ArrayList<>(bucketRows.size());
        for (AgingBucketRow row : bucketRows) {
            BigDecimal amount = Money.of(row.getOwedAmount());
            BigDecimal share = Money.isZero(totalOwed)
                    ? Money.zero()
                    : Money.percent(amount, totalOwed);
            rows.add(new AgingLiveReport.Row(
                    AgingBucket.fromLabel(row.getBucket()),
                    row.getBillCount() == null ? 0L : row.getBillCount(),
                    row.getHouses() == null ? 0L : row.getHouses(),
                    amount,
                    share));
        }

        List<AgingLiveReport.CommunityRow> byCommunity = communityRows.stream()
                .map(row -> new AgingLiveReport.CommunityRow(
                        row.getCommunityId(), row.getCommunityName(),
                        row.getHouses() == null ? 0L : row.getHouses(),
                        Money.of(row.getOwedAmount())))
                .toList();

        List<AgingLiveReport.Oldest> oldest = oldestRows.stream()
                .map(row -> new AgingLiveReport.Oldest(
                        row.getBillId(),
                        row.getPeriod(),
                        row.getDueDate(),
                        AgingBucket.fromLabel(row.getAging()),
                        row.getOverdueDays() == null ? 0 : row.getOverdueDays(),
                        Money.of(row.getUnpaid())))
                .toList();

        return new AgingLiveReport(referenceDate, totalCount, totalHouses, totalOwed,
                List.copyOf(rows), byCommunity, oldest);
    }
}
