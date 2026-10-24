(function bootstrapUtils(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};

  function isMissing(value) {
    return value === null
      || value === undefined
      || (typeof value === "number" && !Number.isFinite(value))
      || (typeof value === "string" && value.trim() === "");
  }

  function clone(value) {
    if (typeof global.structuredClone === "function") {
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function uid(prefix) {
    const time = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${prefix || "id"}_${time}_${random}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function parseNumberLike(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (isMissing(value)) {
      return null;
    }

    let text = String(value)
      .trim()
      .replace(/[,\uFF0C\s]/g, "")
      .replace(/^[\u00A5\uFFE5$]/, "")
      .replace(/元$/, "");

    let sign = 1;
    if (/^\(.*\)$/.test(text)) {
      sign = -1;
      text = text.slice(1, -1);
    }

    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) {
      return null;
    }

    const number = Number(text) * sign;
    return Number.isFinite(number) ? number : null;
  }

  function normalizeDate(value) {
    if (isMissing(value)) {
      return null;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
    }

    const text = String(value).trim();
    const match = text.match(
      /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
    );

    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] === undefined ? 0 : Number(match[4]);
    const minute = match[5] === undefined ? 0 : Number(match[5]);
    const second = match[6] === undefined ? 0 : Number(match[6]);

    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
      return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      return null;
    }

    return [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0")
    ].join("-");
  }

  function hasTimeComponent(value) {
    return typeof value === "string" && /\d{1,2}:\d{2}/.test(value);
  }

  function roundTo(value, precision) {
    const numeric = parseNumberLike(value);
    if (numeric === null) {
      return null;
    }
    const digits = Math.max(0, Math.min(8, Number(precision) || 0));
    const factor = 10 ** digits;
    return Math.round((numeric + Number.EPSILON) * factor) / factor;
  }

  function sortedNumeric(values) {
    return values
      .map(parseNumberLike)
      .filter((value) => value !== null)
      .sort((a, b) => a - b);
  }

  function mean(values) {
    const numbers = values.map(parseNumberLike).filter((value) => value !== null);
    if (!numbers.length) {
      return null;
    }
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }

  function quantile(values, ratio) {
    const numbers = sortedNumeric(values);
    if (!numbers.length) {
      return null;
    }
    const position = (numbers.length - 1) * Math.max(0, Math.min(1, ratio));
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) {
      return numbers[lower];
    }
    const weight = position - lower;
    return numbers[lower] * (1 - weight) + numbers[upper] * weight;
  }

  function median(values) {
    return quantile(values, 0.5);
  }

  function standardDeviation(values, population) {
    const numbers = values.map(parseNumberLike).filter((value) => value !== null);
    if (numbers.length < 2) {
      return 0;
    }
    const average = mean(numbers);
    const squared = numbers.reduce((sum, value) => sum + (value - average) ** 2, 0);
    const divisor = population ? numbers.length : numbers.length - 1;
    return Math.sqrt(squared / divisor);
  }

  function mode(values) {
    const counts = new Map();
    values.forEach((value) => {
      if (isMissing(value)) {
        return;
      }
      const key = typeof value === "string" ? value : JSON.stringify(value);
      const entry = counts.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(key, { value, count: 1 });
      }
    });

    let selected = null;
    let maxCount = 0;
    counts.forEach((entry) => {
      if (entry.count > maxCount) {
        selected = entry.value;
        maxCount = entry.count;
      }
    });
    return selected;
  }

  function formatNumber(value, options) {
    const numeric = parseNumberLike(value);
    if (numeric === null) {
      return "—";
    }
    const config = options || {};
    const maximumFractionDigits = config.maximumFractionDigits ?? 2;
    const minimumFractionDigits = config.minimumFractionDigits ?? 0;
    try {
      return new Intl.NumberFormat("zh-CN", {
        maximumFractionDigits,
        minimumFractionDigits,
        notation: config.notation || "standard"
      }).format(numeric);
    } catch (error) {
      return String(numeric);
    }
  }

  function formatPercent(value, digits) {
    const numeric = parseNumberLike(value);
    if (numeric === null) {
      return "—";
    }
    return `${(numeric * 100).toFixed(digits ?? 1)}%`;
  }

  function formatDateTime(value) {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date).replace(/\//g, "-");
  }

  function formatCell(value, schemaField) {
    if (isMissing(value)) {
      return { text: "缺失", empty: true, numeric: false };
    }
    if (schemaField && schemaField.type === "number") {
      return {
        text: formatNumber(value, {
          maximumFractionDigits: schemaField.precision ?? 2
        }),
        empty: false,
        numeric: true
      };
    }
    if (schemaField && schemaField.type === "date") {
      return { text: String(value), empty: false, numeric: false };
    }
    return { text: String(value), empty: false, numeric: false };
  }

  function formatBytes(bytes) {
    const numeric = Number(bytes) || 0;
    if (numeric < 1024) {
      return `${numeric} B`;
    }
    if (numeric < 1024 * 1024) {
      return `${(numeric / 1024).toFixed(1)} KB`;
    }
    return `${(numeric / (1024 * 1024)).toFixed(2)} MB`;
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      global.clearTimeout(timer);
      timer = global.setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function downloadText(fileName, content, mimeType) {
    const blob = new Blob([content], { type: mimeType || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    global.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function uniqueBy(values) {
    return Array.from(new Set(values));
  }

  function toCsv(rows, schema, delimiter) {
    if (!rows.length || !schema.length) {
      return "";
    }
    const sep = delimiter || ",";
    const escape = (value) => {
      const text = isMissing(value) ? "" : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [schema.map((field) => escape(field.key)).join(sep)];
    rows.forEach((row) => {
      lines.push(schema.map((field) => escape(row[field.key])).join(sep));
    });
    return lines.join("\r\n");
  }

  App.utils = {
    isMissing,
    clone,
    uid,
    escapeHtml,
    parseNumberLike,
    normalizeDate,
    hasTimeComponent,
    roundTo,
    sortedNumeric,
    mean,
    quantile,
    median,
    standardDeviation,
    mode,
    formatNumber,
    formatPercent,
    formatDateTime,
    formatCell,
    formatBytes,
    debounce,
    downloadText,
    uniqueBy,
    toCsv
  };
})(window);
