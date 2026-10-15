import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

async function parseAvailability(message, month) {
  if (!process.env.OPENAI_API_KEY) throw new Error('尚未設定 AI 服務金鑰。');
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      available: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { weekday: { type: 'integer', minimum: 0, maximum: 6 }, start: { type: 'string' }, end: { type: 'string' }, date: { type: ['string', 'null'] } }, required: ['weekday', 'start', 'end', 'date'] } },
      unavailableDates: { type: 'array', items: { type: 'string' } },
      needsClarification: { type: 'boolean' }, clarification: { type: 'string' },
      summary: { type: 'string' }
    }, required: ['available', 'unavailableDates', 'needsClarification', 'clarification', 'summary']
  };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini', store: false,
      instructions: `你是台灣皮拉提斯課程的排課助理。把學生的自然語言回覆轉成可核對的時間資料。這次排課月份是 ${month}。星期使用 0=週日、1=週一、…、6=週六。台灣用語「平日」代表週一至週五，絕不能把週六、週日算進平日；週末／假日代表週六、週日。時間用 24 小時制 HH:MM。只記錄明確說可以的時間；「晚上」若沒有明確起訖，預設 18:00–21:00 並在 summary 說明這是推定。排除條款放入 unavailableDates（僅明確日期）。若月份、日期、時間或語意有歧義，needsClarification=true 並用繁體中文在 clarification 提一個最重要的問題。不要把推定當成已確認。summary 用繁體中文簡述理解結果。`,
      input: [{ role: 'user', content: `月份：${month}\n學生回覆：${message}` }],
      text: { format: { type: 'json_schema', name: 'availability_parse', strict: true, schema } }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'AI 解析暫時失敗，請稍後再試。');
  const text = data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!text) throw new Error('AI 沒有回傳可讀的時段結果。');
  const result = JSON.parse(text);
  // Keep common Taiwanese day-group wording deterministic even if the model over-includes days.
  if (/平日/.test(message) && !/(含|包括|也含|包含).{0,5}(週末|假日|週六|週日)/.test(message)) {
    result.available = result.available.filter(slot => slot.weekday >= 1 && slot.weekday <= 5);
  }
  const weekdayTerms = [
    { day: 0, terms: '週日|星期日|禮拜日|週天|禮拜天' },
    { day: 1, terms: '週一|星期一|禮拜一' },
    { day: 2, terms: '週二|星期二|禮拜二' },
    { day: 3, terms: '週三|星期三|禮拜三' },
    { day: 4, terms: '週四|星期四|禮拜四' },
    { day: 5, terms: '週五|星期五|禮拜五' },
    { day: 6, terms: '週六|星期六|禮拜六' },
  ];
  const excludedDays = new Set();
  for (const item of weekdayTerms) {
    const match = message.match(new RegExp(`(?:${item.terms})(?:[^，。；\\n]{0,6})(?:不行|不可以|不能|不方便|沒空|沒有空|除外|不約)`));
    if (match) excludedDays.add(item.day);
  }
  if (excludedDays.size) result.available = result.available.filter(slot => !excludedDays.has(slot.weekday));
  return result;
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/parse') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 20_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { message, month } = JSON.parse(raw || '{}');
        if (typeof message !== 'string' || !message.trim()) throw new Error('請先貼上學生的回覆。');
        const result = await parseAvailability(message.slice(0, 5000), String(month || '下個月'));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: error.message || '解析失敗' }));
      }
    });
    return;
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^([/\\])+/, '');
  try {
    const content = await readFile(join(root, file));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(process.env.PORT || 3000, '127.0.0.1', () => console.log(`排課工作台已啟動：http://localhost:${process.env.PORT || 3000}`));
