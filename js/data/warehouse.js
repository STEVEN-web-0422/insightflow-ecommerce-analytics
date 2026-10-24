(function bootstrapWarehouse(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const constants = App.constants;
  const utils = App.utils;

  function getIndex() {
    const value = App.storage.getJSON(constants.storage.warehouseIndex, []);
    return Array.isArray(value) ? value : [];
  }

  function writeIndex(index) {
    return App.storage.setJSON(constants.storage.warehouseIndex, index);
  }

  function tableKey(id) {
    return `${constants.storage.tablePrefix}${id}`;
  }

  function listTables() {
    return getIndex()
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function getTable(id) {
    if (!id) {
      return null;
    }
    return App.storage.getJSON(tableKey(id), null);
  }

  function makeMeta(table) {
    return {
      id: table.id,
      name: table.name,
      version: table.version,
      rowCount: table.rowCount,
      columnCount: table.schema.length,
      qualityScore: table.quality ? table.quality.score : null,
      fileName: table.source ? table.source.fileName : "",
      createdAt: table.createdAt,
      updatedAt: table.updatedAt
    };
  }

  function saveDraft(draft, options) {
    const config = options || {};
    const name = String(config.name || draft.name || "").trim();
    if (!name) {
      throw new Error("数据表名称不能为空。");
    }

    const index = getIndex();
    const updateId = config.mode === "update" ? (draft.warehouseId || config.tableId) : null;
    const existing = updateId ? getTable(updateId) : null;
    if (config.mode === "update" && !existing) {
      throw new Error("要覆盖的数据表已不存在，请改为保存新表。");
    }

    const nameConflict = index.find((item) => item.name === name && item.id !== updateId);
    if (nameConflict) {
      throw new Error(`数据仓库中已存在名为“${name}”的数据表，请更换名称。`);
    }

    const id = existing ? existing.id : utils.uid("tbl");
    const now = new Date().toISOString();
    const table = utils.clone(draft);
    table.id = id;
    table.warehouseId = id;
    table.name = name;
    table.version = existing ? (existing.version || 0) + 1 : 1;
    table.rowCount = table.rows.length;
    table.updatedAt = now;
    table.createdAt = existing ? existing.createdAt : (table.createdAt || now);
    table.savedAt = now;
    table.quality = App.profiler.qualitySummary(
      table.rows,
      App.profiler.updateSchemaStats(table.schema, table.rows)
    );

    const writeResult = App.storage.setJSON(tableKey(id), table);
    if (!writeResult.ok) {
      throw new Error("数据保存失败，可能是浏览器存储空间不足。请清理旧表后重试。");
    }

    const nextIndex = index.filter((item) => item.id !== id);
    nextIndex.push(makeMeta(table));
    const indexResult = writeIndex(nextIndex);
    if (!indexResult.ok) {
      App.storage.removeRaw(tableKey(id));
      throw new Error("数据表索引更新失败，保存未完成。");
    }

    return {
      table,
      persistent: Boolean(writeResult.persistent && indexResult.persistent),
      updated: Boolean(existing)
    };
  }

  function deleteTable(id) {
    const index = getIndex();
    const target = index.find((item) => item.id === id);
    if (!target) {
      return false;
    }
    App.storage.removeRaw(tableKey(id));
    writeIndex(index.filter((item) => item.id !== id));
    return true;
  }

  function getStorageSummary() {
    const tables = listTables();
    return {
      tableCount: tables.length,
      rowCount: tables.reduce((sum, table) => sum + (table.rowCount || 0), 0),
      bytes: App.storage.usageBytes(),
      persistent: App.storage.isAvailable()
    };
  }

  function exportTable(id) {
    const table = getTable(id);
    if (!table) {
      throw new Error("数据表不存在。");
    }
    const csv = utils.toCsv(table.rows, table.schema);
    const safeName = table.name.replace(/[\\/:*?"<>|]/g, "_");
    utils.downloadText(`${safeName}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
    return csv;
  }

  App.warehouse = {
    listTables,
    getTable,
    saveDraft,
    deleteTable,
    getStorageSummary,
    exportTable
  };
})(window);
