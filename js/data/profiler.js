(function bootstrapProfiler(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;

  const CATEGORY_NAME_PATTERN = /(event|channel|category|type|status|city|province|gender|source|支付|渠道|类别|状态|城市|省份)/i;
  const IDENTIFIER_NAME_PATTERN = /(^|_)(id|key|code)$|编号|代码|单号|^订单号$|^用户号$/i;
  const DATE_NAME_PATTERN = /(date|time|day|month|year|日期|时间)/i;

  function isIdentifierName(key) {
    return IDENTIFIER_NAME_PATTERN.test(String(key));
  }

  function inferFieldType(key, values, rowCount) {
    const present = values.filter((value) => !utils.isMissing(value));
    if (!present.length) {
      return { type: "text", confidence: 0 };
    }

    const numericCount = present.filter((value) => utils.parseNumberLike(value) !== null).length;
    const dateCount = present.filter((value) => {
      return utils.normalizeDate(value) !== null && (typeof value === "string" && /[-/.]/.test(value));
    }).length;
    const numericRatio = numericCount / present.length;
    const dateRatio = dateCount / present.length;

    if (isIdentifierName(key)) {
      return { type: "category", confidence: 0.9 };
    }

    if (!isIdentifierName(key) && dateRatio >= 0.9 && (DATE_NAME_PATTERN.test(key) || dateCount > 1)) {
      return { type: "date", confidence: dateRatio };
    }

    if (!isIdentifierName(key) && numericRatio >= 0.9) {
      return { type: "number", confidence: numericRatio };
    }

    const normalized = present.map((value) => String(value).trim());
    const distinct = new Set(normalized).size;
    const distinctRatio = distinct / Math.max(1, rowCount);
    const averageLength = normalized.reduce((sum, value) => sum + value.length, 0) / normalized.length;
    const commonCategory = CATEGORY_NAME_PATTERN.test(key);

    if (commonCategory || distinct <= 40 || (distinctRatio <= 0.25 && averageLength <= 36)) {
      return { type: "category", confidence: 0.8 };
    }

    return { type: "text", confidence: 0.65 };
  }

  function inferRole(key, type) {
    if (isIdentifierName(key)) {
      return "identifier";
    }
    if (type === "date") {
      return "time";
    }
    if (type === "number") {
      return "metric";
    }
    if (type === "category") {
      return "category";
    }
    return "text";
  }

  function inferPrecision(values) {
    const numbers = values
      .filter((value) => !utils.isMissing(value))
      .map((value) => String(value).trim().replace(/[,\uFF0C]/g, ""));
    let maxDigits = 0;
    numbers.forEach((value) => {
      const match = value.match(/\.(\d+)/);
      if (match) {
        maxDigits = Math.max(maxDigits, Math.min(6, match[1].length));
      }
    });
    return maxDigits;
  }

  function coerceRows(rawRows, schema) {
    const rowMeta = {};
    const invalidCounts = {};
    const rows = rawRows.map((rawRow, index) => {
      const rowId = rawRow.__rowId || `row_${String(index + 1).padStart(4, "0")}`;
      const output = { __rowId: rowId };
      const meta = { sourceIndex: index + 1 };

      schema.forEach((field) => {
        const rawValue = rawRow[field.key];
        if (utils.isMissing(rawValue)) {
          output[field.key] = null;
          return;
        }

        if (field.type === "number") {
          const numeric = utils.parseNumberLike(rawValue);
          if (numeric === null) {
            invalidCounts[field.key] = (invalidCounts[field.key] || 0) + 1;
            output[field.key] = null;
          } else {
            output[field.key] = utils.roundTo(numeric, field.precision ?? 2);
          }
          return;
        }

        if (field.type === "date") {
          const date = utils.normalizeDate(rawValue);
          if (date === null) {
            invalidCounts[field.key] = (invalidCounts[field.key] || 0) + 1;
            output[field.key] = null;
          } else {
            output[field.key] = date;
            if (utils.hasTimeComponent(rawValue)) {
              meta[`${field.key}__sourceTime`] = String(rawValue).trim();
            }
          }
          return;
        }

        output[field.key] = String(rawValue).trim().replace(/\s+/g, " ");
      });

      rowMeta[rowId] = meta;
      return output;
    });

    return { rows, rowMeta, invalidCounts };
  }

  function updateFieldStats(field, rows) {
    const values = rows.map((row) => row[field.key]);
    const present = values.filter((value) => !utils.isMissing(value));
    const distinct = new Set(present.map((value) => String(value))).size;
    const missingCount = rows.length - present.length;
    return {
      ...field,
      missingCount,
      missingRate: rows.length ? missingCount / rows.length : 0,
      distinctCount: distinct,
      sampleValue: present.length ? present[0] : null,
      min: field.type === "number" && present.length ? Math.min(...present) : null,
      max: field.type === "number" && present.length ? Math.max(...present) : null
    };
  }

  function updateSchemaStats(schema, rows) {
    return schema.map((field) => updateFieldStats(field, rows));
  }

  function rowSignature(row, schema) {
    return JSON.stringify(schema.map((field) => {
      const value = row[field.key];
      return value === undefined ? null : value;
    }));
  }

  function qualitySummary(rows, schema) {
    const cellCount = Math.max(1, rows.length * Math.max(1, schema.length));
    const missingCount = schema.reduce((sum, field) => sum + (field.missingCount || 0), 0);
    const signatures = new Set();
    let duplicateRows = 0;
    rows.forEach((row) => {
      const signature = rowSignature(row, schema);
      if (signatures.has(signature)) {
        duplicateRows += 1;
      } else {
        signatures.add(signature);
      }
    });

    const completeness = 1 - missingCount / cellCount;
    const uniqueness = rows.length ? 1 - duplicateRows / rows.length : 1;
    const score = Math.max(0, Math.min(100, (completeness * 0.75 + uniqueness * 0.25) * 100));
    return {
      score: Math.round(score * 10) / 10,
      completeness,
      uniqueness,
      missingCells: missingCount,
      duplicateRows
    };
  }

  function refreshDraftQuality(draft) {
    draft.schema = updateSchemaStats(draft.schema, draft.rows);
    draft.rowCount = draft.rows.length;
    draft.quality = qualitySummary(draft.rows, draft.schema);
    draft.updatedAt = new Date().toISOString();
    return draft;
  }

  function createDraft(rawRows, headers, options) {
    const config = options || {};
    const fields = headers.map((key) => {
      const values = rawRows.map((row) => row[key]);
      const inference = inferFieldType(key, values, rawRows.length);
      return {
        key,
        label: key,
        type: inference.type,
        role: inferRole(key, inference.type),
        precision: inference.type === "number" ? inferPrecision(values) : null,
        unit: "",
        inferenceConfidence: inference.confidence
      };
    });

    const coerced = coerceRows(rawRows, fields);
    const schema = updateSchemaStats(fields, coerced.rows);
    const baseName = String(config.fileName || "未命名数据表")
      .replace(/\.csv$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || "未命名数据表";

    const draft = {
      id: null,
      warehouseId: null,
      name: baseName,
      version: 0,
      rowCount: coerced.rows.length,
      schema,
      rows: coerced.rows,
      rowMeta: coerced.rowMeta,
      source: {
        fileName: config.fileName || "上传文件",
        importedAt: new Date().toISOString(),
        rowCount: rawRows.length,
        parseWarnings: config.parseWarnings || []
      },
      audit: [
        {
          operation: "import",
          label: "导入原始 CSV",
          affected: coerced.rows.length,
          operatedAt: new Date().toISOString()
        }
      ],
      conversionWarnings: coerced.invalidCounts,
      quality: qualitySummary(coerced.rows, schema),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return draft;
  }

  function appendAudit(draft, audit) {
    draft.audit = draft.audit || [];
    draft.audit.push({
      ...audit,
      operatedAt: new Date().toISOString()
    });
    if (draft.audit.length > 80) {
      draft.audit = draft.audit.slice(-80);
    }
  }

  App.profiler = {
    inferFieldType,
    inferRole,
    coerceRows,
    updateSchemaStats,
    refreshDraftQuality,
    qualitySummary,
    createDraft,
    appendAudit,
    rowSignature
  };
})(window);
