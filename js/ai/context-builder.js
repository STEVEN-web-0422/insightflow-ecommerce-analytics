(function bootstrapReportContext(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const fieldLabels = {
    user_id: "用户",
    event: "用户行为",
    time: "行为时间",
    date: "业务日期",
    hour: "小时",
    amount: "成交金额",
    channel: "流量渠道",
    category: "商品品类",
    unit_price: "商品单价",
    quantity: "购买数量",
    duration_sec: "页面停留时长"
  };
  const analysisLabels = {
    retention: "用户留存分析",
    funnel: "转化漏斗分析",
    rfm: "用户价值分层",
    descriptive: "经营指标统计",
    group: "分组表现对比",
    trend: "经营趋势分析",
    correlation: "指标关联分析"
  };
  function businessize(text) {
    let output = String(text === null || text === undefined ? "" : text)
      .replaceAll("加权留存", "整体留存")
      .replaceAll("首次行为时间", "首次活跃时间")
      .replaceAll("行为筛选", "用户行为范围")
      .replaceAll("用户标识", "用户身份")
      .replaceAll("事件字段", "用户行为")
      .replaceAll("观察窗口", "数据周期")
      .replaceAll("观察周期", "数据周期")
      .replaceAll("口径", "统计方式")
      .replaceAll("去重用户数", "用户数")
      .replaceAll("Cohort", "用户批次")
      .replaceAll("RFM", "用户价值")
      .replaceAll("Pearson", "指标关联")
      .replaceAll("标准差", "波动幅度")
      .replaceAll("分位数", "用户分组");
    Object.entries(fieldLabels).forEach(([key, label]) => {
      output = output.replace(new RegExp(`\\b${key}\\b`, "g"), label);
    });
    return output;
  }

  function analysisScope(analysis) {
    if (analysis.type === "funnel") {
      const steps = Array.isArray(analysis.config?.steps) ? analysis.config.steps : [];
      const windowDays = Number(analysis.config?.windowDays) || 7;
      return `本次漏斗分析的实际步骤是：${steps.join(" → ")}，转化窗口为 ${windowDays} 天。未在步骤中出现的环节不得描述为已分析或已发生流失。`;
    }
    if (analysis.type === "retention") {
      const behavior = analysis.config?.eventValue === "purchase" ? "支付用户" : "全部活跃用户";
      const granularity = analysis.config?.retentionMode === "weekly" ? "按周" : "按日";
      return `本次留存分析关注${behavior}，按${granularity}观察用户回访表现。`;
    }
    if (analysis.type === "rfm") {
      return "本次用户价值分层仅基于已发生成交的用户，未成交用户不参与分层。";
    }
    if (analysis.type === "group" && analysis.config?.dimensionField) {
      const labels = { channel: "流量渠道", category: "商品品类", date: "日期", hour: "小时" };
      return `本次只按${labels[analysis.config.dimensionField] || "业务维度"}比较表现，不得补充其他分组维度。`;
    }
    if (analysis.type === "trend") {
      const granularity = { day: "按日", week: "按周", month: "按月" }[analysis.config?.granularity] || "按日";
      return `本次只观察${granularity}趋势，不得描述未提供的同比或活动归因。`;
    }
    return "请严格沿用本次已运行分析的范围，不要假设未提供的细分维度。";
  }

  // 将聊天结果中的相邻步骤落差转成可引用的业务事实，避免模型自行猜测流失人数。
  function deriveAnalysisMetrics(analysis) {
    if (analysis.type !== "funnel" || !Array.isArray(analysis.chartSpec?.data)) {
      return [];
    }
    const steps = analysis.chartSpec.data
      .map((item) => ({ name: item.name, value: Number(item.value) }))
      .filter((item) => Number.isFinite(item.value));
    const drops = [];
    for (let index = 1; index < steps.length; index += 1) {
      const loss = steps[index - 1].value - steps[index].value;
      if (loss > 0) {
        drops.push({
          from: steps[index - 1].name,
          to: steps[index].name,
          loss,
          rate: steps[index - 1].value ? loss / steps[index - 1].value : null
        });
      }
    }
    if (!drops.length) {
      return steps.map((step, index) => ({
        id: `funnel_step_${index + 1}_users`,
        label: `${step.name} 用户数`,
        value: step.value,
        formatted: `${utils.formatNumber(step.value, { maximumFractionDigits: 0 })} 人`,
        formatter: "number",
        definition: `${step.name} 步骤覆盖的用户数量`
      }));
    }
    const largest = [...drops].sort((left, right) => right.loss - left.loss)[0];
    return [
      ...steps.map((step, index) => ({
        id: `funnel_step_${index + 1}_users`,
        label: `${step.name} 用户数`,
        value: step.value,
        formatted: `${utils.formatNumber(step.value, { maximumFractionDigits: 0 })} 人`,
        formatter: "number",
        definition: `${step.name} 步骤覆盖的用户数量`
      })),
      ...drops.flatMap((drop, index) => [
        {
          id: `funnel_drop_${index + 1}_users`,
          label: `${drop.from} → ${drop.to} 流失人数`,
          value: drop.loss,
          formatted: `${utils.formatNumber(drop.loss, { maximumFractionDigits: 0 })} 人`,
          formatter: "number",
          definition: `${drop.from} 到 ${drop.to} 环节流失的用户数量`
        },
        {
          id: `funnel_drop_${index + 1}_rate`,
          label: `${drop.from} → ${drop.to} 流失率`,
          value: drop.rate,
          formatted: drop.rate === null ? "当前数据周期不足，暂无可用数据" : utils.formatPercent(drop.rate, 1),
          formatter: "percent",
          definition: `${drop.from} 到 ${drop.to} 环节流失用户占上一步用户的比例`
        }
      ]),
      {
        id: "funnel_max_drop_users",
        label: "最大单步流失人数",
        value: largest.loss,
        formatted: `${utils.formatNumber(largest.loss, { maximumFractionDigits: 0 })} 人`,
        formatter: "number",
        definition: `${largest.from} → ${largest.to} 环节流失的用户数量`
      },
      {
        id: "funnel_max_drop_rate",
        label: "最大单步流失率",
        value: largest.rate,
        formatted: largest.rate === null ? "当前数据周期不足，暂无可用数据" : utils.formatPercent(largest.rate, 1),
        formatter: "percent",
        definition: `${largest.from} → ${largest.to} 环节流失用户占上一步用户的比例`
      }
    ];
  }

  function funnelStepSummary(analysis) {
    if (analysis.type !== "funnel" || !Array.isArray(analysis.chartSpec?.data)) {
      return null;
    }
    const steps = analysis.chartSpec.data;
    return steps.map((step, index) => {
      const previous = steps[index - 1];
      const lost = previous ? Number(previous.value) - Number(step.value) : null;
      return {
        step: String(step.name),
        users: `${utils.formatNumber(Number(step.value), { maximumFractionDigits: 0 })} 人`,
        lostFromPrevious: index === 0
          ? null
          : `${utils.formatNumber(Math.max(0, lost), { maximumFractionDigits: 0 })} 人`
      };
    });
  }

  // 将内部指标引用与英文字段名转换成业务描述；这些内容可以安全发送给报告模型。
  function buildAiContext(context) {
    return {
      dataset: {
        name: businessize(context.primaryTable.name),
        rows: context.primaryTable.rowCount
      },
      fields: context.primaryTable.fields.map((field) => ({
        name: fieldLabels[field.key] || businessize(field.key),
        type: {
          number: "数值",
          date: "日期",
          category: "分类",
          text: "文本"
        }[field.type] || "字段"
      })),
      analyses: context.analyses.map((analysis) => ({
        analysis: analysisLabels[analysis.type] || businessize(analysis.title),
        title: analysis.type === "funnel" && analysis.funnelSteps?.length
          ? `完整转化漏斗：${analysis.funnelSteps.map((step) => step.step).join(" → ")}`
          : businessize(analysis.title),
        scope: businessize(analysis.scope),
        funnelSteps: analysis.funnelSteps,
        metrics: analysis.metrics.map((metric) => ({
          name: businessize(metric.label),
          displayValue: metric.value === null || metric.value === undefined
            ? "当前数据周期不足，暂无可用数据"
            : (metric.formatted !== "—" ? metric.formatted : String(metric.value)),
          hasValue: metric.value !== null && metric.value !== undefined,
          meaning: businessize(metric.definition || "")
        })),
        warnings: (analysis.warnings || []).map(businessize)
      }))
    };
  }

  function getAnalyses() {
    const sessionRuns = App.state.getAnalysisRuns();
    const savedRuns = App.analysis.store.list();
    const byId = new Map();
    savedRuns.forEach((record) => byId.set(record.id, utils.clone(record)));
    sessionRuns.forEach((record) => byId.set(record.id, utils.clone(record)));
    return Array.from(byId.values())
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  function fieldSummary(table) {
    return table.schema.map((field) => ({
      key: field.key,
      type: field.type,
      role: field.role,
      missingRate: Number((field.missingRate || 0).toFixed(4)),
      distinctCount: field.distinctCount,
      unit: field.unit || ""
    }));
  }

  function build(table, analyses) {
    const records = analyses || getAnalyses();
    const metricLookup = {};
    const contextAnalyses = records.map((analysis, analysisIndex) => {
      const metrics = [...(analysis.metrics || []), ...deriveAnalysisMetrics(analysis)].map((item) => {
        const ref = `m${analysisIndex + 1}_${item.id}`;
        const metric = {
          ...item,
          ref,
          analysisId: analysis.id,
          analysisTitle: analysis.title,
          analysisType: analysis.type
        };
        metricLookup[ref] = metric;
        return {
          ref,
          label: item.label,
          value: item.value,
          formatted: item.formatted,
          unit: item.unit || "",
          definition: item.definition || ""
        };
      });
      return {
        id: analysis.id,
        type: analysis.type,
        title: analysis.title,
        tableName: analysis.tableName,
        tableVersion: analysis.tableVersion,
        scope: analysisScope(analysis),
        funnelSteps: funnelStepSummary(analysis),
        config: analysis.configSummary || [],
        metrics,
        warnings: (analysis.warnings || []).slice(0, 6)
      };
    });

    const context = {
      schemaVersion: "report-context-v1",
      generatedAt: new Date().toISOString(),
      primaryTable: {
        name: table.name,
        version: table.version,
        rowCount: table.rows.length,
        fieldCount: table.schema.length,
        qualityScore: table.quality ? table.quality.score : null,
        missingCells: table.quality ? table.quality.missingCells : null,
        fields: fieldSummary(table)
      },
      analyses: contextAnalyses,
      totalMetricCount: Object.keys(metricLookup).length
    };
    return {
      context,
      aiContext: buildAiContext(context),
      metricLookup,
      analyses: records
    };
  }

  function estimateCharacters(context) {
    return JSON.stringify(context).length;
  }

  App.ai = App.ai || {};
  App.ai.contextBuilder = {
    getAnalyses,
    build,
    buildAiContext,
    estimateCharacters
  };
})(window);
