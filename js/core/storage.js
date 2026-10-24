(function bootstrapStorage(global) {
  "use strict";

  const App = global.AIWorkbench = global.AIWorkbench || {};
  const memory = new Map();
  const probeKey = "iflow:__probe__";
  let available = false;

  try {
    global.localStorage.setItem(probeKey, "1");
    global.localStorage.removeItem(probeKey);
    available = true;
  } catch (error) {
    available = false;
  }

  function getRaw(key) {
    if (available) {
      try {
        return global.localStorage.getItem(key);
      } catch (error) {
        available = false;
      }
    }
    return memory.has(key) ? memory.get(key) : null;
  }

  function setRaw(key, value) {
    if (available) {
      try {
        global.localStorage.setItem(key, value);
        return { ok: true, persistent: true };
      } catch (error) {
        available = false;
      }
    }
    memory.set(key, value);
    return {
      ok: true,
      persistent: false,
      reason: available ? "storage_error" : "storage_unavailable"
    };
  }

  function removeRaw(key) {
    let removed = false;
    if (available) {
      try {
        removed = global.localStorage.getItem(key) !== null;
        global.localStorage.removeItem(key);
      } catch (error) {
        available = false;
      }
    }
    if (memory.delete(key)) {
      removed = true;
    }
    return removed;
  }

  function getJSON(key, fallback) {
    const raw = getRaw(key);
    if (!raw) {
      return fallback;
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function setJSON(key, value) {
    try {
      return setRaw(key, JSON.stringify(value));
    } catch (error) {
      memory.set(key, JSON.stringify(value));
      return { ok: false, persistent: false, reason: "serialize_error" };
    }
  }

  function isAvailable() {
    return available;
  }

  function usageBytes() {
    let bytes = 0;
    if (available) {
      try {
        for (let index = 0; index < global.localStorage.length; index += 1) {
          const key = global.localStorage.key(index);
          if (!key || !key.startsWith("iflow:")) {
            continue;
          }
          const value = global.localStorage.getItem(key) || "";
          bytes += (key.length + value.length) * 2;
        }
        return bytes;
      } catch (error) {
        available = false;
      }
    }
    memory.forEach((value, key) => {
      bytes += (key.length + String(value).length) * 2;
    });
    return bytes;
  }

  function listAppKeys() {
    const keys = new Set(memory.keys());
    if (available) {
      try {
        for (let index = 0; index < global.localStorage.length; index += 1) {
          const key = global.localStorage.key(index);
          if (key && key.startsWith("iflow:")) {
            keys.add(key);
          }
        }
      } catch (error) {
        available = false;
      }
    }
    return Array.from(keys);
  }

  App.storage = {
    getRaw,
    setRaw,
    removeRaw,
    getJSON,
    setJSON,
    isAvailable,
    usageBytes,
    listAppKeys
  };
})(window);
