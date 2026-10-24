(function bootstrapAiSql(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const common = App.ui;
  const SIGN_OFF = "以上由 AI 生成，需人工校验";

  const SQL_ASSISTANT_ROLE = `
你是「AI 数据分析工作台」中的 SQL 分析助手。
你只负责解释或改写用户提供的 SQL，不执行 SQL，不连接数据库，不声称已经运行查询。
你只能使用用户提供的 SQL、分析类型和数据表结构；不得编造字段、表名、数据值或行业基准。
输出必须简洁、专业，面向数据分析和运营场景。
所有输出结尾必须附：${SIGN_OFF}。
`.trim();

  const EXPLAIN_SYSTEM_PROMPT = `
${SQL_ASSISTANT_ROLE}

本次任务是解释 SQL。请严格输出以下三部分：
① 一句话说明这段 SQL 在算什么；
② 关键口径说明，包括去重方式、时间窗口、分母、聚合方式等；
③ 潜在问题或易错点，包括 NULL、口径不一致、时间函数和字段歧义。
不要输出改写后的 SQL。不得引用 SQL 和表结构中不存在的字段。
`.trim();

  const REVISE_SYSTEM_PROMPT = `
${SQL_ASSISTANT_ROLE}

本次任务是根据用户自然语言需求改写 SQL。
只返回两部分：
1. 一个完整的 \`\`\`sql 代码块；
2. 最后一行“改动说明：……；${SIGN_OFF}。”
如果需求不明确，不要猜测修改，只提出一个简洁的追问，并附结束语。
不要自动声称替换了原 SQL，不要执行 SQL，不得引用表结构中不存在的字段。
`.trim();

  function analysisLabel(type) {
    return {
      retention: "留存分析",
      funnel: "漏斗分析",
      rfm: "RFM 分层",
      descriptive: "描述统计",
      group: "分组对比",
      trend: "趋势分析",
      correlation: "相关性分析"
    }[type] || type || "未知分析";
  }

  function tableSchema(tableName) {
    const dwd = global.dataWarehouse?.dwd;
    if (dwd && dwd.name === tableName) {
      return dwd.schema.map((field) => ({
        name: field.key,
        type: field.type,
        role: field.role
      }));
    }
    const draft = App.state.get().draft;
    if (draft && draft.name === tableName) {
      return draft.schema.map((field) => ({
        name: field.key,
        type: field.type,
        role: field.role
      }));
    }
    const index = App.warehouse.listTables().find((table) => table.name === tableName);
    const table = index ? App.warehouse.getTable(index.id) : null;
    return table ? table.schema.map((field) => ({
      name: field.key,
      type: field.type,
      role: field.role
    })) : [];
  }

  function schemaText(fields) {
    return fields.length
      ? fields.map((field) => `- ${field.name} (${field.type}${field.role ? `，角色：${field.role}` : ""})`).join("\n")
      : "- 当前未找到可用的表结构；只能依据 SQL 本身解释，不得补充字段";
  }

  /**
   * 组装 SQL 解释请求。
   * 上下文只包含当前 SQL、分析类型和字段结构，不包含任何数据行。
   */
  function buildExplainMessages(analysisType, tableName, fields, sql) {
    return [
      { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
      {
        role: "user",
        content: `分析类型：${analysisLabel(analysisType)}
数据表：${tableName || "未命名"}
字段结构：
${schemaText(fields)}

待解释 SQL：
\`\`\`sql
${sql}
\`\`\`

请按①、②、③输出，不得编造 SQL 或字段结构中没有的内容。`
      }
    ];
  }

  /**
   * 组装 SQL 改写请求。
   * 用户需求与当前 SQL 一并提供，不传分析结果明细。
   */
  function buildReviseMessages(analysisType, tableName, fields, sql, requirement) {
    return [
      { role: "system", content: REVISE_SYSTEM_PROMPT },
      {
        role: "user",
        content: `分析类型：${analysisLabel(analysisType)}
数据表：${tableName || "未命名"}
字段结构：
${schemaText(fields)}

原 SQL：
\`\`\`sql
${sql}
\`\`\`

修改需求：${requirement}

如果需求不明确，请先追问，不要猜测修改。`
      }
    ];
  }

  function containerFor(target) {
    return target.closest("[data-ai-sql-actions]");
  }

  function currentSql(container) {
    const section = container.closest(".analysis-sql-section");
    const editor = section && section.querySelector(".analysis-sql-editor");
    return editor ? editor.value : "";
  }

  function contextFor(container) {
    const analysisType = container.dataset.sqlType || "";
    const tableName = container.dataset.sqlTableName || "";
    return {
      analysisType,
      tableName,
      fields: tableSchema(tableName),
      sql: currentSql(container)
    };
  }

  function resultArea(container) {
    let area = container.querySelector(".ai-sql-result");
    if (!area) {
      area = document.createElement("div");
      area.className = "ai-sql-result";
      area.hidden = true;
      container.appendChild(area);
    }
    return area;
  }

  function showLoading(container, title) {
    const area = resultArea(container);
    area.hidden = false;
    area.innerHTML = `
      <div class="ai-sql-result-head">
        <strong>${utils.escapeHtml(title)}</strong>
        <span class="ai-sql-loading"><span class="spinner"></span>正在生成…</span>
      </div>
      <div class="ai-sql-result-placeholder">AI 正在结合当前 SQL 和表结构进行分析，不会执行 SQL。</div>
    `;
    area.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return area;
  }

  function friendlyError(error) {
    if (error.code === "AI_CONFIG_REQUIRED") {
      return "请先在 AI 配置中填写 API Key，保存配置后重新点击。";
    }
    if (error.code === "AI_TIMEOUT") {
      return "请求超时，请检查网络后重试。";
    }
    if (error.status === 401 || error.status === 403) {
      return "API Key 无效或没有访问权限，请前往 AI 配置检查。";
    }
    return error.message || "AI 请求失败，请稍后重试。";
  }

  function showError(container, title, message) {
    const area = resultArea(container);
    area.hidden = false;
    area.innerHTML = `
      <div class="ai-sql-result-head">
        <strong>${utils.escapeHtml(title)}</strong>
        <button class="icon-button" type="button" data-ai-sql-close aria-label="关闭">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="notice danger ai-sql-error"><i data-lucide="triangle-alert" aria-hidden="true"></i><span>${utils.escapeHtml(message)}</span></div>
    `;
    common.refreshIcons(area);
  }

  function renderPlainReply(content) {
    return utils.escapeHtml(content)
      .replace(/^①\s*/gm, "<strong>① </strong>")
      .replace(/^②\s*/gm, "<strong>② </strong>")
      .replace(/^③\s*/gm, "<strong>③ </strong>")
      .replace(/\n/g, "<br>");
  }

  function showExplainResult(container, content) {
    const area = resultArea(container);
    area.hidden = false;
    area.innerHTML = `
      <div class="ai-sql-result-head">
        <strong>AI 解读建议</strong>
        <div>
          <button class="button button-secondary button-small" type="button" data-ai-sql-copy>复制</button>
          <button class="icon-button" type="button" data-ai-sql-close aria-label="关闭">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div class="ai-sql-text">${renderPlainReply(content)}</div>
      <div class="ai-sql-human-note">AI 建议需人工校验，原 SQL 未被修改。</div>
    `;
    area.dataset.copyText = content;
    common.refreshIcons(area);
  }

  function extractSuggestedSql(content) {
    const match = String(content || "").match(/```sql\s*([\s\S]*?)```/i)
      || String(content || "").match(/```\s*([\s\S]*?)```/i);
    return {
      sql: match ? match[1].trim() : "",
      full: String(content || "").trim(),
      explanation: String(content || "").replace(match ? match[0] : "", "").trim()
    };
  }

  function showReviseResult(container, content) {
    const parsed = extractSuggestedSql(content);
    const area = resultArea(container);
    area.hidden = false;
    const copyText = parsed.sql || parsed.full;
    area.innerHTML = `
      <div class="ai-sql-result-head">
        <strong>AI 改口径建议</strong>
        <div>
          <button class="button button-secondary button-small" type="button" data-ai-sql-copy>${parsed.sql ? "复制建议 SQL" : "复制答复"}</button>
          <button class="icon-button" type="button" data-ai-sql-close aria-label="关闭">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      ${parsed.sql
        ? `<pre class="ai-sql-suggestion"><code>${App.sql.highlightSQL(parsed.sql)}</code></pre>`
        : `<div class="ai-sql-text">${renderPlainReply(parsed.full)}</div>`}
      ${parsed.explanation ? `<div class="ai-sql-explanation">${utils.escapeHtml(parsed.explanation)}</div>` : ""}
      <div class="ai-sql-human-note">AI 建议需人工校验；未自动替换原 SQL。</div>
    `;
    area.dataset.copyText = copyText;
    common.refreshIcons(area);
  }

  async function runExplain(container) {
    const button = container.querySelector('[data-ai-sql-action="explain"]');
    const context = contextFor(container);
    if (!context.sql.trim()) {
      common.toast("当前没有可解释的 SQL。", "warning");
      return;
    }
    common.setButtonLoading(button, true, "正在解读…");
    showLoading(container, "AI 解读");
    try {
      const payload = await global.callDeepSeek(
        buildExplainMessages(context.analysisType, context.tableName, context.fields, context.sql),
        {
          stream: false,
          temperature: 0.15,
          maxTokens: 1600,
          timeoutMs: 90000
        }
      );
      const content = payload?.choices?.[0]?.message?.content;
      if (!content || !String(content).trim()) {
        throw new Error("AI 没有返回可展示的解读。");
      }
      showExplainResult(container, String(content).trim());
    } catch (error) {
      showError(container, "AI 解读", friendlyError(error));
    } finally {
      common.setButtonLoading(button, false);
    }
  }

  function showReviseInput(container) {
    let form = container.querySelector(".ai-sql-revise-form");
    if (!form) {
      form = document.createElement("div");
      form.className = "ai-sql-revise-form";
      form.innerHTML = `
        <label class="form-field">
          <span class="form-label">自然语言修改需求</span>
          <textarea class="textarea" placeholder="例如：把转化窗口改成14天"></textarea>
        </label>
        <div class="ai-sql-revise-meta">
          <span>Enter 发送，Shift + Enter 换行</span>
          <span class="ai-input-length-status" data-ai-sql-length-status hidden></span>
        </div>
        <div class="ai-sql-revise-actions">
          <button class="button button-primary button-small" type="button" data-ai-sql-submit>生成建议</button>
          <button class="button button-quiet button-small" type="button" data-ai-sql-cancel>取消</button>
        </div>
      `;
      container.appendChild(form);
    }
    form.hidden = false;
    form.querySelector("textarea").focus();
  }

  async function runRevise(container) {
    const form = container.querySelector(".ai-sql-revise-form");
    const requirement = form ? form.querySelector("textarea").value.trim() : "";
    if (!requirement) {
      common.toast("请先描述希望如何修改 SQL 口径。", "warning");
      return;
    }
    const submit = form.querySelector("[data-ai-sql-submit]");
    const context = contextFor(container);
    common.setButtonLoading(submit, true, "正在改写…");
    showLoading(container, "AI 改口径");
    try {
      const payload = await global.callDeepSeek(
        buildReviseMessages(context.analysisType, context.tableName, context.fields, context.sql, requirement),
        {
          stream: false,
          temperature: 0.15,
          maxTokens: 2200,
          timeoutMs: 90000
        }
      );
      const content = payload?.choices?.[0]?.message?.content;
      if (!content || !String(content).trim()) {
        throw new Error("AI 没有返回 SQL 修改建议。");
      }
      form.hidden = true;
      showReviseResult(container, String(content).trim());
    } catch (error) {
      showError(container, "AI 改口径", friendlyError(error));
    } finally {
      common.setButtonLoading(submit, false);
    }
  }

  function updateReviseLength(input) {
    const form = input.closest(".ai-sql-revise-form");
    const status = form && form.querySelector("[data-ai-sql-length-status]");
    if (!status) {
      return;
    }
    const length = input.value.length;
    if (!length) {
      status.hidden = true;
      status.textContent = "";
      status.classList.remove("warning");
      return;
    }
    status.hidden = false;
    status.classList.toggle("warning", length > 3000);
    status.textContent = length > 3000
      ? `${length} 字 · 内容较长，注意 AI Token 限制`
      : `${length} 字`;
  }

  async function copyResult(container, button) {
    const area = container.querySelector(".ai-sql-result");
    const text = area ? area.dataset.copyText || "" : "";
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    common.toast("AI 建议已复制。", "success");
  }

  function handleClick(event) {
    const expand = event.target.closest("[data-expand-sql]");
    if (expand) {
      openSqlModal(expand.closest(".analysis-sql-section"));
      return;
    }
    const actionButton = event.target.closest("[data-ai-sql-action]");
    if (actionButton) {
      const container = containerFor(actionButton);
      if (actionButton.dataset.aiSqlAction === "explain") {
        runExplain(container);
      } else if (actionButton.dataset.aiSqlAction === "revise") {
        showReviseInput(container);
      }
      return;
    }
    const submit = event.target.closest("[data-ai-sql-submit]");
    if (submit) {
      runRevise(containerFor(submit));
      return;
    }
    const cancel = event.target.closest("[data-ai-sql-cancel]");
    if (cancel) {
      const form = cancel.closest(".ai-sql-revise-form");
      form.hidden = true;
      return;
    }
    const copy = event.target.closest("[data-ai-sql-copy]");
    if (copy) {
      copyResult(containerFor(copy), copy);
      return;
    }
    const close = event.target.closest("[data-ai-sql-close]");
    if (close) {
      const area = close.closest(".ai-sql-result");
      area.hidden = true;
      area.innerHTML = "";
      return;
    }
    const modalClose = event.target.closest("[data-close-sql-modal]");
    if (modalClose) {
      modalClose.closest(".analysis-sql-modal").close();
    }
  }

  function handleKeydown(event) {
    const input = event.target.closest(".ai-sql-revise-form textarea");
    if (!input) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      runRevise(containerFor(input));
    }
  }

  function handleInput(event) {
    const input = event.target.closest(".ai-sql-revise-form textarea");
    if (input) {
      updateReviseLength(input);
    }
  }

  /**
   * 打开全量 SQL 编辑器。编辑内容实时同步回原 textarea，
   * 不提供执行入口，也不影响 SQL 下方的 AI 操作区。
   */
  function openSqlModal(section) {
    const sourceEditor = section && section.querySelector(".analysis-sql-editor");
    if (!sourceEditor) {
      return;
    }
    const existing = document.querySelector(".analysis-sql-modal");
    if (existing) {
      existing.remove();
    }
    const dialog = document.createElement("dialog");
    dialog.className = "analysis-sql-modal";
    dialog.innerHTML = `
      <div class="analysis-sql-modal-shell">
        <div class="analysis-sql-modal-header">
          <div>
            <strong>编辑等价 SQL</strong>
            <span>编辑内容会同步回原区域；不会执行 SQL</span>
          </div>
          <button class="analysis-sql-modal-close" type="button" data-close-sql-modal aria-label="关闭 SQL 编辑">×</button>
        </div>
        <textarea class="analysis-sql-modal-editor" spellcheck="false" aria-label="完整 SQL 编辑器"></textarea>
        <div class="analysis-sql-modal-footer">演示版不执行自定义 SQL。关闭后继续使用原 SQL 下方的 AI 辅助操作。</div>
      </div>
    `;
    document.body.appendChild(dialog);
    const editor = dialog.querySelector(".analysis-sql-modal-editor");
    editor.value = sourceEditor.value;
    editor.addEventListener("input", () => {
      sourceEditor.value = editor.value;
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }

  function enhance(container) {
    if (container.dataset.aiSqlReady === "true") {
      return;
    }
    container.dataset.aiSqlReady = "true";
    container.insertAdjacentHTML("afterbegin", `
      <div class="ai-sql-action-row">
        <button class="button button-secondary button-small" type="button" data-ai-sql-action="explain">
          <i data-lucide="message-square-text" aria-hidden="true"></i>AI 解读
        </button>
        <button class="button button-secondary button-small" type="button" data-ai-sql-action="revise">
          <i data-lucide="wand-sparkles" aria-hidden="true"></i>AI 改口径
        </button>
        <span>AI 建议需人工校验</span>
      </div>
    `);
    common.refreshIcons(container);
  }

  function enhanceAll() {
    document.querySelectorAll("[data-ai-sql-actions]").forEach(enhance);
  }

  let enhanceFrame = null;
  function scheduleEnhance() {
    if (enhanceFrame !== null) {
      return;
    }
    enhanceFrame = requestAnimationFrame(() => {
      enhanceFrame = null;
      enhanceAll();
    });
  }

  function init() {
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("input", handleInput);
    enhanceAll();
    const observer = new MutationObserver(scheduleEnhance);
    observer.observe(document.body, { childList: true, subtree: true });
    common.refreshIcons(document);
  }

  App.aiSql = {
    init,
    buildExplainMessages,
    buildReviseMessages,
    EXPLAIN_SYSTEM_PROMPT,
    REVISE_SYSTEM_PROMPT
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }
})(window);
