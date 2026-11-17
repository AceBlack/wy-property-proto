package com.wy.property.billing.deposit;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.OffsetDateTime;
import java.util.List;

@Mapper
public interface DepositLedgerMapper {

    /** 按押金类型汇总：期间发生的收/退/扣，以及截至 toTs 的累计余额。 */
    List<DepositLedgerTypeRow> selectByType(@Param("fromTs") OffsetDateTime fromTs,
                                            @Param("toTs") OffsetDateTime toTs,
                                            @Param("communityId") String communityId);

    /** 全量恒等式，不受查询区间影响。 */
    DepositIdentityRow selectIdentity(@Param("communityId") String communityId);
}
