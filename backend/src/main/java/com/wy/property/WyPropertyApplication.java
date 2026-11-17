package com.wy.property;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 智慧物业后台（单体）。
 *
 * <p>本期只做收费域数据访问层，不引 web starter：没有 Controller，验收靠
 * {@code mvn test} 里对真库的比对测试。</p>
 */
@SpringBootApplication
@MapperScan("com.wy.property.billing")
public class WyPropertyApplication {

    public static void main(String[] args) {
        SpringApplication.run(WyPropertyApplication.class, args);
    }
}
