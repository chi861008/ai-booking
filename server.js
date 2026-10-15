import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('.', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const lineInboxFile = process.env.LINE_INBOX_FILE || join(root, '.local-data', 'line-inbox.json');
let lineInbox = [];
try { lineInbox = JSON.parse(await readFile(lineInboxFile, 'utf8')); if (!Array.isArray(lineInbox)) lineInbox = []; } catch { /* first run */ }
let inboxWrite = Promise.resolve();

function lineConfigured() { return Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN); }
function isProduction() { return process.env.NODE_ENV === 'production'; }
function dashboardAuthRequired() { return isProduction() && Boolean(process.env.DASHBOARD_PASSWORD); }
function sessionSignature(expiresAt) { return createHmac('sha256', process.env.DASHBOARD_PASSWORD || 'local-prototype').update(String(expiresAt)).digest('base64url'); }
function isDashboardAuthorized(req) {
  if (!dashboardAuthRequired()) return true;
  const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('ai_booking_session='))?.slice('ai_booking_session='.length);
  const [expiresAt, signature] = (token || '').split('.');
  if (!/^\d+$/.test(expiresAt || '') || Number(expiresAt) <= Date.now() || !signature) return false;
  const expected = Buffer.from(sessionSignature(expiresAt));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
function dashboardReady(req) { return !isProduction() || (dashboardAuthRequired() && isDashboardAuthorized(req)); }
function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64'); } catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function persistInbox() {
  inboxWrite = inboxWrite.then(async () => {
    await mkdir(dirname(lineInboxFile), { recursive: true });
    const temp = `${lineInboxFile}.tmp`;
    await writeFile(temp, JSON.stringify(lineInbox.slice(-1000)), { mode: 0o600 });
    await rename(temp, lineInboxFile);
  });
  return inboxWrite;
}
async function saveLineEvents(events) {
  const known = new Set(lineInbox.map(item => item.webhookEventId || item.messageId));
  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text' || !event.source) continue;
    const messageId = String(event.message.id || '');
    const eventId = String(event.webhookEventId || messageId);
    if (!messageId || known.has(eventId)) continue;
    const source = event.source;
    const lineUserId = source.userId ? String(source.userId) : '';
    const name = lineUserId ? `LINE 學生 ${lineUserId.slice(-5)}` : 'LINE 群組訊息';
    lineInbox.push({
      source: 'line', webhookEventId: eventId, messageId,
      studentId: lineUserId || `${source.type}:${source.groupId || source.roomId || 'unknown'}`,
      lineUserId: lineUserId || null, sourceType: source.type,
      groupId: source.groupId || null, name, avatar: name.slice(-1),
      message: String(event.message.text).slice(0, 5000),
      receivedAt: new Date(Number(event.timestamp) || Date.now()).toISOString(),
      periodKey: '', status: '待解析',
    });
    known.add(eventId);
  }
  if (lineInbox.length > 1000) lineInbox = lineInbox.slice(-1000);
  await persistInbox();
}

async function parseAvailability(message, { activePeriod, receivedAt, knownPeriods }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('尚未設定 AI 服務金鑰。');
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      targetPeriod: { type: ['string', 'null'], description: '排課月份，格式 YYYY-MM；無法判斷時為 null' },
      periodBasis: { type: 'string', enum: ['explicit_month', 'relative_to_message_date', 'active_survey', 'unclear'] },
      intent: { type: 'string', enum: ['new_availability', 'change_availability', 'date_exception', 'question', 'other'] },
      multiplePeriods: { type: 'boolean' },
      available: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { weekday: { type: 'integer', minimum: 0, maximum: 6 }, start: { type: 'string' }, end: { type: 'string' }, date: { type: ['string', 'null'] } }, required: ['weekday', 'start', 'end', 'date'] } },
      unavailableDates: { type: 'array', items: { type: 'string' } },
      needsClarification: { type: 'boolean' }, clarification: { type: 'string' },
      summary: { type: 'string' }
    }, required: ['targetPeriod', 'periodBasis', 'intent', 'multiplePeriods', 'available', 'unavailableDates', 'needsClarification', 'clarification', 'summary']
  };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini', store: false,
      instructions: `你是台灣皮拉提斯排課助理。請先判斷這一則訊息屬於哪個排課月份，再整理時段。\n訊息收到時間：${receivedAt || '未知'}。目前唯一開放收集的月份：${activePeriod || '無'}。已知出現過的排課月份：${(knownPeriods || []).join(', ') || '無'}。\n月份判定規則：明確寫「2026年11月」就使用 2026-11；只寫月份時，結合訊息收到時間及已知月份判斷年份。沒有提月份而且目前有開放收集月份時，使用目前開放月份，periodBasis=active_survey。若同一則訊息明確談到兩個以上月份，multiplePeriods=true、targetPeriod=null，請學生分月份回覆。若有兩種合理年份或月份不明，targetPeriod=null 並詢問年份／月份，不可猜。\nintent：首次提供時段用 new_availability；明確說改掉先前安排用 change_availability；只排除特定日期用 date_exception；問題用 question；其他內容用 other。\n星期使用 0=週日、1=週一、…、6=週六。台灣用語「平日」代表週一至週五，不含週末；週末／假日代表週六、週日。時間用 24 小時制 HH:MM。只記錄明確說可以的時間；「晚上」若沒有明確起訖，預設 18:00–21:00 並在 summary 說明這是推定。排除條款放入 unavailableDates（僅明確日期）。月份、日期、時間或語意有歧義時 needsClarification=true，clarification 用繁體中文提出最重要的一個問題。不要把推定當成已確認。summary 用繁體中文簡述理解結果。`,
      input: [{ role: 'user', content: `訊息內容：${message}` }],
      text: { format: { type: 'json_schema', name: 'availability_parse', strict: true, schema } }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'AI 解析暫時失敗，請稍後再試。');
  const text = data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!text) throw new Error('AI 沒有回傳可讀的時段結果。');
  const result = JSON.parse(text);
  const monthFromMessage = inferPeriod(message, { activePeriod, receivedAt, knownPeriods });
  if (monthFromMessage.multiplePeriods) {
    result.multiplePeriods = true;
    result.targetPeriod = null;
    result.periodBasis = 'unclear';
    result.needsClarification = true;
    result.clarification = '這則訊息提到不只一個月份，請分月份回覆時段。';
  } else if (monthFromMessage.ambiguous) {
    result.targetPeriod = null;
    result.periodBasis = 'unclear';
    result.needsClarification = true;
    result.clarification ||= '請補充這則訊息要安排的年份與月份。';
  } else if (monthFromMessage.targetPeriod) {
    result.targetPeriod = monthFromMessage.targetPeriod;
    result.periodBasis = monthFromMessage.basis;
  } else if (result.periodBasis === 'active_survey' && !result.targetPeriod) result.targetPeriod = activePeriod || null;
  if (!result.targetPeriod || !/^\d{4}-(0[1-9]|1[0-2])$/.test(result.targetPeriod) || result.multiplePeriods) {
    result.targetPeriod = null;
    result.needsClarification = true;
    if (!result.clarification) result.clarification = result.multiplePeriods ? '這則訊息提到不只一個月份，請分月份回覆時間。' : '請問這些時段是要安排哪一年、哪一個月份？';
  }
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

function inferPeriod(message, { activePeriod, receivedAt, knownPeriods = [] }) {
  const received = new Date(receivedAt || Date.now());
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).formatToParts(received);
  const receivedYear = Number(parts.find(part => part.type === 'year')?.value);
  const receivedMonth = Number(parts.find(part => part.type === 'month')?.value);
  const fullYears = [...message.matchAll(/(20\d{2})\s*(?:年\s*|[-/年])\s*(1[0-2]|0?[1-9])\s*(?:月)?/g)].map(match => `${match[1]}-${String(Number(match[2])).padStart(2, '0')}`);
  const namedMonths = [...message.matchAll(/(?<!\d)(1[0-2]|0?[1-9])\s*月/g)].map(match => Number(match[1]));
  const explicitlyNamed = new Set(fullYears);
  if (explicitlyNamed.size > 1) return { multiplePeriods: true };
  if (explicitlyNamed.size === 1) {
    const explicit = [...explicitlyNamed][0];
    if (new Set(namedMonths).size > 1) return { multiplePeriods: true };
    return { targetPeriod: explicit, basis: 'explicit_month' };
  }
  const uniqueMonths = [...new Set(namedMonths)];
  if (uniqueMonths.length > 1) return { multiplePeriods: true };
  if (uniqueMonths.length === 1) {
    const month = uniqueMonths[0];
    const candidates = [...new Set(knownPeriods.filter(value => Number(value.slice(5)) === month))];
    if (activePeriod?.endsWith(`-${String(month).padStart(2, '0')}`)) return { targetPeriod: activePeriod, basis: 'explicit_month' };
    if (candidates.length === 1) return { targetPeriod: candidates[0], basis: 'explicit_month' };
    if (candidates.length > 1) return { ambiguous: true };
    let year = receivedYear;
    if (/明年/.test(message)) year += 1;
    else if (/去年/.test(message)) year -= 1;
    else if (month < receivedMonth) year += 1;
    if (!/今年|去年|明年/.test(message) && Math.abs(month - receivedMonth) > 5 && !activePeriod?.endsWith(`-${String(month).padStart(2, '0')}`)) return { ambiguous: true };
    return { targetPeriod: `${year}-${String(month).padStart(2, '0')}`, basis: 'explicit_month' };
  }
  if (/下個月|下个月|下月/.test(message)) {
    const d = new Date(Date.UTC(receivedYear, receivedMonth, 1));
    return { targetPeriod: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, basis: 'relative_to_message_date' };
  }
  if (/本月|這個月|这个月|當月|当月/.test(message)) return { targetPeriod: `${receivedYear}-${String(receivedMonth).padStart(2, '0')}`, basis: 'relative_to_message_date' };
  return activePeriod ? { targetPeriod: activePeriod, basis: 'active_survey' } : { ambiguous: true };
}

createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'POST' && pathname === '/api/line/login') {
    if (!dashboardAuthRequired()) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true })); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 5000) req.destroy(); });
    req.on('end', () => {
      try {
        const { password } = JSON.parse(raw || '{}');
        const expected = Buffer.from(process.env.DASHBOARD_PASSWORD);
        const supplied = Buffer.from(String(password || ''));
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) { res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '密碼不正確' })); return; }
        const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
        const secure = isProduction() ? '; Secure' : '';
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': `ai_booking_session=${expiresAt}.${sessionSignature(expiresAt)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}` });
        res.end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400); res.end('Invalid JSON'); }
    });
    return;
  }
  if (req.method === 'GET' && pathname === '/api/line/status') {
    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const passwordMissing = isProduction() && !process.env.DASHBOARD_PASSWORD;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ configured: lineConfigured() && !passwordMissing, receiveConfigured: Boolean(process.env.LINE_CHANNEL_SECRET) && !passwordMissing, sendConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN) && !passwordMissing, webhookPath: '/api/line/webhook', webhookUrl: base ? `${base}/api/line/webhook` : null, inboxCount: lineInbox.length, baseConfigured: Boolean(base), authRequired: dashboardAuthRequired(), authenticated: isDashboardAuthorized(req), dashboardPasswordMissing: passwordMissing }));
    return;
  }
  if (req.method === 'GET' && pathname === '/api/line/inbox') {
    if (!dashboardReady(req)) { res.writeHead(401); res.end('Dashboard login required'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ messages: lineInbox }));
    return;
  }
  if (req.method === 'POST' && pathname === '/api/line/broadcast') {
    if (!dashboardReady(req)) { res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '請先登入管理看板' })); return; }
    if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) { res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'LINE_CHANNEL_ACCESS_TOKEN 未設定' })); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 20_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { text: message } = JSON.parse(raw || '{}');
        if (typeof message !== 'string' || !message.trim() || message.length > 5000) throw new Error('通知內容不可空白或超過 5,000 字。');
        const result = await fetch('https://api.line.me/v2/bot/message/broadcast', {
          method: 'POST', headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ type: 'text', text: message.trim() }] }), signal: AbortSignal.timeout(15000),
        });
        if (!result.ok) throw new Error(`LINE 推播失敗（${result.status}）：${await result.text()}`);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: error.message || 'LINE 推播失敗' }));
      }
    });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/line/webhook') {
    if (!process.env.LINE_CHANNEL_SECRET) { res.writeHead(503); res.end('LINE_CHANNEL_SECRET is not configured'); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      if (!verifyLineSignature(raw, req.headers['x-line-signature'])) { res.writeHead(401); res.end('Invalid LINE signature'); return; }
      let events;
      try { events = JSON.parse(raw || '{}').events || []; } catch { res.writeHead(400); res.end('Invalid JSON'); return; }
      saveLineEvents(events).then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: true }));
      }).catch(error => {
        console.error('LINE webhook processing failed:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'Webhook could not be saved' }));
      });
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/api/parse') {
    if (!dashboardReady(req)) { res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: '請先登入管理看板' })); return; }
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 20_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { message, month, receivedAt, knownPeriods } = JSON.parse(raw || '{}');
        if (typeof message !== 'string' || !message.trim()) throw new Error('請先貼上學生的回覆。');
        const safePeriods = Array.isArray(knownPeriods) ? knownPeriods.filter(value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)).slice(0, 24) : [];
        const result = await parseAvailability(message.slice(0, 5000), { activePeriod: String(month || ''), receivedAt: String(receivedAt || ''), knownPeriods: safePeriods });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: error.message || '解析失敗' }));
      }
    });
    return;
  }
  const file = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^([/\\])+/, '');
  try {
    const content = await readFile(join(root, file));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); res.end(content);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(process.env.PORT || 3000, isProduction() ? '0.0.0.0' : '127.0.0.1', () => console.log(`排課工作台已啟動：http://localhost:${process.env.PORT || 3000}`));
