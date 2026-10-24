(function bootstrapCommonUi(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  let loadingDepth = 0;

  function refreshIcons(root) {
    if (!global.lucide || typeof global.lucide.createIcons !== "function") {
      return;
    }
    global.lucide.createIcons({
      root: root || document,
      attrs: {
        width: 16,
        height: 16,
        "stroke-width": 1.8
      }
    });
  }

  function toast(message, type, timeout) {
    const stack = document.getElementById("toast-stack");
    if (!stack) {
      return;
    }
    const kind = type || "info";
    const iconMap = {
      success: "circle-check",
      error: "circle-alert",
      warning: "triangle-alert",
      info: "info"
    };
    const item = document.createElement("div");
    item.className = `toast ${kind}`;
    item.innerHTML = `
      <i data-lucide="${iconMap[kind] || iconMap.info}" aria-hidden="true"></i>
      <span>${utils.escapeHtml(message)}</span>
    `;
    stack.appendChild(item);
    refreshIcons(item);
    global.setTimeout(() => {
      item.style.opacity = "0";
      item.style.transform = "translateY(4px)";
      global.setTimeout(() => item.remove(), 180);
    }, timeout || 3600);
  }

  function setButtonLoading(button, loading, loadingText) {
    if (!button) {
      return;
    }
    if (loading) {
      if (!button.dataset.originalHtml) {
        button.dataset.originalHtml = button.innerHTML;
      }
      button.disabled = true;
      button.classList.add("is-loading");
      if (loadingText) {
        button.textContent = loadingText;
      }
    } else {
      button.disabled = false;
      button.classList.remove("is-loading");
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
        refreshIcons(button);
      }
    }
  }

  function showLoading(message) {
    loadingDepth += 1;
    let overlay = document.getElementById("global-loading-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "global-loading-overlay";
      overlay.className = "loading-overlay";
      overlay.innerHTML = `
        <div class="loading-card">
          <span class="spinner" aria-hidden="true"></span>
          <span id="global-loading-text"></span>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    const text = overlay.querySelector("#global-loading-text");
    if (text) {
      text.textContent = message || "正在处理…";
    }
    overlay.hidden = false;
  }

  function hideLoading() {
    loadingDepth = Math.max(0, loadingDepth - 1);
    if (loadingDepth > 0) {
      return;
    }
    const overlay = document.getElementById("global-loading-overlay");
    if (overlay) {
      overlay.hidden = true;
    }
  }

  function confirm(options) {
    const config = options || {};
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "modal";
      dialog.innerHTML = `
        <div class="modal-header">
          <div>
            <h3>${utils.escapeHtml(config.title || "确认操作")}</h3>
            <p>${utils.escapeHtml(config.message || "此操作需要确认。")}</p>
          </div>
          <button class="icon-button" type="button" data-confirm-cancel aria-label="关闭">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </div>
        <div class="modal-footer">
          <button class="button button-secondary" type="button" data-confirm-cancel>取消</button>
          <button class="button ${config.danger ? "button-danger" : "button-primary"}" type="button" data-confirm-ok>
            ${utils.escapeHtml(config.confirmText || "确认")}
          </button>
        </div>
      `;
      document.body.appendChild(dialog);
      refreshIcons(dialog);

      let settled = false;
      function finish(value) {
        if (settled) {
          return;
        }
        settled = true;
        dialog.close();
        dialog.remove();
        resolve(value);
      }

      dialog.addEventListener("close", () => finish(false));
      dialog.querySelectorAll("[data-confirm-cancel]").forEach((button) => {
        button.addEventListener("click", () => finish(false));
      });
      dialog.querySelector("[data-confirm-ok]").addEventListener("click", () => finish(true));
      dialog.showModal();
      dialog.querySelector("[data-confirm-ok]").focus();
    });
  }

  function renderEmpty(options) {
    const config = options || {};
    return `
      <div class="empty-state">
        <div class="empty-state-inner">
          <div class="empty-icon"><i data-lucide="${config.icon || "database"}" aria-hidden="true"></i></div>
          <h2>${utils.escapeHtml(config.title || "还没有数据")}</h2>
          <p>${utils.escapeHtml(config.description || "")}</p>
          <div class="empty-actions">${config.actions || ""}</div>
        </div>
      </div>
    `;
  }

  function updateGlobalContext(draft) {
    const tableName = draft ? draft.name : "尚未加载数据";
    const sidebarName = document.getElementById("sidebar-table-name");
    const sidebarMeta = document.getElementById("sidebar-table-meta");
    const contextName = document.getElementById("context-table-name");
    const contextMetrics = document.getElementById("context-metrics");

    if (sidebarName) {
      sidebarName.textContent = tableName;
    }
    if (sidebarMeta) {
      sidebarMeta.textContent = draft
        ? `${draft.rows.length.toLocaleString("zh-CN")} 行 · ${draft.schema.length} 列`
        : "请先载入示例数据";
    }
    if (contextName) {
      contextName.textContent = tableName;
    }
    if (contextMetrics) {
      if (!draft) {
        contextMetrics.innerHTML = "<span><b>0</b> 行</span><span><b>0</b> 列</span><span>数据质量 <b>—</b></span>";
      } else {
        const quality = draft.quality ? `${draft.quality.score.toFixed(1)}` : "—";
        contextMetrics.innerHTML = `
          <span><b>${draft.rows.length.toLocaleString("zh-CN")}</b> 行</span>
          <span><b>${draft.schema.length}</b> 列</span>
          <span>数据质量 <b>${quality}</b></span>
        `;
      }
    }
  }

  function updateStorageStatus(summary) {
    const dot = document.getElementById("storage-status-dot");
    const text = document.getElementById("storage-status-text");
    if (!dot || !text) {
      return;
    }
    const storage = summary || App.warehouse.getStorageSummary();
    dot.classList.toggle("warning", !storage.persistent);
    text.textContent = storage.persistent
      ? `${storage.tableCount} 张表 · ${utils.formatBytes(storage.bytes)}`
      : `内存模式 · ${storage.tableCount} 张表`;
  }

  function fieldTypeBadge(field) {
    const label = App.constants.fieldTypes[field.type] || field.type;
    return `<span class="type-badge type-${utils.escapeHtml(field.type)}">${utils.escapeHtml(label)}</span>`;
  }

  function renderValidationItems(items) {
    const iconMap = {
      ok: "circle-check",
      warn: "triangle-alert",
      error: "circle-x"
    };
    return items.map((item) => `
      <div class="validation-item ${item.status}">
        <i data-lucide="${iconMap[item.status] || "info"}" aria-hidden="true"></i>
        <span>${utils.escapeHtml(item.text)}</span>
      </div>
    `).join("");
  }

  App.ui = App.ui || {};
  Object.assign(App.ui, {
    refreshIcons,
    toast,
    setButtonLoading,
    showLoading,
    hideLoading,
    confirm,
    renderEmpty,
    updateGlobalContext,
    updateStorageStatus,
    fieldTypeBadge,
    renderValidationItems
  });
})(window);
