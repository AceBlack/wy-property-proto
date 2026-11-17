package com.wy.property.web;

import com.wy.property.billing.deposit.DepositPolicyViolationException;
import com.wy.property.common.error.ForbiddenException;
import com.wy.property.common.error.UnauthorizedException;
import com.wy.property.common.tenant.TenantNotSetException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.UUID;

/**
 * 全局错误映射。错误码严格按契约，不另造一套。
 *
 * <table>
 *   <tr><td>40001</td><td>参数错误</td><td>400</td></tr>
 *   <tr><td>40101</td><td>未登录 / 过期</td><td>401</td></tr>
 *   <tr><td>40301</td><td>超出数据范围</td><td>403</td></tr>
 *   <tr><td>40914</td><td>业务规则不允许（押金政策）</td><td>409</td></tr>
 * </table>
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ForbiddenException.class)
    public ResponseEntity<ApiError> forbidden(ForbiddenException e) {
        return build(HttpStatus.FORBIDDEN, 40301, e.getMessage());
    }

    @ExceptionHandler(UnauthorizedException.class)
    public ResponseEntity<ApiError> unauthorized(UnauthorizedException e) {
        return build(HttpStatus.UNAUTHORIZED, 40101, e.getMessage());
    }

    /**
     * 押金政策拒绝（禁收现金、退款非原路等）。
     *
     * <p>用 409/40914（当前状态不允许该动作）而不是 400：请求本身合法，
     * 是业务规则不允许。前端提示语要照着 message 展示，别改写成"参数有误"。</p>
     */
    @ExceptionHandler(DepositPolicyViolationException.class)
    public ResponseEntity<ApiError> policy(DepositPolicyViolationException e) {
        return build(HttpStatus.CONFLICT, 40914, e.getMessage());
    }

    @ExceptionHandler({
            MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class,
            HttpMessageNotReadableException.class,
            MethodArgumentNotValidException.class,
            HandlerMethodValidationException.class,
            IllegalArgumentException.class
    })
    public ResponseEntity<ApiError> badRequest(Exception e) {
        String message = e instanceof IllegalArgumentException && e.getMessage() != null
                ? e.getMessage()
                : "参数错误";
        return build(HttpStatus.BAD_REQUEST, 40001, message);
    }

    /**
     * 租户上下文缺失属于部署/编码错误，不是用户输入问题——500，别伪装成 400。
     */
    @ExceptionHandler(TenantNotSetException.class)
    public ResponseEntity<ApiError> tenantMissing(TenantNotSetException e) {
        log.error("租户上下文缺失：{}", e.getMessage());
        return build(HttpStatus.INTERNAL_SERVER_ERROR, 50001, "服务内部错误：未设置租户上下文");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> unexpected(Exception e) {
        String traceId = newTraceId();
        log.error("未处理异常 traceId={}", traceId, e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiError.of(50000, "服务内部错误", traceId));
    }

    private ResponseEntity<ApiError> build(HttpStatus status, int code, String message) {
        return ResponseEntity.status(status).body(ApiError.of(code, message, newTraceId()));
    }

    private String newTraceId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }
}
