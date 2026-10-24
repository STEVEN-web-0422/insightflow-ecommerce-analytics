(function bootstrapLayeredDataWarehouse(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const ADS_STORAGE_KEY = "iflow:ads:v1";
  const DWD_NAME = "电商行为分析_DWD";
  const layerWarehouse = {
    ods: null,
    dwd: null,
    ads: [],
    loadingOds: null,
    lastBuild: null,

    async ensureOds(force) {
      if (this.ods && !force) {
        return this.ods;
      }
      if (this.loadingOds && !force) {
        return this.loadingOds;
      }
      this.loadingOds = (async () => {
        if (!App.sample || !App.parser) {
          throw new Error("示例电商日志模块未加载。");
        }
        const result = await App.parser.parseCsv(App.sample.getCsv(), App.sample.fileName);
        const ods = result.draft;
        ods.id = "ods_ecommerce_log";
        ods.name = "电商行为日志_ODS";
        ods.layer = "ODS";
        ods.layerLabel = "ODS 原始数据层";
        this.ods = ods;
        App.state.emit("dataWarehouse:changed", { layer: "ODS", table: ods });
        return ods;
      })();
      try {
        return await this.loadingOds;
      } finally {
        this.loadingOds = null;
      }
    },

    /**
     * 固定电商日志清洗 SOP，只生成一条 DWD 宽表。
     * 用户不可配置字段、填充方式或派生表达式。
     */
    async buildDwd() {
      const source = await this.ensureOds();
      const sourceTimeField = source.schema.find((field) => field.key === "time");
      const amountField = source.schema.find((field) => field.key === "amount");
      const rows = [];
      const rowMeta = {};
      let removedDirtyRows = 0;
      let convertedAmounts = 0;
      let derivedHours = 0;

      source.rows.forEach((row) => {
        const userId = String(row.user_id ?? "").trim();
        const time = utils.normalizeDate(row.time);
        if (!userId || !time) {
          removedDirtyRows += 1;
          return;
        }
        const sourceTime = source.rowMeta?.[row.__rowId]?.time__sourceTime || row.time;
        let hour = null;
        if (utils.hasTimeComponent(sourceTime)) {
          const parsed = new Date(sourceTime);
          if (!Number.isNaN(parsed.getTime())) {
            hour = parsed.getHours();
            derivedHours += 1;
          }
        }
        const amount = utils.parseNumberLike(row.amount);
        if (amount !== null) {
          convertedAmounts += 1;
        }
        const cleaned = {
          ...row,
          user_id: userId,
          time,
          amount,
          date: time,
          hour
        };
        rows.push(cleaned);
        rowMeta[row.__rowId] = {
          ...(source.rowMeta?.[row.__rowId] || {}),
          time__sourceTime: sourceTime
        };
      });

      let schema = source.schema
        .filter((field) => !["date", "hour"].includes(field.key))
        .map((field) => {
          if (field.key === "time") {
            return { ...field, type: "date", role: "time" };
          }
          if (field.key === "amount") {
            return { ...field, type: "number", role: "metric" };
          }
          return { ...field };
        });
      const timeIndex = schema.findIndex((field) => field.key === "time");
      schema.splice(timeIndex + 1, 0,
        {
          key: "date",
          label: "date",
          type: "date",
          role: "time",
          precision: null,
          unit: "",
          inferenceConfidence: 1
        },
        {
          key: "hour",
          label: "hour",
          type: "number",
          role: "time",
          precision: 0,
          unit: "时",
          inferenceConfidence: 1
        }
      );

      const previous = this.dwd;
      const dwd = {
        id: previous?.id || null,
        warehouseId: previous?.warehouseId || null,
        name: DWD_NAME,
        version: previous?.version || 0,
        layer: "DWD",
        layerLabel: "DWD 明细数据层",
        rowCount: rows.length,
        schema,
        rows,
        rowMeta,
        source: {
          fileName: App.sample.fileName,
          importedAt: source.source?.importedAt || new Date().toISOString(),
          rowCount: source.rows.length,
          pipeline: "ecommerce_fixed_sop_v1"
        },
        audit: [
          {
            operation: "standardize_types",
            label: "time 转标准日期，amount 转数值",
            affected: source.rows.length,
            operatedAt: new Date().toISOString()
          },
          {
            operation: "remove_dirty_rows",
            label: "剔除 user_id 或 time 无效记录",
            affected: removedDirtyRows,
            operatedAt: new Date().toISOString()
          },
          {
            operation: "derive_time_dimensions",
            label: "派生 date 与 hour",
            affected: rows.length,
            operatedAt: new Date().toISOString()
          }
        ],
        createdAt: previous?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      App.profiler.refreshDraftQuality(dwd);

      const existingDwd = App.warehouse.listTables()
        .find((table) => table.layer === "DWD" || table.name === DWD_NAME);
      if (existingDwd) {
        dwd.warehouseId = existingDwd.id;
      }
      const saved = App.warehouse.saveDraft(dwd, {
        name: DWD_NAME,
        mode: existingDwd ? "update" : "new"
      });
      const persisted = {
        ...saved.table,
        layer: "DWD",
        layerLabel: "DWD 明细数据层"
      };
      this.dwd = persisted;
      this.lastBuild = {
        sourceRows: source.rows.length,
        dwdRows: rows.length,
        removedDirtyRows,
        convertedAmounts,
        derivedHours,
        fieldKeys: schema.map((field) => field.key),
        builtAt: new Date().toISOString()
      };
      App.state.emit("dataWarehouse:changed", { layer: "DWD", table: persisted });
      if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
        global.dispatchEvent(new CustomEvent("dataWarehouse:changed", {
          detail: { layer: "DWD", table: persisted }
        }));
      }
      return this.lastBuild;
    },

    restore() {
      const dwdMeta = App.warehouse.listTables()
        .find((table) => table.layer === "DWD" || table.name === DWD_NAME);
      if (dwdMeta) {
        const table = App.warehouse.getTable(dwdMeta.id);
        if (table) {
          this.dwd = {
            ...table,
            layer: "DWD",
            layerLabel: "DWD 明细数据层"
          };
        }
      }
      const ads = App.storage.getJSON(ADS_STORAGE_KEY, []);
      this.ads = Array.isArray(ads) ? ads : [];
      return { dwd: this.dwd, ads: this.ads };
    },

    addAds(record) {
      if (!record || !record.id) {
        return null;
      }
      const adsRecord = {
        ...utils.clone(record),
        layer: "ADS",
        layerLabel: "ADS 应用数据层",
        resultTable: record.resultTable
          ? {
            ...utils.clone(record.resultTable),
            rows: (record.resultTable.rows || []).slice(0, 20)
          }
          : null,
        savedToAdsAt: new Date().toISOString()
      };
      this.ads = [
        adsRecord,
        ...this.ads.filter((item) => item.id !== adsRecord.id)
      ].slice(0, 20);
      App.storage.setJSON(ADS_STORAGE_KEY, this.ads);
      App.state.emit("ads:changed", adsRecord);
      if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
        global.dispatchEvent(new CustomEvent("ads:changed", { detail: adsRecord }));
      }
      return adsRecord;
    },

    getLayerForTable(table) {
      if (!table) {
        return "未知";
      }
      if (table.layer) {
        return table.layer;
      }
      if (table.id === this.dwd?.id) {
        return "DWD";
      }
      if (table.id === this.ods?.id) {
        return "ODS";
      }
      return "未知";
    }
  };

  layerWarehouse.restore();
  global.dataWarehouse = layerWarehouse;
})(window);
