(function bootstrapAnalysisEngine(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};

  const analyzers = {
    retention: () => App.analysis.retention,
    funnel: () => App.analysis.funnel,
    rfm: () => App.analysis.rfm,
    descriptive: () => App.analysis.descriptive,
    group: () => App.analysis.group,
    trend: () => App.analysis.trend,
    correlation: () => App.analysis.correlation
  };

  function run(type, table, config) {
    if (!table || !Array.isArray(table.rows) || !Array.isArray(table.schema)) {
      throw new Error("请选择有效的数据仓库表。");
    }
    if (!table.rows.length) {
      throw new Error("当前数据表没有可分析记录。");
    }
    const getAnalyzer = analyzers[type];
    if (!getAnalyzer) {
      throw new Error(`不支持的分析类型：${type}`);
    }
    const analyzer = getAnalyzer();
    const record = analyzer.run(table, config || {});
    registerAssistantAnalysis(record, table);
    const analysisContext = global.analysisContext = global.analysisContext || { analyses: [] };
    analysisContext.analyses = [
      ...(analysisContext.analyses || []).filter((item) => item.id !== record.id),
      App.utils.clone(record)
    ].slice(-50);
    App.state.addAnalysisRun(record);
    return record;
  }

  /**
   * 所有分析类型统一经过 engine.run，因此在这里作为结果回调：
   * 生成结构化摘要并写入全局助手 analyses，只保留最近五次明细和一条汇总。
   */
  function registerAssistantAnalysis(record, table) {
    const core = global.AI_ASSISTANT_CORE;
    const assistantContext = global.AI_ASSISTANT_CONTEXT;
    if (!core || !assistantContext || typeof core.buildAnalysisSummary !== "function") {
      return;
    }
    const previousRecords = [
      ...App.state.getAnalysisRuns(),
      ...App.analysis.store.list(table.id)
    ].filter((item) => item.tableId === table.id && item.type === record.type)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
    const previous = previousRecords[previousRecords.length - 1] || null;
    const summary = core.buildAnalysisSummary(
      record.type,
      record.config || {},
      record,
      previous
    );
    const currentEntries = (assistantContext.analyses || [])
      .filter((item) => item.tableId === table.id && !item.isAggregate);
    assistantContext.analyses = core.trimAnalysisSummaries([
      ...currentEntries,
      {
        type: record.type,
        tableId: table.id,
        recordId: record.id,
        title: record.title,
        summary,
        createdAt: record.createdAt
      }
    ]);
  }

  function save(record) {
    return App.analysis.store.save(record);
  }

  App.analysis.engine = {
    run,
    save,
    supportedTypes: Object.keys(analyzers)
  };
})(window);
