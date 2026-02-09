const http = require('http');
const { URL } = require('url');
// 动态引入 node-fetch，兼容 ESM 和 CommonJS
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// ---------- 配置区 (保持原样) ----------
const JSON_SOURCES = {
  'jin18': 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jin18.json',
  'jingjian': 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/jingjian.json',
  'full': 'https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/LunaTV-config.json'
};

const FORMAT_CONFIG = {
  '0': { proxy: false, base58: false }, 'raw': { proxy: false, base58: false },
  '1': { proxy: true, base58: false }, 'proxy': { proxy: true, base58: false },
  '2': { proxy: false, base58: true }, 'base58': { proxy: false, base58: true },
  '3': { proxy: true, base58: true }, 'proxy-base58': { proxy: true, base58: true }
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ---------- 辅助函数 ----------

// Base58 编码
function base58Encode(obj) {
  const str = JSON.stringify(obj);
  const bytes = Buffer.from(str); // Node.js 使用 Buffer
  let intVal = 0n;
  for (let b of bytes) { intVal = (intVal << 8n) + BigInt(b); }
  
  let result = '';
  while (intVal > 0n) {
    const mod = intVal % 58n;
    result = BASE58_ALPHABET[Number(mod)] + result;
    intVal = intVal / 58n;
  }
  for (let b of bytes) { if (b === 0) result = BASE58_ALPHABET[0] + result; else break; }
  return result;
}

// JSON 替换逻辑
function addOrReplacePrefix(obj, newPrefix) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(item => addOrReplacePrefix(item, newPrefix));
  
  const newObj = {};
  for (const key in obj) {
    if (key === 'api' && typeof obj[key] === 'string') {
      let apiUrl = obj[key];
      const urlIndex = apiUrl.indexOf('?url=');
      if (urlIndex !== -1) apiUrl = apiUrl.slice(urlIndex + 5);
      if (!apiUrl.startsWith(newPrefix)) apiUrl = newPrefix + apiUrl;
      newObj[key] = apiUrl;
    } else {
      newObj[key] = addOrReplacePrefix(obj[key], newPrefix);
    }
  }
  return newObj;
}

// ---------- 核心服务器逻辑 ----------

const server = http.createServer(async (req, res) => {
  // 1. 设置通用 CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  };

  // 处理预检请求 (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  try {
    // 2. 解析 URL
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const currentOrigin = `${protocol}://${host}`;
    const parsedUrl = new URL(req.url, currentOrigin);
    
    const targetUrlParam = parsedUrl.searchParams.get('url');
    const formatParam = parsedUrl.searchParams.get('format');
    const sourceParam = parsedUrl.searchParams.get('source');
    const prefixParam = parsedUrl.searchParams.get('prefix');

    // 3. 健康检查
    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, corsHeaders);
      res.end('OK');
      return;
    }

    // 4. 功能分支 A: 代理请求 (?url=...)
    if (targetUrlParam) {
        if (!/^https?:\/\//i.test(targetUrlParam)) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: 'Invalid URL' }));
            return;
        }

        try {
            const proxyRes = await fetch(targetUrlParam, {
                method: req.method,
                headers: { 'User-Agent': 'Mozilla/5.0 NodeProxy/1.0' }
            });
            
            // 复制响应头 (排除某些头)
            const headers = { ...corsHeaders };
            // 这里可以把 proxyRes.headers 里的内容转发回去，视情况而定
            
            res.writeHead(proxyRes.status, headers);
            // 流式传输 Body
            const arrayBuffer = await proxyRes.arrayBuffer();
            res.end(Buffer.from(arrayBuffer));
        } catch (err) {
            res.writeHead(502, corsHeaders);
            res.end(JSON.stringify({ error: 'Proxy Failed', details: err.message }));
        }
        return;
    }

    // 5. 功能分支 B: 格式化 JSON (?format=...)
    if (formatParam !== null) {
        const config = FORMAT_CONFIG[formatParam];
        if (!config) {
            res.writeHead(400, corsHeaders);
            res.end(JSON.stringify({ error: 'Invalid format' }));
            return;
        }

        const selectedSource = JSON_SOURCES[sourceParam] || JSON_SOURCES['full'];
        
        // 获取远程 JSON
        const sourceRes = await fetch(selectedSource);
        const data = await sourceRes.json();
        
        // 替换前缀
        const finalPrefix = prefixParam || (currentOrigin + '/?url=');
        const newData = config.proxy ? addOrReplacePrefix(data, finalPrefix) : data;

        // 输出
        if (config.base58) {
            res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/plain;charset=UTF-8' });
            res.end(base58Encode(newData));
        } else {
            res.writeHead(200, corsHeaders);
            res.end(JSON.stringify(newData));
        }
        return;
    }

    // 6. 默认分支: 返回 HTML 首页
    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Zeabur API Proxy</title>
      <style>body{font-family:sans-serif;padding:20px;max-width:800px;margin:0 auto;line-height:1.6}code{background:#f4f4f4;padding:2px 5px;border-radius:3px}</style>
    </head>
    <body>
      <h1>✅ Zeabur API 服务运行中</h1>
      <p>服务地址: <code>${currentOrigin}</code></p>
      <h3>使用示例:</h3>
      <ul>
        <li><b>代理接口:</b> ${currentOrigin}/?url=https://cj.lziapi.com/api.php...</li>
        <li><b>订阅 JSON:</b> ${currentOrigin}/?format=1&source=full</li>
      </ul>
    </body>
    </html>`;
    
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);

  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
  }
});

// Zeabur 会提供 PORT 环境变量，默认 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
