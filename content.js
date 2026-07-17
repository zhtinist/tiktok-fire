// ===== 抖音自动续火花 - 内容脚本 =====
// 只有在收到后台的 runFire 指令时才动作,平时正常浏览抖音不受影响。
//
// !!! 重要 !!!
// 抖音网页版 DOM 经常改版,下面 CONFIG 里的选择器/关键词可能需要你按实际页面调整。
// 调试方法:打开抖音私信页 → F12 → 用 Elements 面板确认会话项、火花图标、输入框、发送按钮的结构。

const CONFIG = {
  // 打开"私信/消息"入口的候选选择器(会依次尝试)
  messageEntry: [
    '[data-e2e="im-entry"]',
    'a[href*="/message"]',
    '[aria-label*="私信"]',
    '[aria-label*="消息"]',
  ],
  // 会话列表里"单个会话"的候选选择器
  conversationItem: [
    '[data-e2e="chat-list-item"]',
    '[class*="conversation"] [class*="item"]',
    '[class*="sessionItem"]',
    'li[class*="session"]',
  ],
  // 判断该会话是否有"火花"的关键词/特征(文本或属性里包含任一即算命中)
  flameKeywords: ["🔥", "火花"],
  // 聊天输入框候选选择器(通常是 contenteditable)
  chatInput: [
    '[data-e2e="msg-input"]',
    'div[contenteditable="true"]',
    'textarea',
    '[class*="editor"] [contenteditable="true"]',
  ],
  // 发送按钮候选选择器
  sendButton: [
    '[data-e2e="msg-send"]',
    'button[type="submit"]',
    '[class*="send"]',
  ],
  // 发送按钮的文案关键词(找不到选择器时按文字找)
  sendButtonText: ["发送"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

// 依次尝试一组选择器,返回第一个命中的元素
function pick(selectors, root = document) {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (el) return el;
    } catch (e) {}
  }
  return null;
}
function pickAll(selectors, root = document) {
  for (const sel of selectors) {
    try {
      const els = root.querySelectorAll(sel);
      if (els.length) return Array.from(els);
    } catch (e) {}
  }
  return [];
}

// 轮询等待某个条件成立
async function waitFor(fn, { timeout = 15000, interval = 400 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(interval);
  }
  return null;
}

// 判断一个会话元素是否带火花
function hasFlame(el) {
  const text = (el.innerText || "") + " " + (el.getAttribute("aria-label") || "");
  if (CONFIG.flameKeywords.some((k) => text.includes(k))) return true;
  // 兜底:看有没有 img/svg 的 alt/title 带火花
  const imgs = el.querySelectorAll("img, svg, [aria-label], [title]");
  for (const n of imgs) {
    const meta =
      (n.getAttribute("alt") || "") +
      (n.getAttribute("title") || "") +
      (n.getAttribute("aria-label") || "");
    if (CONFIG.flameKeywords.some((k) => meta.includes(k))) return true;
  }
  return false;
}

// 在 contenteditable / textarea 里写入文本并触发框架的 input 事件
function typeInto(el, text) {
  el.focus();
  try {
    // 选中并清空原有内容
    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    // insertText 会派发浏览器原生的 input 事件,React/Vue 能正确感知
    const ok = document.execCommand("insertText", false, text);
    if (!ok) throw new Error("execCommand failed");
  } catch (e) {
    // 兜底:直接赋值 + 手动派发事件
    if ("value" in el) el.value = text;
    else el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
  }
}

// 触发发送:优先点发送按钮,否则模拟回车
function doSend(inputEl, container) {
  const btn =
    pick(CONFIG.sendButton, container || document) || findByText(CONFIG.sendButtonText);
  if (btn) {
    btn.click();
    return true;
  }
  // 回车兜底
  for (const type of ["keydown", "keypress", "keyup"]) {
    inputEl.dispatchEvent(
      new KeyboardEvent(type, {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
      })
    );
  }
  return true;
}

// 从会话项里尽量提取"好友昵称"
function extractName(el) {
  // 优先找 class 里带 name/nickname/title 的元素
  const cand = el.querySelector(
    '[class*="nickname"], [class*="name"], [class*="title"], [class*="user"]'
  );
  let name = cand ? (cand.innerText || cand.textContent || "").trim() : "";
  if (!name) {
    // 兜底:取 innerText 第一行(通常是昵称)
    name = (el.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  }
  // 去掉可能混进来的火花关键词
  CONFIG.flameKeywords.forEach((k) => (name = name.replace(k, "").trim()));
  return name || "未知用户";
}

// 按可见文字找按钮
function findByText(keywords) {
  const btns = document.querySelectorAll('button, [role="button"], [class*="btn"]');
  for (const b of btns) {
    const t = (b.innerText || "").trim();
    if (t && keywords.some((k) => t.includes(k))) return b;
  }
  return null;
}

// 尝试进入私信/消息页面
async function openMessages() {
  // 如果已经在消息页(能找到会话项),直接返回
  if (pickAll(CONFIG.conversationItem).length) return true;

  const entry = pick(CONFIG.messageEntry);
  if (entry) {
    entry.click();
    await sleep(2500);
  }
  // 等待会话列表出现
  const ok = await waitFor(() => pickAll(CONFIG.conversationItem).length > 0, {
    timeout: 15000,
  });
  return !!ok;
}

// ---- 主流程 ----
async function run(settings) {
  const message = (settings && settings.message) || "1";
  const minDelay = (settings && settings.minDelay) || 1500;
  const maxDelay = (settings && settings.maxDelay) || 3500;

  const report = { ok: false, sent: 0, matched: 0, names: [], error: null };

  try {
    const entered = await openMessages();
    if (!entered) {
      report.error = "找不到私信/会话列表(可能未登录,或选择器需更新)";
      return report;
    }

    // 收集带火花的会话。因为点进去会话列表会重排,这里先记录命中的"文本指纹"用于去重。
    const seen = new Set();

    // 最多循环若干轮,防止列表虚拟滚动导致漏掉
    for (let round = 0; round < 3; round++) {
      const items = pickAll(CONFIG.conversationItem).filter(hasFlame);
      report.matched = Math.max(report.matched, items.length);

      let progressed = false;
      for (const item of items) {
        const fingerprint = (item.innerText || "").slice(0, 40).trim();
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        progressed = true;

        const name = extractName(item);
        item.click();
        await sleep(1500);

        // 找到输入框
        const input = await waitFor(() => pick(CONFIG.chatInput), { timeout: 8000 });
        if (!input) continue;

        typeInto(input, message);
        await sleep(500);
        doSend(input, input.closest('[class*="chat"], [class*="conversation"]'));
        report.sent++;
        report.names.push(name);

        await sleep(rand(minDelay, maxDelay)); // 拟人化间隔
      }

      if (!progressed) break;
      // 滚动会话列表加载更多
      const list = pick(CONFIG.conversationItem)?.parentElement;
      if (list) {
        list.scrollTop = list.scrollHeight;
        await sleep(1500);
      }
    }

    report.ok = true;
  } catch (e) {
    report.error = String(e && e.message ? e.message : e);
  }
  return report;
}

// ---- 监听后台指令 ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "runFire") {
    run(msg.settings).then((report) => {
      // 汇报给后台
      chrome.runtime.sendMessage({ type: "fire-report", payload: report });
      sendResponse(report);
    });
    return true; // 异步
  }
});
