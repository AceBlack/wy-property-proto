package com.wy.property.billing.report;

import com.wy.property.auth.JwtService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.closeTo;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 经营日报：三段结构、七个收款点、差额为 0。 */
@SpringBootTest
@AutoConfigureMockMvc
class DailyRevenueApiTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JwtService jwtService;

    private String gm() {
        return "Bearer " + jwtService.issue(1L, "u-gm", "gm", null);
    }

    @Test
    @DisplayName("2026-08：收入 452,418.63 + 押金收取 310,982 − 退还 6,000 = 757,400.63")
    void monthTotals() throws Exception {
        mockMvc.perform(get("/reports/daily-revenue").param("month", "2026-08").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.month").value("2026-08"))
                .andExpect(jsonPath("$.data.days.length()").value(31))
                .andExpect(jsonPath("$.data.days[0]").value("2026-08-01"))
                .andExpect(jsonPath("$.data.groups.length()").value(3))
                .andExpect(jsonPath("$.data.groups[0].key").value("income"))
                .andExpect(jsonPath("$.data.groups[1].key").value("liaison"))
                .andExpect(jsonPath("$.data.groups[2].key").value("refund"))
                .andExpect(jsonPath("$.data.groups[0].total").value(closeTo(452418.63, 0.01)))
                .andExpect(jsonPath("$.data.groups[1].total").value(closeTo(310982.00, 0.01)))
                .andExpect(jsonPath("$.data.groups[2].total").value(closeTo(6000.00, 0.01)))
                .andExpect(jsonPath("$.data.grand.total").value(closeTo(757400.63, 0.01)))
                .andExpect(jsonPath("$.data.summary.income").value(closeTo(452418.63, 0.01)))
                .andExpect(jsonPath("$.data.summary.grand").value(closeTo(757400.63, 0.01)));
    }

    @Test
    @DisplayName("差额 = 合计 − 收款点（全方式），每一天都为 0")
    void diffIsZeroEveryDay() throws Exception {
        mockMvc.perform(get("/reports/daily-revenue").param("month", "2026-08").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.diff.ok").value(true))
                .andExpect(jsonPath("$.data.diff.total").value(closeTo(0.00, 0.01)))
                .andExpect(jsonPath("$.data.diff.badDays.length()").value(0))
                .andExpect(jsonPath("$.data.diff.amounts.length()").value(31));
    }

    @Test
    @DisplayName("收款点七格 + 预存抵扣：押金代扣进转账，押金现金进现金")
    void payPoints() throws Exception {
        mockMvc.perform(get("/reports/daily-revenue").param("month", "2026-08").header("Authorization", gm()))
                .andExpect(status().isOk())
                // 七格固定 + 预存抵扣（历史遗留，契约枚举缺这一格）
                .andExpect(jsonPath("$.data.payPoints.length()").value(8))
                .andExpect(jsonPath("$.data.payPoints[*].name").value(hasItem("现金")))
                .andExpect(jsonPath("$.data.payPoints[*].name").value(hasItem("车辆云平台")))
                .andExpect(jsonPath("$.data.payPoints[0].total").value(closeTo(51277.34, 0.01)))
                .andExpect(jsonPath("$.data.payPoints[5].total").value(closeTo(26320.00, 0.01)))
                .andExpect(jsonPath("$.data.payPoints[7].name").value("预存抵扣"));
    }

    @Test
    @DisplayName("收入按科目分行，金额数组与日期等长")
    void incomeRows() throws Exception {
        mockMvc.perform(get("/reports/daily-revenue").param("month", "2026-08").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.groups[0].rows.length()").value(2))
                .andExpect(jsonPath("$.data.groups[0].rows[0].code").value("常规服务费"))
                .andExpect(jsonPath("$.data.groups[0].rows[0].amounts.length()").value(31))
                .andExpect(jsonPath("$.data.groups[0].rows[0].total").value(closeTo(413740.57, 0.01)));
    }

    @Test
    @DisplayName("月份格式错 → 400")
    void badMonth() throws Exception {
        mockMvc.perform(get("/reports/daily-revenue").param("month", "2026-8").header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("项目经理看别人项目 → 403")
    void scopedForbidden() throws Exception {
        String pmP01 = "Bearer " + jwtService.issue(1L, "u-pm", "pm", "P01");
        mockMvc.perform(get("/reports/daily-revenue")
                        .param("month", "2026-08")
                        .param("communityId", "P02")
                        .header("Authorization", pmP01))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(40301));
    }
}
