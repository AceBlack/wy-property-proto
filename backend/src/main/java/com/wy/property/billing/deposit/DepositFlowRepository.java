package com.wy.property.billing.deposit;

import com.wy.property.billing.community.CommunityGuard;
import com.wy.property.common.money.Money;
import com.wy.property.common.tenant.TenantTransactionTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * 押金三向流水。押金是负债，不是收入——所以它不在 payment 表里，也不能算进"本月收入"。
 */
@Repository
public class DepositFlowRepository {

    private final DepositFlowMapper mapper;
    private final CommunityGuard communityGuard;
    private final TenantTransactionTemplate tenantTx;

    public DepositFlowRepository(DepositFlowMapper mapper,
                                 CommunityGuard communityGuard,
                                 TenantTransactionTemplate tenantTx) {
        this.mapper = mapper;
        this.communityGuard = communityGuard;
        this.tenantTx = tenantTx;
    }

    public DepositFlowReport query(String communityId) {
        communityGuard.assertVisible(communityId);
        List<DepositFlowRow> rows = tenantTx.execute(() -> mapper.selectFlows(communityId));

        List<DepositFlowReport.Flow> flows = new ArrayList<>(rows.size());
        long count = 0L;
        BigDecimal balanceTotal = BigDecimal.ZERO;
        BigDecimal inTotal = BigDecimal.ZERO;
        BigDecimal outTotal = BigDecimal.ZERO;
        BigDecimal deductTotal = BigDecimal.ZERO;

        for (DepositFlowRow row : rows) {
            BigDecimal balance = Money.of(row.getBalance());
            BigDecimal in = Money.of(row.getInAmount());
            BigDecimal out = Money.of(row.getOutAmount());
            BigDecimal deduct = Money.of(row.getDeductAmount());
            BigDecimal calculated = Money.of(in.subtract(out).subtract(deduct));
            BigDecimal diff = Money.subtract(balance, calculated);

            flows.add(new DepositFlowReport.Flow(
                    row.getDepositId(), row.getDepositNo(), row.getCommunityId(), row.getStatus(),
                    balance, in, out, deduct, calculated, diff));

            count++;
            balanceTotal = balanceTotal.add(balance);
            inTotal = inTotal.add(in);
            outTotal = outTotal.add(out);
            deductTotal = deductTotal.add(deduct);
        }

        BigDecimal identity = Money.of(inTotal.subtract(outTotal).subtract(deductTotal));
        return new DepositFlowReport(List.copyOf(flows), count,
                Money.of(balanceTotal), Money.of(inTotal), Money.of(outTotal), Money.of(deductTotal),
                Money.subtract(balanceTotal, identity));
    }
}
