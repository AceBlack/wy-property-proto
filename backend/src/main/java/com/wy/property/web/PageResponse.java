package com.wy.property.web;

import java.util.List;

/** 分页结果，与契约 {@code Page} 一致。 */
public record PageResponse<T>(List<T> rows, long total, int pageNo, int size) {
}
