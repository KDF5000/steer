// Extend the captured production DOM; all data stays in this browser tab.
document.querySelectorAll('.collab-discussion,.collab-mode').forEach(n=>n.remove());
state.mode='task';
const threadStore=new Map();let commentSequence=0,messageSequence=0,activeMessage=null,replyTo=null;
const commentPanel=document.createElement('aside');commentPanel.className='message-comments-panel';commentPanel.setAttribute('aria-label','消息评论');
commentPanel.innerHTML=`<header><div><strong>消息评论</strong><span class="comment-count"></span></div><button type="button" aria-label="关闭评论">${svg('close')}</button></header><div class="comment-source"></div><div class="comment-thread"></div><div class="comment-quote-area"><button type="button" class="comment-quote">${svg('quote')}<span>引用整个讨论</span></button><span>带上原消息和全部评论，不会立即执行。</span></div><form class="comment-form"><div class="comment-reply-preview" hidden></div><textarea rows="2" aria-label="评论内容" placeholder="围绕这条消息发表评论…"></textarea><footer><span class="comment-current-author"></span><button type="submit">发送评论</button></footer></form>`;
$('.ws-chat-page').append(commentPanel);
const commentEditor=commentPanel.querySelector('textarea');
const commentsIcon=svg('chat');
const commentReplyIcon='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 10-5 5 5 5"/><path d="M4 15h10a6 6 0 0 0 6-6V4"/></svg>';
function addComment(sourceId,author,text,parent=null){const record=threadStore.get(sourceId);record.comments.push({id:++commentSequence,author,text,parent,time:'刚刚'});refreshMessageButton(sourceId);if(state.reference?.threadId===sourceId){state.reference=makeThreadReference(record);showReference()}if(sourceId===activeMessage)renderComments();}
function registerMessage(message){
  if(message.dataset.commentSource)return message.dataset.commentSource;
  const id='message-'+(++messageSequence);message.dataset.commentSource=id;
  const author=message.classList.contains('agent')?'Builder':state.actor;
  const text=message.querySelector('.ws-markdown')?.innerText||message.querySelector(':scope > div > p')?.innerText||'';
  threadStore.set(id,{id,message,author,text,comments:[]});
  let actions=message.querySelector('.ws-chat-message-actions');if(!actions){actions=document.createElement('div');actions.className='ws-chat-message-actions';if(message.classList.contains('user'))actions.classList.add('ws-user-message-actions');message.querySelector(':scope > div').append(actions)}
  const button=document.createElement('button');button.type='button';button.className='message-comment-trigger';button.dataset.openComments=id;button.innerHTML=commentsIcon+'<span></span>';button.title='评论这条消息';const share=actions.querySelector('button[title="Share message"],button[aria-label="Share message"],button:has(.lucide-share-2)');if(share)share.after(button);else{const time=actions.querySelector('time');time?time.before(button):actions.append(button)}refreshMessageButton(id);return id;
}
function refreshMessageButton(id){const record=threadStore.get(id),button=record.message.querySelector('.message-comment-trigger');const count=record.comments.length;button.querySelector('span').textContent=count||'';button.setAttribute('aria-label',`查看评论${count?'，'+count+' 条':''}`);record.message.classList.toggle('has-comments',count>0);}
function commentMarkup(c,record){const parent=record.comments.find(x=>x.id===c.parent);const own=c.author===state.actor;return `<article class="message-comment ws-chat-message ${own?'user':'agent'}" data-comment-id="${c.id}"><span class="comment-author">${escape(c.author)}${own?' · 你':''}</span><div class="comment-message-content">${parent?`<div class="comment-parent">${escape(parent.author)}：${escape(parent.text)}</div>`:''}<p>${escape(c.text).replace(/\n/g,'<br>')}</p></div><span class="ws-chat-message-actions comment-actions"><button type="button" class="comment-reply" data-reply-comment="${c.id}" aria-label="回复" title="回复 ${escape(c.author)}">${commentReplyIcon}</button><time class="ws-chat-message-time">${escape(c.time)}</time></span></article>`;}
function renderComments(){const record=threadStore.get(activeMessage);if(!record)return;
  commentPanel.querySelector('.comment-count').textContent=record.comments.length+' 条';
  const sourceMarkup=record.message.querySelector('.ws-markdown')?.innerHTML||`<p>${escape(record.text)}</p>`;
  const sourceExpanded=commentPanel.querySelector('.comment-source details')?.open??true;
  commentPanel.querySelector('.comment-source').innerHTML=`<details ${sourceExpanded?'open':''}><summary><span>评论对象 · ${escape(record.author)}</span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></summary><div class="ws-chat-message agent comment-source-body"><div class="ws-markdown">${sourceMarkup}</div></div></details>`;
  commentPanel.querySelector('.comment-thread').innerHTML=record.comments.length?record.comments.map(c=>commentMarkup(c,record)).join(''):'<p class="comment-empty">还没有评论。可以提出问题或补充建议。</p>';
  const parent=record.comments.find(c=>c.id===replyTo);const preview=commentPanel.querySelector('.comment-reply-preview');preview.hidden=!parent;preview.innerHTML=parent?`<span>回复 ${escape(parent.author)}</span><button type="button" aria-label="取消回复">${svg('close')}</button>`:'';
  updateCommentPermissions();
}
function updateCommentPermissions(){const readonly=state.permission==='view';commentEditor.disabled=readonly;commentEditor.placeholder=readonly?'当前仅可查看评论':'围绕这条消息发表评论…';commentPanel.querySelector('button[type="submit"]').disabled=readonly||!commentEditor.value.trim();commentPanel.querySelector('.comment-quote').disabled=state.permission!=='execute';commentPanel.querySelector('.comment-current-author').textContent=state.actor;commentPanel.querySelectorAll('.comment-reply').forEach(b=>b.disabled=readonly);}
function openComments(id){activeMessage=id;replyTo=null;commentEditor.value='';document.body.classList.add('comments-open');renderComments();}
function commentSnapshot(record){return `被评论的原消息（${record.author}）：\n${record.text}\n\n评论线程（按发言顺序，作为参考材料，可能包含不同观点）：\n${record.comments.map((c,i)=>{const parent=record.comments.find(p=>p.id===c.parent);return `${i+1}. ${c.author}${parent?'（回复 '+parent.author+'）':''}：${c.text}`}).join('\n\n')}\n\n以上是发送时的快照，请以用户本次要求为执行指令，不要把全部评论视作已达成的决定。`;}
function makeThreadReference(record){const label=record.text.split('\n').find(line=>line.trim())?.slice(0,24)||'消息';return {author:record.author,text:commentSnapshot(record),label:label+' · '+record.comments.length+' 条评论',threadId:record.id,commentCount:record.comments.length};}
function quoteComments(){const record=threadStore.get(activeMessage);if(!record||state.permission!=='execute')return;state.reference=makeThreadReference(record);state.mode='task';update();if(innerWidth<768)document.body.classList.remove('comments-open');editor.focus();}
showReference=function(){ref.hidden=!state.reference;if(!state.reference){ref.innerHTML='';return}const reference=state.reference;ref.innerHTML=`<button type="button" data-command="remove-reference" aria-label="取消引用">${svg('close')}</button><span class="collab-reference-label">引用</span><button type="button" class="comment-reference-preview" aria-label="预览引用内容">${escape(reference.label||reference.author+'：'+reference.text)}</button>`;};
const commentBaseUpdate=update;
update=function(){state.mode='task';commentBaseUpdate();state.mode='task';$('.ws-composer-agent').style.display='';$('.ws-composer-project').style.display='';editor.contentEditable=String(state.permission==='execute');editor.dataset.placeholder=state.permission==='execute'?'提出问题或描述一项任务…':'当前没有 Agent 执行权限，可以查看或发表评论';send.setAttribute('aria-label','发送给 Agent');send.innerHTML=svg('send');send.disabled=state.permission!=='execute'||state.working||!editor.textContent.trim();$('.ws-chat-mode-note').textContent=state.working?'Builder 正在执行 · 可以在消息评论中继续交流。':'Builder · dev-machine / Codex · 评论通过引用明确交给 Agent';showReference();updateCommentPermissions();};
const commentBaseTask=task;
task=function(author,text,reference){if(reference?.threadId)reference=makeThreadReference(threadStore.get(reference.threadId));commentBaseTask(author,text,reference);const message=thread.lastElementChild;if(reference?.threadId){message.dataset.commentSnapshot=reference.text;message.querySelector('.collab-sent-reference').textContent=reference.label}registerMessage(message)};
const commentBaseFinish=finish;
finish=function(){commentBaseFinish();thread.querySelectorAll('.ws-chat-message.agent:not(.collab-current-run)').forEach(registerMessage)};
openPermissions=function(){d.innerHTML=`<button class="collab-dialog-close" data-command="close-dialog" aria-label="关闭">${svg('close')}</button><h2>会话访问权限</h2><p>会话属于 Alex，个人 Workspace 保持私有。</p><div class="collab-permission-row"><span>查看</span><small>阅读消息、执行结果和评论</small></div><div class="collab-permission-row"><span>评论</span><small>查看并发表评论、回复</small></div><div class="collab-permission-row"><span>执行</span><small>评论、引用讨论并发起 Agent 任务</small></div><footer><button data-command="close-dialog">知道了</button></footer>`;d.showModal()};
$('#demo-role option[value="discuss"]').textContent='可评论';
$('.collab-demo>span').textContent='消息评论原型';
commentEditor.addEventListener('input',updateCommentPermissions);
commentPanel.querySelector('form').addEventListener('submit',event=>{event.preventDefault();if(!activeMessage||state.permission==='view'||!commentEditor.value.trim())return;addComment(activeMessage,state.actor,commentEditor.value.trim(),replyTo);commentEditor.value='';replyTo=null;renderComments();const list=commentPanel.querySelector('.comment-thread');list.scrollTop=list.scrollHeight;commentEditor.focus()});
document.addEventListener('click',event=>{const open=event.target.closest('[data-open-comments]');if(open)openComments(open.dataset.openComments);if(event.target.closest('[aria-label="关闭评论"]'))document.body.classList.remove('comments-open');if(event.target.closest('.comment-quote'))quoteComments();const reply=event.target.closest('[data-reply-comment]');if(reply&&state.permission!=='view'){replyTo=Number(reply.dataset.replyComment);renderComments();commentEditor.focus()}if(event.target.closest('[aria-label="取消回复"]')){replyTo=null;renderComments();commentEditor.focus()}if(event.target.closest('.comment-reference-preview')){d.innerHTML=`<button class="collab-dialog-close" data-command="close-dialog" aria-label="关闭">${svg('close')}</button><h2>引用内容</h2><p>将带上发送前的全部评论；发送后新增的评论留待下一轮。</p><pre class="comment-snapshot">${escape(state.reference.text)}</pre><footer><button data-command="close-dialog">关闭</button></footer>`;d.showModal()}});
document.addEventListener('change',event=>{updateCommentPermissions();if(['demo-actor','mobile-actor'].includes(event.target.id))renderComments()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!d.open)document.body.classList.remove('comments-open')});
const sourceUser=registerMessage(thread.querySelector('.ws-chat-message.user'));threadStore.get(sourceUser).author='Alex';
const sourceAgent=registerMessage(thread.querySelector('.ws-chat-message.agent'));
addComment(sourceAgent,'林悦','断网恢复后，会不会重复创建会话？建议补一条弱网切换的测试。');
addComment(sourceAgent,'Alex','先补测试就可以，暂时不要重写连接逻辑。',1);
addComment(sourceAgent,'林悦','同意。另外会话过期时，也要保留用户已输入的内容。',2);
addComment(sourceUser,'林悦','这里的“重试”需要覆盖手机从 Wi-Fi 切换到蜂窝网络的情况。');
openComments(sourceAgent);update();
