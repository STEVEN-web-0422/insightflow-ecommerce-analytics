(function bootstrapChatStore(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const storageKey = App.constants.storage.chatHistory;

  function list() {
    const sessions = App.storage.getJSON(storageKey, []);
    return Array.isArray(sessions) ? sessions : [];
  }

  function persist(sessions) {
    return App.storage.setJSON(
      storageKey,
      sessions.slice(0, 30).map((session) => ({
        ...session,
        messages: (session.messages || []).slice(-120)
      }))
    );
  }

  function get(tableId) {
    return list().find((session) => session.tableId === tableId) || null;
  }

  function ensure(tableId, tableName) {
    const sessions = list();
    let session = sessions.find((item) => item.tableId === tableId);
    if (!session) {
      session = {
        id: `chat_${tableId}`,
        tableId,
        tableName,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      sessions.unshift(session);
      persist(sessions);
    }
    return utils.clone(session);
  }

  function save(session) {
    if (!session || !session.tableId) {
      throw new Error("会话缺少数据表标识。");
    }
    const sessions = list();
    const next = {
      ...utils.clone(session),
      updatedAt: new Date().toISOString(),
      messages: (session.messages || []).slice(-120)
    };
    const index = sessions.findIndex((item) => item.tableId === session.tableId);
    if (index >= 0) {
      sessions[index] = next;
    } else {
      sessions.unshift(next);
    }
    const result = persist(sessions);
    return {
      session: next,
      persistent: Boolean(result.persistent)
    };
  }

  function clear(tableId) {
    const sessions = list();
    const existing = sessions.find((item) => item.tableId === tableId);
    if (!existing) {
      return false;
    }
    existing.messages = [];
    existing.updatedAt = new Date().toISOString();
    persist(sessions);
    return true;
  }

  App.ai.chatStore = {
    list,
    get,
    ensure,
    save,
    clear
  };
})(window);
