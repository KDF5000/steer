const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
 copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 2M18 17A7 7 0 0 1 6 19l-2-2"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
 share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/>',
 quote:'<path d="M9 10H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7a5 5 0 0 1-5 5m14-7h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7a5 5 0 0 1-5 5"/>',
 arrow:'<path d="m9 5 7 7-7 7"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
function toolbar(id){return `<button class="icon-action" data-basic="copy" data-message-id="${id}" title="复制回复" aria-label="复制回复">${svg('copy')}</button><button class="icon-action" data-basic="refresh" title="重新生成" aria-label="重新生成">${svg('refresh')}</button><button class="icon-action" data-basic="download" data-message-id="${id}" title="下载回复" aria-label="下载回复">${svg('download')}</button><button class="icon-action" data-basic="share" title="分享回复" aria-label="分享回复">${svg('share')}</button><button class="quote-action" data-quote="${id}" title="引用这条回复" aria-label="引用这条回复"></button><span class="quoted-marker"></span>`}
// Keep the editable text independent from non-editable quote / Agent tokens.
Object.defineProperty($('prompt'),'value',{
 get(){return $('draft-text').innerText.replace(/\u00a0/g,' ');},
 set(value){$('draft-text').textContent=value;}
});
Object.defineProperty($('prompt'),'disabled',{
 get(){return $('draft-text').contentEditable==='false';},
 set(value){$('draft-text').contentEditable=value?'false':'true';$('draft-text').setAttribute('aria-disabled',String(value));}
});
$('prompt').focus=()=>{
 $('draft-text').focus();
 const range=document.createRange();range.selectNodeContents($('draft-text'));range.collapse(false);
 const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
};
const concepts = {
 a:{title:'A · 显式引用条',description:'保留现有回复操作栏，在分享后增加「引用」文字按钮；输入框展示两行引用内容，首次使用更容易发现。',tag:'清晰直观'},
 b:{title:'B · 行内轻量引用',description:'引用图标只用颜色标记选中状态；引用标签、输入文字和 @Agent 在同一行编辑，内容较长时自然换行。',tag:'推荐 · 克制紧凑'},
 c:{title:'C · 引用后明确交接',description:'消息操作栏保留图标并带「引用」文字，输入框明确分成「交给」和「引用」两行，便于检查上下文范围。',tag:'控制明确'}
};
const initialMessages = {
 implementation:{author:'Builder',title:'机器级项目绑定的实现',text:'已完成机器级项目绑定。项目现在选择机器，Agent 决定使用哪个 Runtime。\n\n• 旧项目会迁移到原 Runtime 所属的机器。\n• 同一会话可以切换同机 Agent，并带上已有对话。\n• 前端构建与相关测试通过，修改尚未提交。'},
 explanation:{author:'Builder',title:'项目与 Runtime 的边界说明',text:'补充一点：项目位置限制的是机器。不同 Runtime 的原生会话独立保存，Steer 负责把对话和任务结果衔接起来。'}
};
const agents=[{id:'reviewer',name:'Reviewer',avatar:'B',runtime:'Trae · dev-mac-mini',role:'代码审查',available:true},{id:'writer',name:'Writer',avatar:'C',runtime:'Pi · dev-mac-mini',role:'文字整理',available:true},{id:'remote',name:'Remote reviewer',avatar:'D',runtime:'Codex · linux-server',role:'其他机器 · 不可用',available:false}];
let state, generation=0, timer, toastTimer;
function reset(variant=state?.variant||'b'){
 clearTimeout(timer);clearTimeout(toastTimer);$('toast').classList.remove('show');generation++;state={variant,target:null,quote:null,quoteOrigin:null,suppressed:false,busy:false,messages:structuredClone(initialMessages),latest:'explanation'};
 $('prompt').value='';$('generated').innerHTML='';$('thread').scrollTop=0;$('mention-menu').hidden=true;
 document.body.className=`variant-${variant}`;
 if(variant==='b')$('prompt').insertBefore($('quote-region'),$('inline-recipient'));
 else $('composer').insertBefore($('quote-region'),$('composer').querySelector('.input-wrap'));
 $('inline-recipient').innerHTML='';
 document.querySelectorAll('[data-toolbar]').forEach(el=>el.innerHTML=toolbar(el.dataset.toolbar));
 document.querySelectorAll('[data-variant]').forEach(b=>b.classList.toggle('active',b.dataset.variant===variant));
 $('concept-title').textContent=concepts[variant].title;$('concept-description').textContent=concepts[variant].description;$('concept-tag').textContent=concepts[variant].tag;
 history.replaceState(null,'',`?concept=${variant}`);render();
}
function quote(id,origin='explicit') {state.quote=id;state.quoteOrigin=origin;state.suppressed=false;render();$('prompt').focus()}
function removeQuote(){state.quote=null;state.quoteOrigin=null;state.suppressed=true;render();toast('本次消息不携带引用，不会自动补回最新回复。')}
function selectTarget(id){const agent=agents.find(a=>a.id===id);if(!agent?.available)return;state.target=agent;let value=$('prompt').value;const match=value.match(/@[^\s@]*$/);if(match)value=value.slice(0,match.index);$('prompt').value=value; if(!state.quote&&!state.suppressed){state.quote=state.latest;state.quoteOrigin='automatic'}$('mention-menu').hidden=true;render();$('prompt').focus()}
function clearTarget(){state.target=null;if(state.quoteOrigin==='automatic'){state.quote=null;state.quoteOrigin=null}render()}
function showMenu(query=''){$('mention-menu').innerHTML='<div class="menu-caption">当前项目机器 · dev-mac-mini</div>'+agents.filter(a=>a.name.toLowerCase().includes(query.toLowerCase())).map(a=>`<button class="agent-option" data-agent="${a.id}" ${a.available?'':'disabled'}><span class="avatar b">${a.avatar}</span><div><strong>${a.name}</strong><small>${a.runtime}</small></div><span>${a.role}</span></button>`).join('');$('mention-menu').hidden=false}
function quoteTitle(){return state.quote?`${state.messages[state.quote].author} · ${state.messages[state.quote].title}`:''}
function render(){
 const q=state.quote?state.messages[state.quote]:null; const mode=state.quoteOrigin==='automatic'?'自动 · 最新回复':'手动引用';
 const recipient=state.target?`<span class="recipient-pill">@${state.target.name}<button data-action="clear-target" aria-label="移除接收 Agent">×</button></span>`:'';
 const noquote=state.suppressed?'<div class="no-context">本次不携带引用 <button data-action="restore">改用最新回复</button></div>':'';
 $('recipient-bar').innerHTML=state.variant==='c'?`<div class="handoff-row"><span class="handoff-label">交给</span>${recipient||'<button data-action="choose">Builder <span class="muted">⌄</span></button>'}<span class="handoff-hint">${state.target?'专项任务 · 主 Agent 仍为 Builder':'当前会话负责人'}</span></div>`:state.variant==='a'?recipient:'';
 if(state.variant==='b'){
  $('quote-region').innerHTML=q?`<span class="context-chip" contenteditable="false"><button class="chip-title" data-action="preview">↳ ${esc(q.author)}：${esc(q.title)}</button><button class="remove-quote" data-action="remove-quote" aria-label="移除引用">×</button></span>`:'';
  $('inline-recipient').innerHTML=recipient;
  $('draft-text').dataset.placeholder=state.target?`描述希望 ${state.target.name} 完成的任务…`:'描述一项任务，输入 @ 选择其他 Agent…';
 } else if(state.variant==='c'){
  $('quote-region').innerHTML=`<div class="handoff-context"><span class="handoff-label">引用</span><div class="quote-info"><div class="quote-title">${q?`<button data-action="preview">${esc(q.author)} · ${esc(q.title)}</button>`:'不携带引用'}</div>${q?`<div class="quote-excerpt">${esc(q.text)}</div>`:''}</div><select id="context-mode" aria-label="引用模式"><option value="automatic" ${state.quoteOrigin==='automatic'?'selected':''}>最新回复（自动）</option><option value="explicit" ${state.quoteOrigin==='explicit'?'selected':''}>指定消息</option><option value="none" ${!q?'selected':''}>不引用</option></select>${q?'<button class="remove-quote" data-action="remove-quote" aria-label="移除引用">×</button>':''}</div>`;
 } else {
  $('quote-region').innerHTML=q?`<div class="quote-ribbon"><span class="quote-symbol">“</span><button class="quote-info" data-action="preview"><div class="quote-title">引用 ${esc(q.author)}<small>${mode}</small></div><div class="quote-excerpt">${esc(q.text)}</div></button><button class="remove-quote" data-action="remove-quote" aria-label="移除引用">×</button></div>`:noquote;
 }
 $('delegate-button').textContent=state.variant==='c'?'更换 Agent':'@ Agent';
 $('routing-note').textContent=state.target?`发送给 ${state.target.name} · 结果回到当前会话，Builder 继续负责主任务`:'普通消息由 Builder 处理';
 $('send').disabled=state.busy;$('prompt').disabled=state.busy;$('delegate-button').disabled=state.busy;
 document.querySelectorAll('.quote-action').forEach(b=>{b.innerHTML=svg('quote')+(state.variant==='b'?'':'<span>引用</span>');b.disabled=state.busy});
 document.querySelectorAll('[data-message]').forEach(m=>{m.classList.toggle('is-quoted',m.dataset.message===state.quote);const marker=m.querySelector('.quoted-marker');if(marker)marker.textContent='';m.querySelector('.quote-action')?.setAttribute('aria-pressed',String(m.dataset.message===state.quote))});
}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2600)}
function preview(){if(!state.quote)return;$('quote-dialog-title').textContent=quoteTitle();$('quote-dialog-body').textContent=state.messages[state.quote].text;$('quote-dialog').showModal()}
function send(){
 const text=$('prompt').value.trim();if(!text){$('prompt').focus();toast('先输入希望 Agent 完成的任务。');return}if(state.busy)return;
 const target=state.target;const q=state.quote?structuredClone(state.messages[state.quote]):null;const id='task-'+generation+'-'+Date.now();const version=generation;state.busy=true;
 const html=`<div class="mini-user">${q?`<small>引用 ${esc(q.author)} · ${esc(q.title)}</small>`:''}${target?`<strong>@${esc(target.name)}</strong> `:''}${esc(text)}</div>`;
 $('generated').insertAdjacentHTML('beforeend',html+`<section class="result-task" id="${id}"><details class="response-status activity"><summary><span class="result-author">${target?target.name:'Builder'}</span><span class="status">执行中…</span>${svg('arrow')}</summary><div class="process-detail">接收任务 → 读取当前项目 → ${target?.id==='writer'?'整理内容':'检查相关改动'} → 返回结果</div></details><div class="response-divider"></div></section>`);
 $('prompt').value='';state.target=null;state.quote=null;state.quoteOrigin=null;state.suppressed=false;$('mention-menu').hidden=true;render();$('thread').scrollTop=$('thread').scrollHeight;
 timer=setTimeout(()=>{
  if(version!==generation)return;state.busy=false;const element=$(id);element.querySelector('.status').textContent='Completed in 17s';
  let result,title;
  if(target?.id==='reviewer'){result='发现 2 个需要补充的边界：\n1. 切换 Agent 的任务失败时，应保留尚未交接的上下文。\n2. 项目机器不可用时，应明确提示，不应自动改用其他机器。\n建议先补充回归测试，再继续修改。';title='机器级项目绑定的审查结果'}
  else if(target?.id==='writer'){result='项目决定在哪里工作，Agent 决定如何执行。\n现在，你可以在同一段对话中切换同机 Agent，沿用项目目录和已有上下文。';title='面向用户的说明'}
  else{result=q?.author==='Reviewer'?'已根据 Reviewer 的两条意见继续修改，补上任务失败时的上下文交接检查和机器不可用提示。相关回归测试通过，修改尚未提交。':'已收到要求，将在当前项目中继续处理。';title='根据交接结果继续处理'}
  const msgId=id+'-result';state.messages[msgId]={author:target?.name||'Builder',title,text:result};state.latest=msgId;
  element.dataset.message=msgId;element.insertAdjacentHTML('beforeend',`<div class="task-result">${esc(result).replace(/\n/g,'<br>')}</div><div class="task-footer">${target?`<button class="continue-action" data-continue="${msgId}">交给 Builder 继续</button>`:''}<div class="message-actions">${toolbar(msgId)}</div></div>`);
  render();$('thread').scrollTop=$('thread').scrollHeight;
 },1400);
}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.basic){
  const action=button.dataset.basic;const msg=state.messages[button.dataset.messageId];
  if(action==='copy'&&msg){navigator.clipboard?.writeText(msg.text).then(()=>toast('回复已复制')).catch(()=>toast('浏览器未允许复制'));}
  else if(action==='download'&&msg){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([msg.text],{type:'text/plain;charset=utf-8'}));a.download='agent-response.txt';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  else toast('保留现有操作，此原型仅演示引用与委派。');return;
 }
 if(button.dataset.variant){reset(button.dataset.variant);return}
 if(button.dataset.quote){quote(button.dataset.quote);return}
 if(button.dataset.agent){selectTarget(button.dataset.agent);return}
 if(button.dataset.continue){state.target=null;quote(button.dataset.continue);$('prompt').value='根据这条结果继续处理，有争议的建议请说明。';toast('已引用结果，下一条消息将交给 Builder。');return}
 const action=button.dataset.action;if(action==='remove-quote'){removeQuote();$('prompt').focus();}if(action==='restore')quote(state.latest,'automatic');if(action==='preview')preview();if(action==='clear-target')clearTarget();if(action==='choose')showMenu();
});
$('prompt').addEventListener('input',()=>{const match=$('prompt').value.match(/@([^\s@]*)$/);if(match)showMenu(match[1]);else $('mention-menu').hidden=true});
$('prompt').addEventListener('keydown',event=>{if(event.key==='Escape')$('mention-menu').hidden=true;if(!$('mention-menu').hidden && event.key==='ArrowDown'){event.preventDefault();$('mention-menu').querySelector('button:not(:disabled)')?.focus();return}if(!$('mention-menu').hidden && event.key==='Enter'&&!event.shiftKey){const first=$('mention-menu').querySelector('button:not(:disabled)');if(first){event.preventDefault();selectTarget(first.dataset.agent);return}}if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();send()}});
$('delegate-button').onclick=()=>showMenu();$('send').onclick=send;
$('owner-button').onclick=()=>toast('Builder 是当前负责人；@ 其他 Agent 只委派本次任务。');
$('close-dialog').onclick=$('dialog-done').onclick=()=>$('quote-dialog').close();
document.addEventListener('change',event=>{if(event.target.id==='context-mode'){if(event.target.value==='none')removeQuote();else if(event.target.value==='automatic')quote(state.latest,'automatic');else {quote('implementation');toast('也可以在任意 Agent 回复下点击「引用」。')}}});
$('scenario-explicit').onclick=()=>{if(state.busy)return;state.target=null;quote('implementation');selectTarget('reviewer');$('prompt').value='检查这个实现有没有遗漏，先不要修改代码。'};
$('scenario-auto').onclick=()=>{if(state.busy)return;state.quote=null;state.suppressed=false;selectTarget('reviewer');$('prompt').value='检查当前项目改动的边界情况，先不要修改代码。'};
$('scenario-noquote').onclick=()=>{if(state.busy)return;state.target=null;state.quote=null;state.suppressed=false;selectTarget('writer');removeQuote();$('prompt').value='为 Steer 写一段简短的产品介绍。'};
$('reset').onclick=()=>reset();
document.querySelectorAll('.changes,.new-chat,.add-project').forEach(b=>b.onclick=()=>toast('此演示聚焦引用与 Agent 委派，其他入口不展开。'));
const variant=new URLSearchParams(location.search).get('concept');reset(concepts[variant]?variant:'b');
