package com.wy.property.billing.daily;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.OffsetDateTime;
import java.util.List;

@Mapper
public interface DailyRevenueMapper {

    /** 收入段：按费用分类 × 日（不含押金类科目）。 */
    List<DailyIncomeRow> selectIncome(@Param("fromTs") OffsetDateTime fromTs,
                                      @Param("toTs") OffsetDateTime toTs,
                                      @Param("communityId") String communityId);

    /** 往来 / 退款段：按押金类型 × 日 × 方向。 */
    List<DailyDepositRow> selectDeposits(@Param("fromTs") OffsetDateTime fromTs,
                                         @Param("toTs") OffsetDateTime toTs,
                                         @Param("communityId") String communityId);

    /** 收款点七格 + 预存抵扣，按日。 */
    List<DailyPayPointRow> selectPayPoints(@Param("fromTs") OffsetDateTime fromTs,
                                           @Param("toTs") OffsetDateTime toTs,
                                           @Param("communityId") String communityId);
}
