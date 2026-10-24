(function bootstrapChartFactory(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const palette = ["#20785a", "#2b68a0", "#b77924", "#70539b", "#a34a45", "#4c7e72"];
  const registry = new Map();
  const containerKeys = new WeakMap();

  function formatValue(value, format, compact) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return "—";
    }
    if (format === "percent") {
      return utils.formatPercent(value, 1);
    }
    return utils.formatNumber(value, {
      maximumFractionDigits: 2,
      notation: compact ? "compact" : "standard"
    });
  }

  function buildEchartsOption(spec, options) {
    const renderOptions = options || {};
    const axisColor = "#75827d";
    const lineColor = "#dfe7e2";
    const base = {
      // 报告截图使用 animation: false，避免在入场动画尚未落墨时导出空白画布。
      animation: renderOptions.animation !== false,
      animationDuration: 450,
      color: palette,
      textStyle: {
        color: "#293a34",
        fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
        fontSize: 12
      }
    };

    if (spec.type === "line") {
      return {
        ...base,
        tooltip: {
          trigger: "axis",
          valueFormatter: (value) => formatValue(value, spec.valueFormat)
        },
        grid: { left: 54, right: 20, top: 26, bottom: 48 },
        xAxis: {
          type: "category",
          data: spec.categories,
          boundaryGap: false,
          axisLabel: {
            color: axisColor,
            interval: spec.categories.length > 16 ? Math.ceil(spec.categories.length / 12) - 1 : "auto",
            rotate: spec.categories.length > 10 ? 28 : 0
          },
          axisLine: { lineStyle: { color: lineColor } },
          axisTick: { show: false }
        },
        yAxis: {
          type: "value",
          min: spec.valueFormat === "percent" ? 0 : undefined,
          max: spec.valueFormat === "percent" ? 1 : undefined,
          axisLabel: {
            color: axisColor,
            formatter: (value) => formatValue(value, spec.valueFormat, true)
          },
          splitLine: { lineStyle: { color: lineColor, type: "dashed" } }
        },
        series: spec.series.map((series, index) => ({
          name: series.name,
          type: "line",
          data: series.data,
          smooth: false,
          connectNulls: false,
          showSymbol: series.data.length <= 16,
          symbolSize: 6,
          lineStyle: { width: 2, color: palette[index % palette.length] },
          itemStyle: { color: palette[index % palette.length] }
        }))
      };
    }

    if (spec.type === "bar") {
      return {
        ...base,
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          valueFormatter: (value) => formatValue(value, spec.valueFormat)
        },
        grid: { left: 56, right: 22, top: 28, bottom: spec.categories.length > 6 ? 76 : 52 },
        xAxis: {
          type: "category",
          data: spec.categories,
          axisLabel: {
            color: axisColor,
            interval: 0,
            rotate: spec.categories.length > 5 ? 32 : 0,
            width: 94,
            overflow: "truncate"
          },
          axisLine: { lineStyle: { color: lineColor } },
          axisTick: { show: false }
        },
        yAxis: {
          type: "value",
          axisLabel: {
            color: axisColor,
            formatter: (value) => formatValue(value, spec.valueFormat, true)
          },
          splitLine: { lineStyle: { color: lineColor, type: "dashed" } }
        },
        series: spec.series.map((series, index) => ({
          name: series.name,
          type: "bar",
          data: series.data,
          barMaxWidth: 34,
          itemStyle: {
            color: palette[index % palette.length],
            borderRadius: [4, 4, 0, 0]
          }
        }))
      };
    }

    if (spec.type === "pie") {
      return {
        ...base,
        tooltip: {
          trigger: "item",
          formatter: (params) => `${params.name}<br>${utils.formatNumber(params.value, { maximumFractionDigits: 2 })} · ${params.percent}%`
        },
        legend: {
          type: "scroll",
          bottom: 6,
          textStyle: { color: axisColor, fontSize: 10 }
        },
        series: [{
          type: "pie",
          radius: ["38%", "66%"],
          center: ["50%", "45%"],
          minAngle: 3,
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: "#ffffff",
            borderWidth: 2
          },
          label: {
            color: "#293a34",
            fontSize: 10,
            formatter: (params) => params.percent < 5 ? "" : params.name
          },
          data: spec.data
        }]
      };
    }

    if (spec.type === "scatter") {
      return {
        ...base,
        tooltip: {
          trigger: "item",
          formatter: (params) => {
            const point = spec.points[params.dataIndex];
            return `${point.name ? `${utils.escapeHtml(point.name)}<br>` : ""}${spec.xAxisLabel}: ${utils.formatNumber(params.data[0])}<br>${spec.yAxisLabel}: ${utils.formatNumber(params.data[1])}`;
          }
        },
        grid: { left: 62, right: 24, top: 26, bottom: 48 },
        xAxis: {
          type: "value",
          name: spec.xAxisLabel,
          nameLocation: "middle",
          nameGap: 28,
          nameTextStyle: { color: axisColor, fontSize: 10 },
          axisLabel: { color: axisColor },
          splitLine: { lineStyle: { color: lineColor, type: "dashed" } }
        },
        yAxis: {
          type: "value",
          name: spec.yAxisLabel,
          nameLocation: "middle",
          nameGap: 46,
          nameTextStyle: { color: axisColor, fontSize: 10 },
          axisLabel: { color: axisColor },
          splitLine: { lineStyle: { color: lineColor, type: "dashed" } }
        },
        series: [{
          type: "scatter",
          symbolSize: 7,
          itemStyle: {
            color: palette[0],
            opacity: 0.72
          },
          data: spec.points.map((point) => [point.x, point.y])
        }]
      };
    }

    if (spec.type === "funnel") {
      return {
        ...base,
        tooltip: {
          trigger: "item",
          formatter: (params) => `${params.name}<br>${utils.formatNumber(params.value, { maximumFractionDigits: 0 })} 人 · ${params.percent}%`
        },
        series: [{
          type: "funnel",
          left: "8%",
          right: "8%",
          top: 18,
          bottom: 18,
          minSize: "22%",
          maxSize: "100%",
          sort: "descending",
          gap: 3,
          label: {
            show: true,
            position: "inside",
            color: "#ffffff",
            formatter: (params) => `${params.name}  ${params.value}`
          },
          itemStyle: {
            borderColor: "#ffffff",
            borderWidth: 1
          },
          data: spec.data
        }]
      };
    }

    if (spec.type === "heatmap") {
      return {
        ...base,
        tooltip: {
          position: "top",
          formatter: (params) => {
            const value = params.data[2];
            return `${spec.y[params.data[1]]} × ${spec.x[params.data[0]]}<br>r = ${value === null ? "—" : Number(value).toFixed(3)}`;
          }
        },
        grid: { left: 100, right: 30, top: 18, bottom: 76 },
        xAxis: {
          type: "category",
          data: spec.x,
          axisLabel: {
            color: axisColor,
            rotate: spec.x.length > 5 ? 28 : 0,
            width: 90,
            overflow: "truncate"
          },
          splitArea: { show: true }
        },
        yAxis: {
          type: "category",
          data: spec.y,
          axisLabel: { color: axisColor },
          splitArea: { show: true }
        },
        visualMap: {
          min: spec.min,
          max: spec.max,
          calculable: false,
          orient: "horizontal",
          left: "center",
          bottom: 6,
          text: ["正相关", "负相关"],
          textStyle: { color: axisColor, fontSize: 10 },
          inRange: { color: ["#c85c55", "#f7f8f7", "#20785a"] }
        },
        series: [{
          type: "heatmap",
          data: spec.data.map((item) => [item.x, item.y, item.value]),
          label: {
            show: true,
            color: "#26342f",
            fontSize: 10,
            formatter: (params) => params.data[2] === null ? "—" : Number(params.data[2]).toFixed(2)
          },
          itemStyle: { borderColor: "#ffffff", borderWidth: 2 }
        }]
      };
    }

    throw new Error(`不支持的图表类型：${spec.type}`);
  }

  function colorFor(value) {
    if (value === null || !Number.isFinite(value)) {
      return "#edf1ef";
    }
    if (value >= 0) {
      const ratio = Math.max(0, Math.min(1, value));
      const start = [247, 250, 249];
      const end = [32, 120, 90];
      return `rgb(${start.map((channel, index) => Math.round(channel + (end[index] - channel) * ratio)).join(",")})`;
    }
    const ratio = Math.max(0, Math.min(1, Math.abs(value)));
    const start = [247, 250, 249];
    const end = [200, 92, 85];
    return `rgb(${start.map((channel, index) => Math.round(channel + (end[index] - channel) * ratio)).join(",")})`;
  }

  function drawFallback(canvas, spec) {
    const container = canvas.parentElement;
    const width = Math.max(320, container.clientWidth || 720);
    const height = 320;
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = "100%";
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    if (spec.type === "pie") {
      const total = spec.data.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1;
      const centerX = width / 2;
      const centerY = 142;
      const radius = Math.min(110, width * 0.24);
      let angle = -Math.PI / 2;
      spec.data.forEach((item, index) => {
        const sweep = (Number(item.value) || 0) / total * Math.PI * 2;
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.arc(centerX, centerY, radius, angle, angle + sweep);
        context.closePath();
        context.fillStyle = palette[index % palette.length];
        context.fill();
        angle += sweep;
      });
      context.beginPath();
      context.arc(centerX, centerY, radius * 0.54, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.fill();
      spec.data.slice(0, 8).forEach((item, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const x = 34 + column * (width - 68) / 4;
        const y = height - 54 + row * 20;
        context.fillStyle = palette[index % palette.length];
        context.fillRect(x, y - 8, 7, 7);
        context.fillStyle = "#5f7069";
        context.font = "9px Segoe UI, Microsoft YaHei, sans-serif";
        context.textAlign = "left";
        context.fillText(String(item.name).slice(0, 9), x + 11, y - 1);
      });
      return;
    }

    if (spec.type === "scatter") {
      const plot = { left: 58, right: 24, top: 24, bottom: 48 };
      const plotWidth = width - plot.left - plot.right;
      const plotHeight = height - plot.top - plot.bottom;
      const xs = spec.points.map((point) => Number(point.x)).filter(Number.isFinite);
      const ys = spec.points.map((point) => Number(point.y)).filter(Number.isFinite);
      let minX = Math.min(...xs);
      let maxX = Math.max(...xs);
      let minY = Math.min(...ys);
      let maxY = Math.max(...ys);
      if (minX === maxX) {
        minX -= 1;
        maxX += 1;
      }
      if (minY === maxY) {
        minY -= 1;
        maxY += 1;
      }
      context.strokeStyle = "#dfe7e2";
      context.lineWidth = 1;
      context.strokeRect(plot.left, plot.top, plotWidth, plotHeight);
      context.fillStyle = "#75827d";
      context.font = "9px Segoe UI, Microsoft YaHei, sans-serif";
      context.textAlign = "center";
      context.fillText(spec.xAxisLabel, width / 2, height - 8);
      context.save();
      context.translate(12, height / 2);
      context.rotate(-Math.PI / 2);
      context.fillText(spec.yAxisLabel, 0, 0);
      context.restore();
      spec.points.forEach((point) => {
        const x = plot.left + (Number(point.x) - minX) / (maxX - minX) * plotWidth;
        const y = plot.top + plotHeight - (Number(point.y) - minY) / (maxY - minY) * plotHeight;
        context.beginPath();
        context.arc(x, y, 3.2, 0, Math.PI * 2);
        context.fillStyle = "rgba(32,120,90,.65)";
        context.fill();
      });
      return;
    }

    if (spec.type === "funnel") {
      const totalWidth = width - 120;
      const center = width / 2;
      const rowHeight = (height - 40) / Math.max(1, spec.data.length);
      spec.data.forEach((item, index) => {
        const next = spec.data[index + 1];
        const firstRatio = index === 0 ? 1 : spec.data[index - 1].value / spec.data[0].value;
        const secondRatio = next ? item.value / spec.data[0].value : item.value / spec.data[0].value * 0.72;
        const topHalf = totalWidth * firstRatio / 2;
        const bottomHalf = totalWidth * secondRatio / 2;
        const y = 20 + index * rowHeight;
        context.beginPath();
        context.moveTo(center - topHalf, y);
        context.lineTo(center + topHalf, y);
        context.lineTo(center + bottomHalf, y + rowHeight - 4);
        context.lineTo(center - bottomHalf, y + rowHeight - 4);
        context.closePath();
        context.fillStyle = palette[index % palette.length];
        context.fill();
        context.fillStyle = "#ffffff";
        context.font = "12px Segoe UI, Microsoft YaHei, sans-serif";
        context.textAlign = "center";
        context.fillText(`${item.name}  ${item.value}`, center, y + rowHeight / 2 + 2);
      });
      return;
    }

    if (spec.type === "heatmap") {
      const left = 106;
      const top = 18;
      const right = 24;
      const bottom = 54;
      const cellWidth = (width - left - right) / spec.x.length;
      const cellHeight = (height - top - bottom) / spec.y.length;
      spec.data.forEach((item) => {
        const x = left + item.x * cellWidth;
        const y = top + item.y * cellHeight;
        context.fillStyle = colorFor(item.value);
        context.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
        context.fillStyle = Math.abs(item.value || 0) > 0.55 ? "#ffffff" : "#293a34";
        context.font = "11px Segoe UI, Microsoft YaHei, sans-serif";
        context.textAlign = "center";
        context.fillText(item.value === null ? "—" : Number(item.value).toFixed(2), x + cellWidth / 2, y + cellHeight / 2 + 4);
      });
      context.fillStyle = "#5f7069";
      context.font = "10px Segoe UI, Microsoft YaHei, sans-serif";
      spec.y.forEach((name, index) => {
        context.textAlign = "right";
        context.fillText(name, left - 8, top + index * cellHeight + cellHeight / 2 + 3);
      });
      spec.x.forEach((name, index) => {
        context.save();
        context.translate(left + index * cellWidth + cellWidth / 2, height - bottom + 12);
        context.rotate(-0.4);
        context.textAlign = "right";
        context.fillText(name, 0, 0);
        context.restore();
      });
      return;
    }

    if (spec.type === "bar" && (spec.categories.length > 6 || spec.categories.some((item) => String(item).length > 9))) {
      const left = 126;
      const right = 58;
      const top = 18;
      const bottom = 18;
      const rowHeight = (height - top - bottom) / spec.categories.length;
      const values = spec.series[0].data.map((value) => Number(value) || 0);
      const max = Math.max(...values, 1);
      spec.categories.forEach((name, index) => {
        const value = values[index];
        const barWidth = (width - left - right) * value / max;
        const y = top + index * rowHeight + rowHeight * 0.2;
        context.fillStyle = "#f1f5f3";
        context.fillRect(left, y, width - left - right, Math.max(6, rowHeight * 0.6));
        context.fillStyle = palette[index % palette.length];
        context.fillRect(left, y, barWidth, Math.max(6, rowHeight * 0.6));
        context.fillStyle = "#293a34";
        context.font = "10px Segoe UI, Microsoft YaHei, sans-serif";
        context.textAlign = "right";
        context.fillText(String(name).slice(0, 14), left - 8, y + rowHeight * 0.45);
        context.textAlign = "left";
        context.fillStyle = "#5f7069";
        context.fillText(formatValue(value, spec.valueFormat, true), left + barWidth + 7, y + rowHeight * 0.45);
      });
      return;
    }

    const plot = { left: 54, right: 22, top: 20, bottom: 50 };
    const plotWidth = width - plot.left - plot.right;
    const plotHeight = height - plot.top - plot.bottom;
    const categories = spec.categories || [];
    const allValues = (spec.series || []).flatMap((series) => series.data)
      .filter((value) => value !== null && Number.isFinite(Number(value)))
      .map(Number);
    let min = Math.min(0, ...allValues);
    let max = Math.max(1, ...allValues);
    if (spec.valueFormat === "percent") {
      min = 0;
      max = 1;
    } else if (min === max) {
      max = min + 1;
    } else {
      max *= 1.08;
    }
    const xAt = (index) => plot.left + (categories.length <= 1 ? plotWidth / 2 : plotWidth * index / (categories.length - 1));
    const yAt = (value) => plot.top + plotHeight - plotHeight * (Number(value) - min) / (max - min);

    context.strokeStyle = "#dfe7e2";
    context.lineWidth = 1;
    context.font = "10px Segoe UI, Microsoft YaHei, sans-serif";
    for (let index = 0; index <= 4; index += 1) {
      const y = plot.top + plotHeight * index / 4;
      context.beginPath();
      context.setLineDash([4, 4]);
      context.moveTo(plot.left, y);
      context.lineTo(width - plot.right, y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "#75827d";
      context.textAlign = "right";
      const labelValue = max - (max - min) * index / 4;
      context.fillText(formatValue(labelValue, spec.valueFormat, true), plot.left - 8, y + 3);
    }

    const labelStep = Math.max(1, Math.ceil(categories.length / 10));
    categories.forEach((category, index) => {
      if (index % labelStep !== 0 && index !== categories.length - 1) {
        return;
      }
      const x = spec.type === "bar"
        ? plot.left + plotWidth * (index + 0.5) / categories.length
        : xAt(index);
      context.fillStyle = "#75827d";
      context.textAlign = "center";
      context.fillText(String(category).slice(0, 12), x, height - plot.bottom + 18);
    });

    if (spec.type === "bar") {
      const data = spec.series[0].data;
      const columnWidth = plotWidth / categories.length;
      data.forEach((value, index) => {
        if (!Number.isFinite(Number(value))) {
          return;
        }
        const x = plot.left + columnWidth * index + columnWidth * 0.2;
        const y = yAt(value);
        context.fillStyle = palette[0];
        context.fillRect(x, y, columnWidth * 0.6, plot.top + plotHeight - y);
      });
      return;
    }

    spec.series.forEach((series, seriesIndex) => {
      context.strokeStyle = palette[seriesIndex % palette.length];
      context.lineWidth = 2;
      context.beginPath();
      let drawing = false;
      series.data.forEach((value, index) => {
        if (value === null || !Number.isFinite(Number(value))) {
          drawing = false;
          return;
        }
        const x = xAt(index);
        const y = yAt(value);
        if (!drawing) {
          context.moveTo(x, y);
          drawing = true;
        } else {
          context.lineTo(x, y);
        }
      });
      context.stroke();
    });
    context.fillStyle = "#5f7069";
    context.textAlign = "left";
    context.fillText("离线轻量预览", width - plot.right - 72, 12);
  }

  // 判断分析结果是否有足够数据绘制图表。报告层据此决定是否插图，空结果不硬塞空白图片。
  function hasChartData(spec) {
    if (!spec || typeof spec.type !== "string") {
      return false;
    }
    const isFiniteValue = (value) => value !== null
      && value !== undefined
      && Number.isFinite(Number(value));
    if (spec.type === "line" || spec.type === "bar") {
      return Boolean(
        Array.isArray(spec.categories)
        && spec.categories.length
        && Array.isArray(spec.series)
        && spec.series.some((series) => (
          Array.isArray(series.data) && series.data.some(isFiniteValue)
        ))
      );
    }
    if (spec.type === "funnel" || spec.type === "pie") {
      return Array.isArray(spec.data)
        && spec.data.some((item) => isFiniteValue(item.value) && Number(item.value) > 0);
    }
    if (spec.type === "scatter") {
      return Array.isArray(spec.points)
        && spec.points.some((point) => isFiniteValue(point.x) && isFiniteValue(point.y));
    }
    if (spec.type === "heatmap") {
      return Array.isArray(spec.data) && spec.data.some((item) => isFiniteValue(item.value));
    }
    return false;
  }

  function nextFrame() {
    return new Promise((resolve) => {
      if (typeof global.requestAnimationFrame === "function") {
        global.requestAnimationFrame(() => resolve());
      } else {
        global.setTimeout(resolve, 16);
      }
    });
  }

  // 对实际 Canvas 像素做抽样，避免把“只有白底的 PNG”当作有效报告图表。
  function canvasHasInk(entry) {
    const canvas = entry.type === "echarts"
      ? entry.container?.querySelector("canvas")
      : entry.canvas;
    if (!canvas || !canvas.width || !canvas.height) {
      return false;
    }
    try {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return false;
      }
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let inkSamples = 0;
      // 每 4 个像素抽样一次；出现少量非透明/非纯白像素即说明坐标轴或图形已落墨。
      for (let index = 0; index < data.length; index += 16) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const alpha = data[index + 3];
        if (alpha > 8 && (red < 245 || green < 245 || blue < 245)) {
          inkSamples += 1;
          if (inkSamples >= 12) {
            return true;
          }
        }
      }
    } catch (error) {
      return false;
    }
    return false;
  }

  function cleanupContainer(container) {
    const oldKey = containerKeys.get(container);
    if (oldKey) {
      dispose(oldKey);
    }
  }

  function render(container, spec, options) {
    if (!container || !spec) {
      return null;
    }
    cleanupContainer(container);
    const key = options && options.key ? options.key : utils.uid("chart");
    container.innerHTML = "";
    let entry;
    if (global.echarts && typeof global.echarts.init === "function") {
      const instance = global.echarts.init(container, null, { renderer: "canvas" });
      instance.setOption(buildEchartsOption(spec, options), true);
      entry = {
        key,
        spec: utils.clone(spec),
        container,
        type: "echarts",
        instance
      };
    } else {
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", spec.title || "分析图表");
      container.appendChild(canvas);
      drawFallback(canvas, spec);
      entry = {
        key,
        spec: utils.clone(spec),
        container,
        type: "canvas",
        canvas
      };
    }
    registry.set(key, entry);
    containerKeys.set(container, key);
    return entry;
  }

  function dispose(key) {
    const entry = registry.get(key);
    if (!entry) {
      return;
    }
    if (entry.type === "echarts" && entry.instance) {
      entry.instance.dispose();
    }
    registry.delete(key);
  }

  function get(key) {
    return registry.get(key) || null;
  }

  function capture(key) {
    const entry = registry.get(key);
    if (!entry) {
      return null;
    }
    if (entry.type === "echarts") {
      return entry.instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: "#ffffff"
      });
    }
    return entry.canvas.toDataURL("image/png");
  }

  // 等待离屏图表真正完成绘制后再截图；无效图表返回 null，由调用方决定跳过。
  async function captureAsync(key, options) {
    const entry = registry.get(key);
    const captureOptions = options || {};
    const attempts = Math.max(1, captureOptions.attempts || 3);
    if (!entry || !hasChartData(entry.spec)) {
      return null;
    }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (entry.type === "echarts" && entry.instance) {
        try {
          entry.instance.resize();
          entry.instance.getZr()?.flush?.();
        } catch (error) {
          // ECharts 版本差异不应阻断后续像素校验。
        }
      }
      await nextFrame();
      await nextFrame();
      if (attempt > 0) {
        await new Promise((resolve) => global.setTimeout(resolve, 60 * attempt));
      }
      if (canvasHasInk(entry)) {
        const dataUrl = capture(key);
        if (dataUrl && dataUrl.startsWith("data:image/png")) {
          return dataUrl;
        }
      }
    }
    return null;
  }

  function resizeAll() {
    registry.forEach((entry) => {
      if (entry.type === "echarts") {
        entry.instance.resize();
      } else if (entry.type === "canvas") {
        drawFallback(entry.canvas, entry.spec);
      }
    });
  }

  global.addEventListener("resize", utils.debounce(resizeAll, 120));

  App.charts = {
    render,
    dispose,
    get,
    capture,
    captureAsync,
    hasChartData,
    buildEchartsOption,
    provider: () => global.echarts ? "ECharts" : "canvas-fallback"
  };
})(window);
