(function bootstrapGroupAnalysis(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const common = App.analysis.common;
  const utils = App.utils;

  function aggregateLabel(method) {
    return {
      sum: "求和",
      avg: "均值",
      count: "行数计数",
      distinct: "去重计数"
    }[method] || method;
  }

  function run(table, config) {
    const dimension = common.assertField(table, config.dimensionField, "分组维度");
    const method = config.aggregateMethod || "count";
    let metricField = null;
    if (method === "sum" || method === "avg") {
      metricField = common.assertField(table, config.metricField, "对比指标", ["number"]);
    }
    if (method === "distinct") {
      metricField = common.assertField(table, config.metricField, "去重计数字段");
    }
    if (!["sum", "avg", "count", "distinct"].includes(method)) {
      throw new Error("不支持当前聚合方式。");
    }

    const groups = common.groupBy(table.rows, dimension.key);
    const allRows = Array.from(groups.entries()).map(([name, rows]) => ({
      name,
      rows: rows.length,
      value: common.aggregate(rows, metricField ? metricField.key : null, method)
    })).sort((left, right) => {
      return (right.value ?? Number.NEGATIVE_INFINITY) - (left.value ?? Number.NEGATIVE_INFINITY);
    });

    if (!allRows.length) {
      throw new Error("当前维度没有可分组的数据。");
    }
    const totalValue = method === "avg" || method === "distinct"
      ? null
      : allRows.reduce((sum, row) => sum + (row.value || 0), 0);
    allRows.forEach((row) => {
      row.share = totalValue ? row.value / totalValue : null;
    });
    const requestedTop = config.topN === "all" ? allRows.length : Math.max(1, Number(config.topN) || 10);
    const shown = allRows.slice(0, requestedTop);
    const leading = shown[0];
    const metricName = method === "count"
      ? "记录数"
      : method === "distinct"
        ? `${metricField.key} 去重数`
        : `${metricField.key} ${aggregateLabel(method)}`;

    const metrics = [
      common.metric("group_count", "分组数量", allRows.length, {
        formatter: "number",
        digits: 0,
        definition: `${dimension.key} 中非缺失类别的数量`
      }),
      common.metric("group_records", "有效记录", table.rows.length, {
        formatter: "number",
        digits: 0,
        definition: "参与分组分析的全部数据行"
      }),
      common.metric("group_leading_value", "头部组指标", leading ? leading.value : null, {
        formatter: method === "avg" ? "number" : "compact",
        digits: 2,
        definition: `${leading ? leading.name : "首位"} 的 ${metricName}`
      })
    ];

    const warnings = [];
    const smallGroups = allRows.filter((row) => row.rows < 10);
    if (smallGroups.length) {
      warnings.push(`${smallGroups.length} 个分组记录数少于 10，比较均值时容易出现波动。`);
    }
    if (method === "avg" && allRows.length > 20) {
      warnings.push("均值未按分组样本量加权，跨组比较时请同时查看记录数。");
    }

    const summary = common.configSummary([
      { label: "分组维度", value: dimension.key },
      { label: "对比指标", value: metricField ? metricField.key : "记录数" },
      { label: "聚合方式", value: aggregateLabel(method) },
      { label: "排序方式", value: "按聚合值降序" },
      { label: "展示范围", value: config.topN === "all" ? "全部分组" : `Top ${requestedTop}` },
      { label: "缺失维度", value: "归入“缺失”分组" }
    ]);
    const columns = [
      { key: "name", label: dimension.key, align: "left" },
      { key: "rows", label: "记录数", type: "number", align: "right" },
      { key: "value", label: metricName, type: "number", align: "right" },
      { key: "share", label: "占比", type: "percent", align: "right" }
    ];
    const chartSpec = {
      type: "bar",
      title: `${dimension.key} 分组对比`,
      subtitle: `${metricName} · 按数值降序`,
      xAxisLabel: dimension.key,
      yAxisLabel: metricName,
      categories: shown.map((row) => row.name),
      series: [{
        name: metricName,
        data: shown.map((row) => row.value)
      }],
      valueFormat: method === "avg" ? "number" : "compact"
    };

    return common.record(
      table,
      "group",
      `按 ${dimension.key} 的分组对比`,
      {
        ...config,
        aggregateMethod: method,
        metricField: metricField ? metricField.key : null
      },
      summary,
      metrics,
      {
        columns,
        rows: shown,
        totalRows: allRows.length
      },
      chartSpec,
      warnings
    );
  }

  App.analysis.group = { run };
})(window);
