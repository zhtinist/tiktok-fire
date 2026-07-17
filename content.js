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
    '[class*="ConversationItemwrapper"]',
    '[data-e2e="chat-list-item"]',
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

// 日志:打到本页 console,并转发给后台统一收集(设置页可查看)
function clog(line) {
  console.log("[续火花/页面]", line);
  try {
    chrome.runtime.sendMessage({ type: "log", line });
  } catch (e) {}
}

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

const FLAME_CLASS_RE = /fire|flame|huohua|spark/i;

// 判断一个会话元素是否带火花(续火花中)
function hasFlame(el) {
  const cls = typeof el.className === "string" ? el.className : "";
  if (FLAME_CLASS_RE.test(cls)) return true;

  const text = (el.innerText || "") + " " + (el.getAttribute("aria-label") || "");
  if (CONFIG.flameKeywords.some((k) => text.includes(k))) return true;

  // 子元素 class 里带 火花/fire 特征
  if (el.querySelector('[class*="fire"], [class*="flame"], [class*="huohua"], [class*="spark"]'))
    return true;

  // img/svg 的 alt/title/aria-label/src 带火花特征
  const imgs = el.querySelectorAll("img, svg, [aria-label], [title], [alt]");
  for (const n of imgs) {
    const meta =
      (n.getAttribute("alt") || "") +
      (n.getAttribute("title") || "") +
      (n.getAttribute("aria-label") || "") +
      (n.getAttribute("src") || "");
    if (CONFIG.flameKeywords.some((k) => meta.includes(k)) || FLAME_CLASS_RE.test(meta))
      return true;
  }
  return false;
}

// 打印元素的祖先 class 链,便于远程定位选择器
function classChain(el, levels = 7) {
  const parts = [];
  let n = el;
  for (let i = 0; i < levels && n && n !== document.body; i++) {
    const cls =
      typeof n.className === "string"
        ? n.className.trim().split(/\s+/).slice(0, 3).join(".")
        : "";
    parts.push(n.tagName.toLowerCase() + (cls ? "." + cls : ""));
    n = n.parentElement;
  }
  return parts.join("  <  ");
}

// DOM 诊断:识别失败时把真实结构写进日志,供远程排查
function diagnose() {
  clog("—— DOM 诊断开始 ——");
  CONFIG.conversationItem.forEach((sel) => {
    let c = 0;
    try {
      c = document.querySelectorAll(sel).length;
    } catch (e) {}
    clog(`会话选择器 [${sel}] 命中 ${c}`);
  });

  // 疑似火花元素(class 命中 或 文本含🔥)
  const fireEls = [];
  const all = document.querySelectorAll("*");
  for (const el of all) {
    if (fireEls.length >= 6) break;
    const cls = typeof el.className === "string" ? el.className : "";
    const hasFireText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && /🔥|火花/.test(n.nodeValue || "")
    );
    const meta =
      (el.getAttribute && (el.getAttribute("alt") || el.getAttribute("aria-label"))) || "";
    if (FLAME_CLASS_RE.test(cls) || hasFireText || FLAME_CLASS_RE.test(meta)) {
      fireEls.push(el);
    }
  }
  clog(`疑似火花元素: ${fireEls.length} 个`);
  fireEls.forEach((el, i) => {
    clog(`火花#${i} 链路: ${classChain(el)}`);
    const row = el.closest("li, a, [role='listitem']") || el.parentElement?.parentElement;
    if (row) {
      const html = (row.outerHTML || "").replace(/\s+/g, " ").slice(0, 700);
      clog(`火花#${i} 所在行 outerHTML(截断): ${html}`);
    }
  });

  // 常见容器统计
  ["conversation", "session", "chat", "card", "item", "list"].forEach((kw) => {
    const c = document.querySelectorAll(`[class*="${kw}"]`).length;
    if (c) clog(`class 含 "${kw}" 的元素: ${c}`);
  });

  // 采样会话容器的 className 分布(重复次数≈会话数的那个,基本就是会话行)
  const convEls = Array.from(
    document.querySelectorAll('[class*="conversation"], [class*="session"], [class*="chat"]')
  );
  const freq = {};
  convEls.forEach((el) => {
    const c = typeof el.className === "string" ? el.className.trim() : "";
    if (c) freq[c] = (freq[c] || 0) + 1;
  });
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
  clog("className 分布(出现次数 x className):");
  top.forEach(([c, n]) => clog(`  x${n}  ${c}`));

  // 转储整个会话项 wrapper 的 outerHTML(找火花标记用)
  const wrappers = Array.from(
    document.querySelectorAll('[class*="ConversationItemwrapper"]')
  );
  clog(`会话项 wrapper 数: ${wrappers.length}`);
  wrappers.slice(0, 12).forEach((w, i) => {
    const html = (w.outerHTML || "").replace(/\s+/g, " ").slice(0, 2000);
    clog(`会话项#${i} outerHTML(截断2000): ${html}`);
  });
  clog("—— DOM 诊断结束 ——");
}

// 用真实鼠标事件序列点击(比 el.click() 更能触发框架的 onClick)
function realClick(el) {
  try {
    el.scrollIntoView({ block: "center" });
  } catch (e) {}
  const r = el.getBoundingClientRect();
  const base = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
    button: 0,
  };
  for (const type of [
    "pointerover",
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
  ]) {
    try {
      const E =
        type.startsWith("pointer") && window.PointerEvent ? PointerEvent : MouseEvent;
      el.dispatchEvent(new E(type, base));
    } catch (e) {}
  }
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

// 触发发送:优先点可点击的发送按钮,否则在输入框上派发回车
function doSend(inputEl) {
  // 1) 找一个"真的能点"的发送按钮(防 DOM clobbering 导致 click 不是函数)
  let btn = null;
  for (const sel of CONFIG.sendButton) {
    try {
      const e = document.querySelector(sel);
      if (e && typeof e.click === "function") {
        btn = e;
        break;
      }
    } catch (err) {}
  }
  if (!btn) {
    const t = findByText(CONFIG.sendButtonText);
    if (t && typeof t.click === "function") btn = t;
  }
  if (btn) {
    btn.click();
    return "button";
  }
  // 2) 回退:在输入框上派发回车(keydown 通常足够触发发送)
  const opts = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };
  for (const type of ["keydown", "keypress", "keyup"]) {
    inputEl.dispatchEvent(new KeyboardEvent(type, opts));
  }
  return "enter";
}

// 聊天区诊断:dump 输入框与发送按钮的真实结构
let chatDiagnosed = false;
function diagnoseChat(tag) {
  clog(`—— 聊天区诊断(${tag})——`);
  clog(
    `contenteditable=${document.querySelectorAll('[contenteditable="true"]').length}, ` +
      `textarea=${document.querySelectorAll("textarea").length}, ` +
      `input标签=${document.querySelectorAll("input").length}`
  );

  // 关键词类名分布(看聊天面板/输入区有没有渲染出来)
  ["input", "Input", "editor", "Editor", "send", "Send", "message", "Message", "msg", "footer", "bubble"].forEach(
    (kw) => {
      const c = document.querySelectorAll(`[class*="${kw}"]`).length;
      if (c) clog(`class含"${kw}": ${c}`);
    }
  );

  // dump 可能是输入框的元素
  const cands = Array.from(
    document.querySelectorAll('[contenteditable], [class*="input"], [class*="Input"], [class*="editor"], [class*="Editor"]')
  ).slice(0, 8);
  cands.forEach((e, i) => {
    clog(
      `输入候选#${i} <${e.tagName.toLowerCase()} ce=${e.getAttribute("contenteditable")}> ` +
        `${classChain(e, 4)} | html:${(e.outerHTML || "").replace(/\s+/g, " ").slice(0, 200)}`
    );
  });

  // "发送"文字元素
  const sendEls = Array.from(document.querySelectorAll('button, [role="button"], span, div'))
    .filter((e) => {
      const t = (e.innerText || "").trim();
      return t.length <= 6 && t.includes("发送");
    })
    .slice(0, 5);
  clog(`含"发送"文字的元素: ${sendEls.length}`);
  sendEls.forEach((e, i) => clog(`发送候选#${i} <${e.tagName.toLowerCase()}> ${classChain(e, 4)}`));
}

// 从会话项里尽量提取"好友昵称"
function extractName(el) {
  // 抖音昵称在 conversationConversationItemtitle(排除 titleWrapper)
  let cand =
    Array.from(el.querySelectorAll('[class*="ConversationItemtitle"]')).find(
      (n) => !/Wrapper/i.test(n.className)
    ) ||
    el.querySelector('[class*="nickname"], [class*="name"], [class*="title"], [class*="user"]');
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
  const already = pickAll(CONFIG.conversationItem).length;
  clog(`初始会话项命中数: ${already}`);
  if (already) return true;

  const entry = pick(CONFIG.messageEntry);
  clog(`私信入口: ${entry ? "找到,点击进入" : "未找到(将直接等待列表)"}`);
  if (entry) {
    entry.click();
    await sleep(2500);
  }
  const ok = await waitFor(() => pickAll(CONFIG.conversationItem).length > 0, {
    timeout: 15000,
  });
  clog(`等待会话列表结果: ${ok ? "出现" : "超时未出现"}`);
  return !!ok;
}

// ---- 主流程 ----
async function run(settings) {
  const message = (settings && settings.message) || "1";
  const minDelay = (settings && settings.minDelay) || 1500;
  const maxDelay = (settings && settings.maxDelay) || 3500;

  const report = { ok: false, sent: 0, matched: 0, names: [], error: null };

  try {
    clog(`当前页面: ${location.href}`);
    clog(`将要发送的消息: "${message}"`);
    const entered = await openMessages();
    if (!entered) {
      report.error = "找不到私信/会话列表(可能未登录,或选择器需更新)";
      clog("❌ " + report.error);
      diagnose();
      return report;
    }

    // 硬性截止时间:整个发送过程不超过 ~9.5 秒
    const deadline = Date.now() + 9500;

    const allItems = pickAll(CONFIG.conversationItem);
    const items = allItems.filter(hasFlame);
    clog(`会话总数 ${allItems.length},带火花 ${items.length}`);
    report.matched = items.length;

    if (allItems.length > 0 && items.length === 0) {
      clog("有会话但未识别到火花,输出诊断:");
      diagnose();
    }

    for (const item of items) {
      if (Date.now() > deadline) {
        clog("⏱ 已到 9.5s 截止,停止后续会话");
        break;
      }
      const name = extractName(item);
      clog(`→ 打开会话: ${name}`);
      realClick(item);

      // 等输入框出现(最多 2.5s)
      const input = await waitFor(() => pick(CONFIG.chatInput), {
        timeout: 2500,
        interval: 250,
      });

      // 首个会话做一次聊天区诊断
      if (!chatDiagnosed) {
        chatDiagnosed = true;
        diagnoseChat(input ? "已找到输入框" : "未找到输入框");
      }

      if (!input) {
        clog(`  ✗ 未找到输入框,跳过 ${name}`);
        continue;
      }

      typeInto(input, message);
      await sleep(300);
      const how = doSend(input);
      await sleep(400);
      clog(`  ✓ 已向 ${name} 发送(方式=${how})`);
      report.sent++;
      report.names.push(name);
    }

    report.ok = true;
  } catch (e) {
    report.error = String(e && e.message ? e.message : e);
  }
  return report;
}

// ---- 触发 ----
let running = false;
async function doRun(settings) {
  if (running) return;
  running = true;
  try {
    const report = await run(settings);
    chrome.runtime.sendMessage({ type: "fire-report", payload: report });
  } finally {
    running = false;
  }
}

// 页面加载后,检查后台留下的"待执行"标记(抗时序问题的主触发方式)
async function checkPending() {
  // 只在顶层框架、且是抖音主站执行
  if (window.top !== window.self) return;
  if (!/douyin\.com$/.test(location.hostname)) return;
  try {
    const { pendingRun } = await chrome.storage.local.get("pendingRun");
    if (pendingRun && Date.now() - pendingRun.ts < 120000) {
      clog("检测到待执行标记,开始自动执行");
      await chrome.storage.local.remove("pendingRun");
      doRun(pendingRun.settings);
    }
  } catch (e) {
    clog("checkPending 出错: " + e);
  }
}
checkPending();

// 保留手动指令入口
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "runFire") doRun(msg.settings);
});
