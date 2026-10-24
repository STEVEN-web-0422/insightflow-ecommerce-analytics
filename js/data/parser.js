(function bootstrapParser(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const MAX_FILE_BYTES = 20 * 1024 * 1024;

  function parseDelimitedFallback(text) {
    const source = String(text || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      const next = source[index + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"' && field === "") {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        if (char === "\r" && next === "\n") {
          index += 1;
        }
      } else {
        field += char;
      }
    }

    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }

    return {
      data: rows,
      errors: inQuotes ? [{ message: "检测到未闭合的引号，已按当前内容尽力解析。" }] : []
    };
  }

  function createHeaders(rawHeaders) {
    const seen = new Map();
    return rawHeaders.map((rawHeader, index) => {
      let header = String(rawHeader ?? "").replace(/^\uFEFF/, "").trim();
      if (!header) {
        header = `字段_${index + 1}`;
      }
      const base = header;
      let count = seen.get(base) || 0;
      seen.set(base, count + 1);
      if (count > 0) {
        header = `${base}_${count + 1}`;
      }
      return header;
    });
  }

  function parseCsv(text, fileName) {
    return new Promise((resolve, reject) => {
      const usePapa = Boolean(global.Papa && typeof global.Papa.parse === "function");
      const parsed = usePapa
        ? global.Papa.parse(String(text), {
          header: false,
          skipEmptyLines: "greedy"
        })
        : parseDelimitedFallback(text);

      if (!parsed.data || parsed.data.length < 2) {
        reject(new Error("CSV 没有可识别的数据行。"));
        return;
      }

      const headers = createHeaders(parsed.data[0]);
      if (!headers.length || headers.every((header) => /^字段_\d+$/.test(header))) {
        reject(new Error("未识别到有效的表头。请确认第一行是字段名。"));
        return;
      }

      const rows = parsed.data.slice(1)
        .filter((row) => Array.isArray(row) && row.some((value) => String(value ?? "").trim() !== ""))
        .map((row, rowIndex) => {
          const output = { __rowId: `row_${String(rowIndex + 1).padStart(5, "0")}` };
          headers.forEach((header, columnIndex) => {
            output[header] = row[columnIndex] === undefined || row[columnIndex] === null
              ? ""
              : String(row[columnIndex]);
          });
          return output;
        });

      if (!rows.length) {
        reject(new Error("CSV 表头有效，但没有数据内容。"));
        return;
      }

      const draft = App.profiler.createDraft(rows, headers, {
        fileName,
        parseWarnings: parsed.errors || []
      });
      draft.source.parser = usePapa ? "PapaParse" : "builtin-fallback";
      resolve({
        draft,
        parseErrors: parsed.errors || [],
        originalRowCount: rows.length,
        parserUsed: draft.source.parser
      });
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("未选择文件。"));
        return;
      }
      if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
        reject(new Error("当前阶段仅支持 CSV 文件。"));
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        reject(new Error("文件超过 20 MB，浏览器演示环境暂不支持。"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        parseCsv(String(reader.result || ""), file.name)
          .then(resolve)
          .catch(reject);
      };
      reader.onerror = () => reject(new Error("文件读取失败，请重新选择。"));
      reader.readAsText(file, "utf-8");
    });
  }

  App.parser = {
    parseCsv,
    readFile,
    createHeaders,
    parseDelimitedFallback
  };
})(window);
