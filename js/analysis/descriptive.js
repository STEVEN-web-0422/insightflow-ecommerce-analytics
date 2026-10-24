(function bootstrapDescriptiveAnalysis(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const common = App.analysis.common;
  const utils = App.utils;

  function buildHistogram(numbers, requestedBins) {
    if (!numbers.length) {
      return [];
    }
    const binCount = Math.max(3, Math.min(20, Number(requestedBins) || Math.ceil(Math.log2(numbers.length) + 1)));
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    if (min === max) {
      return [{
        label: String(min),
        lower: min,
        upper: max,
        count: numbers.length
      }];
    }
    const width = (max - min) / binCount;
    const bins = Array.from({ length: binCount }, (_, index) => ({
      label: `${utils.formatNumber(min + width * index, { maximumFractionDigits: 2 })}–${utils.formatNumber(min + width * (index + 1), { maximumFractionDigits: 2 })}`,
      lower: min + width * index,
      upper: min + width * (index + 1),
      count: 0
    }));
    numbers.forEach((value) => {
      let index = Math.floor((value - min) / width);
      if (index >= binCount) {
        index = binCount - 1;
      }
      bins[index].count += 1;
    });
    return bins;
  }

  function run(table, config) {
    const field = common.assertField(table, config.metricField, "数值指标列", ["number"]);
    const allValues = table.rows.map((row) => row[field.key]);
    const numbers = allValues.map(utils.parseNumberLike).filter((value) => value !== null);
    if (!numbers.length) {
      throw new Error(`字段“${field.key}”没有可统计的数值。`);
    }

    const mean = utils.mean(numbers);
    const median = utils.median(numbers);
    const std = utils.standardDeviation(numbers, false);
    const sorted = numbers.slice().sort((left, right) => left - right);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const q25 = utils.quantile(sorted, 0.25);
    const q75 = utils.quantile(sorted, 0.75);
    const q90 = utils.quantile(sorted, 0.9);
    const histogram = buildHistogram(numbers, config.binCount);

    const metrics = [
      common.metric("descriptive_count", "有效样本", numbers.length, {
        formatter: "number",
        digits: 0,
        definition: `${field.key} 中非缺失且可解析为数值的记录数`
      }),
      common.metric("descriptive_mean", "均值", mean, {
        digits: 2,
        definition: "全部有效样本的算术平均值"
      }),
      common.metric("descriptive_median", "中位数", median, {
        digits: 2,
        definition: "按从小到大排序后位于中间的数值"
      }),
      common.metric("descriptive_std", "样本标准差", std, {
        digits: 2,
        definition: "使用 n−1 作为分母的样本标准差"
      }),
      common.metric("descriptive_q75", "P75", q75, {
        digits: 2,
        definition: "75% 的样本小于或等于该值；常用于识别高值区间"
      })
    ];

    const quantileRows = [
      { quantile: "最小值", value: min },
      { quantile: "P25", value: q25 },
      { quantile: "P50 / 中位数", value: median },
      { quantile: "P75", value: q75 },
      { quantile: "P90", value: q90 },
      { quantile: "最大值", value: max }
    ];
    const warnings = [];
    const missing = allValues.filter((value) => utils.isMissing(value)).length;
    if (missing) {
      warnings.push(`${missing} 条记录为缺失值，未纳入统计。`);
    }
    if (numbers.length < 30) {
      warnings.push("有效样本少于 30 条，分位数和标准差解释需要谨慎。");
    }
    if (Math.abs(mean - median) > std * 0.5 && std > 0) {
      warnings.push("均值与中位数差异较大，分布可能明显偏态，建议优先参考中位数和分位数。");
    }

    const summary = common.configSummary([
      { label: "统计指标", value: field.key },
      { label: "字段类型", value: "数值" },
      { label: "有效样本", value: `${numbers.length} / ${allValues.length}` },
      { label: "标准差口径", value: "样本标准差（n−1）" },
      { label: "直方图分箱", value: `${histogram.length} 组` }
    ]);
    const chartSpec = {
      type: "bar",
      title: `${field.key} 分布直方图`,
      subtitle: `${numbers.length} 个有效样本 · ${histogram.length} 个分箱`,
      xAxisLabel: field.key,
      yAxisLabel: "频数",
      categories: histogram.map((bin) => bin.label),
      series: [{
        name: "频数",
        data: histogram.map((bin) => bin.count)
      }],
      valueFormat: "number"
    };

    return {
      ...common.record(
        table,
        "descriptive",
        `${field.key} 描述性统计`,
        { ...config, histogram },
        summary,
        metrics,
        {
          columns: [
            { key: "quantile", label: "统计位置", align: "left" },
            { key: "value", label: field.key, type: "number", align: "right" }
          ],
          rows: quantileRows,
          totalRows: quantileRows.length
        },
        chartSpec,
        warnings
      ),
      summaryTable: {
        title: "直方图分箱明细",
        columns: [
          { key: "label", label: "数值区间", align: "left" },
          { key: "count", label: "频数", type: "number", align: "right" },
          { key: "share", label: "占比", type: "percent", align: "right" }
        ],
        rows: histogram.map((bin) => ({
          ...bin,
          share: numbers.length ? bin.count / numbers.length : 0
        }))
      }
    };
  }

  App.analysis.descriptive = { run, buildHistogram };
})(window);
