(function bootstrapReportStore(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const storageKey = App.constants.storage.reports;
  const MAX_REPORTS = 5;

  function list() {
    const records = App.storage.getJSON(storageKey, []);
    return Array.isArray(records) ? records : [];
  }

  function prepare(report) {
    return {
      id: report.id,
      title: report.title,
      mode: report.mode,
      modeLabel: report.modeLabel,
      createdAt: report.createdAt,
      table: utils.clone(report.table),
      sections: utils.clone(report.sections),
      analyses: utils.clone(report.analyses || []),
      validationWarnings: utils.clone(report.validationWarnings || []),
      documentHtml: report.documentHtml,
      savedAt: new Date().toISOString()
    };
  }

  function save(report) {
    if (!report || !report.id || !report.documentHtml) {
      throw new Error("报告内容不完整，无法保存历史快照。");
    }
    const records = list();
    const prepared = prepare(report);
    const next = [
      prepared,
      ...records.filter((item) => item.id !== prepared.id)
    ].slice(0, MAX_REPORTS);
    const result = App.storage.setJSON(storageKey, next);
    return {
      record: prepared,
      persistent: Boolean(result.persistent),
      count: next.length
    };
  }

  function get(id) {
    return list().find((report) => report.id === id) || null;
  }

  function remove(id) {
    const records = list();
    const next = records.filter((report) => report.id !== id);
    App.storage.setJSON(storageKey, next);
    return records.length !== next.length;
  }

  App.ai.reportStore = {
    list,
    get,
    save,
    remove,
    maxReports: MAX_REPORTS
  };
})(window);
