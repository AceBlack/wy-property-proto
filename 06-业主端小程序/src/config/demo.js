/**
 * 演示时钟。
 *
 * 与员工端 `05-员工端APP/src/config/personas.js` 的 DEMO 常量逐字一致（2026-10-20 10:00）：
 * mock 里的工单、账单都落在 2026 年 9~10 月，用系统当天算「逾期几天 / 剩余几天」全是错的。
 * 两端各自 hold 一份常量（两个独立工程、不共享运行时），值必须相同 —— 改一处要同步另一处。
 */
export const DEMO = {
  today: '2026-10-20',
  /** 演示时刻：卡在这一天的 10:00 */
  nowTime: '10:00',
  get nowText() {
    return `${this.today} ${this.nowTime}`
  }
}

/** 演示时钟（固定值，截图与断言才稳定） */
export function demoNow() {
  return new Date(`${DEMO.today}T${DEMO.nowTime}:00`)
}

/** 写操作落库用的时间戳 —— 与演示时钟一致，避免出现「10-20 打开、11-01 下单」的怪记录 */
export const stamp = () => DEMO.nowText

/** 只取日期部分（账单账期、预约日期用） */
export const stampDay = () => DEMO.today
