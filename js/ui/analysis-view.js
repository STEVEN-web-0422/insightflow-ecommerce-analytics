(function bootstrapAnalysisView(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const common = App.ui;
  const analysisCommon = App.analysis.common;
  let root = null;
  let initialized = false;
  let currentTableId = "";
  let currentTable = null;
  let currentType = "retention";
  let currentResult = null;
  let currentSaved = false;

  const typeMeta = {
    retention: {
      label: "留存分析",
      icon: "repeat-2",
      description: "按用户首次行为周期划分 Cohort，观察用户是否持续回访。适合评估新客粘性、渠道质量和产品改版效果。"
    },
    funnel: {
      label: "漏斗分析",
      number: "02",
      icon: "filter",
      description: "固定读取 user_id、time、event，在指定窗口内按顺序计算浏览、加购与支付转化，识别关键流失节点。"
    },
    rfm: {
      label: "RFM 分层",
      icon: "users-round",
      description: "固定使用 user_id、time、amount 和 purchase 事件，从最近成交、频次与金额划分八类客群。"
    },
    descriptive: {
      label: "描述统计",
      icon: "sigma",
      description: "先理解指标分布，再判断经营结论。均值、中位数和分位数可以帮助识别偏态与极端值影响。"
    },
    group: {
      label: "分组对比",
      icon: "columns-3",
      description: "围绕渠道、品类、日期和小时进行聚合对比，快速定位经营差异。"
    },
    trend: {
      label: "趋势分析",
      icon: "chart-spline",
      description: "围绕电商日期维度按日、周、月观察指标走势，并计算环比和可用时的同比。"
    },
    correlation: {
      label: "相关性",
      icon: "grid-3x3",
      description: "计算数值字段之间的 Pearson 线性相关，并展示共同样本量。相关不等于因果，需要结合业务机制复核。"
    }
  };

  function template() {
    return `
      <div class="section-head">
        <div>
          <h2>电商业务分析器</h2>
          <p>固定读取 DWD 明细宽表，只保留电商业务口径参数。保存结果后自动沉淀到 ADS 应用数据层。</p>
        </div>
        <div class="section-actions">
          <button class="button button-secondary button-small" id="analysis-go-warehouse" type="button">
            <i data-lucide="layers-3" aria-hidden="true"></i>分层数据
          </button>
        </div>
      </div>

      <div id="analysis-empty" hidden>
        ${common.renderEmpty({
          icon: "chart-no-axes-combined",
          title: "DWD 宽表还没有生成",
          description: "固定链路中的所有分析都从 DWD 明细宽表读取。请先在数据处理页一键生成分析宽表。",
          actions: `<button class="button button-primary" id="analysis-go-data" type="button">去生成 DWD 宽表</button>`
        })}
      </div>

      <div id="analysis-workbench" hidden>
        <div class="analysis-source-bar">
          <div class="analysis-source-field">
            <span>分析数据源</span>
            <select class="select" id="analysis-table-select" aria-label="选择数据仓库表"></select>
          </div>
          <div class="analysis-source-meta" id="analysis-table-meta"></div>
          <div class="analysis-source-count">
            <strong id="analysis-saved-count">0</strong>
            <span>已保存分析</span>
          </div>
        </div>

        <div class="analysis-type-tabs" id="analysis-type-tabs" role="tablist" aria-label="分析类型"></div>

        <div class="analysis-workspace">
          <aside class="analysis-config-card">
            <div class="analysis-brief" id="analysis-brief"></div>
            <form id="analysis-config-form" novalidate></form>
            <div class="analysis-run-footer">
              <button class="button button-primary" id="run-analysis-button" type="button">
                <i data-lucide="play" aria-hidden="true"></i>运行分析
              </button>
              <span>配置会随结果保存</span>
            </div>
          </aside>

          <section class="analysis-result-card" id="analysis-result-panel">
            <div class="analysis-result-empty">
              <div class="analysis-result-empty-icon"><i data-lucide="chart-no-axes-combined" aria-hidden="true"></i></div>
              <strong>配置分析口径后运行</strong>
              <span>结果会展示指标、图表、明细和本次口径摘要。</span>
            </div>
          </section>
        </div>

        <section class="subpanel analysis-history-panel">
          <div class="subpanel-header">
            <strong>已保存的分析记录</strong>
            <small>供报告模块复用配置与关键指标</small>
          </div>
          <div class="subpanel-body" id="analysis-history"></div>
        </section>
      </div>
    `;
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    root = document.getElementById("view-analysis");
    root.innerHTML = template();
    bindEvents();
    App.state.subscribe("warehouse:changed", () => {
      if (App.ui.router.getCurrentRoute() === "analysis") {
        render();
      }
    });
    App.state.subscribe("dataWarehouse:changed", () => {
      if (App.ui.router.getCurrentRoute() === "analysis") {
        render();
      }
    });
    render();
  }

  function bindEvents() {
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChange);
  }

  function handleClick(event) {
    const target = event.target.closest("button");
    if (!target) {
      return;
    }
    if (target.id === "analysis-go-data") {
      App.ui.router.navigate("data");
      return;
    }
    if (target.id === "analysis-go-warehouse") {
      App.ui.router.navigate("warehouse");
      return;
    }
    if (target.dataset.analysisType) {
      currentType = target.dataset.analysisType;
      currentResult = null;
      currentSaved = false;
      renderTabs();
      renderConfig();
      renderResult();
      return;
    }
    if (target.id === "run-analysis-button") {
      runAnalysis();
      return;
    }
    if (target.id === "add-funnel-step") {
      addFunnelStep();
      return;
    }
    if (target.id === "fill-standard-funnel") {
      fillStandardFunnel();
      return;
    }
    if (target.dataset.removeStep !== undefined) {
      removeFunnelStep(Number(target.dataset.removeStep));
      return;
    }
    if (target.id === "save-analysis-button") {
      saveCurrentAnalysis();
      return;
    }
    if (target.dataset.loadSavedAnalysis) {
      loadSavedResult(target.dataset.loadSavedAnalysis);
      return;
    }
    if (target.dataset.deleteSavedAnalysis) {
      deleteSavedAnalysis(target.dataset.deleteSavedAnalysis);
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (target.id === "analysis-table-select") {
      currentTableId = global.dataWarehouse.dwd?.id || "";
      currentTable = global.dataWarehouse.dwd;
      currentResult = null;
      currentSaved = false;
      App.state.emit("assistant:context-changed", {
        source: "analysis-table",
        tableId: currentTableId
      });
      renderTableMeta();
      renderConfig();
      renderResult();
      renderHistory();
      return;
    }
    if (target.id === "rfm-r-strategy") {
      toggleRfmThresholds();
      return;
    }
    if (target.id === "group-aggregate-method") {
      toggleGroupMetric(target.value);
    }
  }

  function render() {
    if (!root) {
      return;
    }
    const dwd = global.dataWarehouse.dwd;
    const tables = dwd ? [{
      id: dwd.id,
      name: dwd.name,
      version: dwd.version,
      rowCount: dwd.rows.length
    }] : [];
    const empty = document.getElementById("analysis-empty");
    const workbench = document.getElementById("analysis-workbench");
    if (!tables.length) {
      empty.hidden = false;
      workbench.hidden = true;
      currentTable = null;
      common.refreshIcons(root);
      return;
    }

    empty.hidden = true;
    workbench.hidden = false;
    const select = document.getElementById("analysis-table-select");
    if (currentTableId !== dwd.id) {
      currentTableId = dwd.id;
      currentResult = null;
      currentSaved = false;
    }
    select.disabled = true;
    select.innerHTML = `<option value="${utils.escapeHtml(dwd.id)}" selected>${utils.escapeHtml(dwd.name)} · DWD · ${dwd.rows.length} 行</option>`;
    currentTable = dwd;
    renderTableMeta();
    renderTabs();
    renderConfig();
    renderResult();
    renderHistory();
    common.refreshIcons(root);
  }

  function renderTableMeta() {
    const meta = document.getElementById("analysis-table-meta");
    const count = document.getElementById("analysis-saved-count");
    if (!meta || !currentTable) {
      return;
    }
    const quality = currentTable.quality ? currentTable.quality.score.toFixed(1) : "—";
    meta.innerHTML = `
      <span><i data-lucide="rows-3" aria-hidden="true"></i>${currentTable.rows.length.toLocaleString("zh-CN")} 行</span>
      <span><i data-lucide="columns-3" aria-hidden="true"></i>${currentTable.schema.length} 列</span>
      <span><i data-lucide="shield-check" aria-hidden="true"></i>质量 ${quality}</span>
    `;
    if (count) {
      count.textContent = App.analysis.store.count(currentTable.id);
    }
    common.updateGlobalContext(currentTable);
    common.refreshIcons(meta);
  }

  function renderTabs() {
    const tabs = document.getElementById("analysis-type-tabs");
    tabs.innerHTML = Object.entries(typeMeta).map(([key, meta]) => `
      <button class="analysis-type-tab ${key === currentType ? "active" : ""}" type="button"
        role="tab" aria-selected="${key === currentType}" data-analysis-type="${key}">
        <i data-lucide="${meta.icon}" aria-hidden="true"></i>
        <span>${meta.label}</span>
      </button>
    `).join("");
    common.refreshIcons(tabs);
  }

  function renderConfig() {
    if (!currentTable) {
      return;
    }
    const meta = typeMeta[currentType];
    const brief = document.getElementById("analysis-brief");
    brief.innerHTML = `
      <div class="analysis-brief-icon"><i data-lucide="${meta.icon}" aria-hidden="true"></i></div>
      <div><strong>${meta.label}</strong><p>${meta.description}</p></div>
    `;
    const form = document.getElementById("analysis-config-form");
    if (currentType === "retention") {
      form.innerHTML = retentionForm();
    } else if (currentType === "funnel") {
      form.innerHTML = funnelForm();
      renderFunnelSteps();
    } else if (currentType === "rfm") {
      form.innerHTML = rfmForm();
      toggleRfmThresholds();
    } else if (currentType === "descriptive") {
      form.innerHTML = descriptiveForm();
    } else if (currentType === "group") {
      form.innerHTML = groupForm();
      toggleGroupMetric(fieldValue("group-aggregate-method"));
    } else if (currentType === "trend") {
      form.innerHTML = trendForm();
    } else if (currentType === "correlation") {
      form.innerHTML = correlationForm();
    }
    common.refreshIcons(root);
  }

  function optionList(fields, selected, includeAll, allLabel) {
    return `${includeAll ? `<option value="">${utils.escapeHtml(allLabel || "不使用")}</option>` : ""}${fields.map((field) => `
      <option value="${utils.escapeHtml(field.key)}" ${field.key === selected ? "selected" : ""}>
        ${utils.escapeHtml(field.key)} · ${analysisCommon.formatFieldType(field)}
      </option>
    `).join("")}`;
  }

  function fieldSelect(id, label, fields, selected, options) {
    const config = options || {};
    return `
      <label class="form-field">
        <span class="form-label">${label}</span>
        <select class="select" id="${id}">
          ${optionList(fields, selected, config.includeAll, config.allLabel)}
        </select>
        ${config.hint ? `<span class="form-hint">${config.hint}</span>` : ""}
      </label>
    `;
  }

  function findKey(table, patterns, fallbackFields) {
    const fields = fallbackFields || table.schema;
    for (const pattern of patterns) {
      const match = fields.find((field) => pattern.test(field.key));
      if (match) {
        return match.key;
      }
    }
    return fields[0] ? fields[0].key : "";
  }

  function eventFieldKey() {
    return findKey(
      currentTable,
      [/^event$/i, /event|action|behavior|行为|事件/i],
      currentTable.schema.filter((field) => ["category", "text"].includes(field.type))
    );
  }

  function numericFieldKey() {
    return analysisCommon.defaultField(
      currentTable,
      ["number"],
      ["amount", "gmv", "sales", "revenue", "price", "金额", "销售额"]
    );
  }

  function retentionForm() {
    return `
      <div class="analysis-form-grid compact-grid">
        <label class="form-field">
          <span class="form-label">留存口径</span>
          <select class="select" id="retention-behavior">
            <option value="all" selected>任意行为</option>
            <option value="purchase">仅支付行为</option>
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">时间粒度</span>
          <select class="select" id="retention-granularity">
            <option value="day" selected>按日留存</option>
            <option value="week">按周留存</option>
          </select>
        </label>
      </div>
    `;
  }

  function funnelEventValues() {
    const eventField = currentTable.schema.some((field) => field.key === "event")
      ? "event"
      : eventFieldKey();
    if (!eventField) {
      return [];
    }
    const preferred = ["view", "browse", "add_cart", "checkout", "purchase", "pay"];
    return analysisCommon.frequencyValues(currentTable, eventField)
      .sort((left, right) => {
        const leftIndex = preferred.indexOf(left.value.toLowerCase());
        const rightIndex = preferred.indexOf(right.value.toLowerCase());
        if (leftIndex >= 0 || rightIndex >= 0) {
          return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
        }
        return right.count - left.count;
      })
      .map((item) => item.value);
  }

  function funnelForm() {
    return `
      <div class="analysis-form-grid compact-grid">
        <label class="form-field">
          <span class="form-label">转化窗口期</span>
          <select class="select" id="funnel-window-days">
            <option value="1">1 天</option>
            <option value="3">3 天</option>
            <option value="7" selected>7 天</option>
          </select>
        </label>
        <div class="form-field" style="align-content:end">
          <button class="button button-secondary" id="fill-standard-funnel" type="button">
            <i data-lucide="route" aria-hidden="true"></i>一键填入标准电商漏斗
          </button>
        </div>
      </div>
      <div class="funnel-step-section">
        <div class="funnel-step-head">
          <div><strong>漏斗步骤</strong><span>按发生顺序选择 2–5 个事件值</span></div>
          <button class="button button-quiet button-small" id="add-funnel-step" type="button">
            <i data-lucide="plus" aria-hidden="true"></i>添加步骤
          </button>
        </div>
        <div class="funnel-steps" id="funnel-steps"></div>
      </div>
    `;
  }

  function renderFunnelSteps(eventFieldValue) {
    const container = document.getElementById("funnel-steps");
    if (!container || !currentTable) {
      return;
    }
    const eventField = eventFieldValue
      || (currentTable.schema.some((field) => field.key === "event") ? "event" : eventFieldKey());
    const values = analysisCommon.frequencyValues(currentTable, eventField)
      .sort((left, right) => {
        const preferred = ["view", "browse", "add_cart", "checkout", "purchase", "pay"];
        const leftIndex = preferred.indexOf(left.value.toLowerCase());
        const rightIndex = preferred.indexOf(right.value.toLowerCase());
        if (leftIndex >= 0 || rightIndex >= 0) {
          return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
        }
        return right.count - left.count;
      })
      .map((item) => item.value);
    const existing = Array.from(container.querySelectorAll(".funnel-step-select"))
      .map((select) => select.value)
      .filter((value) => values.includes(value));
    const stepCount = Math.min(5, Math.max(2, existing.length || 3));
    const steps = existing.length >= 2
      ? existing.slice(0, stepCount)
      : values.slice(0, stepCount);
    while (steps.length < 2 && values.length >= 2) {
      steps.push(values[steps.length]);
    }
    container.innerHTML = steps.map((step, index) => `
      <div class="funnel-step-row">
        <span class="funnel-step-number">${index + 1}</span>
        <select class="select funnel-step-select" aria-label="漏斗第 ${index + 1} 步">
          ${values.map((value) => `<option value="${utils.escapeHtml(value)}" ${value === step ? "selected" : ""}>${utils.escapeHtml(value)}</option>`).join("")}
        </select>
        <button class="icon-button funnel-remove" type="button" data-remove-step="${index}" aria-label="删除第 ${index + 1} 步" ${steps.length <= 2 ? "disabled" : ""}>
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
    `).join("");
    const addButton = document.getElementById("add-funnel-step");
    if (addButton) {
      addButton.disabled = steps.length >= 5 || values.length < 3;
    }
    common.refreshIcons(container);
  }

  function addFunnelStep() {
    const container = document.getElementById("funnel-steps");
    if (!container || container.children.length >= 5) {
      return;
    }
    const selects = Array.from(container.querySelectorAll(".funnel-step-select"));
    const values = funnelEventValues();
    const unused = values.find((value) => !selects.some((select) => select.value === value)) || values[0];
    if (!unused) {
      return;
    }
    const row = document.createElement("div");
    row.className = "funnel-step-row";
    row.innerHTML = `
      <span class="funnel-step-number">${container.children.length + 1}</span>
      <select class="select funnel-step-select" aria-label="漏斗第 ${container.children.length + 1} 步">
        ${values.map((value) => `<option value="${utils.escapeHtml(value)}" ${value === unused ? "selected" : ""}>${utils.escapeHtml(value)}</option>`).join("")}
      </select>
      <button class="icon-button funnel-remove" type="button" data-remove-step="${container.children.length}" aria-label="删除步骤">
        <i data-lucide="x" aria-hidden="true"></i>
      </button>
    `;
    container.appendChild(row);
    updateFunnelRemoveStates();
    document.getElementById("add-funnel-step").disabled = container.children.length >= 5;
    common.refreshIcons(row);
  }

  function fillStandardFunnel() {
    const container = document.getElementById("funnel-steps");
    if (!container) {
      return;
    }
    const values = funnelEventValues();
    const standardSteps = ["view", "add_cart", "purchase"];
    const missing = standardSteps.filter((step) => !values.includes(step));
    if (missing.length) {
      common.toast(`当前数据缺少标准事件：${missing.join("、")}`, "warning");
      return;
    }
    container.innerHTML = standardSteps.map((step, index) => `
      <div class="funnel-step-row">
        <span class="funnel-step-number">${index + 1}</span>
        <select class="select funnel-step-select" aria-label="漏斗第 ${index + 1} 步">
          ${values.map((value) => `<option value="${utils.escapeHtml(value)}" ${value === step ? "selected" : ""}>${utils.escapeHtml(value)}</option>`).join("")}
        </select>
        <button class="icon-button funnel-remove" type="button" data-remove-step="${index}" aria-label="删除第 ${index + 1} 步">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
    `).join("");
    updateFunnelRemoveStates();
    document.getElementById("add-funnel-step").disabled = false;
    common.refreshIcons(container);
    common.toast("已填入标准电商漏斗：浏览 → 加购 → 支付。", "success");
  }

  function removeFunnelStep(index) {
    const container = document.getElementById("funnel-steps");
    if (!container || container.children.length <= 2 || !container.children[index]) {
      return;
    }
    container.children[index].remove();
    Array.from(container.querySelectorAll(".funnel-step-number")).forEach((node, rowIndex) => {
      node.textContent = rowIndex + 1;
    });
    Array.from(container.querySelectorAll(".funnel-remove")).forEach((button, rowIndex) => {
      button.dataset.removeStep = rowIndex;
      button.setAttribute("aria-label", `删除第 ${rowIndex + 1} 步`);
    });
    updateFunnelRemoveStates();
    document.getElementById("add-funnel-step").disabled = false;
  }

  function updateFunnelRemoveStates() {
    const container = document.getElementById("funnel-steps");
    if (!container) {
      return;
    }
    const buttons = Array.from(container.querySelectorAll(".funnel-remove"));
    buttons.forEach((button) => {
      button.disabled = container.children.length <= 2;
    });
  }

  function rfmForm() {
    return `
      <div class="analysis-form-grid compact-grid">
        <label class="form-field">
          <span class="form-label">R 值分箱策略</span>
          <select class="select" id="rfm-r-strategy">
            <option value="quantile" selected>按分位数</option>
            <option value="fixed">按固定阈值</option>
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">F 值分箱策略</span>
          <select class="select" id="rfm-f-strategy" disabled>
            <option value="quantile" selected>按分位数</option>
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">M 值分箱策略</span>
          <select class="select" id="rfm-m-strategy" disabled>
            <option value="quantile" selected>按分位数</option>
          </select>
        </label>
        <label class="form-field" data-rfm-fixed-fields hidden>
          <span class="form-label">R 高：距今天数 ≤</span>
          <input class="input" id="rfm-r-threshold" type="number" min="0" value="14">
        </label>
      </div>
    `;
  }

  function toggleRfmThresholds() {
    const fixed = formElement().querySelector("[data-rfm-fixed-fields]");
    if (fixed) {
      fixed.hidden = fieldValue("rfm-r-strategy") !== "fixed";
    }
  }

  function descriptiveForm() {
    const numbers = currentTable.schema.filter((field) => field.type === "number");
    return `
      <div class="analysis-form-grid">
        ${fieldSelect("descriptive-field", "待统计数值列", numbers, numericFieldKey())}
        <label class="form-field">
          <span class="form-label">直方图分组数</span>
          <select class="select" id="descriptive-bin-count">
            <option value="">自动（Sturges）</option>
            <option value="5">5 组</option>
            <option value="8">8 组</option>
            <option value="10">10 组</option>
            <option value="12">12 组</option>
          </select>
        </label>
      </div>
    `;
  }

  function groupForm() {
    const businessDimensions = [
      { key: "channel", label: "渠道" },
      { key: "category", label: "品类" },
      { key: "date", label: "日期" },
      { key: "hour", label: "小时" }
    ].filter((item) => currentTable.schema.some((field) => field.key === item.key));
    const metrics = currentTable.schema;
    return `
      <div class="analysis-form-grid compact-grid">
        <label class="form-field">
          <span class="form-label">分组维度</span>
          <select class="select" id="group-dimension-field">
            ${businessDimensions.map((item) => `<option value="${item.key}">${item.key} · ${item.label}</option>`).join("")}
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">聚合方式</span>
          <select class="select" id="group-aggregate-method">
            <option value="sum">求和</option>
            <option value="avg">均值</option>
            <option value="count">计数（行数）</option>
            <option value="distinct">去重计数</option>
          </select>
        </label>
        ${fieldSelect("group-metric-field", "对比指标", metrics, numericFieldKey())}
        <label class="form-field">
          <span class="form-label">展示范围</span>
          <select class="select" id="group-top-n">
            <option value="5">Top 5</option>
            <option value="10" selected>Top 10</option>
            <option value="20">Top 20</option>
            <option value="all">全部分组</option>
          </select>
        </label>
      </div>
    `;
  }

  function toggleGroupMetric(method) {
    const metric = document.getElementById("group-metric-field");
    if (metric) {
      metric.disabled = method === "count";
    }
  }

  function trendForm() {
    const businessTimes = [
      { key: "date", label: "日期" }
    ].filter((item) => currentTable.schema.some((field) => field.key === item.key));
    const metrics = currentTable.schema;
    return `
      <div class="analysis-form-grid compact-grid">
        <label class="form-field">
          <span class="form-label">时间维度</span>
          <select class="select" id="trend-time-field">
            ${businessTimes.map((item) => `<option value="${item.key}">${item.key} · ${item.label}</option>`).join("")}
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">时间粒度</span>
          <select class="select" id="trend-granularity">
            <option value="day">按日</option>
            <option value="week" selected>按周</option>
            <option value="month">按月</option>
          </select>
        </label>
        ${fieldSelect("trend-metric-field", "趋势指标", metrics, numericFieldKey())}
        <label class="form-field">
          <span class="form-label">聚合方式</span>
          <select class="select" id="trend-aggregate-method">
            <option value="sum" selected>求和</option>
            <option value="avg">均值</option>
            <option value="count">计数（行数）</option>
            <option value="distinct">去重计数</option>
          </select>
        </label>
      </div>
    `;
  }

  function correlationForm() {
    const numbers = currentTable.schema.filter((field) => field.type === "number");
    const selected = new Set(numbers.slice(0, Math.min(4, numbers.length)).map((field) => field.key));
    return `
      <div class="form-field">
        <span class="form-label">选择数值字段（2–10 个）</span>
        <div class="checkbox-row correlation-fields">
          ${numbers.map((field) => `
            <label class="checkbox-tile">
              <input type="checkbox" value="${utils.escapeHtml(field.key)}" ${selected.has(field.key) ? "checked" : ""}>
              <span>${utils.escapeHtml(field.key)}</span>
            </label>
          `).join("")}
        </div>
      </div>
    `;
  }

  function fieldValue(id) {
    const element = document.getElementById(id);
    return element ? element.value : "";
  }

  function formElement() {
    return document.getElementById("analysis-config-form");
  }

  function collectConfig() {
    if (currentType === "retention") {
      const granularity = fieldValue("retention-granularity");
      return {
        userIdField: "user_id",
        timeField: "time",
        eventField: "event",
        eventValue: fieldValue("retention-behavior") === "purchase" ? "purchase" : "__all__",
        retentionMode: granularity === "week" ? "weekly" : "daily",
        cohortGranularity: granularity,
        horizon: granularity === "week" ? 8 : 30
      };
    }
    if (currentType === "funnel") {
      return {
        userIdField: "user_id",
        timeField: "time",
        eventField: "event",
        steps: Array.from(root.querySelectorAll(".funnel-step-select")).map((select) => select.value),
        windowDays: Number(fieldValue("funnel-window-days"))
      };
    }
    if (currentType === "rfm") {
      const snapshotDate = currentTable.rows
        .map((row) => row.time || row.date)
        .filter(Boolean)
        .sort()
        .pop();
      return {
        userIdField: "user_id",
        timeField: "time",
        amountField: "amount",
        eventField: "event",
        eventValue: "purchase",
        snapshotDate,
        scoringMethod: fieldValue("rfm-r-strategy"),
        rScoringMethod: fieldValue("rfm-r-strategy"),
        fScoringMethod: "quantile",
        mScoringMethod: "quantile",
        quantileCut: 60,
        rThresholdMax: Number(fieldValue("rfm-r-threshold")),
        fThresholdMin: null,
        mThresholdMin: null
      };
    }
    if (currentType === "descriptive") {
      return {
        metricField: fieldValue("descriptive-field"),
        binCount: fieldValue("descriptive-bin-count")
          ? Number(fieldValue("descriptive-bin-count"))
          : null
      };
    }
    if (currentType === "group") {
      return {
        dimensionField: fieldValue("group-dimension-field"),
        metricField: fieldValue("group-metric-field"),
        aggregateMethod: fieldValue("group-aggregate-method"),
        topN: fieldValue("group-top-n")
      };
    }
    if (currentType === "trend") {
      return {
        timeField: fieldValue("trend-time-field"),
        metricField: fieldValue("trend-metric-field"),
        granularity: fieldValue("trend-granularity"),
        aggregateMethod: fieldValue("trend-aggregate-method")
      };
    }
    return {
      fields: Array.from(root.querySelectorAll(".correlation-fields input:checked")).map((input) => input.value)
    };
  }

  function runAnalysis() {
    if (!currentTable) {
      common.toast("请先生成 DWD 明细宽表。", "warning");
      return;
    }
    const button = document.getElementById("run-analysis-button");
    common.setButtonLoading(button, true, "正在计算…");
    global.setTimeout(() => {
      try {
        const config = collectConfig();
        const result = App.analysis.engine.run(currentType, currentTable, config);
        currentResult = result;
        currentSaved = false;
        renderResult();
        renderTableMeta();
        common.toast(`${typeMeta[currentType].label}已完成，结果已加入本次会话上下文。`, "success");
      } catch (error) {
        common.toast(error.message, "error", 5200);
      } finally {
        common.setButtonLoading(button, false);
      }
    }, 30);
  }

  function renderResult() {
    const panel = document.getElementById("analysis-result-panel");
    if (!panel) {
      return;
    }
    if (!currentResult) {
      panel.innerHTML = `
        <div class="analysis-result-empty">
          <div class="analysis-result-empty-icon"><i data-lucide="chart-no-axes-combined" aria-hidden="true"></i></div>
          <strong>配置分析口径后运行</strong>
          <span>结果会展示指标、图表、明细和本次口径摘要。</span>
        </div>
      `;
      common.refreshIcons(panel);
      return;
    }
    const result = currentResult;
    const meta = typeMeta[result.type];
    const warnings = result.warnings || [];
    panel.innerHTML = `
      <div class="analysis-result-header">
        <div>
          <div class="analysis-result-kicker">${utils.escapeHtml(meta.label)} · ${utils.escapeHtml(result.tableName)} v${result.tableVersion}</div>
          <h3>${utils.escapeHtml(result.title)}</h3>
          <span>${utils.formatDateTime(result.createdAt)}</span>
        </div>
        <div class="analysis-result-actions">
          <span class="status-badge ${currentSaved ? "success" : "neutral"}" id="analysis-save-status">${currentSaved ? "已保存" : "本次会话"}</span>
          <button class="button button-secondary button-small" id="save-analysis-button" type="button" ${currentSaved ? "disabled" : ""}>
            <i data-lucide="${currentSaved ? "check" : "bookmark-plus"}" aria-hidden="true"></i>${currentSaved ? "已保存" : "保存分析记录"}
          </button>
        </div>
      </div>
      <div class="analysis-config-summary">
        ${result.configSummary.map((item) => `
          <div><span>${utils.escapeHtml(item.label)}</span><strong>${utils.escapeHtml(item.value)}</strong></div>
        `).join("")}
      </div>
      ${warnings.length ? `
        <div class="analysis-warnings">
          ${warnings.map((warning) => `
            <div class="notice warning"><i data-lucide="triangle-alert" aria-hidden="true"></i><span>${utils.escapeHtml(warning)}</span></div>
          `).join("")}
        </div>
      ` : ""}
      <div class="analysis-metric-grid">
        ${result.metrics.map((metric) => `
          <div class="analysis-metric" title="${utils.escapeHtml(metric.definition)}">
            <span>${utils.escapeHtml(metric.label)}</span>
            <strong>${utils.escapeHtml(metric.formatted)}${metric.unit ? `<small>${utils.escapeHtml(metric.unit)}</small>` : ""}</strong>
            <small>${utils.escapeHtml(metric.definition)}</small>
          </div>
        `).join("")}
      </div>
      <div class="analysis-chart-card">
        <div class="analysis-chart-head">
          <div>
            <strong>${utils.escapeHtml(result.chartSpec.title)}</strong>
            <span>${utils.escapeHtml(result.chartSpec.subtitle || "")}</span>
          </div>
          <small id="analysis-chart-provider">${App.charts.provider()}</small>
        </div>
        <div class="analysis-chart" id="analysis-chart" role="img" aria-label="${utils.escapeHtml(result.chartSpec.title)}"></div>
      </div>
      ${renderResultTable(result.resultTable, "结果明细")}
      ${result.summaryTable ? `
        <details class="analysis-secondary-table">
          <summary>${utils.escapeHtml(result.summaryTable.title)}</summary>
          ${renderTableMarkup(result.summaryTable, 100)}
        </details>
      ` : ""}
      ${App.sql.renderSQLBlock(result)}
    `;
    const chartContainer = document.getElementById("analysis-chart");
    App.charts.render(chartContainer, result.chartSpec, { key: `analysis:${result.id}` });
    const provider = document.getElementById("analysis-chart-provider");
    if (provider) {
      provider.textContent = App.charts.provider();
    }
    common.refreshIcons(panel);
  }

  function renderResultTable(table, title) {
    if (!table) {
      return "";
    }
    return `
      <div class="analysis-table-card">
        <div class="analysis-table-head">
          <strong>${utils.escapeHtml(title)}</strong>
          <span>共 ${(table.totalRows ?? table.rows.length).toLocaleString("zh-CN")} 行${table.rows.length < (table.totalRows ?? table.rows.length) ? ` · 当前最多展示 ${table.rows.length} 行` : ""}</span>
        </div>
        ${renderTableMarkup(table, 50)}
      </div>
    `;
  }

  function renderTableMarkup(table, limit) {
    if (!table || !table.columns || !table.rows) {
      return "";
    }
    const rows = table.rows.slice(0, limit || 50);
    return `
      <div class="table-scroll analysis-table-scroll">
        <table class="data-table analysis-data-table">
          <thead>
            <tr>${table.columns.map((column) => `<th class="${column.align === "right" ? "number-cell" : ""}">${utils.escapeHtml(column.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${table.columns.map((column) => {
                  const value = row[column.key];
                  let text = utils.isMissing(value) ? "—" : String(value);
                  let className = column.align === "right" ? "number-cell" : "";
                  if (!utils.isMissing(value)) {
                    if (column.type === "percent") {
                      text = utils.formatPercent(value, 1);
                    } else if (column.type === "number") {
                      text = utils.formatNumber(value, { maximumFractionDigits: 2 });
                    } else if (column.type === "correlation") {
                      text = Number(value).toFixed(3);
                      const numeric = Number(value);
                      if (numeric >= 0.5) {
                        className += " correlation-strong-positive";
                      } else if (numeric <= -0.5) {
                        className += " correlation-strong-negative";
                      }
                    }
                  }
                  return `<td class="${className}" title="${utils.escapeHtml(text)}">${utils.escapeHtml(text)}</td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function saveCurrentAnalysis() {
    if (!currentResult || currentSaved) {
      return;
    }
    const button = document.getElementById("save-analysis-button");
    common.setButtonLoading(button, true, "正在保存…");
    try {
      const saved = App.analysis.engine.save(currentResult);
      currentResult = saved.record;
      currentSaved = true;
      global.dataWarehouse.addAds(saved.record);
      renderResult();
      renderTableMeta();
      renderHistory();
      common.toast(
        saved.persistent
          ? "分析记录已保存，可在后续报告模块中引用。"
          : "分析记录已保存在本次会话内存中，浏览器未允许持久化。",
        saved.persistent ? "success" : "warning"
      );
    } catch (error) {
      common.toast(error.message, "error");
    }
  }

  function renderHistory() {
    const container = document.getElementById("analysis-history");
    if (!container || !currentTable) {
      return;
    }
    const records = App.analysis.store.list(currentTable.id);
    if (!records.length) {
      container.innerHTML = `
        <div class="notice"><i data-lucide="history" aria-hidden="true"></i><span>还没有保存的分析记录。运行分析后点击“保存分析记录”，即可供报告模块复用。</span></div>
      `;
      common.refreshIcons(container);
      return;
    }
    container.innerHTML = `
      <div class="analysis-history-list">
        ${records.map((record) => `
          <article class="analysis-history-item">
            <div>
              <div class="analysis-history-title">
                <strong>${utils.escapeHtml(record.title)}</strong>
                <span class="status-badge neutral">${utils.escapeHtml(typeMeta[record.type] ? typeMeta[record.type].label : record.type)}</span>
              </div>
              <div class="analysis-history-meta">
                <span>${utils.formatDateTime(record.savedAt)}</span>
                <span>${record.metrics.slice(0, 3).map((metric) => `${utils.escapeHtml(metric.label)} ${utils.escapeHtml(metric.formatted)}`).join(" · ")}</span>
              </div>
            </div>
            <div class="analysis-history-actions">
              <button class="button button-quiet button-small" type="button" data-load-saved-analysis="${record.id}">查看</button>
              <button class="icon-button" type="button" data-delete-saved-analysis="${record.id}" aria-label="删除分析记录">
                <i data-lucide="trash-2" aria-hidden="true"></i>
              </button>
            </div>
          </article>
        `).join("")}
      </div>
    `;
    common.refreshIcons(container);
  }

  function loadSavedResult(id) {
    const record = App.analysis.store.get(id);
    if (!record) {
      common.toast("分析记录不存在。", "error");
      return;
    }
    currentType = record.type;
    currentResult = record;
    currentSaved = true;
    renderTabs();
    renderConfig();
    renderResult();
    document.getElementById("analysis-result-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deleteSavedAnalysis(id) {
    const record = App.analysis.store.get(id);
    if (!record) {
      return;
    }
    const proceed = await common.confirm({
      title: "删除分析记录？",
      message: `“${record.title}”将从已保存分析中移除，不影响数据仓库表。`,
      confirmText: "删除记录",
      danger: true
    });
    if (!proceed) {
      return;
    }
    App.analysis.store.remove(id);
    if (currentResult && currentResult.id === id) {
      currentSaved = false;
    }
    renderTableMeta();
    renderHistory();
    renderResult();
    common.toast("分析记录已删除。", "success");
  }

  App.ui.analysisView = {
    init,
    render,
    getSelectedTable: () => currentTable
  };
})(window);
