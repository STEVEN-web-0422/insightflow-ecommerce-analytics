(function bootstrapHistoryView(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const common = App.ui;
  let root = null;
  let initialized = false;

  const analysisLabels = {
    retention: "留存分析",
    funnel: "漏斗分析",
    rfm: "RFM 分层",
    descriptive: "描述统计",
    group: "分组对比",
    trend: "趋势分析",
    correlation: "相关性分析"
  };

  function template() {
    return `
      <div class="section-head">
        <div>
          <h2>分析历史与成果复盘</h2>
          <p>汇总本会话运行过的分析、已保存结果、数据表与报告快照，方便面试演示时快速回到关键结论。</p>
        </div>
        <div class="section-actions">
          <button class="button button-secondary button-small" id="history-go-analysis" type="button">
            <i data-lucide="chart-no-axes-combined" aria-hidden="true"></i>继续分析
          </button>
        </div>
      </div>
      <div id="history-empty" hidden>
        ${common.renderEmpty({
          icon: "history",
          title: "还没有可复盘的分析成果",
          description: "先生成固定 DWD 宽表并运行业务分析。分析记录、报告和 ADS 结果都会在这里集中展示。",
          actions: `<button class="button button-primary" id="history-start-button" type="button">生成 DWD 宽表</button>`
        })}
      </div>
      <div id="history-workbench" hidden>
        <div class="metric-grid">
          <div class="metric-card">
            <span class="metric-card-label">分析记录<i data-lucide="chart-no-axes-combined" aria-hidden="true"></i></span>
            <strong class="metric-card-value" id="history-analysis-count">0</strong>
            <span class="metric-card-sub" id="history-analysis-sub">本会话 + 已保存</span>
          </div>
          <div class="metric-card">
            <span class="metric-card-label">数据表<i data-lucide="database" aria-hidden="true"></i></span>
            <strong class="metric-card-value" id="history-table-count">0</strong>
            <span class="metric-card-sub">可用于重新分析</span>
          </div>
          <div class="metric-card">
            <span class="metric-card-label">报告快照<i data-lucide="file-chart-column" aria-hidden="true"></i></span>
            <strong class="metric-card-value" id="history-report-count">0</strong>
            <span class="metric-card-sub">最近生成的报告</span>
          </div>
          <div class="metric-card">
            <span class="metric-card-label">最近活动<i data-lucide="clock-3" aria-hidden="true"></i></span>
            <strong class="metric-card-value history-recent-activity" id="history-last-time">—</strong>
            <span class="metric-card-sub">分析或报告更新时间</span>
          </div>
        </div>

        <section class="history-section">
          <div class="history-section-head">
            <div><strong>分析记录</strong><span>点击记录可回看指标、图表和结果表</span></div>
            <span class="status-badge neutral" id="history-saved-analysis-count">0 条已保存</span>
          </div>
          <div class="history-analysis-list" id="history-analysis-list"></div>
        </section>

        <section class="history-section">
          <div class="history-section-head">
            <div><strong>DWD 宽表</strong><span>唯一固定的分析数据源</span></div>
            <button class="button button-quiet button-small" id="history-open-warehouse" type="button">查看分层数据</button>
          </div>
          <div class="history-table-list" id="history-table-list"></div>
        </section>

        <section class="history-section">
          <div class="history-section-head">
            <div><strong>报告记录</strong><span>最近生成的 AI 报告或本地演示底稿</span></div>
            <span class="status-badge neutral" id="history-report-limit">最多保留 5 份</span>
          </div>
          <div class="history-report-list" id="history-report-list"></div>
        </section>
      </div>
    `;
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    root = document.getElementById("view-history");
    root.innerHTML = template();
    root.addEventListener("click", handleClick);
    ["analysis:run", "warehouse:changed", "dataWarehouse:changed", "reports:changed", "ads:changed"].forEach((eventName) => {
      App.state.subscribe(eventName, () => {
        if (App.ui.router.getCurrentRoute() === "history") {
          render();
        }
      });
    });
    render();
  }

  /**
   * 合并本会话分析记录和 localStorage 中保存的分析记录。
   * 同一 ID 优先使用本会话版本，因为它可能包含比持久化预览更完整的结果表。
   */
  function collectAnalyses() {
    const records = new Map();
    const dwdId = global.dataWarehouse.dwd?.id || null;
    App.analysis.store.list()
      .filter((record) => !dwdId || record.tableId === dwdId)
      .forEach((record) => records.set(record.id, record));
    App.state.getAnalysisRuns().forEach((record) => {
      if (dwdId && record.tableId !== dwdId) {
        return;
      }
      const savedRecord = records.get(record.id);
      records.set(record.id, {
        ...record,
        saved: Boolean(savedRecord?.saved || record.saved),
        savedAt: savedRecord?.savedAt || record.savedAt || null
      });
    });
    return Array.from(records.values())
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  function render() {
    if (!root) {
      return;
    }
    const analyses = collectAnalyses();
    const dwd = global.dataWarehouse.dwd;
    const tables = dwd ? [{
      id: dwd.id,
      name: dwd.name,
      rowCount: dwd.rows.length,
      columnCount: dwd.schema.length,
      qualityScore: dwd.quality ? dwd.quality.score : null,
      updatedAt: dwd.updatedAt,
      version: dwd.version
    }] : [];
    const reports = App.ai.reportStore.list();
    const hasContent = analyses.length || tables.length || reports.length;
    const empty = document.getElementById("history-empty");
    const workbench = document.getElementById("history-workbench");
    empty.hidden = Boolean(hasContent);
    workbench.hidden = !hasContent;
    if (!hasContent) {
      common.refreshIcons(root);
      return;
    }

    document.getElementById("history-analysis-count").textContent = analyses.length;
    document.getElementById("history-table-count").textContent = tables.length;
    document.getElementById("history-report-count").textContent = reports.length;
    document.getElementById("history-saved-analysis-count").textContent =
      `${analyses.filter((record) => record.saved).length} 条已保存`;
    const timestamps = [
      ...analyses.map((record) => record.createdAt),
      ...reports.map((report) => report.createdAt)
    ].filter(Boolean).sort();
    document.getElementById("history-last-time").textContent = timestamps.length
      ? utils.formatDateTime(timestamps[timestamps.length - 1])
      : "—";

    renderAnalyses(analyses);
    renderTables(tables);
    renderReports(reports);
    common.refreshIcons(root);
  }

  function renderAnalyses(analyses) {
    const container = document.getElementById("history-analysis-list");
    if (!analyses.length) {
      container.innerHTML = `
        <div class="history-empty-row">
          <i data-lucide="chart-no-axes-combined" aria-hidden="true"></i>
          <div><strong>还没有分析记录</strong><span>运行留存、漏斗、RFM 等分析后，会在这里形成可回看的成果卡片。</span></div>
          <button class="button button-secondary button-small" type="button" data-history-action="analysis">开始分析</button>
        </div>
      `;
      return;
    }
    container.innerHTML = analyses.map((record) => `
      <button class="history-analysis-card" type="button" data-view-analysis="${utils.escapeHtml(record.id)}">
        <div class="history-card-top">
          <span class="status-badge ${record.saved ? "success" : "neutral"}">${utils.escapeHtml(analysisLabels[record.type] || record.type)}</span>
          <span class="history-card-time">${utils.formatDateTime(record.createdAt)}</span>
        </div>
        <div class="history-card-title">
          <strong>${utils.escapeHtml(record.title)}</strong>
          <i data-lucide="arrow-up-right" aria-hidden="true"></i>
        </div>
        <div class="history-card-source">${utils.escapeHtml(record.tableName)} v${record.tableVersion}</div>
        <div class="history-config-chips">
          ${(record.configSummary || []).slice(0, 4).map((item) => `
            <span>${utils.escapeHtml(item.label)}：${utils.escapeHtml(item.value)}</span>
          `).join("")}
        </div>
        <div class="history-key-metrics">
          ${(record.metrics || []).slice(0, 3).map((metric) => `
            <div><span>${utils.escapeHtml(metric.label)}</span><strong>${utils.escapeHtml(metric.formatted)}</strong></div>
          `).join("")}
        </div>
      </button>
    `).join("");
  }

  function renderTables(tables) {
    const container = document.getElementById("history-table-list");
    if (!tables.length) {
      container.innerHTML = `
        <div class="history-empty-row">
          <i data-lucide="database" aria-hidden="true"></i>
          <div><strong>DWD 宽表尚未生成</strong><span>先在数据处理页运行固定清洗 SOP，生成唯一的分析宽表。</span></div>
          <button class="button button-secondary button-small" type="button" data-history-action="data">生成 DWD 宽表</button>
        </div>
      `;
      return;
    }
    container.innerHTML = tables.map((table) => `
      <article class="history-table-row">
        <div>
          <div class="history-table-name"><i data-lucide="table-2" aria-hidden="true"></i><strong>${utils.escapeHtml(table.name)}</strong><span class="status-badge neutral">v${table.version}</span></div>
          <div class="history-table-meta">
            <span>${table.rowCount.toLocaleString("zh-CN")} 行</span>
            <span>${table.columnCount} 字段</span>
            <span>质量 ${table.qualityScore === null ? "—" : table.qualityScore.toFixed(1)}</span>
            <span>更新 ${utils.formatDateTime(table.updatedAt)}</span>
          </div>
        </div>
        <button class="button button-secondary button-small" type="button" data-open-table="${utils.escapeHtml(table.id)}">打开处理</button>
      </article>
    `).join("");
  }

  function renderReports(reports) {
    const container = document.getElementById("history-report-list");
    if (!reports.length) {
      container.innerHTML = `
        <div class="history-empty-row">
          <i data-lucide="file-chart-column" aria-hidden="true"></i>
          <div><strong>还没有报告快照</strong><span>完成一次分析并在可视化与报告页生成报告后，可在这里重新查看。</span></div>
          <button class="button button-secondary button-small" type="button" data-history-action="report">去生成报告</button>
        </div>
      `;
      return;
    }
    container.innerHTML = reports.map((report) => `
      <button class="history-report-row" type="button" data-view-report="${utils.escapeHtml(report.id)}">
        <div class="history-report-icon"><i data-lucide="file-text" aria-hidden="true"></i></div>
        <div>
          <strong>${utils.escapeHtml(report.title)}</strong>
          <span>${utils.escapeHtml(report.modeLabel)} · ${utils.escapeHtml(report.table ? report.table.name : "未知数据表")} · ${utils.formatDateTime(report.createdAt)}</span>
        </div>
        <i data-lucide="chevron-right" aria-hidden="true"></i>
      </button>
    `).join("");
  }

  function handleClick(event) {
    const target = event.target.closest("button");
    if (!target) {
      return;
    }
    if (target.id === "history-go-analysis" || target.dataset.historyAction === "analysis") {
      App.ui.router.navigate("analysis");
      return;
    }
    if (target.id === "history-start-button" || target.dataset.historyAction === "data") {
      App.ui.router.navigate("data");
      return;
    }
    if (target.id === "history-open-warehouse") {
      App.ui.router.navigate("warehouse");
      return;
    }
    if (target.dataset.historyAction === "report") {
      App.ui.router.navigate("report");
      return;
    }
    if (target.dataset.openTable) {
      App.ui.router.navigate("data");
      return;
    }
    if (target.dataset.viewAnalysis) {
      const record = collectAnalyses().find((item) => item.id === target.dataset.viewAnalysis);
      if (record) {
        openAnalysisDetail(record);
      }
      return;
    }
    if (target.dataset.viewReport) {
      const record = App.ai.reportStore.get(target.dataset.viewReport);
      if (record) {
        openReportDetail(record);
      }
    }
  }

  function createDialog(title, subtitle, bodyHtml) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal history-detail-modal";
    dialog.innerHTML = `
      <div class="modal-header">
        <div><h3>${utils.escapeHtml(title)}</h3><p>${utils.escapeHtml(subtitle || "")}</p></div>
        <button class="icon-button" type="button" data-close-history aria-label="关闭">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="history-detail-body">${bodyHtml}</div>
    `;
    document.body.appendChild(dialog);
    common.refreshIcons(dialog);
    dialog.querySelector("[data-close-history]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    return dialog;
  }

  function openAnalysisDetail(record) {
    const chartId = `history-chart:${record.id}`;
    const hasTable = record.resultTable && record.resultTable.rows && record.resultTable.rows.length;
    const body = `
      <div class="history-detail-summary">
        <span class="status-badge ${record.saved ? "success" : "neutral"}">${record.saved ? "已保存分析" : "本会话分析"}</span>
        <span>${utils.escapeHtml(record.tableName)} v${record.tableVersion}</span>
        <span>${utils.formatDateTime(record.createdAt)}</span>
      </div>
      <div class="history-config-chips">
        ${(record.configSummary || []).map((item) => `
          <span>${utils.escapeHtml(item.label)}：${utils.escapeHtml(item.value)}</span>
        `).join("")}
      </div>
      <div class="analysis-metric-grid history-detail-metrics">
        ${(record.metrics || []).map((metric) => `
          <div class="analysis-metric">
            <span>${utils.escapeHtml(metric.label)}</span>
            <strong>${utils.escapeHtml(metric.formatted)}${metric.unit ? `<small>${utils.escapeHtml(metric.unit)}</small>` : ""}</strong>
            <small>${utils.escapeHtml(metric.definition || "")}</small>
          </div>
        `).join("")}
      </div>
      ${record.warnings && record.warnings.length ? `
        <div class="history-detail-warnings">${record.warnings.map((warning) => `<div class="notice warning"><i data-lucide="triangle-alert" aria-hidden="true"></i><span>${utils.escapeHtml(warning)}</span></div>`).join("")}</div>
      ` : ""}
      ${record.chartSpec ? `
        <div class="history-detail-chart">
          <div class="analysis-chart-head"><div><strong>${utils.escapeHtml(record.chartSpec.title || "分析图表")}</strong><span>${utils.escapeHtml(record.chartSpec.subtitle || "")}</span></div></div>
          <div id="history-detail-chart-canvas"></div>
        </div>
      ` : ""}
      ${hasTable ? `
        <div class="history-detail-table">
          <div class="analysis-table-head"><strong>${record.resultTable.totalRows > record.resultTable.rows.length ? "已保存结果预览" : "结果明细"}</strong><span>${record.resultTable.rows.length} 行</span></div>
          ${historyTableMarkup(record.resultTable)}
        </div>
      ` : `<div class="notice"><i data-lucide="database" aria-hidden="true"></i><span>该记录只保存了配置和关键数字，没有可重绘的结果表。</span></div>`}
      ${App.sql.renderSQLBlock(record)}
    `;
    const dialog = createDialog(record.title, "分析记录详情", body);
    if (record.chartSpec) {
      const chartHost = dialog.querySelector("#history-detail-chart-canvas");
      if (chartHost) {
        App.charts.render(chartHost, record.chartSpec, { key: chartId });
      }
    }
    dialog.addEventListener("close", () => App.charts.dispose(chartId));
  }

  function openReportDetail(record) {
    const html = String(record.documentHtml || "").replace(' id="report-document"', ' data-history-report-document="true"');
    const dialog = createDialog(record.title, `${record.modeLabel} · ${utils.formatDateTime(record.createdAt)}`, `
      <div class="history-report-document">${html}</div>
    `);
    dialog.classList.add("history-report-modal");
  }

  function historyTableMarkup(table) {
    const rows = (table.rows || []).slice(0, 60);
    return `
      <div class="table-scroll history-detail-table-scroll">
        <table class="data-table">
          <thead><tr>${table.columns.map((column) => `<th>${utils.escapeHtml(column.label)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${table.columns.map((column) => {
              const value = row[column.key];
              let text = utils.isMissing(value) ? "—" : String(value);
              if (!utils.isMissing(value) && column.type === "percent") {
                text = utils.formatPercent(value, 1);
              } else if (!utils.isMissing(value) && ["number", "correlation"].includes(column.type)) {
                text = utils.formatNumber(value, { maximumFractionDigits: column.type === "correlation" ? 3 : 2 });
              }
              return `<td class="${column.align === "right" ? "number-cell" : ""}">${utils.escapeHtml(text)}</td>`;
            }).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  App.ui.historyView = {
    init,
    render,
    collectAnalyses
  };
})(window);
