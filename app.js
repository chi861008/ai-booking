const weekdays = ['週日','週一','週二','週三','週四','週五','週六'];
const monthDate = new Date(); monthDate.setDate(1); monthDate.setMonth(monthDate.getMonth() + 1);
const period = `${monthDate.getFullYear()} 年 ${monthDate.getMonth()+1} 月`;
const periodKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth()+1).padStart(2,'0')}`;
const day = (n) => `${monthDate.getFullYear()}-${String(monthDate.getMonth()+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`;
const initial = {
  step: 0, published: false, responses: [
    { id: 1, name: '陳怡安', message: '平日晚上都可以，週二不行，月底那週出差。', avatar: '怡', status: '待解析' },
    { id: 2, name: '林子晴', message: '我週一跟週三 19:00 之後可以，週五 18:00 也可以～', avatar: '晴', status: '待解析' },
    { id: 3, name: '王品蓉', message: '週四晚上 6 點到 9 點都可以，其他時間不方便。', avatar: '蓉', status: '待解析' },
    { id: 4, name: '張書妍', message: '週一或週五下班後都可以，最好 18:00。', avatar: '妍', status: '待解析' },
    { id: 5, name: '黃思涵', message: '週三晚上可以，11/18 不行。', avatar: '涵', status: '待解析' },
    { id: 6, name: '許庭瑜', message: '週一 19:00、週四 20:00 都可以。', avatar: '瑜', status: '待解析' },
  ], assignments: [], substituteSent: false, notified: false
};
let state;
try { state = { ...initial, ...JSON.parse(localStorage.getItem('yueyue-demo') || '{}') }; } catch { state = initial; }
state.responses = (state.responses || []).map((r, i) => ({
  ...r,
  studentId: r.studentId || `demo-student-${r.id}`,
  messageId: r.messageId || `demo-msg-${r.id}-${i+1}`,
  receivedAt: r.receivedAt || new Date(Date.now() - (state.responses.length-i)*3600_000).toISOString(),
  periodKey: r.periodKey || periodKey,
}));
const steps = [
  { title: '發布老師可授課時間', desc: '先告訴學生下個月哪些時段可以安排，再開始收集回覆。', kicker: 'STEP 01 · BROADCAST' },
  { title: '整理學生的時間回覆', desc: 'LINE 回覆集中在這裡。AI 先幫你讀懂內容，你確認後才納入排課。', kicker: 'STEP 02 · UNDERSTAND' },
  { title: '排課草稿與人工確認', desc: '依照學生選項媒合時段；每週一堂，選項較少的學生優先安排。', kicker: 'STEP 03 · MATCH & REVIEW' },
  { title: '整理代課邀請', desc: '把目前排不進去的需求整理好，確認內容後再詢問代課老師。', kicker: 'STEP 04 · SUBSTITUTE' },
  { title: '確認並通知學生', desc: '核對每位學生的最終安排，送出後才會成為本月正式課表。', kicker: 'STEP 05 · CONFIRM' },
];
const $ = (id) => document.getElementById(id);
function persist(){ localStorage.setItem('yueyue-demo',JSON.stringify(state)); }
function esc(s=''){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function dayLabel(index){ return weekdays[index] || '未知'; }
function monthLabel(key){if(!/^\d{4}-\d{2}$/.test(key||''))return '月份待確認';const [year,month]=key.split('-');return `${year}/${Number(month)}`;}
function messageTime(value){const date=new Date(value);return Number.isNaN(date.getTime())?'收到時間未知':date.toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}
function knownPeriods(){return [...new Set([periodKey,...state.responses.map(r=>r.periodKey).filter(Boolean)])].sort();}
function slotText(slot){ return `${dayLabel(slot.weekday)} ${slot.start}–${slot.end}`; }
function slotKey(s){return `${s.weekday}-${s.start}`;}
function toast(message){const t=$('toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600);}
function go(next){ state.step=Math.max(0,Math.min(4,next)); persist(); render(); window.scrollTo({top:0,behavior:'smooth'}); }
function nav(){
  $('step-nav').innerHTML=steps.map((s,i)=>`<button class="nav-step ${i===state.step?'active':''} ${i<state.step?'done':''}" data-step="${i}"><span class="nav-number">${i<state.step?'✓':String(i+1).padStart(2,'0')}</span><span class="nav-copy">${['發布可上課時段','學生回覆整理','排課與確認','代課邀請','最終通知'][i]}<small>${['告訴學生可約時間','AI 整理自然語言','處理衝突與未排入','確認代課需求','核對後送出'][i]}</small></span></button>`).join('');
  document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>go(Number(b.dataset.step)));
}
function insight(){
  const responses=state.responses, confirmed=responses.filter(r=>r.status==='已確認').length, unparsed=responses.filter(r=>r.status==='待解析').length;
  const views=[
    `<div class="insight-block"><div class="insight-title">本月安排摘要</div><div class="insight-stat"><div class="stat-bubble">${responses.length}</div><div class="stat-copy"><b>${responses.length} 位學生</b><small>名單準備就緒</small></div></div></div><div class="insight-block"><div class="insight-title">發布後會發生什麼</div><div class="insight-text">學生收到可授課時段與回覆期限，直接在 LINE 回覆即可。你可以先用示範通知預覽內容。</div></div>`,
    `<div class="insight-block"><div class="insight-title">回覆狀況</div><div class="insight-stat"><div class="stat-bubble">${responses.filter(r=>r.parsed).length}</div><div class="stat-copy"><b>${responses.filter(r=>r.parsed).length} / ${responses.length} 已整理</b><small>${unparsed} 則待解析 · ${confirmed} 位已確認</small></div></div></div><div class="insight-block"><div class="insight-title">AI 如何協助</div><div class="insight-text">AI 會擷取星期、時間與排除日期。內容不清楚時先追問；你確認後才交給排課。</div></div>`,
    `<div class="insight-block"><div class="insight-title">媒合原則</div><div class="insight-text">① 先安排可選時段較少的學生<br>② 每個時段每週只能排一堂<br>③ 保留學生排除的日期<br>④ 所有結果都由老師確認</div></div><div class="insight-block"><div class="insight-title">本次排課</div><div class="insight-stat"><div class="stat-bubble">${state.assignments.filter(a=>a.status==='已安排').length}</div><div class="stat-copy"><b>${state.assignments.filter(a=>a.status==='已安排').length} 位暫定</b><small>${state.assignments.filter(a=>a.status!=='已安排').length} 位待處理</small></div></div></div>`,
    `<div class="insight-block"><div class="insight-title">代課需求</div><div class="insight-stat"><div class="stat-bubble">${state.assignments.filter(a=>a.status!=='已安排').length}</div><div class="stat-copy"><b>${state.assignments.filter(a=>a.status!=='已安排').length} 位學生</b><small>需老師協助安排</small></div></div></div><div class="insight-block"><div class="insight-title">發送前小提醒</div><div class="insight-text">邀請內容只會包含學生稱呼、可上課時段與需求堂數。實際發送前你還能再次修改。</div></div>`,
    `<div class="insight-block"><div class="insight-title">最後檢查</div><div class="insight-text">通知送出後，學生會收到自己的時間。AI 不會自行替老師做最後決定。</div></div><div class="insight-block"><div class="insight-title">本月結果</div><div class="insight-stat"><div class="stat-bubble">${state.assignments.filter(a=>a.status==='已安排').length}</div><div class="stat-copy"><b>${state.assignments.filter(a=>a.status==='已安排').length} 堂已排</b><small>${state.assignments.filter(a=>a.status!=='已安排').length} 位候補或待協調</small></div></div></div>`
  ];
  $('insight-content').innerHTML=views[state.step];
  $('insight-sub').textContent=['讓準備工作更輕鬆','把聊天內容整理成時段','規則透明，安排由你決定','快速看見還缺哪些安排','送出前再一起檢查'][state.step];
}
function renderStep(){
  const s=steps[state.step]; $('step-kicker').textContent=s.kicker; $('step-title').textContent=s.title; $('step-desc').textContent=s.desc; $('step-count').textContent=`${String(state.step+1).padStart(2,'0')} / 05`;
  const funcs=[step1,step2,step3,step4,step5]; $('step-content').innerHTML=funcs[state.step]();
  $('back-btn').disabled=state.step===0; $('next-btn').innerHTML=state.step===4?(state.notified?'已完成 ✓':'確認並通知學生 <span>→</span>'):'下一步 <span>→</span>';
  $('next-btn').disabled=state.step===4&&state.notified;
}
function step1(){
 return `<div class="card"><div class="card-title"><span>老師可授課時間</span><span class="tag">${period}</span></div><label class="label" for="teacher-hours">用一句話描述可上課時段</label><textarea class="text-area" id="teacher-hours" placeholder="例如：平日晚上 18:00–21:00，週二除外">${esc(state.teacherHours||'11 月平日晚間 18:00–21:00，週二除外')}</textarea><div class="response-actions"><button id="parse-teacher" class="tiny-btn confirm">✳ 整理可上課時段</button><span class="small-note" style="margin:0">發布前先確認 AI 整理的結果</span></div>${state.teacherParsed?`<div class="parse-result"><b>AI 整理：</b>${esc(state.teacherParsed.summary)}<br>${state.teacherParsed.available.map(slotText).join('、')||'尚未擷取出可授課時段'}${state.teacherParsed.needsClarification?`<br><b>需要確認：</b>${esc(state.teacherParsed.clarification)}`:''}</div>`:''}<label class="label">回覆截止日</label><div class="row"><input id="deadline" class="text-input" type="date" value="${esc(state.deadline||day(25))}"><div class="toggle-line" style="padding:0 10px;border:1px solid #e4e8de;border-radius:8px"><span>LINE 尚未連接</span><span class="tag pending">預覽</span></div></div><div class="label" style="margin-top:15px">通知內容預覽</div><div class="invite-box">同學你好！老師 ${esc(period)} 的授課時段已公佈：\n${esc(state.teacherHours||'平日晚間 18:00–21:00，週二除外')}\n請於 ${state.deadline?new Date(state.deadline+'T00:00:00').getDate():25} 日前回覆你方便上課的時間，謝謝！🌸</div>${state.published?'<div class="sent-banner">✓ 已建立本月徵求時間通知。LINE 自動推播尚未接上，這裡先提供可複製的訊息內容。</div>':''}</div>`;
}
function step2(){
 const all=state.responses.map(r=>{
  const target=r.parsed?.targetPeriod||r.periodKey;
  const monthChoice=(r.parsed&&!r.parsed.targetPeriod&&!r.parsed.multiplePeriods)?`<div class="response-actions"><select class="select-input" id="month-choice-${r.id}" aria-label="選擇這則訊息的排課月份">${knownPeriods().map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join('')}${Array.from({length:48},(_,i)=>{const d=new Date(monthDate.getFullYear()-1, i, 1),m=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;return knownPeriods().includes(m)?'':`<option value="${m}">${monthLabel(m)}</option>`}).join('')}</select><button class="tiny-btn" data-month-choice="${r.id}">指定月份</button></div>`:'';
  const actions=r.parsed?`${monthChoice}${r.parsed.multiplePeriods?'<div class="alert-banner">這則訊息提到多個月份，請把每個月份的時段拆成不同訊息再加入。</div>':''}<div class="response-actions">${r.status!=='已確認'&&r.parsed.targetPeriod?`<button class="tiny-btn confirm" data-confirm="${r.id}">${r.parsed.needsClarification?'已向學生確認，納入':'確認此月份時段'}</button>`:r.status==='已確認'?'<span class="tag">已納入此月份</span>':''}<button class="tiny-btn" data-reparse="${r.id}">重新整理</button></div>`:`<div class="response-actions"><button class="tiny-btn confirm" data-parse="${r.id}">✳ AI 整理回覆</button></div>`;
  return `<article class="response-card"><div class="response-top"><div class="student-avatar">${esc(r.avatar)}</div><div class="student-meta"><b>${esc(r.name)}</b><small>訊息 #${esc(r.messageId.slice(-7))} · ${messageTime(r.receivedAt)}</small></div><div><span class="tag">${monthLabel(target)}</span><div class="tag ${r.status==='待解析'?'pending':''}" style="margin-top:4px">${esc(r.status)}</div></div></div><div class="response-quote">「${esc(r.message)}」</div>${r.parsed?`<div class="parse-result"><b>AI 判斷 ${monthLabel(r.parsed.targetPeriod)}：</b>${esc(r.parsed.summary)}<br><b>判斷依據：</b>${({explicit_month:'訊息提到月份',relative_to_message_date:'依訊息日期理解',active_survey:'當時開放的排課月份',unclear:'需要人工確認'})[r.parsed.periodBasis]||'需要確認'}${r.parsed.needsClarification?`<br><b>需要確認：</b>${esc(r.parsed.clarification)}`:''}<br>${r.parsed.available.map(slotText).join('、')||'尚未擷取出明確可上課時段'}${r.parsed.unavailableDates.length?`<br>排除：${r.parsed.unavailableDates.join('、')}`:''}</div>${actions}`:''}</article>`;
 }).join('');
 return `<div class="card"><div class="card-title"><span>學生回覆 <span style="color:#9ba49b;font-weight:500">${state.responses.length} 則</span></span><span class="tag">示範資料</span></div><p class="small-note">每則訊息都有獨立編號、收到時間和排課月份。沒有提月份時，才會歸到當時唯一開放的排課月份；不同月份的回覆不會混在一起。</p><div class="label">新增一則學生回覆，試試 AI 整理</div><div class="row"><input id="new-student" class="text-input" placeholder="學生姓名" value=""><button id="add-response" class="tiny-btn" style="flex:none">＋ 新增回覆</button></div><textarea id="new-message" class="text-area" style="min-height:60px;margin-top:8px" placeholder="貼上 LINE 訊息，例如：2026 年 12 月週一和週三晚上都可以"></textarea><div class="response-list">${all}</div></div>`;
}
function step3(){
 const rows=state.assignments.length?state.assignments.map(a=>`<div class="match-row"><div class="match-student"><span class="student-avatar">${esc(a.avatar)}</span><b>${esc(a.name)}</b></div><div class="match-time">${a.status==='已安排'?`${esc(a.slot)}${a.dates?.length?`<br><small>${a.dates.length} 次 · ${a.dates.map(date=>date.slice(5).replace('-','/')).join('、')}</small>`:''}`:'尚無可安排時段'}</div><span class="status ${a.needsReview?'collision':a.status==='已安排'?'':'collision'}">${a.needsReview?'新回覆，請檢查':esc(a.status)}${a.needsReview?`<br><button class="tiny-btn" data-review="${esc(a.id)}">保留原排課</button>`:''}</span></div>`).join(''):`<div class="empty">尚未產生排課草稿。先確認學生時段，再開始媒合。</div>`;
 return `<div class="card"><div class="card-title"><span>本月排課草稿</span><button id="run-match" class="tiny-btn confirm">✳ 自動媒合</button></div><p class="small-note">只使用已由學生確認、且符合老師時段的時間。選項少的學生優先；已安排的課不會在再次媒合時改排。</p><div class="match-list">${rows}</div>${state.assignments.length?'<div class="alert-banner">請檢查黃色的待安排項目。修改草稿不會通知學生，直到最後一步確認。</div>':''}</div>`;
}
function step4(){
 const pending=state.assignments.filter(a=>a.status!=='已安排');
 const text=`嗨～想詢問你 ${period} 是否能協助代課：\n${pending.map(a=>`・${a.name}：${a.slots?.join('、')||'可再協調時間'}（每週一堂）`).join('\n')||'目前沒有待安排學生。'}\n方便的話請回覆可承接的學生與時段，謝謝！`;
 return `<div class="card"><div class="card-title"><span>待安排學生</span><span class="tag pending">${pending.length} 位</span></div>${pending.length?`<div class="response-list">${pending.map(a=>`<article class="response-card"><div class="response-top"><div class="student-avatar">${esc(a.avatar)}</div><div class="student-meta"><b>${esc(a.name)}</b><small>尚未找到老師時段</small></div><span class="tag pending">待代課</span></div><div class="parse-result">學生可以：${esc(a.slots?.join('、')||'需要老師協調')}<br>目前狀態：${esc(a.status)}</div></article>`).join('')}</div><div class="label">代課邀請預覽</div><div class="invite-box" id="sub-invite">${esc(text)}</div><div class="response-actions"><button class="tiny-btn" id="copy-invite">複製邀請內容</button><button class="tiny-btn confirm" id="send-invite">${state.substituteSent?'已建立邀請 ✓':'確認並建立邀請'}</button></div><p class="small-note">目前只會產生可複製的邀請文字；LINE 發送和代課老師回覆尚未串接。</p>`:'<div class="sent-banner">目前每位學生都有暫定時段，沒有待代課需求。</div>'}</div>`;
}
function step5(){
 const assigned=state.assignments.filter(a=>a.status==='已安排'), pending=state.assignments.filter(a=>a.status!=='已安排');
 return `<div class="card"><div class="card-title"><span>送出前最後確認</span><span class="tag">${period}</span></div><div class="student-checklist"><div class="check-row"><span class="check on">✓</span><span>本月可授課時段</span><small>已設定</small></div><div class="check-row"><span class="check ${state.responses.every(r=>r.status==='已確認')?'on':''}">${state.responses.every(r=>r.status==='已確認')?'✓':'!'}</span><span>學生時間回覆</span><small>${state.responses.filter(r=>r.status==='已確認').length} / ${state.responses.length} 已確認</small></div><div class="check-row"><span class="check ${state.assignments.length?'on':''}">${state.assignments.length?'✓':'!'}</span><span>排課草稿</span><small>${assigned.length} 位已安排 · ${pending.length} 位待處理</small></div></div><div class="final-card"><div class="final-icon">✓</div><div><b>暫定排入 ${assigned.length} 位學生</b><small>每位學生會收到個別課表預覽。沒有排入的學生會收到後續聯絡說明。</small></div></div>${pending.length?`<div class="final-card"><div class="final-icon" style="background:#fff2df;color:#ab7c43">!</div><div><b>${pending.length} 位學生仍待安排</b><small>${pending.map(a=>esc(a.name)).join('、')}；可以先核准課表並保留待處理狀態。</small></div></div>`:''}${state.notified?'<div class="sent-banner">✓ 已完成本月確認。實際 LINE 個別推播尚未串接，以下為各學生通知預覽。</div>':''}<div class="label">通知預覽</div>${assigned.map(a=>`<div class="final-card"><div class="final-icon">✉</div><div><b>${esc(a.name)}</b><small>${esc(period)} 暫定上課時間：${esc(a.slot)}${a.dates?.length?`（${a.dates.map(date=>date.slice(5).replace('-','/')).join('、')}）`:''}</small></div></div>`).join('')||'<div class="empty">請先完成排課草稿。</div>'}</div>`;
}
function render(){
 $('period-label').textContent=period; $('progress-copy').textContent=`第 ${state.step+1} 步，共 5 步`; $('progress-fill').style.width=`${(state.step+1)*20}%`; $('welcome-sub').textContent=state.notified?'本月課表流程已完成。下個月再開始新一輪。':'五個步驟完成本月課表，重要決定仍由你確認。'; nav();renderStep();insight();bind();
}
function bind(){
 $('back-btn').onclick=()=>go(state.step-1); $('next-btn').onclick=()=>{
   if(state.step===0){if(!state.teacherParsed){toast('先整理一次老師可授課時段');return;}state.teacherHours=$('teacher-hours').value.trim();state.deadline=$('deadline').value;state.published=true;persist();toast('通知內容已準備好');go(1);return;}
   if(state.step===1){go(2);return;}
   if(state.step===2){if(!state.assignments.length){toast('請先產生排課草稿');return;}go(3);return;}
   if(state.step===3){if(state.assignments.some(a=>a.needsReview)){toast('先檢查有新回覆的課程，再送出通知');go(2);return;}go(4);return;}
   state.notified=true;persist();render();toast('本月課表已確認');
 };
 $('teacher-hours')?.addEventListener('input',e=>{state.teacherHours=e.target.value;state.teacherParsed=null;persist();});$('deadline')?.addEventListener('change',e=>{state.deadline=e.target.value;persist();});
 $('parse-teacher')?.addEventListener('click',parseTeacher);
 $('add-response')?.addEventListener('click',()=>{const name=$('new-student').value.trim(),message=$('new-message').value.trim();if(!name||!message){toast('請填寫學生姓名和 LINE 回覆');return;}const id=Date.now();state.responses.unshift({id,studentId:`demo-student-${name.trim().toLowerCase()}`,messageId:`demo-msg-${id}`,receivedAt:new Date().toISOString(),periodKey:'',name,message,avatar:name.slice(-1),status:'待解析'});persist();render();toast('已加入學生回覆');});
 document.querySelectorAll('[data-parse]').forEach(b=>b.onclick=()=>parseOne(Number(b.dataset.parse)));
 document.querySelectorAll('[data-month-choice]').forEach(b=>b.onclick=()=>{const r=state.responses.find(x=>x.id===Number(b.dataset.monthChoice));const choice=$(`month-choice-${b.dataset.monthChoice}`)?.value;if(!r||!choice)return;r.parsed.targetPeriod=choice;r.parsed.periodBasis='teacher_confirmed';r.status='待確認';r.periodKey=choice;persist();render();toast(`已指定為 ${monthLabel(choice)}，請再確認時段內容`);});
 document.querySelectorAll('[data-confirm]').forEach(b=>b.onclick=()=>{const r=state.responses.find(x=>x.id===Number(b.dataset.confirm));if(r)confirmResponse(r);});
 document.querySelectorAll('[data-reparse]').forEach(b=>b.onclick=()=>parseOne(Number(b.dataset.reparse)));
 $('run-match')?.addEventListener('click',runMatching);
 document.querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>{const assignment=state.assignments.find(a=>String(a.id)===b.dataset.review);if(assignment){assignment.needsReview=false;persist();render();toast('已確認保留原排課');}});
 $('copy-invite')?.addEventListener('click',()=>copyText($('sub-invite').textContent));
 $('send-invite')?.addEventListener('click',()=>{state.substituteSent=true;persist();render();toast('代課邀請文字已準備好');});
}
async function parseOne(id){
 const r=state.responses.find(x=>x.id===id);if(!r)return;
 const b=document.querySelector(`[data-reparse="${id}"]`);if(b){b.disabled=true;b.textContent='整理中…';}
 try{const res=await fetch('/api/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:r.message,month:periodKey,receivedAt:r.receivedAt,knownPeriods:knownPeriods(),messageId:r.messageId,studentId:r.studentId})});const result=await res.json();if(!res.ok)throw new Error(result.error||'解析失敗');r.parsed=result;r.periodKey=result.targetPeriod||'';r.status=!result.targetPeriod?'月份待確認':result.needsClarification?'需要確認':'已整理';persist();render();toast(!result.targetPeriod?'AI 無法確認月份，請補充年份月份':result.needsClarification?'AI 有一個問題需要確認':`已判斷屬於 ${monthLabel(result.targetPeriod)}`);}
 catch(error){if(b){b.disabled=false;b.textContent='重新整理';}toast(error.message||'AI 解析失敗');}
}
async function parseTeacher(){
 const input=$('teacher-hours'), button=$('parse-teacher');if(!input.value.trim()){toast('請先描述老師可授課的時間');return;}
 button.disabled=true;button.textContent='整理中…';
 try{const res=await fetch('/api/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:input.value,month:periodKey})});const result=await res.json();if(!res.ok)throw new Error(result.error||'解析失敗');state.teacherHours=input.value;state.teacherParsed=result;persist();render();toast('時段已整理，請檢查日期和時間');}
 catch(error){button.disabled=false;button.textContent='✳ 整理可上課時段';toast(error.message||'AI 解析失敗');}
}
async function copyText(value){try{await navigator.clipboard.writeText(value);toast('已複製到剪貼簿');}catch{toast('請長按選取文字後複製');}}
function runMatching(){
 const teachers=(state.teacherParsed?.available||[]).flatMap(a=>expandSlot(a));
 const latestByStudent=new Map();
 for(const r of state.responses.filter(r=>r.status==='已確認'&&r.periodKey===periodKey).sort((a,b)=>new Date(a.receivedAt)-new Date(b.receivedAt)))latestByStudent.set(r.studentId||r.id,r);
 const students=[...latestByStudent.values()].map(r=>({id:r.studentId||r.id,name:r.name,avatar:r.avatar,excluded:r.excluded||[],slots:(r.availability||[]).flatMap(a=>expandSlot(a))}));
 if(!students.length){toast('先整理並確認至少一位學生的回覆');return;}
 const previous=new Map(state.assignments.map(a=>[a.id,a]));
 const used=new Set(state.assignments.filter(a=>a.status==='已安排').map(a=>a.slotKey));
 const assigned=[];students.sort((a,b)=>a.slots.length-b.slots.length);
 for(const student of students){
  const existing=previous.get(student.id);
  if(existing?.status==='已安排'){assigned.push(existing);continue;}
  const candidate=student.slots.find(slot=>teachers.some(t=>slotKey(t)===slotKey(slot))&&!used.has(slotKey(slot))&&datesForSlot(slot,student.excluded).length>0);
  if(candidate){const key=slotKey(candidate);used.add(key);assigned.push({...student,periodKey,slot:slotText(candidate),slotKey:key,dates:datesForSlot(candidate,student.excluded),status:'已安排'});}
  else assigned.push({...student,slot:'',status:'待安排'});
 }
 state.assignments=assigned;persist();render();toast('排課草稿已更新');
}
function confirmResponse(response){
 const month=response.parsed?.targetPeriod;if(!month)return;
 const earlier=state.responses.filter(r=>r!==response&&r.studentId===response.studentId&&r.periodKey===month&&r.status==='已確認').sort((a,b)=>new Date(b.receivedAt)-new Date(a.receivedAt))[0];
 const intent=response.parsed.intent;
 if(earlier&&intent==='new_availability'){
  response.availability=[...new Map([...(earlier.availability||[]),...(response.parsed.available||[])].map(slot=>[`${slot.weekday}-${slot.start}-${slot.end}-${slot.date||''}`,slot])).values()];
  response.excluded=[...new Set([...(earlier.excluded||[]),...(response.parsed.unavailableDates||[])])];
 }else if(earlier&&intent==='date_exception'){
  response.availability=earlier.availability||[];
  response.excluded=[...new Set([...(earlier.excluded||[]),...(response.parsed.unavailableDates||[])])];
 }else{
  response.availability=response.parsed.available||[];
  response.excluded=response.parsed.unavailableDates||[];
 }
 response.periodKey=month;
 for(const old of state.responses.filter(r=>r!==response&&r.studentId===response.studentId&&r.periodKey===month&&r.status==='已確認'))old.status='已被新回覆更新';
 const oldAssignment=state.assignments.find(a=>a.id===response.studentId&&(!a.periodKey||a.periodKey===month)&&a.status==='已安排');
 if(oldAssignment)oldAssignment.needsReview=true;
 response.status='已確認';
 persist();render();toast(`${response.name} 的 ${monthLabel(month)} 時段已納入`);
}
function expandSlot(slot){
 const [sh,sm]=String(slot.start||'').split(':').map(Number),[eh,em]=String(slot.end||'').split(':').map(Number);if(!Number.isFinite(sh)||!Number.isFinite(eh))return[];
 const start=sh*60+(sm||0),end=eh*60+(em||0);const out=[];
 for(let minute=start;minute+60<=end;minute+=60)out.push({weekday:slot.weekday,start:`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,end:`${String(Math.floor((minute+60)/60)).padStart(2,'0')}:${String((minute+60)%60).padStart(2,'0')}`,date:slot.date||null});
 return out;
}
function datesForSlot(slot, studentExclusions=[]){
 const excluded=new Set([...(state.teacherParsed?.unavailableDates||[]),...studentExclusions]);const dates=[];
 const lastDay=new Date(monthDate.getFullYear(),monthDate.getMonth()+1,0).getDate();
 for(let n=1;n<=lastDay;n++){
  const date=day(n),weekday=new Date(monthDate.getFullYear(),monthDate.getMonth(),n).getDay();
  if(weekday===slot.weekday&&!excluded.has(date)&&!excluded.has(date.slice(5)))dates.push(date);
 }
 return dates;
}
render();
