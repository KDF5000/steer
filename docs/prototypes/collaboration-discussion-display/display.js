const displayConcept=new URLSearchParams(location.search).get('concept')||'a';
document.body.dataset.discussionDisplay=displayConcept;
const displayChoices={a:['A · 开放消息','头像、作者与正文直接展示，沿用聊天内容的阅读节奏。'],b:['B · 灰色消息','讨论使用浅灰气泡，与蓝色 Agent 指令和 Agent 回复区分。'],c:['C · 连续讨论组','相邻讨论合并成一组，可收起；Agent 任务穿插时另起一组。']};
const displayInfo=displayChoices[displayConcept]||displayChoices.a;
const displayNav=document.createElement('div');displayNav.className='discussion-comparison';
displayNav.innerHTML=`<nav aria-label="展示方案">${Object.entries(displayChoices).map(([key,value])=>`<a href="?concept=${key}" ${key===displayConcept?'aria-current="page"':''}>${value[0]}</a>`).join('')}</nav><span>${displayInfo[1]}</span>`;
$('.ws-chat-page').prepend(displayNav);
const originalDiscussion=discussion;
function refreshGroup(group){const messages=[...group.querySelectorAll('.collab-discussion')];const people=[...new Set(messages.map(m=>m.dataset.author))];group.querySelector('.discussion-group-title').textContent=`参与者讨论 · ${messages.length} 条`;group.querySelector('.discussion-group-people').textContent=people.join('、');group.querySelector('.discussion-group-summary').textContent=messages.at(-1)?.dataset.text||'';}
function placeDiscussion(message){
  if(displayConcept==='c'){
    message.remove();let group=thread.lastElementChild;
    if(!group?.classList.contains('discussion-group')){group=document.createElement('section');group.className='discussion-group';group.innerHTML='<header><span class="discussion-group-title">参与者讨论</span><span class="discussion-group-people"></span><button type="button" class="discussion-group-toggle" aria-expanded="true" aria-label="收起讨论组">收起 <span>⌃</span></button></header><p class="discussion-group-summary" hidden></p><div class="discussion-group-messages"></div>';thread.append(group)}
    group.querySelector('.discussion-group-messages').append(message);refreshGroup(group);
  }
}
discussion=function(author,text){const message=originalDiscussion(author,text);placeDiscussion(message);return message};
document.querySelectorAll('.collab-discussion').forEach(placeDiscussion);
discussion('Alex','这个场景确实需要补充。先保留原会话，等网络恢复后再重试。');
discussion('林悦','同意，也建议加一条会话过期时保留输入内容的测试。');
const displayUpdate=update;
update=function(){displayUpdate();document.querySelectorAll('.collab-author small').forEach(n=>n.textContent='讨论 · 10:42')};
document.addEventListener('click',e=>{const toggle=e.target.closest('.discussion-group-toggle');if(!toggle)return;const group=toggle.closest('.discussion-group');const expanded=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!expanded));toggle.setAttribute('aria-label',expanded?'展开讨论组':'收起讨论组');toggle.innerHTML=expanded?'展开 <span>⌄</span>':'收起 <span>⌃</span>';group.querySelector('.discussion-group-messages').hidden=expanded;group.querySelector('.discussion-group-summary').hidden=!expanded;});
state.mode='discussion';update();
