package com.wy.property.billing.settlement;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.OffsetDateTime;
import java.util.List;

@Mapper
public interface SettlementMapper {

    List<DailySummaryRow> selectDaily(@Param("fromTs") OffsetDateTime fromTs,
                                      @Param("toTs") OffsetDateTime toTs,
                                      @Param("communityId") String communityId);

    List<PayPointRow> selectByPayPoint(@Param("fromTs") OffsetDateTime fromTs,
                                       @Param("toTs") OffsetDateTime toTs,
                                       @Param("communityId") String communityId);
}
