package com.wy.property.billing.collection;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface CollectionRateMapper {

    /**
     * 按项目汇总应收/减免/实收（SQL 见 mapper/billing/collection.xml）。
     *
     * @param fromPeriod 起始账期 YYYY-MM（含）
     * @param toPeriod   结束账期 YYYY-MM（含）
     */
    List<CollectionRateRow> selectByCommunity(@Param("fromPeriod") String fromPeriod,
                                              @Param("toPeriod") String toPeriod,
                                              @Param("communityId") String communityId);
}
