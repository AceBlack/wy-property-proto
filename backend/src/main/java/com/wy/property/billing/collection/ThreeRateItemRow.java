package com.wy.property.billing.collection;

/** 收费项基础信息（算法需要 calc_type 决定"应收"怎么算）。 */
public class ThreeRateItemRow {

    private Long id;
    private String name;
    private String calcType;
    private String cycle;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getCalcType() {
        return calcType;
    }

    public void setCalcType(String calcType) {
        this.calcType = calcType;
    }

    public String getCycle() {
        return cycle;
    }

    public void setCycle(String cycle) {
        this.cycle = cycle;
    }
}
