package com.wy.property.billing.bill;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface BillQueryMapper {

    long count(@Param("q") BillQuery query);

    List<BillListRow> selectPage(@Param("q") BillQuery query);
}
