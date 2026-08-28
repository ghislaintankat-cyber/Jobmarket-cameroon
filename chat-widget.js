// ============================================================
// Widget « Chat sécurisé » — interface style WhatsApp (fournie par
// Ghislain), nettoyée (pas de données démo) et traduite en français.
// Branchée sur Firebase par app.js (patchChatWidgetForFirebase).
// Objet global : W (API publique : W.openChat, W.addMessage, ...)
// ============================================================
(function(){
"use strict";

const SENDER_COLORS=['#e17076','#7bc862','#6ec9cb','#efa9a7','#69c7ef','#e1a05d','#d4a5e5','#73c475'];
const EMOJI={
  'Smileys':['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐'],
  'Gestures':['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏'],
  'Hearts':['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝'],
  'Animals':['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🦆','🦅','🦉','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞'],
  'Food':['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥖','🍞','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🫔','🥙'],
  'Travel':['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','✈️','🛫','🛬','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢'],
  'Objects':['⌚','📱','💻','⌨️','🖥️','🖨️','🖱️','🖲️','💽','💾','💿','📀','📷','📹','🎥','📽️','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','📡','🔋','🔌','💡','🔦','🕯️'],
  'Symbols':['💯','✅','❌','⭕','❗','❓','‼️','⁉️','💤','💢','💣','💥','💦','💨','🕳️','💫','🎵','🎶','🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏴‍☠️']
};
const SVG={
  check:`<svg width="16" height="16" viewBox="0 0 16 15" fill="currentColor"><path d="M10.91 3.316l-.478-.372a.365.365 0 00-.51.063L4.566 9.879a.32.32 0 01-.484.033L1.891 7.769a.366.366 0 00-.515.006l-.423.433a.364.364 0 00.006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 00-.063-.51z"/></svg>`,
  double:`<svg width="16" height="16" viewBox="0 0 16 15" fill="currentColor"><path d="M15.01 3.316l-.478-.372a.365.365 0 00-.51.063L8.666 9.879a.32.32 0 01-.484.033l-.358-.325a.319.319 0 00-.484.032l-.378.483a.418.418 0 00.036.541l1.32 1.266c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 00-.063-.51zm-4.1 0l-.478-.372a.365.365 0 00-.51.063L4.566 9.879a.32.32 0 01-.484.033L1.891 7.769a.366.366 0 00-.515.006l-.423.433a.364.364 0 00.006.514l3.258 3.185c.143.14.361.125.484-.033l6.272-8.048a.365.365 0 00-.063-.51z"/></svg>`,
  play:`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  pause:`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
  star:`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};

// ===== LANGUE (injectée par app.js via W.setLang, cf. I18N de l'app) =====
// Le widget reste autonome : sans injection, il retombe sur le français.
const LANG={};
const FALLBACK={
  typing:"en train d'écrire…",online:"en ligne",lastSeen:"vu {x}",photo:"Photo",voice:"Voice",file:"Fichier",
  edited:"modifié",today:"Aujourd'hui",yesterday:"Hier",you:"Toi",unknown:"Inconnu",editBanner:"Modification du message",
  noResults:"0 résultat(s)",emojiPh:"Rechercher…",option:"Option {x}",reply:"Répondre",react:"Réagir",edit:"Modifier",
  copy:"Copier",forward:"Transférer",star:"Étoiler",unstar:"Retirer l'étoile",pin:"Épingler",unpin:"Désépingler",del:"Supprimer",
  noStarred:"Aucun message étoilé",nStarred:"{x} message(s) étoilé(s)",about:"Salut 👋 Je suis sur JobMarket.",
  noMedia:"Aucun média partagé",votes:"vote",download:"Enregistrer",lockNotice:"Messages sécurisés — cette conversation reste entre vous deux.",newMsgs:"Nouveaux messages"
};
function T(k,x){let v=LANG[k]!==undefined?LANG[k]:FALLBACK[k];if(v===undefined)v=k;if(x!==undefined&&typeof v==='string')v=v.split('{x}').join(String(x));return v}

// Audio context for sounds
let audioCtx=null;
function playSound(type){
  try{
    if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.connect(g);g.connect(audioCtx.destination);
    if(type==='send'){o.frequency.value=880;g.gain.value=.08;o.start();o.stop(audioCtx.currentTime+.08)}
    else if(type==='recv'){o.frequency.value=660;g.gain.value=.06;o.start();setTimeout(()=>{const o2=audioCtx.createOscillator(),g2=audioCtx.createGain();o2.connect(g2);g2.connect(audioCtx.destination);o2.frequency.value=880;g2.gain.value=.06;o2.start();o2.stop(audioCtx.currentTime+.08)},100);o.stop(audioCtx.currentTime+.08)}
  }catch(e){}
}

function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML}
function linkify(t){return t.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>')}
function fmtSize(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB'}
function uid(){return 'm'+Date.now()+'_'+Math.random().toString(36).substr(2,6)}
function getSenderColor(id){let h=0;for(let i=0;i<id.length;i++)h=id.charCodeAt(i)+((h<<5)-h);return SENDER_COLORS[Math.abs(h)%SENDER_COLORS.length]}
function genWave(){let b='';for(let i=0;i<32;i++){const h=Math.random()*22+4;b+=`<div class="bar" style="height:${h}px"></div>`}return b}

const W={
  contacts:[],convs:{},activeId:null,replyTo:null,editId:null,
  rec:false,recT:null,recS:0,theme:'light',_ev:{},
  _tab:'all',_search:'',_msgSearch:'',_searchIdx:0,_searchHits:[],
  _profileOpen:false,_searchOpen:false,_starred:new Set(),_pinned:new Set(),
  _scrolledUp:false,_userScrolled:false,

  // ===== PUBLIC API =====
  init(cfg={}){
    if(cfg.contacts)this.contacts=cfg.contacts;
    if(cfg.conversations)Object.keys(cfg.conversations).forEach(k=>this.convs[k]=cfg.conversations[k]);
    if(cfg.theme)this.setTheme(cfg.theme);
    if(cfg.myAvatar)$('waMyAv').src=cfg.myAvatar;
    if(cfg.pinned)cfg.pinned.forEach(id=>this._pinned.add(id));
    if(cfg.favorites)cfg.favorites.forEach(id=>{const c=this.contacts.find(c=>c.id===id);if(c)c.favorite=true});
    this._buildEmoji();this._bindEvents();this.renderChats();this._updSend();
  },
  setContacts(c){this.contacts=c;this.renderChats()},
  addContact(c){this.contacts.push(c);this.renderChats()},
  updateContact(id,u){const c=this.contacts.find(c=>c.id===id);if(c)Object.assign(c,u);this.renderChats();if(id===this.activeId)this._updHead(c)},
  setMessages(cid,msgs){this.convs[cid]=msgs;if(cid===this.activeId)this.renderMsgs();this.renderChats()},
  addMessage(cid,msg){
    if(!this.convs[cid])this.convs[cid]=[];
    this.convs[cid].push(msg);
    if(cid===this.activeId){this.renderMsgs();if(!this._userScrolled)this.scrollToBottom()}
    this.renderChats();
    if(msg.from!=='me'){playSound('recv');if(cid!==this.activeId)this._showToast(cid,msg)}
    this.emit('messageReceived',{contactId:cid,message:msg});
  },
  updateStatus(cid,mid,status){const ms=this.convs[cid];if(!ms)return;const m=ms.find(m=>m.id===mid);if(m){m.status=status;if(cid===this.activeId)this.renderMsgs();this.renderChats()}},
  showTyping(cid){const c=this.contacts.find(c=>c.id===cid);if(c)c._typing=true;if(cid===this.activeId){const s=$('waHeadStatus');s.textContent=T('typing');s.classList.add('typing');this._showTypingBub()}this.renderChats()},
  hideTyping(cid){const c=this.contacts.find(c=>c.id===cid);if(c)c._typing=false;if(cid===this.activeId){this._updHead(c);this._hideTypingBub()}this.renderChats()},
  openChat(cid){
    this._stopVoice();
    this.activeId=cid;const c=this.contacts.find(c=>c.id===cid);if(!c)return;
    const ms=this.convs[cid]||[];ms.forEach(m=>{if(m.from!=='me'&&m.unread)m.unread=false});
    $('waEmpty').style.display='none';$('waCHead').style.display='flex';$('waMsgs').style.display='flex';$('waInputArea').style.display='flex';
    if(window.innerWidth<=900){$('waSide').classList.add('hidden')}
    this._updHead(c);this.renderMsgs();this.renderChats();this.scrollToBottom();
    this._userScrolled=false;this.emit('chatOpened',cid);
  },
  goBack(){
    this._stopVoice();
    this.activeId=null;$('waSide').classList.remove('hidden');
    $('waEmpty').style.display='flex';$('waCHead').style.display='none';$('waMsgs').style.display='none';$('waInputArea').style.display='none';
    this._closeProfile();
  },
  sendMessage(cid,data){
    const msg={id:uid(),from:'me',time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),status:'sent',_ts:Date.now(),...data};
    this.addMessage(cid,msg);playSound('send');return msg;
  },
  addReaction(cid,mid,emoji){
    // TOGGLE comme WhatsApp : on ajoute la 1re fois, on retire au 2e appui.
    const ms=this.convs[cid];if(!ms)return;const m=ms.find(m=>m.id===mid);if(!m)return;
    if(!m.reactions)m.reactions=[];
    const ex=m.reactions.find(r=>r.emoji===emoji);
    if(ex){ex.count=(ex.count||1)-1;if(ex.count<=0)m.reactions=m.reactions.filter(r=>r!==ex);}
    else m.reactions.push({emoji,count:1});
    if(cid===this.activeId)this.renderMsgs();
    this.emit('reactionToggled',{contactId:cid,messageId:mid,reactions:(m.reactions||[]).slice()});
  },
  editMessage(cid,mid,newText){
    const ms=this.convs[cid];if(!ms)return;const m=ms.find(m=>m.id===mid);if(m){m.text=newText;m.edited=true;if(cid===this.activeId)this.renderMsgs()}
  },
  deleteMessage(cid,mid){
    const ms=this.convs[cid];if(!ms)return;const i=ms.findIndex(m=>m.id===mid);
    if(i>-1){ms.splice(i,1);this.renderMsgs();this.renderChats();this.emit('messageDeleted',{msgId:mid,contactId:cid})}
  },
  toggleTheme(){this.theme=this.theme==='light'?'dark':'light';this.setTheme(this.theme)},
  setTheme(t){this.theme=t;$('wa').setAttribute('data-theme',t)},
  setLang(dict){
    Object.assign(LANG,dict||{});
    this.renderChats();
    if(this.activeId){this.renderMsgs();const c=this.contacts.find(c=>c.id===this.activeId);if(c)this._updHead(c)}
    const ei=$('waEmojiSearchIn');if(ei)ei.placeholder=T('emojiPh');
  },
  pinChat(cid){if(this._pinned.has(cid))this._pinned.delete(cid);else this._pinned.add(cid);this.renderChats()},
  starMsg(cid,mid){const key=cid+':'+mid;if(this._starred.has(key))this._starred.delete(key);else this._starred.add(key);if(cid===this.activeId)this.renderMsgs()},
  on(ev,fn){if(!this._ev[ev])this._ev[ev]=[];this._ev[ev].push(fn)},
  off(ev,fn){if(this._ev[ev])this._ev[ev]=this._ev[ev].filter(f=>f!==fn)},
  emit(ev,d){if(this._ev[ev])this._ev[ev].forEach(fn=>fn(d))},
  destroy(){this._ev={};this.contacts=[];this.convs={};this.activeId=null},

  // ===== RENDER =====
  renderChats(){
    const el=$('waChats');let list=[...this.contacts];
    const f=this._search.toLowerCase();if(f)list=list.filter(c=>c.name.toLowerCase().includes(f));
    if(this._tab==='unread')list=list.filter(c=>(this.convs[c.id]||[]).some(m=>m.from!=='me'&&m.unread));
    if(this._tab==='groups')list=list.filter(c=>c.isGroup);
    if(this._tab==='favorites')list=list.filter(c=>c.favorite);
    list.sort((a,b)=>{
      const pa=this._pinned.has(a.id)?1:0,pb=this._pinned.has(b.id)?1:0;
      if(pa!==pb)return pb-pa;
      const la=(this.convs[a.id]||[]).slice(-1)[0],lb=(this.convs[b.id]||[]).slice(-1)[0];
      return(lb?._ts||0)-(la?._ts||0);
    });
    el.innerHTML=list.map(c=>{
      const ms=this.convs[c.id]||[],last=ms[ms.length-1],unread=ms.filter(m=>m.from!=='me'&&m.unread).length;
      const act=c.id===this.activeId,pin=this._pinned.has(c.id);
      let lastH='',timeH='';
      if(last){
        const t=last.time||'';timeH=`<span class="wa-chat-time ${unread?'unread':''}">${t}</span>`;
        if(last.from==='me')lastH+=`<span class="wa-check ${last.status==='read'?'read':''}">${last.status==='sent'?SVG.check:SVG.double}</span>`;
        if(c._typing)lastH+=`<span class="typing">${T('typing')}`;
        else if(last.system)lastH+=`<span>🔔 ${esc(last.text).substring(0,40)}</span>`;
        else if(last.text)lastH+=`<span>${esc(last.text).substring(0,50)}</span>`;
        else if(last.image)lastH+=`<span>📷 ${T('photo')}</span>`;
        else if(last.voice)lastH+=`<span>🎤 ${T('voice')} (${last.voice.duration})</span>`;
        else if(last.file)lastH+=`<span>📄 ${esc(last.file.name)}</span>`;
        else if(last.poll)lastH+=`<span>📊 Poll: ${esc(last.poll.question)}</span>`;
      }
      return`<div class="wa-chat ${act?'active':''} ${pin?'pinned':''}" onclick="W.openChat('${c.id}')">
        <div class="wa-av-wrap"><img class="wa-av" src="${c.avatar}" alt="">${c.online?'<div class="wa-online"></div>':''}</div>
        <div class="wa-chat-body"><div class="wa-chat-top"><span class="wa-chat-name">${esc(c.name)}${pin?'<span class="pin">📌</span>':''}</span>${timeH}</div>
        <div class="wa-chat-bot"><span class="wa-chat-last">${lastH}</span>${unread?`<span class="wa-badge">${unread}</span>`:''}</div></div></div>`;
    }).join('');
  },

  renderMsgs(){
    const el=$('waMsgs'),ms=this.convs[this.activeId]||[];let h='',lastDate='',lastFrom='';
    // Conversation vide : bandeau de confiance en tête (comme la notice de
    // chiffrement de WhatsApp) — rassure au tout premier message.
    if (ms.length === 0) h += `<div class="wa-sys"><span>🔒 ${T('lockNotice')}</span></div>`;
    // Séparateur « Nouveaux messages » (chip vert, comme WhatsApp) : posé par
    // app.js à l'ouverture d'une conv qui avait des non-lus.
    if (this._newMsgsSep && ms.length) h += `<div class="wa-sys"><span class="wa-newmsg">${T('newMsgs')}</span></div>`;
    const contact=this.contacts.find(c=>c.id===this.activeId);
    const isGroup=contact?.isGroup;
    ms.forEach((m,i)=>{
      const d=m.date||T('today');if(d!==lastDate){h+=`<div class="wa-date"><span>${d}</span></div>`;lastDate=d;lastFrom=''}
      if(m.system){h+=`<div class="wa-sys"><span>${esc(m.text)}</span></div>`;lastFrom='';return}
      const sent=m.from==='me',dir=sent?'sent':'recv';
      const prev=ms[i-1],next=ms[i+1];
      const tail=!next||next.from!==m.from||next.date!==m.date||next.system;
      const grouped=prev&&prev.from===m.from&&prev.date===m.date&&!prev.system;
      const showSender=isGroup&&!sent&&(!grouped);
      const senderName=sent?'':((this.contacts.find(c=>c.id===m.from)||{name:contact?.name||T('unknown')}).name);
      const senderColor=getSenderColor(m.from);
      const starred=this._starred.has(this.activeId+':'+m.id);

      h+=`<div class="wa-mrow ${dir} ${tail?'tail':''} ${grouped?'no-anim':''}" data-mid="${m.id}" oncontextmenu="W.ctxMsg(event,'${m.id}')" ondblclick="W.reactPick(event,'${m.id}')">`;
      h+=`<div class="wa-bub">`;
      if(showSender)h+=`<div class="wa-sender" style="color:${senderColor}">${esc(senderName)}</div>`;
      if(m.replyTo){const rm=ms.find(x=>x.id===m.replyTo);if(rm){const rn=rm.from==='me'?T('you'):((this.contacts.find(c=>c.id===rm.from)||{name:T('unknown')}).name);h+=`<div class="wa-quote" onclick="W.scrollToMsg('${m.replyTo}')"><div class="wa-quote-name">${esc(rn)}</div><div class="wa-quote-text">${rm.text?esc(rm.text):rm.image?'📷 '+T('photo'):rm.voice?'🎤 '+T('voice'):'📎 '+T('file')}</div></div>`}}
      if(m.poll){h+=this._renderPoll(m)}
      if(m.image)h+=`<div class="wa-img" onclick="W.openLB('${m.image}')"><img src="${m.image}" alt="" loading="lazy"></div>`;
      if(m.voice)h+=`<div class="wa-voice" data-url="${esc(m.voice.url||'')}" data-total="${esc(m.voice.duration||'')}"><button class="wa-voice-play" onclick="W.toggleVoice(this)">${SVG.play}</button><div class="wa-voice-main"><div class="wa-wave">${genWave()}</div><div class="wa-voice-prog"><div class="wa-voice-fill"></div></div></div><span class="wa-voice-dur">${m.voice.duration||'0:00'}</span></div>`;
      if(m.file)h+=`<div class="wa-file" onclick="W.emit('openFile',{msgId:'${m.id}',contactId:'${this.activeId}'})"><div class="wa-file-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div><div class="wa-file-name">${esc(m.file.name)}</div><div class="wa-file-size">${m.file.size||''}</div></div></div>`;
      if(m.linkPreview)h+=`<div class="wa-linkprev" onclick="window.open('${m.linkPreview.url}','_blank')"><div class="wa-linkprev-body"><div class="wa-linkprev-title">${esc(m.linkPreview.title||'')}</div><div class="wa-linkprev-desc">${esc(m.linkPreview.description||'')}</div><div class="wa-linkprev-url">${esc(m.linkPreview.url||'')}</div></div></div>`;
      if(m.text)h+=`<div class="wa-text">${linkify(esc(m.text))}</div>`;
      h+=`<div class="wa-meta">`;
      if(starred)h+=`<span style="color:#f5a623">${SVG.star}</span>`;
      if(m.edited)h+=`<span class="wa-edited">${T('edited')}</span>`;
      h+=`<span class="wa-time">${m.time||''}</span>`;
      if(sent&&m.status){const ic=m.status==='sent'?SVG.check:SVG.double;h+=`<span class="wa-check ${m.status==='read'?'read':''}">${ic}</span>`}
      h+=`</div>`;
      if(m.reactions&&m.reactions.length){h+=`<div class="wa-reacts">`;m.reactions.forEach(r=>{h+=`<span class="wa-rchip" onclick="W.addReaction('${this.activeId}','${m.id}','${r.emoji}')">${r.emoji}${r.count>1?`<span class="cnt">${r.count}</span>`:''}</span>`});h+=`</div>`}
      h+=`</div></div>`;
      lastFrom=m.from;
    });
    el.innerHTML=h;
    this._reattachVoice(el);
    if(this._msgSearch)this._highlightSearch();
  },

  _renderPoll(m){
    const p=m.poll,total=p.options.reduce((s,o)=>s+o.votes,0);
    let h=`<div class="wa-poll"><div class="wa-poll-q">${esc(p.question)}</div>`;
    p.options.forEach((o,i)=>{
      const pct=total?Math.round(o.votes/total*100):0;
      h+=`<div class="wa-poll-opt ${o.voted?'voted':''}" onclick="W.votePoll('${m.id}',${i})"><div style="flex:1"><div style="display:flex;justify-content:space-between"><span>${esc(o.text)}</span><span style="font-size:12px;color:var(--text-secondary)">${pct}%</span></div><div class="wa-poll-bar" style="width:${pct}%"></div><div class="wa-poll-votes">${o.votes} ${T('votes')}</div></div></div>`;
    });
    return h+`</div>`;
  },

  votePoll(mid,optIdx){
    const ms=this.convs[this.activeId];if(!ms)return;const m=ms.find(m=>m.id===mid);if(!m||!m.poll)return;
    m.poll.options.forEach((o,i)=>{if(i===optIdx)o.votes++;if(o.voted&&i!==optIdx){o.votes=Math.max(0,o.votes-1);o.voted=false}});
    m.poll.options[optIdx].voted=true;this.renderMsgs();
  },

  // ===== UI HELPERS =====
  _updHead(c){if(!c)return;$('waHeadAv').src=c.avatar;$('waHeadName').textContent=c.name;const s=$('waHeadStatus');s.classList.remove('typing');if(c._typing){s.textContent=T('typing');s.classList.add('typing')}else if(c.online)s.textContent=T('online');else if(c.lastSeen)s.textContent=T('lastSeen',c.lastSeen);else s.textContent=''},
  scrollToBottom(force){const el=$('waMsgs');if(force||!this._userScrolled){requestAnimationFrame(()=>{el.scrollTop=el.scrollHeight});this._userScrolled=false;$('waScrollBtn').classList.remove('visible')}},
  scrollToMsg(mid){const el=document.querySelector(`[data-mid="${mid}"]`);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.transition='background .3s';el.querySelector('.wa-bub').style.background='rgba(0,168,132,.2)';setTimeout(()=>{el.querySelector('.wa-bub').style.background=''},1500)}},
  _showTypingBub(){const c=$('waMsgs');if($('waTypBub'))return;const d=document.createElement('div');d.id='waTypBub';d.className='wa-mrow recv';d.innerHTML=`<div class="wa-typing-bub"><div class="wa-tdot"></div><div class="wa-tdot"></div><div class="wa-tdot"></div></div>`;c.appendChild(d);this.scrollToBottom()},
  _hideTypingBub(){const e=$('waTypBub');if(e)e.remove()},
  _updSend(){const t=$('waTxt'),has=t&&t.value.trim().length>0;$('waSendIco').style.display=has?'block':'none';$('waMicIco').style.display=has?'none':'block'},
  _showToast(cid,msg){const c=this.contacts.find(c=>c.id===cid);if(!c)return;const t=$('waToast');$('waToastAv').src=c.avatar;$('waToastName').textContent=c.name;$('waToastText').textContent=msg.text||('📷 '+T('photo'));t.classList.add('active');clearTimeout(this._toastT);this._toastT=setTimeout(()=>t.classList.remove('active'),4000)},

  // ===== EVENT HANDLERS =====
  onKey(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();this._send()}
    else if(e.key==='Escape'){if(this.editId)this.cancelEdit();else if(this.replyTo)this.cancelReply()}
    else if(e.key==='ArrowUp'&&e.ctrlKey&&e.target.value===''){/* edit last message */const ms=(this.convs[this.activeId]||[]).filter(m=>m.from==='me');if(ms.length){const last=ms[ms.length-1];this.startEdit(last.id)}}
    setTimeout(()=>this._updSend(),0);this.emit('typing',{contactId:this.activeId});
  },
  onSendBtn(){const t=$('waTxt');if(t.value.trim())this._send();else this.startRec()},
  _send(){
    const t=$('waTxt'),text=t.value.trim();if(!text||!this.activeId)return;
    if(this.editId){this.editMessage(this.activeId,this.editId,text);this.cancelEdit();t.value='';t.style.height='auto';this._updSend();return}
    const data={text};
    const urlMatch=text.match(/https?:\/\/[^\s]+/);
    if(urlMatch)data.linkPreview={url:urlMatch[0],title:urlMatch[0].replace(/https?:\/\//,'').split('/')[0],description:''};
    if(this.replyTo){data.replyTo=this.replyTo;this.cancelReply()}
    this.sendMessage(this.activeId,data);t.value='';t.style.height='auto';this._updSend();
    this.emit('messageSent',{contactId:this.activeId,text});
  },
  autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,130)+'px';this._updSend()},

  // Reply
  startReply(mid){const ms=this.convs[this.activeId]||[];const m=ms.find(m=>m.id===mid);if(!m)return;this.replyTo=mid;const c=this.contacts.find(c=>c.id===this.activeId);const n=m.from==='me'?T('you'):(this.contacts.find(c=>c.id===m.from)?.name||c?.name||T('unknown'));$('waReplyName').textContent=n;$('waReplyText').textContent=m.text||'📷 Photo';$('waReplyPrev').classList.add('active');$('waTxt').focus()},
  cancelReply(){this.replyTo=null;$('waReplyPrev').classList.remove('active')},

  // Edit
  startEdit(mid){const ms=this.convs[this.activeId]||[];const m=ms.find(m=>m.id===mid);if(!m||!m.text)return;this.editId=mid;const t=$('waTxt');t.value=m.text;t.focus();this.autoResize(t);$('waReplyName').textContent=T('editBanner');$('waReplyText').textContent=m.text;$('waReplyPrev').classList.add('active')},
  cancelEdit(){this.editId=null;this.cancelReply()},

  // Tabs
  setTab(tab){this._tab=tab;document.querySelectorAll('.wa-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));this.renderChats()},
  filterChats(q){this._search=q;this.renderChats()},

  // Search in messages
  toggleSearch(){this._searchOpen=!this._searchOpen;$('waMsgSearch').classList.toggle('active',this._searchOpen);if(this._searchOpen){$('waMsgSearchIn').focus()}else{$('waMsgSearchIn').value='';this._msgSearch='';this.renderMsgs()}},
  searchMessages(q){this._msgSearch=q.toLowerCase();this._searchIdx=0;this._searchHits=[];if(!q){this.renderMsgs();$('waSearchCount').textContent='0/0';return}this.renderMsgs();this._highlightSearch()},
  _highlightSearch(){
    if(!this._msgSearch)return;
    const q=this._msgSearch;this._searchHits=[];
    document.querySelectorAll('.wa-text').forEach(el=>{
      const text=el.textContent.toLowerCase();
      if(text.includes(q)){this._searchHits.push(el);const re=new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`,'gi');el.innerHTML=el.innerHTML.replace(re,'<span class="wa-search-hl">$1</span>')}
    });
    $('waSearchCount').textContent=this._searchHits.length?`${Math.min(this._searchIdx+1,this._searchHits.length)}/${this._searchHits.length}`:T('noResults');
    if(this._searchHits.length)this._scrollToHit();
  },
  searchNav(dir){if(!this._searchHits.length)return;this._searchIdx=(this._searchIdx+dir+this._searchHits.length)%this._searchHits.length;this._scrollToHit()},
  _scrollToHit(){if(!this._searchHits.length)return;document.querySelectorAll('.wa-search-hl.current').forEach(e=>e.classList.remove('current'));const el=this._searchHits[this._searchIdx];if(el){el.scrollIntoView({behavior:'smooth',block:'center'});const spans=el.querySelectorAll('.wa-search-hl');if(spans.length)spans[0].classList.add('current');$('waSearchCount').textContent=`${this._searchIdx+1}/${this._searchHits.length}`}},

  // Emoji
  toggleEmoji(){$('waEmoji').classList.toggle('active');$('waAttach').classList.remove('active')},
  _buildEmoji(){
    const el=$('waEmoji');let h=`<div class="wa-emoji-search"><input id="waEmojiSearchIn" placeholder="${T('emojiPh')}" oninput="W._filterEmoji(this.value)"></div><div class="wa-emoji-tabs">`;
    const cats=Object.keys(EMOJI);cats.forEach((c,i)=>{h+=`<button class="wa-emoji-tab ${i===0?'active':''}" onclick="W._emojiTab(${i})">${EMOJI[c][0]}</button>`});
    h+=`</div><div class="wa-emoji-grid" id="waEmojiGrid">`;
    EMOJI[cats[0]].forEach(e=>{h+=`<button class="wa-emoji-item" onclick="W._insEmoji('${e}')">${e}</button>`});
    h+=`</div>`;el.innerHTML=h;
  },
  _emojiTab(i){const cats=Object.keys(EMOJI),cat=cats[i];document.querySelectorAll('.wa-emoji-tab').forEach((t,j)=>t.classList.toggle('active',j===i));$('waEmojiGrid').innerHTML=EMOJI[cat].map(e=>`<button class="wa-emoji-item" onclick="W._insEmoji('${e}')">${e}</button>`).join('')},
  _filterEmoji(q){if(!q){this._emojiTab(0);return}const all=Object.values(EMOJI).flat();$('waEmojiGrid').innerHTML=all.map(e=>`<button class="wa-emoji-item" onclick="W._insEmoji('${e}')">${e}</button>`).join('');document.querySelectorAll('.wa-emoji-tab').forEach(t=>t.classList.remove('active'))},
  _insEmoji(e){const t=$('waTxt'),s=t.selectionStart,end=t.selectionEnd;t.value=t.value.substring(0,s)+e+t.value.substring(end);t.selectionStart=t.selectionEnd=s+e.length;t.focus();this._updSend()},

  // Attach
  toggleAttach(){$('waAttach').classList.toggle('active');$('waEmoji').classList.remove('active')},
  attach(type){$('waAttach').classList.remove('active');
    if(type==='photos'||type==='doc'){const fi=$('waFileIn');fi.accept=type==='photos'?'image/*,video/*':'*/*';fi.click()}
    else if(type==='poll'){$('waPollModal').classList.add('active')}
    else this.emit('attachFile',{type,contactId:this.activeId});
  },
  onFile(inp){const f=inp.files[0];if(!f||!this.activeId)return;if(f.type.startsWith('image/')){const r=new FileReader();r.onload=e=>{this.sendMessage(this.activeId,{image:e.target.result})};r.readAsDataURL(f)}else{this.sendMessage(this.activeId,{file:{name:f.name,size:fmtSize(f.size)}})}inp.value=''},

  // Poll
  addPollOpt(){const d=$('waPollOpts'),i=document.createElement('input');i.placeholder=T('option',d.children.length+1);i.className='poll-opt';d.appendChild(i)},
  sendPoll(){
    const q=$('waPollQ').value.trim();if(!q)return;
    const opts=[...document.querySelectorAll('.poll-opt')].map(i=>i.value.trim()).filter(Boolean);
    if(opts.length<2)return;
    this.sendMessage(this.activeId,{poll:{question:q,options:opts.map(t=>({text:t,votes:0,voted:false}))}});
    $('waPollModal').classList.remove('active');$('waPollQ').value='';$('waPollOpts').innerHTML=`<input placeholder="${T('option',1)}" class="poll-opt"><input placeholder="${T('option',2)}" class="poll-opt">`;
  },

  // Recording
  startRec(){this.rec=true;this.recS=0;$('waTxtWrap').style.display='none';$('waRec').classList.add('active');$('waEmojiBtn').style.display='none';$('waAttachBtn').style.display='none';$('waSendBtn').style.display='none';this.recT=setInterval(()=>{this.recS++;const m=Math.floor(this.recS/60),s=this.recS%60;$('waRecTime').textContent=`${m}:${s.toString().padStart(2,'0')}`},1000);this.emit('recordingStarted',{contactId:this.activeId})},
  stopRec(){clearInterval(this.recT);const d=`${Math.floor(this.recS/60)}:${(this.recS%60).toString().padStart(2,'0')}`;this._resetRec();if(this.activeId)this.sendMessage(this.activeId,{voice:{duration:d}});this.emit('recordingStopped',{contactId:this.activeId,duration:d})},
  cancelRec(){clearInterval(this.recT);this._resetRec()},
  _resetRec(){this.rec=false;$('waTxtWrap').style.display='flex';$('waRec').classList.remove('active');$('waEmojiBtn').style.display='flex';$('waAttachBtn').style.display='flex';$('waSendBtn').style.display='flex';this._updSend()},
  _voiceT2L(s){s=Math.max(0,Math.round(s||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')},
  // Bind la progression (ondes + temps écoulé) à un wrap donné — réutilisé
  // au démarrage ET quand le DOM est reconstruit pendant la lecture.
  _voiceBindProgress(a, wrap){
    const self=this;
    const totalLabel=wrap?wrap.dataset.total||'' :'';
    const fill=wrap?wrap.querySelector('.wa-voice-fill'):null;
    const durEl=wrap?wrap.querySelector('.wa-voice-dur'):null;
    const btn=wrap?wrap.querySelector('.wa-voice-play'):null;
    const resetUI=()=>{
      if(self._voiceAudio===a){self._voiceAudio=null;self._voicePlaying=false;}
      if(btn){btn.innerHTML=SVG.play;btn.dataset.p='0';}
      if(self._voiceBtn===btn)self._voiceBtn=null;
      if(fill)fill.style.width='0%';
      if(durEl&&totalLabel)durEl.textContent=totalLabel;
    };
    a.ontimeupdate=()=>{
      if(self._voiceAudio!==a)return;
      const tot=(a.duration&&isFinite(a.duration)&&a.duration>0)?a.duration:0;
      if(fill)fill.style.width=tot?Math.min(100,(a.currentTime/tot)*100)+'%':'0%';
      if(durEl)durEl.textContent=tot?self._voiceT2L(a.currentTime)+' / '+totalLabel:self._voiceT2L(a.currentTime);
    };
    a.onended=resetUI;
    a.onerror=resetUI;
  },
  // Arrête la lecture vocale en cours (changement de conversation, retour liste)
  _stopVoice(){
    this._voicePlaying=false;
    if(this._voiceAudio){try{this._voiceAudio.pause();}catch(e){}this._voiceAudio=null;}
    if(this._voiceBtn){
      const b=this._voiceBtn;this._voiceBtn=null;
      b.innerHTML=SVG.play;b.dataset.p='0';
      const wrap=b.closest?b.closest('.wa-voice'):null;
      if(wrap){
        const f=wrap.querySelector('.wa-voice-fill');if(f)f.style.width='0%';
        const d=wrap.querySelector('.wa-voice-dur');if(d&&wrap.dataset.total)d.textContent=wrap.dataset.total;
      }
    }
  },
  // Si la liste des messages a été reconstruite PENDANT la lecture (nouveau
  // message, réaction...), le bouton qui lisait est détaché du DOM → on
  // ré-attache la lecture au NOUVEAU bouton du même message (pas de lecture
  // fantôme sans contrôle, position et progression conservées).
  _reattachVoice(el){
    if(!this._voicePlaying||!this._voiceAudio||!this._voiceBtn)return;
    if(this._voiceBtn.isConnected)return; // toujours dans le DOM, rien à faire
    const oldWrap=this._voiceBtn.closest?this._voiceBtn.closest('.wa-voice'):null;
    const url=oldWrap?oldWrap.dataset.url:'';
    const newWrap=[...el.querySelectorAll('.wa-voice')].find(wr=>wr.dataset.url===url)||null;
    const newBtn=newWrap?newWrap.querySelector('.wa-voice-play'):null;
    if(!newBtn){this._stopVoice();return;} // message disparu (supprimé) → stop
    this._voiceBtn=newBtn;
    newBtn.innerHTML=SVG.pause;newBtn.dataset.p='1';
    this._voiceBindProgress(this._voiceAudio,newWrap);
  },
  // Lecture réelle du message vocal (1 seul à la fois, comme WhatsApp).
  // Pause → reprise SANS repartir de zéro (même élément audio, position
  // conservée), comme dans WhatsApp.
  toggleVoice(btn){
    const wrap=btn.closest?btn.closest('.wa-voice'):null;
    const url=wrap?wrap.dataset.url:'';
    if(!url)return;
    // PAUSE / REPRISE de CE message
    if(this._voiceBtn===btn){
      if(this._voicePlaying){
        if(this._voiceAudio){try{this._voiceAudio.pause();}catch(e){}}
        this._voicePlaying=false;
        btn.innerHTML=SVG.play;btn.dataset.p='0';
        return;
      }
      const a=this._voiceAudio;
      if(!a)return;
      this._voicePlaying=true;
      this._voiceBindProgress(a,wrap);
      const p=a.play();if(p&&typeof p.catch==='function')p.catch(()=>{this._stopVoice();});
      btn.innerHTML=SVG.pause;btn.dataset.p='1';
      return;
    }
    // AUTRE message → stopper la lecture en cours et lancer celle-ci
    this._stopVoice();
    const a=new Audio(url);
    this._voiceAudio=a;this._voiceBtn=btn;this._voicePlaying=true;
    this._voiceBindProgress(a,wrap);
    const p=a.play();if(p&&typeof p.catch==='function')p.catch(()=>{this._stopVoice();});
    btn.innerHTML=SVG.pause;btn.dataset.p='1';
  },

  // Lightbox
  openLB(src){$('waLBImg').src=src;$('waLB').classList.add('active')},
  closeLB(){$('waLB').classList.remove('active')},

  // Context menu
  ctxMsg(e,mid){
    e.preventDefault();const ms=this.convs[this.activeId]||[];const m=ms.find(m=>m.id===mid);const isMine=m&&m.from==='me';
    const starred=this._starred.has(this.activeId+':'+mid);
    const ctx=$('waCtx');
    ctx.innerHTML=`
      <button onclick="W.startReply('${mid}');W._hideCtx()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>${T('reply')}</button>
      <button onclick="W.reactPick(event,'${mid}');W._hideCtx()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>${T('react')}</button>
      ${isMine?`<button onclick="W.startEdit('${mid}');W._hideCtx()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>${T('edit')}</button>`:''}
      <button onclick="W._copyMsg('${mid}');W._hideCtx()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>${T('copy')}</button>
      <button onclick="W._fwdMsg('${mid}');W._hideCtx()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 014-4h12"/></svg>${T('forward')}</button>
      <button onclick="W.starMsg('${this.activeId}','${mid}');W._hideCtx()"><svg viewBox="0 0 24 24" fill="${starred?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>${starred?T('unstar'):T('star')}</button>
      <button onclick="W.pinChat('${this.activeId}');W._hideCtx()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L12 22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>${this._pinned.has(this.activeId)?T('unpin'):T('pin')}</button>
      <div class="wa-ctx-sep"></div>
      <button class="danger" onclick="W.deleteMessage('${this.activeId}','${mid}');W._hideCtx()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>${T('del')}</button>`;
    ctx.style.top=Math.min(e.clientY,window.innerHeight-300)+'px';
    ctx.style.left=Math.min(e.clientX,window.innerWidth-220)+'px';
    ctx.classList.add('active');
  },
  _hideCtx(){$('waCtx').classList.remove('active')},
  _copyMsg(mid){const ms=this.convs[this.activeId]||[];const m=ms.find(m=>m.id===mid);if(m?.text)navigator.clipboard?.writeText(m.text)},
  _fwdMsg(mid){const ms=this.convs[this.activeId]||[];const m=ms.find(m=>m.id===mid);this._fwdMsg=m;
    const list=$('waFwdList');list.innerHTML=this.contacts.filter(c=>c.id!==this.activeId).map(c=>`<div class="wa-modal-contact" onclick="W._doFwd('${c.id}')"><img src="${c.avatar}" alt=""><div class="name">${esc(c.name)}</div></div>`).join('');
    $('waFwdModal').classList.add('active');
  },
  _doFwd(cid){if(this._fwdMsg){const m={...this._fwdMsg,id:uid(),from:'me',time:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),status:'sent',_ts:Date.now()};delete m.reactions;if(!this.convs[cid])this.convs[cid]=[];this.convs[cid].push(m);this.renderChats();this.emit('messageForwarded',{to:cid,msg:m})}this.closeFwd()},
  closeFwd(){$('waFwdModal').classList.remove('active')},

  // React picker
  reactPick(e,mid){
    e.stopPropagation();const ex=document.querySelector('.wa-rpick');if(ex)ex.remove();
    const p=document.createElement('div');p.className='wa-rpick';
    ['👍','❤️','😂','😮','😢','🙏'].forEach(em=>{p.innerHTML+=`<button onclick="W.addReaction('${this.activeId}','${mid}','${em}');this.parentElement.remove()">${em}</button>`});
    const row=e.target.closest('.wa-mrow');if(row){const bub=row.querySelector('.wa-bub');bub.style.position='relative';p.style.bottom='100%';p.style.left='0';bub.appendChild(p)}
    setTimeout(()=>{document.addEventListener('click',function h(){p.remove();document.removeEventListener('click',h)})},50);
  },

  // Profile
  toggleProfile(){this._profileOpen=!this._profileOpen;$('waProfile').classList.toggle('open',this._profileOpen);if(this._profileOpen)this._renderProfile()},
  _closeProfile(){this._profileOpen=false;$('waProfile').classList.remove('open')},
  _renderProfile(){
    const c=this.contacts.find(c=>c.id===this.activeId);if(!c)return;
    $('waProfAv').src=c.avatar;$('waProfName').textContent=c.name;
    $('waProfStatus').textContent=c.online?T('online'):(c.lastSeen?T('lastSeen',c.lastSeen):'');
    $('waProfAbout').textContent=c.about||T('about');
    const ms=this.convs[this.activeId]||[];const imgs=ms.filter(m=>m.image);
    $('waProfMedia').innerHTML=imgs.map(m=>`<img src="${m.image}" alt="" onclick="W.openLB('${m.image}')">`).join('')||'<p style="color:var(--text-secondary);font-size:13px;grid-column:1/-1">'+T('noMedia')+'</p>';
  },

  // Starred
  toggleStarred(){
    if(this._starred.size===0){this._showToast2(T('noStarred'));return}
    // Show starred in a simple alert for now
    const items=[...this._starred].map(k=>{const[cid,mid]=k.split(':');const ms=this.convs[cid]||[];const m=ms.find(m=>m.id===mid);return m?m.text||'📷':''}).filter(Boolean);
    this._showToast2(T('nStarred',this._starred.size));
  },
  _showToast2(text){const t=$('waToast');$('waToastAv').src='';$('waToastName').textContent='';$('waToastText').textContent=text;t.classList.add('active');clearTimeout(this._toastT);this._toastT=setTimeout(()=>t.classList.remove('active'),3000)},

  // Drag & drop
  _bindEvents(){
    const main=$('waMain');
    main.addEventListener('dragover',e=>{e.preventDefault();$('waDrop').classList.add('active')});
    main.addEventListener('dragleave',e=>{if(!main.contains(e.relatedTarget))$('waDrop').classList.remove('active')});
    main.addEventListener('drop',e=>{e.preventDefault();$('waDrop').classList.remove('active');
      const files=e.dataTransfer.files;if(files.length&&this.activeId){
        [...files].forEach(f=>{if(f.type.startsWith('image/')){const r=new FileReader();r.onload=ev=>this.sendMessage(this.activeId,{image:ev.target.result});r.readAsDataURL(f)}else{this.sendMessage(this.activeId,{file:{name:f.name,size:fmtSize(f.size)}})}})
      }
    });
    // Scroll detection
    $('waMsgs').addEventListener('scroll',()=>{
      const el=$('waMsgs'),atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<80;
      this._userScrolled=!atBottom;$('waScrollBtn').classList.toggle('visible',!atBottom);
    });
    // Global clicks
    document.addEventListener('click',e=>{
      if(!e.target.closest('.wa-emoji')&&!e.target.closest('#waEmojiBtn'))$('waEmoji').classList.remove('active');
      if(!e.target.closest('.wa-attach')&&!e.target.closest('#waAttachBtn'))$('waAttach').classList.remove('active');
      if(!e.target.closest('.wa-ctx'))this._hideCtx();
    });
    // Keyboard shortcuts
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'){$('waLB').classList.remove('active');$('waFwdModal').classList.remove('active');$('waPollModal').classList.remove('active');this._hideCtx();if(this._searchOpen)this.toggleSearch();if(this._profileOpen)this._closeProfile()}
      if(e.ctrlKey&&e.key==='f'&&this.activeId){e.preventDefault();this.toggleSearch()}
    });
    // Toast click
    $('waToast').addEventListener('click',()=>{const name=$('waToastName').textContent;const c=this.contacts.find(c=>c.name===name);if(c)this.openChat(c.id)});

    // Long-appui (mobile) = menu contextuel du message (comme WhatsApp).
    // 500 ms sans mouvement → menu ; tout glissement > 12 px l'annule
    // (ça reste un chat fluide, pas un écran verrouillé).
    let lpTimer=null,lpMid=null,lpStart=null;
    const cancelLP=()=>{if(lpTimer){clearTimeout(lpTimer);lpTimer=null}};
    main.addEventListener('touchstart',e=>{
      const row=e.target&&e.target.closest?e.target.closest('.wa-mrow'):null;
      if(!row||!this.activeId){cancelLP();lpMid=null;return}
      lpMid=row.getAttribute('data-mid');
      lpStart={x:e.touches[0].clientX,y:e.touches[0].clientY};
      cancelLP();
      lpTimer=setTimeout(()=>{
        lpTimer=null;const mid=lpMid;lpMid=null;
        if(mid&&this.convs[this.activeId])this.ctxMsg({preventDefault:()=>{},clientX:lpStart?lpStart.x:0,clientY:lpStart?lpStart.y:0},mid);
      },500);
    },{passive:true});
    main.addEventListener('touchmove',e=>{
      if(!lpTimer||!lpStart)return;
      if(Math.hypot(e.touches[0].clientX-lpStart.x,e.touches[0].clientY-lpStart.y)>12)cancelLP();
    },{passive:true});
    main.addEventListener('touchend',cancelLP);
    main.addEventListener('touchcancel',cancelLP);
  },
};

function $(id){return document.getElementById(id)}
window.W=W;
})();
