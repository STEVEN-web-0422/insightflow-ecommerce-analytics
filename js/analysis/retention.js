(function bootstrapRetentionAnalysis(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const common = App.analysis.common;
  const utils = App.utils;

  function resolveMode(config) {
    const mode = config.retentionMode || "cohort";
    if (mode === "next_day") {
      return { granularity: "day", horizon: 1, primaryOffset: 1 };
    }
    if (mode === "day7") {
      return { granularity: "day", horizon: 7, primaryOffset: 7 };
    }
    if (mode === "day30") {
      return { granularity: "day", horizon: 30, primaryOffset: 30 };
    }
    if (mode === "weekly") {
      return { granularity: "week", horizon: 8, primaryOffset: 1 };
    }
    if (mode === "daily") {
      return { granularity: "day", horizon: Math.max(1, Number(config.horizon) || 30), primaryOffset: 1 };
    }
    const granularity = ["day", "week", "month"].includes(config.cohortGranularity)
      ? config.cohortGranularity
      : "day";
    const defaultHorizon = granularity === "month" ? 6 : granularity === "week" ? 8 : 30;
    return {
      granularity,
      horizon: Math.max(1, Number(config.horizon) || defaultHorizon),
      primaryOffset: 1
    };
  }

  function periodPrefix(granularity) {
    if (granularity === "week") {
      return "W";
    }
    if (granularity === "month") {
      return "M";
    }
    return "D";
  }

  function modeLabel(mode) {
    return {
      next_day: "次日留存",
      day7: "7 日留存",
      day30: "30 日留存",
      daily: "每日 Cohort 曲线",
      weekly: "每周 Cohort 曲线",
      cohort: "自定义 Cohort 矩阵"
    }[mode] || mode;
  }

  function run(table, config) {
    const userField = common.assertField(table, config.userIdField, "用户 ID 列");
    const timeField = common.assertField(table, config.timeField, "时间列", ["date"]);
    const eventField = config.eventField ? common.assertField(table, config.eventField, "行为列") : null;
    const eventValue = config.eventValue && config.eventValue !== "__all__" ? String(config.eventValue) : "";
    const mode = resolveMode(config);

    const users = new Map();
    table.rows.forEach((row) => {
      if (utils.isMissing(row[userField.key]) || utils.isMissing(row[timeField.key])) {
        return;
      }
      if (eventField && eventValue && String(row[eventField.key]) !== eventValue) {
        return;
      }
      const userId = String(row[userField.key]);
      const timestamp = common.rowTimestamp(row, timeField.key, table);
      if (!users.has(userId)) {
        users.set(userId, []);
      }
      users.get(userId).push({
        row,
        timestamp,
        order: common.sourceOrder(row, table),
        date: row[timeField.key]
      });
    });

    if (!users.size) {
      throw new Error("当前用户、时间和行为筛选条件下没有可分析记录。");
    }

    const cohorts = new Map();
    const dayLevelUsers = [];
    let globalMaxPeriod = null;
    let globalMinDay = null;
    let globalMaxDay = null;

    users.forEach((events, userId) => {
      events.sort((left, right) => {
        return (left.timestamp - right.timestamp) || (left.order - right.order);
      });
      const firstDate = events[0].date;
      const firstPeriod = common.periodInfo(firstDate, mode.granularity);
      if (firstPeriod.index === null) {
        return;
      }
      const cohortKey = firstPeriod.key;
      const activePeriods = new Set();
      events.forEach((event) => {
        const eventDayIndex = common.dayIndex(event.date);
        if (eventDayIndex !== null) {
          globalMinDay = globalMinDay === null ? eventDayIndex : Math.min(globalMinDay, eventDayIndex);
          globalMaxDay = globalMaxDay === null ? eventDayIndex : Math.max(globalMaxDay, eventDayIndex);
        }
        const period = common.periodInfo(event.date, mode.granularity);
        const offset = common.periodDifference(firstPeriod, period, mode.granularity);
        if (offset !== null && offset >= 0 && offset <= mode.horizon) {
          activePeriods.add(offset);
        }
        if (period.index !== null && (globalMaxPeriod === null || period.index > globalMaxPeriod)) {
          globalMaxPeriod = period.index;
        }
      });
      if (!cohorts.has(cohortKey)) {
        cohorts.set(cohortKey, {
          key: cohortKey,
          label: firstPeriod.label,
          index: firstPeriod.index,
          users: []
        });
      }
      cohorts.get(cohortKey).users.push({
        userId,
        activePeriods
      });

      const dayPeriods = new Set();
      const firstDay = common.periodInfo(firstDate, "day");
      events.forEach((event) => {
        const eventDay = common.periodInfo(event.date, "day");
        const offset = eventDay.index - firstDay.index;
        if (offset >= 0) {
          dayPeriods.add(offset);
        }
      });
      dayLevelUsers.push({ firstDay, dayPeriods });
    });

    if (!cohorts.size || globalMaxPeriod === null) {
      throw new Error("无法形成有效 Cohort，请检查时间字段的完整性。");
    }

    const periods = Array.from({ length: mode.horizon + 1 }, (_, index) => index);
    const matrixRows = Array.from(cohorts.values())
      .sort((left, right) => String(left.key).localeCompare(String(right.key)))
      .map((cohort) => {
        const cells = periods.map((period) => {
          const retained = cohort.users.filter((user) => user.activePeriods.has(period)).length;
          return {
            period,
            retained,
            rate: cohort.users.length ? retained / cohort.users.length : null
          };
        });
        return {
          cohort: cohort.label,
          size: cohort.users.length,
          cells
        };
      });

    const weightedCurve = periods.map((period) => {
      let eligibleUsers = 0;
      let retainedUsers = 0;
      Array.from(cohorts.values()).forEach((cohort) => {
        if (globalMaxPeriod - cohort.index < period) {
          return;
        }
        eligibleUsers += cohort.users.length;
        retainedUsers += cohort.users.filter((user) => user.activePeriods.has(period)).length;
      });
      return {
        period,
        rate: eligibleUsers ? retainedUsers / eligibleUsers : null,
        retainedUsers,
        eligibleUsers
      };
    });

    function dayRetention(offset) {
      const eligible = dayLevelUsers.filter((user) => {
        return globalMaxDay !== null && user.firstDay.index + offset <= globalMaxDay;
      });
      const retained = eligible.filter((user) => user.dayPeriods.has(offset)).length;
      return eligible.length ? retained / eligible.length : null;
    }

    const d1 = dayRetention(1);
    const d7 = dayRetention(7);
    const d30 = dayRetention(30);
    const primary = weightedCurve.find((point) => point.period === mode.primaryOffset);
    const prefix = periodPrefix(mode.granularity);
    const columns = [
      { key: "cohort", label: "Cohort", align: "left" },
      { key: "size", label: "用户数", type: "number", align: "right" },
      ...periods.map((period) => ({
        key: `p${period}`,
        label: `${prefix}${period}`,
        type: "percent",
        align: "right"
      }))
    ];
    const resultRows = matrixRows.map((row) => {
      const output = {
        cohort: row.cohort,
        size: row.size
      };
      row.cells.forEach((cell) => {
        output[`p${cell.period}`] = cell.rate;
      });
      return output;
    });

    const warnings = [];
    if (globalMinDay !== null && globalMaxDay !== null && globalMaxDay - globalMinDay < 30) {
      warnings.push("数据时间跨度不足 30 天，部分留存周期可能无法观察。");
    }
    if (d30 !== null && globalMaxDay !== null && dayLevelUsers.filter((user) => {
      return user.firstDay.index + 30 <= globalMaxDay;
    }).length < 30) {
      warnings.push("D30 可观察用户少于 30 人，长期留存结论需要谨慎使用。");
    }

    const metrics = [
      common.metric("retention_users", "分析用户数", users.size, {
        formatter: "number",
        digits: 0,
        definition: "应用用户和行为筛选后，拥有有效首次行为时间的去重用户数"
      }),
      common.metric("retention_d1", "次日留存", d1, {
        formatter: "percent",
        definition: "首次行为次日仍有行为的用户 ÷ 已具备次日观察窗口的用户"
      }),
      common.metric("retention_d7", "7 日留存", d7, {
        formatter: "percent",
        definition: "首次行为后第 7 天仍有行为的用户 ÷ 已具备 7 日观察窗口的用户"
      }),
      common.metric("retention_d30", "30 日留存", d30, {
        formatter: "percent",
        definition: "首次行为后第 30 天仍有行为的用户 ÷ 已具备 30 日观察窗口的用户"
      })
    ];
    metrics.push(common.metric("retention_primary", "当前主观察点", primary ? primary.rate : null, {
      formatter: "percent",
      definition: `${modeLabel(config.retentionMode)} · Cohort 加权留存`
    }));

    const summary = common.configSummary([
      { label: "用户标识", value: userField.key },
      { label: "首次行为时间", value: timeField.key },
      { label: "行为筛选", value: eventValue || "全部行为" },
      { label: "留存口径", value: modeLabel(config.retentionMode) },
      { label: "Cohort 粒度", value: { day: "按天", week: "按周", month: "按月" }[mode.granularity] },
      { label: "观察周期", value: `${prefix}0–${prefix}${mode.horizon}` },
      { label: "活跃判定", value: "同一用户同周期至少 1 次行为" }
    ]);

    const chartSpec = {
      type: "line",
      title: "Cohort 加权留存曲线",
      subtitle: `${modeLabel(config.retentionMode)} · 仅纳入已具备对应观察窗口的 Cohort`,
      xAxisLabel: `${mode.granularity === "day" ? "天" : mode.granularity === "week" ? "周" : "月"}周期`,
      yAxisLabel: "留存率",
      categories: periods.map((period) => `${prefix}${period}`),
      series: [{
        name: "加权留存率",
        data: weightedCurve.map((point) => point.rate)
      }],
      valueFormat: "percent"
    };

    const record = common.record(
      table,
      "retention",
      "用户留存 Cohort 分析",
      {
        ...config,
        resolvedGranularity: mode.granularity,
        resolvedHorizon: mode.horizon
      },
      summary,
      metrics,
      {
        columns,
        rows: resultRows,
        totalRows: resultRows.length
      },
      chartSpec,
      warnings
    );

    return {
      ...record,
      analysisMode: modeLabel(config.retentionMode)
    };
  }

  App.analysis.retention = { run };
})(window);
