(function bootstrapState(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const utils = App.utils;
  const constants = App.constants;
  const listeners = new Map();

  const state = {
    currentRoute: "data",
    currentPanel: "upload",
    previewLimit: 10,
    draft: null,
    originalDraft: null,
    history: [],
    outlierFlags: {},
    analysisRuns: [],
    dirty: false,
    lastSavedAt: null
  };

  function subscribe(eventName, listener) {
    if (!listeners.has(eventName)) {
      listeners.set(eventName, new Set());
    }
    listeners.get(eventName).add(listener);
    return () => {
      const eventListeners = listeners.get(eventName);
      if (eventListeners) {
        eventListeners.delete(listener);
      }
    };
  }

  function emit(eventName, detail) {
    const eventListeners = listeners.get(eventName);
    if (!eventListeners) {
      return;
    }
    eventListeners.forEach((listener) => {
      try {
        listener(detail);
      } catch (error) {
        console.error(`State listener failed for ${eventName}`, error);
      }
    });
  }

  function persistDraft() {
    if (!state.draft) {
      App.storage.removeRaw(constants.storage.draft);
      return { ok: true, persistent: App.storage.isAvailable() };
    }
    return App.storage.setJSON(constants.storage.draft, {
      savedAt: new Date().toISOString(),
      draft: state.draft,
      originalDraft: state.originalDraft,
      dirty: state.dirty
    });
  }

  function setDraft(draft, options) {
    const config = options || {};
    state.draft = draft;
    if (config.keepOriginal || !state.originalDraft || config.replaceOriginal) {
      state.originalDraft = draft ? utils.clone(draft) : null;
    }
    state.outlierFlags = {};
    state.history = [];
    state.dirty = Boolean(config.dirty ?? Boolean(draft));
    persistDraft();
    emit("draft:changed", state.draft);
  }

  function clearDraft() {
    state.draft = null;
    state.originalDraft = null;
    state.history = [];
    state.outlierFlags = {};
    state.dirty = false;
    App.storage.removeRaw(constants.storage.draft);
    emit("draft:changed", null);
  }

  function markSaved() {
    if (!state.draft) {
      return;
    }
    state.originalDraft = utils.clone(state.draft);
    state.history = [];
    state.dirty = false;
    state.lastSavedAt = new Date().toISOString();
    persistDraft();
    emit("draft:saved", state.draft);
  }

  function beforeOperation(label) {
    if (!state.draft) {
      return false;
    }
    state.history.push({
      label,
      draft: utils.clone(state.draft),
      outlierFlags: utils.clone(state.outlierFlags),
      at: new Date().toISOString()
    });
    if (state.history.length > 20) {
      state.history.shift();
    }
    return true;
  }

  function commitDraft(draft, options) {
    state.draft = draft;
    state.dirty = true;
    if (options && options.clearOutlierFlags) {
      state.outlierFlags = {};
    }
    persistDraft();
    emit("draft:changed", state.draft);
  }

  function undo() {
    const previous = state.history.pop();
    if (!previous) {
      return false;
    }
    state.draft = previous.draft;
    state.outlierFlags = previous.outlierFlags || {};
    state.dirty = true;
    persistDraft();
    emit("draft:changed", state.draft);
    return previous.label;
  }

  function resetToOriginal() {
    if (!state.originalDraft) {
      return false;
    }
    beforeOperation("恢复原始数据");
    state.draft = utils.clone(state.originalDraft);
    state.outlierFlags = {};
    state.dirty = true;
    persistDraft();
    emit("draft:changed", state.draft);
    return true;
  }

  function restoreDraft() {
    const saved = App.storage.getJSON(constants.storage.draft, null);
    if (!saved || !saved.draft) {
      return false;
    }
    state.draft = saved.draft;
    state.originalDraft = saved.originalDraft || utils.clone(saved.draft);
    state.dirty = Boolean(saved.dirty);
    state.outlierFlags = {};
    state.history = [];
    emit("draft:restored", state.draft);
    return true;
  }

  function setRoute(route) {
    state.currentRoute = route;
    emit("route:changed", route);
  }

  function setPanel(panel) {
    state.currentPanel = panel;
    emit("panel:changed", panel);
  }

  function setPreviewLimit(limit) {
    state.previewLimit = Number(limit) || 10;
    emit("preview:changed", state.previewLimit);
  }

  function setOutlierFlags(flags) {
    state.outlierFlags = flags || {};
  }

  function addAnalysisRun(record) {
    if (!record) {
      return;
    }
    state.analysisRuns.push(utils.clone(record));
    if (state.analysisRuns.length > 40) {
      state.analysisRuns = state.analysisRuns.slice(-40);
    }
    emit("analysis:run", record);
  }

  function getAnalysisRuns(tableId) {
    const runs = tableId
      ? state.analysisRuns.filter((item) => item.tableId === tableId)
      : state.analysisRuns;
    return runs.map((item) => utils.clone(item));
  }

  function clearAnalysisRuns() {
    state.analysisRuns = [];
    emit("analysis:cleared", null);
  }

  App.state = {
    get: () => state,
    subscribe,
    emit,
    persistDraft,
    setDraft,
    clearDraft,
    markSaved,
    beforeOperation,
    commitDraft,
    undo,
    resetToOriginal,
    restoreDraft,
    setRoute,
    setPanel,
    setPreviewLimit,
    setOutlierFlags,
    addAnalysisRun,
    getAnalysisRuns,
    clearAnalysisRuns
  };
})(window);
