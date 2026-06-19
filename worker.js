/*
 * OK影视老人版 - Cloudflare Worker
 * 特点：热播置顶、过滤网盘广告、兼容老电视
 */

// 上游源列表
const UPSTREAM_URLS = [
  "http://www.饭太硬.cc/tv",
  "http://fty.xxooo.cf/tv",
  "https://raw.githubusercontent.com/tushen6/Tomorrow/main/tvbox.json",
  "https://raw.fastgit.org/tushen6/Tomorrow/main/tvbox.json"
];

// 优先显示的站点（热播置顶）
const PREFERRED_KEYS = ["热播", "玩偶", "厂长", "立播", "荐片", "糯米", "文采", "光影",
  "原创", "视界", "播客", "米陌", "剧圈", "奥特", "咕咕", "Dm84",
  "Anime1", "Bili", "Biliych", "dr_兔小贝", "少儿教育", "小学课堂",
  "初中课堂", "高中教育", "MTV", "MTV1", "有声小说", "Aid"];

// 需要过滤的关键词
const BLOCK_WORDS = ["cookie", "token", "quark", "baidu", "aliyun", "alipan", "uc",
  "115", "189", "webdav", "alist", "云盘", "网盘", "夸克", "百度",
  "阿里", "天翼", "推送", "搜搜", "盘搜", "盘她", "盘他", "配置", "切源", "广告", "勿信",
  "四盘", "三盘", "两盘", "云", "盘", "领取", "免费", "容量", "嘟"];

// 需要过滤的站点名称（精确匹配）
const BLOCK_SITE_NAMES = ["领取嘟嘟盘免费容量", "我的云盘", "聚剧剧", "聚盘搜"];

// 文本替换规则
const TEXT_REPLACEMENTS = [
  { from: "去【太太太硬了】领取嘟嘟盘免费容量", to: "梦回唐朝格调酒店欢迎您！" },
  { from: "领取嘟嘟盘免费容量", to: "精彩内容推荐" },
  { from: "太太太硬了", to: "影视精选" }
];

// 老电视UA识别
const TV_UA_KEYWORDS = ["okhttp", "iptv", "player", "android", "tvbox", "mi", "hisense", 
  "tcl", "skyworth", "changhong", "philips", "lg", "samsung", "sony", "panasonic", 
  "sharp", "tongson", "baofeng", "storm", "letv", "huawei", "honor", "oppo", "vidaa"];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // 信息页面
    if (url.pathname === "/info") return infoPage(request);
    
    // 只允许根路径访问
    if (url.pathname !== "/" && url.pathname !== "") return new Response("Not found", { status: 404 });

    // 尝试所有上游源
    for (const upstream of UPSTREAM_URLS) {
      try {
        const res = await fetch(upstream, { 
          cf: { cacheTtl: 1800 },
          headers: { "User-Agent": "okhttp/4.0" },
          redirect: "follow"
        });
        
        if (!res.ok) continue;
        
        const text = await res.text();
        
        // 跳过HTML页面
        if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) continue;
        
        // 尝试解析JSON
        let config = parseJsonSafely(text);
        if (!config) {
          try {
            config = parseJsonSafely(atob(text.replace(/\s/g, "")));
          } catch {}
        }
        
        if (config && config.sites) {
          const clean = makeElderConfig(config);
          return new Response(JSON.stringify(clean), {
            headers: { "Content-Type": "application/json;charset=utf-8", "Access-Control-Allow-Origin": "*" }
          });
        }
        
        // 直接返回原始内容
        return new Response(text, { 
          headers: { "Content-Type": "application/json;charset=utf-8", "Access-Control-Allow-Origin": "*" }
        });
      } catch {}
    }
    
    return new Response("Config load failed: All upstreams unavailable", { status: 502 });
  }
};

// 安全解析JSON
function parseJsonSafely(text) {
  try {
    text = text.replace(/^\uFEFF/, "").trim();
    return JSON.parse(text);
  } catch {
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(text.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
      }
    } catch {}
  }
  return null;
}

// 文本替换
function replaceText(text) {
  if (!text) return text;
  for (const { from, to } of TEXT_REPLACEMENTS) {
    text = text.replace(new RegExp(from.replace(/[\\[\\]{}()*+?^$.|]/g, "\\$&"), "g"), to);
  }
  return text;
}

// 递归替换对象中的所有文本
function replaceAllText(obj) {
  if (typeof obj === "string") {
    return replaceText(obj);
  } else if (Array.isArray(obj)) {
    return obj.map(item => replaceAllText(item));
  } else if (typeof obj === "object" && obj !== null) {
    const result = {};
    for (const key in obj) {
      result[key] = replaceAllText(obj[key]);
    }
    return result;
  }
  return obj;
}

// 构建老人版配置
function makeElderConfig(config) {
  const allSites = Array.isArray(config.sites) ? config.sites : [];
  
  // 过滤站点
  const filteredSites = allSites.filter(site => {
    const siteName = (site.name || "").toLowerCase().trim();
    const siteKey = (site.key || "").toLowerCase().trim();
    
    // 精确匹配过滤站点名称
    for (const blockedName of BLOCK_SITE_NAMES) {
      if ((site.name || "").includes(blockedName)) {
        return false;
      }
    }
    
    // 关键词过滤
    for (const word of BLOCK_WORDS) {
      if (siteName.includes(word.toLowerCase()) || siteKey.includes(word.toLowerCase())) {
        return false;
      }
    }
    
    return true;
  });
  
  // 热播置顶：优先显示PREFERRED_KEYS中的站点
  const prioritySites = filteredSites.filter(s => PREFERRED_KEYS.includes(s.key));
  const otherSites = filteredSites.filter(s => !PREFERRED_KEYS.includes(s.key)).slice(0, 32 - prioritySites.length);
  
  // 构建最终配置并替换所有文本
  const result = {
    spider: config.spider || "", 
    wallpaper: config.wallpaper || "", 
    logo: config.logo || "",
    sites: [...prioritySites, ...otherSites], 
    lives: [],  // 清空直播列表
    flags: config.flags || [], 
    parsers: config.parsers || [], 
    rules: config.rules || [], 
    ads: []     // 清空广告列表
  };
  
  // 替换所有文本内容（包括标题等）
  return replaceAllText(result);
}

// 信息页面
function infoPage(request) {
  const origin = new URL(request.url).origin;
  return new Response(
    `OK影视老人版\n\n` +
    `配置地址：${origin}/\n\n` +
    `特点：\n` +
    `- 热播置顶：打开就能看\n` +
    `- 过滤网盘：移除云盘、夸克等站点\n` +
    `- 过滤广告：移除推送、领取容量等站点\n` +
    `- 简化界面：清空直播和广告\n` +
    `- 兼容老电视：支持暴风TV、小米、海信等`,
    { headers: { "Content-Type": "text/plain;charset=utf-8" } }
  );
}
