// ===== 抖音自动续火花 - 后台 Service Worker =====
// 职责:
// 1. Chrome 启动时 / 定时检查,判断"今天是否已经跑过"
// 2. 若今天还没跑,后台打开抖音标签页并触发内容脚本执行
// 3. 收到内容脚本汇报后,关闭标签页并记录状态

const DOUYIN_URL = "https://www.douyin.com/";
const RUN_TIMEOUT_MS = 90 * 1000; // 单次运行最长等待 90s,超时强制收尾

// ---- 默认设置 ----
const DEFAULT_SETTINGS = {
  message: "1", // 要发送的固定消息,默认 "1"
  enabled: true, // 总开关
  autoCloseTab: true, // 完成后自动关闭抖音标签页
  minDelay: 1500, // 每条消息之间的最小间隔(ms)
  maxDelay: 3500, // 每条消息之间的最大间隔(ms)
  notify: true, // 完成后弹通知
};

// 通知图标(复用插件图标)
const NOTIFY_ICON = chrome.runtime.getURL("icons/icon128.png");

// 组装并弹出完成通知
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

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

// 本地时区的 "YYYY-M-D",用来做每日去重
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

// ---- 核心:执行一次续火花 ----
async function runFireStreak(force = false) {
  const settings = await getSettings();
  if (!settings.enabled && !force) {
    console.log("[续火花] 已被禁用,跳过");
    return { skipped: true, reason: "disabled" };
  }
  if (!force && (await alreadyRanToday())) {
    console.log("[续火花] 今天已经跑过,跳过");
    return { skipped: true, reason: "already-ran" };
  }

  console.log("[续火花] 开始执行…");

  // 在后台打开抖音(active:false 不抢焦点,尽量无感)
  const tab = await chrome.tabs.create({ url: DOUYIN_URL, active: false });

  const result = await driveTab(tab.id, settings);

  if (settings.autoCloseTab) {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (e) {
      /* 标签页可能已被用户关闭 */
    }
  }

  await setLastRun(result);
  if (settings.notify && !result.skipped) showNotification(result);
  console.log("[续火花] 完成:", result);
  return result;
}

// 等待标签页加载完成,给内容脚本发指令,等待其汇报结果
function driveTab(tabId, settings) {
  return new Promise((resolve) => {
    let done = false;

    const finish = (res) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.runtime.onMessage.removeListener(onReport);
      clearTimeout(timer);
      resolve(res);
    };

    // 超时兜底
    const timer = setTimeout(
      () => finish({ ok: false, error: "timeout", sent: 0 }),
      RUN_TIMEOUT_MS
    );

    // 内容脚本执行完会通过 runtime 消息汇报
    const onReport = (msg, sender) => {
      if (sender.tab && sender.tab.id === tabId && msg.type === "fire-report") {
        finish(msg.payload);
      }
    };
    chrome.runtime.onMessage.addListener(onReport);

    // 页面加载完成后,给内容脚本下达执行指令
    const onUpdated = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === "complete") {
        // 稍等页面动态内容渲染
        setTimeout(() => {
          chrome.tabs.sendMessage(
            tabId,
            { action: "runFire", settings },
            () => void chrome.runtime.lastError // 忽略"接收端不存在"的报错
          );
        }, 3000);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// ---- 触发时机 ----

// Chrome 冷启动(每天第一次打开浏览器通常会触发)
chrome.runtime.onStartup.addListener(() => {
  console.log("[续火花] onStartup 触发");
  runFireStreak();
});

// 安装/更新时建一个每小时的闹钟,兜底"Chrome 常年不关"的情况
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("dailyCheck", { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dailyCheck") {
    runFireStreak(); // 内部会判断今天是否已跑过
  }
});

// 点击工具栏图标 → 打开设置页
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// 来自设置页的手动指令(测试运行)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "manualRun") {
    runFireStreak(true).then(sendResponse);
    return true; // 异步响应
  }
});
