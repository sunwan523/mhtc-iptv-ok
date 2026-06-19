/*
 * OK影视老人版 - Cloudflare Worker
 * 特点：热播置顶、上游可配置、兼容老旧电视
 */

// ========== 可配置项 ==========
const TOKEN = "abc123";

// 上游地址（可修改为其他来源）
const UPSTREAM_URLS = [
  "https://github.com/tushen6/Tomorrow/raw/main/tvbox.json",
  "https://www.xn--sss604efuw.cc/tv"
];
let UPSTREAM = UPSTREAM_URLS[0]; // 当前使用的上游

// 站点选择：false=饭太硬 true=Tomorrow
let USE_TOMORROW = true;

// 兼容老旧电视的设置
const LEGACY_TV_COMPATIBLE = true;

// ========== 站点优先级（热播最前） ==========
const PREFERRED_KEYS = [
  "热播",
  "玩偶",
  "厂长",
  "立播",
  "荐片",
  "糯米",
  "文采",
  "光影",
  "原创",
  "视界",
  "播客",
  "米陌",
  "剧圈",
  "奥特",
  "咕咕",
  "Dm84",
  "Anime1",
  "Bili",
  "Biliych",
  "dr_兔小贝",
  "少儿教育",
  "小学课堂",
  "初中课堂",
  "高中教育",
  "MTV",
  "MTV1",
  "有声小说",
  "Aid"
];

const BLOCK_WORDS = [
  "cookie",
  "token",
  "quark",
  "baidu",
  "aliyun",
  "alipan",
  "uc",
  "115",
  "189",
  "webdav",
  "alist",
  "云盘",
  "网盘",
  "夸克",
  "百度",
  "阿里",
  "天翼",
  "推送",
  "搜搜",
  "盘搜",
  "盘她",
  "盘他",
  "配置",
  "切源",
  "广告",
  "勿信"
];

// 老旧电视兼容：更宽松的UA检测
const PLAYER_UA_WORDS = [
  "okhttp",
  "iptv",
  "player",
  "vlc",
  "tivimate",
  "kodi",
  "cfnetwork",
  "android",
  "tvbox",
  // 国产电视品牌
  "mi",
  "hisense",
  "tcl",
  "skyworth",
  "changhong",
  "philips",
  "lg",
  "samsung",
  "sony",
  "panasonic",
  "sharp",
  "tongson",    // 暴风TV
  "baofeng",     // 暴风TV
  "storm",       // 暴风TV
  "leTV",
  "letv",
  "huawei",
  "honor",
  "oppo",
  "vidaa"
];

// Tomorrow 特有的站点 key
const TOMORROW_KEYS = [
  "热播",
  "短剧",
  "电影",
  "剧集",
  "综艺",
  "动漫",
  "蓝光",
  "4K",
  "纪录片"
];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 首页显示配置信息
    if (url.pathname === "/info" || url.pathname === "/help") {
      return htmlPage(request);
    }

    // 配置面板（通过 /config 访问）
    if (url.pathname === "/config") {
      return handleConfig(request);
    }

    // 根路径直接返回配置
    if (url.pathname !== "/" && url.pathname !== "") {
      return new Response("Not found", { status: 404 });
    }

    try {
      const source = await loadConfig();
      const clean = makeElderConfig(source);
      const body = JSON.stringify(clean);
      const ua = (request.headers.get("user-agent") || "").toLowerCase();
      const isPlayer = PLAYER_UA_WORDS.some((word) => ua.includes(word));

      if (!isPlayer) {
        return new Response(toBase64Utf8(body), {
          headers: commonHeaders("text/plain;charset=utf-8")
        });
      }

      return new Response(body, {
        headers: commonHeaders("application/json;charset=utf-8")
      });
    } catch (err) {
      return new Response(`Config load failed: ${err.message}`, {
        status: 502,
        headers: commonHeaders("text/plain;charset=utf-8")
      });
    }
  }
};

async function loadConfig() {
  // 尝试多个上游源
  const errors = [];

  for (const upstream of UPSTREAM_URLS) {
    try {
      const res = await fetch(upstream, {
        headers: {
          "user-agent": LEGACY_TV_COMPATIBLE
            ? "Mozilla/5.0 (Linux; Android 9; AWM Build/PPR1.180610.011) AppleWebKit/537.36"
            : "okhttp/4.0"
        },
        cf: {
          cacheTtl: 1800,
          cacheEverything: true
        }
      });

      if (!res.ok) {
        errors.push(`${upstream}: ${res.status}`);
        continue;
      }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder().decode(bytes);

      const direct = tryParseJson(text);
      if (direct) {
        UPSTREAM = upstream;
        return direct;
      }

      // 尝试 hex 解码
      if (/^[0-9a-f]+$/i.test(text.trim())) {
        const hexBytes = hexToBytes(text.trim());
        const decoded = new TextDecoder().decode(hexBytes);
        const parsed = tryParseJson(decoded);
        if (parsed) {
          UPSTREAM = upstream;
          return parsed;
        }
      }

      // 尝试 JPEG 尾部 base64
      const jpegEnd = findJpegEnd(bytes);
      if (jpegEnd > 0) {
        const tail = new TextDecoder().decode(bytes.slice(jpegEnd));
        const parsed = parseBase64Tail(tail);
        if (parsed) {
          UPSTREAM = upstream;
          return parsed;
        }
      }
    } catch (e) {
      errors.push(`${upstream}: ${e.message}`);
    }
  }

  throw new Error(`All upstreams failed: ${errors.join("; ")}`);
}

function makeElderConfig(config) {
  const allSites = Array.isArray(config.sites) ? config.sites : [];

  // 如果配置有分类信息，优先使用分类
  const categories = config.categories || [];

  // 按优先级筛选站点
  const selected = [];
  const usedKeys = new Set();

  // 第一轮：按优先级顺序添加
  for (const key of PREFERRED_KEYS) {
    const site = allSites.find((s) => s.key === key && !usedKeys.has(s.key));
    if (site && !isBlockedSite(site)) {
      selected.push(site);
      usedKeys.add(site.key);
    }
  }

  // 第二轮：添加其他站点（最多32个）
  for (const site of allSites) {
    if (usedKeys.has(site.key)) continue;
    if (isBlockedSite(site)) continue;
    if (selected.length >= 32) break;
    selected.push(site);
    usedKeys.add(site.key);
  }

  // 处理直播源
  const lives = Array.isArray(config.lives)
    ? config.lives.filter((live) => !isBlockedText(`${live.name || ""} ${live.url || ""}`))
    : [];

  return {
    spider: config.spider,
    wallpaper: config.wallpaper || "",
    logo: config.logo || "",
    sites: selected,
    lives,
    flags: config.flags || [],
    parsers: config.parsers || [],
    rules: config.rules || [],
    ads: config.ads || []
  };
}

function isBlockedSite(site) {
  const text = JSON.stringify(site).toLowerCase();
  if (isBlockedText(text)) return true;
  if (site.searchable === 1 && site.quickSearch === 0 && String(site.name || "").includes("搜")) {
    return true;
  }
  return false;
}

function isBlockedText(text) {
  const lower = text.toLowerCase();
  return BLOCK_WORDS.some((word) => lower.includes(word.toLowerCase()));
}

function tryParseJson(text) {
  try {
    return JSON.parse(cleanJsonText(text));
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleanJsonText(text.slice(start, end + 1)));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function cleanJsonText(text) {
  return text
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function parseBase64Tail(tail) {
  const compact = tail.replace(/[^A-Za-z0-9+/=]/g, "");
  const candidates = ["eyJ", "ew0K", "ewo", "ewog", "ew"];

  for (const marker of candidates) {
    const index = compact.indexOf(marker);
    if (index < 0) continue;

    try {
      const decoded = fromBase64Utf8(compact.slice(index));
      const parsed = tryParseJson(decoded);
      if (parsed) return parsed;
    } catch {
      // Try the next marker.
    }
  }

  return null;
}

function findJpegEnd(bytes) {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      return i + 2;
    }
  }
  return -1;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64Utf8(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function commonHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=1800"
  };
}

function htmlPage(request) {
  const origin = new URL(request.url).origin;
  return new Response(
    `OK影视老人版配置地址：

${origin}/${TOKEN}

当前上游：
${UPSTREAM}

可用上游列表：
${UPSTREAM_URLS.map((u, i) => `${i + 1}. ${u}`).join("\n")}

请在 OK影视/影视仓/TVBox 的配置地址里填写上面这一行。`,
    {
      headers: commonHeaders("text/plain;charset=utf-8")
    }
  );
}

function handleConfig(request) {
  const url = new URL(request.url);

  // 设置上游
  if (url.searchParams.has("upstream")) {
    const idx = parseInt(url.searchParams.get("upstream")) - 1;
    if (idx >= 0 && idx < UPSTREAM_URLS.length) {
      UPSTREAM = UPSTREAM_URLS[idx];
      return new Response(`上游已切换为: ${UPSTREAM}`, {
        headers: commonHeaders("text/plain;charset=utf-8")
      });
    }
    return new Response("无效的上游索引", { status: 400 });
  }

  // 显示配置状态
  return new Response(
    `当前配置状态：

访问口令: ${TOKEN}
当前上游: ${UPSTREAM}

可用上游列表：
${UPSTREAM_URLS.map((u, i) => `${i + 1}. ${u}${u === UPSTREAM ? " (当前)" : ""}`).join("\n")}

切换上游：
${origin}/config?upstream=1

配置地址：
${origin}/${TOKEN}`,
    {
      headers: commonHeaders("text/plain;charset=utf-8")
    }
  );
}
