SET search_path TO wy, public;
-- fee_item: 10 行
INSERT INTO wy.fee_item (id, tenant_id, item_code, name, category, calc_type, cycle, unit, ref_price, tax_rate, tax_category, direction, meter_type, status, sort) VALUES
  (1, 1, 'FI01', '物业服务费', '常规服务费', '按面积', '月', '元/㎡·月', 2.8000, 6.00, NULL, 'billable', NULL, '启用', 0),
  (2, 1, 'FI02', '电梯运行维护费', '常规服务费', '按面积', '月', '元/㎡·月', 0.5000, 6.00, NULL, 'billable', NULL, '启用', 0),
  (3, 1, 'FI03', '公共能耗分摊', '能耗', '按户', '月', '元/户·月', 30.0000, 6.00, NULL, 'billable', NULL, '启用', 0),
  (4, 1, 'FI04', '生活垃圾清运费', '常规服务费', '按户', '月', '元/户·月', 6.0000, 0.00, NULL, 'billable', NULL, '启用', 0),
  (5, 1, 'FI05', '水费', '能耗', '按用量', '月', '元/吨', 4.2000, 3.00, NULL, 'billable', NULL, '启用', 0),
  (6, 1, 'FI06', '电费', '能耗', '按用量', '月', '元/度', 0.6200, 13.00, NULL, 'billable', NULL, '启用', 0),
  (7, 1, 'FI07', '车位管理服务费', '常规服务费', '按车位', '月', '元/位·月', 120.0000, 6.00, NULL, 'billable', NULL, '启用', 0),
  (8, 1, 'FI08', '装修押金', '押金', '固定', '一次性', '元/次', 3000.0000, 0.00, NULL, 'deposit', NULL, '启用', 0),
  (9, 1, 'FI09', '临时停车费', '经营性', '按次', '按次', '元/小时', 5.0000, 6.00, NULL, 'billable', NULL, '启用', 0),
  (10, 1, 'FI10', '门禁卡工本费', '工本费', '固定', '一次性', '元/张', 20.0000, 13.00, NULL, 'billable', NULL, '启用', 0);
