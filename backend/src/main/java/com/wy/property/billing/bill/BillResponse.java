package com.wy.property.billing.bill;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wy.property.common.time.BusinessZone;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;

/**
 * 契约 {@code Bill} 的响应体。
 *
 * <p>{@code discount} 对应库里的 {@code waive_amount}：对外叫"减免"，
 * 库里叫 waive——两边都得留一个名字，映射在这一层做，别让前端看到两套叫法。</p>
 */
public record BillResponse(
        String billId,
        String communityId,
        String buildingId,
        String unitId,
        String houseId,
        String houseName,
        String ownerId,
        String ownerName,
        String period,
        String status,
        String itemId,
        String itemName,
        String unit,
        BigDecimal quantity,
        BigDecimal price,
        BigDecimal amount,
        BigDecimal discount,
        BigDecimal lateFee,
        BigDecimal payable,
        BigDecimal paidAmount,
        BigDecimal unpaid,
        Integer overdueDays,
        LocalDate dueDate,
        OffsetDateTime payTime,
        OffsetDateTime createTime,
        String subjectType,
        @JsonProperty("_ver") Integer version) {

    public static BillResponse from(BillListRow row) {
        return new BillResponse(
                row.getBillId(), row.getCommunityId(), row.getBuildingId(), row.getUnitId(),
                row.getHouseId(), row.getHouseName(), row.getOwnerId(), row.getOwnerName(),
                row.getPeriod(), row.getStatus(), row.getItemId(), row.getItemName(),
                row.getUnit(), row.getQuantity(), row.getPrice(), row.getAmount(),
                row.getDiscount(), row.getLateFee(), row.getPayable(), row.getPaidAmount(),
                row.getUnpaid(), row.getOverdueDays(), row.getDueDate(),
                BusinessZone.toBusinessOffset(row.getPayTime()),
                BusinessZone.toBusinessOffset(row.getCreateTime()),
                row.getSubjectType(), row.getVersion());
    }
}
