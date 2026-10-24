(function bootstrapApp(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};

  function start() {
    try {
      App.ui.warehouseView.init();
      App.ui.dataView.init();
      App.ui.analysisView.init();
      App.ui.reportView.init();
      App.ui.historyView.init();
      App.ui.router.init();
      App.ai.assistant.init();

      App.ui.refreshIcons(document);
      App.ui.updateStorageStatus();
      App.ui.warehouseView.render();

      const dependencyBanner = document.getElementById("dependency-banner");
      if (!global.Papa && dependencyBanner) {
        dependencyBanner.hidden = false;
        dependencyBanner.querySelector("span").textContent = "PapaParse CDN 未加载，已启用内置 CSV 解析后备方案；核心清洗功能仍可运行。";
        App.ui.refreshIcons(dependencyBanner);
      }

      if (!App.storage.isAvailable()) {
        App.ui.toast("浏览器限制了本地持久化存储，当前使用内存模式。", "warning", 5200);
      }
    } catch (error) {
      console.error("Application initialization failed", error);
      const content = document.getElementById("content-main");
      if (content) {
        content.innerHTML = `
          <div class="coming-soon">
            <div class="coming-soon-inner">
              <h2>应用初始化失败</h2>
              <p>${String(error.message || error)}</p>
              <button class="button button-secondary" type="button" onclick="location.reload()">重新加载</button>
            </div>
          </div>
        `;
      }
    }
  }

  App.app = { start };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})(window);
