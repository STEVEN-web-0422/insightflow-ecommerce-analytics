(function bootstrapCorrelationAnalysis(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const common = App.analysis.common;
  const utils = App.utils;

  function pearson(pairs) {
    if (pairs.length < 3) {
      return { r: null, n: pairs.length };
    }
    const meanX = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length;
    const meanY = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length;
    let covariance = 0;
    let varianceX = 0;
    let varianceY = 0;
    pairs.forEach((pair) => {
      const dx = pair.x - meanX;
      const dy = pair.y - meanY;
      covariance += dx * dy;
      varianceX += dx * dx;
      varianceY += dy * dy;
    });
    const denominator = Math.sqrt(varianceX * varianceY);
    return {
      r: denominator > 0 ? covariance / denominator : null,
      n: pairs.length
    };
  }

  function run(table, config) {
    const fieldKeys = utils.uniqueBy(config.fields || []);
    if (fieldKeys.length < 2) {
      throw new Error("相关性分析至少选择 2 个数值字段。");
    }
    if (fieldKeys.length > 10) {
      throw new Error("为保证热力图可读性，单次最多选择 10 个数值字段。");
    }
    const fields = fieldKeys.map((key) => common.assertField(table, key, "数值字段", ["number"]));
    const matrix = fields.map(() => fields.map(() => null));
    const pairDetails = [];

    for (let rowIndex = 0; rowIndex < fields.length; rowIndex += 1) {
      for (let columnIndex = rowIndex; columnIndex < fields.length; columnIndex += 1) {
        const left = fields[rowIndex];
        const right = fields[columnIndex];
        if (rowIndex === columnIndex) {
          matrix[rowIndex][columnIndex] = 1;
          continue;
        }
        const pairs = table.rows.map((row) => {
          const x = utils.parseNumberLike(row[left.key]);
          const y = utils.parseNumberLike(row[right.key]);
          return x !== null && y !== null ? { x, y } : null;
        }).filter(Boolean);
        const result = pearson(pairs);
        matrix[rowIndex][columnIndex] = result.r;
        matrix[columnIndex][rowIndex] = result.r;
        pairDetails.push({
          fieldA: left.key,
          fieldB: right.key,
          r: result.r,
          n: result.n,
          strength: result.r === null
            ? "无法计算"
            : Math.abs(result.r) >= 0.7
              ? "强"
              : Math.abs(result.r) >= 0.4
                ? "中等"
                : "弱"
        });
      }
    }

    const validPairs = pairDetails.filter((pair) => pair.r !== null);
    const strongest = validPairs.slice().sort((left, right) => Math.abs(right.r) - Math.abs(left.r))[0] || null;
    const lowSamplePairs = pairDetails.filter((pair) => pair.n < 30);
    const matrixRows = fields.map((field, rowIndex) => {
      const row = { field: field.key };
      fields.forEach((_, columnIndex) => {
        row[`f${columnIndex}`] = matrix[rowIndex][columnIndex];
      });
      return row;
    });
    const columns = [
      { key: "field", label: "字段", align: "left" },
      ...fields.map((field, index) => ({
        key: `f${index}`,
        label: field.key,
        type: "correlation",
        align: "right"
      }))
    ];
    const metrics = [
      common.metric("correlation_fields", "参与字段", fields.length, {
        formatter: "number",
        digits: 0,
        definition: "参与 Pearson 相关矩阵的数值字段数量"
      }),
      common.metric("correlation_strongest", "最强相关系数", strongest ? strongest.r : null, {
        digits: 3,
        definition: strongest ? `${strongest.fieldA} 与 ${strongest.fieldB} 的 Pearson r` : "没有可计算的有效字段对"
      }),
      common.metric("correlation_sample", "最强关系样本量", strongest ? strongest.n : null, {
        formatter: "number",
        digits: 0,
        definition: "最强相关字段对同时存在有效数值的行数"
      })
    ];

    const warnings = [];
    if (lowSamplePairs.length) {
      warnings.push(`${lowSamplePairs.length} 个字段对的有效样本少于 30，相关系数可能不稳定。`);
    }
    if (pairDetails.some((pair) => pair.r === null)) {
      warnings.push("部分字段对因共同有效样本不足 3 或字段无波动，无法计算相关系数。");
    }
    warnings.push("Pearson 相关系数只刻画线性关系，不代表因果关系。");

    const summary = common.configSummary([
      { label: "参与字段", value: fields.map((field) => field.key).join("、") },
      { label: "相关方法", value: "Pearson 线性相关系数" },
      { label: "缺失处理", value: "逐字段对删除缺失值" },
      { label: "矩阵维度", value: `${fields.length} × ${fields.length}` },
      { label: "展示口径", value: "−1 到 1，越接近 ±1 线性关系越强" }
    ]);
    const heatmapData = [];
    matrix.forEach((row, rowIndex) => {
      row.forEach((value, columnIndex) => {
        heatmapData.push({
          x: columnIndex,
          y: rowIndex,
          value
        });
      });
    });
    const chartSpec = {
      type: "heatmap",
      title: "数值字段 Pearson 相关矩阵",
      subtitle: "逐字段对删除缺失值",
      x: fields.map((field) => field.key),
      y: fields.map((field) => field.key),
      data: heatmapData,
      min: -1,
      max: 1
    };

    return {
      ...common.record(
        table,
        "correlation",
        "字段相关性矩阵",
        { ...config, fields: fieldKeys },
        summary,
        metrics,
        {
          columns,
          rows: matrixRows,
          totalRows: matrixRows.length
        },
        chartSpec,
        warnings
      ),
      summaryTable: {
        title: "字段对样本量与关系强度",
        columns: [
          { key: "fieldA", label: "字段 A", align: "left" },
          { key: "fieldB", label: "字段 B", align: "left" },
          { key: "r", label: "Pearson r", type: "number", align: "right" },
          { key: "n", label: "共同样本", type: "number", align: "right" },
          { key: "strength", label: "关系强度", align: "left" }
        ],
        rows: pairDetails
      }
    };
  }

  App.analysis.correlation = { run, pearson };
})(window);
