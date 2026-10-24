(function bootstrapDeepSeekClient(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};

  function parseJsonContent(content) {
    const text = String(content || "").trim();
    if (!text) {
      throw new Error("DeepSeek 返回了空内容。");
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced) {
        return JSON.parse(fenced[1].trim());
      }
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1));
      }
      throw new Error("DeepSeek 返回内容不是有效 JSON。");
    }
  }

  async function completeJson(options) {
    const config = options || {};
    const messages = config.messages || [
      { role: "system", content: config.systemPrompt },
      { role: "user", content: config.userPrompt }
    ];
    const payload = await global.callDeepSeek(messages, {
      stream: false,
      temperature: config.temperature ?? 0.2,
      maxTokens: config.maxTokens || 2800,
      timeoutMs: config.timeoutMs || 75000,
      responseFormat: { type: "json_object" }
    });
    const content = payload?.choices?.[0]?.message?.content;
    return {
      data: parseJsonContent(content),
      usage: payload.usage || null,
      model: payload.model || global.getAIConfig()?.model || "deepseek-chat"
    };
  }

  async function streamChat(options) {
    const config = options || {};
    return global.callDeepSeek(config.messages, {
      stream: true,
      signal: config.signal,
      onDelta: config.onDelta,
      temperature: config.temperature ?? 0.25,
      maxTokens: config.maxTokens || 2200,
      timeoutMs: config.timeoutMs || 90000
    });
  }

  App.ai.client = {
    completeJson,
    streamChat,
    parseJsonContent
  };
})(window);
