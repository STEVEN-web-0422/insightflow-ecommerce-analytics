(function bootstrapAnalysisCommon(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const DAY_MS = 86400000;

  function fieldByKey(table, key) {
    return table.schema.find((field) => field.key === key) || null;
  }

  function fieldsByType(table, type) {
    return table.schema.filter((field) => field.type === type);
  }

  function selectableFields(table, types) {
    return table.schema.filter((field) => !types || types.includes(field.type));
  }

  function defaultField(table, types, preferredNames) {
    const preferred = preferredNames || [];
    const fields = selectableFields(table, types);
    for (const name of preferred) {
      const match = fields.find((field) => field.key.toLowerCase() === String(name).toLowerCase());
      if (match) {
        return match.key;
      }
    }
    const roleMatch = fields.find((field) => field.role === "identifier")
      || fields.find((field) => field.role === "time")
      || fields.find((field) => field.role === "metric");
    return roleMatch ? roleMatch.key : (fields[0] ? fields[0].key : "");
  }

  function valuesOf(table, fieldKey, includeMissing) {
    const values = table.rows.map((row) => row[fieldKey]);
    return includeMissing ? values : values.filter((value) => !utils.isMissing(value));
  }

  function frequencyValues(table, fieldKey) {
    const counts = new Map();
    valuesOf(table, fieldKey).forEach((value) => {
      const key = String(value);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([value, count]) => ({ value, count }));
  }

  function rowTimestamp(row, timeField, table) {
    const meta = table.rowMeta && row.__rowId ? table.rowMeta[row.__rowId] : null;
    const sourceTime = meta && meta[`${timeField}__sourceTime`];
    if (sourceTime) {
      const parsed = Date.parse(sourceTime);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    const value = row[timeField];
    if (!utils.isMissing(value)) {
      const parsed = Date.parse(`${value}T00:00:00Z`);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return Number.POSITIVE_INFINITY;
  }

  function sourceOrder(row, table) {
    const meta = table.rowMeta && row.__rowId ? table.rowMeta[row.__rowId] : null;
    return meta && Number.isFinite(meta.sourceIndex) ? meta.sourceIndex : Number.MAX_SAFE_INTEGER;
  }

  function dayIndex(date) {
    const parsed = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(parsed) ? Math.floor(parsed / DAY_MS) : null;
  }

  function monthIndex(date) {
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const value = new Date(parsed);
    return value.getUTCFullYear() * 12 + value.getUTCMonth();
  }

  function weekStart(date) {
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const value = new Date(parsed);
    const mondayOffset = (value.getUTCDay() + 6) % 7;
    return new Date(parsed - mondayOffset * DAY_MS).toISOString().slice(0, 10);
  }

  function periodInfo(date, granularity) {
    if (granularity === "week") {
      const start = weekStart(date);
      return {
        key: start,
        label: start ? `${start} 周` : "未知周",
        index: start ? dayIndex(start) : null
      };
    }
    if (granularity === "month") {
      return {
        key: date ? date.slice(0, 7) : "未知月",
        label: date ? date.slice(0, 7) : "未知月",
        index: date ? monthIndex(date) : null
      };
    }
    return {
      key: date,
      label: date,
      index: date ? dayIndex(date) : null
    };
  }

  function periodDifference(startPeriod, targetPeriod, granularity) {
    if (!startPeriod || !targetPeriod) {
      return null;
    }
    if (granularity === "month") {
      return targetPeriod.index - startPeriod.index;
    }
    if (granularity === "week") {
      return Math.floor((targetPeriod.index - startPeriod.index) / 7);
    }
    return targetPeriod.index - startPeriod.index;
  }

  function groupBy(rows, fieldKey) {
    const groups = new Map();
    rows.forEach((row) => {
      const source = utils.isMissing(row[fieldKey]) ? "缺失" : String(row[fieldKey]);
      if (!groups.has(source)) {
        groups.set(source, []);
      }
      groups.get(source).push(row);
    });
    return groups;
  }

  function aggregate(rows, fieldKey, method) {
    if (method === "count") {
      return rows.length;
    }
    const values = fieldKey ? rows.map((row) => row[fieldKey]) : [];
    if (method === "distinct") {
      return new Set(values.filter((value) => !utils.isMissing(value)).map(String)).size;
    }
    const numbers = values.map(utils.parseNumberLike).filter((value) => value !== null);
    if (!numbers.length) {
      return null;
    }
    if (method === "sum") {
      return numbers.reduce((sum, value) => sum + value, 0);
    }
    if (method === "avg") {
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    }
    return null;
  }

  function metric(id, label, value, options) {
    const config = options || {};
    const formatter = config.formatter || "number";
    let formatted;
    if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) {
      formatted = "—";
    } else if (formatter === "percent") {
      formatted = utils.formatPercent(value, config.digits ?? 1);
    } else if (formatter === "compact") {
      formatted = utils.formatNumber(value, { maximumFractionDigits: 1, notation: "compact" });
    } else {
      formatted = utils.formatNumber(value, {
        maximumFractionDigits: config.digits ?? 2
      });
    }
    return {
      id,
      label,
      value,
      formatted,
      unit: config.unit || "",
      definition: config.definition || "",
      tone: config.tone || "default"
    };
  }

  function configSummary(entries) {
    return entries
      .filter((entry) => entry && entry.value !== undefined && entry.value !== null && entry.value !== "")
      .map((entry) => ({
        label: entry.label,
        value: String(entry.value)
      }));
  }

  function record(table, type, title, config, summary, metrics, resultTable, chartSpec, warnings) {
    return {
      id: utils.uid("analysis"),
      tableId: table.id,
      tableName: table.name,
      tableVersion: table.version,
      type,
      title,
      config,
      configSummary: summary,
      metrics,
      resultTable,
      chartSpec,
      warnings: warnings || [],
      createdAt: new Date().toISOString()
    };
  }

  function assertField(table, key, label, types) {
    const field = fieldByKey(table, key);
    if (!field) {
      throw new Error(`请选择有效的${label}。`);
    }
    if (types && !types.includes(field.type)) {
      throw new Error(`${label}“${key}”的类型不符合当前分析要求。`);
    }
    return field;
  }

  function formatFieldType(field) {
    return App.constants.fieldTypes[field.type] || field.type;
  }

  function formatDateOffset(date, days) {
    const parsed = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed)) {
      return date;
    }
    return new Date(parsed + days * DAY_MS).toISOString().slice(0, 10);
  }

  App.analysis = App.analysis || {};
  App.analysis.common = {
    DAY_MS,
    fieldByKey,
    fieldsByType,
    selectableFields,
    defaultField,
    valuesOf,
    frequencyValues,
    rowTimestamp,
    sourceOrder,
    dayIndex,
    monthIndex,
    weekStart,
    periodInfo,
    periodDifference,
    groupBy,
    aggregate,
    metric,
    configSummary,
    record,
    assertField,
    formatFieldType,
    formatDateOffset
  };
})(window);
