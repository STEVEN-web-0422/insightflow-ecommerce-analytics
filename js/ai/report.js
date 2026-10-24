(function bootstrapReportAssembly(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;

  const sectionDefs = [
    { key: "coreConclusions", number: "①", title: "核心业务表现", kind: "lead" },
    { key: "metricInterpretation", number: "②", title: "关键环节深度拆解", kind: "deep-dive" },
    { key: "risks", number: "③", title: "核心风险预警", kind: "risk" },
    { key: "recommendations", number: "④", title: "运营行动建议", kind: "actions" }
  ];

  function typeLabel(type) {
    return {
      retention: "留存分析",
      funnel: "漏斗分析",
      rfm: "RFM 分层",
      descriptive: "描述统计",
      group: "分组对比",
      trend: "趋势分析",
      correlation: "相关性分析"
    }[type] || type;
  }

  function displayedAnalysisTitle(analysis) {
    if (analysis.type === "funnel" && Array.isArray(analysis.config?.steps) && analysis.config.steps.length) {
      return `转化漏斗：${analysis.config.steps.join(" → ")}`;
    }
    return analysis.title;
  }

  function metricEntries(lookup) {
    return Object.values(lookup);
  }

  function hasMetricValue(metric) {
    return Boolean(
      metric
      && metric.value !== null
      && metric.value !== undefined
      && Number.isFinite(Number(metric.value))
    );
  }

  function metricDisplay(metric) {
    if (!hasMetricValue(metric)) {
      return "当前数据周期不足，暂无可用数据";
    }
    const formatted = String(metric.formatted || "").trim();
    return formatted && formatted !== "—" ? formatted : String(metric.value);
  }

  function placeholder(metric) {
    return metric ? `{{m:${metric.ref}}}` : "";
  }

  function extractRefs(text) {
    const refs = [];
    String(text || "").replace(/\{\{m:([^}]+)\}\}/g, (_, ref) => {
      refs.push(ref);
      return "";
    });
    return utils.uniqueBy(refs);
  }

  function defaultMetricRef(lookup, analysisType) {
    const metrics = metricEntries(lookup);
    const metric = (analysisType && metrics.find((item) => item.analysisType === analysisType))
      || metrics[0];
    return metric ? metric.ref : null;
  }

  function normalizeLatexText(text) {
    return String(text || "")
      .replace(/\\twoheadrightarrow\b/g, "→")
      .replace(/\bwoheadrightarrow\b/g, "→")
      .replace(/\\longrightarrow\b/g, "→")
      .replace(/\\rightarrow\b/g, "→")
      .replace(/\\to\b/g, "→")
      .replace(/\\uparrow\b/g, "↑")
      .replace(/\\times\b/g, "×")
      .replace(/\\leq\b/g, "≤")
      .replace(/\\geq\b/g, "≥")
      .replace(/\\approx\b/g, "≈")
      .replace(/\\pm\b/g, "±")
      .replace(/\\%/g, "%")
      .replace(/\\text\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\begin\{[^{}]+\}|\\end\{[^{}]+\}/g, "")
      .replace(/\\[()[\]]/g, "")
      .replace(/\\[,;!]/g, "")
      .replace(/\\[a-zA-Z]+/g, "")
      .replace(/\$+/g, "")
      .replace(/\(\s*→\s*\)/g, "→")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function normalizeDisplay(value) {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/[¥￥]/g, "")
      .trim();
  }

  function metricByDisplay(lookup, value) {
    const target = normalizeDisplay(value);
    if (!target) {
      return null;
    }
    const scored = metricEntries(lookup).map((metric) => {
      const display = normalizeDisplay(metricDisplay(metric));
      const label = normalizeDisplay(metric.label).replace(/[率数]$/, "");
      const targetNumbers = target.match(/\d+(?:\.\d+)?/g) || [];
      const displayNumbers = display.match(/\d+(?:\.\d+)?/g) || [];
      const targetNumber = Number(targetNumbers[targetNumbers.length - 1]);
      const displayNumber = Number(displayNumbers[displayNumbers.length - 1]);
      let score = 0;
      if (target === display) {
        score = 100;
      } else if (display && target.includes(display)) {
        score = 80;
      }
      if (label && target.includes(label)) {
        score += 20;
      }
      if (Number.isFinite(targetNumber) && Number.isFinite(displayNumber)) {
        const tolerance = display.includes("%") || target.includes("%") ? 0.8 : 0.51;
        if (Math.abs(targetNumber - displayNumber) <= tolerance) {
          score += 50;
        }
      }
      return { metric, score };
    }).sort((left, right) => right.score - left.score);
    return scored[0] && scored[0].score >= 50 ? scored[0].metric : null;
  }

  function smoothDirtyLanguage(text, warnings) {
    const dirty = "(?:〔\\s*未登记数值\\s*〕|未知(?:变量|指标|数值)?|未登记数值|待核实)";
    let output = String(text || "");
    output = output.replace(new RegExp(`${dirty}\\s*(?:小时|h)`, "gi"), "24 小时");
    output = output.replace(new RegExp(`${dirty}\\s*(?:%|％)`, "gi"), "一定比例");
    output = output.replace(new RegExp(`${dirty}\\s*(?:人|位用户)`, "gi"), "部分用户");
    output = output.replace(new RegExp(`${dirty}\\s*(?:天|日)`, "gi"), "中长期");
    output = output.replace(/(?:某某|若干|未定)\s*小时/g, "24 小时");
    output = output.replace(/在\s*小时/g, "在 24 小时");
    output = output.replace(/一段时间/g, "中长期");
    const before = output;
    output = output.replace(new RegExp(dirty, "gi"), "");
    output = output.replace(/[〔\[【]\s*[〕\]】]/g, "");
    if (output !== before) {
      warnings.push("AI 返回了不可展示的占位文案，已转换为业务语言。");
    }
    return output;
  }

  function smoothUnknownNumeric(value, lookup, warnings) {
    const text = String(value || "").trim();
    const hour = text.match(/(\d+(?:\.\d+)?)\s*(?:小时|h)/i);
    if (hour) {
      return Number(hour[1]) >= 48 ? "48 小时" : "24 小时";
    }
    const metric = metricByDisplay(lookup, text);
    if (metric) {
      return `**${metricDisplay(metric)}**`;
    }
    warnings.push("AI 正文包含无法核验的数字，已用业务语言平滑处理。");
    if (/(?:小时|h)/i.test(text)) {
      return "24 小时";
    }
    if (/%|％/.test(text)) {
      return "一定比例";
    }
    if (/(?:人|位用户)/.test(text)) {
      return "部分用户";
    }
    if (/(?:天|日)/.test(text)) {
      return "中长期";
    }
    if (/元|¥|￥/.test(text)) {
      return "一定金额";
    }
    return "";
  }

  function scrubInternalArtifacts(text, lookup, warnings) {
    let output = String(text || "").trim();
    output = output.replace(/\{\{m:([^}]+)\}\}/g, (match, ref) => {
      if (lookup[ref]) {
        return `**${metricDisplay(lookup[ref])}**`;
      }
      warnings.push("AI 返回了无效的指标引用，已省略。");
      return "";
    });

    // 在兜底清理阶段，同时处理 {{m:...}}、{m ...} 以及半截内部指标编号。
    const internalNames = metricEntries(lookup)
      .flatMap((metric) => [metric.ref, metric.id])
      .filter(Boolean)
      .sort((left, right) => right.length - left.length);
    internalNames.forEach((name) => {
      if (output.includes(name)) {
        output = output.split(name).join("相关指标");
        warnings.push("AI 正文包含内部指标编号，已转换为业务描述。");
      }
    });
    output = output.replace(/_相关指标/g, "相关指标");
    const beforeTemplateCleanup = output;
    output = output.replace(/\{\{?\s*m\b[^}\n]*\}?/gi, "相关指标");
    output = output.replace(/\{[^{}\n]{0,100}(?:_[a-z][a-z0-9_]*)[^{}\n]*\}?/gi, "相关指标");
    output = output.replace(/\b(?:m\d+_[a-z0-9_]+|_[a-z][a-z0-9_]*)\b/gi, "相关指标");
    if (output !== beforeTemplateCleanup) {
      warnings.push("AI 正文包含模板残留，已清理为业务语言。");
    }
    return output;
  }

  function sanitizeText(text, lookup, warnings) {
    let output = scrubInternalArtifacts(normalizeLatexText(text), lookup, warnings)
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\s*[-*]\s+/gm, "")
      .replace(/\b(?:undefined|null|NaN)\b|\[object Object\]/gi, "");
    output = smoothDirtyLanguage(output, warnings);

    // 只保留能映射到真实指标或合理运营时间的加粗内容，无法核验时用业务语言平滑处理。
    output = output.replace(/\*\*([^*\n]+)\*\*/g, (match, rawValue) => {
      if (!/\d/.test(rawValue)) {
        return rawValue;
      }
      return smoothUnknownNumeric(rawValue, lookup, warnings);
    });

    // 未加粗数字若是真实指标则补成 Chip；无法核验时只做业务化降级，绝不输出调试占位符。
    output = output.split(/(\*\*[^*\n]+\*\*)/g).map((part) => {
      if (/^\*\*[^*\n]+\*\*$/.test(part)) {
        return part;
      }
      return part.replace(
        /(?<![A-Za-z0-9])\d+(?:[.,]\d+)*(?:\s?(?:%|％|天|日|人|位用户|次|元|小时|h|pp))?(?![A-Za-z0-9])/g,
        (numericText) => smoothUnknownNumeric(numericText, lookup, warnings)
      );
    }).join("");
    return output
      .replace(/\s{2,}/g, " ")
      .replace(/([，,；;])\s*([。；;])/g, "$2")
      .replace(/：\s*[。；;]/g, "。")
      .trim() || "当前数据周期不足，暂无可用信息。";
  }

  function sanitizeHeading(text, lookup, warnings) {
    return smoothDirtyLanguage(scrubInternalArtifacts(normalizeLatexText(text), lookup, warnings), warnings)
      .replace(/^#{1,6}\s*/gm, "")
      .replace(/^\d+[.、)]\s*/, "")
      .replace(/\*\*/g, "")
      .trim();
  }

  function ensureActionTarget(text) {
    let output = String(text || "")
      .replace(/提升至?\s*一定比例(?:以上)?/g, "提升至 10% 以上")
      .replace(/达到\s*一定比例/g, "达到 10%")
      .replace(/一定比例/g, "10%");
    const hasQuantifiedTarget = /(?:提升|提高|增长|达到|降低|减少|下降)(?:至|到|幅度)?\s*(?:约\s*)?(?:\d+(?:\.\d+)?%|\d+)/.test(output);
    if (!hasQuantifiedTarget) {
      const conclusion = /降低|减少|下降/.test(output)
        ? "目标：较当前基线降低 10% 以上。"
        : "目标：较当前基线提升 10% 以上。";
      output = `${output.replace(/[。；;]\s*$/, "")}。${conclusion}`;
    }
    return output;
  }

  function resolveTextHtml(text, lookup) {
    const source = normalizeLatexText(text);
    const output = [];
    let cursor = 0;
    const pattern = /\*\*([^*\n]+)\*\*|\{\{m:([^}]+)\}\}/g;
    let match;
    while ((match = pattern.exec(source))) {
      output.push(utils.escapeHtml(source.slice(cursor, match.index)).replace(/\n/g, "<br>"));
      const boldValue = match[1];
      const ref = match[2];
      const metric = boldValue
        ? metricByDisplay(lookup, boldValue)
        : lookup[ref];
      if (metric) {
        const definition = metric.definition || metric.label;
        output.push(
          `<span class="report-evidence" title="${utils.escapeHtml(definition)}">${utils.escapeHtml(metricDisplay(metric))}</span>`
        );
      } else {
        output.push(utils.escapeHtml(boldValue || ""));
      }
      cursor = pattern.lastIndex;
    }
    output.push(utils.escapeHtml(source.slice(cursor)).replace(/\n/g, "<br>"));
    return output.join("");
  }

  function normalizeItems(items, lookup, fallbackRef, options) {
    const config = options || {};
    const warnings = config.warnings || [];
    const output = (Array.isArray(items) ? items : []).slice(0, config.limit || 6).map((item) => {
      const source = typeof item === "string" ? { text: item } : (item || {});
      const cleaned = sanitizeText(source.text || "", lookup, warnings);
      const text = config.ensureActionTarget ? ensureActionTarget(cleaned) : cleaned;
      const refs = extractRefs(text).filter((ref) => lookup[ref]);
      return {
        text,
        html: resolveTextHtml(text, lookup),
        metricRefs: refs,
        priority: ["P0", "P1", "P2"].includes(source.priority) ? source.priority : null,
        heading: source.heading
          ? sanitizeHeading(source.heading, lookup, warnings)
          : ""
      };
    });
    if (!output.length) {
      return normalizeItems(
        [{ text: "当前数据周期不足，暂无可用信息。" }],
        lookup,
        fallbackRef,
        config
      );
    }
    return output;
  }

  function localDraft(contextBundle, requestedTitle) {
    const lookup = contextBundle.metricLookup;
    const metrics = metricEntries(lookup);
    const byType = (type) => metrics.filter((metric) => metric.analysisType === type);
    const pick = (type, id) => byType(type).find((metric) => metric.id === id);
    const value = (metric) => `**${metricDisplay(metric)}**`;
    const funnelOverall = pick("funnel", "funnel_overall_conversion");
    const funnelEntrants = pick("funnel", "funnel_entrants");
    const funnelDays = pick("funnel", "funnel_avg_days");
    const d1 = pick("retention", "retention_d1");
    const d7 = pick("retention", "retention_d7");
    const d30 = pick("retention", "retention_d30");
    const highValue = pick("rfm", "rfm_high_value_share");
    const trendLatest = pick("trend", "trend_latest");
    const coreConclusions = [
      {
        text: `本期进入漏斗的首步用户为 ${value(funnelEntrants)}，最终转化率为 ${value(funnelOverall)}，次日留存为 ${value(d1)}，高价值用户占比为 ${value(highValue)}。当前经营重点应从单纯扩大流量，转向改善首单后的体验与高价值用户复购。`
      }
    ];
    const analysisNarratives = contextBundle.analyses.map((analysis) => {
      const firstMetric = metrics.find((metric) => metric.analysisId === analysis.id);
      return {
        text: `${typeLabel(analysis.type)}显示的关键表现为 ${value(firstMetric)}。建议结合本次业务问题继续下钻，推测，待验证。`
      };
    });
    return {
      title: requestedTitle || "电商经营数据分析报告",
      coreConclusions,
      metricInterpretation: [
        {
          heading: "转化漏斗表现",
          text: `首步到成交的总体转化率为 ${value(funnelOverall)}，平均转化耗时为 ${value(funnelDays)}。优先检查加购到成交环节的价格、优惠与结算体验，推测，待验证。`
        },
        {
          heading: "用户留存现状",
          text: `次日留存为 ${value(d1)}，7 日留存为 ${value(d7)}，30 日表现为 ${value(d30)}。若长期表现明显走弱，需要检查首单后的履约体验和复购召回。`
        },
        {
          heading: "用户价值分层",
          text: `高价值用户占比为 ${value(highValue)}，应优先识别其渠道与品类偏好，并通过专属权益提升复购频次。最新经营趋势参考值为 ${value(trendLatest)}。`
        }
      ],
      risks: [
        { text: `首单转化率为 ${value(funnelOverall)}，若新客在首单后快速流失，买量回报可能承压。原因推测，待验证。` },
        { text: `次日留存为 ${value(d1)}，若召回机制缺失，高价值用户占比 ${value(highValue)} 难以持续提升。原因推测，待验证。` }
      ],
      recommendations: [
        {
          priority: "P0",
          text: `优先优化首单后的页面引导与结算体验，以总体转化率 ${value(funnelOverall)} 作为核心观察指标。`
        },
        {
          priority: "P1",
          text: `围绕高价值用户开展专属复购权益，以高价值用户占比 ${value(highValue)} 和次日留存 ${value(d1)} 作为观察指标。`
        }
      ],
      analysisNarratives
    };
  }

  // KPI 卡片只取前端已计算的分析指标，避免 AI 生成或改写核心数字。
  function buildKpis(contextBundle) {
    const metrics = metricEntries(contextBundle.metricLookup);
    const pick = (analysisType, id) => metrics.find((metric) => (
      metric.analysisType === analysisType && metric.id === id
    ));
    const highValueShare = pick("rfm", "rfm_high_value_share");
    const rfmUsers = pick("rfm", "rfm_users");
    const highValueCount = hasMetricValue(highValueShare) && hasMetricValue(rfmUsers)
      ? Math.round(Number(rfmUsers.value) * Number(highValueShare.value))
      : null;
    const createKpi = (label, metric, support, derivedValue) => ({
      label,
      value: derivedValue !== undefined
        ? (derivedValue === null ? "—" : derivedValue)
        : (hasMetricValue(metric) ? metricDisplay(metric) : "—"),
      support: metric || derivedValue !== undefined
        ? support
        : "本次报告未纳入对应分析",
      available: derivedValue !== undefined
        ? derivedValue !== null
        : hasMetricValue(metric)
    });
    return [
      createKpi(
        "总转化率",
        pick("funnel", "funnel_overall_conversion"),
        "从首步进入流程到最终成交"
      ),
      createKpi(
        "次日留存率",
        pick("retention", "retention_d1"),
        "首单后次日仍有行为的用户"
      ),
      createKpi(
        "高价值用户数",
        highValueShare || rfmUsers,
        highValueShare
          ? `占成交用户 ${metricDisplay(highValueShare)}`
          : "当前数据周期不足，暂无可用数据",
        highValueCount === null ? null : utils.formatNumber(highValueCount, { maximumFractionDigits: 0 })
      )
    ].map((kpi) => ({
      ...kpi,
      support: kpi.available ? kpi.support : (kpi.support.includes("未纳入") ? kpi.support : "当前数据周期不足，暂无可用数据")
    }));
  }

  function normalizePayload(payload, contextBundle, requestedTitle, mode, usage) {
    const lookup = contextBundle.metricLookup;
    if (!Object.keys(lookup).length) {
      throw new Error("没有可引用的分析指标，请先运行至少一个分析。");
    }
    const validationWarnings = [];
    const sections = {};
    sectionDefs.forEach((definition) => {
      sections[definition.key] = normalizeItems(
        payload[definition.key],
        lookup,
        defaultMetricRef(lookup),
        {
          warnings: validationWarnings,
          limit: definition.key === "coreConclusions"
            ? 1
            : (definition.key === "risks" ? 3 : 4),
          ensureActionTarget: definition.key === "recommendations"
        }
      );
    });

    const narrativeItems = Array.isArray(payload.analysisNarratives) ? payload.analysisNarratives : [];
    const analysisNarratives = contextBundle.analyses.map((analysis, index) => {
      const supplied = narrativeItems[index]
        || narrativeItems.find((item) => String(item.analysisId || "") === analysis.id);
      const normalized = normalizeItems(
        [{ text: supplied?.text || `${typeLabel(analysis.type)}需要结合业务动作继续观察。` }],
        lookup,
        defaultMetricRef(lookup, analysis.type),
        { warnings: validationWarnings, limit: 1 }
      )[0];
      return {
        analysisId: analysis.id,
        analysisType: analysis.type,
        analysisTitle: analysis.title,
        ...normalized
      };
    });

    return {
      id: utils.uid("report"),
      title: sanitizeText(
        payload.title || requestedTitle || "电商经营数据分析报告",
        lookup,
        validationWarnings
      ),
      mode,
      modeLabel: mode === "deepseek" ? "DeepSeek 生成" : "本地演示底稿",
      createdAt: new Date().toISOString(),
      contextCharacters: App.ai.contextBuilder.estimateCharacters(contextBundle.aiContext),
      usage: usage || null,
      table: contextBundle.context.primaryTable,
      analyses: contextBundle.analyses.map((analysis) => ({
        id: analysis.id,
        type: analysis.type,
        title: analysis.title,
        tableName: analysis.tableName,
        tableVersion: analysis.tableVersion,
        config: analysis.config,
        configSummary: analysis.configSummary,
        warnings: analysis.warnings
      })),
      sections,
      kpis: buildKpis(contextBundle),
      analysisNarratives,
      figures: [],
      validationWarnings: utils.uniqueBy(validationWarnings)
    };
  }

  async function captureFigures(contextBundle) {
    const figures = [];
    const warnings = [];
    const host = document.createElement("div");
    // 保留真实布局尺寸并仅移出视口；opacity:0 在部分浏览器中会跳过离屏 Canvas 绘制。
    host.style.cssText = "position:fixed;left:-12000px;top:0;width:900px;height:360px;pointer-events:none;background:#fff;";
    document.body.appendChild(host);
    try {
      for (const analysis of contextBundle.analyses) {
        if (!analysis.chartSpec) {
          continue;
        }
        if (!App.charts.hasChartData(analysis.chartSpec)) {
          warnings.push(`图表“${analysis.title}”暂无可绘制数据，已跳过。`);
          continue;
        }
        const chartHost = document.createElement("div");
        chartHost.style.cssText = "width:900px;height:340px;background:#fff;";
        host.appendChild(chartHost);
        const key = `report:${analysis.id}`;
        try {
          // 报告截图关闭入场动画，并等待实际画布出现有效像素后再导出。
          App.charts.render(chartHost, analysis.chartSpec, { key, animation: false });
          const dataUrl = await App.charts.captureAsync(key, { attempts: 4 });
          if (dataUrl) {
            figures.push({
              id: utils.uid("figure"),
              analysisId: analysis.id,
              title: analysis.chartSpec.title || analysis.title,
              caption: `${displayedAnalysisTitle(analysis)} · ${analysis.tableName} v${analysis.tableVersion}`,
              dataUrl
            });
          } else {
            warnings.push(`图表“${analysis.title}”未形成有效画面，已跳过。`);
          }
        } catch (error) {
          warnings.push(`图表“${analysis.title}”截图失败：${error.message}`);
        } finally {
          App.charts.dispose(key);
          chartHost.remove();
        }
      }
    } finally {
      host.remove();
    }
    return { figures, warnings };
  }

  async function generate(options) {
    const config = options || {};
    if (!config.table) {
      throw new Error("DWD 宽表不存在，无法生成报告。");
    }
    if (!config.analyses || !config.analyses.length) {
      throw new Error("请至少运行一个分析后再生成报告。");
    }
    const contextBundle = App.ai.contextBuilder.build(config.table, config.analyses);
    let payload;
    let usage = null;
    const mode = config.mode || "deepseek";
    if (mode === "deepseek") {
      App.ai.prompts.validatePromptContext(contextBundle.aiContext);
      const responsePayload = await global.callDeepSeek([
        { role: "system", content: App.ai.prompts.reportSystemPrompt() },
        { role: "user", content: App.ai.prompts.reportUserPrompt(contextBundle.aiContext, config.title) }
      ], {
        stream: false,
        temperature: 0.35,
        maxTokens: 3200,
        timeoutMs: 90000,
        responseFormat: { type: "json_object" }
      });
      payload = App.ai.client.parseJsonContent(responsePayload?.choices?.[0]?.message?.content);
      usage = responsePayload.usage || null;
    } else {
      payload = localDraft(contextBundle, config.title);
    }

    const report = normalizePayload(payload, contextBundle, config.title, mode, usage);
    const captured = await captureFigures(contextBundle);
    report.figures = captured.figures;
    report.validationWarnings.push(...captured.warnings);
    report.validationWarnings = utils.uniqueBy(report.validationWarnings);
    report.documentHtml = buildReportBody(report);
    return report;
  }

  function analysisMetaTags(analysis) {
    const config = analysis.config || {};
    if (analysis.type === "funnel") {
      return [
        Array.isArray(config.steps) && config.steps.length
          ? `路径 ${config.steps.join(" → ")}`
          : "",
        config.windowDays ? `窗口 ${config.windowDays} 天` : ""
      ].filter(Boolean);
    }
    if (analysis.type === "retention") {
      return [
        config.eventValue === "purchase" ? "支付用户回访" : "活跃用户回访",
        config.retentionMode === "weekly" ? "按周观察" : "按日观察"
      ];
    }
    if (analysis.type === "group" && config.dimensionField) {
      return [`按${{
        channel: "渠道",
        category: "品类",
        date: "日期",
        hour: "小时"
      }[config.dimensionField] || "业务维度"}对比`];
    }
    if (analysis.type === "trend") {
      return [{
        day: "按日趋势",
        week: "按周趋势",
        month: "按月趋势"
      }[config.granularity] || "趋势观察"];
    }
    return [];
  }

  function kpiCardsHtml(report) {
    return `
      <section class="report-kpi-grid" aria-label="核心经营指标">
        ${(report.kpis || []).map((kpi) => `
          <article class="report-kpi-card${kpi.available ? "" : " is-empty"}">
            <span class="report-kpi-label">${utils.escapeHtml(kpi.label)}</span>
            <strong class="report-kpi-value">${utils.escapeHtml(kpi.value)}</strong>
            <small>${utils.escapeHtml(kpi.support)}</small>
          </article>
        `).join("")}
      </section>
    `;
  }

  function sectionItemsHtml(sectionKey, items) {
    if (sectionKey === "recommendations") {
      return items.map((item) => `
        <li class="report-recommendation">
          ${item.priority ? `<span class="report-priority ${item.priority.toLowerCase()}">${item.priority}</span>` : ""}
          <span>${item.html}</span>
        </li>
      `).join("");
    }
    return items.map((item) => `<li>${item.html}</li>`).join("");
  }

  function sectionContentHtml(report, definition) {
    const items = report.sections[definition.key] || [];
    if (definition.kind === "lead") {
      return `<div class="report-business-lead">${items.map((item) => `<p>${item.html}</p>`).join("")}</div>`;
    }
    if (definition.kind === "deep-dive") {
      return `
        <div class="report-deepdive-list">
          ${items.map((item) => `
            <article class="report-deepdive-item">
              ${item.heading ? `<h3>${utils.escapeHtml(item.heading)}</h3>` : ""}
              <p>${item.html}</p>
            </article>
          `).join("")}
        </div>
        <div class="report-analysis-stack">
          ${report.analyses.map((analysis, index) => analysisBlockHtml(report, analysis, index)).join("")}
        </div>
      `;
    }
    if (definition.kind === "risk") {
      return `<ul class="report-list report-risk-list">${sectionItemsHtml(definition.key, items)}</ul>`;
    }
    return `<ol class="report-list report-action-list">${sectionItemsHtml(definition.key, items)}</ol>`;
  }

  function analysisBlockHtml(report, analysis, index) {
    const narrative = report.analysisNarratives.find((item) => item.analysisId === analysis.id);
    const figure = report.figures.find((item) => item.analysisId === analysis.id);
    const metaTags = analysisMetaTags(analysis);
    return `
      <section class="report-analysis-block" data-analysis-id="${utils.escapeHtml(analysis.id)}">
        <div class="report-analysis-head">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <div>
            <small>${utils.escapeHtml(typeLabel(analysis.type))}</small>
            <h3>${utils.escapeHtml(displayedAnalysisTitle(analysis))}</h3>
          </div>
        </div>
        <p class="report-analysis-narrative">${narrative ? narrative.html : "该分析暂无自动解读。"}</p>
        ${figure ? `
          <figure class="report-figure report-analysis-figure">
            <div class="report-chart-frame">
              <img src="${figure.dataUrl}" alt="${utils.escapeHtml(figure.title)}">
            </div>
            <figcaption>${utils.escapeHtml(figure.caption)}</figcaption>
          </figure>
        ` : ""}
        ${metaTags.length ? `
          <div class="report-analysis-meta" aria-label="分析范围">
            ${metaTags.map((tag) => `<span>${utils.escapeHtml(tag)}</span>`).join("")}
          </div>
        ` : ""}
      </section>
    `;
  }

  function buildReportBody(report) {
    const created = utils.formatDateTime(report.createdAt);
    return `
      <article class="ai-report-document" id="report-document">
        <header class="report-document-header">
          <div class="report-ai-badge report-draft-badge">✨ 本报告由 AI 基于真实分析数据生成，仅供业务参考</div>
          <h1>${utils.escapeHtml(report.title)}</h1>
          <p>${utils.escapeHtml(report.table.name)} · ${report.table.rowCount.toLocaleString("zh-CN")} 行 · ${created} · ${utils.escapeHtml(report.modeLabel)}</p>
        </header>
        ${kpiCardsHtml(report)}
        ${sectionDefs.map((definition) => `
          <section class="report-section" data-report-section="${definition.key}">
            <h2><span>${definition.number}</span>${definition.title}</h2>
            ${sectionContentHtml(report, definition)}
          </section>
        `).join("")}
        <footer class="report-document-footer">
          <h2>分析来源</h2>
          <ol>${report.analyses.map((analysis) => `<li>${utils.escapeHtml(displayedAnalysisTitle(analysis))} · ${utils.escapeHtml(analysis.tableName)}</li>`).join("")}</ol>
          <p>以上由 AI 生成，业务判断、数字来源和运营动作需结合真实经营环境人工复核。</p>
        </footer>
      </article>
    `;
  }

  const exportStyles = `
    body{margin:0;background:#f5f7fa;color:#111;font-family:"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.75}
    .ai-report-document{box-sizing:border-box;width:min(1080px,calc(100% - 32px));margin:28px auto;padding:40px;background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
    .report-document-header{padding-bottom:24px;border-bottom:1px solid #ebeef5;margin-bottom:24px}
    .report-ai-badge{display:inline-flex;align-items:center;padding:6px 12px;border-radius:20px;color:#1565c0;background:#e3f2fd;font-size:12px;margin-bottom:24px}
    .report-document-header h1{margin:0 0 8px;font-size:30px;line-height:1.3;color:#111}
    .report-document-header p{margin:0;color:#6b7280;font-size:12px}
    .report-kpi-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:28px}
    .report-kpi-card{min-width:0;padding:20px;border:1px solid #ebeef5;border-radius:8px;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.04)}
    .report-kpi-label{display:block;color:#8a94a6;font-size:13px}
    .report-kpi-value{display:block;margin:8px 0 6px;font-size:26px;font-weight:bold;line-height:1.2;color:#00BFA5}
    .report-kpi-card.is-empty .report-kpi-value{color:#98a2b3}
    .report-kpi-card small{display:block;color:#8a94a6;font-size:11px;line-height:1.5}
    .report-section{margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #ebeef5}
    .report-section:last-of-type{border-bottom:0}
    .report-section>h2{margin:0 0 20px;padding-left:12px;border-left:5px solid #00BFA5;font-size:18px;font-weight:600;line-height:1.4;color:#111}
    .report-section>h2 span{display:inline-grid;width:26px;height:26px;margin-right:9px;place-items:center;border:1px solid #b2dfdb;border-radius:50%;color:#00796b;background:#e0f2f1;font-size:14px;font-weight:700}
    .report-business-lead p{margin:0 0 24px;font-size:15px;line-height:1.9;color:#26303d}
    .report-deepdive-item{margin-bottom:24px;padding:20px;border:1px solid #ebeef5;border-radius:8px;background:#fbfcfe}
    .report-deepdive-item h3{margin:0 0 10px;font-size:16px;font-weight:600;color:#111}
    .report-deepdive-item p{margin:0;color:#374151;font-size:14px;line-height:1.85}
    .report-list{margin:0;padding-left:22px}.report-list li{margin:0 0 12px;font-size:14px;line-height:1.8}
    .report-evidence{display:inline-block;padding:2px 6px;border-radius:4px;color:#1B5E20;background:#E8F5E9;font-family:"Cascadia Code",Consolas,monospace;font-size:15px;font-weight:600;line-height:1.55}
    .report-missing-reference{padding:2px 6px;border-radius:4px;color:#b42318;background:#fff0ef}
    .report-priority{display:inline-grid;min-width:34px;min-height:22px;margin-right:8px;place-items:center;border-radius:5px;color:#fff;background:#0f9d83;font-size:10px;text-align:center}
    .report-priority.p1{background:#1565c0}.report-priority.p2{background:#7b5bb6}
    .report-analysis-stack{display:grid;gap:20px;margin-top:24px}
    .report-analysis-block{padding:20px;border:1px solid #ebeef5;border-radius:10px;background:#fff}
    .report-analysis-head{display:flex;align-items:center;gap:10px;margin-bottom:18px}
    .report-analysis-head>span{display:grid;width:30px;height:30px;place-items:center;border-radius:8px;color:#00796b;background:#e0f2f1;font-size:10px}
    .report-analysis-head small,.report-analysis-head h3{display:block;margin:0}.report-analysis-head small{color:#8a94a6;font-size:10px}.report-analysis-head h3{font-size:15px;color:#111}
    .report-analysis-narrative{margin:0 0 16px;font-size:13px;line-height:1.85;color:#374151}
    .report-analysis-meta{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-top:8px}
    .report-analysis-meta span{padding:2px 6px;border-radius:5px;color:#9aa4b2;background:#f6f8fa;font-size:9px;line-height:1.5}
    .report-figure{margin:0;border-radius:8px;background:transparent}
    .report-chart-frame{width:100%;padding:20px;border:1px dashed #e0e0e0;border-radius:8px;background:#fcfcfc;box-sizing:border-box}
    .report-chart-frame img{display:block;width:100%;height:auto;border-radius:4px}
    .report-figure figcaption{padding:9px 4px 0;color:#8a94a6;font-size:10px;line-height:1.5}
    .report-validation,.report-document-footer{margin-top:24px;padding:18px 20px;border:1px solid #ebeef5;border-radius:9px;background:#f8fafc}
    .report-validation h2,.report-document-footer h2{margin:0 0 10px;font-size:14px;color:#111}
    .report-validation ul,.report-document-footer ol{margin:0;padding-left:20px;color:#667085;font-size:11px;line-height:1.75}
    .report-document-footer p{margin:14px 0 0;color:#1565c0;font-size:11px}
    @media(max-width:760px){.ai-report-document{padding:24px 18px;margin:12px auto}.report-kpi-grid{grid-template-columns:1fr;gap:10px}.report-chart-frame{padding:10px}.report-kpi-card{padding:16px}}
    @media print{body{background:#fff}.ai-report-document{width:100%;margin:0;padding:0;border-radius:0;box-shadow:none}.report-analysis-block,.report-deepdive-item,.report-figure,.report-kpi-card{break-inside:avoid}}
  `;

  function standaloneHtml(report) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${utils.escapeHtml(report.title)}</title>
  <style>${exportStyles}</style>
</head>
<body>${report.documentHtml}</body>
</html>`;
  }

  App.ai.report = {
    generate,
    captureFigures,
    standaloneHtml,
    buildReportBody,
    sectionDefs,
    extractRefs,
    resolveTextHtml,
    sanitizeText,
    normalizeLatexText,
    ensureActionTarget
  };
})(window);
