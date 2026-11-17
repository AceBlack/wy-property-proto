package com.wy.property.billing.collection;

import java.util.List;

/**
 * 三率报表：分项目明细 + 合计。
 *
 * <p>合计行的收缴率必须<b>重新按总额算</b>，不能对各行百分比取平均——
 * 平均百分比在项目体量差异大时会明显失真。</p>
 */
public record CollectionRateReport(List<CollectionRateResult> byCommunity, CollectionRateResult total) {
}
