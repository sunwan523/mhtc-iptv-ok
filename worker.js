/*
 * OK影视老人版 - Cloudflare Worker
 * 特点：热播置顶、上游可配置、兼容老旧电视
 */

const TOKEN = "abc123";

const UPSTREAM_URLS = [
  "https://www.xn--sss604efuw.cc/tv",
  "https://www.dmtv.ml/tv",
  "https://www.dmtv.ml/top",
  "https://cdn.jsdelivr.net/gh/bean666/TV@main/TV.json",
  "https://raw.fastgit.org/bean666/TV/main/TV.json"
];
let UPSTREAM = UPSTREAM_URLS[0];

const LEGACY_TV_COMPATIBLE = true;

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
  "cookie", "token", "quark", "baidu", "aliyun", "alipan", "uc",
  "115", "189", "webdav", "alist", "云盘", "网盘", "夸克", "百度",
  "阿里", "天翼", "推送", "搜搜", "盘搜", "盘她", "盘他", "配置", "切源", "广告", "勿信"
];

const PLAYER_UA_WORDS = [
  "okhttp", "iptv", "player", "vlc", "tivimate", "kodi", "cfnetwork", "android", "tvbox",
  "mi", "hisense", "tcl", "skyworth", "changhong", "philips", "lg", "samsung",
  "sony", "panasonic", "sharp", "tongson", "baofeng", "storm", "leTV", "letv",
  "huawei", "honor", "oppo", "vidaa"
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/config") return handleConfig(request, url.origin);
    if (url.pathname === "/info") return htmlPage(request);
    if (url.pathname !== "/" && url.pathname !== "") return new Response("Not found", { status: 404 });

    try {
      const source = await loadConfig();
      const clean = makeElderConfig(source);
      const body = JSON.stringify(clean);
      const ua = (request.headers.get("user-agent") || "").toLowerCase();
      const isPlayer = PLAYER_UA_WORDS.some((word) => ua.includes(word));

      return new Response(isPlayer ? body : toBase64Utf8(body), {
        headers: commonHeaders(isPlayer ? "application/json;charset=utf-8" : "text/plain;charset=utf-8")
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
  const errors = [];
  for (const upstream of UPSTREAM_URLS) {
    try {
      const res = await fetch(upstream, {
        headers: { "user-agent": LEGACY_TV_COMPATIBLE ? "Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36" : "okhttp/4.0" },
        cf: { cacheTtl: 1800, cacheEverything: true }
      });
      if (!res.ok) { errors.push(`${upstream}: ${res.status}`); continue; }

      const bytes = new Uint8Array(await res.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      let parsed = tryParseJson(text);
      if (parsed) { UPSTREAM = upstream; return parsed; }

      if (/^[0-9a-f]+$/i.test(text.trim())) {
        parsed = tryParseJson(new TextDecoder().decode(hexToBytes(text.trim())));
        if (parsed) { UPSTREAM = upstream; return parsed; }
      }

      const jpegEnd = findJpegEnd(bytes);
      if (jpegEnd > 0) {
        parsed = parseBase64Tail(new TextDecoder().decode(bytes.slice(jpegEnd)));
        if (parsed) { UPSTREAM = upstream; return parsed; }
      }
    } catch (e) { errors.push(`${upstream}: ${e.message}`); }
  }
  throw new Error(`All upstreams failed: ${errors.join("; ")}`);
}

function makeElderConfig(config) {
  const allSites = Array.isArray(config.sites) ? config.sites : [];
  const selected = [];
  const usedKeys = new Set();

  for (const key of PREFERRED_KEYS) {
    const site = allSites.find((s) => s.key === key && !usedKeys.has(s.key));
    if (site && !isBlockedSite(site)) { selected.push(site); usedKeys.add(site.key); }
  }

  for (const site of allSites) {
    if (usedKeys.has(site.key) || isBlockedSite(site) || selected.length >= 32) continue;
    selected.push(site); usedKeys.add(site.key);
  }

  const lives = Array.isArray(config.lives)
    ? config.lives.filter((live) => !isBlockedText(`${live.name || ""} ${live.url || ""}`))
    : [];

  return {
    spider: config.spider, wallpaper: config.wallpaper || "", logo: config.logo || "",
    sites: selected, lives, flags: config.flags || [],
    parsers: config.parsers || [], rules: config.rules || [], ads: config.ads || []
  };
}

function isBlockedSite(site) {
  if (isBlockedText(JSON.stringify(site).toLowerCase())) return true;
  if (site.searchable === 1 && site.quickSearch === 0 && String(site.name || "").includes("搜")) return true;
  return false;
}

function isBlockedText(text) {
  return BLOCK_WORDS.some((word) => text.toLowerCase().includes(word.toLowerCase()));
}

function tryParseJson(text) {
  try { return JSON.parse(cleanJsonText(text)); } catch {
    const start = text.indexOf("{"); const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleanJsonText(text.slice(start, end + 1))); } catch { return null; }
    }
    return null;
  }
}

function cleanJsonText(text) {
  return text.replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}\]])/g, "$1").trim();
}

function parseBase64Tail(tail) {
  const compact = tail.replace(/[^A-Za-z0-9+/=]/g, "");
  for (const marker of ["eyJ", "ew0K", "ewo", "ewog", "ew"]) {
    const index = compact.indexOf(marker);
    if (index < 0) continue;
    try { return tryParseJson(fromBase64Utf8(compact.slice(index))); } catch { continue; }
  }
  return null;
}

function findJpegEnd(bytes) {
  for (let i = 0; i < bytes.length - 1; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return i + 2;
  }
  return -1;
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) { bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); }
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
  for (let i = 0; i < binary.length; i++) { bytes[i] = binary.charCodeAt(i); }
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
    `OK影视老人版配置地址：\n\n${origin}/${TOKEN}\n\n当前上游：${UPSTREAM}\n\n可用上游：\n${UPSTREAM_URLS.map((u, i) => `${i + 1}. ${u}`).join("\n")}`,
    { headers: commonHeaders("text/plain;charset=utf-8") }
  );
}

function handleConfig(request, origin) {
  const url = new URL(request.url);
  if (url.searchParams.has("upstream")) {
    const idx = parseInt(url.searchParams.get("upstream")) - 1;
    if (idx >= 0 && idx < UPSTREAM_URLS.length) {
      UPSTREAM = UPSTREAM_URLS[idx];
      return new Response(`上游已切换为: ${UPSTREAM}`, { headers: commonHeaders("text/plain;charset=utf-8") });
    }
    return new Response("无效的上游索引", { status: 400 });
  }
  return new Response(
    `当前配置：\n口令: ${TOKEN}\n上游: ${UPSTREAM}\n\n上游列表：\n${UPSTREAM_URLS.map((u, i) => `${i + 1}. ${u}${u === UPSTREAM ? " (当前)" : ""}`).join("\n")}\n\n切换上游：${origin}/config?upstream=1\n配置地址：${origin}/${TOKEN}`,
    { headers: commonHeaders("text/plain;charset=utf-8") }
  );
}
