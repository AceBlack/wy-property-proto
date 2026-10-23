# -*- coding: utf-8 -*-
"""三大升级专题的详细设计（HTML 片段）"""

REPAIR = """
<div class="tp">
  <div class="tp-lead">原系统问题：报修只有「报修待办 / 已办 / 工单池 / 回访」几个后台页面，业主端入口弱，
  没有服务目录、没有收费标准、派单只能人工指派。入户收费维修与公共免费维修走同一套逻辑，导致收不上钱也说不清钱。</div>

  <h4>1. 业务模型：两类工单必须分开</h4>
  <table class="tbl">
    <tr><th>维度</th><th>公共区域维修（免费）</th><th>入户维修（收费）</th></tr>
    <tr><td>发起位置</td><td>楼栋/单元/园区公共部位，或业主代报</td><td>业主房屋内，需精确到房号</td></tr>
    <tr><td>费用承担</td><td>物业（计入运营成本）</td><td>业主（服务账单）</td></tr>
    <tr><td>是否需要业主确认</td><td>不需要（可公示）</td><td>必须：报价确认 → 完工确认 → 付款</td></tr>
    <tr><td>派单对象</td><td>工程/保洁/绿化班组</td><td>维修技工（需技能匹配）</td></tr>
    <tr><td>材料</td><td>走领用出库（库存）</td><td>走销售出库（计入账单）</td></tr>
    <tr><td>统计口径</td><td>公共维修成本、频次</td><td>服务收入、毛利、满意度</td></tr>
  </table>

  <h4>2. 服务目录与收费标准</h4>
  <div class="tree">
    <div class="tn">服务分类（一级）
      <div class="tn">公共区域 · 免费
        <div class="tl">路灯不亮 / 楼道灯 / 电梯困人 / 路面破损 / 绿化养护 / 管道堵塞（公共段）</div>
      </div>
      <div class="tn">入户维修 · 收费
        <div class="tl">水电维修 / 门窗五金 / 家电安装 / 防水堵漏 / 开锁换锁 / 空调清洗 / 管道疏通（户内段）</div>
      </div>
    </div>
  </div>
  <table class="tbl">
    <tr><th>服务项目字段</th><th>说明</th></tr>
    <tr><td>基础信息</td><td>名称、分类、适用业态（住宅/商铺/车位）、是否收费、标准工时、所需技能标签</td></tr>
    <tr><td>标准工序</td><td>检查项清单（到场检查 → 施工 → 验收），保证服务质量一致</td></tr>
    <tr><td>关联材料</td><td>常用配件与建议数量，工单自动带出，价格取自材料价格库</td></tr>
    <tr><td>定价模型</td><td>起步价（含首小时）+ 工时费/小时 + 材料费 + 夜间/节假日加价系数 + 费用上限</td></tr>
    <tr><td>版本与生效期</td><td>调价不影响历史工单；改价需留痕并通知在途工单</td></tr>
    <tr><td>示意图与说明</td><td>业主端展示用的图文说明，降低预期偏差</td></tr>
  </table>
  <div class="note"><b>关键规则：</b>收费项目在业主提交时必须给出
  <b>费用预估区间</b>（如「预计 80~150 元，含上门费 30 元」）并弹出告知书；实际费用超出预估 20% 需业主二次确认，否则按预估价结算。</div>

  <h4>3. 主流程</h4>
  <div class="flow">
    <div class="fs"><b>1</b><span>业主报修</span><i>小程序选分类/项目 · 图文 · 定位 · 预约时段</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>2</b><span>派单</span><i>后台指派 / 自动派单 / 抢单池</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>3</b><span>上门处理</span><i>APP 接单 · 到场打卡 · 拍照 · 材料登记</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>4</b><span>完工反馈</span><i>结果上传 · 费用明细 · 业主确认</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>5</b><span>评价回访</span><i>满意度 · 差评自动回访</i></div>
  </div>

  <h4>4. 派单：三种模式并存</h4>
  <table class="tbl">
    <tr><th>模式</th><th>触发方式</th><th>适用场景</th><th>优点</th><th>风险与对策</th></tr>
    <tr><td>后台指派</td><td>客服/主管手动选人</td><td>投诉件、VIP、复杂件</td><td>可控、责任清晰</td><td>依赖人力 → 仅作兜底</td></tr>
    <tr><td>自动派单</td><td>规则引擎：技能标签 + 责任区域 + 当前负载 + 距离</td><td>标准工单、量大件</td><td>响应快、负载均衡</td><td>规则难调 → 权重可配置 + 人工可改派</td></tr>
    <tr><td>抢单池</td><td>员工端主动抢，限时（如 5 分钟）</td><td>非紧急、激励导向</td><td>提高积极性</td><td>挑肥拣瘦 → 超时未抢自动转派单并计入考核</td></tr>
  </table>
  <div class="note"><b>建议组合：</b>默认自动派单 → 15 分钟无人接单自动进抢单池 → 再超时升级为主管指派并预警。
  三种模式按「项目 + 工单类型」可配置，不必全公司一刀切。</div>

  <h4>5. 状态机（前后端与测试用例的共同依据）</h4>
  <div class="sm">
    <span class="st">待受理</span>→<span class="st">待派单</span>→<span class="st">待接单</span>→<span class="st">处理中</span>→<span class="st">待验收</span>→<span class="st">已完成</span>→<span class="st">已评价</span>→<span class="st">已关闭</span>
  </div>
  <table class="tbl">
    <tr><th>状态</th><th>进入条件</th><th>可执行动作</th><th>超时处理</th></tr>
    <tr><td>待受理</td><td>业主提交</td><td>受理 / 驳回（非物业责任）/ 改判类别</td><td>30 分钟未受理提醒客服主管</td></tr>
    <tr><td>待派单</td><td>受理通过</td><td>指派 / 自动派单 / 转入抢单池</td><td>SLA 响应时限倒计时</td></tr>
    <tr><td>待接单</td><td>已派给具体人或入池</td><td>接单 / 拒单（需理由）/ 转单</td><td>超时自动改派 + 扣分</td></tr>
    <tr><td>处理中</td><td>接单后到场打卡</td><td>过程记录 / 追加材料 / 申请延期</td><td>到场时限、完成时限双重计时</td></tr>
    <tr><td>待验收</td><td>维修完工提交</td><td>业主确认 / 业主驳回（返工）</td><td>48 小时未确认自动完成并提示</td></tr>
    <tr><td>已完成</td><td>业主确认或超时</td><td>生成服务账单 / 评价</td><td>—</td></tr>
    <tr><td>已评价 / 已关闭</td><td>评价提交</td><td>差评自动开回访工单</td><td>回访 72 小时内完成</td></tr>
    <tr><td>已取消</td><td>业主取消 / 无法处理 / 重复单</td><td>合并到主单 / 记录原因</td><td>取消需填原因并留痕</td></tr>
  </table>

  <h4>6. 收费结算路径（入户维修）</h4>
  <div class="flow">
    <div class="fs"><b>A</b><span>工单完工</span><i>材料 + 工时 + 加价项</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>B</b><span>生成服务账单</span><i>与物业费账单同结构，来源=维修</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>C</b><span>业主支付</span><i>小程序在线付 / 前台收银台 / 挂账</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>D</b><span>开票与分账</span><i>可选开票；技工提成按规则结算</i></div>
  </div>
  <div class="note">挂账场景（业主选择随物业费一起交）必须能自动并入下一次物业费账单，
  并与催缴、台账打通，否则会变成一笔糊涂账。</div>

  <h4>7. 核心字段（工单表）</h4>
  <div class="kv">
    <span>工单号</span><span>来源（小程序/电话/前台/巡检/IoT告警/代客）</span><span>类别（公共/入户）</span>
    <span>服务项目</span><span>房屋ID 或 公共位置</span><span>业主与联系电话</span><span>描述与图片/视频</span>
    <span>预约时段</span><span>技能要求</span><span>优先级（紧急/高/普通）</span><span>责任人与协同人</span>
    <span>SLA 模板</span><span>状态与状态时间轴</span><span>预估费用 / 实际费用</span><span>材料清单</span>
    <span>评价星级与标签</span><span>关联账单号</span><span>关联设备（若有）</span>
  </div>

  <h4>8. 接口清单（建议）</h4>
  <div class="api">
    <div><code>GET  /api/repair/catalog</code> 服务目录（业主端按业态过滤）</div>
    <div><code>POST /api/repair/order</code> 创建工单</div>
    <div><code>POST /api/repair/order/{id}/accept</code> 受理 / 驳回 / 改判</div>
    <div><code>POST /api/repair/order/{id}/dispatch</code> 派单（manual / auto / pool）</div>
    <div><code>POST /api/repair/order/{id}/take</code> 抢单 / 接单 / 拒单 / 转单</div>
    <div><code>POST /api/repair/order/{id}/arrive</code> 到场打卡（定位 + 拍照）</div>
    <div><code>POST /api/repair/order/{id}/finish</code> 完工提交（结果 + 材料 + 费用）</div>
    <div><code>POST /api/repair/order/{id}/confirm</code> 业主验收确认</div>
    <div><code>POST /api/repair/order/{id}/bill</code> 生成服务账单</div>
    <div><code>POST /api/repair/order/{id}/evaluate</code> 评价（触发回访规则）</div>
  </div>
</div>
"""

CASHIER = """
<div class="tp">
  <div class="tp-lead">原系统问题：收费入口按「业务」拆成房屋收费 / 商铺收费 / 车位收费 / 合同收费四个页面，
  前台收一笔钱要在多个菜单之间跳；且只能按房号查，一人多套房的业主没法一次结清。
  原型的「房屋缴费收银」已经做成按房屋的两栏式收银台，本次升级补上<b>按业主聚合</b>这一层。</div>

  <h4>1. 收银台定位</h4>
  <p>使用者：前台客服 / 收费员（不是财务、不是业主）。核心诉求：<b>一个人、一套房或多套房、一次结清、立刻出票</b>。
  设计目标：单笔收款 ≤ 30 秒，常用操作 ≤ 3 步。</p>

  <h4>2. 检索方式（任一条件即可）</h4>
  <table class="tbl">
    <tr><th>检索条件</th><th>匹配逻辑</th><th>说明</th></tr>
    <tr><td>房号</td><td>1-2-101 / 1栋2单元101 模糊</td><td>最常用，支持楼栋-单元-房号三级联想</td></tr>
    <tr><td>业主姓名</td><td>姓名模糊匹配（含曾用名）</td><td>重名时列表选择</td></tr>
    <tr><td>手机号</td><td>精确 + 后四位模糊</td><td>业主报手机号最方便</td></tr>
    <tr><td>身份证号</td><td>精确匹配（后 6 位可查）</td><td>办理产权/过户相关业务时用</td></tr>
    <tr><td>车位号</td><td>车位编号 → 反查业主</td><td>业主来交车位费但说不清房号</td></tr>
  </table>
  <div class="note"><b>命中结果：</b>返回「业主卡片」——姓名、手机号、名下 <b>N 套房产 + M 个车位</b>，
  每套显示：房号 / 面积 / 当前欠费 / 逾期天数。这是原系统完全缺失的一层。</div>

  <h4>3. 页面布局（三栏）</h4>
  <div class="lay">
    <div class="lc"><b>左栏 · 检索与资产</b>
      <div class="li">搜索框（房号/姓名/手机/身份证/车位）</div>
      <div class="li">业主卡片：姓名 · 手机 · 客户号</div>
      <div class="li">资产列表（可多选）：<br>· 房产 A 1-2-101　欠费 405.28<br>· 房产 B 3-1-502　欠费 1,210.00<br>· 车位 067　月卡到期 2026-11-30</div>
      <div class="li">预存余额：320.00（可用）</div>
    </div>
    <div class="lc"><b>中栏 · 账单勾选</b>
      <div class="li">按资产分组的待缴账单表</div>
      <div class="li">列：账单号 / 科目 / 所属期 / 应收 / 逾期天 / 欠费 / 状态</div>
      <div class="li">操作：全选未缴 · 清空勾选 · 单笔勾选</div>
      <div class="li">支持跨房产同时勾选（合并结算的核心）</div>
    </div>
    <div class="lc"><b>右栏 · 结算</b>
      <div class="li">应收合计 / 已选 N 笔</div>
      <div class="li">折扣：折扣券 · 减免（需授权）</div>
      <div class="li">预存抵扣：开关 + 可用余额</div>
      <div class="li">实收金额（可改，改需原因）</div>
      <div class="li">支付方式：微信 / 支付宝 / 扫码枪 / POS / 现金 / 挂账</div>
      <div class="li">收费备注</div>
      <div class="li"><b>确认收款</b> · 扫业主付款码 · 生成待缴码</div>
    </div>
  </div>

  <h4>4. 关键业务规则</h4>
  <table class="tbl">
    <tr><th>规则</th><th>处理</th></tr>
    <tr><td>合并收费</td><td>一单可含多套房的账单，票据按房号分行打印，收款流水按房号拆分入账</td></tr>
    <tr><td>部分收款</td><td>允许只付部分金额；冲抵顺序默认「最早账期优先」，可按项目配置为「按比例」</td></tr>
    <tr><td>一单多支付方式</td><td>如 300 微信 + 105.28 现金，需分别出流水但对业主只出一张收据</td></tr>
    <tr><td>预存抵扣</td><td>默认自动抵扣当期账单；业主可申请关闭；抵扣部分也计入收缴率</td></tr>
    <tr><td>折扣与减免</td><td>结算时应用需权限；超过阈值（如 500 元或 20%）需上级授权</td></tr>
    <tr><td>作废与红冲</td><td>走「取消费用审核」，保留原因、操作人、凭证号，不可物理删除</td></tr>
    <tr><td>挂账</td><td>未付部分自动转欠费进入催缴池</td></tr>
    <tr><td>票据</td><td>收款成功即出收据（热敏小票 + 电子收据推送业主微信）</td></tr>
  </table>

  <h4>5. 收款状态机</h4>
  <div class="sm">
    <span class="st">待缴</span>→<span class="st">部分缴纳</span>→<span class="st">已缴</span>
    <span class="stx">作废/红冲</span><span class="stx">退费</span>
  </div>

  <h4>6. 交班对账（前台刚需，原系统与原型都没有）</h4>
  <p>收费员下班前一键生成：现金 / POS / 微信 / 支付宝 分类汇总 + 票据起止号 + 作废笔数，
  与渠道账单自动核对，长短款登记并上报。这一块不做，前台每天手工点数，是最大的效率黑洞。</p>

  <h4>7. 接口清单（建议）</h4>
  <div class="api">
    <div><code>GET  /api/cashier/search?keyword=</code> 多条件检索，返回业主 + 资产列表</div>
    <div><code>GET  /api/cashier/owner/{id}/assets</code> 业主名下全部房产与车位</div>
    <div><code>GET  /api/cashier/bills?assetIds=</code> 批量查询待缴账单</div>
    <div><code>POST /api/cashier/calc</code> 试算（折扣 / 预存抵扣 / 实收）</div>
    <div><code>POST /api/cashier/pay</code> 收款（多支付方式 + 多资产）</div>
    <div><code>POST /api/cashier/qrcode</code> 生成待缴码</div>
    <div><code>POST /api/cashier/receipt/print</code> 打印 / 补打 / 批量打印</div>
    <div><code>GET  /api/cashier/shift/summary</code> 交班对账汇总</div>
  </div>
</div>
"""

PARKING = """
<div class="tp">
  <div class="tp-lead">现状：停车场的管理权仍在车牌识别厂商的软件里（计费、白名单、道闸都由厂商管），
  我方平台只做「同步」。所以这一块的设计重点不是重做停车场管理，而是<b>建一层适配 + 做好双向同步与一致性保障</b>，
  尤其是业主最高频的诉求：<b>换车牌绑定</b>。</div>

  <h4>1. 集成架构</h4>
  <div class="arch">
    <div class="abox"><b>我方平台</b><br>车位档案 · 业主/车辆 · 车位管理费 · 月卡 · 换绑审批</div>
    <div class="amid">⇄ 适配层（Adapters）<br>协议转换 · 幂等 · 重试 · 日志</div>
    <div class="abox"><b>厂商车场系统</b><br>捷顺 / 科拓 / 臻识 / 华夏 …<br>白名单 · 计费 · 道闸 · 进出场</div>
  </div>
  <div class="note">关键设计：<b>厂商差异全部收敛在适配层</b>，业务代码只见统一模型。换厂商 = 加一个 Adapter，不动业务。</div>

  <h4>2. 双向数据流</h4>
  <table class="tbl">
    <tr><th>方向</th><th>数据</th><th>触发方式</th><th>一致性要求</th></tr>
    <tr><td>我方 → 车场<br>（下行）</td><td>车位—车牌绑定/解绑、月卡有效期、黑名单、临时授权</td><td>业务事件实时下发</td><td>强一致：必须拿到厂商回执，失败进重试队列</td></tr>
    <tr><td>车场 → 我方<br>（上行）</td><td>进出场记录、临停订单与支付、设备状态、异常告警</td><td>回调推送 + 定时拉取补漏</td><td>最终一致：允许分钟级延迟，需对账</td></tr>
  </table>

  <h4>3. 核心场景：业主自助换绑车牌（最高频）</h4>
  <div class="flow">
    <div class="fs"><b>1</b><span>业主提交</span><i>小程序选车位 · 填新车牌 · 上传行驶证</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>2</b><span>风控校验</span><i>新牌是否已绑他位 · 该位车数是否超限 · 欠费拦截</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>3</b><span>物业审核</span><i>可配置自动审（低风险）或人工审</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>4</b><span>下发车场</span><i>适配层调用厂商解绑旧牌 + 绑定新牌</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>5</b><span>回写与通知</span><i>成功后更新状态并推送业主；失败重试 + 告警责任人</i></div>
  </div>
  <div class="note"><b>必须处理的异常：</b>① 厂商返回超时但可能已生效（用幂等 requestId 查询确认，不能盲目重试造成重复绑定）；
  ② 部分成功（旧牌解绑成功、新牌绑定失败）→ 自动回滚并告警；
  ③ 车主名下多车位只改其中一个（要精确到车位，不能全量覆盖）。</div>

  <h4>4. 车位管理费到期同步</h4>
  <div class="sm">
    <span class="st">T-30 预警</span>→<span class="st">T-15 / T-7 提醒</span>→<span class="st">业主缴费</span>→<span class="st">延长有效期</span>→<span class="st">下发车场</span>→<span class="st">回执确认</span>
  </div>
  <table class="tbl">
    <tr><th>环节</th><th>规则</th></tr>
    <tr><td>到期视图</td><td>按「30 天内 / 15 天内 / 7 天内 / 已过期」分档；支持按楼栋、车位类型筛选</td></tr>
    <tr><td>缴费渠道</td><td>业主小程序自助续费 · 前台收银台代收（车位号反查业主）</td></tr>
    <tr><td>有效期计算</td><td>续费起点 = max(原到期日, 今日)，避免提前续费损失天数</td></tr>
    <tr><td>下发</td><td>支付成功事件触发，实时下发新有效期；失败进重试队列</td></tr>
    <tr><td>过期策略</td><td>可配置：转临停计费 / 限制放行 / 仅提醒不拦截</td></tr>
  </table>

  <h4>5. 字段映射（我方 ↔ 厂商）</h4>
  <table class="tbl">
    <tr><th>我方</th><th>厂商（示例）</th><th>说明</th></tr>
    <tr><td>parkingSpaceNo 车位编号</td><td>spaceNo / parkNo</td><td>主键，需双向唯一</td></tr>
    <tr><td>plateNo 车牌</td><td>carNo / plateNo</td><td>新能源车牌需支持 8 位</td></tr>
    <tr><td>ownerId 车主</td><td>userId / custNo</td><td>我方为准，厂商只存关联</td></tr>
    <tr><td>validFrom / validTo</td><td>startTime / endTime</td><td>精确到分钟，时区统一</td></tr>
    <tr><td>cardType 月卡类型</td><td>cardType / monthlyType</td><td>需映射字典（A 卡/B 卡/子母车位）</td></tr>
    <tr><td>status 状态</td><td>status / enabled</td><td>正常 / 欠费停用 / 黑名单 / 已退</td></tr>
  </table>

  <h4>6. 一致性保障（不能省）</h4>
  <div class="kv">
    <span>每日全量对账：我方绑定关系 vs 车场白名单，差异清单自动修复或告警</span>
    <span>下发幂等：每请求带 requestId，厂商重复调用不产生副作用</span>
    <span>重试策略：指数退避，最多 N 次，超过则人工工单</span>
    <span>厂商离线降级：本地记录变更，恢复后自动补发</span>
    <span>操作留痕：谁在何时改了哪个车位的哪块车牌，全部可追溯</span>
    <span>临停收入对账：我方账单 vs 厂商账单，差异超阈值告警</span>
  </div>

  <h4>7. 接口清单（适配层）</h4>
  <div class="api">
    <div><code>POST /api/parking/adapter/{vendor}/bind</code> 绑定车位—车牌</div>
    <div><code>POST /api/parking/adapter/{vendor}/unbind</code> 解绑</div>
    <div><code>POST /api/parking/adapter/{vendor}/monthcard/renew</code> 月卡续期（有效期下发）</div>
    <div><code>POST /api/parking/adapter/{vendor}/blacklist</code> 黑名单同步</div>
    <div><code>GET  /api/parking/adapter/{vendor}/inout</code> 拉取进出场（补漏）</div>
    <div><code>POST /api/parking/callback/{vendor}</code> 统一回调入口（进出场/支付/状态/告警）</div>
    <div><code>POST /api/parking/sync/retry</code> 失败重试队列（人工可触发）</div>
    <div><code>GET  /api/parking/reconcile/diff</code> 对账差异清单</div>
  </div>
</div>
"""

INSPECT = """
<div class="tp">
  <div class="tp-lead">原系统问题：巡检计划本质是<b>一套给保安用的巡更工具</b>（巡检点/路线/计划/任务/项目/明细），
  只能"打卡证明我来过"，过程无记录、结果无评判。而现实是保洁、保安、工程、绿化、客服、主管、经理
  <b>每类岗位都有自己的周期性日常工作</b>，目前全靠微信群和纸质表格在跑。<br>
  <b>本次升级的核心判断：巡检不是一个功能模块，而是一个「计划任务引擎」。</b>
  四类岗位共用同一套引擎，差异只在两处——<b>到位方式</b>（扫码/选区/设备码）与<b>执行表单</b>（按岗位自定义）。
  品质管理也不是另建一套，而是同一引擎上跑的「检查型任务」，只不过它的检查对象是别人的执行记录。</div>

  <h4>1. 三层角色模型：基层执行 · 中层检查 · 高层监督</h4>
  <table class="tbl">
    <tr><th>层级</th><th>典型岗位</th><th>做什么</th><th>产出物</th><th>典型周期</th></tr>
    <tr><td><b>基层 · 执行</b></td><td>保安、保洁、工程技工、绿化、客服</td>
        <td>按主管排的计划，在责任区域内完成标准动作：拍照上传 / 扫码打卡 / 表单填报；发现问题时在任务窗口直接上报</td>
        <td>执行记录（时间+位置+表单+照片）+ 异常上报（转工单）</td><td>日 / 每班次</td></tr>
    <tr><td><b>中层 · 检查</b></td><td>班长、主管、工程主管、品质专员</td>
        <td>制定与调整计划、指派到人、按比例抽查基层执行结果、现场复核、按评分卡打分、开整改单</td>
        <td>检查记录 + 评分 + 整改单 + 合格率</td><td>周 / 日抽查</td></tr>
    <tr><td><b>高层 · 监督</b></td><td>项目经理、区域总监、公司品质部</td>
        <td>周期巡场、看辖区汇总与红黑榜、发起专项检查（消防/特种设备）、签发整改令、签字确认</td>
        <td>监督记录 + 整改令 + 考核结论</td><td>月 / 季</td></tr>
  </table>
  <div class="note"><b>为什么三层要放进同一套引擎：</b>中层的"检查"和高层的"监督"，
  本质上也是<b>一个带表单、带周期、落到人的任务</b>，只是它的被执行对象是人而不是物。
  如果给每层各做一套功能，就会出现三套计划配置、三套表单、三套统计——维护成本翻三倍，数据还串不起来。
  统一之后：<b>一个计划配置端、一个执行端、一张看板</b>，靠"任务类型 + 表单模板"区分。</div>

  <h4>2. 三类执行载体：同一引擎，三种落地形态</h4>
  <table class="tbl">
    <tr><th>维度</th><th>保洁</th><th>保安</th><th>工程 / 设备巡检</th></tr>
    <tr><td>到位方式</td><td>责任区域打卡（选区 + GPS），无需贴码</td><td><b>二维码 / NFC 点位扫码</b>（防远程作弊）</td><td><b>设备二维码扫码</b>（带出设备台账）</td></tr>
    <tr><td>执行内容</td><td>按标准环节<b>逐项拍照 + 简短描述</b>；无异常一键「正常」</td>
        <td>按点位标准流程<b>拍照上传</b>；漏点自动提醒与补检</td>
        <td>按固定检查模板<b>填数据</b>（数值/状态/异常描述/拍照）</td></tr>
    <tr><td>标准环节示例</td><td>大堂 · 楼梯 · 电梯轿厢 · 扶梯 · 公厕 · 垃圾桶点 · 地下车库</td>
        <td>门岗 · 单元门 · 消防通道 · 车库入口 · 周界 · 监控室 · 天台</td>
        <td>配电房 · 水泵房 · 电梯机房 · 消防泵 · 二次供水 · 发电机</td></tr>
    <tr><td>合格判定</td><td>事后由主管抽查评分（目检）</td><td>事后由主管抽查评分（目检）</td>
        <td><b>阈值自动判定</b>：数值超上下限即判不合格并自动开告警工单</td></tr>
    <tr><td>频次</td><td>日 / 多班次（早中晚）</td><td>每班次循环（如 2 小时一轮）</td><td>日 / 周 / 月 / 季（按设备等级）</td></tr>
    <tr><td>异常出口</td><td>上报 → 报修工单</td><td>上报 → 报修工单 / 安防事件</td><td>超阈值 → 自动告警工单（无需人工判断）</td></tr>
  </table>
  <div class="note"><b>保洁的关键设计：</b>保洁每天要跑十几个点位，如果每个点都要填表，一天两小时全花在手机上。
  所以保洁端做成<b>「环节卡片流」</b>——每个环节一张卡，正常就点「正常」（自动带时间戳与位置，可批量），
  有问题才拍照写描述。<b>99% 的操作应该是 1 秒完成，1% 的问题才需要详细记录。</b></div>

  <h4>3. 四层数据模型（研发的建表依据）</h4>
  <div class="tree">
    <div class="tn"><b>① 计划模板 PlanTemplate</b> —— 由公司/项目统一定义，可复用
      <div class="tl">岗位类型 · 执行表单（引用表单模板） · 标准环节 · 建议时长 · 拍照要求 · 合格标准</div>
    </div>
    <div class="tn"><b>② 计划 Plan</b> —— 模板落到具体范围，绑定周期与责任人
      <div class="tl">引用模板 · 责任区域（楼栋/楼层/公区/车库） · 执行人/班组/岗位/外包方 · 周期规则 · 生效期 · 状态</div>
    </div>
    <div class="tn"><b>③ 任务实例 Task</b> —— 周期引擎按时生成的一次具体任务
      <div class="tl">所属计划 · 计划执行时间窗 · 实际执行人（排班联动后确定） · 状态 · SLA 时限 · 提醒记录</div>
    </div>
    <div class="tn"><b>④ 执行记录 TaskRecord</b> —— 员工提交的证据
      <div class="tl">表单数据（JSON） · 照片/视频（含水印） · 定位与时间 · 设备ID（若设备巡检） · 异常上报关联工单号</div>
    </div>
  </div>
  <div class="note"><b>为什么模板和计划要分两层：</b>「保洁日检」这个模板全公司通用，
  但 1 号楼归张三、2 号楼归李四、外包方负责地下车库——这些是计划层的事。
  分两层之后，公司改一次标准，所有项目自动同步；项目调人调区域，不影响标准本身。</div>

  <h4>4. 表单引擎：按岗位自定义（灵活性的关键）</h4>
  <table class="tbl">
    <tr><th>能力</th><th>说明</th></tr>
    <tr><td>字段类型</td><td>单行文本 / 多行文本 / 数字（可设上下限与单位）/ 单选 / 多选 / 下拉 / 日期时间 / 拍照 / 视频 / 签名 / 评分 / 定位 / 关联设备或点位</td></tr>
    <tr><td>拍照字段</td><td>可设<b>最少/最多张数</b>、是否强制现场拍摄（禁相册）、是否必须加水印、可附图例（"什么算合格"的标准照片）</td></tr>
    <tr><td>条件显隐</td><td>「电梯运行是否正常 = 否」→ 才显示「异常描述」与「现场照片（必填）」，减少无关填写</td></tr>
    <tr><td>合格判定</td><td>字段级规则（数值区间、选项、是否为空），任一不达标则整条记录判「不合格」并高亮</td></tr>
    <tr><td>默认值与记忆</td><td>数值型字段自动带出上次读数，便于比对（如电表读数、压力表读数）</td></tr>
    <tr><td>版本管理</td><td>表单改版不影响历史记录；发布新版本时可指定生效日期与适用计划</td></tr>
    <tr><td>移动端适配</td><td>按字段顺序渲染为单列卡片流，大按钮、单手可操作，适配戴手套场景</td></tr>
  </table>
  <div class="note"><b>开箱模板（建议先预置 6 套，避免每个项目从零配）：</b>
  保洁日检 · 保安巡更 · 设备点检（通用） · 电梯周检 · 消防月度检查 · 二次供水检查。
  项目可复制后二次修改，<b>但不允许直接改公共模板</b>。</div>

  <h4>5. 周期规则：不只是"每天一次"</h4>
  <table class="tbl">
    <tr><th>周期类型</th><th>配置方式</th><th>典型场景</th></tr>
    <tr><td>按天</td><td>每 N 天一次；或每天多个固定时间点</td><td>保洁日检、保安每班次巡更</td></tr>
    <tr><td>按周</td><td>指定周几（可多选）+ 时间点</td><td>电梯周检、周界巡检</td></tr>
    <tr><td>按月</td><td>指定几号；或「第 N 个周几」（如每月第一个周一）</td><td>消防月度检查、化粪池清掏</td></tr>
    <tr><td>按季 / 按年</td><td>指定月份 + 日期</td><td>避雷检测、水箱清洗、年度消防演练</td></tr>
    <tr><td>按班次</td><td>绑定班次（早/中/夜），随排班自动生成</td><td>保安巡更、前台交接检查</td></tr>
    <tr><td>临时指派</td><td>一次性，指定人、时间窗、内容与要求</td><td>暴雨前防汛检查、迎检突击、领导交办</td></tr>
  </table>
  <div class="kv">
    <span>节假日策略：顺延至下一工作日 / 跳过 / 照常执行（可按计划分别设置）</span>
    <span>生效与失效：计划有生效期，到期自动停用，避免僵尸计划堆积</span>
    <span>补做机制：允许补做昨日任务，但标记为「补做」，计入准时率而非完成率</span>
    <span>跳过机制：如遇客观阻碍（区域封闭），可申请跳过，需主管审批并留痕</span>
  </div>

  <h4>6. 主流程（基层执行 → 中层检查 → 高层监督）</h4>
  <div class="flow">
    <div class="fs"><b>1</b><span>主管制定计划</span><i>选模板 · 选区域 · 选人/班组 · 定周期</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>2</b><span>系统生成任务</span><i>周期引擎按时生成 · 排班联动落到当班人</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>3</b><span>员工执行</span><i>扫码/选区到位 · 按表单拍照填数 · 提交</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>4</b><span>异常上报</span><i>任务窗口内一键上报 → 转报修工单</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>5</b><span>主管检查评分</span><i>抽查复核 · 按评分卡打分 · 开整改单</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>6</b><span>整改闭环</span><i>责任人整改提交 → 主管复核通过</i></div>
  </div>

  <h4>7. 任务状态机</h4>
  <div class="sm">
    <span class="st">待执行</span>→<span class="st">执行中</span>→<span class="st">待检查</span>→<span class="st">已检查</span>→<span class="st">已闭环</span>
    <span class="stx">异常分支：已上报 / 待整改 / 已超时 / 已跳过</span>
  </div>
  <table class="tbl">
    <tr><th>状态</th><th>进入条件</th><th>可执行动作</th><th>超时处理</th></tr>
    <tr><td>待执行</td><td>周期引擎生成</td><td>开始执行 / 申请跳过 / 转派</td><td>开始前 15 分钟推送提醒</td></tr>
    <tr><td>执行中</td><td>员工点击开始并完成到位校验</td><td>按表单逐项填写 / 保存草稿 / 异常上报</td><td>超过建议时长提醒</td></tr>
    <tr><td>待检查</td><td>员工提交执行记录</td><td>主管抽查 / 系统按比例自动抽取</td><td>24 小时未抽查自动进入抽查池</td></tr>
    <tr><td>已检查（合格）</td><td>评分达标</td><td>归档，计入合格率</td><td>—</td></tr>
    <tr><td>待整改</td><td>评分不达标或发现明显问题</td><td>责任人提交整改（照片 + 说明）</td><td>超期未整改自动升级到上级并扣分</td></tr>
    <tr><td>已闭环</td><td>整改复核通过</td><td>归档，计入整改闭环率</td><td>—</td></tr>
    <tr><td>已上报</td><td>执行中上报异常</td><td>关联报修工单，工单关闭后本任务可正常结束</td><td>工单状态回写到任务卡片</td></tr>
    <tr><td>已超时</td><td>超过时间窗未执行</td><td>补做 / 说明 / 计入漏检</td><td>自动进入当日漏检清单与日报</td></tr>
  </table>

  <h4>8. 品质管理：评分卡与整改闭环</h4>
  <table class="tbl">
    <tr><th>组成</th><th>说明</th></tr>
    <tr><td>评分卡</td><td>按岗位/场景配置评分项与权重。例（保洁，满分 100）：地面洁净 30 · 扶手与窗台 20 · 垃圾点 20 · 公厕 20 · 工具摆放 10</td></tr>
    <tr><td>扣分规则</td><td>每项可设"轻微/一般/严重"三档扣分；<b>扣分必须选档位 + 填说明 + 附照片</b>，不允许无依据扣分</td></tr>
    <tr><td>一票否决项</td><td>可设置关键项（如消防通道堵塞、电梯困人未处置），触发即整单不合格并立即开整改单</td></tr>
    <tr><td>整改单</td><td>问题项 + 照片 + 整改要求 + 期限 + 责任人 → 整改提交 → 复核通过 → 闭环；超期自动升级</td></tr>
    <tr><td>复检</td><td>整改单关闭后自动进入下一轮抽查加权重，防止"整改完又回潮"</td></tr>
  </table>
  <div class="note"><b>评分卡必须可配置，不能写死。</b>住宅、写字楼、产业园的标准完全不同，
  甚至同一个公司不同甲方要求也不一样。做成配置化之后，换项目只是换一张卡。</div>

  <h4>9. 与报修工单的联动（打通才有用）</h4>
  <div class="flow">
    <div class="fs"><b>A</b><span>巡检发现异常</span><i>拍照 + 描述 + 点位/设备ID</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>B</b><span>自动生成工单</span><i>来源标记=巡检，携带照片与位置</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>C</b><span>进入报修闭环</span><i>派单 · 处理 · 完工 · 评价</i></div>
    <div class="fa">→</div>
    <div class="fs"><b>D</b><span>状态回写</span><i>工单进度回显到巡检任务卡片</i></div>
  </div>
  <div class="note">这条链路是巡检从"走过场"变成"真正产生价值"的关键。
  如果巡检发现的问题还要员工另外去报修系统填一遍，那这个上报按钮就没人点。
  <b>必须做到：一次拍照、一次描述、自动生成工单。</b>反过来，报修工单的高发点位也要回哺巡检——
  某处反复出问题，系统应建议提高该点位巡检频次。</div>

  <h4>10. 防作弊设计（不做等于白做）</h4>
  <div class="kv">
    <span>强制现场拍摄：禁止从相册选取，只能调用系统相机</span>
    <span>照片水印：时间 + 地点 + 执行人 + 点位名称，不可关闭</span>
    <span>到位校验：二维码/NFC 必须物理到场；区域打卡需 GPS 在围栏内（半径可配）</span>
    <span>重复检测：同一照片哈希、短时间内多点位提交、位置突跳，自动标记可疑</span>
    <span>离线补传标记：离线环境下执行的数据上传时标记，供主管重点复核</span>
    <span>可疑清单：作弊标记汇总成清单，进入个人与外包方考核</span>
  </div>

  <h4>11. 页面布局：PC 计划配置端 + 移动执行端</h4>
  <div class="lay">
    <div class="lc"><b>PC · 计划配置（主管）</b>
      <div class="li">计划列表：岗位 / 区域 / 责任人 / 周期 / 状态 / 执行率</div>
      <div class="li">新建计划四步：选模板 → 选区域 → 选人与排班 → 定周期</div>
      <div class="li">表单设计器：左侧字段库，中间画布，右侧属性</div>
      <div class="li">点位与二维码管理：批量生成、导出打印、作废重绑</div>
      <div class="li">责任区域：按楼栋/楼层/公区可视化圈选</div>
    </div>
    <div class="lc"><b>移动 · 我的任务（员工）</b>
      <div class="li">今日任务日历：按时段排序，显示状态与剩余时限</div>
      <div class="li">到位：扫码 / NFC / 区域打卡（GPS）</div>
      <div class="li">执行：环节卡片流，正常一键过，异常拍照描述</div>
      <div class="li">异常上报：一键转工单，自动带照片与位置</div>
      <div class="li">我的记录：历史提交、被打回的、待整改的</div>
    </div>
    <div class="lc"><b>PC · 品质看板（主管/经理）</b>
      <div class="li">今日执行：应做 / 已完成 / 漏检 / 超时</div>
      <div class="li">抽查池：按人按比例抽取的执行记录列表</div>
      <div class="li">评分：逐项打分 + 扣分说明 + 照片佐证</div>
      <div class="li">整改单：待整改 / 整改中 / 待复核 / 已闭环</div>
      <div class="li">统计：完成率 · 准时率 · 合格率 · 闭环率 · 红黑榜</div>
    </div>
  </div>

  <h4>12. 核心字段</h4>
  <div class="kv">
    <span>任务号</span><span>计划ID / 模板ID</span><span>任务类型（执行/检查/监督/临时）</span>
    <span>岗位类型</span><span>责任区域 / 点位ID / 设备ID</span><span>执行人 / 班组 / 外包方</span>
    <span>计划时间窗</span><span>实际开始 / 提交时间</span><span>到位方式（扫码/GPS/设备码）</span>
    <span>到位坐标与偏差</span><span>表单数据 JSON</span><span>照片列表（含水印信息）</span>
    <span>自动判定结果</span><span>检查人 / 评分 / 扣分明细</span><span>关联整改单号</span>
    <span>关联工单号</span><span>状态与状态时间轴</span><span>可疑标记</span>
  </div>

  <h4>13. 接口清单（建议）</h4>
  <div class="api">
    <div><code>GET  /api/inspect/form/templates</code> 表单模板列表（按岗位过滤）</div>
    <div><code>POST /api/inspect/form/template</code> 新建/保存表单模板（含版本）</div>
    <div><code>GET  /api/inspect/standards</code> 执行标准库（岗位 → 环节 → 拍照要求）</div>
    <div><code>POST /api/inspect/plan</code> 创建计划（模板 + 区域 + 人 + 周期）</div>
    <div><code>POST /api/inspect/plan/{id}/schedule</code> 周期规则解析与任务预生成</div>
    <div><code>POST /api/inspect/task/assign</code> 临时指派（支持批量）</div>
    <div><code>GET  /api/inspect/task/mine</code> 我的任务日历</div>
    <div><code>POST /api/inspect/task/{id}/checkin</code> 到位校验（扫码/NFC/GPS）</div>
    <div><code>POST /api/inspect/task/{id}/submit</code> 提交执行记录（表单 + 照片）</div>
    <div><code>POST /api/inspect/task/{id}/report</code> 异常上报 → 生成报修工单</div>
    <div><code>GET  /api/inspect/task/sample</code> 待抽查列表（按比例抽样）</div>
    <div><code>POST /api/inspect/task/{id}/review</code> 检查评分（含评分卡数据）</div>
    <div><code>POST /api/inspect/rectify</code> 创建整改单</div>
    <div><code>POST /api/inspect/rectify/{id}/submit</code> 整改提交</div>
    <div><code>POST /api/inspect/rectify/{id}/verify</code> 整改复核（通过/驳回）</div>
    <div><code>GET  /api/inspect/dashboard</code> 品质看板统计</div>
    <div><code>POST /api/inspect/device/{id}/qrcode</code> 设备二维码生成与重绑</div>
  </div>

  <h4>14. 落地建议（分期）</h4>
  <table class="tbl">
    <tr><th>阶段</th><th>范围</th><th>为什么</th></tr>
    <tr><td>一期（P0）</td><td>周期引擎 + 表单引擎 + 保洁/保安执行端 + 异常转工单 + 任务日历</td>
        <td>先让基层"有任务、能执行、问题能出去"，这是 daily use 的命脉</td></tr>
    <tr><td>二期（P0）</td><td>主管抽查 + 评分卡 + 整改单闭环 + 品质看板</td>
        <td>没有检查与评分，执行数据只是照片堆；有了才形成管理闭环</td></tr>
    <tr><td>三期（P1）</td><td>设备巡检（扫码带台账 + 阈值告警）+ 专项检查（消防/特种设备）</td>
        <td>依赖 D1 设备台账先落地，且需合规留痕，可稍后</td></tr>
    <tr><td>四期（P2）</td><td>外包方账号与合同考核、高层监督巡场、执行留痕导出包</td>
        <td>属于管理深化，等基础数据跑稳再做</td></tr>
  </table>
  <div class="note"><b>最大的落地风险不是技术，是"把纸质表搬上来"。</b>
  如果只是把现在的纸质巡检表原样做成电子表单，员工会觉得比以前更麻烦，最后数据还是假的。
  所以表单设计必须由<b>一线主管参与</b>，原则是「正常 1 秒、异常 30 秒」，
  并且上线后前两周要盯"异常上报数"——如果这个数字是 0，说明没人真在用。</div>
</div>
"""

from topics_v4 import COCKPIT, PROFILE, HR

TOPICS = [
    ('cockpit', '三张看板与工作台', 'C0 / A7 / D8', '看板分三层 · 指标唯一口径 · 工作台 · 资产驾驶舱 · 物联驾驶舱', COCKPIT),
    ('profile', '业主 360 档案', 'A2 人员档案', '一屏聚合房产/车位/家属/账单/通行/服务历史 · 脱敏留痕 · 三场景验证', PROFILE),
    ('hr', '人力资源', 'C9 人力资源', '应聘→入职→转正→在职→离职 · 职级薪酬带宽 · 工资表 · 权限矩阵', HR),
    ('repair', '报事报修闭环', 'C3 工单与服务', '业主端发起 · 公共免费 / 入户收费 · 派单三模式 · 完工收费 · 评价回访', REPAIR),
    ('cashier', 'PC 收银台', 'B2 费用收取与收银台', '一人多房合并收费 · 多方式收款 · 即时出票 · 交班对账', CASHIER),
    ('parking', '停车场对接', 'D3 车场设备', '适配层 · 车牌换绑 · 进出场同步 · 管理费到期同步', PARKING),
    ('inspect', '巡检计划与品质管理', 'C7/C8 巡检与品质', '基层执行 · 中层检查 · 高层监督 · 自定义表单 · 评分整改闭环', INSPECT),
]
