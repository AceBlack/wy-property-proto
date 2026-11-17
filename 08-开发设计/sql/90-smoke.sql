-- ============================================================
-- 90 · 约束冒烟：每条都应该被数据库拒绝
-- 判据：全部显示 ✅ 才算通过；出现 ❌ 说明约束没生效
-- 安全：整个脚本在事务里跑，最后 ROLLBACK，不污染数据
-- 前置：需先执行 30-seed-minimal.sql
-- ============================================================
SET search_path TO wy, public;

BEGIN;
SET LOCAL app.tenant_id = '1';
-- 关键：切到非超级用户。超级用户永远绕过 RLS（FORCE 也拦不住），
-- 用 wy 跑这个脚本，第 11~13 条会全部假通过。
SET LOCAL ROLE wy_app;

-- ------------------------------------------------------------
-- 1. 账单金额不平衡：payable ≠ amount − waive + late
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO bill (tenant_id, bill_no, community_id, house_id, item_id, period,
                      quantity, unit, price, amount, waive_amount, late_fee, payable,
                      item_name, status, due_date)
    SELECT 1, 'BL_BAD1', 'P01', 'H0101101', f.id, '2026-11',
           100, '元/㎡·月', 2.80, 280.00, 0, 0, 999.00,
           '物业服务费', '待缴', '2026-12-15'
    FROM fee_item f WHERE f.tenant_id=1 AND f.item_code='FI01';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 1 金额不平衡被拒'; ELSE RAISE EXCEPTION '❌ 1 金额不平衡竟然写入成功'; END IF;
END $$;

-- ------------------------------------------------------------
-- 2. 已收超过应缴
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO bill (tenant_id, bill_no, community_id, house_id, item_id, period,
                      quantity, unit, price, amount, waive_amount, late_fee, payable, paid_amount,
                      item_name, status, due_date)
    SELECT 1, 'BL_BAD2', 'P01', 'H0101101', f.id, '2026-12',
           100, '元/㎡·月', 2.80, 280.00, 0, 0, 280.00, 300.00,
           '物业服务费', '待缴', '2027-01-15'
    FROM fee_item f WHERE f.tenant_id=1 AND f.item_code='FI01';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 2 已收超应缴被拒'; ELSE RAISE EXCEPTION '❌ 2 已收超应缴竟然写入成功'; END IF;
END $$;

-- ------------------------------------------------------------
-- 3. 账期格式非法
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO bill (tenant_id, bill_no, community_id, house_id, item_id, period,
                      quantity, unit, price, amount, payable, item_name, status, due_date)
    SELECT 1, 'BL_BAD3', 'P01', 'H0101101', f.id, '2026-13',
           100, '元/㎡·月', 2.80, 280.00, 280.00, '物业服务费', '待缴', '2026-12-15'
    FROM fee_item f WHERE f.tenant_id=1 AND f.item_code='FI01';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 3 非法账期被拒'; ELSE RAISE EXCEPTION '❌ 3 非法账期竟然写入成功'; END IF;
END $$;

-- ------------------------------------------------------------
-- 4. 账单同时挂房屋和车位（应二选一）
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO bill (tenant_id, bill_no, community_id, house_id, parking_id, item_id, period,
                      quantity, unit, price, amount, payable, item_name, status, due_date)
    SELECT 1, 'BL_BAD4', 'P01', 'H0101101', 'PK_NOT_EXIST', f.id, '2026-13',
           100, '元/㎡·月', 2.80, 280.00, 280.00, '物业服务费', '待缴', '2026-12-15'
    FROM fee_item f WHERE f.tenant_id=1 AND f.item_code='FI01';
  EXCEPTION WHEN check_violation OR foreign_key_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 4 房屋+车位同时挂被拒'; ELSE RAISE EXCEPTION '❌ 4 同时挂竟然写入成功'; END IF;
END $$;

-- ------------------------------------------------------------
-- 5. 同房同科目同账期重复开账
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO bill (tenant_id, bill_no, community_id, house_id, item_id, period,
                      quantity, unit, price, amount, payable, item_name, status, due_date)
    SELECT 1, 'BL_BAD5', 'P01', 'H0101101', f.id, '2026-10',
           115.14, '元/㎡·月', 2.80, 322.39, 322.39, '物业服务费', '待缴', '2026-11-15'
    FROM fee_item f WHERE f.tenant_id=1 AND f.item_code='FI01';
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 5 重复开账被拒（唯一索引生效）'; ELSE RAISE EXCEPTION '❌ 5 重复开账竟然成功'; END IF;
END $$;

-- ------------------------------------------------------------
-- 6. 支付回调重复：相同 channel_txn_no 第二次入账
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  INSERT INTO payment (tenant_id, pay_no, community_id, amount, method, channel, channel_txn_no,
                       paid_at, status)
  VALUES (1, 'PY_IDEM1', 'P01', 100.00, '微信', '微信', 'WX_TXN_001', now(), '正常');

  BEGIN
    INSERT INTO payment (tenant_id, pay_no, community_id, amount, method, channel, channel_txn_no,
                         paid_at, status)
    VALUES (1, 'PY_IDEM2', 'P01', 100.00, '微信', '微信', 'WX_TXN_001', now(), '正常');
  EXCEPTION WHEN unique_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 6 支付回调重发被拒（幂等索引生效）'; ELSE RAISE EXCEPTION '❌ 6 同一笔支付入账两次'; END IF;
END $$;

-- ------------------------------------------------------------
-- 7. 修改收款金额（流水不可变）
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    UPDATE payment SET amount = 999.00 WHERE tenant_id=1 AND pay_no='PY000001';
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 7 改收款金额被拒（流水不可变）'; ELSE RAISE EXCEPTION '❌ 7 收款金额被改了'; END IF;
END $$;

-- ------------------------------------------------------------
-- 8. 押金扣款不写原因
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO deposit_txn (tenant_id, deposit_id, direction, amount, occurred_at, reason)
    SELECT 1, d.id, 'D', 100.00, now(), '扣'
    FROM deposit d WHERE d.tenant_id=1 AND d.deposit_no='DP000001';
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 8 押金扣款无原因被拒'; ELSE RAISE EXCEPTION '❌ 8 押金扣款没写原因也成功了'; END IF;
END $$;

-- ------------------------------------------------------------
-- 9. 同一套房的有效租约时间重叠
-- ------------------------------------------------------------
DO $$
DECLARE v_lessee bigint; ok boolean := false;
BEGIN
  INSERT INTO lessee (tenant_id, lessee_type, name, phone, status)
  VALUES (1, '个人', '李四', '13900000002', '在租')
  RETURNING lessee_id INTO v_lessee;

  INSERT INTO lease (tenant_id, lease_no, house_id, lessee_id, owner_id,
                     start_date, end_date, status)
  VALUES (1, 'LS0001', 'H0101102', v_lessee, 'OW00001', '2026-01-01', '2026-12-31', '生效');

  BEGIN
    INSERT INTO lease (tenant_id, lease_no, house_id, lessee_id, owner_id,
                       start_date, end_date, status)
    VALUES (1, 'LS0002', 'H0101102', v_lessee, 'OW00001', '2026-06-01', '2027-05-31', '生效');
  EXCEPTION WHEN exclusion_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 9 租约期重叠被拒（排他约束生效）'; ELSE RAISE EXCEPTION '❌ 9 一房两租竟然成功'; END IF;
END $$;

-- ------------------------------------------------------------
-- 10. 公司级费用挂了项目
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO expense (tenant_id, community_id, level, category_id, amount, period, source, status)
    VALUES (1, 'P01', 'company', 'C01', 1000.00, '2026-10', '手工', '已付款');
  EXCEPTION WHEN check_violation THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 10 公司级费用挂项目被拒'; ELSE RAISE EXCEPTION '❌ 10 公司级挂了项目还不报错'; END IF;
END $$;

-- ------------------------------------------------------------
-- 11. 未设租户直接查（应报错，不是返回空集）
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM set_config('app.tenant_id', '', true);   -- 清空
    PERFORM count(*) FROM bill;
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 11 未设租户被拒（不返回空集）'; ELSE RAISE EXCEPTION '❌ 11 未设租户竟然能查'; END IF;
  PERFORM set_config('app.tenant_id', '1', true);
END $$;

-- ------------------------------------------------------------
-- 12. 跨租户：A 租户看不到 B 租户的数据
-- ------------------------------------------------------------
DO $$
DECLARE v_cnt int; ok boolean := false;
BEGIN
  -- 造一个租户 2 的项目与房屋（在事务里，最后回滚）
  INSERT INTO tenant (id, code, name) VALUES (2, 'DEMO2', '另一家物业') ON CONFLICT DO NOTHING;

  PERFORM set_config('app.tenant_id', '2', true);
  INSERT INTO community (tenant_id, community_id, name, build_area, house_count)
  VALUES (2, 'P02', '别家小区', 100, 1) ON CONFLICT DO NOTHING;
  INSERT INTO house (tenant_id, house_id, community_id, building_id, unit_id, room,
                     full_name, build_area, usage_type)
  VALUES (2, 'HX001', 'P02', 'BX', 'UX', '101', '别家/1栋/101', 80, '住宅')
  ON CONFLICT DO NOTHING;

  -- 切回租户 1，查别家的房
  PERFORM set_config('app.tenant_id', '1', true);
  SELECT count(*) INTO v_cnt FROM house WHERE house_id = 'HX001';
  IF v_cnt = 0 THEN ok := true; END IF;

  IF ok THEN RAISE NOTICE '✅ 12 跨租户读不到（0 行）'; ELSE RAISE EXCEPTION '❌ 12 看到别家数据了'; END IF;
END $$;

-- ------------------------------------------------------------
-- 13. 跨租户写入：往别家租户插数据
-- ------------------------------------------------------------
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO house (tenant_id, house_id, community_id, building_id, unit_id, room,
                       full_name, build_area, usage_type)
    VALUES (2, 'HX002', 'P02', 'BX', 'UX', '102', '别家/1栋/102', 80, '住宅');
  EXCEPTION WHEN insufficient_privilege THEN ok := true;
  END;
  IF ok THEN RAISE NOTICE '✅ 13 跨租户写入被拒（WITH CHECK 生效）'; ELSE RAISE EXCEPTION '❌ 13 往别家租户插数据成功了'; END IF;
END $$;

\echo ''
\echo '======== 冒烟结束：以上全部 ✅ 才算通过 ========'

ROLLBACK;
