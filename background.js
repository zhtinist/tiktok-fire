// ===== 抖音自动续火花 - 后台 Service Worker =====

// ⚠️ 调试开关:true = 每次启动/重载扩展都运行、打开可见标签页、不自动关闭、详细日志。
//    调试完成后改为 false,即可恢复"每天仅运行一次"。
const DEBUG = true;

const DOUYIN_URL = "https://www.douyin.com/";
const RUN_TIMEOUT_MS = 120 * 1000;

const DEFAULT_SETTINGS = {
  message: "1",
  enabled: true,
  autoCloseTab: true,
  minDelay: 1500,
  maxDelay: 3500,
  notify: true,
};

const NOTIFY_ICON = chrome.runtime.getURL("icons/icon128.png");

// ---- 日志:同时写 console 和 storage(设置页可查看/复制)----
async function log(line) {
  const time = new Date().toLocaleTimeString();
  const entry = `[${time}] ${line}`;
  console.log("[续火花]", line);
  try {
    const { logs = [] } = await chrome.storage.local.get("logs");
    logs.push(entry);
    while (logs.length > 500) logs.shift();
    await chrome.storage.local.set({ logs });
  } catch (e) {}
}

// 把全部日志导出成下载目录里的固定文件(覆盖写),方便自动读取
const LOG_FILENAME = "tiktok-fire-log.txt";
async function exportLogs() {
  try {
    const { logs = [] } = await chrome.storage.local.get("logs");
    const header =
      `# 抖音自动续火花 运行日志\n# 导出时间: ${new Date().toLocaleString()}\n` +
      `# 文件位置: 浏览器下载目录/${LOG_FILENAME}\n\n`;
    const text = header + logs.join("\n");
    const url = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
    await chrome.downloads.download({
      url,
      filename: LOG_FILENAME,
      saveAs: false,
      conflictAction: "overwrite",
    });
  } catch (e) {
    console.log("[续火花] 导出日志失败:", e);
  }
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function alreadyRanToday() {
  const { lastRunDate } = await chrome.storage.local.get("lastRunDate");
  return lastRunDate === todayStr();
}

async function setLastRun(info) {
  await chrome.storage.local.set({
    lastRunDate: todayStr(),
    lastRunInfo: { time: new Date().toLocaleString(), ...info },
  });
}

function showNotification(result) {
  const names = result.names || [];
  const count = result.sent || names.length;
  const d = new Date();
  const dateStr = `${d.getMonth() + 1}月${d.getDate()}日`;

  let message;
  if (count > 0) {
    const shown = names.slice(0, 5).join("、");
    const suffix = names.length > 5 ? "..." : "";
    message = `今日(${dateStr})已与${count}位用户续火花:${shown}${suffix}`;
  } else {
    message = `今日(${dateStr})未发现需要续火花的用户`;
  }

  chrome.notifications.create("", {
    type: "basic",
    iconUrl: NOTIFY_ICON,
    title: "🔥 抖音续火花",
    message,
    priority: 1,
  });
}

// ---- 核心 ----
async function runFireStreak(trigger = "unknown", force = false) {
  const settings = await getSettings();
  await log(`触发运行 (来源=${trigger}, force=${force}, DEBUG=${DEBUG})`);

  if (!settings.enabled && !force) {
    await log("总开关关闭,跳过");
    return { skipped: true, reason: "disabled" };
  }
  if (!DEBUG && !force && (await alreadyRanToday())) {
    await log("今天已经跑过,跳过");
    return { skipped: true, reason: "already-ran" };
  }

  // 设置待执行标记,内容脚本加载后会读取并自动执行(比 sendMessage 更抗时序问题)
  await chrome.storage.local.set({
    pendingRun: { settings, ts: Date.now() },
  });

  const active = DEBUG ? true : false;
  const tab = await chrome.tabs.create({ url: DOUYIN_URL, active });
  await log(`已打开抖音标签页 (id=${tab.id}, active=${active})`);

  const result = await driveTab(tab.id, settings);

  await chrome.storage.local.remove("pendingRun");

  if (settings.autoCloseTab && !DEBUG) {
    try {
      await chrome.tabs.remove(tab.id);
      await log("已关闭抖音标签页");
    } catch (e) {}
  } else if (DEBUG) {
    await log("DEBUG 模式:保留标签页,方便你 F12 查看");
  }

  await setLastRun(result);
  if (settings.notify && !result.skipped) showNotification(result);
  await log("运行完成: " + JSON.stringify(result));
  await exportLogs(); // 自动把日志写到下载目录的固定文件
  return result;
}

// 等待内容脚本汇报结果(带超时兜底)
function driveTab(tabId, settings) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      chrome.runtime.onMessage.removeListener(onReport);
      clearTimeout(timer);
      resolve(res);
    };
    const timer = setTimeout(() => {
      log("等待内容脚本超时(120s)。可能是页面没加载出会话列表,或内容脚本未注入。");
      finish({ ok: false, error: "timeout", sent: 0, names: [] });
    }, RUN_TIMEOUT_MS);

    const onReport = (msg, sender) => {
      if (sender.tab && sender.tab.id === tabId && msg.type === "fire-report") {
        finish(msg.payload);
      }
    };
    chrome.runtime.onMessage.addListener(onReport);
  });
}

// ---- 触发时机 ----
chrome.runtime.onStartup.addListener(() => runFireStreak("onStartup"));

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("dailyCheck", { periodInMinutes: 60 });
  // 调试期:重新加载扩展也立刻跑一次
  if (DEBUG) runFireStreak("onInstalled");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dailyCheck") runFireStreak("alarm");
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// ---- 来自内容脚本 / 设置页的消息 ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "log") {
    log("[页面] " + msg.line);
    return;
  }
  if (msg.action === "manualRun") {
    runFireStreak("manual", true).then(sendResponse);
    return true;
  }
  if (msg.action === "exportLogs") {
    exportLogs().then(() => sendResponse({ ok: true }));
    return true;
  }
});
