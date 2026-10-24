(function bootstrapAutoReportView(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const common = App.ui;
  let root = null;
  let initialized = false;
  let currentTable = null;
  let currentReport = null;
  let generating = false;
  const excludedAnalysisIds = new Set();
  let exclusionTableId = null;

  function typeLabel(type) {
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

  function template() {
    return `
      <div class="section-head">
        <div>
          <span class="pipeline-eyebrow">AUTO DASHBOARD & REPORT</span>
          <h2>一键生成图文分析报告</h2>
          <p>系统自动读取 DWD 上的分析记录并渲染图表，无需手动选择字段或拼接图表。</p>
        </div>
        <span class="status-badge neutral" id="report-context-badge">等待分析结果</span>
      </div>
      <div id="report-empty" hidden>
        ${common.renderEmpty({
          icon: "file-chart-column",
          title: "DWD 宽表尚未生成",
          description: "请先在数据处理流水线生成 DWD 宽表，并运行至少一个业务分析。",
          actions: `<button class="button button-primary" id="report-go-data" type="button">去生成 DWD 宽表</button>`
        })}
      </div>
      <div id="report-workspace" hidden>
        <section class="auto-report-preview-section">
          <div class="auto-report-section-head">
            <div>
              <h3>分析结果图表预览</h3>
              <p id="auto-report-preview-meta">等待分析记录</p>
            </div>
            <div class="auto-report-section-actions">
              <button class="button button-secondary button-small" id="restore-report-analyses" type="button" hidden>
                <i data-lucide="rotate-ccw" aria-hidden="true"></i>恢复全部
              </button>
              <button class="button button-quiet button-small" id="report-go-analysis" type="button">补充分析</button>
            </div>
          </div>
          <div class="auto-report-preview-grid" id="auto-report-preview-grid"></div>
        </section>

        <section class="report-generate-hero">
          <div>
            <span class="pipeline-eyebrow">ONE CLICK AGENT</span>
            <h3>从分析结果到可交付报告</h3>
            <p>AI 负责四段式文字，前端按分析记录顺序自动嵌入图表。</p>
          </div>
          <div class="report-generate-hero-actions">
            <button class="button button-primary report-generate-main" id="generate-ai-report" type="button">
              <i data-lucide="sparkles" aria-hidden="true"></i>一键生成 AI 数据分析报告
            </button>
            <span id="report-generate-status">运行分析后即可生成</span>
          </div>
        </section>

        <section class="report-output-section">
          <div class="report-output-head">
            <div>
              <span class="tool-kicker">REPORT PREVIEW</span>
              <h3>图文报告预览</h3>
            </div>
            <div class="report-output-actions" id="report-output-actions" hidden>
              <button class="button button-secondary button-small" id="export-report-html" type="button">
                <i data-lucide="file-down" aria-hidden="true"></i>导出 HTML
              </button>
              <button class="button button-primary button-small" id="print-report-button" type="button">
                <i data-lucide="printer" aria-hidden="true"></i>打印为 PDF
              </button>
            </div>
          </div>
          <div id="report-output">
            <div class="report-output-empty">
              <div class="report-output-empty-icon"><i data-lucide="file-chart-column" aria-hidden="true"></i></div>
              <strong>分析结果就绪后生成报告</strong>
              <span>报告顶部固定标注“AI 初稿，需人工复核”。</span>
            </div>
          </div>
        </section>
      </div>
    `;
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    root = document.getElementById("view-report");
    root.innerHTML = template();
    root.addEventListener("click", handleClick);
    ["analysis:run", "dataWarehouse:changed", "ads:changed"].forEach((eventName) => {
      App.state.subscribe(eventName, () => {
        if (App.ui.router.getCurrentRoute() === "report") {
          render();
        }
      });
    });
    render();
  }

  function getAllAnalyses() {
    currentTable = global.dataWarehouse.dwd;
    if (!currentTable) {
      return [];
    }
    // 排除状态只服务于当前 DWD 版本的报告范围；切换数据版本时自动重置。
    if (exclusionTableId !== currentTable.id) {
      exclusionTableId = currentTable.id;
      excludedAnalysisIds.clear();
    }
    const analyses = App.ai.contextBuilder.getAnalyses()
      .filter((analysis) => analysis.tableId === currentTable.id)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    global.analysisContext = global.analysisContext || {};
    global.analysisContext.analyses = analyses;
    return analyses;
  }

  function getAnalyses() {
    return getAllAnalyses().filter((analysis) => !excludedAnalysisIds.has(analysis.id));
  }

  function render() {
    if (!root) {
      return;
    }
    const dwd = global.dataWarehouse.dwd;
    const empty = document.getElementById("report-empty");
    const workspace = document.getElementById("report-workspace");
    if (!dwd) {
      empty.hidden = false;
      workspace.hidden = true;
      currentTable = null;
      common.refreshIcons(root);
      return;
    }
    currentTable = dwd;
    empty.hidden = true;
    workspace.hidden = false;
    const allAnalyses = getAllAnalyses();
    const analyses = allAnalyses.filter((analysis) => !excludedAnalysisIds.has(analysis.id));
    const excludedCount = allAnalyses.length - analyses.length;
    const badge = document.getElementById("report-context-badge");
    badge.textContent = excludedCount
      ? `${analyses.length}/${allAnalyses.length} 条纳入报告`
      : `${analyses.length} 条分析记录`;
    badge.className = `status-badge ${analyses.length ? "success" : "neutral"}`;
    document.getElementById("auto-report-preview-meta").textContent =
      analyses.length
        ? `${dwd.name} · 按执行顺序自动渲染${excludedCount ? ` · 已排除 ${excludedCount} 条` : ""}`
        : (allAnalyses.length
          ? `全部分析已从本次报告排除 · 点击“恢复全部”可重新纳入`
          : "请先在业务分析页运行漏斗、留存或 RFM 等分析");
    document.getElementById("restore-report-analyses").hidden = excludedCount === 0;
    renderPreview(analyses, {
      totalCount: allAnalyses.length,
      excludedCount
    });
    const generateButton = document.getElementById("generate-ai-report");
    generateButton.disabled = !analyses.length || generating;
    generateButton.innerHTML = generating
      ? '<span class="spinner"></span>正在生成图文报告…'
      : '<i data-lucide="sparkles" aria-hidden="true"></i>一键生成 AI 数据分析报告';
    document.getElementById("report-generate-status").textContent = analyses.length
      ? `将使用 ${analyses.length} 条分析结果与对应图表${excludedCount ? `，已排除 ${excludedCount} 条` : ""}`
      : (allAnalyses.length ? "请至少保留一条分析后再生成报告" : "运行分析后即可生成");
    renderReportOutput();
    common.refreshIcons(root);
  }

  function renderPreview(analyses, scope) {
    const grid = document.getElementById("auto-report-preview-grid");
    if (!grid) {
      return;
    }
    if (!analyses.length) {
      const allExcluded = scope && scope.totalCount > 0 && scope.excludedCount > 0;
      grid.innerHTML = `
        <div class="auto-report-empty">
          <i data-lucide="chart-no-axes-combined" aria-hidden="true"></i>
          <div>
            <strong>${allExcluded ? "本次报告已不包含任何分析" : "还没有分析图表"}</strong>
            <span>${allExcluded ? "这些分析仍保留在分析历史中；点击页面上方“恢复全部”可重新纳入报告。" : "前往业务分析页运行结构化分析，返回后图表会自动出现在这里。"}</span>
          </div>
        </div>
      `;
      return;
    }
    grid.innerHTML = analyses.map((analysis, index) => {
      const chartable = App.charts.hasChartData(analysis.chartSpec);
      return `
        <article class="auto-report-card" data-analysis-id="${utils.escapeHtml(analysis.id)}">
          <div class="auto-report-card-head">
            <div>
              <span>${String(index + 1).padStart(2, "0")} · ${utils.escapeHtml(typeLabel(analysis.type))}</span>
              <strong>${utils.escapeHtml(analysis.title)}</strong>
            </div>
            <div class="auto-report-card-actions">
              <span class="status-badge neutral">${utils.escapeHtml(chartable ? analysis.chartSpec.type : "无可视化")}</span>
              <button
                class="auto-report-remove"
                type="button"
                data-remove-report-analysis="${utils.escapeHtml(analysis.id)}"
                title="从本次报告排除，不会删除分析历史"
                aria-label="从本次报告排除 ${utils.escapeHtml(analysis.title)}"
              >
                <i data-lucide="x" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          ${chartable
            ? `<div class="auto-report-chart" id="report-preview-${utils.escapeHtml(analysis.id)}"></div>`
            : '<div class="auto-report-chart-empty">当前分析结果暂无可绘制数据，报告中不会插入空白图表。</div>'}
          <div class="auto-report-kpis">
            ${(analysis.metrics || []).slice(0, 3).map((metric) => `
              <span>${utils.escapeHtml(metric.label)}<b>${utils.escapeHtml(metric.formatted)}</b></span>
            `).join("")}
          </div>
        </article>
      `;
    }).join("");

    analyses.forEach((analysis) => {
      const container = document.getElementById(`report-preview-${analysis.id}`);
      if (container && App.charts.hasChartData(analysis.chartSpec)) {
        App.charts.render(container, analysis.chartSpec, {
          key: `report-preview:${analysis.id}`
        });
      }
    });
  }

  function excludeAnalysis(analysisId) {
    if (!analysisId || generating) {
      return;
    }
    excludedAnalysisIds.add(analysisId);
    // 已生成报告沿用旧范围，范围变化后必须重新生成，避免导出内容与分析卡不一致。
    currentReport = null;
    render();
    common.toast("已从本次报告排除；分析历史和 ADS 结果不会被删除。", "success", 3600);
  }

  function restoreAllAnalyses() {
    if (!excludedAnalysisIds.size || generating) {
      return;
    }
    excludedAnalysisIds.clear();
    currentReport = null;
    render();
    common.toast("已恢复全部分析到本次报告。", "success");
  }

  async function handleClick(event) {
    const target = event.target.closest("button");
    if (!target) {
      return;
    }
    if (target.hasAttribute("data-remove-report-analysis")) {
      excludeAnalysis(target.getAttribute("data-remove-report-analysis"));
      return;
    }
    if (target.id === "restore-report-analyses") {
      restoreAllAnalyses();
      return;
    }
    if (target.id === "report-go-data") {
      App.ui.router.navigate("data");
      return;
    }
    if (target.id === "report-go-analysis") {
      App.ui.router.navigate("analysis");
      return;
    }
    if (target.id === "generate-ai-report") {
      await generateReport();
      return;
    }
    if (target.id === "export-report-html") {
      exportHtml();
      return;
    }
    if (target.id === "print-report-button") {
      printReport();
    }
  }

  async function generateReport() {
    if (generating || !currentTable) {
      return;
    }
    const analyses = getAnalyses();
    if (!analyses.length) {
      common.toast("请先运行业务分析。", "warning");
      return;
    }
    generating = true;
    render();
    common.showLoading("正在生成 AI 报告并嵌入分析图表…");
    try {
      const report = await App.ai.report.generate({
        mode: "deepseek",
        table: currentTable,
        analyses,
        title: "电商经营数据分析报告"
      });
      currentReport = report;
      let historySaved = true;
      try {
        historySaved = App.ai.reportStore.save(report).persistent;
      } catch (error) {
        historySaved = false;
      }
      App.state.emit("reports:changed", report);
      common.toast(
        historySaved
          ? "图文报告已生成，图表已按分析顺序自动嵌入。"
          : "报告已生成，但浏览器未能持久化报告快照。",
        historySaved ? "success" : "warning",
        5200
      );
    } catch (error) {
      if (error.code !== "AI_CONFIG_REQUIRED") {
        common.toast(error.message, "error", 6500);
      }
    } finally {
      generating = false;
      common.hideLoading();
      render();
    }
  }

  function renderReportOutput() {
    const output = document.getElementById("report-output");
    const actions = document.getElementById("report-output-actions");
    if (!currentReport) {
      actions.hidden = true;
      output.innerHTML = `
        <div class="report-output-empty">
          <div class="report-output-empty-icon"><i data-lucide="file-chart-column" aria-hidden="true"></i></div>
          <strong>分析结果就绪后生成报告</strong>
          <span>报告顶部固定标注“AI 初稿，需人工复核”。</span>
        </div>
      `;
      common.refreshIcons(output);
      return;
    }
    actions.hidden = false;
    output.innerHTML = `<div class="report-paper-shell">${currentReport.documentHtml}</div>`;
    common.refreshIcons(output);
  }

  function exportHtml() {
    if (!currentReport) {
      return;
    }
    const html = App.ai.report.standaloneHtml(currentReport);
    const safeTitle = currentReport.title.replace(/[\\/:*?"<>|]/g, "_");
    utils.downloadText(`${safeTitle}.html`, html, "text/html;charset=utf-8");
    common.toast("完整图文报告 HTML 已导出。", "success");
  }

  function printReport() {
    if (!currentReport) {
      return;
    }
    document.body.classList.add("printing-report");
    global.print();
    const cleanup = () => document.body.classList.remove("printing-report");
    global.addEventListener("afterprint", cleanup, { once: true });
    global.setTimeout(cleanup, 1500);
  }

  App.ui.reportView = {
    init,
    render,
    getCurrentReport: () => currentReport,
    getSelectedTable: () => currentTable,
    getAnalyses,
    getAllAnalyses,
    getExcludedAnalysisIds: () => Array.from(excludedAnalysisIds)
  };
})(window);
