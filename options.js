const DEFAULTS = {
  message: "1",
  enabled: true,
  autoCloseTab: true,
  minDelay: 1500,
  maxDelay: 3500,
  notify: true,
};

const $ = (id) => document.getElementById(id);

async function load() {
  const { settings, lastRunInfo } = await chrome.storage.local.get([
    "settings",
    "lastRunInfo",
  ]);
  const s = { ...DEFAULTS, ...(settings || {}) };
  $("message").value = s.message;
  $("enabled").checked = s.enabled;
  $("autoCloseTab").checked = s.autoCloseTab;
  $("notify").checked = s.notify;
  $("minDelay").value = s.minDelay;
  $("maxDelay").value = s.maxDelay;

  if (lastRunInfo) {
    showStatus(
      `上次运行:${lastRunInfo.time}\n` +
        `命中火花会话:${lastRunInfo.matched ?? "-"} · 已发送:${lastRunInfo.sent ?? 0}` +
        (lastRunInfo.error ? `\n错误:${lastRunInfo.error}` : "")
    );
  }
}

async function save() {
  const settings = {
    message: $("message").value.trim() || "1",
    enabled: $("enabled").checked,
    autoCloseTab: $("autoCloseTab").checked,
    notify: $("notify").checked,
    minDelay: parseInt($("minDelay").value, 10) || DEFAULTS.minDelay,
    maxDelay: parseInt($("maxDelay").value, 10) || DEFAULTS.maxDelay,
  };
  await chrome.storage.local.set({ settings });
  showStatus("✅ 设置已保存");
}

function showStatus(text) {
  $("status").textContent = text;
}

$("save").addEventListener("click", save);

$("run").addEventListener("click", async () => {
  await save();
  showStatus("⏳ 正在后台运行,请稍候(会打开一个抖音标签页)…");
  chrome.runtime.sendMessage({ action: "manualRun" }, (res) => {
    if (chrome.runtime.lastError) {
      showStatus("运行失败:" + chrome.runtime.lastError.message);
      return;
    }
    if (!res) return showStatus("无响应");
    if (res.skipped) return showStatus("已跳过:" + res.reason);
    showStatus(
      `运行结束。\n命中火花会话:${res.matched ?? 0} · 已发送:${res.sent ?? 0}` +
        (res.error ? `\n错误:${res.error}` : "")
    );
  });
});

// ---- 运行日志 ----
async function loadLogs() {
  const { logs = [] } = await chrome.storage.local.get("logs");
  const ta = $("log");
  ta.value = logs.join("\n");
  ta.scrollTop = ta.scrollHeight;
}

$("refreshLog").addEventListener("click", loadLogs);

$("copyLog").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("log").value || "");
  showStatus("📋 日志已复制");
});

$("exportLog").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "exportLogs" }, () => {
    showStatus("💾 已导出到下载目录/tiktok-fire-log.txt");
  });
});

$("clearLog").addEventListener("click", async () => {
  await chrome.storage.local.set({ logs: [] });
  loadLogs();
  showStatus("🗑 日志已清空");
});

// 日志变化时自动刷新面板
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.logs) loadLogs();
});

load();
loadLogs();
