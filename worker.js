/*
 * OK影视老人版 - Cloudflare Worker
 */

const UPSTREAM = "http://www.饭太硬.cc/tv";

const PREFERRED_KEYS = ["热播", "玩偶", "厂长", "立播", "荐片", "糯米", "文采", "光影",
  "原创", "视界", "播客", "米陌", "剧圈", "奥特", "咕咕", "Dm84",
  "Anime1", "Bili", "Biliych", "dr_兔小贝", "少儿教育"];

const BLOCK_WORDS = ["cookie", "token", "quark", "baidu", "aliyun", "alipan", "uc",
  "115", "189", "webdav", "alist", "云盘", "网盘", "夸克", "百度",
  "阿里", "天翼", "推送", "搜搜", "盘搜", "盘她", "盘他", "配置", "切源", "广告", "勿信",
  "四盘", "三盘", "两盘", "云", "盘", "领取", "免费", "容量", "嘟"];

const BLOCK_SITE_NAMES = ["领取嘟嘟盘免费容量", "我的云盘", "聚剧剧", "聚盘搜"];

const TEXT_REPLACEMENTS = [
  { from: "去【太太太硬了】领取嘟嘟盘免费容量", to: "梦回唐朝格调酒店欢迎您！" },
  { from: "领取嘟嘟盘免费容量", to: "精彩内容推荐" },
  { from: "太太太硬了", to: "影视精选" }
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === "/info") {
      const origin = new URL(request.url).origin;
      return new Response(`OK影视老人版\n\n配置地址：${origin}/`, { 
        headers: { "Content-Type": "text/plain;charset=utf-8" } 
      });
    }
    
    if (url.pathname !== "/" && url.pathname !== "") {
      return new Response("Not found", { status: 404 });
    }

    // 尝试所有上游源
    try {
      // 完整读取上游内容
      const res = await fetch(UPSTREAM, { 
        cf: { cacheTtl: 1800 },
        headers: { "User-Agent": "okhttp/4.0" }
      });
      
      if (!res.ok) {
        return new Response(`HTTP error: ${res.status}`, { status: res.status });
      }
      
      // 读取原始内容
      const text = await res.text();
      
      // 跳过HTML页面
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
        return new Response("Upstream returned HTML", { status: 502 });
      }
      
      // 解析JSON（支持多种格式）
      let config = await parseConfig(text);
      
      if (!config || !config.sites) {
        return new Response("Invalid config format", { status: 502 });
      }
      
      // 处理配置：过滤、排序、替换
      const finalConfig = processConfig(config);
      
      // 返回结果
      return new Response(JSON.stringify(finalConfig), {
        headers: { "Content-Type": "application/json;charset=utf-8", "Access-Control-Allow-Origin": "*" }
      });
    } catch (e) {
      return new Response(`Config load failed: ${e.message}`, { status: 502 });
    }
  }
};

// 解析配置（支持多种格式）
async function parseConfig(text) {
  text = text.replace(/^\uFEFF/, "").trim();
  
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {}
  
  // 尝试修复JSON后解析
  try {
    const fixed = text.replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixed);
  } catch {}
  
  // 尝试提取JSON部分
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1"));
    }
  } catch {}
  
  // 尝试base64解码
  try {
    const decoded = atob(text.replace(/\s/g, ""));
    return JSON.parse(decoded);
  } catch {}
  
  // 尝试base64解码后提取
  try {
    const decoded = atob(text.replace(/\s/g, ""));
    const start = decoded.indexOf("{");
    const end = decoded.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(decoded.slice(start, end + 1));
    }
  } catch {}
  
  return null;
}

// 处理配置
function processConfig(config) {
  const allSites = Array.isArray(config.sites) ? config.sites : [];
  
  // 1. 过滤站点
  const filteredSites = allSites.filter(site => {
    const name = (site.name || "").toLowerCase();
    const key = (site.key || "").toLowerCase();
    
    // 精确匹配过滤
    for (const blockedName of BLOCK_SITE_NAMES) {
      if ((site.name || "").includes(blockedName)) return false;
    }
    
    // 关键词过滤
    for (const word of BLOCK_WORDS) {
      if (name.includes(word) || key.includes(word)) return false;
    }
    
    return true;
  });
  
  // 2. 热播置顶排序
  const prioritySites = filteredSites.filter(s => PREFERRED_KEYS.includes(s.key));
  const otherSites = filteredSites.filter(s => !PREFERRED_KEYS.includes(s.key)).slice(0, 32 - prioritySites.length);
  
  // 3. 构建结果对象
  const result = {
    ...config,
    sites: [...prioritySites, ...otherSites],
    lives: [],
    ads: []
  };
  
  // 4. 替换所有文本内容
  return replaceAllText(result);
}

// 替换单个文本
function replaceText(text) {
  if (typeof text !== "string") return text;
  for (const { from, to } of TEXT_REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  return text;
}

// 递归替换所有文本
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
