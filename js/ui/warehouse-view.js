(function bootstrapLayeredWarehouseView(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const common = App.ui;
  let root = null;
  let initialized = false;

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    root = document.getElementById("view-warehouse");
    root.addEventListener("click", handleClick);
    App.state.subscribe("dataWarehouse:changed", () => {
      if (App.ui.router.getCurrentRoute() === "warehouse") {
        render();
      }
    });
    App.state.subscribe("ads:changed", () => {
      if (App.ui.router.getCurrentRoute() === "warehouse") {
        render();
      }
    });
    render();
  }

  function render() {
    if (!root) {
      return;
    }
    const warehouse = global.dataWarehouse;
    const dwd = warehouse.dwd;
    const ads = warehouse.ads;
    root.innerHTML = `
      <div class="section-head">
        <div>
          <span class="pipeline-eyebrow">LAYERED DATA ASSETS</span>
          <h2>固定电商数据流水线</h2>
          <p>该工作台不再管理任意上传表，只维护 ODS → DWD → ADS 三层固定资产。</p>
        </div>
        <div class="section-actions">
          <button class="button button-secondary button-small" type="button" data-open-pipeline>查看数据流水线</button>
        </div>
      </div>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="metric-card-label">DWD 明细宽表<i data-lucide="layers-3" aria-hidden="true"></i></span>
          <strong class="metric-card-value">${dwd ? "已生成" : "待生成"}</strong>
          <span class="metric-card-sub">${dwd ? `${dwd.rows.length.toLocaleString("zh-CN")} 行 × ${dwd.schema.length} 字段` : "固定清洗 SOP"}</span>
        </div>
        <div class="metric-card">
          <span class="metric-card-label">ADS 分析结果<i data-lucide="chart-no-axes-combined" aria-hidden="true"></i></span>
          <strong class="metric-card-value">${ads.length}</strong>
          <span class="metric-card-sub">保存分析后自动沉淀</span>
        </div>
        <div class="metric-card">
          <span class="metric-card-label">ODS 原始数据<i data-lucide="database" aria-hidden="true"></i></span>
          <strong class="metric-card-value">${warehouse.ods ? warehouse.ods.rows.length.toLocaleString("zh-CN") : "—"}</strong>
          <span class="metric-card-sub">内置电商行为日志</span>
        </div>
        <div class="metric-card">
          <span class="metric-card-label">DWD 数据质量<i data-lucide="shield-check" aria-hidden="true"></i></span>
          <strong class="metric-card-value">${dwd?.quality ? dwd.quality.score.toFixed(1) : "—"}</strong>
          <span class="metric-card-sub">字段标准化后的质量评分</span>
        </div>
      </div>
      ${dwd ? `
        <section class="history-section">
          <div class="history-section-head">
            <div><strong>DWD · ${utils.escapeHtml(dwd.name)}</strong><span>v${dwd.version} · 最近更新 ${utils.formatDateTime(dwd.updatedAt)}</span></div>
            <button class="button button-primary button-small" type="button" data-go-analysis>进入业务分析</button>
          </div>
          <div class="subpanel-body">
            <div class="layer-field-list">
              ${dwd.schema.map((field) => `<span class="layer-field"><b>${utils.escapeHtml(field.key)}</b><small>${utils.escapeHtml(App.constants.fieldTypes[field.type] || field.type)}</small></span>`).join("")}
            </div>
            <div class="notice" style="margin-top:12px">
              <i data-lucide="route" aria-hidden="true"></i>
              <span>该表由固定 SOP 自动生成，业务分析、AI 报告和全局助手均默认使用此 DWD 宽表。</span>
            </div>
          </div>
        </section>
      ` : `
        <div class="subpanel">
          ${common.renderEmpty({
            icon: "layers-3",
            title: "DWD 宽表尚未生成",
            description: "前往数据处理页点击“一键生成分析宽表”，即可完成类型转换、脏数据过滤和时间维度派生。",
            actions: `<button class="button button-primary" type="button" data-open-pipeline>去生成宽表</button>`
          })}
        </div>
      `}
    `;
    const navCount = document.getElementById("warehouse-count");
    if (navCount) {
      navCount.textContent = dwd ? "1" : "0";
    }
    common.refreshIcons(root);
  }

  function handleClick(event) {
    const target = event.target.closest("button");
    if (!target) {
      return;
    }
    if (target.hasAttribute("data-open-pipeline")) {
      App.ui.router.navigate("data");
    } else if (target.hasAttribute("data-go-analysis")) {
      App.ui.router.navigate("analysis");
    }
  }

  App.ui.warehouseView = {
    init,
    render
  };
})(window);
