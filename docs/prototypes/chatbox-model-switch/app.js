const $ = (selector) => document.querySelector(selector);
const paths = {
  chevron: '<path d="m6 9 6 6 6-6"/>', check: '<path d="m5 12 4 4L19 6"/>',
  model: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/><path d="M9 9h6v6H9z"/>',
  follow: '<path d="M20 7h-9a5 5 0 0 0 0 10h9M16 3l4 4-4 4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  agent: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  quote: '<path d="M4 5h6v7H6a5 5 0 0 1-2 5m10-12h6v7h-4a5 5 0 0 1-2 5"/>',
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const agents = [
  {id:'frontend',name:'前端工程师',avatar:'前',role:'页面开发与交互实现',skills:'React · 交互设计 · Web 性能',model:'GPT-5.4'},
  {id:'reviewer',name:'代码审查员',avatar:'审',role:'检查实现、边界与风险',skills:'代码审查 · 安全检查',model:'GPT-5.5'},
  {id:'general',name:'通用助手',avatar:'通',role:'日常开发与问题分析',skills:'通用开发',model:'GPT-5.4'},
];
const models = ['GPT-5.4','GPT-5.5','Gemini-3.1-Pro-Preview','DeepSeek-V4-Pro'];
const state = {agent:agents[0],override:null,menu:null,query:'',notice:false,working:false};
const currentModel = () => state.override || state.agent.model;
$('.ws-chat-appbar-context strong').textContent = '登录重连与异常处理';
$('.ws-chat-appbar-context > span').textContent = 'Steer · Trae / 我的 Mac';
$('.ws-chat-thread').innerHTML = `<div class="ws-chat-message user"><div><p>检查登录重连流程，补上连接断开后的重试和错误提示。</p></div></div>
<div class="ws-chat-message agent"><div style="width:100%"><div class="response-author"><span class="ws-agent-avatar">前</span>前端工程师<small>GPT-5.4 · 10:24</small></div><div class="ws-chat-response-process"><button class="ws-chat-response-meta is-complete" type="button"><span>已完成 · 37 秒</span>${icon('chevron')}</button><div class="ws-chat-response-divider"></div></div><div class="ws-markdown"><p>已补上登录重连与异常处理。</p><ul><li>连接断开后自动重试，并复用已有会话。</li><li>登录失败时保留输入，展示具体错误原因。</li><li>恢复连接后继续处理待发送消息。</li></ul><pre class="sample-code"><em>reconnect</em>({
  retries: <em>3</em>,
  preserveSession: <em>true</em>,
  onError: showConnectionError
});</pre><p>接下来可以检查弱网和会话过期这两条路径。</p></div><div class="ws-chat-message-actions"><button type="button" aria-label="引用回复">${icon('quote')}</button><button type="button" aria-label="复制回复">${icon('copy')}</button><time class="ws-chat-message-time">10:24</time></div></div></div>`;
const context = $('.ws-chatbox-context');
context.innerHTML = `<button class="ws-composer-agent" id="agent-trigger" type="button" aria-label="选择智能体" aria-haspopup="listbox" aria-expanded="false"></button><span class="control-divider"></span><button class="model-trigger" id="model-trigger" type="button" aria-label="选择本次会话模型" aria-haspopup="listbox" aria-expanded="false"></button><button type="button" class="ws-composer-project" title="当前项目：Steer">${icon('folder')}<span>Steer</span></button>`;
$('.ws-chatbox').insertAdjacentHTML('beforebegin',`<div class="model-change-note" role="status" hidden></div>`);
document.body.insertAdjacentHTML('beforeend',`<div class="picker" id="model-picker" hidden></div><div class="picker" id="agent-picker" hidden></div><div class="prototype-toast" role="status" hidden></div>`);
$('.ws-sidebar-footer').insertAdjacentHTML('afterbegin',`<div class="prototype-controls"><span>会话模型切换 · 交互预览</span><nav><button data-scene="default">默认状态</button><button data-scene="menu">模型菜单</button><button data-scene="override">切换后</button><button data-scene="agent">角色切换</button></nav><p>模型列表为演示数据。可选择模型、切换角色并模拟发送。</p></div>`);
$('.ws-chat-appbar').insertAdjacentHTML('beforeend','<button class="prototype-mobile" type="button">重置预览</button>');
const editor = $('.ws-inline-editor');
editor.textContent = '再检查一下弱网下的重连逻辑，尤其是消息重复发送的情况。';
const send = $('.ws-chat-send');
send.disabled = false;
const closeMenus = () => {state.menu=null;$('#model-picker').hidden=true;$('#agent-picker').hidden=true;$('#model-trigger').setAttribute('aria-expanded','false');$('#agent-trigger').setAttribute('aria-expanded','false');};
function positionPicker(){
  if(!state.menu)return;
  const picker=$(`#${state.menu}-picker`), trigger=$(`#${state.menu}-trigger`),r=trigger.getBoundingClientRect();
  picker.style.left=`${Math.max(16,Math.min(r.left,innerWidth-picker.offsetWidth-16))}px`;
  picker.style.top=`${Math.max(12,r.top-picker.offsetHeight-10)}px`;
}
function render(){
  $('#agent-trigger').innerHTML=`<span class="ws-agent-avatar">${state.agent.avatar}</span><span>${state.agent.name}</span>${icon('chevron')}`;
  $('#model-trigger').innerHTML=`${icon('model')}<span>${currentModel()}</span>${state.override?'<i class="override-dot" title="当前会话指定模型"></i>':''}${icon('chevron')}`;
  $('#model-trigger').title=state.override?'当前会话指定模型':'跟随智能体默认模型';
  $('.ws-chat-mode-note').innerHTML=`Trae · 我的 Mac <span class="note-label">/</span> <span class="note-model">${currentModel()}</span> <span class="note-label">· ${state.override?'当前会话指定':'智能体默认'}</span>`;
  const notice=$('.model-change-note');notice.hidden=!state.notice;
  notice.innerHTML=`${icon('check')}下一条消息使用 ${currentModel()} · ${state.agent.name} 的角色与 skills 保持生效`;
}
function modelMenu(){
  const selected=state.override===null;
  $('#model-picker').innerHTML=`<div class="picker-heading">选择模型<span class="runtime-tag"><i></i>Trae</span></div><label class="picker-search">${icon('search')}<input placeholder="搜索模型…" aria-label="搜索模型" value="${escapeHTML(state.query)}"></label><div role="listbox" aria-label="会话模型"><button class="picker-item" role="option" aria-selected="${selected}" data-model="default"><span class="item-icon">${icon('follow')}</span><span class="item-copy"><span class="item-name">跟随智能体默认</span><small>${state.agent.name} · ${state.agent.model}</small></span>${selected?icon('check','picker-check'):''}</button><div class="picker-rule"></div><div class="picker-section">当前运行环境可用</div><div id="model-options"></div></div><div class="picker-foot">仅对当前会话生效，从下一条消息开始使用。</div>`;
  renderModelOptions();
  $('#model-picker input').addEventListener('input',e=>{state.query=e.target.value;renderModelOptions();positionPicker();});
}
function renderModelOptions(){
  $('#model-options').innerHTML=models.filter(m=>m.toLowerCase().includes(state.query.toLowerCase())).map(m=>`<button class="picker-item" role="option" aria-selected="${state.override===m}" data-model="${m}"><span class="item-icon">${icon('model')}</span><span class="item-copy"><span class="item-name">${m}${m===state.agent.model?'<span class="item-badge">智能体默认</span>':''}</span></span>${state.override===m?icon('check','picker-check'):''}</button>`).join('')||'<div class="picker-foot">没有匹配的模型</div>';
}
function agentMenu(){
  $('#agent-picker').innerHTML=`<div class="picker-heading">选择智能体<span class="runtime-tag">角色与 skills</span></div><div role="listbox" aria-label="智能体">${agents.map(a=>`<button class="picker-item" role="option" aria-selected="${state.agent.id===a.id}" data-agent="${a.id}"><span class="item-icon">${a.avatar}</span><span class="item-copy"><span class="item-name">${a.name}</span><small>${a.role}</small><small>${a.skills}</small></span>${state.agent.id===a.id?icon('check','picker-check'):''}</button>`).join('')}</div><div class="picker-foot">${state.override?'已指定会话模型，切换智能体后继续使用 '+state.override+'。':'模型将跟随所选智能体的默认设置。'}</div>`;
}
function openMenu(name){
  if(state.working)return;
  const toggle=state.menu===name;closeMenus();if(toggle)return;
  state.menu=name;state.query='';if(name==='model')modelMenu();else agentMenu();
  $(`#${name}-picker`).hidden=false;$(`#${name}-trigger`).setAttribute('aria-expanded','true');positionPicker();
}
$('#model-trigger').addEventListener('click',()=>openMenu('model'));
$('#agent-trigger').addEventListener('click',()=>openMenu('agent'));
document.addEventListener('click',e=>{
  const model=e.target.closest('[data-model]'),agent=e.target.closest('[data-agent]'),scene=e.target.closest('[data-scene]');
  if(model){state.override=model.dataset.model==='default'?null:model.dataset.model;state.notice=true;closeMenus();render();$('#model-trigger').focus();}
  else if(agent){state.agent=agents.find(a=>a.id===agent.dataset.agent);state.notice=false;closeMenus();render();$('#agent-trigger').focus();}
  else if(scene){setScene(scene.dataset.scene);}
  else if(!e.target.closest('.picker,#model-trigger,#agent-trigger'))closeMenus();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){const active=state.menu;closeMenus();if(active)$(`#${active}-trigger`).focus();}
  if(state.menu&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&e.target.tagName!=='INPUT'){
    e.preventDefault();const items=[...$(`#${state.menu}-picker`).querySelectorAll('[role=option]')];let index=items.indexOf(document.activeElement);
    index=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;items[index]?.focus();
  }
  if(e.key==='Enter'&&e.target===editor&&!e.shiftKey){e.preventDefault();simulateSend();}
});
window.addEventListener('resize',positionPicker);
function setScene(name){
  closeMenus();state.agent=agents[0];state.override=null;state.notice=false;render();
  if(name==='menu')openMenu('model');
  if(name==='override'){state.override='GPT-5.5';state.notice=true;render();}
  if(name==='agent'){state.override='GPT-5.5';render();openMenu('agent');}
}
$('.prototype-mobile').addEventListener('click',()=>setScene('default'));
function simulateSend(){
  if(state.working||!editor.textContent.trim())return;
  closeMenus();const text=editor.textContent.trim(),model=currentModel(),agent=state.agent;
  $('.ws-chat-thread').insertAdjacentHTML('beforeend',`<div class="ws-chat-message user"><div><p>${escapeHTML(text)}</p></div></div><div class="ws-chat-message agent"><div><div class="response-author"><span class="ws-agent-avatar">${agent.avatar}</span>${agent.name}<small>${model} · 刚刚</small></div><div class="ws-markdown"><p>已收到。我会继续检查弱网重连和消息去重逻辑。</p><p style="color:#9296a0;font-size:12px">这是一条原型演示回复。</p></div></div></div>`);
  editor.textContent='';state.notice=false;render();$('.ws-chat-center').scrollTop=$('.ws-chat-center').scrollHeight;
}
$('.ws-chatbox').addEventListener('submit',e=>{e.preventDefault();simulateSend();});
render();
const requested=new URLSearchParams(location.search).get('scene');if(requested)requestAnimationFrame(()=>setScene(requested));
window.prototypeState=state;
