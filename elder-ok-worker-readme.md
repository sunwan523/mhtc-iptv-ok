# OK影视老人版 Worker

这个 Worker 会从上游读取配置，自动解码伪装格式，为老人用户提供更适合的站点顺序。

默认入口：

```text
https://你的Worker域名/abc123
```

## 特点

- **热播置顶**：热播剧集放在最前面，打开就能看
- **上游可切换**：支持多个上游源，默认使用 Tomorrow
- **兼容老电视**：支持小米、海信、TCL、创维、三星、LG、飞利浦等主流品牌电视
- **自动隐藏**：网盘、云盘、夸克、百度、UC、115 等无关内容
- **多源备用**：上游失效时自动切换到备用源

## 上游配置

默认上游列表（可修改）：
1. `https://github.com/tushen6/Tomorrow/raw/main/tvbox.json`
2. `https://www.xn--sss604efuw.cc/tv`

修改上游只需编辑代码中的 `UPSTREAM_URLS` 数组。

## 部署

1. 在 Cloudflare Workers 新建 Worker
2. 把 `elder-ok-worker.js` 内容粘贴进去
3. 保存并部署
4. OK影视里填写：

```text
https://你的Worker域名/abc123
```

## 常用修改

改访问口令：
```js
const TOKEN = "abc123";
```

改上游列表：
```js
const UPSTREAM_URLS = [
  "https://github.com/tushen6/Tomorrow/raw/main/tvbox.json",
  "https://你的上游地址"
];
```

改站点优先级（数字越小越靠前）：
```js
const PREFERRED_KEYS = [
  "热播",  // 热播最前
  "玩偶",
  "厂长"
];
```

隐藏更多站点，往 `BLOCK_WORDS` 加关键词：
```js
BLOCK_WORDS.push("关键词");
```

## 配置面板

访问 `/config` 查看当前配置状态：
```
https://你的Worker域名/config
```

切换上游：
```
https://你的Worker域名/config?upstream=2
```

## 老电视兼容

Worker 内置了主流电视品牌 UA 识别：
- 小米 (mi)
- 海信 (hisense)
- TCL (tcl)
- 创维 (skyworth)
- 长虹 (changhong)
- 飞利浦 (philips)
- LG (lg)
- 三星 (samsung)

如果某台老电视无法使用，可以检查其 User-Agent 是否包含设备品牌名称。
