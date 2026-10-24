(function bootstrapAIConfig(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const STORAGE_KEY = "ai_config";
  const DEFAULT_MODEL = "deepseek-chat";
  const DEFAULT_BASE_URL = "https://api.deepseek.com";
  const SECURITY_NOTE = "API Key 仅保存在本地浏览器，仅供演示使用；生产环境应通过后端代理调用。";
  let configDialog = null;
  let initialized = false;

  function normalizeBaseUrl(value) {
    return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
  }

  function normalizeConfig(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const apiKey = String(value.apiKey || "").trim();
    if (!apiKey) {
      return null;
    }
    return {
      apiKey,
      model: value.model === "deepseek-reasoner" ? "deepseek-reasoner" : DEFAULT_MODEL,
      baseUrl: normalizeBaseUrl(value.baseUrl)
    };
  }

  function getAIConfig() {
    try {
      return normalizeConfig(JSON.parse(global.localStorage.getItem(STORAGE_KEY) || "null"));
    } catch (error) {
      return null;
    }
  }

  function saveAIConfig(config) {
    const normalized = normalizeConfig(config);
    if (!normalized) {
      throw new Error("请填写 API Key。");
    }
    global.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    updateConfigIndicator();
    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new CustomEvent("ai-config-changed", { detail: normalized }));
    }
    return normalized;
  }

  function clearAIConfig() {
    global.localStorage.removeItem(STORAGE_KEY);
    updateConfigIndicator();
    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new CustomEvent("ai-config-changed", { detail: null }));
    }
  }

  function endpointFor(baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl);
    return /\/chat\/completions$/i.test(normalized)
      ? normalized
      : `${normalized}/chat/completions`;
  }

  function createRequiredError() {
    const error = new Error("请先在 AI 配置中填写 API Key");
    error.code = "AI_CONFIG_REQUIRED";
    return error;
  }

  function extractErrorMessage(payload, status) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : `HTTP ${status}`;
    if (status === 401 || status === 403) {
      return "API Key 无效或没有访问权限。";
    }
    if (status === 404) {
      return "接口地址不存在，请检查 Base URL。";
    }
    if (status === 429) {
      return "请求过于频繁或额度不足，请稍后重试。";
    }
    return message;
  }

  async function requestDeepSeek(config, messages, options) {
    const settings = options || {};
    if (!Array.isArray(messages) || !messages.length) {
      throw new Error("AI 请求缺少 messages。");
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = global.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, settings.timeoutMs || 90000);

    if (settings.signal) {
      if (settings.signal.aborted) {
        controller.abort();
      } else {
        settings.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }

    const stream = Boolean(settings.stream);
    const body = {
      model: settings.model || config.model || DEFAULT_MODEL,
      messages,
      stream,
      temperature: settings.temperature ?? 0.25,
      max_tokens: settings.maxTokens || 2200
    };
    if (settings.responseFormat) {
      body.response_format = settings.responseFormat;
    }

    let response;
    try {
      response = await fetch(endpointFor(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": stream ? "text/event-stream" : "application/json",
          "Authorization": `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      global.clearTimeout(timer);
      if (timedOut) {
        const timeoutError = new Error("AI 请求超时，请检查网络后重试。");
        timeoutError.code = "AI_TIMEOUT";
        throw timeoutError;
      }
      if (error.name === "AbortError") {
        const aborted = new Error("AI 请求已停止。");
        aborted.name = "AbortError";
        throw aborted;
      }
      throw new Error("AI 请求失败，可能是网络错误或浏览器 CORS 限制。");
    }

    if (!response.ok) {
      global.clearTimeout(timer);
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        // 错误状态已经足以提示用户。
      }
      const requestError = new Error(extractErrorMessage(payload, response.status));
      requestError.status = response.status;
      throw requestError;
    }

    if (!stream) {
      global.clearTimeout(timer);
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error("AI 返回了非 JSON 响应。");
      }
      return payload;
    }

    if (!response.body || typeof response.body.getReader !== "function") {
      global.clearTimeout(timer);
      throw new Error("当前浏览器不支持流式响应读取。");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let content = "";
    let usage = null;
    let finished = false;

    function processLine(line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        return;
      }
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        finished = data === "[DONE]";
        return;
      }
      let payload;
      try {
        payload = JSON.parse(data);
      } catch (error) {
        return;
      }
      if (payload.error) {
        throw new Error(payload.error.message || "AI 流式响应出错。");
      }
      if (payload.usage) {
        usage = payload.usage;
      }
      const delta = payload.choices?.[0]?.delta?.content;
      if (delta) {
        content += delta;
        if (typeof settings.onDelta === "function") {
          settings.onDelta(delta, content);
        }
      }
    }

    try {
      while (!finished) {
        const result = await reader.read();
        if (result.done) {
          break;
        }
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        lines.forEach(processLine);
      }
      buffer += decoder.decode();
      if (buffer.trim()) {
        processLine(buffer);
      }
    } catch (error) {
      if (timedOut) {
        const timeoutError = new Error("AI 请求超时，请检查网络后重试。");
        timeoutError.code = "AI_TIMEOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      global.clearTimeout(timer);
      reader.releaseLock();
    }
    if (!content.trim()) {
      throw new Error("AI 没有返回可展示的内容。");
    }
    return {
      content,
      usage,
      model: body.model
    };
  }

  /**
   * 所有 AI 功能统一调用入口。
   * 从 ai_config 读取 Key、模型和 Base URL；缺少配置时自动打开设置面板。
   */
  async function callDeepSeek(messages, options) {
    const config = getAIConfig();
    if (!config) {
      if (typeof document !== "undefined") {
        openAIConfig({ required: true });
      }
      throw createRequiredError();
    }
    return requestDeepSeek(config, messages, options || {});
  }

  async function testConnection(config) {
    const normalized = normalizeConfig(config);
    if (!normalized) {
      throw new Error("请填写 API Key。");
    }
    if (!/^https?:\/\//i.test(normalized.baseUrl)) {
      throw new Error("Base URL 必须以 http:// 或 https:// 开头。");
    }
    const payload = await requestDeepSeek(
      normalized,
      [{ role: "user", content: "hi" }],
      {
        stream: false,
        maxTokens: 8,
        temperature: 0,
        timeoutMs: 30000
      }
    );
    if (!payload || !Array.isArray(payload.choices) || !payload.choices.length) {
      throw new Error("接口已响应，但返回结构不符合 DeepSeek 规范。");
    }
    return payload;
  }

  function injectStyles() {
    if (document.getElementById("ai-config-styles")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "ai-config-styles";
    style.textContent = `
      .ai-config-nav .nav-item { width: 100%; }
      .ai-config-nav .ai-config-state { width: 7px; height: 7px; margin-left: auto; border-radius: 50%; background: #7a9186; }
      .ai-config-nav .ai-config-state.configured { background: #71cfa4; box-shadow: 0 0 0 3px rgba(113,207,164,.12); }
      .ai-config-dialog { width: min(520px, calc(100vw - 28px)); }
      .ai-config-body { display: grid; gap: 14px; padding: 18px 19px; }
      .ai-config-password { display: grid; grid-template-columns: minmax(0,1fr) 34px; gap: 6px; }
      .ai-config-password .button { min-width: 34px; padding: 0; }
      .ai-config-security { padding: 9px 10px; border-radius: 7px; color: #75827d; background: #f2f6f4; font-size: 9px; line-height: 1.55; }
      .ai-config-test-row { display: flex; align-items: center; gap: 8px; }
      .ai-config-test-result { color: #5f7069; font-size: 9px; }
      .ai-config-test-result.success { color: #176b4d; }
      .ai-config-test-result.error { color: #a33c37; }
      @media (max-width: 860px) {
        .ai-config-nav .nav-item { min-width: max-content; }
        .ai-config-nav .nav-section-toggle { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectEntry() {
    if (document.getElementById("ai-config-entry")) {
      return;
    }
    const nav = document.querySelector(".side-nav");
    if (!nav) {
      return;
    }
    const section = document.createElement("section");
    section.id = "ai-config-entry";
    section.className = "nav-section ai-config-nav";
    section.innerHTML = `
      <button class="nav-section-toggle" type="button" aria-expanded="true">
        <span>系统设置</span><i data-lucide="chevron-down" aria-hidden="true"></i>
      </button>
      <div class="nav-section-items">
        <button class="nav-item" type="button" data-ai-config-open>
          <i data-lucide="settings" aria-hidden="true"></i><span>AI 配置</span>
          <span class="ai-config-state" aria-hidden="true"></span>
        </button>
      </div>
    `;
    nav.appendChild(section);
    App.ui?.refreshIcons(section);
    updateConfigIndicator();
  }

  function updateConfigIndicator() {
    if (typeof document === "undefined") {
      return;
    }
    const state = document.querySelector("#ai-config-entry .ai-config-state");
    if (state) {
      state.classList.toggle("configured", Boolean(getAIConfig()));
      state.title = getAIConfig() ? "AI 已配置" : "AI 未配置";
    }
  }

  function openAIConfig(options) {
    const existing = document.getElementById("ai-config-dialog");
    if (existing) {
      existing.remove();
    }
    const current = getAIConfig();
    const required = Boolean(options && options.required);
    const dialog = document.createElement("dialog");
    dialog.id = "ai-config-dialog";
    dialog.className = "modal ai-config-dialog";
    dialog.innerHTML = `
      <div class="modal-header">
        <div>
          <h3>AI 配置中心</h3>
          <p>统一管理报告生成与全局 AI 助手使用的 DeepSeek 配置。</p>
        </div>
        <button class="icon-button" type="button" data-ai-config-close aria-label="关闭">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
      <div class="ai-config-body">
        ${required ? `<div class="notice warning"><i data-lucide="triangle-alert" aria-hidden="true"></i><span>请先在 AI 配置中填写 API Key</span></div>` : ""}
        <label class="form-field">
          <span class="form-label">API Key <b>*</b></span>
          <div class="ai-config-password">
            <input class="input" id="ai-config-api-key" type="password" autocomplete="off" placeholder="输入本地 API Key（不会提交到仓库）" value="${escapeAttribute(current?.apiKey || "")}">
            <button class="button button-secondary" id="toggle-ai-key-visibility" type="button" aria-label="显示或隐藏 API Key">
              <i data-lucide="eye" aria-hidden="true"></i>
            </button>
          </div>
        </label>
        <label class="form-field">
          <span class="form-label">模型</span>
          <select class="select" id="ai-config-model">
            <option value="deepseek-chat" ${!current || current.model === "deepseek-chat" ? "selected" : ""}>deepseek-chat</option>
            <option value="deepseek-reasoner" ${current?.model === "deepseek-reasoner" ? "selected" : ""}>deepseek-reasoner</option>
          </select>
        </label>
        <label class="form-field">
          <span class="form-label">Base URL</span>
          <input class="input" id="ai-config-base-url" type="url" value="${escapeAttribute(current?.baseUrl || DEFAULT_BASE_URL)}" placeholder="${DEFAULT_BASE_URL}">
          <span class="form-hint">留空使用默认地址；兼容自定义代理时填写代理根地址。</span>
        </label>
        <div class="ai-config-test-row">
          <button class="button button-secondary" id="test-ai-config" type="button">
            <i data-lucide="plug-zap" aria-hidden="true"></i>测试连接
          </button>
          <span class="ai-config-test-result" id="ai-config-test-result"></span>
        </div>
        <div class="ai-config-security">${SECURITY_NOTE}</div>
      </div>
      <div class="modal-footer">
        <button class="button button-danger" id="clear-ai-config" type="button">清除配置</button>
        <button class="button button-secondary" type="button" data-ai-config-close>取消</button>
        <button class="button button-primary" id="save-ai-config" type="button">保存</button>
      </div>
    `;
    document.body.appendChild(dialog);
    configDialog = dialog;
    App.ui?.refreshIcons(dialog);
    bindDialogEvents(dialog);
    dialog.showModal();
    global.setTimeout(() => document.getElementById("ai-config-api-key")?.focus(), 40);
    return dialog;
  }

  function readFormConfig() {
    return {
      apiKey: String(document.getElementById("ai-config-api-key")?.value || "").trim(),
      model: document.getElementById("ai-config-model")?.value || DEFAULT_MODEL,
      baseUrl: normalizeBaseUrl(document.getElementById("ai-config-base-url")?.value || "")
    };
  }

  function bindDialogEvents(dialog) {
    dialog.querySelectorAll("[data-ai-config-close]").forEach((button) => {
      button.addEventListener("click", () => dialog.close());
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (configDialog === dialog) {
        configDialog = null;
      }
    });
    dialog.querySelector("#toggle-ai-key-visibility").addEventListener("click", (event) => {
      const input = dialog.querySelector("#ai-config-api-key");
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      event.currentTarget.innerHTML = `<i data-lucide="${showing ? "eye" : "eye-off"}" aria-hidden="true"></i>`;
      App.ui?.refreshIcons(event.currentTarget);
    });
    dialog.querySelector("#test-ai-config").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const result = dialog.querySelector("#ai-config-test-result");
      result.className = "ai-config-test-result";
      result.textContent = "正在测试…";
      App.ui?.setButtonLoading(button, true, "正在测试…");
      try {
        await testConnection(readFormConfig());
        result.classList.add("success");
        result.textContent = "连接成功";
        App.ui?.toast("连接成功", "success");
      } catch (error) {
        result.classList.add("error");
        result.textContent = `连接失败：${error.message}`;
        App.ui?.toast(`连接失败：${error.message}`, "error", 5600);
      } finally {
        App.ui?.setButtonLoading(button, false);
      }
    });
    dialog.querySelector("#save-ai-config").addEventListener("click", () => {
      try {
        saveAIConfig(readFormConfig());
        dialog.close();
        App.ui?.toast("AI 配置已保存。", "success");
      } catch (error) {
        App.ui?.toast(error.message, "error");
      }
    });
    dialog.querySelector("#clear-ai-config").addEventListener("click", () => {
      clearAIConfig();
      dialog.close();
      App.ui?.toast("AI 配置已清除。", "info");
    });
  }

  function escapeAttribute(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function handleGlobalClick(event) {
    if (event.target.closest("[data-ai-config-open]")) {
      openAIConfig();
    }
  }

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;
    injectStyles();
    injectEntry();
    document.addEventListener("click", handleGlobalClick);
  }

  global.getAIConfig = getAIConfig;
  global.callDeepSeek = callDeepSeek;
  global.openAIConfig = openAIConfig;
  global.AIConfig = {
    get: getAIConfig,
    save: saveAIConfig,
    clear: clearAIConfig,
    testConnection,
    open: openAIConfig,
    defaults: {
      model: DEFAULT_MODEL,
      baseUrl: DEFAULT_BASE_URL
    }
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
      init();
    }
  }
})(window);
