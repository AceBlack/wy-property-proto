<template>
  <div class="page">
    <div class="proto-note no-print">
      <el-icon class="ico"><InfoFilled /></el-icon>
      <div>
        <b>开票设置 · 抬头、项目、版式三件事</b>：这三样是开票时要反复填的东西，收到字典里才不用每次手打。
        <br />
        <b>开票信息</b>：<b>手填是常态</b>，能从业主 / 租户带出来只是省事 ——
        带入<b>只预填表单，不自动建档</b>，否则 682 个业主会变成 682 条没人维护的档案。
        档案存的是<b>抬头快照</b>：业主后来改名不回写，票据一旦开出抬头就不能变；
        要跟着改就点「重新带入」，覆盖动作留痕。
        <br />
        <b>费用项目</b>：默认五项（摆摊费 / 场地租用 / 赔偿款 / 押金 / 其他），
        可新增，也可以<b>直接手打</b>不存字典。<b>押金和赔偿款税率 0</b>：前者是代收不是收入，
        后者不征增值税，把它们混成 6% 会让账做不平。
        <br />
        <b>票据模板</b>：只有 <b>1 套</b>（多套的代价是每张票都要选版式，而现在只有一种纸）。
        参数可调，右侧预览就是打印出来的样子 —— 针打是<b>套打</b>，纸上已印好格式，
        所以「整体偏移」比字号更重要：打歪 2mm 就压到预印线上了。
      </div>
    </div>

    <el-tabs v-model="tab" class="no-print" style="margin-top:16px;">
      <!-- ============ ① 开票信息 ============ -->
      <el-tab-pane :label="`开票信息 ${pStat.total || 0}`" name="profiles">
        <div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-top:12px;">
          <div class="panel rsum">
            <div class="rsum__l">抬头档案</div>
            <div class="rsum__v">{{ pStat.total || 0 }}<span class="unit">条</span></div>
            <div class="rsum__s">个人 {{ pStat.personal || 0 }} · 企业 {{ pStat.company || 0 }}</div>
          </div>
          <div class="panel rsum">
            <div class="rsum__l">从业主带入</div>
            <div class="rsum__v">{{ pStat.fromOwner || 0 }}<span class="unit">条</span></div>
            <div class="rsum__s">带出来的是姓名与手机，税号留空</div>
          </div>
          <div class="panel rsum">
            <div class="rsum__l">从租户带入</div>
            <div class="rsum__v">{{ pStat.fromTenant || 0 }}<span class="unit">条</span></div>
            <div class="rsum__s">企业租户带工商信息（名称/代码/地址）</div>
          </div>
          <div class="panel rsum">
            <div class="rsum__l">手工填写</div>
            <div class="rsum__v">{{ pStat.manual || 0 }}<span class="unit">条</span></div>
            <div class="rsum__s">外来单位（摆摊、场地租用）多走这条</div>
          </div>
        </div>

        <div class="panel" style="margin-top:16px;">
          <div class="toolbar">
            <el-select v-model="pq.titleType" placeholder="全部类型" clearable style="width:120px" @change="loadProfiles">
              <el-option v-for="t in INVOICE_TITLE_TYPES" :key="t" :label="t" :value="t" />
            </el-select>
            <el-select v-model="pq.sourceType" placeholder="全部来源" clearable style="width:120px" @change="loadProfiles">
              <el-option v-for="s in INVOICE_SOURCES" :key="s" :label="`来源：${s}`" :value="s" />
            </el-select>
            <el-input v-model="pq.kw" placeholder="抬头 / 税号 / 联系人" clearable style="width:220px"
              :prefix-icon="'Search'" @keyup.enter="loadProfiles" @clear="loadProfiles" />
            <el-button @click="loadProfiles">查询</el-button>
            <span class="spacer" />
            <el-dropdown :disabled="!canEdit" @command="openProfile">
              <el-button type="primary" :icon="'Plus'" :disabled="!canEdit">
                新增开票信息<el-icon style="margin-left:4px"><ArrowDown /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="手动">手动填写</el-dropdown-item>
                  <el-dropdown-item command="业主">从业主信息带入</el-dropdown-item>
                  <el-dropdown-item command="租户">从租户信息带入</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <div v-if="!canEdit" class="muted" style="font-size:12px;padding:0 0 10px;">
            当前角色没有「开票设置」操作权限（<code>b.invoiceSet.edit</code>），可以查看但不能维护。
            收银台开票时仍可<b>临时手填抬头</b>，不落档案。
          </div>

          <el-table v-loading="pLoading" :data="profileRows" style="width:100%">
            <el-table-column label="发票抬头" min-width="220">
              <template #default="{ row }">
                <div class="tt">{{ row.title }}</div>
                <div class="tt-s">
                  <el-tag size="small" effect="plain" :type="row.titleType === '企业' ? 'primary' : 'info'">{{ row.titleType }}</el-tag>
                  <span class="mono">{{ row.taxNo || '无税号（个人抬头可不填）' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="联系人" width="150">
              <template #default="{ row }">
                <div>{{ row.contactName || '—' }}</div>
                <div class="tt-s">{{ row.contactPhone || '' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="开户行 / 地址" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="muted">{{ [row.bankName, row.bankAccount, row.regAddress].filter(Boolean).join(' · ') || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="来源" width="136">
              <template #default="{ row }">
                <el-tag size="small" :type="row.sourceType === '手动' ? 'info' : 'success'" effect="plain">
                  {{ row.sourceType }}
                </el-tag>
                <div class="tt-s ellip" v-if="row.sourceName">{{ row.sourceName }}</div>
              </template>
            </el-table-column>
            <el-table-column label="已用" width="72" align="right">
              <template #default="{ row }"><span class="muted">{{ row.usageCount }} 次</span></template>
            </el-table-column>
            <el-table-column label="默认" width="76" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.isDefault" size="small" type="success">默认</el-tag>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="86">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.enabled ? 'success' : 'info'">
                  {{ row.enabled ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="236" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :disabled="!canEdit" @click="editProfile(row)">编辑</el-button>
                <el-button link type="primary" :disabled="!canEdit || row.isDefault || !row.enabled"
                  @click="setDefault(row)">设默认</el-button>
                <el-button v-if="row.sourceType !== '手动'" link type="warning"
                  :disabled="!canEdit" @click="refreshFrom(row)">重新带入</el-button>
                <el-button link :type="row.enabled ? 'warning' : 'success'" :disabled="!canEdit"
                  @click="toggleProfile(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
              </template>
            </el-table-column>
            <template #empty>
              <EmptyState type="search" desc="没有符合条件的开票信息" />
            </template>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============ ② 费用项目 ============ -->
      <el-tab-pane :label="`费用项目 ${itemRows.length}`" name="items">
        <div class="panel" style="margin-top:12px;">
          <div class="toolbar">
            <el-input v-model="iq" placeholder="搜项目名称 / 税收分类" clearable style="width:240px"
              :prefix-icon="'Search'" @input="loadItems" />
            <span class="spacer" />
            <el-button type="primary" :icon="'Plus'" :disabled="!canEdit" @click="openItem()">新增项目</el-button>
          </div>
          <div class="muted" style="font-size:12px;padding:0 0 10px;">
            开票时<b>不受这张表限制</b>：项目名称可以直接手打（控制不了的临时收费不该被字典卡住）。
            这张表解决的是"常用的少打几遍"，不是"只能选这些"。
          </div>

          <el-table :data="itemRows" style="width:100%">
            <el-table-column label="项目名称" min-width="160">
              <template #default="{ row }">
                <span class="tt">{{ row.name }}</span>
                <el-tag v-if="row.builtin" size="small" effect="plain" style="margin-left:6px;">内置</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="默认税率" width="100" align="center">
              <template #default="{ row }">
                <span class="num" :class="row.taxRate === 0 ? 'is-zero' : ''">{{ row.taxRate }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="税收分类" width="190">
              <template #default="{ row }"><span class="muted">{{ row.taxClass || '—' }}</span></template>
            </el-table-column>
            <el-table-column prop="remark" label="说明" min-width="240" show-overflow-tooltip>
              <template #default="{ row }">{{ row.remark || '—' }}</template>
            </el-table-column>
            <el-table-column label="已用" width="80" align="right">
              <template #default="{ row }"><span class="muted">{{ row.usageCount }} 张</span></template>
            </el-table-column>
            <el-table-column label="状态" width="86">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.enabled ? 'success' : 'info'">
                  {{ row.enabled ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="132" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :disabled="!canEdit" @click="openItem(row)">编辑</el-button>
                <el-button link :type="row.enabled ? 'warning' : 'success'" :disabled="!canEdit"
                  @click="toggleItem(row)">{{ row.enabled ? '停用' : '启用' }}</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div class="zero-tip">
            <b>0% 不是"忘了填"</b>：押金是代收款项（退还时要冲回，确认收入就重复计税了），
            赔偿款不属于增值税应税行为。这两项开出来的多是<b>收据</b>而非发票 —— 别照着"其他"的 6% 改。
          </div>
        </div>
      </el-tab-pane>

      <!-- ============ ③ 票据模板 ============ -->
      <el-tab-pane label="票据模板" name="tpl">
        <div class="tpl-wrap">
          <div class="panel tpl-form">
            <div class="sec__hd">
              <h4>版式参数</h4>
              <span class="desc">改完点保存，右侧即时预览</span>
            </div>

            <el-form label-width="88px" size="small">
              <el-form-item label="纸张规格">
                <el-select :model-value="paperKey" style="width:100%" @change="onPaperPreset">
                  <el-option v-for="p in INVOICE_PAPER_PRESETS" :key="p.name" :label="p.name" :value="p.name" />
                </el-select>
              </el-form-item>
              <el-form-item label="宽 × 高">
                <el-input-number v-model="tpl.paper.width" :min="100" :max="420" :step="1" controls-position="right" style="width:110px" />
                <span class="x">×</span>
                <el-input-number v-model="tpl.paper.height" :min="60" :max="297" :step="1" controls-position="right" style="width:110px" />
                <span class="unit-t">mm</span>
              </el-form-item>

              <el-divider content-position="left">页边距（mm）</el-divider>
              <el-form-item label="上 / 下">
                <el-input-number v-model="tpl.margin.top" :min="0" :max="60" controls-position="right" style="width:100px" />
                <span class="x">/</span>
                <el-input-number v-model="tpl.margin.bottom" :min="0" :max="60" controls-position="right" style="width:100px" />
              </el-form-item>
              <el-form-item label="左 / 右">
                <el-input-number v-model="tpl.margin.left" :min="0" :max="60" controls-position="right" style="width:100px" />
                <span class="x">/</span>
                <el-input-number v-model="tpl.margin.right" :min="0" :max="60" controls-position="right" style="width:100px" />
              </el-form-item>

              <el-divider content-position="left">套打偏移（正数向右 / 向下）</el-divider>
              <el-form-item label="水平 X">
                <el-input-number v-model="tpl.offset.x" :min="-20" :max="20" :step="0.5" controls-position="right" style="width:120px" />
                <span class="unit-t">mm</span>
              </el-form-item>
              <el-form-item label="垂直 Y">
                <el-input-number v-model="tpl.offset.y" :min="-20" :max="20" :step="0.5" controls-position="right" style="width:120px" />
                <span class="unit-t">mm</span>
              </el-form-item>
              <div class="off-tip">
                针打是<b>套打</b>：纸上已经印好了框线，机器只负责把字打进去。
                打歪 2mm 就压到预印线上了，所以先调这里，别去调字号。
              </div>

              <el-divider content-position="left">字体与排版</el-divider>
              <el-form-item label="字体">
                <el-select v-model="tpl.font.family" style="width:130px">
                  <el-option v-for="f in INVOICE_FONT_FAMILIES" :key="f" :label="f" :value="f" />
                </el-select>
                <span class="x">字号</span>
                <el-input-number v-model="tpl.font.size" :min="6" :max="16" :step="0.5" controls-position="right" style="width:100px" />
                <span class="unit-t">pt</span>
              </el-form-item>
              <el-form-item label="行高倍数">
                <el-input-number v-model="tpl.font.lineHeight" :min="1" :max="3" :step="0.1" controls-position="right" style="width:120px" />
              </el-form-item>

              <el-divider content-position="left">联次与落款</el-divider>
              <el-form-item label="联数">
                <el-input-number v-model="tpl.copies" :min="1" :max="4" controls-position="right" style="width:120px" />
                <span class="unit-t">联</span>
              </el-form-item>
              <el-form-item label="联次名称">
                <div class="copy-list">
                  <el-input v-for="(c, i) in tpl.copyTitles" :key="i" v-model="tpl.copyTitles[i]"
                    :placeholder="`第 ${i + 1} 联`" maxlength="8" style="width:100px" />
                </div>
              </el-form-item>
              <el-form-item label="票据标题">
                <el-input v-model="tpl.title" maxlength="20" placeholder="收 款 收 据" />
              </el-form-item>
              <el-form-item label="落款">
                <el-input v-model="tpl.footerLeft" placeholder="收款人：" style="width:130px" />
                <el-input v-model="tpl.footerRight" placeholder="复核：" style="width:130px" />
              </el-form-item>
              <el-form-item label="底部说明">
                <el-input v-model="tpl.note" type="textarea" :rows="2" maxlength="60" show-word-limit />
              </el-form-item>
              <el-form-item label="二维码">
                <el-switch v-model="tpl.showQr" />
                <span class="unit-t">打在右下角（扫码查验真伪，接税控后启用）</span>
              </el-form-item>
            </el-form>

            <div v-if="!tplCheck.ok" class="chk is-bad">
              <div class="chk__h">参数还有 {{ tplCheck.errs.length }} 处问题</div>
              <ul><li v-for="(e, i) in tplCheck.errs" :key="i">{{ e }}</li></ul>
            </div>
            <div v-else class="chk is-ok">参数合法，可以保存</div>

            <div class="tpl-acts">
              <el-button type="primary" :disabled="!canEdit" @click="saveTpl">保存模板</el-button>
              <el-button :disabled="!canEdit" @click="doResetTpl">恢复默认</el-button>
              <el-button :icon="'Printer'" @click="doPrint">试打一张</el-button>
            </div>
            <div class="tpl-meta">
              最近修改：{{ tpl.updatedAt }} · {{ tpl.updatedBy }}
            </div>
          </div>

          <!-- 预览：按 mm 换算成 px，缩放系数 PX_PER_MM -->
          <div class="panel tpl-preview">
            <div class="sec__hd">
              <h4>打印预览</h4>
              <span class="desc">按 {{ Math.round(PREVIEW_ZOOM * 100) }}% 缩放显示 · 内容为示例数据，试打时按真实尺寸走纸</span>
            </div>

            <div class="paper-scroll">
              <div class="tpl-paper" :style="paperStyle">
                <div class="pp-inner" :style="innerStyle">
                  <div class="pp-copy">{{ tpl.copyTitles[1] || '客户联' }}</div>
                  <div class="pp-title">{{ tpl.title }}</div>
                  <div class="pp-meta">
                    <span>票号：SJ10000001</span>
                    <span>2026-11-06</span>
                  </div>
                  <div class="pp-row">
                    <span>付款人：</span><b>张建国</b>
                    <span class="pp-gap">收款方式：</span><b>现金</b>
                  </div>
                  <table class="pp-table">
                    <thead>
                      <tr><th>项目名称</th><th class="r">金额</th><th>备注</th></tr>
                    </thead>
                    <tbody>
                      <tr><td>摆摊费</td><td class="r">200.00</td><td>10 月摊位费</td></tr>
                      <tr><td>场地租用</td><td class="r">120.00</td><td>中庭活动</td></tr>
                    </tbody>
                  </table>
                  <div class="pp-sum">
                    <span>合计（小写）：<b>¥ 320.00</b></span>
                    <span>（大写）：<b>{{ rmbUpper(320) }}</b></span>
                  </div>
                  <div class="pp-foot">
                    <span>{{ tpl.footerLeft }}＿＿＿＿＿</span>
                    <span>{{ tpl.footerRight }}＿＿＿＿＿</span>
                  </div>
                  <div class="pp-note">{{ tpl.note }}</div>
                  <div v-if="tpl.showQr" class="pp-qr">二维码</div>
                </div>
              </div>
            </div>

            <div class="paper-meta">
              共 <b>{{ tpl.copies }}</b> 联：{{ (tpl.copyTitles || []).join(' / ') }} ·
              内容区 {{ contentW }} × {{ contentH }} mm
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 开票信息抽屉 -->
    <el-drawer v-model="pVisible" :title="pEdit ? `编辑开票信息 · ${pForm.profileId}` : '新增开票信息'" size="560px" class="no-print">
      <el-form label-width="104px">
        <el-form-item v-if="!pEdit" label="开始方式">
          <el-radio-group v-model="srcType" @change="onSrcTypeChange">
            <el-radio-button v-for="s in INVOICE_SOURCES" :key="s" :value="s">{{ s === '手动' ? '手动填写' : `从${s}带入` }}</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <el-form-item v-if="srcType === '业主'" label="选业主" required>
          <el-select v-model="srcId" filterable remote :remote-method="searchOwner" placeholder="输姓名或手机号搜"
            style="width:100%" @change="fillFromOwner">
            <el-option v-for="o in ownerOpts" :key="o.value" :label="`${o.label} ${o.phone || ''}`" :value="o.value">
              <span>{{ o.label }}</span>
              <span class="opt-s">{{ o.phone }} · {{ o.houseName }}</span>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item v-if="srcType === '租户'" label="选租户" required>
          <el-select v-model="srcId" filterable remote :remote-method="searchTenant" placeholder="输姓名 / 公司名 / 手机号"
            style="width:100%" @change="fillFromTenant">
            <el-option v-for="t in tenantOpts" :key="t.value" :label="t.label" :value="t.value">
              <span>{{ t.label }}</span>
              <span class="opt-s">{{ t.tenantType }} · {{ t.houseName }}</span>
            </el-option>
          </el-select>
        </el-form-item>

        <div v-if="srcType !== '手动'" class="src-tip">
          带入只<b>预填下面这些框</b>，不会自动保存 —— 确认无误再点「保存」。
          企业租户会把名称、统一社会信用代码、注册地址一起带出来。
        </div>

        <el-form-item label="抬头类型" required>
          <el-radio-group v-model="pForm.titleType">
            <el-radio-button value="个人">个人</el-radio-button>
            <el-radio-button value="企业">企业</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="pForm.titleType === '企业' ? '单位名称' : '姓名'" required>
          <el-input v-model="pForm.title" maxlength="60" show-word-limit placeholder="与证件 / 营业执照完全一致" />
        </el-form-item>
        <el-form-item :label="pForm.titleType === '企业' ? '纳税人识别号' : '税号（可空）'"
          :required="pForm.titleType === '企业'">
          <el-input v-model="pForm.taxNo" maxlength="20" :placeholder="pForm.titleType === '企业' ? '18 位统一社会信用代码' : '个人抬头可不填'" />
          <div v-if="pForm.titleType === '个人'" class="fld-tip">个人开票凭姓名即可，身份证号不当税号用。</div>
        </el-form-item>

        <template v-if="pForm.titleType === '企业'">
          <el-form-item label="开户银行"><el-input v-model="pForm.bankName" maxlength="40" /></el-form-item>
          <el-form-item label="银行账号"><el-input v-model="pForm.bankAccount" maxlength="30" /></el-form-item>
          <el-form-item label="注册地址"><el-input v-model="pForm.regAddress" maxlength="60" /></el-form-item>
          <el-form-item label="注册电话"><el-input v-model="pForm.regPhone" maxlength="20" /></el-form-item>
        </template>

        <el-divider content-position="left">票据联系人</el-divider>
        <el-form-item label="联系人"><el-input v-model="pForm.contactName" maxlength="20" /></el-form-item>
        <el-form-item label="联系电话"><el-input v-model="pForm.contactPhone" maxlength="20" /></el-form-item>
        <el-form-item label="电子邮箱">
          <el-input v-model="pForm.contactEmail" maxlength="60" placeholder="开电子发票时发送到这儿" />
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="pForm.remark" maxlength="60" /></el-form-item>
        <el-form-item label="设为默认">
          <el-switch v-model="pForm.isDefault" />
          <span class="fld-tip">全库只有一条默认，收银台开票时会先选它</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="pVisible = false">取消</el-button>
        <el-button type="primary" @click="submitProfile">保存</el-button>
      </template>
    </el-drawer>

    <!-- 费用项目抽屉 -->
    <el-drawer v-model="iVisible" :title="iForm.itemId ? `编辑费用项目 · ${iForm.itemId}` : '新增费用项目'" size="460px" class="no-print">
      <el-form label-width="96px">
        <el-form-item label="项目名称" required>
          <el-input v-model="iForm.name" maxlength="20" show-word-limit placeholder="如：摆摊费" />
        </el-form-item>
        <el-form-item label="默认税率" required>
          <el-select v-model="iForm.taxRate" style="width:140px">
            <el-option v-for="r in TAX_RATES" :key="r" :label="`${r}%`" :value="r" />
          </el-select>
          <span class="fld-tip">开票时仍可按这一笔单独改</span>
        </el-form-item>
        <el-form-item label="税收分类">
          <el-input v-model="iForm.taxClass" maxlength="30" placeholder="如：不动产经营租赁" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="iForm.remark" type="textarea" :rows="3" maxlength="60" show-word-limit
            placeholder="写清什么情况下用这一项，别写「其他」" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="iForm.enabled" />
          <span v-if="iForm.builtin" class="fld-tip">内置项目可改名，已用过的不能停用</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="iVisible = false">取消</el-button>
        <el-button type="primary" @click="submitItem">保存</el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import EmptyState from '@/components/EmptyState.vue'
import {
  INVOICE_FONT_FAMILIES, INVOICE_PAPER_PRESETS, INVOICE_SOURCES, INVOICE_TITLE_TYPES,
  canEditInvoiceSet, invoiceItemRows, invoiceOwnerOpts, invoiceProfileFromOwner,
  invoiceProfileFromTenant, invoiceProfileStats, invoiceTenantOpts, queryInvoiceProfiles,
  invoiceTplCheck, invoiceTplGet, refreshProfileFromSource, resetInvoiceTpl, rmbUpper,
  saveInvoiceItem, saveInvoiceProfile, saveInvoiceTpl, setDefaultInvoiceProfile,
  toggleInvoiceItem, toggleInvoiceProfile
} from '@/api'

const tab = ref('profiles')
const canEdit = ref(canEditInvoiceSet())
const TAX_RATES = [0, 3, 5, 6, 9, 13]

/* ================= ① 开票信息 ================= */
const pq = reactive({ kw: '', titleType: '', sourceType: '' })
const profileRows = ref([])
const pStat = ref({})
const pLoading = ref(false)

async function loadProfiles() {
  pLoading.value = true
  try {
    profileRows.value = await queryInvoiceProfiles({ ...pq })
    pStat.value = await invoiceProfileStats()
  } catch (e) {
    ElMessage.error(e?.message || '开票信息加载失败')
  } finally {
    pLoading.value = false
  }
}

const P_BLANK = {
  profileId: '', titleType: '个人', title: '', taxNo: '',
  bankName: '', bankAccount: '', regAddress: '', regPhone: '',
  contactName: '', contactPhone: '', contactEmail: '',
  sourceType: '手动', sourceId: '', sourceName: '', houseId: '',
  isDefault: false, remark: ''
}
const pForm = reactive({ ...P_BLANK })
const pVisible = ref(false)
const pEdit = ref(false)
const srcType = ref('手动')
const srcId = ref('')
const ownerOpts = ref([])
const tenantOpts = ref([])

function openProfile(cmd) {
  Object.assign(pForm, P_BLANK)
  pEdit.value = false
  pVisible.value = true
  srcType.value = cmd || '手动'
  srcId.value = ''
  pForm.sourceType = srcType.value
  if (srcType.value === '业主') { ownerOpts.value = invoiceOwnerOpts(''); searchOwner('') }
  if (srcType.value === '租户') { tenantOpts.value = invoiceTenantOpts(''); searchTenant('') }
}

function editProfile(row) {
  Object.assign(pForm, { ...P_BLANK, ...row })
  pEdit.value = true
  pVisible.value = true
  srcType.value = row.sourceType
  srcId.value = row.sourceId || ''
}

function onSrcTypeChange(v) {
  srcId.value = ''
  pForm.sourceType = v
  if (v === '业主') searchOwner('')
  if (v === '租户') searchTenant('')
}

async function searchOwner(kw) { ownerOpts.value = await invoiceOwnerOpts(kw) }
async function searchTenant(kw) { tenantOpts.value = await invoiceTenantOpts(kw) }

async function fillFromOwner(ownerId) {
  try {
    const d = await invoiceProfileFromOwner(ownerId)
    Object.assign(pForm, { ...P_BLANK, ...d })
    ElMessage.success(`已带入「${d.title}」的信息，确认后保存`)
  } catch (e) { ElMessage.error(e?.message || '带入失败') }
}
async function fillFromTenant(tenantId) {
  try {
    const d = await invoiceProfileFromTenant(tenantId)
    Object.assign(pForm, { ...P_BLANK, ...d })
    ElMessage.success(d.taxNo
      ? `已带入「${d.title}」的工商信息（含税号）`
      : `已带入「${d.title}」的信息（个人租户无税号）`)
  } catch (e) { ElMessage.error(e?.message || '带入失败') }
}

async function submitProfile() {
  try {
    await saveInvoiceProfile({ ...pForm }, pForm.profileId)
    ElMessage.success(pForm.profileId ? '已保存' : '已新增开票信息')
    pVisible.value = false
    loadProfiles()
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

async function setDefault(row) {
  try {
    await setDefaultInvoiceProfile(row.profileId)
    ElMessage.success(`「${row.title}」已设为默认抬头`)
    loadProfiles()
  } catch (e) { ElMessage.error(e?.message || '操作失败') }
}

async function toggleProfile(row) {
  try {
    await toggleInvoiceProfile(row.profileId, !row.enabled)
    ElMessage.success(row.enabled ? '已停用（历史票据不受影响）' : '已启用')
    loadProfiles()
  } catch (e) { ElMessage.error(e?.message || '操作失败') }
}

async function refreshFrom(row) {
  try {
    await ElMessageBox.confirm(
      `将用「${row.sourceName || row.sourceId}」当前的档案信息覆盖这条开票信息的抬头、税号与联系方式。\n已开出的票据不受影响（票据上是当时的快照）。`,
      '重新带入', { type: 'warning', confirmButtonText: '确认覆盖' }
    )
    const r = await refreshProfileFromSource(row.profileId)
    ElMessage.success(`已重新带入${r._before && r._before !== r.title ? `，抬头由「${r._before}」更新为「${r.title}」` : ''}`)
    loadProfiles()
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message)
  }
}

/* ================= ② 费用项目 ================= */
const iq = ref('')
const itemRows = ref([])
async function loadItems() {
  try { itemRows.value = await invoiceItemRows({ kw: iq.value }) } catch (e) { ElMessage.error(e?.message || '加载失败') }
}

const I_BLANK = { itemId: '', name: '', taxRate: 6, taxClass: '', remark: '', enabled: true, builtin: false }
const iForm = reactive({ ...I_BLANK })
const iVisible = ref(false)

function openItem(row) {
  Object.assign(iForm, I_BLANK, row ? { ...row } : {})
  iVisible.value = true
}

async function submitItem() {
  try {
    await saveInvoiceItem({ ...iForm }, iForm.itemId)
    ElMessage.success(iForm.itemId ? '已保存' : '已新增费用项目')
    iVisible.value = false
    loadItems()
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}

async function toggleItem(row) {
  try {
    await toggleInvoiceItem(row.itemId, !row.enabled)
    ElMessage.success(row.enabled ? '已停用' : '已启用')
    loadItems()
  } catch (e) { ElMessage.error(e?.message || '操作失败') }
}

/* ================= ③ 票据模板 ================= */
const tpl = ref(invoiceTplGet())
/* 预览缩放：241mm 的纸按 0.68 缩到约 620px。打印时归 1（见文末 @media print） */
const PREVIEW_ZOOM = 0.68

const paperKey = computed(() => {
  const p = INVOICE_PAPER_PRESETS.find(x => x.width === tpl.value.paper.width && x.height === tpl.value.paper.height)
  return p ? p.name : ''
})
function onPaperPreset(name) {
  const p = INVOICE_PAPER_PRESETS.find(x => x.name === name)
  if (p) { tpl.value.paper.width = p.width; tpl.value.paper.height = p.height }
}

const paperStyle = computed(() => {
  const t = tpl.value
  /* 尺寸直接按 mm 写，靠 zoom 缩小显示 —— 打印时 zoom 归 1 就是真实尺寸，
     预览与打印共用一套数值，不会出现"预览好好的、打出来偏了" */
  return {
    width: t.paper.width + 'mm',
    height: t.paper.height + 'mm',
    paddingTop: t.margin.top + 'mm',
    paddingBottom: t.margin.bottom + 'mm',
    paddingLeft: t.margin.left + 'mm',
    paddingRight: t.margin.right + 'mm',
    zoom: PREVIEW_ZOOM,
    transform: `translate(${t.offset.x}mm, ${t.offset.y}mm)`
  }
})
/* pt → mm 是 ×0.3528；单位用 mm，随 zoom 一起缩 */
const innerStyle = computed(() => {
  const t = tpl.value
  return {
    fontFamily: t.font.family,
    fontSize: t.font.size * 0.3528 + 'mm',
    lineHeight: t.font.lineHeight
  }
})
const contentW = computed(() => (tpl.value.paper.width - tpl.value.margin.left - tpl.value.margin.right).toFixed(1))
const contentH = computed(() => (tpl.value.paper.height - tpl.value.margin.top - tpl.value.margin.bottom).toFixed(1))

/* mock 下是纯函数，可直接算；http 模式以保存时服务端校验为准 */
const tplCheck = computed(() => {
  try { return invoiceTplCheck(tpl.value) } catch { return { ok: true, errs: [] } }
})

async function saveTpl() {
  try {
    tpl.value = await saveInvoiceTpl(tpl.value)
    ElMessage.success('模板已保存')
  } catch (e) { ElMessage.error(e?.message || '保存失败') }
}
async function doResetTpl() {
  try {
    await ElMessageBox.confirm('恢复为出厂参数（241×140 三联、宋体 10pt、偏移 0）？', '恢复默认', { type: 'warning' })
    tpl.value = await resetInvoiceTpl()
    ElMessage.success('已恢复默认')
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message)
  }
}

/**
 * 试打：@page 的纸张尺寸要跟着模板走（241×140 与 210×297 不可能共用一个规则），
 * 所以打印前动态注入、打完移除 —— 常驻会污染整个应用的打印行为。
 */
function doPrint() {
  const rule = document.createElement('style')
  rule.id = 'invoice-tpl-page-rule'
  rule.textContent = `@page { size: ${tpl.value.paper.width}mm ${tpl.value.paper.height}mm; margin: 0 }`
  document.head.appendChild(rule)
  document.body.classList.add('printing-tpl')
  setTimeout(() => {
    window.print()
    setTimeout(() => {
      document.body.classList.remove('printing-tpl')
      rule.remove()
    }, 800)
  }, 80)
}

onMounted(() => { loadProfiles(); loadItems() })
</script>

<style scoped>
.tt { font-size: 13px; color: var(--biz-text-1); font-weight: 600; }
.tt-s { font-size: 11.5px; color: var(--biz-text-3); margin-top: 2px; }
.mono { font-family: var(--biz-font-num); }
.ellip { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { font-family: var(--biz-font-num); }
.num.is-zero { color: var(--biz-warning, #d98a1f); }
.opt-s { float: right; color: var(--biz-text-3); font-size: 12px; margin-left: 12px; }
.src-tip {
  margin: 0 0 14px 104px; padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.7;
  background: var(--biz-fill-2, #f6f7f9); color: var(--biz-text-2);
}
.src-tip b { color: var(--biz-text-1); }
.fld-tip { font-size: 11.5px; color: var(--biz-text-3); margin-left: 8px; }
.x { margin: 0 6px; color: var(--biz-text-3); }
.unit-t { margin-left: 6px; font-size: 12px; color: var(--biz-text-3); }
.copy-list { display: flex; flex-wrap: wrap; gap: 6px; }
.zero-tip {
  margin-top: 10px; font-size: 12px; line-height: 1.75; color: var(--biz-text-3);
  padding: 8px 10px; border-radius: 6px; background: var(--biz-fill-2, #f6f7f9);
}
.zero-tip b { color: var(--biz-text-1); }

/* ---- 模板页布局 ---- */
.tpl-wrap { display: grid; grid-template-columns: 460px minmax(0, 1fr); gap: 16px; margin-top: 12px; align-items: start; }
.tpl-form { padding-bottom: 14px; }
.tpl-form :deep(.el-divider) { margin: 12px 0; }
.tpl-form :deep(.el-divider__text) { font-size: 12px; color: var(--biz-text-3); background: #fff; }
.tpl-form :deep(.el-form-item) { margin-bottom: 12px; }
.off-tip {
  margin: -4px 0 8px; font-size: 11.5px; line-height: 1.7; color: var(--biz-text-3);
  padding-left: 88px;
}
.off-tip b { color: var(--biz-text-2); }
.chk { margin: 10px 0 0 88px; font-size: 12px; line-height: 1.7; }
.chk.is-ok { color: var(--biz-success, #2f9e6e); }
.chk.is-bad { color: var(--biz-danger, #d64545); }
.chk__h { font-weight: 600; }
.chk ul { margin: 4px 0 0; padding-left: 18px; }
.tpl-acts { display: flex; gap: 8px; margin: 14px 0 0 88px; }
.tpl-meta { margin: 10px 0 0 88px; font-size: 11.5px; color: var(--biz-text-3); }

.tpl-preview { min-height: 420px; }
.paper-scroll {
  overflow: auto; padding: 12px; background: var(--biz-fill-2, #f2f3f5); border-radius: 6px;
  display: flex; justify-content: center;
}
.tpl-paper {
  background: #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  color: #1a1a1a; box-sizing: border-box; flex-shrink: 0;
}
.pp-inner { position: relative; height: 100%; }
.pp-copy {
  position: absolute; right: 0; top: -1.2em; font-size: 0.85em; color: #888;
  letter-spacing: 0.1em;
}
.pp-title {
  text-align: center; font-weight: 700; letter-spacing: 0.35em;
  font-size: 1.5em; margin-bottom: 0.35em;
}
.pp-meta {
  display: flex; justify-content: space-between; font-size: 0.9em; color: #444;
  border-bottom: 1px solid #333; padding-bottom: 0.2em; margin-bottom: 0.4em;
}
.pp-row { font-size: 0.95em; margin-bottom: 0.35em; }
.pp-gap { margin-left: 1.6em; }
.pp-table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
.pp-table th, .pp-table td { border: 1px solid #666; padding: 0.15em 0.4em; }
.pp-table th { background: #f2f2f2; font-weight: 600; }
.pp-table .r { text-align: right; }
.pp-sum {
  display: flex; justify-content: space-between; font-size: 0.92em;
  border-top: 1px solid #333; margin-top: 0.3em; padding-top: 0.25em;
}
.pp-foot {
  display: flex; justify-content: space-between; font-size: 0.9em; margin-top: 0.9em;
}
.pp-note { font-size: 0.8em; color: #777; margin-top: 0.4em; }
.pp-qr {
  position: absolute; right: 0; bottom: 0; width: 3.2em; height: 3.2em;
  border: 1px dashed #999; font-size: 0.62em; color: #999;
  display: flex; align-items: center; justify-content: center;
}
.paper-meta { margin-top: 10px; font-size: 11.5px; color: var(--biz-text-3); }
.paper-meta b { color: var(--biz-text-1); }
</style>

<style>
/* 打印：只留票据本身，按真实毫米走纸。scope 外的样式才能命中 body */
@media print {
  body.printing-tpl * { visibility: hidden; }
  body.printing-tpl .tpl-paper,
  body.printing-tpl .tpl-paper * { visibility: visible; }
  body.printing-tpl .tpl-paper {
    position: absolute; left: 0; top: 0;
    zoom: 1 !important;
    box-shadow: none;
  }
}
</style>
