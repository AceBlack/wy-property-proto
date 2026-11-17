package com.wy.property.billing.bill;

import com.wy.property.auth.AccessScope;
import com.wy.property.web.ApiResponse;
import com.wy.property.web.PageResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 账单列表（契约 {@code GET /bills}）。
 *
 * <p>排序按账期倒序 + id 倒序：同账期内结果稳定，翻页不会因为排序不确定而重复/漏行。</p>
 */
@RestController
@RequestMapping("/bills")
public class BillController {

    private final BillRepository billRepository;

    public BillController(BillRepository billRepository) {
        this.billRepository = billRepository;
    }

    @GetMapping
    public ApiResponse<PageResponse<BillResponse>> list(
            @RequestParam(defaultValue = "1") int pageNo,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String communityId,
            @RequestParam(required = false) String buildingId,
            @RequestParam(required = false) String unitId,
            @RequestParam(required = false) String kw,
            @RequestParam(required = false) String period,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String itemId,
            @RequestParam(required = false) String subjectType,
            @RequestParam(required = false) String vf) {

        // 有范围的角色不传 communityId 时，收敛到自己项目，不放开成全租户
        String effectiveCommunity = AccessScope.resolveCommunity(communityId);

        BillQuery query = new BillQuery(pageNo, size, effectiveCommunity, buildingId, unitId,
                kw, period, status, itemId, subjectType, vf);
        return ApiResponse.ok(billRepository.query(query));
    }
}
