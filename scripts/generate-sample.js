"use strict";

const fs = require("fs");
const path = require("path");

let seed = 20261022;
function random() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

function pick(items) {
  return items[Math.floor(random() * items.length)];
}

function weighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let threshold = random() * total;
  for (const item of items) {
    threshold -= item.weight;
    if (threshold <= 0) {
      return item.value;
    }
  }
  return items[items.length - 1].value;
}

function randomInt(min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function addMinutesToIso(dayIndex, minuteOfDay) {
  const base = Date.UTC(2026, 8, 15);
  const date = new Date(base + dayIndex * 86400000 + minuteOfDay * 60000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

const channels = [
  { value: "抖音", weight: 29 },
  { value: "小红书", weight: 25 },
  { value: "搜索", weight: 27 },
  { value: "直接访问", weight: 19 }
];

const categories = [
  { value: "美妆个护", weight: 24, min: 59, max: 459 },
  { value: "服饰鞋包", weight: 29, min: 89, max: 599 },
  { value: "食品饮料", weight: 21, min: 25, max: 189 },
  { value: "家居生活", weight: 16, min: 109, max: 899 },
  { value: "数码家电", weight: 10, min: 399, max: 2699 }
];

function categoryDefinition(name) {
  return categories.find((item) => item.value === name) || categories[0];
}

function amountFor(category) {
  const definition = categoryDefinition(category);
  const raw = definition.min + random() * (definition.max - definition.min);
  return (Math.round(raw * 100) / 100).toFixed(2);
}

function purchaseDetails(category) {
  const total = amountFor(category);
  const quantity = randomInt(1, 3);
  const unitPrice = (Number(total) / quantity).toFixed(2);
  return {
    amount: total,
    unit_price: unitPrice,
    quantity: String(quantity)
  };
}

const rows = [];
const userCount = 230;

for (let userIndex = 0; userIndex < userCount; userIndex += 1) {
  const userId = `U${String(userIndex + 1).padStart(6, "0")}`;
  const channel = weighted(channels);
  const baseCategory = weighted(categories);
  const firstDay = randomInt(0, 28);
  const repeatSessions = weighted([
    { value: 0, weight: 30 },
    { value: 1, weight: 35 },
    { value: 2, weight: 22 },
    { value: 3, weight: 10 },
    { value: 4, weight: 3 }
  ]);
  const sessionDays = [firstDay];

  for (let repeat = 0; repeat < repeatSessions; repeat += 1) {
    const gap = randomInt(1, Math.max(1, 9 - repeat));
    const nextDay = Math.min(29, sessionDays[sessionDays.length - 1] + gap);
    if (!sessionDays.includes(nextDay)) {
      sessionDays.push(nextDay);
    }
  }

  sessionDays.forEach((dayIndex, sessionIndex) => {
    const category = random() < 0.12 ? weighted(categories) : baseCategory;
    const baseMinute = randomInt(8 * 60, 22 * 60);
    rows.push({
      user_id: userId,
      event: "view",
      time: addMinutesToIso(dayIndex, baseMinute),
      amount: "",
      channel,
      category,
      unit_price: "",
      quantity: "",
      duration_sec: String(randomInt(12, 240))
    });

    if (random() < 0.64) {
      rows.push({
        user_id: userId,
        event: "add_cart",
        time: addMinutesToIso(dayIndex, Math.min(23 * 60 + 59, baseMinute + randomInt(2, 24))),
        amount: "",
        channel,
        category,
        unit_price: "",
        quantity: "",
        duration_sec: String(randomInt(25, 420))
      });

      if (random() < 0.44) {
        const purchase = purchaseDetails(category);
        rows.push({
          user_id: userId,
          event: "purchase",
          time: addMinutesToIso(dayIndex, Math.min(23 * 60 + 59, baseMinute + randomInt(25, 70))),
          amount: purchase.amount,
          channel,
          category,
          unit_price: purchase.unit_price,
          quantity: purchase.quantity,
          duration_sec: String(randomInt(30, 260))
        });
      }
    }

    if (sessionIndex > 0 && random() < 0.16) {
      rows.push({
        user_id: userId,
        event: "view",
        time: addMinutesToIso(dayIndex, Math.min(23 * 60 + 59, baseMinute + randomInt(75, 130))),
        amount: "",
        channel,
        category,
        unit_price: "",
        quantity: "",
        duration_sec: String(randomInt(8, 180))
      });
    }
  });
}

rows.sort((left, right) => left.time.localeCompare(right.time));

// 预期内的空值用于演示不同填充策略，不把空金额自动解释为 0 元。
for (let index = 7; index < rows.length; index += 97) {
  if (index % 2 === 0) {
    rows[index].channel = "";
  } else {
    rows[index].category = "";
  }
}

const purchaseIndexes = [];
rows.forEach((row, index) => {
  if (row.event === "purchase") {
    purchaseIndexes.push(index);
  }
});
[17, 73, 149].forEach((offset, index) => {
  if (purchaseIndexes[offset]) {
    rows[purchaseIndexes[offset]].amount = "";
  }
});

// 人为保留少量重复记录，供“按指定列去重”演示使用。
for (let index = 0; index < 8; index += 1) {
  const source = rows[Math.min(rows.length - 1, 30 + index * 61)];
  rows.push({ ...source });
}

rows.sort((left, right) => left.time.localeCompare(right.time));

// 一个真实高客单异常样本，用来演示 IQR/3σ 检测。
const outlier = rows.find((row) => row.event === "purchase");
if (outlier) {
  outlier.amount = "5899.00";
  outlier.unit_price = "5899.00";
  outlier.quantity = "1";
  outlier.category = "数码家电";
}

const headers = [
  "user_id",
  "event",
  "time",
  "amount",
  "channel",
  "category",
  "unit_price",
  "quantity",
  "duration_sec"
];
function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csv = [
  headers.join(","),
  ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))
].join("\r\n");

const root = path.resolve(__dirname, "..");
const csvPath = path.join(root, "data", "sample-events.csv");
const jsPath = path.join(root, "data", "sample-events.js");
fs.mkdirSync(path.dirname(csvPath), { recursive: true });
fs.writeFileSync(csvPath, `\uFEFF${csv}`, "utf8");
fs.writeFileSync(
  jsPath,
  `(function bootstrapSampleData(global) {\n` +
  `  "use strict";\n` +
  `  const App = global.AIWorkbench = global.AIWorkbench || {};\n` +
  `  const csv = ${JSON.stringify(csv)};\n` +
  `  App.sample = Object.freeze({\n` +
  `    fileName: "sample-events.csv",\n` +
  `    rowCount: ${rows.length},\n` +
  `    getCsv: () => csv\n` +
  `  });\n` +
  `})(window);\n`,
  "utf8"
);

console.log(`Generated ${rows.length} rows -> ${csvPath}`);
