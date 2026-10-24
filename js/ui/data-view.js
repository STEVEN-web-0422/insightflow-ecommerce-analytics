(function bootstrapLayeredDataView(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const common = App.ui;
  let root = null;
  let initialized = false;
  let building = false;
  let odsLoading = false;
  let stepStates = {
    convert: "pending",
    clean: "pending",
    derive: "pending"
  };

  function template() {
    return `
      <div class="section-head pipeline-heading">
        <div>
          <span class="pipeline-eyebrow">ECOMMERCE ANALYTICS SOP</span>
          <h2>电商行为数据分析流水线</h2>
          <p>固定示例数据、固定清洗口径，从 ODS 原始日志直达 DWD 分析宽表和 ADS 分析成果，减少每日重复准备工作。</p>
        </div>
        <span class="status-badge success">固定电商日志场景</span>
      </div>

      <div class="layer-pipeline">
        <section class="layer-card layer-ods" aria-labelledby="ods-title">
          <div class="layer-header">
            <div class="layer-title">
              <span class="layer-code">ODS</span>
              <div>
                <h3 id="ods-title">原始数据层</h3>
                <p>示例电商行为日志，保持原始业务语义，不做人工配置。</p>
              </div>
            </div>
            <span class="layer-state" id="ods-state">读取中</span>
          </div>
          <div class="layer-body" id="ods-body">
            <div class="layer-loading"><span class="spinner"></span>正在载入内置示例数据…</div>
          </div>
        </section>

        <div class="layer-arrow" aria-hidden="true"><span>↓</span><small>固定清洗 SOP</small></div>

        <section class="layer-card layer-dwd" aria-labelledby="dwd-title">
          <div class="layer-header">
            <div class="layer-title">
              <span class="layer-code">DWD</span>
              <div>
                <h3 id="dwd-title">明细宽表层</h3>
                <p>类型标准化、脏数据过滤和时间维度派生一次完成。</p>
              </div>
            </div>
            <span class="layer-state" id="dwd-state">待生成</span>
          </div>
          <div class="layer-body">
            <div class="pipeline-action-row">
              <button class="button button-primary" id="build-dwd-button" type="button">
                <i data-lucide="wand-sparkles" aria-hidden="true"></i>一键生成分析宽表
              </button>
              <span>无需逐字段配置，口径固定且可复用</span>
            </div>
            <div class="dwd-process" id="dwd-process" hidden>
              <div class="dwd-step" data-dwd-step="convert"><span class="dwd-step-icon">1</span><div><strong>字段类型转换</strong><small>time → 标准日期，amount → Number</small></div></div>
              <div class="dwd-step" data-dwd-step="clean"><span class="dwd-step-icon">2</span><div><strong>剔除脏数据</strong><small>移除 user_id 或时间无效的记录</small></div></div>
              <div class="dwd-step" data-dwd-step="derive"><span class="dwd-step-icon">3</span><div><strong>派生时间维度</strong><small>从原始时间拆解 date 与 hour</small></div></div>
            </div>
            <div id="dwd-result"></div>
          </div>
        </section>

        <div class="layer-arrow" aria-hidden="true"><span>↓</span><small>分析结果沉淀</small></div>

        <section class="layer-card layer-ads" aria-labelledby="ads-title">
          <div class="layer-header">
            <div class="layer-title">
              <span class="layer-code">ADS</span>
              <div>
                <h3 id="ads-title">应用数据层</h3>
                <p>数据分析模块跑出的结果将自动沉淀于此，供复盘与报告复用。</p>
              </div>
            </div>
            <span class="layer-state" id="ads-state">0 条结果</span>
          </div>
          <div class="layer-body" id="ads-body"></div>
        </section>
      </div>
    `;
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    root = document.getElementById("view-data");
    root.innerHTML = template();
    root.addEventListener("click", handleClick);
    App.state.subscribe("dataWarehouse:changed", render);
    App.state.subscribe("ads:changed", render);
    render();
    loadOds();
  }

  async function loadOds() {
    if (global.dataWarehouse.ods || odsLoading) {
      render();
      return;
    }
    odsLoading = true;
    try {
      await global.dataWarehouse.ensureOds();
    } catch (error) {
      common.toast(`示例数据加载失败：${error.message}`, "error", 5200);
    } finally {
      odsLoading = false;
      render();
    }
  }

  function render() {
    if (!root) {
      return;
    }
    const warehouse = global.dataWarehouse;
    renderOds(warehouse);
    renderDwd(warehouse);
    renderAds(warehouse);
    common.updateGlobalContext(warehouse.dwd || warehouse.ods);
    common.refreshIcons(root);
  }

  function renderOds(warehouse) {
    const body = document.getElementById("ods-body");
    const state = document.getElementById("ods-state");
    if (!body || !state) {
      return;
    }
    if (!warehouse.ods) {
      state.textContent = "读取中";
      body.innerHTML = `<div class="layer-loading"><span class="spinner"></span>正在载入内置示例数据…</div>`;
      return;
    }
    const ods = warehouse.ods;
    state.textContent = "已就绪";
    state.className = "layer-state ready";
    body.innerHTML = `
      <div class="layer-metrics">
        <div><span>数据文件</span><strong>${utils.escapeHtml(ods.source?.fileName || "sample-events.csv")}</strong></div>
        <div><span>原始记录</span><strong>${ods.rows.length.toLocaleString("zh-CN")} 行</strong></div>
        <div><span>字段数量</span><strong>${ods.schema.length} 个</strong></div>
    </div>
      <div class="layer-field-list">
        ${ods.schema.map((field) => `<span class="layer-field"><b>${utils.escapeHtml(field.key)}</b><small>${utils.escapeHtml(App.constants.fieldTypes[field.type] || field.type)}</small></span>`).join("")}
      </div>
      <div class="layer-note">ODS 始终保留内置示例原始结构，不提供手工上传与字段映射。</div>
    `;
  }

  function stepIcon(status) {
    if (status === "done") {
      return "✓";
    }
    if (status === "active") {
      return "…";
    }
    return "";
  }

  function updateProcessView() {
    root.querySelectorAll("[data-dwd-step]").forEach((element, index) => {
      const key = element.dataset.dwdStep;
      const status = stepStates[key];
      element.classList.toggle("active", status === "active");
      element.classList.toggle("done", status === "done");
      const icon = element.querySelector(".dwd-step-icon");
      icon.textContent = status === "pending" ? String(index + 1) : stepIcon(status);
    });
  }

  function renderDwd(warehouse) {
    const state = document.getElementById("dwd-state");
    const button = document.getElementById("build-dwd-button");
    const process = document.getElementById("dwd-process");
    const result = document.getElementById("dwd-result");
    if (!state || !button || !process || !result) {
      return;
    }
    const hasDwd = Boolean(warehouse.dwd);
    state.textContent = building ? "生成中" : hasDwd ? `已生成 · v${warehouse.dwd.version}` : "待生成";
    state.className = `layer-state ${hasDwd ? "ready" : ""}`;
    button.disabled = building || !warehouse.ods;
    button.innerHTML = building
      ? '<span class="spinner"></span>正在生成分析宽表…'
      : `<i data-lucide="wand-sparkles" aria-hidden="true"></i>${hasDwd ? "重新生成分析宽表" : "一键生成分析宽表"}`;
    process.hidden = !building;
    updateProcessView();

    if (!hasDwd) {
      result.innerHTML = `
        <div class="dwd-empty">
          <i data-lucide="layers-3" aria-hidden="true"></i>
          <span>生成后将得到 date、hour、标准日期与数值金额字段，供后续分析直接使用。</span>
        </div>
      `;
      return;
    }
    if (building) {
      result.innerHTML = "";
      return;
    }
    result.innerHTML = `
      <div class="dwd-result-head">
        <div>
          <span>DWD 宽表已就绪</span>
          <strong>${warehouse.dwd.rows.length.toLocaleString("zh-CN")} 行 × ${warehouse.dwd.schema.length} 字段</strong>
        </div>
        <button class="button button-secondary button-small" id="go-analysis-button" type="button">进入业务分析</button>
      </div>
      <div class="layer-field-list">
        ${warehouse.dwd.schema.map((field) => `<span class="layer-field"><b>${utils.escapeHtml(field.key)}</b><small>${utils.escapeHtml(App.constants.fieldTypes[field.type] || field.type)}</small></span>`).join("")}
      </div>
      <div class="layer-note">清洗口径：time 标准化、user_id 非空、amount 数值化、派生 date/hour。所有分析默认读取此层。</div>
    `;
  }

  function renderAds(warehouse) {
    const body = document.getElementById("ads-body");
    const state = document.getElementById("ads-state");
    if (!body || !state) {
      return;
    }
    state.textContent = `${warehouse.ads.length} 条结果`;
    state.className = `layer-state ${warehouse.ads.length ? "ready" : ""}`;
    if (!warehouse.ads.length) {
      body.innerHTML = `
        <div class="ads-empty">
          <i data-lucide="chart-no-axes-combined" aria-hidden="true"></i>
          <div><strong>还没有沉淀分析结果</strong><span>完成业务分析并保存后，结果会自动出现在 ADS 应用层。</span></div>
        </div>
      `;
      return;
    }
    body.innerHTML = `
      <div class="ads-grid">
        ${warehouse.ads.slice(0, 6).map((record) => `
          <button class="ads-card" type="button" data-ads-record="${utils.escapeHtml(record.id)}">
            <span class="status-badge success">${utils.escapeHtml(analysisLabel(record.type))}</span>
            <strong>${utils.escapeHtml(record.title)}</strong>
            <small>${utils.escapeHtml(record.tableName)} · ${utils.formatDateTime(record.savedToAdsAt || record.savedAt || record.createdAt)}</small>
            <div class="ads-metrics">
              ${(record.metrics || []).slice(0, 2).map((metric) => `<span>${utils.escapeHtml(metric.label)} <b>${utils.escapeHtml(metric.formatted)}</b></span>`).join("")}
            </div>
          </button>
        `).join("")}
      </div>
      <div class="ads-footer"><span>分析结果已结构化沉淀，完整明细可在“分析历史”查看。</span><button class="button button-secondary button-small" id="ads-history-button" type="button">查看分析历史</button></div>
    `;
  }

  function analysisLabel(type) {
    return {
      retention: "留存分析",
      funnel: "漏斗分析",
      rfm: "RFM 分层",
      descriptive: "描述统计",
      group: "分组对比",
      trend: "趋势分析",
      correlation: "相关性分析"
    }[type] || type;
  }

  async function handleClick(event) {
    const target = event.target.closest("button");
    if (!target) {
      return;
    }
    if (target.id === "build-dwd-button" && !building) {
      await runFixedPipeline();
      return;
    }
    if (target.id === "go-analysis-button" || target.id === "ads-history-button") {
      App.ui.router.navigate(target.id === "go-analysis-button" ? "analysis" : "history");
      return;
    }
    if (target.dataset.adsRecord) {
      App.ui.router.navigate("history");
    }
  }

  async function runFixedPipeline() {
    building = true;
    stepStates = { convert: "pending", clean: "pending", derive: "pending" };
    render();
    const steps = ["convert", "clean", "derive"];
    try {
      for (const step of steps) {
        stepStates[step] = "active";
        updateProcessView();
        await new Promise((resolve) => global.setTimeout(resolve, 280));
        stepStates[step] = "done";
        updateProcessView();
      }
      const result = await global.dataWarehouse.buildDwd();
      App.ui.warehouseView.render();
      common.updateStorageStatus();
      common.toast(
        `DWD 宽表已生成：${result.dwdRows.toLocaleString("zh-CN")} 行，新增 date、hour 两个时间维度。`,
        "success",
        4800
      );
    } catch (error) {
      common.toast(`宽表生成失败：${error.message}`, "error", 5600);
    } finally {
      building = false;
      render();
    }
  }

  App.ui.dataView = {
    init,
    renderAll: render,
    render,
    clear: () => {}
  };
})(window);
