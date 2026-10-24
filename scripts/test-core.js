"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

global.window = global;
const localStorageData = new Map();
global.localStorage = {
  getItem: (key) => localStorageData.has(key) ? localStorageData.get(key) : null,
  setItem: (key, value) => localStorageData.set(key, String(value)),
  removeItem: (key) => localStorageData.delete(key),
  key: (index) => Array.from(localStorageData.keys())[index] || null,
  get length() {
    return localStorageData.size;
  }
};

const root = path.resolve(__dirname, "..");
[
  "js/core/constants.js",
  "js/core/utils.js",
  "js/core/storage.js",
  "js/core/state.js",
  "js/ai-assistant.js",
  "js/ai-config.js",
  "js/data/profiler.js",
  "js/data/parser.js",
  "js/data/warehouse.js",
  "data/sample-events.js",
  "js/data/data-warehouse.js",
  "js/analysis/common.js",
  "js/analysis/retention.js",
  "js/analysis/funnel.js",
  "js/analysis/rfm.js",
  "js/analysis/descriptive.js",
  "js/analysis/group.js",
  "js/analysis/trend.js",
  "js/analysis/correlation.js",
  "js/analysis/store.js",
  "js/analysis/engine.js",
  "js/sql-generator.js",
  "js/ai-sql.js",
  "js/ai/context-builder.js",
  "js/ai/prompts.js",
  "js/ai/client.js",
  "js/ai/chat-store.js",
  "js/ai/report-store.js",
  "js/ai/report.js",
  "js/ai/ai-assistant.js"
].forEach((relativePath) => {
  const absolutePath = path.join(root, relativePath);
  vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
});

const App = global.AIWorkbench;

async function main() {
  assert.strictEqual(App.utils.normalizeDate("2026/9/5T10:30:00"), "2026-09-05");
  assert.strictEqual(App.utils.parseNumberLike("¥1,299.50"), 1299.5);

  assert.strictEqual(global.getAIConfig(), null);
  global.AIConfig.save({
    apiKey: "sk-test",
    model: "deepseek-reasoner",
    baseUrl: "https://proxy.example.com/v1/"
  });
  assert.deepStrictEqual(global.getAIConfig(), {
    apiKey: "sk-test",
    model: "deepseek-reasoner",
    baseUrl: "https://proxy.example.com/v1"
  });
  assert.strictEqual(JSON.parse(global.localStorage.getItem("ai_config")).apiKey, "sk-test");
  global.AIConfig.clear();

  const ods = await global.dataWarehouse.ensureOds();
  assert.strictEqual(ods.layer, "ODS");
  assert.ok(ods.rows.length >= 800 && ods.rows.length <= 1000);
  assert.ok(ods.schema.some((field) => field.key === "time" && field.type === "date"));
  assert.ok(ods.schema.some((field) => field.key === "amount" && field.type === "number"));

  const build = await global.dataWarehouse.buildDwd();
  const dwd = global.dataWarehouse.dwd;
  assert.strictEqual(dwd.layer, "DWD");
  assert.strictEqual(dwd.name, "电商行为分析_DWD");
  assert.strictEqual(build.sourceRows, ods.rows.length);
  assert.ok(dwd.rows.every((row) => row.user_id && /^\d{4}-\d{2}-\d{2}$/.test(row.time)));
  assert.ok(dwd.schema.some((field) => field.key === "date" && field.type === "date"));
  assert.ok(dwd.schema.some((field) => field.key === "hour" && field.type === "number"));
  assert.ok(dwd.rows.filter((row) => row.hour !== null).every((row) => row.hour >= 0 && row.hour <= 23));
  assert.ok(dwd.rows.filter((row) => row.amount !== null).every((row) => typeof row.amount === "number"));
  assert.strictEqual(App.warehouse.listTables().filter((table) => table.name === "电商行为分析_DWD").length, 1);

  const retention = App.analysis.engine.run("retention", dwd, {
    userIdField: "user_id",
    timeField: "time",
    eventField: "event",
    eventValue: "__all__",
    retentionMode: "cohort",
    cohortGranularity: "week",
    horizon: 8
  });
  const funnel = App.analysis.engine.run("funnel", dwd, {
    userIdField: "user_id",
    timeField: "time",
    eventField: "event",
    steps: ["view", "add_cart", "purchase"],
    windowDays: 7
  });
  const maxDate = dwd.rows.map((row) => row.time).filter(Boolean).sort().pop();
  const rfm = App.analysis.engine.run("rfm", dwd, {
    userIdField: "user_id",
    timeField: "time",
    amountField: "amount",
    eventField: "event",
    eventValue: "purchase",
    snapshotDate: maxDate,
    scoringMethod: "quantile",
    quantileCut: 60
  });
  const mixedRfm = App.analysis.rfm.run(dwd, {
    userIdField: "user_id",
    timeField: "time",
    amountField: "amount",
    eventField: "event",
    eventValue: "purchase",
    snapshotDate: maxDate,
    rScoringMethod: "fixed",
    fScoringMethod: "quantile",
    mScoringMethod: "quantile",
    rThresholdMax: 14,
    quantileCut: 60
  });
  assert.strictEqual(mixedRfm.config.resolvedThresholds.rMode, "fixed");
  assert.strictEqual(mixedRfm.config.resolvedThresholds.fMode, "quantile");
  assert.strictEqual(mixedRfm.config.resolvedThresholds.mMode, "quantile");
  const descriptive = App.analysis.engine.run("descriptive", dwd, {
    metricField: "amount",
    binCount: 8
  });
  const group = App.analysis.engine.run("group", dwd, {
    dimensionField: "channel",
    metricField: "amount",
    aggregateMethod: "sum",
    topN: "all"
  });
  const trend = App.analysis.engine.run("trend", dwd, {
    timeField: "date",
    metricField: "amount",
    granularity: "week",
    aggregateMethod: "sum"
  });
  const correlation = App.analysis.engine.run("correlation", dwd, {
    fields: ["amount", "unit_price", "quantity", "duration_sec"]
  });
  assert.strictEqual(App.state.get().analysisRuns.length, 7);
  assert.strictEqual(retention.chartSpec.type, "line");
  assert.strictEqual(funnel.resultTable.rows.length, 3);
  assert.strictEqual(rfm.summaryTable.rows.length, 8);
  assert.strictEqual(descriptive.resultTable.rows.length, 6);
  assert.ok(group.resultTable.rows.length >= 4);
  assert.ok(trend.resultTable.rows.length >= 3);
  assert.strictEqual(correlation.resultTable.columns.length, 5);

  const savedAnalysis = App.analysis.engine.save(retention);
  global.dataWarehouse.addAds(savedAnalysis.record);
  assert.strictEqual(global.dataWarehouse.ads.length, 1);
  assert.strictEqual(global.dataWarehouse.ads[0].layer, "ADS");
  assert.strictEqual(global.dataWarehouse.ads[0].tableId, dwd.id);

  const assistantContext = App.ai.assistant.buildContext();
  assert.strictEqual(assistantContext.currentModule, "电商数据流水线");
  assert.strictEqual(assistantContext.dataLayer, "DWD");
  assert.strictEqual(assistantContext.tableName, dwd.name);
  assert.ok(assistantContext.fields.every((field) => field.name && field.type && Number.isFinite(field.missingRate)));
  assert.ok(assistantContext.analyses.length <= 6);
  assert.ok(!JSON.stringify(assistantContext).includes('"rows"'));
  const builtMessages = global.AI_ASSISTANT_CORE.buildMessages(
    "漏斗哪一步流失最大？",
    assistantContext,
    []
  );
  assert.match(builtMessages[0].content, /专为电商日志分析设计/);
  assert.match(builtMessages[1].content, /【当前数据层级】\nDWD/);
  assert.ok(global.AI_ASSISTANT_CONTEXT.analyses.length <= 6);

  const reportContext = App.ai.contextBuilder.build(dwd, App.ai.contextBuilder.getAnalyses());
  assert.ok(reportContext.context.analyses.length >= 7);
  assert.strictEqual("rows" in reportContext.context.primaryTable, false);
  const reportPrompt = App.ai.prompts.reportUserPrompt(reportContext.aiContext, "电商经营数据分析报告");
  const reportSystemPrompt = App.ai.prompts.reportSystemPrompt();
  assert.strictEqual(App.ai.prompts.validatePromptContext(reportContext.aiContext), true);
  assert.ok(!/\{\{?m[:：]|_retention_primary|user_id|"ref"\s*:|首次行为时间|行为筛选/.test(reportPrompt));
  assert.ok(reportPrompt.includes("最大单步流失人数"));
  assert.ok(reportPrompt.includes("本次漏斗分析的实际步骤是"));
  assert.ok(reportSystemPrompt.includes("严禁使用 LaTeX"));
  assert.ok(reportSystemPrompt.includes("中长期留存"));
  assert.ok(reportSystemPrompt.includes("具体的、量化的业务目标"));
  const maxDropMetric = reportContext.aiContext.analyses
    .flatMap((analysis) => analysis.metrics)
    .find((metric) => metric.name === "最大单步流失人数");
  assert.match(maxDropMetric.displayValue, /^\d+ 人$/);
  const d7Metric = reportContext.aiContext.analyses
    .flatMap((analysis) => analysis.metrics)
    .find((metric) => metric.name.includes("7 日留存"));
  assert.ok(d7Metric && d7Metric.displayValue !== "当前数据周期不足，暂无可用数据");
  const twoStepBundle = App.ai.contextBuilder.build(dwd, [{
    ...funnel,
    config: {
      ...funnel.config,
      steps: ["view", "purchase"]
    },
    chartSpec: {
      ...funnel.chartSpec,
      data: [
        { name: "view", value: 230 },
        { name: "purchase", value: 86 }
      ]
    }
  }]);
  const twoStepScope = twoStepBundle.aiContext.analyses[0].scope;
  assert.ok(twoStepScope.includes("view → purchase"));
  assert.ok(!twoStepScope.includes("add_cart"));
  assert.strictEqual(
    twoStepBundle.aiContext.analyses[0].funnelSteps.map((step) => step.step).join(","),
    "view,purchase"
  );
  const nullContext = JSON.parse(JSON.stringify(reportContext.context));
  nullContext.analyses[0].metrics[0].value = null;
  nullContext.analyses[0].metrics[0].formatted = "—";
  const nullSafeContext = App.ai.contextBuilder.buildAiContext(nullContext);
  assert.strictEqual(
    nullSafeContext.analyses[0].metrics[0].displayValue,
    "当前数据周期不足，暂无可用数据"
  );
  const sanitizeWarnings = [];
  const sanitizedReportText = App.ai.report.sanitizeText(
    "留存 {m [未登记数值] _retention_primary}，结果为 **999%**，建议在 8 小时内触达，一段时间留存仍需观察。",
    reportContext.metricLookup,
    sanitizeWarnings
  );
  assert.ok(!/\{\{?m|_retention_primary/.test(sanitizedReportText));
  assert.ok(!/未登记数值|数值待核实|指标待核实|未知/.test(sanitizedReportText));
  assert.ok(sanitizedReportText.includes("一定比例"));
  assert.ok(sanitizedReportText.includes("24 小时"));
  assert.ok(sanitizedReportText.includes("中长期"));
  assert.ok(!sanitizedReportText.includes("一段时间"));
  assert.ok(sanitizeWarnings.length >= 1);
  assert.strictEqual(
    App.ai.report.sanitizeText("view → add_cart → purchase", reportContext.metricLookup, []),
    "view → add_cart → purchase"
  );
  assert.strictEqual(
    App.ai.report.normalizeLatexText("\\(37.4\\%\\)，view \\(\\twoheadrightarrow\\) purchase"),
    "37.4%，view → purchase"
  );
  const quantifiedAction = App.ai.report.ensureActionTarget("建议提升至一定比例以上，并在 48 小时内触达。");
  assert.ok(quantifiedAction.includes("10%"));
  assert.ok(quantifiedAction.includes("以上"));

  const sqlCases = {
    funnel: App.sql.generateSQL("funnel", funnel.config, dwd.name),
    retention: App.sql.generateSQL("retention", retention.config, dwd.name),
    rfm: App.sql.generateSQL("rfm", rfm.config, dwd.name),
    descriptive: App.sql.generateSQL("descriptive", descriptive.config, dwd.name),
    group: App.sql.generateSQL("group", group.config, dwd.name),
    trend: App.sql.generateSQL("trend", trend.config, dwd.name),
    correlation: App.sql.generateSQL("correlation", correlation.config, dwd.name)
  };
  Object.entries(sqlCases).forEach(([type, sql]) => {
    assert.match(sql, /SELECT/i, `${type} missing SELECT`);
    assert.match(sql, /FROM/i, `${type} missing FROM`);
    assert.ok(sql.includes(`"${dwd.name}"`));
  });
  assert.match(sqlCases.funnel, /INTERVAL '7' DAY/);
  const changedFunnelSql = App.sql.generateSQL("funnel", {
    ...funnel.config,
    steps: ["view", "purchase"],
    windowDays: 14
  }, dwd.name);
  assert.match(changedFunnelSql, /INTERVAL '14' DAY/);

  const explainMessages = App.aiSql.buildExplainMessages(
    "funnel",
    dwd.name,
    dwd.schema.map((field) => ({ name: field.key, type: field.type, role: field.role })),
    sqlCases.funnel
  );
  const reviseMessages = App.aiSql.buildReviseMessages(
    "funnel",
    dwd.name,
    dwd.schema.map((field) => ({ name: field.key, type: field.type, role: field.role })),
    sqlCases.funnel,
    "把转化窗口改成14天"
  );
  assert.match(explainMessages[0].content, /SQL 分析助手/);
  assert.match(explainMessages[0].content, /以上由 AI 生成，需人工校验/);
  assert.match(reviseMessages[1].content, /把转化窗口改成14天/);
  assert.ok(!explainMessages[1].content.includes('"rows"'));

  const session = App.ai.chatStore.ensure("__global_assistant__", "全局 AI 助手");
  session.messages.push({
    id: "test_message",
    role: "user",
    content: "测试问题",
    createdAt: new Date().toISOString()
  });
  App.ai.chatStore.save(session);
  assert.strictEqual(App.ai.chatStore.get("__global_assistant__").messages.length, 1);
  App.ai.chatStore.clear("__global_assistant__");

  const storedReport = App.ai.reportStore.save({
    id: "report_test",
    title: "测试报告",
    mode: "local",
    modeLabel: "本地演示底稿",
    createdAt: new Date().toISOString(),
    table: { name: dwd.name, version: dwd.version, rowCount: dwd.rowCount },
    sections: {},
    analyses: [],
    validationWarnings: [],
    documentHtml: "<article class=\"ai-report-document\">测试报告</article>"
  });
  assert.strictEqual(storedReport.count, 1);

  console.log(JSON.stringify({
    odsRows: ods.rows.length,
    dwdRows: dwd.rows.length,
    dwdFields: dwd.schema.length,
    analysesRun: App.state.get().analysisRuns.length,
    adsRecords: global.dataWarehouse.ads.length,
    assistantLayer: assistantContext.dataLayer,
    sqlTypes: Object.keys(sqlCases).length,
    storedReports: App.ai.reportStore.list().length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
