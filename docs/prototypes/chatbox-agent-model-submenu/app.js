const $ = (selector) => document.querySelector(selector);
const paths = {
  chevron: '<path d="m6 9 6 6 6-6"/>', check: '<path d="m5 12 4 4L19 6"/>',
  right: '<path d="m9 18 6-6-6-6"/>', left: '<path d="m15 18-6-6 6-6"/>',
  model: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/><path d="M9 9h6v6H9z"/>',
  follow: '<path d="M20 7h-9a5 5 0 0 0 0 10h9M16 3l4 4-4 4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  agent: '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  quote: '<path d="M4 5h6v7H6a5 5 0 0 1-2 5m10-12h6v7h-4a5 5 0 0 1-2 5"/>',
};
const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${['chevron','right','left'].includes(name)?2:1.6}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const agents = [
  {id:'frontend',name:'前端工程师',avatar:'前',role:'页面开发与交互实现',skills:'React · 交互设计 · Web 性能',model:'GPT-5.4'},
  {id:'reviewer',name:'代码审查员',avatar:'审',role:'检查实现、边界与风险',skills:'代码审查 · 安全检查',model:'GPT-5.5'},
  {id:'general',name:'通用助手',avatar:'通',role:'日常开发与问题分析',skills:'通用开发',model:'GPT-5.4'},
];
const models = ['GPT-5.4','GPT-5.5','Gemini-3.1-Pro-Preview','DeepSeek-V4-Pro'];
const state = {agent:agents[0],override:null,menu:null,query:'',notice:false,working:false,previewAgent:null};
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
context.innerHTML=`<button class="ws-composer-agent" id="agent-trigger" type="button" aria-label="选择智能体和模型" aria-haspopup="menu" aria-expanded="false"></button><span class="control-divider"></span><button class="ws-composer-project" type="button" title="当前项目：Steer">${icon('folder')}<span>Steer</span></button>`;
$('.ws-chatbox').insertAdjacentHTML('beforebegin','<div class="model-change-note" role="status" hidden></div>');
document.body.insertAdjacentHTML('beforeend','<div class="picker agent-menu" id="agent-picker" hidden></div><div class="picker model-menu" id="model-picker" hidden></div>');
$('.ws-sidebar-footer').insertAdjacentHTML('afterbegin',`<div class="prototype-controls"><span>智能体 → 模型 · 二级菜单</span><nav><button data-scene="default">默认状态</button><button data-scene="agent">智能体菜单</button><button data-scene="menu">二级菜单</button><button data-scene="override">切换后</button></nav><p>点击智能体直接接手；展开右侧箭头选择模型。列表与回复均为演示数据。</p></div>`);
const editor=$('.ws-inline-editor');editor.textContent='再检查一下弱网下的重连逻辑，尤其是消息重复发送的情况。';
$('.ws-chat-send').disabled=false;
const mobileLayout=()=>matchMedia('(max-width:767px)').matches;
function render(){
  $('#agent-trigger').innerHTML=`<span class="ws-agent-avatar">${state.agent.avatar}</span><span class="combined-label"><span class="combined-agent">${state.agent.name}</span><span class="combined-dot">·</span><span class="combined-model">${currentModel()}</span></span>${icon('chevron')}`;
  $('#agent-trigger').title=`${state.agent.name} · ${currentModel()}${state.override?'（当前会话指定）':'（智能体默认）'}`;
  $('.ws-chat-mode-note').innerHTML=`Trae · 我的 Mac <span class="note-label">· ${state.override?'当前会话指定模型':'跟随智能体默认模型'}</span>`;
  const notice=$('.model-change-note');notice.hidden=!state.notice;notice.innerHTML=`${icon('check')}下一条消息：${state.agent.name} · ${currentModel()}`;
}
function closeSubmenu(){
  $('#model-picker').hidden=true;$('#agent-picker').classList.remove('is-submenu-open');
  state.previewAgent=null;state.query='';
  $('#agent-picker').querySelectorAll('[data-submenu]').forEach(el=>el.setAttribute('aria-expanded','false'));
  $('#agent-picker').querySelectorAll('.agent-row').forEach(el=>el.classList.remove('is-preview'));
}
function closeMenus(){closeSubmenu();state.menu=null;$('#agent-picker').hidden=true;$('#agent-trigger').setAttribute('aria-expanded','false');}
function agentMenu(){
  $('#agent-picker').innerHTML=`<div class="picker-heading">选择智能体<span class="runtime-tag"><i></i>Trae</span></div><div class="picker-section">角色与技能</div><div role="menu" aria-label="智能体">${agents.map(a=>`<div class="agent-row" data-row="${a.id}"><button class="picker-item" role="menuitem" data-agent="${a.id}"><span class="item-icon">${a.avatar}</span><span class="item-copy"><span class="item-name">${a.name}${a.id===state.agent.id?icon('check','picker-check'):''}</span><small>${a.role}</small><small>${a.id===state.agent.id?currentModel():a.model}</small></span></button><button type="button" class="agent-submenu-trigger" role="menuitem" aria-label="选择${a.name}的模型" aria-haspopup="menu" aria-expanded="false" data-submenu="${a.id}">${icon('right')}</button></div>`).join('')}</div><div class="picker-foot">点击名称选择智能体，展开箭头选择模型。</div>`;
  $('#agent-picker').querySelectorAll('[data-row]').forEach(row=>row.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&!mobileLayout())openSubmenu(row.dataset.row);}));
}
function openAgentMenu(){
  if(state.menu){closeMenus();return;}
  state.menu='agent';agentMenu();$('#agent-picker').hidden=false;$('#agent-trigger').setAttribute('aria-expanded','true');positionPicker();
}
function openSubmenu(id,focus=false){
  const previousFocus=document.activeElement;
  state.previewAgent=agents.find(a=>a.id===id);state.query='';
  $('#agent-picker').querySelectorAll('[data-submenu]').forEach(el=>el.setAttribute('aria-expanded',String(el.dataset.submenu===id)));
  $('#agent-picker').querySelectorAll('[data-row]').forEach(el=>el.classList.toggle('is-preview',el.dataset.row===id));
  modelMenu();$('#model-picker').hidden=false;$('#agent-picker').classList.add('is-submenu-open');positionPicker();
  if(focus)$('#model-picker [role=menuitem]').focus();else if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
}
function modelMenu(){
  const a=state.previewAgent;const following=a.id===state.agent.id&&state.override===null;
  $('#model-picker').innerHTML=`<button type="button" class="submenu-back">${icon('left')}返回智能体</button><div class="picker-heading"><span class="submenu-heading"><strong>${a.name}</strong><small>选择本次会话使用的模型</small></span><span class="runtime-tag">模型</span></div><label class="picker-search">${icon('search')}<input placeholder="搜索模型…" aria-label="搜索模型"></label><div role="menu" aria-label="${a.name}的模型"><button class="picker-item" role="menuitem" data-model="default"><span class="item-icon">${icon('follow')}</span><span class="item-copy"><span class="item-name">跟随智能体默认</span><small>${a.model}</small></span>${following?icon('check','picker-check'):''}</button><div class="picker-rule"></div><div id="model-options"></div></div><div class="picker-foot">仅对当前会话生效，保留该智能体的角色与技能。</div>`;
  renderModels();$('#model-picker input').addEventListener('input',e=>{state.query=e.target.value;renderModels();positionPicker();});
  $('.submenu-back').addEventListener('click',()=>{const id=state.previewAgent.id;closeSubmenu();positionPicker();$(`[data-submenu="${id}"]`).focus();});
}
function renderModels(){
  const a=state.previewAgent;
  $('#model-options').innerHTML=models.filter(m=>m.toLowerCase().includes(state.query.toLowerCase())).map(m=>`<button class="picker-item" role="menuitem" data-model="${m}"><span class="item-icon">${icon('model')}</span><span class="item-copy"><span class="item-name">${m}${m===a.model?'<span class="item-badge">默认</span>':''}</span></span>${a.id===state.agent.id&&state.override===m?icon('check','picker-check'):''}</button>`).join('')||'<div class="picker-foot">没有匹配的模型</div>';
}
function positionPicker(){
  if(!state.menu)return;
  const root=$('#agent-picker'),sub=$('#model-picker'),r=$('#agent-trigger').getBoundingClientRect();
  const rootLeft=Math.max(16,Math.min(r.left,innerWidth-root.offsetWidth-16));
  const rootTop=Math.max(12,r.top-root.offsetHeight-10);
  root.style.left=`${rootLeft}px`;root.style.top=`${rootTop}px`;
  if(sub.hidden)return;
  if(mobileLayout()){
    sub.style.left=`${Math.max(16,Math.min(rootLeft,innerWidth-sub.offsetWidth-16))}px`;
    sub.style.top=`${Math.max(12,r.top-sub.offsetHeight-10)}px`;
  }else{
    const row=$(`[data-row="${state.previewAgent.id}"]`).getBoundingClientRect();
    const right=rootLeft+root.offsetWidth+4;
    sub.style.left=`${right+sub.offsetWidth<=innerWidth-16?right:Math.max(16,rootLeft-sub.offsetWidth-4)}px`;
    sub.style.top=`${Math.max(12,Math.min(row.top-7,r.top-sub.offsetHeight-10))}px`;
  }
}
$('#agent-trigger').addEventListener('click',openAgentMenu);
document.addEventListener('click',e=>{
  const submenu=e.target.closest('[data-submenu]'),model=e.target.closest('[data-model]'),agent=e.target.closest('[data-agent]'),scene=e.target.closest('[data-scene]');
  if(submenu)openSubmenu(submenu.dataset.submenu);
  else if(model){state.agent=state.previewAgent;state.override=model.dataset.model==='default'?null:model.dataset.model;state.notice=true;closeMenus();render();$('#agent-trigger').focus();}
  else if(agent){const target=agents.find(a=>a.id===agent.dataset.agent);if(target.id!==state.agent.id){state.agent=target;state.override=null;state.notice=true;}closeMenus();render();$('#agent-trigger').focus();}
  else if(scene)setScene(scene.dataset.scene);
  else if(!e.target.closest('.picker,#agent-trigger'))closeMenus();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&state.menu){e.preventDefault();if(!$('#model-picker').hidden){const id=state.previewAgent.id;closeSubmenu();$(`[data-submenu="${id}"]`).focus();}else{closeMenus();$('#agent-trigger').focus();}}
  if(e.key==='ArrowRight'&&e.target.closest('[data-agent],[data-submenu]')){e.preventDefault();const row=e.target.closest('[data-row]');openSubmenu(row.dataset.row,true);}
  if(e.key==='ArrowLeft'&&e.target.closest('#model-picker')){e.preventDefault();const id=state.previewAgent.id;closeSubmenu();$(`[data-submenu="${id}"]`).focus();}
  if(state.menu&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)&&e.target.tagName!=='INPUT'){
    e.preventDefault();const panel=e.target.closest('#model-picker')||$('#agent-picker');const items=[...panel.querySelectorAll('[role=menuitem]')];let i=items.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?items.length-1:e.key==='ArrowDown'?(i+1)%items.length:(i-1+items.length)%items.length;items[i]?.focus();
  }
  if(e.key==='Enter'&&e.target===editor&&!e.shiftKey){e.preventDefault();simulateSend();}
});
window.addEventListener('resize',positionPicker);
function setScene(name){closeMenus();state.agent=agents[0];state.override=null;state.notice=false;render();if(name==='agent')openAgentMenu();if(name==='menu'){openAgentMenu();openSubmenu('frontend');}if(name==='override'){state.override='GPT-5.5';state.notice=true;render();}}
function simulateSend(){
  if(!editor.textContent.trim())return;closeMenus();const text=editor.textContent.trim(),model=currentModel(),agent=state.agent;
  $('.ws-chat-thread').insertAdjacentHTML('beforeend',`<div class="ws-chat-message user"><div><p>${escapeHTML(text)}</p></div></div><div class="ws-chat-message agent"><div><div class="response-author"><span class="ws-agent-avatar">${agent.avatar}</span>${agent.name}<small>${model} · 刚刚</small></div><div class="ws-markdown"><p>已收到。我会继续检查弱网重连和消息去重逻辑。</p><p style="color:#9296a0;font-size:12px">这是一条原型演示回复。</p></div></div></div>`);
  editor.textContent='';state.notice=false;render();$('.ws-chat-center').scrollTop=$('.ws-chat-center').scrollHeight;
}
$('.ws-chatbox').addEventListener('submit',e=>{e.preventDefault();simulateSend();});
render();const requested=new URLSearchParams(location.search).get('scene');if(requested)requestAnimationFrame(()=>setScene(requested));window.prototypeState=state;
