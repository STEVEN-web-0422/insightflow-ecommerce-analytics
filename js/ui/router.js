(function bootstrapRouter(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const constants = App.constants;
  const common = App.ui;
  let currentRoute = "data";

  function init() {
    document.addEventListener("click", (event) => {
      const routeButton = event.target.closest("[data-route]");
      if (routeButton) {
        navigate(routeButton.dataset.route);
      }
      const toggle = event.target.closest(".nav-section-toggle");
      if (toggle) {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
      }
    });

    navigate("data");
  }

  function navigate(route) {
    const meta = constants.routeMeta[route];
    if (!meta) {
      return;
    }
    currentRoute = route;
    App.state.setRoute(route);
    document.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle("active", item.dataset.route === route);
    });

    const dataView = document.getElementById("view-data");
    const warehouseView = document.getElementById("view-warehouse");
    const analysisView = document.getElementById("view-analysis");
    const reportView = document.getElementById("view-report");
    const historyView = document.getElementById("view-history");
    dataView.hidden = route !== "data";
    warehouseView.hidden = route !== "warehouse";
    analysisView.hidden = route !== "analysis";
    reportView.hidden = route !== "report";
    historyView.hidden = route !== "history";

    const eyebrow = document.getElementById("page-eyebrow");
    const title = document.getElementById("page-title");
    if (eyebrow) {
      eyebrow.textContent = meta.eyebrow;
    }
    if (title) {
      title.textContent = meta.title;
    }

    if (route === "warehouse") {
      App.ui.warehouseView.render();
    }
    if (route === "analysis") {
      App.ui.analysisView.render();
    }
    if (route === "report") {
      App.ui.reportView.render();
    }
    if (route === "history") {
      App.ui.historyView.render();
    }
    if (route === "data") {
      common.updateGlobalContext(global.dataWarehouse?.dwd || global.dataWarehouse?.ods || null);
    }
    global.scrollTo({ top: 0, behavior: "smooth" });
  }

  App.ui.router = {
    init,
    navigate,
    getCurrentRoute: () => currentRoute
  };
})(window);
