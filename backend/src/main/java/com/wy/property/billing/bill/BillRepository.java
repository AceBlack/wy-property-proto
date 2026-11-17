package com.wy.property.billing.bill;

import com.wy.property.billing.community.CommunityGuard;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import com.wy.property.web.PageResponse;
import org.springframework.stereotype.Repository;

import java.util.List;

/** 账单查询（读）。写操作、调账、作废在后续批次。 */
@Repository
public class BillRepository {

    private final BillQueryMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public BillRepository(BillQueryMapper mapper, CommunityGuard communityGuard,
                          TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    public PageResponse<BillResponse> query(BillQuery query) {
        communityGuard.assertVisible(query.getCommunityId());

        return tenantTx.execute(() -> {
            long total = mapper.count(query);
            List<BillListRow> rows = total == 0 ? List.of() : mapper.selectPage(query);
            return new PageResponse<>(
                    rows.stream().map(BillResponse::from).toList(),
                    total, query.getPageNo(), query.getSize());
        });
    }
}
