package com.wy.property.billing.deposit;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.OffsetDateTime;
import java.util.List;

@Mapper
public interface DepositCashFlowMapper {

    /** 只取 I / O 两向：D（扣除/没收）不产生现金流。 */
    List<DepositCashRow> selectCashFlow(@Param("fromTs") OffsetDateTime fromTs,
                                        @Param("toTs") OffsetDateTime toTs,
                                        @Param("communityId") String communityId);
}
