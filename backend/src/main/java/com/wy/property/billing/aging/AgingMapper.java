package com.wy.property.billing.aging;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.time.LocalDate;
import java.util.List;

@Mapper
public interface AgingMapper {

    /** 固定返回 5 档（含 0 行档位），顺序由 SQL 保证。 */
    List<AgingBucketRow> selectBuckets(@Param("refDate") LocalDate referenceDate,
                                       @Param("communityId") String communityId);

    /** 按项目汇总（房屋数、欠费额）。 */
    List<AgingCommunityRow> selectByCommunity(@Param("refDate") LocalDate referenceDate,
                                              @Param("communityId") String communityId);

    /** 欠得最久的 N 笔；分档标签由 SQL 算，保证与 {@link #selectBuckets} 同一套边界。 */
    List<AgingOldestRow> selectOldest(@Param("refDate") LocalDate referenceDate,
                                      @Param("communityId") String communityId,
                                      @Param("limit") int limit);

    /** 涉及房屋数：必须跨档去重，不能把各档相加。 */
    long countHouses(@Param("refDate") LocalDate referenceDate,
                     @Param("communityId") String communityId);
}
