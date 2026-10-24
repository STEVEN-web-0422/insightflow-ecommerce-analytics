(function bootstrapFunnelAnalysis(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const common = App.analysis.common;
  const utils = App.utils;

  function run(table, config) {
    const userField = common.assertField(table, config.userIdField, "用户 ID 列");
    const timeField = common.assertField(table, config.timeField, "时间列", ["date"]);
    const eventField = common.assertField(table, config.eventField, "事件列");
    const steps = (config.steps || []).map((step) => String(step).trim()).filter(Boolean);
    const windowDays = Math.max(1, Number(config.windowDays) || 7);

    if (steps.length < 2 || steps.length > 5) {
      throw new Error("漏斗步骤必须为 2–5 个。");
    }
    if (new Set(steps).size !== steps.length) {
      throw new Error("漏斗步骤不能重复，请为每个节点选择不同的事件值。");
    }
    const availableEvents = new Set(common.valuesOf(table, eventField.key).map(String));
    const missingEvents = steps.filter((step) => !availableEvents.has(step));
    if (missingEvents.length) {
      throw new Error(`事件列中不存在：${missingEvents.join("、")}。`);
    }

    const users = new Map();
    table.rows.forEach((row) => {
      if (utils.isMissing(row[userField.key]) || utils.isMissing(row[timeField.key]) || utils.isMissing(row[eventField.key])) {
        return;
      }
      const userId = String(row[userField.key]);
      if (!users.has(userId)) {
        users.set(userId, []);
      }
      users.get(userId).push({
        event: String(row[eventField.key]),
        timestamp: common.rowTimestamp(row, timeField.key, table),
        order: common.sourceOrder(row, table)
      });
    });

    const stepUsers = steps.map(() => 0);
    const conversionDurations = [];
    users.forEach((events) => {
      events.sort((left, right) => {
        return (left.timestamp - right.timestamp) || (left.order - right.order);
      });
      const firstIndex = events.findIndex((event) => event.event === steps[0]);
      if (firstIndex === -1) {
        return;
      }
      stepUsers[0] += 1;
      let previous = events[firstIndex];
      let complete = true;

      for (let stepIndex = 1; stepIndex < steps.length; stepIndex += 1) {
        const next = events.find((event, eventIndex) => {
          return eventIndex > firstIndex
            && event.event === steps[stepIndex]
            && (
              event.timestamp > previous.timestamp
              || (event.timestamp === previous.timestamp && event.order > previous.order)
            );
        });
        if (!next || next.timestamp - events[firstIndex].timestamp > windowDays * common.DAY_MS) {
          complete = false;
          break;
        }
        stepUsers[stepIndex] += 1;
        previous = next;
      }

      if (complete) {
        conversionDurations.push((previous.timestamp - events[firstIndex].timestamp) / common.DAY_MS);
      }
    });

    const entrants = stepUsers[0];
    const finalUsers = stepUsers[stepUsers.length - 1];
    const overallConversion = entrants ? finalUsers / entrants : 0;
    const averageDays = conversionDurations.length
      ? conversionDurations.reduce((sum, value) => sum + value, 0) / conversionDurations.length
      : null;
    const columns = [
      { key: "step", label: "漏斗步骤", align: "left" },
      { key: "event", label: "事件值", align: "left" },
      { key: "users", label: "到达用户", type: "number", align: "right" },
      { key: "stepConversion", label: "单步转化率", type: "percent", align: "right" },
      { key: "overallConversion", label: "总体转化率", type: "percent", align: "right" },
      { key: "dropoff", label: "流失用户", type: "number", align: "right" }
    ];
    const resultRows = steps.map((step, index) => {
      const previousUsers = index === 0 ? stepUsers[0] : stepUsers[index - 1];
      return {
        step: `${index + 1}`,
        event: step,
        users: stepUsers[index],
        stepConversion: index === 0 ? 1 : (previousUsers ? stepUsers[index] / previousUsers : 0),
        overallConversion: entrants ? stepUsers[index] / entrants : 0,
        dropoff: index === 0 ? 0 : Math.max(0, previousUsers - stepUsers[index])
      };
    });

    const biggestDrop = resultRows
      .slice(1)
      .sort((left, right) => right.dropoff - left.dropoff)[0];
    const metrics = [
      common.metric("funnel_entrants", "首步用户", entrants, {
        formatter: "number",
        digits: 0,
        definition: `${steps[0]} 事件覆盖的去重用户数`
      }),
      common.metric("funnel_final_users", "完成用户", finalUsers, {
        formatter: "number",
        digits: 0,
        definition: `在 ${windowDays} 天窗口内完成全部 ${steps.length} 个步骤的去重用户数`
      }),
      common.metric("funnel_overall_conversion", "总体转化率", overallConversion, {
        formatter: "percent",
        definition: "完成末步用户数 ÷ 首步用户数"
      }),
      common.metric("funnel_avg_days", "平均转化耗时", averageDays, {
        digits: 2,
        unit: "天",
        definition: "完成全部步骤用户的首步到末步平均时间"
      })
    ];

    const warnings = [];
    if (entrants < 100) {
      warnings.push("首步用户不足 100 人，转化率的小幅波动可能被放大。");
    }
    if (biggestDrop && biggestDrop.dropoff > 0) {
      warnings.push(`最大流失发生在 ${biggestDrop.event}，流失 ${biggestDrop.dropoff} 人。`);
    }
    if (averageDays === null) {
      warnings.push("当前窗口内没有完整完成全部步骤的用户。");
    }

    const summary = common.configSummary([
      { label: "用户标识", value: userField.key },
      { label: "行为时间", value: timeField.key },
      { label: "事件字段", value: eventField.key },
      { label: "漏斗路径", value: steps.join(" → ") },
      { label: "转化窗口", value: `${windowDays} 天` },
      { label: "重复规则", value: "每用户每节点只计一次" }
    ]);

    const chartSpec = {
      type: "funnel",
      title: "有序漏斗转化",
      subtitle: `窗口 ${windowDays} 天 · 用户去重`,
      data: steps.map((step, index) => ({
        name: step,
        value: stepUsers[index]
      }))
    };

    return common.record(
      table,
      "funnel",
      `${steps[0]} → ${steps[steps.length - 1]} 转化漏斗`,
      { ...config, steps, windowDays },
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
  }

  App.analysis.funnel = { run };
})(window);
