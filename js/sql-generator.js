(function bootstrapSqlGenerator(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;

  function quoteIdentifier(value) {
    return `"${String(value || "").replace(/"/g, '""')}"`;
  }

  function quoteTable(tableName) {
    return quoteIdentifier(tableName || "current_table");
  }

  function sqlString(value) {
    return `'${String(value ?? "").replace(/'/g, "''")}'`;
  }

  function configuredName(value, fallback) {
    return value || fallback;
  }

  function granularityDateExpression(field, granularity) {
    const column = `CAST(${quoteIdentifier(field)} AS DATE)`;
    if (granularity === "week") {
      return `CAST(DATE_TRUNC('week', ${column}) AS DATE)`;
    }
    if (granularity === "month") {
      return `CAST(DATE_TRUNC('month', ${column}) AS DATE)`;
    }
    return column;
  }

  function funnelSQL(config, tableName) {
    const userId = configuredName(config.userIdField, "user_id");
    const timeField = configuredName(config.timeField, "time");
    const eventField = configuredName(config.eventField, "event");
    const steps = Array.isArray(config.steps) && config.steps.length
      ? config.steps
      : ["view", "add_cart", "purchase"];
    const windowDays = Number(config.windowDays) || 7;
    const stepNames = steps.map(sqlString).join(", ");
    const stepCtes = steps.slice(1).map((step, index) => {
      const stepNumber = index + 2;
      const previousTable = index === 0 ? "entry" : `step_${stepNumber - 1}`;
      const previousTime = index === 0 ? "entry_time" : `step_${stepNumber - 1}_time`;
      return `
step_${stepNumber} AS (
    SELECT
        e.${quoteIdentifier(userId)} AS user_id,
        e.entry_time,
        MIN(e.event_time) AS step_${stepNumber}_time
    FROM ${previousTable} e
    JOIN events v
      ON v.${quoteIdentifier(userId)} = e.${quoteIdentifier(userId)}
     AND v.${quoteIdentifier(eventField)} = ${sqlString(step)}
     AND v.event_time > e.${previousTime}
     AND v.event_time <= e.entry_time + INTERVAL '${windowDays}' DAY
    GROUP BY e.${quoteIdentifier(userId)}
)`;
    }).join(",\n");
    const unions = steps.map((step, index) => {
      const number = index + 1;
      const source = number === 1 ? "entry" : `step_${number}`;
      return `SELECT ${number} AS step_no, ${sqlString(step)} AS step_name, COUNT(DISTINCT ${quoteIdentifier(userId)}) AS users FROM ${source}`;
    }).join("\n    UNION ALL\n    ");

    return `-- 漏斗分析（示例使用 PostgreSQL 时间语法）
-- 首次步骤进入时间作为窗口起点；每个用户每个步骤只保留首次到达时间。
WITH events AS (
    SELECT
        ${quoteIdentifier(userId)},
        CAST(${quoteIdentifier(timeField)} AS TIMESTAMP) AS event_time,
        ${quoteIdentifier(eventField)}
    FROM ${quoteTable(tableName)}
    WHERE ${quoteIdentifier(userId)} IS NOT NULL
      AND ${quoteIdentifier(timeField)} IS NOT NULL
      AND ${quoteIdentifier(eventField)} IN (${stepNames})
),
entry AS (
    SELECT
        ${quoteIdentifier(userId)},
        MIN(event_time) AS entry_time
    FROM events
    WHERE ${quoteIdentifier(eventField)} = ${sqlString(steps[0])}
    GROUP BY ${quoteIdentifier(userId)}
),${stepCtes}
SELECT step_no, step_name, users
FROM (
    ${unions}
) funnel_steps
ORDER BY step_no;

-- 关键口径：步骤必须按 ${steps.join(" → ")} 顺序完成；
-- 后续事件必须严格晚于上一步，并位于首步后 ${windowDays} 天窗口内；
-- 用户在每个节点只计一次。`;
  }

  function retentionSQL(config, tableName) {
    const userId = configuredName(config.userIdField, "user_id");
    const timeField = configuredName(config.timeField, "time");
    const eventField = configuredName(config.eventField, "event");
    const eventValue = config.eventValue && config.eventValue !== "__all__"
      ? String(config.eventValue)
      : "";
    const granularity = config.resolvedGranularity || config.cohortGranularity || "day";
    const horizon = Number(config.resolvedHorizon || config.horizon) || (granularity === "week" ? 8 : granularity === "month" ? 6 : 30);
    const cohortExpression = granularityDateExpression(timeField, granularity);
    const periodExpression = granularityDateExpression(timeField, granularity);
    let periodIndex;
    if (granularity === "month") {
      periodIndex = `(EXTRACT(YEAR FROM activity_period)::int * 12 + EXTRACT(MONTH FROM activity_period)::int)
      - (EXTRACT(YEAR FROM cohort_date)::int * 12 + EXTRACT(MONTH FROM cohort_date)::int)`;
    } else if (granularity === "week") {
      periodIndex = `FLOOR((activity_period - cohort_date) / 7.0)::int`;
    } else {
      periodIndex = `(activity_period - cohort_date)`;
    }
    const eventFilter = eventValue
      ? `\n      AND ${quoteIdentifier(eventField)} = ${sqlString(eventValue)}`
      : "";

    return `-- 留存分析：${config.retentionMode || "Cohort"}；Cohort 粒度 ${granularity}
-- 分母固定为 Cohort 初始用户；同一用户同一周期只计一次活跃。
-- 输出为长表，BI 透视后即得到 D0..D${horizon} 留存矩阵。
WITH first_activity AS (
    SELECT
        ${quoteIdentifier(userId)},
        MIN(${cohortExpression}) AS cohort_date
    FROM ${quoteTable(tableName)}
    WHERE ${quoteIdentifier(userId)} IS NOT NULL
      AND ${quoteIdentifier(timeField)} IS NOT NULL${eventFilter}
    GROUP BY ${quoteIdentifier(userId)}
),
activity_periods AS (
    SELECT DISTINCT
        f.${quoteIdentifier(userId)},
        f.cohort_date,
        ${periodExpression} AS activity_period
    FROM first_activity f
    JOIN ${quoteTable(tableName)} t
      ON t.${quoteIdentifier(userId)} = f.${quoteIdentifier(userId)}
    WHERE t.${quoteIdentifier(timeField)} IS NOT NULL${eventValue ? `\n      AND t.${quoteIdentifier(eventField)} = ${sqlString(eventValue)}` : ""}
),
cohort_activity AS (
    SELECT
        ${quoteIdentifier(userId)},
        cohort_date,
        ${periodIndex} AS period_index
    FROM activity_periods
),
cohort_sizes AS (
    SELECT cohort_date, COUNT(DISTINCT ${quoteIdentifier(userId)}) AS cohort_users
    FROM first_activity
    GROUP BY cohort_date
)
SELECT
    a.cohort_date,
    s.cohort_users,
    a.period_index,
    COUNT(DISTINCT a.${quoteIdentifier(userId)}) AS retained_users,
    COUNT(DISTINCT a.${quoteIdentifier(userId)}) * 1.0 / s.cohort_users AS retention_rate
FROM cohort_activity a
JOIN cohort_sizes s USING (cohort_date)
WHERE a.period_index BETWEEN 0 AND ${horizon}
GROUP BY a.cohort_date, s.cohort_users, a.period_index
ORDER BY a.cohort_date, a.period_index;

-- 关键口径：首次行为周期形成 Cohort；
-- ${granularity === "day" ? "按自然日" : granularity === "week" ? "按周起始日" : "按自然月"}计算周期；
-- 加权留存曲线仅纳入已具备对应观察窗口的 Cohort。`;
  }

  function rfmSQL(config, tableName) {
    const userId = configuredName(config.userIdField, "user_id");
    const timeField = configuredName(config.timeField, "time");
    const amountField = configuredName(config.amountField, "amount");
    const eventField = configuredName(config.eventField, "event");
    const eventValue = configuredName(config.eventValue, "purchase");
    const snapshot = config.snapshotDate || "CURRENT_DATE";
    const snapshotLiteral = snapshot === "CURRENT_DATE" ? snapshot : `DATE ${sqlString(snapshot)}`;
    const fixed = config.scoringMethod === "fixed";
    const thresholdSource = fixed
      ? ""
      : `,\nthresholds AS (
    SELECT
        PERCENTILE_CONT(0.40) WITHIN GROUP (ORDER BY recency_days) AS r_threshold,
        PERCENTILE_CONT(0.60) WITHIN GROUP (ORDER BY frequency) AS f_threshold,
        PERCENTILE_CONT(0.60) WITHIN GROUP (ORDER BY monetary) AS m_threshold
    FROM user_rfm
)`;
    const rCut = fixed ? Number(config.rThresholdMax) || 14 : "(SELECT r_threshold FROM thresholds)";
    const fCut = fixed ? Number(config.fThresholdMin) || 2 : "(SELECT f_threshold FROM thresholds)";
    const mCut = fixed ? Number(config.mThresholdMin) || 300 : "(SELECT m_threshold FROM thresholds)";
    const thresholdJoin = fixed ? "" : "\nCROSS JOIN thresholds th";

    return `-- RFM 用户分层：${fixed ? "固定业务阈值" : `分位数（高分 ${config.quantileCut || 60}%）`}
-- R：快照日距最近成交天数；F：成交次数；M：成交金额合计。
WITH transactions AS (
    SELECT
        ${quoteIdentifier(userId)},
        CAST(${quoteIdentifier(timeField)} AS DATE) AS order_date,
        COALESCE(${quoteIdentifier(amountField)}, 0) AS amount
    FROM ${quoteTable(tableName)}
    WHERE ${quoteIdentifier(userId)} IS NOT NULL
      AND ${quoteIdentifier(timeField)} IS NOT NULL
      AND ${quoteIdentifier(eventField)} = ${sqlString(eventValue)}
),
user_rfm AS (
    SELECT
        ${quoteIdentifier(userId)},
        ${snapshotLiteral} - MAX(order_date) AS recency_days,
        COUNT(*) AS frequency,
        SUM(amount) AS monetary
    FROM transactions
    GROUP BY ${quoteIdentifier(userId)}
)${thresholdSource},
scored AS (
    SELECT
        r.*,
        CASE WHEN recency_days <= ${rCut} THEN 1 ELSE 0 END AS r_high,
        CASE WHEN frequency >= ${fCut} THEN 1 ELSE 0 END AS f_high,
        CASE WHEN monetary >= ${mCut} THEN 1 ELSE 0 END AS m_high
    FROM user_rfm r${thresholdJoin}
)
SELECT
    ${quoteIdentifier(userId)},
    recency_days,
    frequency,
    monetary,
    CASE
        WHEN r_high = 1 AND f_high = 1 AND m_high = 1 THEN '重要价值客户'
        WHEN r_high = 1 AND f_high = 0 AND m_high = 1 THEN '重要发展客户'
        WHEN r_high = 0 AND f_high = 1 AND m_high = 1 THEN '重要保持客户'
        WHEN r_high = 0 AND f_high = 0 AND m_high = 1 THEN '重要挽留客户'
        WHEN r_high = 1 AND f_high = 1 AND m_high = 0 THEN '一般价值客户'
        WHEN r_high = 1 AND f_high = 0 AND m_high = 0 THEN '一般发展客户'
        WHEN r_high = 0 AND f_high = 1 AND m_high = 0 THEN '一般保持客户'
        ELSE '一般挽留客户'
    END AS rfm_segment
FROM scored
ORDER BY monetary DESC;`;
  }

  function descriptiveSQL(config, tableName) {
    const metric = configuredName(config.metricField, "amount");
    return `-- 描述性统计：仅纳入非缺失数值样本
SELECT
    COUNT(${quoteIdentifier(metric)}) AS sample_count,
    AVG(${quoteIdentifier(metric)}) AS mean_value,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${quoteIdentifier(metric)}) AS median_value,
    STDDEV_SAMP(${quoteIdentifier(metric)}) AS sample_stddev,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${quoteIdentifier(metric)}) AS p25,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${quoteIdentifier(metric)}) AS p75,
    PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY ${quoteIdentifier(metric)}) AS p90,
    MIN(${quoteIdentifier(metric)}) AS min_value,
    MAX(${quoteIdentifier(metric)}) AS max_value
FROM ${quoteTable(tableName)}
WHERE ${quoteIdentifier(metric)} IS NOT NULL;

-- 直方图可在 BI 层按分箱统计；下式展示等宽分箱思路：
-- SELECT WIDTH_BUCKET(${quoteIdentifier(metric)}, MIN(${quoteIdentifier(metric)}), MAX(${quoteIdentifier(metric)}), ${Number(config.binCount) || 8}) AS bin_no,
--        COUNT(*) AS records
-- FROM ${quoteTable(tableName)}
-- GROUP BY bin_no
-- ORDER BY bin_no;`;
  }

  function groupSQL(config, tableName) {
    const dimension = configuredName(config.dimensionField, "channel");
    const metric = configuredName(config.metricField, "amount");
    const method = config.aggregateMethod || "count";
    const aggregateExpression = method === "count"
      ? "COUNT(*)"
      : method === "distinct"
        ? `COUNT(DISTINCT ${quoteIdentifier(metric)})`
        : `${method === "avg" ? "AVG" : "SUM"}(${quoteIdentifier(metric)})`;
    const limit = config.topN === "all" ? "" : `\nLIMIT ${Number(config.topN) || 10}`;
    return `-- 分组对比：${dimension} 维度，使用 ${method} 聚合
-- 空维度统一归入“缺失”；去重计数与行数计数口径不同。
SELECT
    COALESCE(CAST(${quoteIdentifier(dimension)} AS TEXT), '缺失') AS group_value,
    COUNT(*) AS record_count,
    ${aggregateExpression} AS metric_value
FROM ${quoteTable(tableName)}
GROUP BY COALESCE(CAST(${quoteIdentifier(dimension)} AS TEXT), '缺失')
ORDER BY metric_value DESC${limit};`;
  }

  function trendSQL(config, tableName) {
    const timeField = configuredName(config.timeField, "time");
    const metric = configuredName(config.metricField, "amount");
    const method = config.aggregateMethod || "sum";
    const granularity = config.granularity || "day";
    const periodExpression = granularityDateExpression(timeField, granularity);
    const aggregateExpression = method === "count"
      ? "COUNT(*)"
      : method === "distinct"
        ? `COUNT(DISTINCT ${quoteIdentifier(metric)})`
        : `${method === "avg" ? "AVG" : "SUM"}(${quoteIdentifier(metric)})`;
    const yoyLag = granularity === "month" ? 12 : granularity === "week" ? 52 : 365;
    return `-- 趋势分析：${granularity === "day" ? "按日" : granularity === "week" ? "按周" : "按月"}聚合
-- 环比取上一周期；同比取同粒度滞后 ${yoyLag} 期，要求时间序列连续。
WITH period_metric AS (
    SELECT
        ${periodExpression} AS period_start,
        ${aggregateExpression} AS metric_value
    FROM ${quoteTable(tableName)}
    WHERE ${quoteIdentifier(timeField)} IS NOT NULL
    GROUP BY ${periodExpression}
),
trend AS (
    SELECT
        period_start,
        metric_value,
        LAG(metric_value, 1) OVER (ORDER BY period_start) AS previous_metric,
        LAG(metric_value, ${yoyLag}) OVER (ORDER BY period_start) AS previous_year_metric
    FROM period_metric
)
SELECT
    period_start,
    metric_value,
    (metric_value - previous_metric) / NULLIF(ABS(previous_metric), 0) AS period_change,
    (metric_value - previous_year_metric) / NULLIF(ABS(previous_year_metric), 0) AS year_over_year
FROM trend
ORDER BY period_start;`;
  }

  function correlationSQL(config, tableName) {
    const fields = Array.isArray(config.fields) && config.fields.length >= 2
      ? config.fields
      : ["amount", "duration_sec"];
    const pairs = [];
    for (let leftIndex = 0; leftIndex < fields.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < fields.length; rightIndex += 1) {
        const left = fields[leftIndex];
        const right = fields[rightIndex];
        pairs.push(`SELECT
    ${sqlString(left)} AS field_a,
    ${sqlString(right)} AS field_b,
    CORR(${quoteIdentifier(left)}, ${quoteIdentifier(right)}) AS pearson_r,
    COUNT(*) AS pair_sample
FROM ${quoteTable(tableName)}
WHERE ${quoteIdentifier(left)} IS NOT NULL
  AND ${quoteIdentifier(right)} IS NOT NULL`);
      }
    }
    return `-- Pearson 相关性矩阵
-- 每个字段对分别删除缺失值；相关不代表因果。
SELECT field_a, field_b, pearson_r, pair_sample
FROM (
    ${pairs.join("\n    UNION ALL\n    ")}
) correlation_pairs
ORDER BY field_a, field_b;`;
  }

  /**
   * 根据分析配置生成可追溯的等价 SQL。
   * 所有标识符使用双引号，字符串使用单引号，避免动态配置产生歧义。
   */
  function generateSQL(type, config, tableName) {
    const settings = config || {};
    if (type === "funnel") {
      return funnelSQL(settings, tableName);
    }
    if (type === "retention") {
      return retentionSQL(settings, tableName);
    }
    if (type === "rfm") {
      return rfmSQL(settings, tableName);
    }
    if (type === "descriptive") {
      return descriptiveSQL(settings, tableName);
    }
    if (type === "group") {
      return groupSQL(settings, tableName);
    }
    if (type === "trend") {
      return trendSQL(settings, tableName);
    }
    if (type === "correlation") {
      return correlationSQL(settings, tableName);
    }
    return `-- 暂不支持 ${type || "未知"} 分析的 SQL 模板\nSELECT * FROM ${quoteTable(tableName)} LIMIT 100;`;
  }

  function highlightSQL(sql) {
    const tokenPattern = /(--[^\n]*)|('(?:''|[^'])*')|\b(SELECT|FROM|WHERE|WITH|AS|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|GROUP|BY|ORDER|LIMIT|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|COUNT|SUM|AVG|MIN|MAX|PERCENTILE_CONT|WITHIN|GROUP|OVER|PARTITION|LAG|CORR|STDDEV_SAMP|COALESCE|CAST|DATE_TRUNC|EXTRACT|FLOOR|NULLIF|INTERVAL)\b/gi;
    let output = "";
    let cursor = 0;
    sql.replace(tokenPattern, (match, comment, stringValue, keyword, offset) => {
      output += utils.escapeHtml(sql.slice(cursor, offset));
      if (comment) {
        output += `<span class="sql-comment">${utils.escapeHtml(comment)}</span>`;
      } else if (stringValue) {
        output += `<span class="sql-string">${utils.escapeHtml(stringValue)}</span>`;
      } else {
        output += `<span class="sql-keyword">${utils.escapeHtml(keyword)}</span>`;
      }
      cursor = offset + match.length;
      return match;
    });
    output += utils.escapeHtml(sql.slice(cursor));
    return output.replace(/\b(true|false|null)\b/gi, '<span class="sql-literal">$1</span>');
  }

  function renderSQLBlock(record) {
    const sql = generateSQL(record.type, record.config || {}, record.tableName);
    return `
      <details class="analysis-sql-section">
        <summary>
          <span><i data-lucide="code-xml" aria-hidden="true"></i>查看等价 SQL</span>
          <small>默认折叠 · 仅供口径追溯</small>
        </summary>
        <div class="analysis-sql-content">
          <div class="analysis-sql-code-head">
            <span>${utils.escapeHtml(record.type.toUpperCase())} SQL</span>
            <button class="button button-secondary button-small" type="button" data-copy-sql>复制</button>
          </div>
          <pre class="analysis-sql-preview"><code>${highlightSQL(sql)}</code></pre>
          <div class="notice warning analysis-sql-disclaimer">
            <i data-lucide="shield-alert" aria-hidden="true"></i>
            <span>演示版不执行自定义 SQL；可复制到数据库运行，或使用下方 AI 辅助修改口径。</span>
          </div>
          <div class="analysis-sql-editor-field">
            <div class="analysis-sql-editor-head">
              <span class="form-label">可编辑 SQL</span>
              <button class="icon-button analysis-sql-expand" type="button" data-expand-sql aria-label="放大查看和编辑 SQL" title="放大查看/编辑">
                <span aria-hidden="true">⤢</span>
              </button>
            </div>
            <textarea class="textarea analysis-sql-editor" spellcheck="false">${utils.escapeHtml(sql)}</textarea>
          </div>
          <div class="analysis-sql-ai-slot"
               data-ai-sql-actions
               data-sql-type="${utils.escapeHtml(record.type || "")}"
               data-sql-table-name="${utils.escapeHtml(record.tableName || "")}"
               aria-label="AI SQL 操作">
            <!-- 预留：后续 AI 解读、AI 改口径按钮 -->
          </div>
        </div>
      </details>
    `;
  }

  async function copySql(button) {
    const section = button.closest(".analysis-sql-section");
    const editor = section && section.querySelector(".analysis-sql-editor");
    const text = editor ? editor.value : "";
    try {
      await navigator.clipboard.writeText(text);
      App.ui.toast("SQL 已复制到剪贴板。", "success");
    } catch (error) {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
      App.ui.toast("SQL 已复制到剪贴板。", "success");
    }
  }

  function handleClick(event) {
    const button = event.target.closest("[data-copy-sql]");
    if (button) {
      copySql(button);
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("click", handleClick);
  }

  App.sql = {
    generateSQL,
    renderSQLBlock,
    highlightSQL,
    quoteIdentifier
  };
})(window);
