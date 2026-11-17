package com.wy.property.billing.deposit;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface DepositFlowMapper {

    List<DepositFlowRow> selectFlows(@Param("communityId") String communityId);
}
