package com.wy.property.billing.report;

import com.wy.property.auth.JwtService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;

import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.lessThan;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 报表接口的黑盒测试：认证 → 数据范围 → 查询 → 契约字段。
 *
 * <p>金额断言用 {@code closeTo} 带容差：JsonPath 把小数解析成 Double，
 * 用 BigDecimal 精确比较会类型不匹配；容差取 0.001 元，远小于"一分钱"。</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
class ReportApiTest {

    private static final long TENANT = 1L;

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JwtService jwtService;

    private String gm() {
        return "Bearer " + jwtService.issue(TENANT, "u-gm", "gm", null);
    }

    private String pm(String communityId) {
        return "Bearer " + jwtService.issue(TENANT, "u-pm", "pm", communityId);
    }

    @Test
    @DisplayName("没有令牌 → 401 / 40101，不是 200 空数据")
    void requiresToken() throws Exception {
        mockMvc.perform(get("/reports/aging-live"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(40101));
    }

    @Test
    @DisplayName("账龄：5 档标签与契约一致（0-30天，不是 1-30天）")
    void agingMatchesContract() throws Exception {
        mockMvc.perform(get("/reports/aging-live").param("asOf", "2026-11-18").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.asOf").value("2026-11-18"))
                .andExpect(jsonPath("$.data.count").value(753))
                .andExpect(jsonPath("$.data.total").value(closeTo(219956.57, 0.001)))
                .andExpect(jsonPath("$.data.rows.length()").value(5))
                .andExpect(jsonPath("$.data.rows[0].bucket").value("未到期"))
                .andExpect(jsonPath("$.data.rows[1].bucket").value("0-30天"))
                .andExpect(jsonPath("$.data.rows[1].count").value(525))
                .andExpect(jsonPath("$.data.rows[1].amount").value(closeTo(152236.02, 0.001)))
                .andExpect(jsonPath("$.data.rows[4].bucket").value("180天以上"))
                .andExpect(jsonPath("$.data.byCommunity.length()").value(3))
                .andExpect(jsonPath("$.data.oldest.length()").value(8))
                .andExpect(jsonPath("$.data.oldest[0].dueDate").value("2026-04-15"))
                .andExpect(jsonPath("$.data.oldest[0].aging").value("180天以上"))
                .andExpect(jsonPath("$.data.oldest[0].overdueDays").value(217));
    }

    @Test
    @DisplayName("账龄：涉及房屋数不能把各档相加（同一套房可能欠多期）")
    void agingHousesAreDistinct() throws Exception {
        mockMvc.perform(get("/reports/aging-live").param("asOf", "2026-11-18").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.houses").value(greaterThan(0)))
                .andExpect(jsonPath("$.data.houses").value(lessThan(753)));
    }

    @Test
    @DisplayName("项目经理看别的项目 → 403 / 40301（不是空列表）")
    void crossCommunityIsForbidden() throws Exception {
        mockMvc.perform(get("/reports/aging-live")
                        .param("asOf", "2026-11-18")
                        .param("communityId", "P02")
                        .header("Authorization", pm("P01")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(40301));
    }

    @Test
    @DisplayName("项目经理不传 communityId 时收敛到自己项目，不会看到全租户")
    void scopedUserWithoutCommunityStaysScoped() throws Exception {
        mockMvc.perform(get("/reports/aging-live").param("asOf", "2026-11-18").header("Authorization", pm("P01")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.byCommunity.length()").value(1))
                .andExpect(jsonPath("$.data.byCommunity[0].communityId").value("P01"))
                .andExpect(jsonPath("$.data.count").value(lessThan(753)));
    }

    @Test
    @DisplayName("押金台账：期间发生额、截至日余额、全量恒等式三套数都对")
    void depositLedgerMatchesBaseline() throws Exception {
        mockMvc.perform(get("/reports/deposit-ledger")
                        .param("from", "2026-01-01")
                        .param("to", "2026-12-31")
                        .header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.from").value("2026-01-01"))
                .andExpect(jsonPath("$.data.received").value(closeTo(1005548.00, 0.001)))
                .andExpect(jsonPath("$.data.refunded").value(closeTo(407838.00, 0.001)))
                .andExpect(jsonPath("$.data.deducted").value(closeTo(19073.00, 0.001)))
                .andExpect(jsonPath("$.data.balance").value(closeTo(665637.00, 0.001)))
                .andExpect(jsonPath("$.data.byType.length()").value(5))
                .andExpect(jsonPath("$.data.identity.ok").value(true))
                .andExpect(jsonPath("$.data.identity.diff").value(closeTo(0.00, 0.001)));
    }

    @Test
    @DisplayName("押金台账：缺必填参数 → 400 / 40001")
    void depositLedgerRequiresDates() throws Exception {
        mockMvc.perform(get("/reports/deposit-ledger")
                        .param("to", "2026-12-31")
                        .header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("押金台账：起止反向 → 400，不是空报表")
    void depositLedgerRejectsInvertedRange() throws Exception {
        mockMvc.perform(get("/reports/deposit-ledger")
                        .param("from", "2026-12-31")
                        .param("to", "2026-01-01")
                        .header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("押金台账：非法日期格式 → 400")
    void depositLedgerRejectsMalformedDate() throws Exception {
        mockMvc.perform(get("/reports/deposit-ledger")
                        .param("from", "2026-13-01")
                        .param("to", "2026-12-31")
                        .header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("三率（理论应收口径）：FI01 2026 应收 220.5 万，已开单只有 55.8 万")
    void threeRateTheoreticalBasis() throws Exception {
        mockMvc.perform(get("/reports/three-rate")
                        .param("from", "2026-01")
                        .param("to", "2026-12")
                        .header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.itemId").value("FI01"))
                .andExpect(jsonPath("$.data.itemName").value("物业服务费"))
                .andExpect(jsonPath("$.data.periods").value(12))
                // 有价范围只有"住宅"：公寓 44 户、商业 120 户没有价目，不进合计
                .andExpect(jsonPath("$.data.houses").value(592))
                .andExpect(jsonPath("$.data.pricingGaps").value(164))
                .andExpect(jsonPath("$.data.receivable").value(closeTo(2205230.88, 0.01)))
                .andExpect(jsonPath("$.data.billedReceivable").value(closeTo(558340.35, 0.01)))
                .andExpect(jsonPath("$.data.billingGap").value(closeTo(1646890.53, 0.01)))
                .andExpect(jsonPath("$.data.received").value(closeTo(462846.94, 0.01)))
                .andExpect(jsonPath("$.data.waived").value(closeTo(3538.44, 0.01)))
                .andExpect(jsonPath("$.data.unpaid").value(closeTo(1738845.50, 0.01)))
                .andExpect(jsonPath("$.data.collectionRate").value(closeTo(21.02, 0.01)))
                .andExpect(jsonPath("$.data.billedCollectionRate").value(closeTo(83.43, 0.01)))
                .andExpect(jsonPath("$.data.arrearsRate").value(closeTo(78.98, 0.01)))
                .andExpect(jsonPath("$.data.byPeriod.length()").value(12))
                .andExpect(jsonPath("$.data.cashIncome").value(closeTo(941722.89, 0.01)))
                .andExpect(jsonPath("$.data.cashByAttribution.ok").value(true))
                .andExpect(jsonPath("$.data.identity.ok").value(true));
    }

    @Test
    @DisplayName("三率：缺价用途单列，rate 给 null 而不是 0%")
    void threeRateSeparatesUnpricedUsage() throws Exception {
        mockMvc.perform(get("/reports/three-rate")
                        .param("from", "2026-01")
                        .param("to", "2026-12")
                        .header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.byUsage.length()").value(3))
                .andExpect(jsonPath("$.data.byUsage[0].usage").value("住宅"))
                .andExpect(jsonPath("$.data.byUsage[0].houses").value(592))
                .andExpect(jsonPath("$.data.byUsage[0].receivable").value(closeTo(2205230.88, 0.01)))
                .andExpect(jsonPath("$.data.byUsage[1].usage").value("公寓"))
                .andExpect(jsonPath("$.data.byUsage[1].pricingGaps").value(44))
                .andExpect(jsonPath("$.data.byUsage[1].receivable").value(closeTo(0.00, 0.01)))
                .andExpect(jsonPath("$.data.byUsage[1].collectionRate").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.data.byUsage[2].usage").value("商业"))
                .andExpect(jsonPath("$.data.byUsage[2].pricingGaps").value(120));
    }

    @Test
    @DisplayName("三率：按账期铺满 12 个月，空月给 0")
    void threeRateFillsEmptyMonths() throws Exception {
        mockMvc.perform(get("/reports/three-rate")
                        .param("from", "2026-01")
                        .param("to", "2026-12")
                        .header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.byPeriod[0].period").value("2026-01"))
                // 每月理论应收 = 2,205,230.88 / 12 ≈ 183,769.24
                .andExpect(jsonPath("$.data.byPeriod[0].receivable").value(closeTo(183769.24, 1.00)))
                .andExpect(jsonPath("$.data.byPeriod[11].period").value("2026-12"));
    }

    @Test
    @DisplayName("三率：不存在的收费项 → 400")
    void threeRateRejectsUnknownItem() throws Exception {
        mockMvc.perform(get("/reports/three-rate")
                        .param("from", "2026-01")
                        .param("to", "2026-12")
                        .param("itemId", "FI99")
                        .header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("三率：账期格式错 → 400，不是 500")
    void threeRateRejectsBadPeriod() throws Exception {
        mockMvc.perform(get("/reports/three-rate")
                        .param("from", "2026-1")
                        .param("to", "2026-12")
                        .header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("三率：水电按用量计费，不进三率 → 400")
    void threeRateRejectsMeteredItem() throws Exception {
        mockMvc.perform(get("/reports/three-rate")
                        .param("from", "2026-01")
                        .param("to", "2026-12")
                        .param("itemId", "FI05")
                        .header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }
}
