// ============================================================
// JobMarket Cameroon — chat-upgrade.js
// Patch de la messagerie interne pour la rapprocher de WhatsApp :
//   1) Envoi optimiste (le message apparaît avant confirmation Firebase)
//      + accusés progressifs 🕐 → ✓ → ✓✓, avec retry en cas d'échec réseau
//   2) Statut "en ligne / vu à..." dans l'en-tête (réutilise presence/{uid},
//      déjà écrit par writePresenceState() dans app.js)
//   3) Répondre à un message précis (appui long → citation)
//   4) Menu appui long : répondre / copier / supprimer pour moi / pour tous
//
// Chargé APRÈS app.js (voir index.html : <script src="chat-upgrade.js">).
// Comme app.js est un script classique (pas un module), les fonctions
// déclarées avec "function" et les variables déclarées avec "let" au
// premier niveau sont partagées entre les deux fichiers dans le même
// document — ce fichier redéfinit directement les fonctions de chat
// existantes plutôt que de dupliquer toute la logique déjà en place
// (Firebase, i18n, presence, inbox...).
// ============================================================

// ----- Nouvel état, propre à ce patch -----
let pendingMsgIds = new Set();
let failedMessagePayloads = {};
let replyingToMsg = null;
let userChatPresenceRef = null;

// ============================================================
// 1) ENVOI OPTIMISTE + ACCUSÉS PROGRESSIFS
// ============================================================
async function pushChatMessage(payload) {
    const user = auth.currentUser;
    if (!user || !userChatThreadId || !userChatPeerUid) return;
    const tid = userChatThreadId;
    const peerUid = userChatPeerUid;

    const msgId = db.ref('chats/' + tid + '/messages').push().key;
    const now = Date.now();

    const optimisticMsg = { from: user.uid, to: peerUid, timestamp: now, readBy: { [user.uid]: true } };
    if (payload.text) optimisticMsg.text = payload.text;
    if (payload.imageUrl) optimisticMsg.imageUrl = payload.imageUrl;
    if (payload.replyTo) optimisticMsg.replyTo = payload.replyTo;

    // Affichage IMMÉDIAT, avant même que Firebase confirme quoi que ce soit —
    // sans ça, chaque message met 1-2s à apparaître sur un réseau mobile
    // instable, ce qui donne une impression de lenteur que WhatsApp n'a pas.
    userChatMsgIds.add(msgId);
    pendingMsgIds.add(msgId);
    renderChatMessage(msgId, optimisticMsg, true);
    setMessageSendState(msgId, 'pending');
    clearReplyTo();

    try {
        const myName = String((profilesCache[user.uid] || {}).name || user.displayName || 'Utilisateur').slice(0, 60);
        const peerName = String((profilesCache[peerUid] || {}).name || 'Utilisateur').slice(0, 60);
        const preview = payload.imageUrl ? '📷 Photo' : (payload.text || '').slice(0, 100);
        const jobTitle = (userChatJobId && jobsById[userChatJobId] && jobsById[userChatJobId].title)
            || ((window.currentPreviewJob && window.currentPreviewJob.id === userChatJobId) ? window.currentPreviewJob.title : null);

        // Même séquence d'écritures que l'originale (voir app.js) : le
        // thread/participants d'abord, car les règles Firebase de userInboxes
        // vérifient l'appartenance au thread, qui doit donc déjà exister.
        await db.ref('chats/' + tid + '/meta/participants').update({ [user.uid]: true, [peerUid]: true });
        await db.ref('chats/' + tid + '/messages/' + msgId).set(optimisticMsg);

        const metaUpdate = {
            names: { [user.uid]: myName, [peerUid]: peerName },
            jobId: userChatJobId || 'general',
            lastMessage: preview,
            lastAt: now,
            lastFrom: user.uid
        };
        if (jobTitle) metaUpdate.jobTitle = String(jobTitle).slice(0, 120);
        await db.ref('chats/' + tid + '/meta').update(metaUpdate);

        const peerEntry = {
            peerUid: user.uid, peerName: myName,
            jobId: userChatJobId || 'general',
            jobTitle: jobTitle ? String(jobTitle).slice(0, 120) : null,
            lastMessage: preview, lastAt: now, lastFrom: user.uid
        };
        await writeWithRetry(() => db.ref('userInboxes/' + peerUid + '/threads/' + tid).update(peerEntry));

        const myEntry = {
            peerUid: peerUid, peerName: peerName,
            jobId: userChatJobId || 'general',
            jobTitle: jobTitle ? String(jobTitle).slice(0, 120) : null,
            lastMessage: preview, lastAt: now, lastFrom: user.uid
        };
        await db.ref('userInboxes/' + user.uid + '/threads/' + tid).update(myEntry);
        await db.ref('userInboxes/' + peerUid + '/threads/' + tid + '/unread').transaction(c => (c || 0) + 1);

        db.ref('chats/' + tid + '/meta/typing/' + user.uid).remove().catch(() => {});
        if (typeof triggerInstantNotify === 'function') triggerInstantNotify('new-message');

        pendingMsgIds.delete(msgId);
        setMessageSendState(msgId, 'sent'); // le ✓✓ arrivera via child_changed dès que le destinataire aura lu
    } catch (e) {
        console.error('pushChatMessage error', e);
        pendingMsgIds.delete(msgId);
        failedMessagePayloads[msgId] = payload;
        setMessageSendState(msgId, 'failed');
        showToast('Erreur envoi : ' + ((e && e.message) || 'réseau instable'), 'error');
    }
}

// Bascule l'icône d'accusé de réception sur la bulle déjà affichée.
function setMessageSendState(msgId, state) {
    const el = document.getElementById('msg-' + msgId);
    if (!el) return;
    const tick = el.querySelector('.msg-tick');
    if (!tick) return;
    if (state === 'pending') {
        tick.textContent = '🕐';
        tick.classList.remove('read');
        tick.onclick = null;
        tick.style.cursor = 'default';
        tick.title = '';
    } else if (state === 'sent') {
        tick.textContent = '✓';
        tick.onclick = null;
        tick.style.cursor = 'default';
        tick.title = '';
    } else if (state === 'failed') {
        tick.textContent = '⚠️';
        tick.style.cursor = 'pointer';
        tick.title = 'Échec de l\'envoi — toucher pour réessayer';
        tick.onclick = () => retryFailedMessage(msgId);
    }
}

// Relance l'envoi d'un message resté en échec : on retire l'ancienne bulle
// et on relance pushChatMessage avec le même contenu (nouveau msgId).
function retryFailedMessage(msgId) {
    const payload = failedMessagePayloads[msgId];
    if (!payload) return;
    const el = document.getElementById('msg-' + msgId);
    if (el) el.remove();
    userChatMsgIds.delete(msgId);
    delete failedMessagePayloads[msgId];
    pushChatMessage(payload);
}

// ============================================================
// 2) STATUT "EN LIGNE / VU À..." (réutilise presence/{uid})
// ============================================================
function renderPeerPresenceStatus(presence) {
    const statusEl = document.getElementById('userChatStatus');
    if (!statusEl) return;
    if (presence && presence.state === 'active') {
        statusEl.textContent = '🟢 en ligne';
        statusEl.classList.add('online');
    } else if (presence && presence.lastChanged) {
        statusEl.textContent = 'vu ' + timeAgo(presence.lastChanged);
        statusEl.classList.remove('online');
    } else {
        statusEl.textContent = '🔒 Messagerie sécurisée';
        statusEl.classList.remove('online');
    }
}

// ============================================================
// OUVERTURE / FERMETURE D'UNE CONVERSATION
// (réécrites entièrement pour brancher presence + replyTo + suppression,
// le reste reprend fidèlement la logique d'origine de app.js)
// ============================================================
function openUserChat(peerUid, jobId, peerName, jobTitle) {
    const user = auth.currentUser;
    if (!user) return;
    detachUserChatListeners();

    userChatPeerUid = peerUid;
    userChatJobId = jobId || null;
    userChatThreadId = makeThreadId(user.uid, peerUid, jobId);
    userChatMsgIds = new Set();
    userChatLastDay = null;
    replyingToMsg = null;

    if (!peerName) peerName = (profilesCache[peerUid] || {}).name || 'Utilisateur';

    const nameEl = document.getElementById('userChatName'); if (nameEl) nameEl.textContent = peerName;
    const avEl = document.getElementById('userChatAvatar'); if (avEl) avEl.textContent = initials(peerName);
    const msgs = document.getElementById('userChatMessages'); if (msgs) msgs.innerHTML = '';
    renderReplyBar();

    const banner = document.getElementById('userChatJobBanner');
    if (banner) {
        if (jobTitle || (jobId && jobId !== 'general')) {
            banner.textContent = '📋 ' + (jobTitle || 'Voir l\'annonce concernée');
            banner.style.display = 'block';
        } else {
            banner.style.display = 'none';
        }
    }

    const inbox = document.getElementById('messagesInbox'); if (inbox) inbox.style.display = 'none';
    const ov = document.getElementById('userChatOverlay'); if (ov) ov.style.display = 'flex';

    userChatRef = db.ref('chats/' + userChatThreadId + '/messages').limitToLast(200);
    userChatRef.on('child_added', snap => {
        const m = snap.val(); if (!m) return;
        if (userChatMsgIds.has(snap.key)) return;
        userChatMsgIds.add(snap.key);
        if (m.deletedFor && m.deletedFor[user.uid]) return; // supprimé "pour moi" : jamais affiché
        renderChatMessage(snap.key, m, m.from === user.uid);
        if (m.from !== user.uid) markThreadRead();
    });
    userChatRef.on('child_changed', snap => {
        const m = snap.val(); if (!m) return;
        if (m.deletedFor && m.deletedFor[user.uid]) {
            const el = document.getElementById('msg-' + snap.key);
            if (el) el.remove();
            return;
        }
        if (m.deleted) {
            const el = document.getElementById('msg-' + snap.key);
            if (el) el.innerHTML = '<div style="font-style:italic;opacity:0.6;font-size:13px;">🚫 Message supprimé</div>';
            return;
        }
        updateMessageTicks(snap.key, m, m.from === user.uid);
    });

    userChatTypingRef = db.ref('chats/' + userChatThreadId + '/meta/typing/' + peerUid);
    userChatTypingRef.on('value', snap => {
        const ts = snap.val();
        const active = ts && (Date.now() - ts < 4000);
        const el = document.getElementById('userChatTyping');
        if (el) el.style.display = active ? 'flex' : 'none';
        const statusEl = document.getElementById('userChatStatus');
        if (!statusEl) return;
        if (active) {
            statusEl.textContent = 'en train d\'écrire…';
            statusEl.classList.add('online');
        } else {
            // Retour au statut de présence réel une fois la frappe arrêtée.
            db.ref('presence/' + peerUid).once('value').then(s => renderPeerPresenceStatus(s.val())).catch(() => {});
        }
    });

    // Écoute en direct du statut "en ligne / vu à..." du correspondant.
    userChatPresenceRef = db.ref('presence/' + peerUid);
    userChatPresenceRef.on('value', snap => renderPeerPresenceStatus(snap.val()));

    markThreadRead();
}

function detachUserChatListeners() {
    if (userChatRef) { userChatRef.off(); userChatRef = null; }
    if (userChatTypingRef) { userChatTypingRef.off(); userChatTypingRef = null; }
    if (userChatPresenceRef) { userChatPresenceRef.off(); userChatPresenceRef = null; }
}

function closeUserChat() {
    detachUserChatListeners();
    if (userChatThreadId && auth.currentUser) {
        db.ref('chats/' + userChatThreadId + '/meta/typing/' + auth.currentUser.uid).remove().catch(() => {});
    }
    const ov = document.getElementById('userChatOverlay'); if (ov) ov.style.display = 'none';
    userChatThreadId = null; userChatPeerUid = null; userChatJobId = null;
    clearReplyTo();
}

// ============================================================
// 3) RÉPONDRE À UN MESSAGE (citation au-dessus de la barre de saisie)
// ============================================================
function setReplyTo(msgId, text, imageUrl, fromUid) {
    const user = auth.currentUser;
    const fromName = fromUid === (user && user.uid) ? 'Toi' : (document.getElementById('userChatName')?.textContent || 'Utilisateur');
    replyingToMsg = { id: msgId, text: text || (imageUrl ? '📷 Photo' : ''), fromName };
    renderReplyBar();
}

function clearReplyTo() {
    replyingToMsg = null;
    renderReplyBar();
}

function renderReplyBar() {
    const bar = document.getElementById('userChatReplyBar');
    if (!bar) return;
    if (!replyingToMsg) { bar.style.display = 'none'; bar.innerHTML = ''; return; }
    bar.style.display = 'flex';
    bar.innerHTML = `
      <div style="flex:1;min-width:0;border-left:3px solid var(--gold,#FFD700);padding-left:8px;">
        <div style="font-size:12px;font-weight:700;color:var(--gold,#FFD700);">${escapeHtml(replyingToMsg.fromName)}</div>
        <div style="font-size:12px;color:var(--text-dim,#999);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(replyingToMsg.text)}</div>
      </div>
      <button type="button" onclick="clearReplyTo()" style="background:none;border:none;color:var(--text-dim,#999);font-size:18px;cursor:pointer;padding:0 6px;">✕</button>`;
}

async function sendUserChatMessage() {
    const user = auth.currentUser;
    if (!user || !userChatThreadId) return;
    const input = document.getElementById('userChatInput');
    const text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    const payload = { text: text.slice(0, 800) };
    if (replyingToMsg) payload.replyTo = { id: replyingToMsg.id, text: replyingToMsg.text, fromName: replyingToMsg.fromName };
    await pushChatMessage(payload);
}

async function sendUserChatImage(fileInput) {
    const user = auth.currentUser;
    if (!user || !userChatThreadId) return;
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Choisis une image.', 'error'); return; }
    showToast('Envoi de la photo…', 'info');
    try {
        const url = await uploadToCloudinary(file);
        const payload = { imageUrl: url };
        if (replyingToMsg) payload.replyTo = { id: replyingToMsg.id, text: replyingToMsg.text, fromName: replyingToMsg.fromName };
        await pushChatMessage(payload);
    } catch (e) {
        console.error('sendUserChatImage error', e);
        showToast('Échec de l\'envoi de la photo.', 'error');
    }
}

// ============================================================
// AFFICHAGE D'UN MESSAGE (citation + appui long + suppression)
// ============================================================
function renderChatMessage(msgId, m, mine) {
    const c = document.getElementById('userChatMessages'); if (!c) return;
    if (m.deletedFor && auth.currentUser && m.deletedFor[auth.currentUser.uid]) return;

    const daySep = formatDaySep(m.timestamp || Date.now());
    if (daySep !== userChatLastDay) {
        userChatLastDay = daySep;
        const sep = document.createElement('div');
        sep.className = 'msg-day-sep';
        sep.textContent = daySep;
        c.appendChild(sep);
    }

    const el = document.createElement('div');
    el.className = 'msg-bubble ' + (mine ? 'mine' : 'theirs');
    el.id = 'msg-' + msgId;

    let inner = '';
    if (m.replyTo) {
        inner += `<div style="border-left:3px solid ${mine ? 'rgba(255,255,255,0.5)' : 'var(--gold,#FFD700)'};padding:4px 8px;margin-bottom:4px;font-size:12px;opacity:0.85;background:rgba(0,0,0,0.08);border-radius:6px;">
            <div style="font-weight:700;">${escapeHtml(m.replyTo.fromName || '')}</div>
            <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(m.replyTo.text || '')}</div>
        </div>`;
    }
    if (m.deleted) {
        inner += '<div style="font-style:italic;opacity:0.6;font-size:13px;">🚫 Message supprimé</div>';
    } else {
        if (m.imageUrl) inner += '<img src="' + escapeHtml(m.imageUrl) + '" onclick="window.open(this.src,\'_blank\')" alt="photo">';
        if (m.text) inner += '<div>' + escapeHtml(m.text) + '</div>';
    }
    inner += '<div class="msg-meta"><span>' + formatChatTime(m.timestamp) + '</span>';
    if (mine) {
        const read = m.readBy && userChatPeerUid && m.readBy[userChatPeerUid];
        inner += '<span class="msg-tick' + (read ? ' read' : '') + '">' + (read ? '✓✓' : '✓') + '</span>';
    }
    inner += '</div>';

    el.innerHTML = inner;
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;

    if (!m.deleted) attachMessageLongPress(el, msgId, m, mine);
}

function updateMessageTicks(msgId, m, mine) {
    if (!mine) return;
    if (pendingMsgIds.has(msgId)) return; // toujours en cours d'envoi : on ne touche pas au 🕐
    const el = document.getElementById('msg-' + msgId); if (!el) return;
    const tick = el.querySelector('.msg-tick'); if (!tick) return;
    const read = m.readBy && userChatPeerUid && m.readBy[userChatPeerUid];
    tick.textContent = read ? '✓✓' : '✓';
    tick.classList.toggle('read', !!read);
}

// ============================================================
// 4) MENU APPUI LONG : répondre / copier / supprimer
// ============================================================
function attachMessageLongPress(el, msgId, m, mine) {
    let pressTimer = null;
    const start = () => { pressTimer = setTimeout(() => { showMessageContextMenu(msgId, m, mine); vibrateDevice(30); }, 450); };
    const cancel = () => clearTimeout(pressTimer);
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', cancel);
    el.addEventListener('touchmove', cancel);
    el.addEventListener('mousedown', start);
    el.addEventListener('mouseup', cancel);
    el.addEventListener('mouseleave', cancel);
}

function showMessageContextMenu(msgId, m, mine) {
    closeMessageContextMenu();
    // "Supprimer pour tout le monde" façon WhatsApp : fenêtre de 15 min,
    // et seulement pour ses propres messages.
    const canDeleteForEveryone = mine && (Date.now() - (m.timestamp || 0) < 15 * 60 * 1000);
    const menu = document.createElement('div');
    menu.id = 'msgContextMenu';
    menu.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.35);display:flex;align-items:flex-end;';
    menu.innerHTML = `
      <div style="background:var(--surface,#1a1a1a);width:100%;border-radius:16px 16px 0 0;padding:10px 0;" onclick="event.stopPropagation()">
        <div onclick="replyToFromMenu('${msgId}')" style="padding:14px 20px;font-size:15px;cursor:pointer;">↩️ Répondre</div>
        ${m.text ? `<div onclick="copyMessageText('${msgId}')" style="padding:14px 20px;font-size:15px;cursor:pointer;">📋 Copier</div>` : ''}
        <div onclick="deleteMessageForMe('${msgId}')" style="padding:14px 20px;font-size:15px;cursor:pointer;color:var(--danger,#e74c3c);">🗑️ Supprimer pour moi</div>
        ${canDeleteForEveryone ? `<div onclick="deleteMessageForEveryone('${msgId}')" style="padding:14px 20px;font-size:15px;cursor:pointer;color:var(--danger,#e74c3c);">🗑️ Supprimer pour tout le monde</div>` : ''}
        <div onclick="closeMessageContextMenu()" style="padding:14px 20px;font-size:15px;cursor:pointer;color:var(--text-dim,#999);">Annuler</div>
      </div>`;
    menu.onclick = closeMessageContextMenu;
    document.body.appendChild(menu);
    window.__ctxMenuMsg = { msgId, m };
}

function closeMessageContextMenu() {
    const el = document.getElementById('msgContextMenu');
    if (el) el.remove();
}

function replyToFromMenu(msgId) {
    const ctx = window.__ctxMenuMsg;
    closeMessageContextMenu();
    if (!ctx) return;
    setReplyTo(msgId, ctx.m.text, ctx.m.imageUrl, ctx.m.from);
    document.getElementById('userChatInput')?.focus();
}

function copyMessageText(msgId) {
    const ctx = window.__ctxMenuMsg;
    closeMessageContextMenu();
    if (!ctx || !ctx.m.text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ctx.m.text).then(() => showToast('Copié', 'success')).catch(() => {});
    }
}

async function deleteMessageForMe(msgId) {
    closeMessageContextMenu();
    const user = auth.currentUser;
    if (!user || !userChatThreadId) return;
    try {
        await db.ref('chats/' + userChatThreadId + '/messages/' + msgId + '/deletedFor/' + user.uid).set(true);
        const el = document.getElementById('msg-' + msgId);
        if (el) el.remove();
    } catch (e) {
        console.error('deleteMessageForMe error', e);
        showToast('Erreur lors de la suppression', 'error');
    }
}

async function deleteMessageForEveryone(msgId) {
    closeMessageContextMenu();
    if (!userChatThreadId) return;
    if (!confirm('Supprimer ce message pour tout le monde ?')) return;
    try {
        await db.ref('chats/' + userChatThreadId + '/messages/' + msgId).update({ text: null, imageUrl: null, replyTo: null, deleted: true });
    } catch (e) {
        console.error('deleteMessageForEveryone error', e);
        showToast('Erreur lors de la suppression', 'error');
    }
}
