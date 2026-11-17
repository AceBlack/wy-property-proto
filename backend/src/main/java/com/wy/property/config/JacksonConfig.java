package com.wy.property.config;

import com.fasterxml.jackson.core.JsonGenerator;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Jackson 配置：BigDecimal 一律平铺输出。
 *
 * <p>不加这条，322.39 可能序列化成 {@code 3.2239E+2}——前端解析没问题，
 * 但报表直接展示时就是一串科学计数法，非常显眼。</p>
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer plainBigDecimal() {
        return builder -> builder.featuresToEnable(JsonGenerator.Feature.WRITE_BIGDECIMAL_AS_PLAIN);
    }
}
