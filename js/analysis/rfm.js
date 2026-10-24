(function bootstrapRfmAnalysis(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const common = App.analysis.common;
  const utils = App.utils;

  const SEGMENTS = Object.freeze({
    "1-1-1": "重要价值客户",
    "0-1-1": "重要保持客户",
    "1-0-1": "重要发展客户",
    "0-0-1": "重要挽留客户",
    "1-1-0": "一般价值客户",
    "0-1-0": "一般保持客户",
    "1-0-0": "一般发展客户",
    "0-0-0": "一般挽留客户"
  });

  const SEGMENT_ORDER = [
    "重要价值客户",
    "重要发展客户",
    "重要保持客户",
    "重要挽留客户",
    "一般价值客户",
    "一般发展客户",
    "一般保持客户",
    "一般挽留客户"
  ];

  function quantileAscending(values, ratio) {
    return utils.quantile(values, ratio);
  }

  function buildThresholds(users, config) {
    const percentile = Math.max(40, Math.min(90, Number(config.quantileCut) || 60));
    const highRatio = percentile / 100;
    const lowRatio = 1 - highRatio;
    const fallbackMode = config.scoringMethod || "quantile";
    const rMode = config.rScoringMethod || fallbackMode;
    const fMode = config.fScoringMethod || fallbackMode;
    const mMode = config.mScoringMethod || fallbackMode;
    return {
      mode: rMode === fMode && fMode === mMode ? rMode : "mixed",
      percentile,
      rMode,
      fMode,
      mMode,
      rMax: rMode === "fixed"
        ? Math.max(0, Number(config.rThresholdMax) || 0)
        : quantileAscending(users.map((user) => user.recencyDays), lowRatio),
      fMin: fMode === "fixed"
        ? Math.max(0, Number(config.fThresholdMin) || 0)
        : quantileAscending(users.map((user) => user.frequency), highRatio),
      mMin: mMode === "fixed"
        ? Math.max(0, Number(config.mThresholdMin) || 0)
        : quantileAscending(users.map((user) => user.monetary), highRatio)
    };
  }

  function run(table, config) {
    const userField = common.assertField(table, config.userIdField, "用户 ID 列");
    const timeField = common.assertField(table, config.timeField, "时间列", ["date"]);
    const amountField = common.assertField(table, config.amountField, "金额列", ["number"]);
    const eventField = common.assertField(table, config.eventField, "成交事件列");
    const eventValue = String(config.eventValue || "").trim();
    if (!eventValue) {
      throw new Error("请选择成交事件值。");
    }

    const transactionRows = table.rows.filter((row) => {
      return !utils.isMissing(row[userField.key])
        && !utils.isMissing(row[timeField.key])
        && String(row[eventField.key]) === eventValue;
    });
    if (!transactionRows.length) {
      throw new Error("当前成交事件口径下没有可分析的交易记录。");
    }

    const maxDate = table.rows
      .map((row) => row[timeField.key])
      .filter((value) => !utils.isMissing(value))
      .sort()
      .pop();
    const snapshotDate = utils.normalizeDate(config.snapshotDate)
      || common.formatDateOffset(maxDate, 1);
    const snapshotIndex = common.dayIndex(snapshotDate);

    const userMap = new Map();
    transactionRows.forEach((row) => {
      const userId = String(row[userField.key]);
      if (!userMap.has(userId)) {
        userMap.set(userId, {
          userId,
          lastDate: row[timeField.key],
          frequency: 0,
          monetary: 0
        });
      }
      const item = userMap.get(userId);
      item.frequency += 1;
      const amount = utils.parseNumberLike(row[amountField.key]);
      item.monetary += amount === null ? 0 : amount;
      if (String(row[timeField.key]) > String(item.lastDate)) {
        item.lastDate = row[timeField.key];
      }
    });

    const users = Array.from(userMap.values()).map((item) => {
      const lastDay = common.dayIndex(item.lastDate);
      return {
        ...item,
        recencyDays: Math.max(0, snapshotIndex - lastDay)
      };
    });
    const thresholds = buildThresholds(users, config);

    users.forEach((user) => {
      user.rHigh = user.recencyDays <= thresholds.rMax ? 1 : 0;
      user.fHigh = user.frequency >= thresholds.fMin ? 1 : 0;
      user.mHigh = user.monetary >= thresholds.mMin ? 1 : 0;
      user.segmentKey = `${user.rHigh}-${user.fHigh}-${user.mHigh}`;
      user.segment = SEGMENTS[user.segmentKey];
    });

    const segmentMap = new Map(SEGMENT_ORDER.map((name) => [name, []]));
    users.forEach((user) => segmentMap.get(user.segment).push(user));
    const summaryRows = SEGMENT_ORDER.map((segment) => {
      const members = segmentMap.get(segment);
      return {
        segment,
        users: members.length,
        share: users.length ? members.length / users.length : 0,
        avgRecency: members.length ? members.reduce((sum, user) => sum + user.recencyDays, 0) / members.length : null,
        avgFrequency: members.length ? members.reduce((sum, user) => sum + user.frequency, 0) / members.length : null,
        avgMonetary: members.length ? members.reduce((sum, user) => sum + user.monetary, 0) / members.length : null
      };
    });

    const highValueUsers = users.filter((user) => user.segment.startsWith("重要")).length;
    const revenue = users.reduce((sum, user) => sum + user.monetary, 0);
    const averageFrequency = users.reduce((sum, user) => sum + user.frequency, 0) / users.length;
    const averageMonetary = users.reduce((sum, user) => sum + user.monetary, 0) / users.length;

    const segmentColumns = [
      { key: "segment", label: "分层", align: "left" },
      { key: "users", label: "用户数", type: "number", align: "right" },
      { key: "share", label: "用户占比", type: "percent", align: "right" },
      { key: "avgRecency", label: "平均 R（天）", type: "number", align: "right" },
      { key: "avgFrequency", label: "平均 F（次）", type: "number", align: "right" },
      { key: "avgMonetary", label: "平均 M（元）", type: "number", align: "right" }
    ];
    const userColumns = [
      { key: "userId", label: "用户 ID", align: "left" },
      { key: "lastDate", label: "最近成交日", align: "left" },
      { key: "recencyDays", label: "R / 距今天数", type: "number", align: "right" },
      { key: "frequency", label: "F / 成交次数", type: "number", align: "right" },
      { key: "monetary", label: "M / 累计金额", type: "number", align: "right" },
      { key: "segment", label: "用户分层", align: "left" }
    ];
    const userRows = users
      .slice()
      .sort((left, right) => right.monetary - left.monetary)
      .map((user) => ({ ...user }));

    const metrics = [
      common.metric("rfm_users", "成交用户数", users.length, {
        formatter: "number",
        digits: 0,
        definition: `在 ${eventValue} 事件中产生的去重用户数`
      }),
      common.metric("rfm_revenue", "累计成交金额", revenue, {
        formatter: "compact",
        unit: "元",
        definition: "成交事件金额求和"
      }),
      common.metric("rfm_avg_frequency", "人均成交次数", averageFrequency, {
        digits: 2,
        unit: "次",
        definition: "成交事件次数 ÷ 成交用户数"
      }),
      common.metric("rfm_avg_monetary", "人均成交金额", averageMonetary, {
        formatter: "compact",
        unit: "元",
        definition: "成交金额 ÷ 成交用户数"
      }),
      common.metric("rfm_high_value_share", "重要客群占比", users.length ? highValueUsers / users.length : 0, {
        formatter: "percent",
        definition: "四类“重要”客群的用户数 ÷ 全部成交用户数"
      })
    ];

    const warnings = [];
    if (users.length < 30) {
      warnings.push("成交用户少于 30 人，RFM 分位阈值容易受单个用户影响。");
    }
    if ([thresholds.rMode, thresholds.fMode, thresholds.mMode].includes("quantile")) {
      warnings.push(`分位阈值采用高分 ${thresholds.percentile}% 口径，R 以距今较短为高、F/M 以数值较高为高。`);
    }
    if (transactionRows.some((row) => utils.isMissing(row[amountField.key]))) {
      warnings.push("部分成交记录金额缺失，这些记录仍计入 F，但不计入 M。");
    }

    const summary = common.configSummary([
      { label: "用户标识", value: userField.key },
      { label: "成交时间", value: timeField.key },
      { label: "成交事件", value: `${eventField.key} = ${eventValue}` },
      { label: "成交金额", value: amountField.key },
      { label: "快照日", value: snapshotDate },
      {
        label: "分箱策略",
        value: `R=${thresholds.rMode === "fixed" ? "固定阈值" : "分位数"}，F=分位数，M=分位数`
      },
      {
        label: "高低分界",
        value: `R ≤ ${utils.formatNumber(thresholds.rMax)} 天 · F ≥ ${utils.formatNumber(thresholds.fMin)} 次 · M ≥ ${utils.formatNumber(thresholds.mMin)} 元`
      },
      { label: "客群结构", value: "2×2×2 · 八类标准 RFM 客群" }
    ]);

    const chartSpec = {
      type: "bar",
      title: "RFM 八类客群分布",
      subtitle: `用户数 · 快照日 ${snapshotDate}`,
      xAxisLabel: "客群",
      yAxisLabel: "用户数",
      categories: SEGMENT_ORDER,
      series: [{
        name: "用户数",
        data: SEGMENT_ORDER.map((segment) => segmentMap.get(segment).length)
      }],
      valueFormat: "number"
    };

    return {
      ...common.record(
        table,
        "rfm",
        "RFM 用户价值分层",
        { ...config, snapshotDate, resolvedThresholds: thresholds },
        summary,
        metrics,
        {
          columns: userColumns,
          rows: userRows,
          totalRows: userRows.length
        },
        chartSpec,
        warnings
      ),
      summaryTable: {
        title: "八类客群汇总",
        columns: segmentColumns,
        rows: summaryRows
      }
    };
  }

  App.analysis.rfm = {
    run,
    SEGMENTS,
    SEGMENT_ORDER
  };
})(window);
