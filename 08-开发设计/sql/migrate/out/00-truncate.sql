SET search_path TO wy, public;

-- 清空业务数据（保留 tenant 与 permission 这类全局表）
TRUNCATE
  wy.bill_share, wy.bill_adjust, wy.bill,
  wy.payment_allocation, wy.payment, wy.prepay_flow, wy.prepay_account,
  wy.invoice_item, wy.invoice,
  wy.deposit_txn, wy.deposit,
  wy.meter_share, wy.meter_reading, wy.meter,
  wy.lease, wy.lessee, wy.house_owner, wy.house, wy.parking, wy.parking_change_log,
  wy.unit, wy.building, wy.community, wy.owner_member, wy.owner_tag_rel, wy.owner_tag, wy.owner,
  wy.fee_item_price, wy.fee_item,
  wy.wo_attachment, wy.wo_log, wy.work_order,
  wy.rectify_order, wy.inspect_task, wy.inspect_plan,
  wy.maintenance_record, wy.asset, wy.asset_category,
  wy.contract, wy.notice,
  wy.expense, wy.expense_category, wy.budget,
  wy.employee_role, wy.role_permission, wy.role, wy.employee, wy.org, wy.payroll
CASCADE;
