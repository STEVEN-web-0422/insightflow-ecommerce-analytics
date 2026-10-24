(function bootstrapAnalysisStore(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const constants = App.constants;

  function trimTable(table, limit) {
    if (!table) {
      return null;
    }
    const maxRows = limit || 100;
    return {
      ...utils.clone(table),
      rows: (table.rows || []).slice(0, maxRows),
      storedRows: Math.min(maxRows, (table.rows || []).length),
      totalRows: table.totalRows ?? (table.rows || []).length
    };
  }

  function prepareRecord(record) {
    return {
      ...utils.clone(record),
      resultTable: trimTable(record.resultTable, 100),
      summaryTable: trimTable(record.summaryTable, 100),
      savedAt: new Date().toISOString(),
      saved: true
    };
  }

  function list(tableId) {
    const records = App.storage.getJSON(constants.storage.savedAnalyses, []);
    const safeRecords = Array.isArray(records) ? records : [];
    return safeRecords
      .filter((record) => !tableId || record.tableId === tableId)
      .sort((left, right) => String(right.savedAt).localeCompare(String(left.savedAt)));
  }

  function save(record) {
    if (!record || !record.id) {
      throw new Error("分析结果尚未生成，无法保存。");
    }
    const records = list();
    const prepared = prepareRecord(record);
    const next = [prepared, ...records.filter((item) => item.id !== prepared.id)].slice(0, 40);
    const result = App.storage.setJSON(constants.storage.savedAnalyses, next);
    if (!result.ok) {
      throw new Error("分析记录保存失败，浏览器存储空间可能不足。");
    }
    return {
      record: prepared,
      persistent: Boolean(result.persistent),
      count: next.length
    };
  }

  function get(id) {
    return list().find((record) => record.id === id) || null;
  }

  function remove(id) {
    const records = list();
    const next = records.filter((record) => record.id !== id);
    App.storage.setJSON(constants.storage.savedAnalyses, next);
    return records.length !== next.length;
  }

  function count(tableId) {
    return list(tableId).length;
  }

  App.analysis.store = {
    list,
    get,
    save,
    remove,
    count
  };
})(window);
