package com.wy.property.billing.report;

import com.wy.property.auth.AccessScope;
import com.wy.property.billing.aging.AgingRepository;
import com.wy.property.billing.collection.ThreeRateRepository;
import com.wy.property.billing.daily.DailyRevenueRepository;
import com.wy.property.billing.deposit.DepositLedgerRepository;
import com.wy.property.common.period.PeriodRange;
import com.wy.property.web.ApiResponse;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;

/**
 * 收费域报表读接口。
 *
 * <p>本期只开两条（账龄、押金台账）：它们的数据层已经与 psql 基线逐分对齐。
 * 三率与经营日报要按"账期矩阵 / 科目 × 日"重新聚合，下一批做——不拿现有四条的模型硬套契约。</p>
 *
 * <p>数据范围：{@link AccessScope#assertCommunity} 在进查询前拦，越权返回 403 而不是空集。</p>
 */
@RestController
@RequestMapping("/reports")
public class ReportController {

    private final AgingRepository agingRepository;
    private final DepositLedgerRepository depositLedgerRepository;
    private final ThreeRateRepository threeRateRepository;
    private final DailyRevenueRepository dailyRevenueRepository;

    public ReportController(AgingRepository agingRepository,
                            DepositLedgerRepository depositLedgerRepository,
                            ThreeRateRepository threeRateRepository,
                            DailyRevenueRepository dailyRevenueRepository) {
        this.agingRepository = agingRepository;
        this.depositLedgerRepository = depositLedgerRepository;
        this.threeRateRepository = threeRateRepository;
        this.dailyRevenueRepository = dailyRevenueRepository;
    }

    /**
     * 欠费账龄（实时口径）。
     *
     * @param asOf 统计日，缺省取服务端当日（Asia/Shanghai）
     */
    @GetMapping("/aging-live")
    public ApiResponse<AgingLiveResponse> agingLive(
            @RequestParam(required = false) String communityId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate asOf) {

        String effectiveCommunity = AccessScope.resolveCommunity(communityId);
        LocalDate referenceDate = asOf != null ? asOf : LocalDate.now(AgingRepository.BUSINESS_ZONE);
        return ApiResponse.ok(AgingLiveResponse.from(agingRepository.queryLive(referenceDate, effectiveCommunity)));
    }

    /**
     * 押金台账：期间收/退/扣 + 截至 to 的在账余额 + 全量恒等式。
     */
    @GetMapping("/deposit-ledger")
    public ApiResponse<DepositLedgerResponse> depositLedger(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) String communityId) {

        String effectiveCommunity = AccessScope.resolveCommunity(communityId);
        return ApiResponse.ok(DepositLedgerResponse.from(depositLedgerRepository.query(from, to, effectiveCommunity)));
    }

    /**
     * 三率：收缴率 / 欠费率 / 减免率 + 按账期 + 按用途 + 现金归属三分。
     *
     * @param from   起始账期 YYYY-MM（含）
     * @param to     结束账期 YYYY-MM（含）
     * @param itemId 收费项编码，缺省 FI01（物业服务费）；水电走账单不算三率
     */
    @GetMapping("/three-rate")
    public ApiResponse<ThreeRateResponse> threeRate(
            @RequestParam String from,
            @RequestParam String to,
            @RequestParam(required = false) String communityId,
            @RequestParam(required = false, defaultValue = "FI01") String itemId) {

        PeriodRange range = parseRange(from, to);
        String effectiveCommunity = AccessScope.resolveCommunity(communityId);
        return ApiResponse.ok(ThreeRateResponse.from(
                threeRateRepository.query(range, itemId, effectiveCommunity)));
    }

    private static PeriodRange parseRange(String from, String to) {
        try {
            return PeriodRange.of(YearMonth.parse(from), YearMonth.parse(to));
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("账期格式应为 YYYY-MM，实际：" + from + " ~ " + to);
        }
    }

    /**
     * 经营日报：收入 / 押金往来 / 押金退款 三段 + 收款点七格 + 差额自检。
     *
     * <p>差额口径为"收款点全方式"（2026-11-18 确认），含押金收退；
     * 抽屉现金看"现金 / 车辆现金"两格，不和差额混为一谈。</p>
     *
     * @param month 月份 YYYY-MM
     */
    @GetMapping("/daily-revenue")
    public ApiResponse<DailyRevenueResponse> dailyRevenue(
            @RequestParam String month,
            @RequestParam(required = false) String communityId) {

        YearMonth parsed;
        try {
            parsed = YearMonth.parse(month);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("month 格式应为 YYYY-MM：" + month);
        }
        String effectiveCommunity = AccessScope.resolveCommunity(communityId);
        return ApiResponse.ok(DailyRevenueResponse.from(
                dailyRevenueRepository.query(parsed, effectiveCommunity)));
    }
}
