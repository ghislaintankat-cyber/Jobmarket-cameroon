// ============================================================
// PATCH : Réparation de la boîte de messages (contacts manquants)
// ------------------------------------------------------------
// PROBLÈME CORRIGÉ : quand une conversation démarre, l'écriture du
// MESSAGE (chats/{threadId}/messages) et l'écriture de son APERÇU dans
// ta liste "Messages" (userInboxes/{uid}/threads/{threadId} — nom,
// dernier message...) sont deux opérations séparées. Si la deuxième
// échoue silencieusement (réseau instable, timing) pendant que la
// première réussit, la conversation existe bien dans la base, mais
// n'apparaît JAMAIS dans "Messages" : cette liste ne lit que
// userInboxes, jamais toute la base /chats (volontaire, pour la
// confidentialité — les règles Firebase l'interdisent de toute façon).
//
// SOLUTION : un nouvel index minimal et quasi increvable,
// userThreads/{uid}/{threadId} = true, écrit à CHAQUE message pour les
// deux participants (une seule valeur booléenne — bien plus difficile à
// faire échouer qu'un aperçu complet avec plusieurs champs). À
// l'ouverture de "Messages", on compare cet index à userInboxes : toute
// conversation présente dans userThreads mais absente (ou incomplète)
// dans userInboxes est reconstruite à partir de chats/{threadId}/meta.
//
// ⚠️ IMPORTANT : ce correctif ne peut réparer que les conversations qui
// recevront au moins UN NOUVEAU MESSAGE après son installation (c'est à
// ce moment que userThreads sera enfin écrit pour elles). Pour une
// conversation déjà "perdue" avant l'installation de ce patch, demande
// à la personne concernée de te renvoyer un message : il sera cette
// fois correctement indexé, et la conversation réapparaîtra.
//
// INSTALLATION :
// 1. Ajoute le bloc "userThreads" fourni à part dans database.rules.json
//    (au même niveau que "userInboxes"), puis publie les règles dans la
//    Console Firebase (Realtime Database → Règles).
// 2. Uploade ce fichier à la racine du dépôt (à côté de app.js).
// 3. Dans index.html, ajoute juste APRÈS la ligne
//      <script src="app.js?v=20260826f"></script>
//    la ligne :
//      <script src="inbox-repair-patch.js?v=20260826a"></script>
// ============================================================

// ----- 1. Surcharge de pushChatMessage : ajoute l'écriture de l'index
//          userThreads, sans toucher au reste du comportement existant.
const __originalPushChatMessage = pushChatMessage;

pushChatMessage = async function (payload) {
    const user = auth.currentUser;
    const tid = userChatThreadId;
    const peerUid = userChatPeerUid;

    // Écrit AVANT le reste : même si l'envoi du message échoue ensuite
    // (réseau coupé en cours de route), ce marqueur a de bonnes chances
    // d'être passé — et ne fait de mal à personne s'il reste orphelin
    // (repairAllInboxThreads ignore un thread sans meta correspondant).
    if (user && tid && peerUid) {
        db.ref('userThreads/' + user.uid + '/' + tid).set(true).catch(() => {});
        db.ref('userThreads/' + peerUid + '/' + tid).set(true).catch(() => {});
    }

    return __originalPushChatMessage(payload);
};

// ----- 2. Reconstruction en masse des conversations manquantes -----
async function repairAllInboxThreads() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;

    try {
        const [threadsIdxSnap, inboxSnap] = await Promise.all([
            db.ref('userThreads/' + user.uid).once('value'),
            db.ref('userInboxes/' + user.uid + '/threads').once('value')
        ]);
        if (!threadsIdxSnap.exists()) return;

        const knownThreadIds = Object.keys(threadsIdxSnap.val() || {});
        const existingInbox = inboxSnap.val() || {};
        const missingIds = knownThreadIds.filter(tid => !existingInbox[tid] || !existingInbox[tid].peerUid);
        if (missingIds.length === 0) return;

        for (const tid of missingIds) {
            try {
                const metaSnap = await db.ref('chats/' + tid + '/meta').once('value');
                const mv = metaSnap.val();
                if (!mv) continue; // aucun message n'existe réellement pour ce thread : rien à réparer

                // L'autre participant = celui des deux uid du threadId qui n'est pas moi
                // (même logique que openUserChatFromThreadId dans app.js).
                const uidPair = tid.split('__')[0].split('_');
                const peerUid = uidPair.find(u => u && u !== user.uid);
                if (!peerUid) continue;

                await db.ref('userInboxes/' + user.uid + '/threads/' + tid).update({
                    peerUid: peerUid,
                    peerName: (mv.names && mv.names[peerUid])
                        || (typeof profilesCache !== 'undefined' && profilesCache[peerUid] && profilesCache[peerUid].name)
                        || 'Utilisateur',
                    jobId: mv.jobId || (tid.split('__')[1] || 'general'),
                    jobTitle: mv.jobTitle || null,
                    lastMessage: mv.lastMessage || '',
                    lastAt: mv.lastAt || Date.now(),
                    lastFrom: mv.lastFrom || null
                });
            } catch (e) {
                // Une conversation en échec de réparation ne bloque jamais les autres.
                console.warn('repairAllInboxThreads: échec pour', tid, e);
            }
        }
    } catch (e) {
        console.warn('repairAllInboxThreads error', e);
    }
}

// ----- 3. Surcharge de openMessagesInbox : répare AVANT d'afficher -----
const __originalOpenMessagesInbox = openMessagesInbox;

openMessagesInbox = function () {
    __originalOpenMessagesInbox();
    repairAllInboxThreads().then(() => {
        if (typeof renderInbox === 'function') renderInbox();
    });
};

// ----- 4. Réparation silencieuse à la connexion, pour que le badge de
//          non-lus soit correct dès l'ouverture de l'app, sans attendre
//          que la personne pense à ouvrir "Messages" elle-même.
auth.onAuthStateChanged(user => {
    if (user && !user.isAnonymous) {
        setTimeout(() => { repairAllInboxThreads().catch(() => {}); }, 1500);
    }
});
