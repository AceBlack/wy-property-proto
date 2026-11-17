package com.wy.property.billing.aging;

import java.util.Arrays;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 账龄分档。顺序即报表顺序（最"新"到最"老"）。
 *
 * <p>"未到期"单独一档：欠费还没到期不是欠费，混进 0-30 天会让催缴名单虚高。</p>
 *
 * <p><b>标签必须与契约一致</b>：{@code 04-契约/openapi.yaml} 的 {@code AgingBucket} 枚举是
 * {@code 0-30天}，不是 {@code 1-30天}。这两个字看着只是叫法，但落到前后端就是两套值，
 * 查询参数与报表分组都会对不上（原型里 {@code 部分缴/部分缴费} 已经分叉过一次）。</p>
 */
public enum AgingBucket {

    NOT_DUE("未到期", 1),
    DAYS_0_30("0-30天", 2),
    DAYS_31_90("31-90天", 3),
    DAYS_91_180("91-180天", 4),
    OVER_180("180天以上", 5);

    private static final Map<String, AgingBucket> BY_LABEL = Arrays.stream(values())
            .collect(Collectors.toMap(AgingBucket::label, Function.identity()));

    private final String label;
    private final int order;

    AgingBucket(String label, int order) {
        this.label = label;
        this.order = order;
    }

    public String label() {
        return label;
    }

    public int order() {
        return order;
    }

    public static AgingBucket fromLabel(String label) {
        AgingBucket bucket = BY_LABEL.get(label);
        if (bucket == null) {
            throw new IllegalArgumentException("未知账龄档位：" + label);
        }
        return bucket;
    }
}
