(function bootstrapGlobalAiAssistant(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const common = App.ui;
  const GLOBAL_SESSION_KEY = "__global_assistant__";
  const DISCLAIMER = "以上由 AI 生成，仅供参考。";
  const MAX_RESULT_CONTEXT = 5;
  let root = null;
  let session = null;
  let assistantContext = null;
  let streaming = false;
  let activeController = null;
  let timeoutTimer = null;
  let timedOut = false;

  function init() {
    if (root) {
      return;
    }
    document.body.insertAdjacentHTML("beforeend", assistantTemplate());
    root = document.getElementById("global-ai-assistant");
    session = App.ai.chatStore.ensure(GLOBAL_SESSION_KEY, "全局 AI 助手");
    bindEvents();
    refreshContext();
    renderMessages();
    common.refreshIcons(root);
  }

  function assistantTemplate() {
    return `
      <div id="global-ai-assistant" class="assistant-root">
        <section class="assistant-panel" id="assistant-panel" aria-label="全局 AI 数据分析助手" hidden>
          <header class="assistant-header">
            <div class="assistant-brand">
              <div class="assistant-brand-icon"><i data-lucide="sparkles" aria-hidden="true"></i></div>
              <div>
                <strong>InsightFlow AI</strong>
                <span>数据工作台助手</span>
              </div>
            </div>
            <div class="assistant-header-actions">
              <button class="icon-button" type="button" data-ai-config-open aria-label="打开 AI 配置">
                <i data-lucide="settings" aria-hidden="true"></i>
              </button>
              <button class="icon-button" id="assistant-clear-button" type="button" aria-label="清空对话">
                <i data-lucide="trash-2" aria-hidden="true"></i>
              </button>
              <button class="icon-button" id="assistant-close-button" type="button" aria-label="收起助手">
                <i data-lucide="x" aria-hidden="true"></i>
              </button>
            </div>
          </header>

          <div class="assistant-context-strip" id="assistant-context-strip">
            <span class="assistant-context-dot"></span>
            <span>正在读取当前工作台上下文…</span>
          </div>

          <div class="assistant-messages" id="assistant-messages" aria-live="polite"></div>

          <div class="assistant-composer">
            <div class="assistant-input-shell">
              <textarea id="assistant-question" rows="3" placeholder="基于当前表和分析结果提问…"></textarea>
              <div class="assistant-input-footer">
                <span>Enter 发送，Shift + Enter 换行</span>
                <span class="ai-input-length-status" id="assistant-length-status" hidden></span>
                <div>
                  <button class="icon-button assistant-stop-button" id="assistant-stop-button" type="button" aria-label="停止生成" hidden>
                    <i data-lucide="square" aria-hidden="true"></i>
                  </button>
                  <button class="assistant-send-button" id="assistant-send-button" type="button" aria-label="发送问题">
                    <i data-lucide="arrow-up" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
            </div>
            <p>只发送字段摘要与分析指标，不发送用户明细。</p>
          </div>
        </section>

        <button class="assistant-fab" id="assistant-fab" type="button" aria-label="打开 AI 数据分析助手" aria-expanded="false">
          <i data-lucide="sparkles" aria-hidden="true"></i>
          <span class="assistant-fab-dot" aria-hidden="true"></span>
        </button>
      </div>
    `;
  }

  function bindEvents() {
    root.addEventListener("click", handleClick);
    root.addEventListener("input", handleInput);
    root.addEventListener("keydown", handleKeydown);

    App.state.subscribe("route:changed", () => {
      refreshContext();
    });
    App.state.subscribe("draft:changed", () => {
      refreshContext();
    });
    App.state.subscribe("draft:restored", () => {
      refreshContext();
    });
    App.state.subscribe("warehouse:changed", () => {
      refreshContext();
    });
    App.state.subscribe("dataWarehouse:changed", () => {
      refreshContext();
    });
    App.state.subscribe("analysis:run", () => {
      refreshContext();
    });
    App.state.subscribe("assistant:context-changed", () => {
      refreshContext();
    });
  }

  function handleClick(event) {
    const target = event.target.closest("button");
    if (!target) {
      return;
    }
    if (target.id === "assistant-fab") {
      togglePanel();
      return;
    }
    if (target.id === "assistant-close-button") {
      setPanelOpen(false);
      return;
    }
    if (target.id === "assistant-clear-button") {
      clearConversation();
      return;
    }
    if (target.id === "assistant-send-button") {
      sendQuestion();
      return;
    }
    if (target.id === "assistant-stop-button") {
      stopStreaming();
      return;
    }
    if (target.dataset.assistantSuggestion) {
      const input = document.getElementById("assistant-question");
      input.value = target.dataset.assistantSuggestion;
      input.focus();
      updateComposerState();
    }
  }

  function handleInput(event) {
    if (event.target.id === "assistant-question") {
      updateComposerState();
    }
  }

  function handleKeydown(event) {
    if (event.target.id === "assistant-question" && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!streaming) {
        sendQuestion();
      }
    }
  }

  function togglePanel() {
    setPanelOpen(document.getElementById("assistant-panel").hidden);
  }

  function setPanelOpen(open) {
    const panel = document.getElementById("assistant-panel");
    const fab = document.getElementById("assistant-fab");
    panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    fab.setAttribute("aria-label", open ? "收起 AI 数据分析助手" : "打开 AI 数据分析助手");
    if (open) {
      refreshContext();
      renderMessages();
      global.setTimeout(() => document.getElementById("assistant-question").focus(), 60);
    }
    common.refreshIcons(root);
  }

  function resolveCurrentTable() {
    const route = App.state.get().currentRoute;
    if (route === "analysis" && App.ui.analysisView) {
      return App.ui.analysisView.getSelectedTable() || global.dataWarehouse?.dwd || null;
    }
    if (route === "report" && App.ui.reportView) {
      return App.ui.reportView.getSelectedTable() || global.dataWarehouse?.dwd || null;
    }
    if (route === "history") {
      return global.dataWarehouse?.dwd || global.dataWarehouse?.ods || null;
    }
    return global.dataWarehouse?.dwd || global.dataWarehouse?.ods || null;
  }

  function analysisTypeLabel(type) {
    const labels = {
      retention: "留存分析",
      funnel: "漏斗分析",
      rfm: "RFM 分层",
      descriptive: "描述统计",
      group: "分组对比",
      trend: "趋势分析",
      correlation: "相关性分析"
    };
    return labels[type] || type;
  }

  /**
   * 组装悬浮助手的全局上下文。
   * 只保留表结构、近期分析配置、指标摘要和当前模块，不传递任何明细行，
   * 用于控制 Prompt 体积并避免用户级数据进入模型请求。
   */
  function buildAssistantContext() {
    const table = resolveCurrentTable();
    const route = App.state.get().currentRoute;
    const moduleMeta = App.constants.routeMeta[route] || { title: route };
    const allAnalyses = App.ai.contextBuilder.getAnalyses();
    const tableAnalyses = allAnalyses.filter((analysis) => {
      return table && analysis.tableId && analysis.tableId === table.id;
    });
    const recentAnalyses = tableAnalyses.slice(-MAX_RESULT_CONTEXT).map((analysis) => ({
      type: analysis.type,
      typeLabel: analysisTypeLabel(analysis.type),
      title: analysis.title,
      tableName: analysis.tableName,
      tableVersion: analysis.tableVersion,
      config: (analysis.configSummary || []).map((item) => `${item.label}：${item.value}`),
      keyResults: (analysis.metrics || []).slice(0, 5).map((metric) => ({
        label: metric.label,
        value: metric.formatted,
        definition: metric.definition
      })),
      warnings: (analysis.warnings || []).slice(0, 3)
    }));
    const summaryEntries = tableAnalyses.map((analysis, index) => {
      const previous = tableAnalyses.slice(0, index).reverse()
        .find((item) => item.type === analysis.type) || null;
      return {
        type: analysis.type,
        tableId: analysis.tableId,
        recordId: analysis.id,
        title: analysis.title,
        createdAt: analysis.createdAt,
        summary: global.AI_ASSISTANT_CORE.buildAnalysisSummary(
          analysis.type,
          analysis.config || {},
          analysis,
          previous
        )
      };
    });
    const fields = table ? table.schema.map((field) => {
      const rawRate = Number(field.missingRate || 0);
      const missingRate = Number(((rawRate <= 1 ? rawRate * 100 : rawRate)).toFixed(1));
      return {
        name: field.key,
        type: field.type,
        role: field.role,
        missingRate
      };
    }) : [];
    const moduleName = moduleMeta.title || route;
    const dataLayer = table?.layer || (table ? global.dataWarehouse?.getLayerForTable(table) : "未知");
    const context = {
      generatedAt: new Date().toISOString(),
      tableName: table ? table.name : null,
      rowCount: table ? table.rows.length : 0,
      fields,
      analyses: global.AI_ASSISTANT_CORE.trimAnalysisSummaries(summaryEntries),
      dataLayer,
      currentModule: moduleName,
      currentModuleKey: route,
      currentTable: table ? {
        name: table.name,
        layer: dataLayer,
        version: table.version || null,
        rowCount: table.rows.length,
        qualityScore: table.quality ? table.quality.score : null,
        fields: fields.map((field) => ({
          key: field.name,
          type: field.type,
          role: field.role,
          missingRate: field.missingRate
        }))
      } : null,
      recentAnalyses
    };
    context.characterEstimate = JSON.stringify(context).length;
    if (global.AI_ASSISTANT_CONTEXT) {
      Object.assign(global.AI_ASSISTANT_CONTEXT, context);
    }
    return context;
  }

  function refreshContext() {
    if (!root) {
      return;
    }
    assistantContext = buildAssistantContext();
    const strip = document.getElementById("assistant-context-strip");
    if (!strip) {
      return;
    }
    if (!assistantContext.currentTable) {
      strip.innerHTML = `
        <span class="assistant-context-dot"></span>
        <span>${utils.escapeHtml(assistantContext.currentModule)} · 尚未选择数据表</span>
      `;
      return;
    }
    strip.innerHTML = `
      <span class="assistant-context-dot"></span>
      <span title="${utils.escapeHtml(assistantContext.recentAnalyses.map((item) => item.title).join("、"))}">
        ${utils.escapeHtml(assistantContext.currentModule)}
        · ${utils.escapeHtml(assistantContext.currentTable.name)}
        · ${utils.escapeHtml(assistantContext.dataLayer)}
        · ${assistantContext.currentTable.fields.length} 字段
        · ${assistantContext.recentAnalyses.length} 条近期分析
      </span>
    `;
  }

  function welcomeMarkup() {
    const suggestions = [
      "当前最值得关注的分析结论是什么？",
      "帮我解释最近一次留存分析的曲线。",
      "当前分析有哪些样本或口径风险？",
      "根据现有结果，下一步建议做什么？"
    ];
    return `
      <div class="assistant-welcome">
        <div class="assistant-welcome-icon"><i data-lucide="sparkles" aria-hidden="true"></i></div>
        <strong>随时基于当前工作台提问</strong>
        <span>我会感知当前模块、选中数据表和最近分析结果。</span>
        <div class="assistant-suggestions">
          ${suggestions.map((question) => `
            <button type="button" data-assistant-suggestion="${utils.escapeHtml(question)}">${utils.escapeHtml(question)}</button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderInlineMarkdown(value) {
    return utils.escapeHtml(value)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  function renderMarkdown(markdown) {
    const source = String(markdown || "").replace(/\r\n/g, "\n");
    if (!source.trim()) {
      return "";
    }
    const lines = source.split("\n");
    const output = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index += 1;
        continue;
      }
      if (/^#{1,4}\s+/.test(line)) {
        const level = Math.min(4, line.match(/^#+/)[0].length);
        output.push(`<h${level}>${renderInlineMarkdown(line.replace(/^#{1,4}\s+/, ""))}</h${level}>`);
        index += 1;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
          items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*[-*]\s+/, ""))}</li>`);
          index += 1;
        }
        output.push(`<ul>${items.join("")}</ul>`);
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
          items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
          index += 1;
        }
        output.push(`<ol>${items.join("")}</ol>`);
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        const quotes = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
          quotes.push(renderInlineMarkdown(lines[index].replace(/^\s*>\s?/, "")));
          index += 1;
        }
        output.push(`<blockquote>${quotes.join("<br>")}</blockquote>`);
        continue;
      }
      const paragraph = [line];
      index += 1;
      while (index < lines.length && lines[index].trim() && !/^#{1,4}\s+|^\s*[-*]\s+|^\s*\d+[.)]\s+|^\s*>\s?/.test(lines[index])) {
        paragraph.push(lines[index]);
        index += 1;
      }
      output.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
    }
    return output.join("");
  }

  function messagesMarkup() {
    const messages = session.messages || [];
    if (!messages.length) {
      return welcomeMarkup();
    }
    return messages.map((message) => `
      <article class="assistant-message ${message.role} ${message.error ? "error" : ""}" data-assistant-message-id="${utils.escapeHtml(message.id)}">
        <div class="assistant-message-avatar">${message.role === "user" ? "你" : "AI"}</div>
        <div class="assistant-message-body">
          <div class="assistant-message-content">
            ${message.role === "assistant" ? renderMarkdown(message.content) : utils.escapeHtml(message.content).replace(/\n/g, "<br>")}
            ${message.streaming ? '<span class="assistant-streaming-cursor"></span>' : ""}
          </div>
          ${message.error ? `<div class="assistant-message-error">${utils.escapeHtml(message.error)}</div>` : ""}
        </div>
      </article>
    `).join("");
  }

  function renderMessages() {
    const container = document.getElementById("assistant-messages");
    if (!container || !session) {
      return;
    }
    container.innerHTML = messagesMarkup();
    common.refreshIcons(container);
    container.scrollTop = container.scrollHeight;
  }

  function updateStreamingMessage(message) {
    const container = document.getElementById("assistant-messages");
    const element = container.querySelector(`[data-assistant-message-id="${CSS.escape(message.id)}"] .assistant-message-content`);
    if (!element) {
      renderMessages();
      return;
    }
    element.innerHTML = `${renderMarkdown(message.content)}${message.streaming ? '<span class="assistant-streaming-cursor"></span>' : ""}`;
    container.scrollTop = container.scrollHeight;
  }

  function saveSession() {
    // 会话对象本身继续作为流式消息的可变引用，避免增量内容被深拷贝覆盖。
    return App.ai.chatStore.save(session);
  }

  function updateComposerState() {
    const input = document.getElementById("assistant-question");
    const send = document.getElementById("assistant-send-button");
    updateLengthStatus(input, document.getElementById("assistant-length-status"));
    send.disabled = streaming || !input.value.trim();
  }

  function updateLengthStatus(input, status) {
    if (!input || !status) {
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

  function setStreamingState(value) {
    streaming = value;
    const input = document.getElementById("assistant-question");
    const send = document.getElementById("assistant-send-button");
    const stop = document.getElementById("assistant-stop-button");
    input.disabled = value;
    stop.hidden = !value;
    send.innerHTML = value
      ? '<span class="assistant-mini-spinner" aria-hidden="true"></span>'
      : '<i data-lucide="arrow-up" aria-hidden="true"></i>';
    common.refreshIcons(send);
    updateComposerState();
  }

  function friendlyError(error) {
    const message = String(error.message || error);
    if (timedOut) {
      return "回答超时，请检查网络连接或稍后重试。";
    }
    if (/401|403|invalid|authentication|api key/i.test(message)) {
      return "DeepSeek API Key 无效或没有访问权限，请检查 Key 后重试。";
    }
    if (/cors|failed to fetch|network|网络/i.test(message)) {
      return "网络连接失败或浏览器 CORS 限制阻止了请求，请检查网络后重试。";
    }
    if (error.name === "AbortError") {
      return "已停止生成。";
    }
    return message || "AI 助手暂时无法回答，请稍后重试。";
  }

  async function sendQuestion() {
    if (streaming) {
      return;
    }
    const input = document.getElementById("assistant-question");
    const question = input.value.trim();
    if (!question) {
      return;
    }
    refreshContext();
    const previousMessages = session.messages.slice();
    const userMessage = {
      id: utils.uid("assistant_msg"),
      role: "user",
      content: question,
      createdAt: new Date().toISOString()
    };
    const assistantMessage = {
      id: utils.uid("assistant_msg"),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true
    };
    session.messages.push(userMessage, assistantMessage);
    saveSession();
    input.value = "";
    renderMessages();
    setStreamingState(true);
    timedOut = false;
    activeController = new AbortController();
    timeoutTimer = global.setTimeout(() => {
      timedOut = true;
      activeController.abort();
    }, 90000);

    try {
      const previousHistory = previousMessages
        .filter((message) => ["user", "assistant"].includes(message.role))
        .filter((message) => message.content && !message.streaming)
        .slice(-10)
        .map((message) => ({ role: message.role, content: String(message.content) }));
      const messages = global.AI_ASSISTANT_CORE.buildMessages(
        question,
        assistantContext,
        previousHistory
      );
      const answer = await global.callDeepSeek(messages, {
        stream: true,
        signal: activeController.signal,
        temperature: 0.25,
        maxTokens: 2200,
        timeoutMs: 90000,
        onDelta: (delta, content) => {
          assistantMessage.content = content;
          updateStreamingMessage(assistantMessage);
        }
      });
      let finalContent = answer.content.trim();
      if (!finalContent.includes(DISCLAIMER)) {
        finalContent = `${finalContent}\n\n${DISCLAIMER}`;
      }
      assistantMessage.content = finalContent;
      assistantMessage.streaming = false;
      assistantMessage.usage = answer.usage;
      saveSession();
      renderMessages();
    } catch (error) {
      assistantMessage.streaming = false;
      assistantMessage.error = friendlyError(error);
      if (!assistantMessage.content) {
        assistantMessage.content = assistantMessage.error;
      }
      saveSession();
      renderMessages();
    } finally {
      global.clearTimeout(timeoutTimer);
      timeoutTimer = null;
      activeController = null;
      setStreamingState(false);
      refreshContext();
      input.focus();
    }
  }

  function stopStreaming() {
    if (activeController) {
      activeController.abort();
    }
  }

  async function clearConversation() {
    if (streaming) {
      common.toast("请先停止当前回答。", "warning");
      return;
    }
    const proceed = await common.confirm({
      title: "清空全局助手对话？",
      message: "当前助手的消息历史会从本浏览器删除，数据表、分析记录和报告不受影响。",
      confirmText: "清空对话",
      danger: true
    });
    if (!proceed) {
      return;
    }
    App.ai.chatStore.clear(GLOBAL_SESSION_KEY);
    session = App.ai.chatStore.ensure(GLOBAL_SESSION_KEY, "全局 AI 助手");
    renderMessages();
    common.toast("助手对话已清空。", "success");
  }

  App.ai.assistant = {
    init,
    open: () => setPanelOpen(true),
    close: () => setPanelOpen(false),
    getContext: () => assistantContext ? utils.clone(assistantContext) : null,
    buildContext: buildAssistantContext,
    systemPrompt: () => global.AI_ASSISTANT_CORE.SYSTEM_PROMPT,
    isStreaming: () => streaming
  };
})(window);
