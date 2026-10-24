(function bootstrapTrendAnalysis(global) {
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

  function changeRate(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
      return null;
    }
    return (current - previous) / Math.abs(previous);
  }

  function shiftMonth(monthKey, offset) {
    const parts = String(monthKey).split("-").map(Number);
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return null;
    }
    const date = new Date(Date.UTC(parts[0], parts[1] - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function run(table, config) {
    const timeField = common.assertField(table, config.timeField, "时间列", ["date"]);
    const method = config.aggregateMethod || "sum";
    let metricField = null;
    if (method === "sum" || method === "avg") {
      metricField = common.assertField(table, config.metricField, "趋势指标", ["number"]);
    }
    if (method === "distinct") {
      metricField = common.assertField(table, config.metricField, "去重计数字段");
    }
    const granularity = ["day", "week", "month"].includes(config.granularity)
      ? config.granularity
      : "day";

    const groups = new Map();
    table.rows.forEach((row) => {
      if (utils.isMissing(row[timeField.key])) {
        return;
      }
      const period = common.periodInfo(row[timeField.key], granularity);
      const key = period.key;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: period.label,
          rows: []
        });
      }
      groups.get(key).rows.push(row);
    });

    const periods = Array.from(groups.values())
      .sort((left, right) => String(left.key).localeCompare(String(right.key)))
      .map((group) => ({
        key: group.key,
        label: group.label,
        rows: group.rows.length,
        value: common.aggregate(group.rows, metricField ? metricField.key : null, method)
      }));
    if (!periods.length) {
      throw new Error("时间列没有可识别数据。");
    }

    const byKey = new Map(periods.map((period) => [period.key, period]));
    periods.forEach((period, index) => {
      const previous = index > 0 ? periods[index - 1] : null;
      period.previousValue = previous ? previous.value : null;
      period.periodChange = previous ? changeRate(period.value, previous.value) : null;
      let priorKey = null;
      if (granularity === "month") {
        priorKey = shiftMonth(period.key, -12);
      } else if (granularity === "week") {
        priorKey = common.formatDateOffset(period.key, -364);
      } else {
        priorKey = common.formatDateOffset(period.key, -365);
      }
      const prior = priorKey ? byKey.get(priorKey) : null;
      period.previousYearValue = prior ? prior.value : null;
      period.yearOverYear = prior ? changeRate(period.value, prior.value) : null;
    });

    const latest = periods[periods.length - 1];
    const priorYearPoints = periods.map((period) => {
      let priorKey = null;
      if (granularity === "month") {
        priorKey = shiftMonth(period.key, -12);
      } else if (granularity === "week") {
        priorKey = common.formatDateOffset(period.key, -364);
      } else {
        priorKey = common.formatDateOffset(period.key, -365);
      }
      const prior = priorKey ? byKey.get(priorKey) : null;
      return prior ? prior.value : null;
    });
    const hasPriorYear = priorYearPoints.some((value) => value !== null);
    const average = periods
      .map((period) => period.value)
      .filter((value) => value !== null)
      .reduce((sum, value, index, values) => sum + value / values.length, 0);
    const metricName = method === "count"
      ? "记录数"
      : method === "distinct"
        ? `${metricField.key} 去重数`
        : `${metricField.key} ${aggregateLabel(method)}`;

    const metrics = [
      common.metric("trend_latest", `最新周期 · ${metricName}`, latest.value, {
        formatter: method === "avg" ? "number" : "compact",
        digits: 2,
        definition: `${latest.label} 的聚合指标`
      }),
      common.metric("trend_average", "周期均值", average, {
        formatter: method === "avg" ? "number" : "compact",
        digits: 2,
        definition: "各时间周期聚合值的算术平均"
      }),
      common.metric("trend_mom", "最新环比", latest.periodChange, {
        formatter: "percent",
        definition: "最新周期较上一周期的变化；上期为 0 时不计算"
      }),
      common.metric("trend_yoy", "最新同比", latest.yearOverYear, {
        formatter: "percent",
        definition: "最新周期较上年同周期的变化；缺少同期历史时不计算"
      })
    ];

    const warnings = [];
    if (periods.length < 3) {
      warnings.push("时间周期少于 3 个，趋势变化可能不具备稳定性。");
    }
    if (!hasPriorYear) {
      warnings.push("当前数据未覆盖上年同期，无法计算同比。");
    }
    if (latest.periodChange === null) {
      warnings.push("最新周期没有可比的上期值，环比不可计算。");
    }

    const summary = common.configSummary([
      { label: "时间字段", value: timeField.key },
      { label: "趋势指标", value: metricField ? metricField.key : "记录数" },
      { label: "时间粒度", value: { day: "按日", week: "按周", month: "按月" }[granularity] },
      { label: "聚合方式", value: aggregateLabel(method) },
      { label: "时间范围", value: `${periods[0].label} 至 ${latest.label}` },
      { label: "对比口径", value: "环比上一周期；同比上年同周期" }
    ]);
    const columns = [
      { key: "label", label: "周期", align: "left" },
      { key: "value", label: metricName, type: "number", align: "right" },
      { key: "periodChange", label: "环比", type: "percent", align: "right" },
      { key: "previousYearValue", label: "上年同期", type: "number", align: "right" },
      { key: "yearOverYear", label: "同比", type: "percent", align: "right" }
    ];
    const chartSpec = {
      type: "line",
      title: `${metricName} 趋势`,
      subtitle: `${periods[0].label} 至 ${latest.label} · ${aggregateLabel(method)}`,
      xAxisLabel: "时间周期",
      yAxisLabel: metricName,
      categories: periods.map((period) => period.label),
      series: [
        {
          name: "当前周期",
          data: periods.map((period) => period.value)
        },
        ...(hasPriorYear ? [{
          name: "上年同期",
          data: priorYearPoints
        }] : [])
      ],
      valueFormat: method === "avg" ? "number" : "compact"
    };

    return common.record(
      table,
      "trend",
      `${metricName} 趋势分析`,
      {
        ...config,
        aggregateMethod: method,
        metricField: metricField ? metricField.key : null,
        granularity
      },
      summary,
      metrics,
      {
        columns,
        rows: periods,
        totalRows: periods.length
      },
      chartSpec,
      warnings
    );
  }

  App.analysis.trend = { run };
})(window);
