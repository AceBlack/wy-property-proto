package com.wy.property.billing.collection;

import com.wy.property.billing.community.CommunityGuard;
import com.wy.property.common.period.PeriodRange;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public class CollectionRateRepository {

    private final CollectionRateMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public CollectionRateRepository(CollectionRateMapper mapper,
                                    CommunityGuard communityGuard,
                                    TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    /**
     * 三率（按项目、按账期区间）。
     *
     * @param range       账期闭区间，跨年可用
     * @param communityId 指定项目；null = 本租户全部项目
     */
    public CollectionRateReport query(PeriodRange range, String communityId) {
        communityGuard.assertVisible(communityId);
        List<CollectionRateRow> rows = tenantTx.execute(
                () -> mapper.selectByCommunity(range.fromPeriod(), range.toPeriod(), communityId));
        return new CollectionRateReport(
                rows.stream().map(CollectionRateCalculator::of).toList(),
                CollectionRateCalculator.total(rows));
    }
}
