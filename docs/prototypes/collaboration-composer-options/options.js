const concept=new URLSearchParams(location.search).get('concept')||'a';
document.body.dataset.concept=concept;
const choices={a:['A · 发送对象','发送前选择“参与者”或“Agent”，保留当前输入区。'],b:['B · @Agent 唤起','默认与参与者讨论，@Builder 后本条消息成为 Agent 任务。'],c:['C · 独立讨论区','主输入框始终发给 Agent，参与者在旁边的讨论区交流。']};
const chosen=choices[concept]||choices.a;
const compare=document.createElement('div');compare.className='option-compare';
compare.innerHTML=`<nav aria-label="交互方案">${Object.entries(choices).map(([key,value])=>`<a href="?concept=${key}" ${key===concept?'aria-current="page"':''}>${value[0]}</a>`).join('')}</nav><span>${chosen[1]}</span>`;
$('.ws-chat-page').prepend(compare);
const optionControls=document.createElement('div');optionControls.className='option-controls';
context.prepend(optionControls);
const baseUpdate=update;
let discussionPanel;
let panelEditor;
function setDestination(mode){state.mode=mode;update();editor.focus();}
if(concept==='a'){
  optionControls.innerHTML='<label class="option-destination"><span>发送给</span><select aria-label="发送对象"><option value="discussion">参与者 · 讨论</option><option value="task">Builder · 执行任务</option></select></label>';
  optionControls.querySelector('select').addEventListener('change',e=>setDestination(e.target.value));
  state.mode='discussion';
}
if(concept==='b'){
  optionControls.innerHTML='<button type="button" class="option-mention" aria-label="选择 Agent">@ Agent</button><span class="option-routing"></span>';
  const picker=document.createElement('div');picker.className='option-agent-picker';picker.hidden=true;
  picker.innerHTML='<small>当前机器上的 Agent</small><button type="button" data-pick-agent><b>@Builder</b><span>dev-machine / Codex</span></button><small>本次仅向 Builder 发起任务</small>';
  $('.ws-inline-composer').append(picker);
  optionControls.querySelector('button').addEventListener('click',()=>{if(state.mode==='task'){setDestination('discussion');return}picker.hidden=!picker.hidden;editor.focus()});
  picker.querySelector('button').addEventListener('click',()=>{editor.textContent=editor.textContent.replace(/@\s*$/,'');picker.hidden=true;setDestination('task')});
  editor.addEventListener('keydown',e=>{if(!picker.hidden&&e.key==='Enter'&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();picker.querySelector('button').click()}},true);
  editor.addEventListener('input',()=>{picker.hidden=!/@\s*$/.test(editor.textContent)||state.permission!=='execute'});
  editor.addEventListener('keydown',e=>{if(e.key==='Escape')picker.hidden=true;if(e.key==='Backspace'&&!editor.textContent&&state.mode==='task'){e.preventDefault();setDestination('discussion')}});
  const mention=document.createElement('span');mention.className='option-inline-mention';mention.textContent='@Builder';
  editor.before(mention);
  state.mode='discussion';
  const baseSubmit=submit;
  submit=function(){const valid=!send.disabled&&editor.textContent.trim();baseSubmit();if(valid){state.mode='discussion';update()}};
  send.addEventListener('click',()=>{if(!editor.textContent.trim()){state.mode='discussion';update()}});
}
if(concept==='c'){
  discussionPanel=document.createElement('aside');discussionPanel.className='option-discussion-panel';discussionPanel.setAttribute('aria-label','参与者讨论');
  discussionPanel.innerHTML='<header><span>参与者讨论</span><button type="button" aria-label="收起讨论">×</button></header><p class="option-panel-note">讨论留在这里，通过引用交给 Agent。</p><div class="option-discussion-list"></div><form class="option-discussion-form"><textarea aria-label="讨论内容" placeholder="与参与者讨论…" rows="2"></textarea><footer><span>林悦</span><button type="submit" aria-label="发送侧栏讨论">发送</button></footer></form>';
  $('.ws-chat-page').append(discussionPanel);
  const list=discussionPanel.querySelector('.option-discussion-list');
  document.querySelectorAll('.collab-discussion').forEach(n=>list.append(n));
  const baseDiscussion=discussion;
  discussion=function(author,text){const el=baseDiscussion(author,text);list.append(el);list.scrollTop=list.scrollHeight;return el};
  panelEditor=discussionPanel.querySelector('textarea');
  discussionPanel.querySelector('form').addEventListener('submit',e=>{e.preventDefault();if(state.permission==='view'||!panelEditor.value.trim())return;discussion(state.actor,panelEditor.value.trim());panelEditor.value='';panelEditor.focus()});
  const toggle=document.createElement('button');toggle.className='option-panel-toggle';toggle.type='button';toggle.innerHTML=svg('chat')+'<span>讨论</span>';headerControls.prepend(toggle);
  toggle.addEventListener('click',()=>document.body.classList.toggle('discussion-open'));
  discussionPanel.querySelector('header button').addEventListener('click',()=>document.body.classList.remove('discussion-open'));
  discussionPanel.addEventListener('click',e=>{if(e.target.closest('[data-discussion]')&&state.permission==='execute'&&innerWidth<768)document.body.classList.remove('discussion-open')});
  state.mode='task';document.body.classList.add('discussion-open');
}
update=function(){
  baseUpdate();
  if(concept==='a'){const select=optionControls.querySelector('select');select.value=state.mode;select.disabled=state.permission==='view';select.querySelector('[value="task"]').disabled=state.permission!=='execute'}
  if(concept==='b'){
    optionControls.querySelector('button').textContent=state.mode==='task'?'取消 @Builder':'@ Agent';
    optionControls.querySelector('button').disabled=state.permission!=='execute';
    optionControls.querySelector('.option-routing').textContent=state.mode==='task'?'仅本条消息发起任务':'发给参与者';
    $('.option-inline-mention').hidden=state.mode!=='task';
    editor.dataset.placeholder=state.permission==='view'?'你可以查看此会话':state.mode==='task'?'描述希望 Builder 完成的任务…':'发送讨论，输入 @ 选择 Agent…';
  }
  if(concept==='c'){
    panelEditor.disabled=state.permission==='view';discussionPanel.querySelector('button[type="submit"]').disabled=state.permission==='view';
    discussionPanel.querySelector('footer span').textContent=state.actor;
    if(state.permission!=='execute'){editor.contentEditable='false';send.disabled=true;editor.dataset.placeholder='暂无 Agent 执行权限，可以在讨论区交流'}
  }
};
document.addEventListener('change',()=>update());
update();
