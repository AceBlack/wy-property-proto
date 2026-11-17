package com.wy.property.billing.collection;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 三率口径的四个边界：金额舍入、零面积、全额减免、合计不能取平均。
 * 这四条不连库，纯算法。
 */
class CollectionRateCalculatorTest {

    @Test
    @DisplayName("基线口径：星光天地 2026 全年 85.06%")
    void matchesBaseline() {
        CollectionRateResult result = CollectionRateCalculator.of(
                row("P03", "星光天地", "603213.54", "4963.88", "508857.56", 1289L));

        assertThat(result.netPayable()).isEqualByComparingTo("598249.66");
        assertThat(result.collectionRate()).isEqualByComparingTo("85.06");
        assertThat(result.billCount()).isEqualTo(1289L);
    }

    @Test
    @DisplayName("零面积账单：金额 0，计入张数，但不会污染分母")
    void zeroAreaBill() {
        CollectionRateResult zero = CollectionRateCalculator.of(
                row("P01", "翡翠城", "0.00", "0.00", "0.00", 1L));

        assertThat(zero.netPayable()).isEqualByComparingTo("0.00");
        assertThat(zero.collectionRate()).isNull();   // 无应收 ≠ 0% 收缴率
        assertThat(zero.billCount()).isEqualTo(1L);
    }

    @Test
    @DisplayName("全额减免：净应缴 0，收缴率为 null，不能算出 0% 或 Infinity")
    void fullyWaivedBill() {
        CollectionRateResult waived = CollectionRateCalculator.of(
                row("P01", "翡翠城", "1000.00", "1000.00", "0.00", 1L));

        assertThat(waived.netPayable()).isEqualByComparingTo("0.00");
        assertThat(waived.collectionRate()).isNull();
    }

    @Test
    @DisplayName("合计的收缴率按总额重算，不是各行百分比的平均")
    void totalIsRecomputedNotAveraged() {
        List<CollectionRateRow> rows = List.of(
                row("P01", "大项目", "10000.00", "0.00", "5000.00", 10L),   // 50%
                row("P02", "小项目", "100.00", "0.00", "100.00", 1L));       // 100%

        CollectionRateResult total = CollectionRateCalculator.total(rows);

        assertThat(total.payable()).isEqualByComparingTo("10100.00");
        assertThat(total.paidAmount()).isEqualByComparingTo("5100.00");
        assertThat(total.collectionRate()).isEqualByComparingTo("50.50");
        // 若错误地取平均会是 75.00
        assertThat(total.collectionRate()).isNotEqualByComparingTo("75.00");
        assertThat(total.billCount()).isEqualTo(11L);
    }

    @Test
    @DisplayName("减免只影响分母，实收不变")
    void waiveReducesDenominatorOnly() {
        CollectionRateResult withWaive = CollectionRateCalculator.of(
                row("P01", "翡翠城", "1000.00", "200.00", "800.00", 1L));

        assertThat(withWaive.netPayable()).isEqualByComparingTo("800.00");
        assertThat(withWaive.collectionRate()).isEqualByComparingTo("100.00");
        // 若错用 payable（原价）当分母，会算成 80.00
        assertThat(withWaive.collectionRate()).isNotEqualByComparingTo("80.00");
    }

    @Test
    @DisplayName("空数据集：合计为 0，比率为 null")
    void emptyTotal() {
        CollectionRateResult total = CollectionRateCalculator.total(List.of());

        assertThat(total.payable()).isEqualByComparingTo(BigDecimal.ZERO);
        assertThat(total.collectionRate()).isNull();
        assertThat(total.billCount()).isZero();
    }

    private static CollectionRateRow row(String communityId, String name,
                                         String payable, String waive, String paid, Long count) {
        CollectionRateRow row = new CollectionRateRow();
        row.setCommunityId(communityId);
        row.setCommunityName(name);
        row.setPayable(new BigDecimal(payable));
        row.setWaiveAmount(new BigDecimal(waive));
        row.setPaidAmount(new BigDecimal(paid));
        row.setBillCount(count);
        return row;
    }
}
