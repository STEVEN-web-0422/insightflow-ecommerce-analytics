(function bootstrapConstants(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};

  App.constants = Object.freeze({
    appName: "InsightFlow",
    dataVersion: "v1",
    storage: Object.freeze({
      warehouseIndex: "iflow:index:v1",
      tablePrefix: "iflow:table:",
      draft: "iflow:draft:v1",
      savedAnalyses: "iflow:analyses:v1",
      chatHistory: "iflow:chat:v1",
      reports: "iflow:reports:v1",
      ui: "iflow:ui:v1"
    }),
    fieldTypes: Object.freeze({
      number: "数值",
      date: "日期",
      category: "类别",
      text: "文本"
    }),
    fieldRoles: Object.freeze({
      identifier: "标识",
      time: "时间",
      metric: "指标",
      category: "维度",
      text: "文本"
    }),
    missingStrategies: Object.freeze([
      { value: "none", label: "不处理" },
      { value: "drop", label: "删除缺失行" },
      { value: "mean", label: "均值填充", types: ["number"] },
      { value: "median", label: "中位数填充", types: ["number"] },
      { value: "mode", label: "众数填充" },
      { value: "fixed", label: "固定值填充" }
    ]),
    outlierMethods: Object.freeze([
      { value: "iqr", label: "IQR · 1.5 倍四分位距" },
      { value: "sigma", label: "3σ · 均值 ± 3 倍标准差" }
    ]),
    aggregateMethods: Object.freeze([
      { value: "sum", label: "求和" },
      { value: "avg", label: "均值" },
      { value: "count", label: "计数（行数）" },
      { value: "distinct", label: "去重计数" }
    ]),
    routeMeta: Object.freeze({
      data: {
        eyebrow: "数据准备 / ODS → DWD → ADS",
        title: "电商数据流水线"
      },
      warehouse: {
        eyebrow: "数据准备 / 分层资产",
        title: "分层数据"
      },
      analysis: {
        eyebrow: "数据分析 / 业务洞察",
        title: "业务分析"
      },
      report: {
        eyebrow: "可视化与报告 / 智能生成",
        title: "AI 报告"
      },
      history: {
        eyebrow: "结果沉淀 / 资产复盘",
        title: "分析历史"
      }
    })
  });
})(window);
