// ============================================================
// AI 助手 System Prompt（完整版）
// ============================================================

const ANALYSIS_KNOWLEDGE = `
【分析常识库】

一、核心指标口径
- 留存率：某日新增用户中，第 N 日仍有行为的用户占比。次日留存=第2天回访/首日新增，需明确"行为"定义（登录/下单/浏览）。
- 转化率：完成目标行为人数/进入流程人数。分子分母口径必须一致，去重计数 vs 计数要区分。
- 漏斗转化：按步骤顺序、在转化窗口期内完成的人数占比。总转化=末步人数/首步人数。
- RFM：R=最近一次消费距今天数，F=消费频次，M=消费金额。分箱可用分位数或业务阈值。
- Cohort：按首次行为时间分组的用户群，用于横向对比不同批次表现。

二、分析选型规则
- 看渠道/人群效果差异 → 分组对比分析
- 看用户粘性与产品健康度 → 留存分析
- 看流程卡点与流失环节 → 漏斗分析
- 看用户价值分层与运营策略 → RFM
- 看指标随时间变化 → 趋势分析
- 看指标间关联 → 相关性分析

三、解读原则（回答时必须遵守）
- 无行业基准时，不得直接判断"高/低/正常"，应说明"需结合历史数据或行业基准对比"。
- 相关性不等于因果，归因结论需标注"推测，待验证"。
- 注意分母口径：转化率的分母是"进入流程人数"还是"全部用户"，结论不同。
- 注意幸存者偏差：只看留存用户会高估效果。
- 样本量过小时（如某分组<30人），提示结论不稳定。

四、能力边界
- 助手不执行数据计算、不跑分析，涉及计算的请求引导用户到对应分析模块。
- 上下文未提供的数字不得编造，明确说"当前数据不支持该结论"。
- 预测类、行业基准类问题，说明超出能力范围。
`;

const FEW_SHOT_EXAMPLES = `
【回答范例】

用户：刚才那个漏斗哪步流失最大？
助手：根据最近的漏斗分析（view→add_cart→purchase，窗口7天），最大流失在 view→add_cart，流失 68%（1000人→320人）。这是主要卡点，可能原因包括商品页吸引力不足或加购入口不明显（推测，待验证）。建议优先优化该环节。以上由 AI 生成，仅供参考。

用户：这个 9.6% 的转化率算高吗？
助手：当前上下文只有本次 9.6% 的转化率，没有行业基准或历史对比数据，无法直接判断高低。建议与历史同配置结果或行业基准对比后再下结论。以上由 AI 生成，仅供参考。

用户：帮我算一下人均消费。
助手：助手不执行数据计算。请到「数据分析 → 分组对比分析」，分组维度选 user_id，指标选 amount，聚合方式选均值即可得到人均消费。以上由 AI 生成，仅供参考。
`;

const OUTPUT_RULES = `
【输出规范】
1. 回答简洁专业，面向数据分析/运营场景，避免空话。
2. 涉及数字必须引用上下文中的具体值，并在括号内注明来源（如表名、分析类型）。
3. 结论性判断必须说明依据；推测内容标注"推测，待验证"。
4. 每次回答结尾统一附："以上由 AI 生成，仅供参考。"
5. 用户问题超出能力边界时，直接说明原因并给出替代操作路径。
`;

// 组装完整 system prompt
const SYSTEM_PROMPT = `
你是「AI 数据分析工作台」内置的 AI 助手，服务对象是数据分析师和运营人员。
你是专为电商日志分析设计的 AI 助手。你的知识库围绕 ODS（原始层）、DWD（清洗后明细层）、ADS（应用汇总层）构建。当用户提问时，你必须结合当前表所在层级来回答。
你只能基于系统提供的【表结构上下文】【分析结果上下文】【对话历史】回答问题，不得使用上下文之外的信息编造内容。

${ANALYSIS_KNOWLEDGE}

${FEW_SHOT_EXAMPLES}

${OUTPUT_RULES}
`;

// ============================================================
// 调用示例：组装 messages 发给 DeepSeek
// ============================================================

function buildMessages(userQuestion, context, history = []) {
  const contextBlock = `
【当前表结构】
${context.tableName ? `表名：${context.tableName}，行数：${context.rowCount}
字段：${context.fields.map(f => `${f.name}(${f.type}${f.missingRate ? `，缺失${f.missingRate}%` : ''})`).join('、')}` : '当前未选择数据表'}

【当前数据层级】
${context.dataLayer || '未知'}

【最近分析结果】
${context.analyses.length ? context.analyses.map(a => a.summary).join('\n') : '暂无分析记录'}

【当前模块】
${context.currentModule || '未知'}
`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: contextBlock },
    ...history,
    { role: 'user', content: userQuestion }
  ];
}

// ============================================================
// 结构化分析摘要模板（供各分析模块调用，写入 context.analyses）
// ============================================================

function buildAnalysisSummary(type, config, result, prevResult) {
  const typeLabels = {
    retention: "留存分析",
    funnel: "漏斗分析",
    rfm: "RFM",
    descriptive: "描述统计",
    group: "分组对比",
    trend: "趋势分析",
    correlation: "相关性分析"
  };
  const label = typeLabels[type] || type;
  const safeConfig = config || {};
  const record = result || {};
  const rows = record.resultTable && Array.isArray(record.resultTable.rows)
    ? record.resultTable.rows
    : [];
  const metric = (id) => (record.metrics || []).find((item) => item.id === id);
  const value = (id) => {
    const item = metric(id);
    return item ? item.formatted : "—";
  };
  const configText = (record.configSummary || [])
    .slice(0, 8)
    .map((item) => `${item.label}=${item.value}`)
    .join("，");
  const compareText = () => {
    if (!prevResult) {
      return "";
    }
    const currentMetric = (record.metrics || [])[0];
    const previousMetric = (prevResult.metrics || [])[0];
    if (!currentMetric || !previousMetric) {
      return "";
    }
    return `对比：上次同类型分析“${previousMetric.label}”为 ${previousMetric.formatted}，本次为 ${currentMetric.formatted}。`;
  };

  if (type === "funnel") {
    const steps = Array.isArray(safeConfig.steps) ? safeConfig.steps : [];
    const stepText = rows.map((row) => {
      const rate = row.stepConversion === null || row.stepConversion === undefined
        ? "—"
        : `${(Number(row.stepConversion) * 100).toFixed(1)}%`;
      return `${row.event || row.step || "步骤"} ${row.users ?? "—"}人(${rate})`;
    }).join(" → ");
    const maxDrop = rows.slice(1).sort((left, right) => (right.dropoff || 0) - (left.dropoff || 0))[0];
    const previousTotal = prevResult ? metricValueFromRecord(prevResult, "funnel_overall_conversion") : null;
    const currentTotal = metricValueFromRecord(record, "funnel_overall_conversion");
    const comparison = prevResult && previousTotal !== null && currentTotal !== null
      ? `对比：上次同配置总转化 ${(previousTotal * 100).toFixed(1)}%，本次 ${(currentTotal * 100).toFixed(1)}%，${currentTotal > previousTotal ? "提升" : currentTotal < previousTotal ? "下降" : "持平"} ${(Math.abs(currentTotal - previousTotal) * 100).toFixed(1)}pp。`
      : "";
    return `
【${label}】配置：${steps.join("→") || configText}，转化窗口 ${safeConfig.windowDays || safeConfig.window || "—"} 天
结果：${stepText || "暂无步骤结果"}
关键发现：${maxDrop ? `最大流失在 ${maxDrop.event || maxDrop.step}，流失 ${maxDrop.dropoff} 人；总体转化 ${value("funnel_overall_conversion")}` : `总体转化 ${value("funnel_overall_conversion")}`}
${comparison}
`.trim();
  }

  if (type === "retention") {
    const finding = [
      `次日留存 ${value("retention_d1")}`,
      `7日留存 ${value("retention_d7")}`,
      `30日留存 ${value("retention_d30")}`
    ].join("，");
    return `
【${label}】配置：${configText}
结果：共形成 ${rows.length} 个 Cohort；分析用户 ${value("retention_users")}
关键发现：${finding}；当前主观察点 ${value("retention_primary")}
${compareText()}
`.trim();
  }

  if (type === "rfm") {
    return `
【${label}】配置：${configText}
结果：成交用户 ${value("rfm_users")}，累计成交金额 ${value("rfm_revenue")}，人均成交 ${value("rfm_avg_frequency")}
关键发现：重要客群占比 ${value("rfm_high_value_share")}；各客群明细见本次 RFM 结果
${compareText()}
`.trim();
  }

  if (type === "descriptive") {
    return `
【${label}】配置：${configText}
结果：有效样本 ${value("descriptive_count")}，均值 ${value("descriptive_mean")}，中位数 ${value("descriptive_median")}
关键发现：样本标准差 ${value("descriptive_std")}，P75 为 ${value("descriptive_q75")}；均值与中位数差异可用于判断偏态
${compareText()}
`.trim();
  }

  if (type === "group") {
    const leading = rows[0];
    return `
【${label}】配置：${configText}
结果：共 ${value("group_count")} 个分组，有效记录 ${value("group_records")}
关键发现：头部组为 ${leading ? leading.name : "—"}，指标值 ${value("group_leading_value")}
${compareText()}
`.trim();
  }

  if (type === "trend") {
    return `
【${label}】配置：${configText}
结果：最新周期 ${value("trend_latest")}，周期均值 ${value("trend_average")}
关键发现：最新环比 ${value("trend_mom")}，同比 ${value("trend_yoy")}；需结合时间窗口和活动解释波动
${compareText()}
`.trim();
  }

  if (type === "correlation") {
    return `
【${label}】配置：${configText}
结果：参与字段 ${value("correlation_fields")} 个，最强相关系数 ${value("correlation_strongest")}
关键发现：最强关系共同样本 ${value("correlation_sample")}；相关不等于因果，需人工复核
${compareText()}
`.trim();
  }

  return `
【${label}】配置：${configText || "见分析记录"}
结果：${(record.metrics || []).map((item) => `${item.label}=${item.formatted}`).join("，") || "暂无指标"}
关键发现：请结合配置和指标口径解读
${compareText()}
`.trim();
}

function metricValueFromRecord(record, id) {
  const metric = (record.metrics || []).find((item) => item.id === id);
  return metric && Number.isFinite(metric.value) ? metric.value : null;
}

function trimAnalysisSummaries(items) {
  const entries = (items || []).filter((item) => item && !item.isAggregate);
  const recent = entries.slice(-5);
  if (entries.length <= 5) {
    return recent;
  }
  const types = Array.from(new Set(entries.map((item) => item.type).filter(Boolean)));
  return [
    ...recent,
    {
      type: "汇总",
      isAggregate: true,
      summary: `【汇总】此前共完成 ${entries.length} 次分析，覆盖 ${types.length} 类分析；以上仅保留最近五次明细，完整记录可在“分析历史”查看。`
    }
  ];
}

// 暴露给现有浏览器模块使用，同时保留上方常量与 Prompt 原文。
window.AI_ASSISTANT_CORE = Object.freeze({
  ANALYSIS_KNOWLEDGE,
  FEW_SHOT_EXAMPLES,
  OUTPUT_RULES,
  SYSTEM_PROMPT,
  buildMessages,
  buildAnalysisSummary,
  trimAnalysisSummaries
});

window.AI_ASSISTANT_CONTEXT = window.AI_ASSISTANT_CONTEXT || {
  tableName: null,
  rowCount: 0,
  fields: [],
  analyses: [],
  currentModule: "未知"
};

// 报告与图表模块统一读取的原始分析记录上下文。
window.analysisContext = window.analysisContext || {
  analyses: []
};
