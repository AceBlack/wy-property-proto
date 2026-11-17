package com.wy.property.billing.collection;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

@Mapper
public interface ThreeRateMapper {

    ThreeRateItemRow selectItem(@Param("itemCode") String itemCode);

    /**
     * 理论应收：按 calc_type 把房源/车位摊到每个月，再乘当期生效价。
     * 没价目的对象不猜价，单独计入 gaps。
     */
    List<ThreeRateTheoreticalRow> selectTheoretical(@Param("calcType") String calcType,
                                                    @Param("itemId") Long itemId,
                                                    @Param("fromMonth") LocalDate fromMonth,
                                                    @Param("toMonth") LocalDate toMonth,
                                                    @Param("communityId") String communityId);

    /** 实际发生数（已开单口径）：按账单账期 × 用途。 */
    List<ThreeRateActualRow> selectActuals(@Param("fromPeriod") String fromPeriod,
                                           @Param("toPeriod") String toPeriod,
                                           @Param("itemCode") String itemCode,
                                           @Param("communityId") String communityId);

    long countOverpaid(@Param("fromPeriod") String fromPeriod,
                       @Param("toPeriod") String toPeriod,
                       @Param("itemCode") String itemCode,
                       @Param("communityId") String communityId);

    BigDecimal selectCashIncome(@Param("fromTs") OffsetDateTime fromTs,
                                @Param("toTs") OffsetDateTime toTs,
                                @Param("itemCode") String itemCode,
                                @Param("communityId") String communityId);

    ThreeRateCashRow selectCashAttribution(@Param("fromTs") OffsetDateTime fromTs,
                                           @Param("toTs") OffsetDateTime toTs,
                                           @Param("fromPeriod") String fromPeriod,
                                           @Param("toPeriod") String toPeriod,
                                           @Param("itemCode") String itemCode,
                                           @Param("communityId") String communityId);
}
