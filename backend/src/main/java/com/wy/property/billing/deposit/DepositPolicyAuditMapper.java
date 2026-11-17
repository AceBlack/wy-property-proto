package com.wy.property.billing.deposit;

import org.apache.ibatis.annotations.Mapper;

import java.util.List;

@Mapper
public interface DepositPolicyAuditMapper {

    List<DepositCashViolationRow> selectCashViolations();

    List<DepositMethodMismatchRow> selectMethodMismatches();
}
