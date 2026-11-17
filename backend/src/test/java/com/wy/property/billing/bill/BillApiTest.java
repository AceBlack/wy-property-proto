package com.wy.property.billing.bill;

import com.wy.property.auth.JwtService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 账单列表：分页、筛选、快捷视图、数据范围。 */
@SpringBootTest
@AutoConfigureMockMvc
class BillApiTest {

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private JwtService jwtService;

    private String gm() {
        return "Bearer " + jwtService.issue(1L, "u-gm", "gm", null);
    }

    private String pm(String communityId) {
        return "Bearer " + jwtService.issue(1L, "u-pm", "pm", communityId);
    }

    @Test
    @DisplayName("默认分页：总数 4,884，每页 20，按账期倒序")
    void defaultPage() throws Exception {
        mockMvc.perform(get("/bills").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.total").value(4884))
                .andExpect(jsonPath("$.data.pageNo").value(1))
                .andExpect(jsonPath("$.data.size").value(20))
                .andExpect(jsonPath("$.data.rows.length()").value(20))
                .andExpect(jsonPath("$.data.rows[0].period").value("2026-10"))
                .andExpect(jsonPath("$.data.rows[0].billId").value(matchesPattern("BL\\d{6}")))
                .andExpect(jsonPath("$.data.rows[0]._ver").value(is(1)))
                // 时间戳带业务时区：不带的话前端会把 00:00+08 显示成前一天 16:00
                .andExpect(jsonPath("$.data.rows[0].createTime").value(matchesPattern(".*[+]08:00$")));
    }

    @Test
    @DisplayName("按状态筛选：待缴 669 张")
    void filterByStatus() throws Exception {
        mockMvc.perform(get("/bills").param("status", "待缴").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(669))
                .andExpect(jsonPath("$.data.rows[*].status").value(everyItem(is("待缴"))));
    }

    @Test
    @DisplayName("快捷视图 debt：欠费 = 待缴 + 部分缴 = 753 张")
    void quickViewDebt() throws Exception {
        mockMvc.perform(get("/bills").param("vf", "debt").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(753))
                .andExpect(jsonPath("$.data.rows[*].unpaid").value(everyItem(greaterThan(0.0))));
    }

    @Test
    @DisplayName("按主体类型：车位账单没有 houseId")
    void filterParkBills() throws Exception {
        mockMvc.perform(get("/bills").param("subjectType", "park").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1344))
                .andExpect(jsonPath("$.data.rows[0].subjectType").value("park"))
                .andExpect(jsonPath("$.data.rows[0].houseId").doesNotExist());
    }

    @Test
    @DisplayName("按账期 + 按收费项组合筛选")
    void filterByPeriodAndItem() throws Exception {
        mockMvc.perform(get("/bills")
                        .param("period", "2026-10")
                        .param("itemId", "FI01")
                        .param("size", "5")
                        .header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows.length()").value(greaterThan(0)))
                .andExpect(jsonPath("$.data.rows[*].period").value(everyItem(is("2026-10"))))
                .andExpect(jsonPath("$.data.rows[*].itemId").value(everyItem(is("FI01"))));
    }

    @Test
    @DisplayName("关键词能搜到房号与业主名")
    void keywordSearch() throws Exception {
        mockMvc.perform(get("/bills").param("kw", "BL000001").header("Authorization", gm()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.rows[0].billId").value("BL000001"));
    }

    @Test
    @DisplayName("size 超 100 → 400（契约写死的上限）")
    void sizeOutOfRange() throws Exception {
        mockMvc.perform(get("/bills").param("size", "101").header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("页码从 1 开始，0 视为参数错误")
    void pageNoMustStartAtOne() throws Exception {
        mockMvc.perform(get("/bills").param("pageNo", "0").header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("非法状态值 → 400，而不是静默返回空集")
    void invalidStatus() throws Exception {
        mockMvc.perform(get("/bills").param("status", "部分缴费").header("Authorization", gm()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(40001));
    }

    @Test
    @DisplayName("项目经理不传 communityId 时只看自己项目")
    void scopedUserSeesOwnCommunityOnly() throws Exception {
        mockMvc.perform(get("/bills").param("size", "50").header("Authorization", pm("P01")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rows[*].communityId").value(everyItem(is("P01"))));
    }

    @Test
    @DisplayName("项目经理看别人项目 → 403")
    void scopedUserCannotReadOtherCommunity() throws Exception {
        mockMvc.perform(get("/bills").param("communityId", "P02").header("Authorization", pm("P01")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value(40301));
    }
}
