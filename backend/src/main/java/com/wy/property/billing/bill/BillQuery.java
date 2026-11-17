package com.wy.property.billing.bill;

import org.springframework.util.StringUtils;

import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.Set;

/**
 * 账单列表查询参数。校验放在构造时，Controller 只负责传参。
 *
 * <p>分页上限 100 是契约写死的（超限 400），不是随手定的：账单表 4,884 行时
 * 一次拉全表还看不出来，十年 75 万行时会直接把内存打满。</p>
 *
 * <p>用普通类而不是 record：MyBatis 的 OGNL 按 getter 取属性，
 * record 的 {@code communityId()} 取不到，会静默传 null——这种"筛选条件失效"最难查。</p>
 */
public final class BillQuery {

    public static final int MAX_SIZE = 100;

    private static final Set<String> STATUSES = Set.of("待缴", "部分缴", "已缴", "已减免", "已作废");
    private static final Set<String> SUBJECT_TYPES = Set.of("house", "park");
    private static final Set<String> VIEWS = Set.of("", "debt", "overdue", "unpaid", "part");

    private final int pageNo;
    private final int size;
    private final String communityId;
    private final String buildingId;
    private final String unitId;
    private final String kw;
    private final String period;
    private final String status;
    private final String itemCode;
    private final String subjectType;
    private final String vf;

    public BillQuery(int pageNo, int size, String communityId, String buildingId, String unitId,
                     String kw, String period, String status, String itemCode,
                     String subjectType, String vf) {
        if (pageNo < 1) {
            throw new IllegalArgumentException("pageNo 必须 ≥ 1");
        }
        if (size < 1 || size > MAX_SIZE) {
            throw new IllegalArgumentException("size 必须在 1.." + MAX_SIZE + " 之间");
        }
        if (StringUtils.hasText(period)) {
            try {
                YearMonth.parse(period);
            } catch (DateTimeParseException e) {
                throw new IllegalArgumentException("period 格式应为 YYYY-MM：" + period);
            }
        }
        if (StringUtils.hasText(status) && !STATUSES.contains(status)) {
            throw new IllegalArgumentException("status 非法：" + status);
        }
        if (StringUtils.hasText(subjectType) && !SUBJECT_TYPES.contains(subjectType)) {
            throw new IllegalArgumentException("subjectType 只能是 house / park：" + subjectType);
        }
        if (vf != null && !VIEWS.contains(vf)) {
            throw new IllegalArgumentException("vf 非法：" + vf);
        }

        this.pageNo = pageNo;
        this.size = size;
        this.communityId = communityId;
        this.buildingId = buildingId;
        this.unitId = unitId;
        this.kw = StringUtils.hasText(kw) ? kw.trim() : null;
        this.period = StringUtils.hasText(period) ? period : null;
        this.status = StringUtils.hasText(status) ? status : null;
        this.itemCode = StringUtils.hasText(itemCode) ? itemCode : null;
        this.subjectType = StringUtils.hasText(subjectType) ? subjectType : null;
        this.vf = vf == null ? "" : vf;
    }

    public int offset() {
        return (pageNo - 1) * size;
    }

    /** MyBatis 走 getter，单独暴露一个。 */
    public int getOffset() {
        return offset();
    }

    public int getPageNo() {
        return pageNo;
    }

    public int getSize() {
        return size;
    }

    public String getCommunityId() {
        return communityId;
    }

    public String getBuildingId() {
        return buildingId;
    }

    public String getUnitId() {
        return unitId;
    }

    public String getKw() {
        return kw;
    }

    public String getPeriod() {
        return period;
    }

    public String getStatus() {
        return status;
    }

    public String getItemCode() {
        return itemCode;
    }

    public String getSubjectType() {
        return subjectType;
    }

    public String getVf() {
        return vf;
    }
}
