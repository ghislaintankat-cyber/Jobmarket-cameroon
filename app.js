// ============================================================
// JobMarket Cameroon - Logique applicative (extrait de index.html)
// Ce fichier contient EXACTEMENT le code qui etait en ligne dans
// index.html, sans aucune modification. Charge via une balise script src=app.js
// ============================================================

// ===== CONTRÔLE DE VERSION AUTOMATIQUE =====
// index.html est TOUJOURS rechargé depuis le réseau (service worker
// network-first), alors qu'app.js peut rester en cache dans le téléphone.
// Si les deux versions ne correspondent plus, on affiche un écran
// "Nouvelle version — Recharger" plutôt que de faire tourner en silence
// une app obsolète (c'était la source des bugs "rien ne marche" sur les
// appareils avec l'ancienne version en mémoire).
// ⚠️ À chaque nouvelle version : mettre la même valeur ici ET dans
// l'attribut data-app-build de <html> dans index.html + le ?v= du script.
const APP_BUILD = '20260827a';
(function checkAppBuild() {
    try {
        const htmlBuild = document.documentElement.getAttribute('data-app-build');
        if (htmlBuild && htmlBuild !== APP_BUILD) {
            const b = document.createElement('div');
            b.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0A0A0F;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;font-family:sans-serif;';
            b.innerHTML = '<div style="font-size:44px;">🔄</div>' +
                '<div style="font-size:19px;font-weight:800;">Nouvelle version disponible</div>' +
                '<div style="font-size:14px;opacity:.75;">Cette page tourne sur une version obsolète du code.<br/>Recharge pour récupérer les corrections.</div>' +
                '<button onclick="location.reload()" style="margin-top:8px;background:#2D6CDF;color:#fff;border:none;padding:14px 30px;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;">Recharger l\'app</button>';
            document.body.appendChild(b);
        }
    } catch (e) { /* silencieux : jamais bloquant */ }
})();

// ===== FIREBASE CONFIG =====
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.firebasestorage.app",
  messagingSenderId: "351669024349",
  appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4"
};

try {
  firebase.initializeApp(firebaseConfig);
} catch(e) { console.warn('Firebase init:', e.message); }

const db = firebase.database();
const auth = firebase.auth();

// ===== SUIVI D'ERREURS =====
// Sans ça, une erreur chez un utilisateur ne remonte que s'il te la
// signale lui-même. On journalise les erreurs JS non interceptées et les
// promesses rejetées non gérées dans errorLogs/ (lisible uniquement par
// l'admin — voir rules.json). Best-effort : si l'écriture elle-même échoue
// (hors-ligne...), on ne fait rien de plus, pas question de créer une
// boucle d'erreurs à cause du logger lui-même.
function logClientError(message, extra) {
  try {
    db.ref('errorLogs').push({
      message: String(message || '').slice(0, 1000),
      extra: extra ? String(extra).slice(0, 1000) : null,
      uid: (auth.currentUser && auth.currentUser.uid) || null,
      url: location.href,
      userAgent: navigator.userAgent,
      timestamp: Date.now()
    }).catch(() => {});
  } catch (e) { /* silencieux, volontairement */ }
}

window.addEventListener('error', (event) => {
  logClientError(event.message, event.filename + ':' + event.lineno);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  logClientError('Unhandled rejection: ' + ((reason && reason.message) || reason));
});

const CLOUDINARY_CLOUD_NAME = "dvoab3mzb";
// ⚠️ Remplacez par VOTRE numéro WhatsApp (format international, sans + ni espaces,
// ex: "2376XXXXXXXX") : c'est là que les demandes de vérification seront envoyées.
const ADMIN_WHATSAPP_NUMBER = "237650420710";
const CLOUDINARY_UPLOAD_PRESET = "job_preset";
// L'admin n'est plus un UID unique codé en dur ici : voir admins/{uid} dans
// Firebase (et database.rules.json). Ça permet d'ajouter un admin de
// secours sans toucher au code, juste en écrivant dans la base — et évite
// que la perte d'un seul compte Google ne rende l'app impossible à gérer.
let isAdmin = false;

async function refreshAdminStatus(uid) {
  if (!uid) { isAdmin = false; updateAdminMenuVisibility(); return; }
  try {
    const snap = await db.ref('admins/' + uid).once('value');
    isAdmin = snap.val() === true;
  } catch (e) {
    isAdmin = false; // en cas d'échec de lecture, on refuse l'accès par prudence plutôt que de l'accorder à tort
  }
  updateAdminMenuVisibility();
}

function updateAdminMenuVisibility() {
  const item = document.getElementById('adminMenuItem');
  if (item) item.style.display = isAdmin ? '' : 'none';
}

let currentUser = null;
let userCoords = null;
let allJobs = [];
let jobsById = {}; // Map pour retrouver les jobs par ID

// Jobs sauvegardés/mis en favoris par l'utilisateur connecté (voir
// syncSavedJobs() plus bas, appelée au login). Set de jobId, pour un accès
// instantané depuis le rendu des boutons "🔖" (pas d'aller-retour réseau
// à chaque affichage d'un popup).
let savedJobIds = new Set();

// Quel onglet du panneau Liste est actif ('all' ou 'saved') — sert à
// rafraîchir le bon contenu quand un job est sauvegardé/désauvegardé
// pendant que ce panneau est déjà ouvert (voir toggleSaveJob()).
let jobsSheetFilter = 'all';
let currentCategory = 'all';   // catégorie active (boutons du haut)
let currentSearchText = '';    // texte tapé dans la recherche
let currentRadiusKm = null;    // rayon actif (500m/2km/5km/10km) ou null = tout
let profilesCache = {}; // uid -> {verified, ratingAvg, ratingCount, ...} tenu à jour en temps réel

// On écoute les profils en continu pour toujours avoir le vrai statut de
// vérification et la vraie note moyenne, sans faire un appel réseau par carte.
function syncProfilesCache() {
  const profilesQuery = db.ref('profiles');
  let initialLoadDone = false;

  // Même principe que syncJobs() ci-dessous : UN SEUL téléchargement complet
  // au démarrage, puis des mises à jour granulaires (un seul profil à la
  // fois) au lieu de retélécharger TOUS les profils à chaque changement de
  // N'IMPORTE LEQUEL — ce qui devient particulièrement coûteux maintenant
  // que ratingAvg/ratingCount sont recalculés côté serveur après chaque
  // avis (voir rating-sync.js), donc plus fréquemment modifiés qu'avant.
  profilesQuery.once('value').then(snap => {
    profilesCache = snap.val() || {};
    if (allJobs.length) updateJobsList(allJobs); // rafraîchit badges/notes affichés
    initialLoadDone = true;
  }).catch(e => console.error('Sync profiles initial load error:', e));

  profilesQuery.on('child_added', snap => {
    if (!initialLoadDone) return; // déjà traité par le chargement initial ci-dessus
    profilesCache[snap.key] = snap.val();
    if (allJobs.length) updateJobsList(allJobs);
    if (typeof refreshAllPopupsLanguage === 'function') refreshAllPopupsLanguage();
  });

  profilesQuery.on('child_changed', snap => {
    profilesCache[snap.key] = snap.val();
    if (allJobs.length) updateJobsList(allJobs);
    // Les popups de la carte (badge vérifié, étoiles) affichent aussi des
    // données de profil — sans ceci, une note mise à jour juste après un
    // avis (voir rating-sync.js) n'apparaissait qu'après avoir fermé puis
    // rouvert le popup manuellement.
    if (typeof refreshAllPopupsLanguage === 'function') refreshAllPopupsLanguage();
    refreshOpenPreviewIfShowingProfile(snap.key);
  });

  profilesQuery.on('child_removed', snap => {
    delete profilesCache[snap.key];
    if (allJobs.length) updateJobsList(allJobs);
    if (typeof refreshAllPopupsLanguage === 'function') refreshAllPopupsLanguage();
  });
}
let userMarker = null;
let accuracyCircle = null;
let routeControl = null;
let currentMapStyle = 'satellite';  // défaut = vue satellite (voir satelliteLayer.addTo)
let currentAuthTab = 'signup';
let editingJobId = null; // ID du job en cours de modification (null = mode "nouvelle publication")
let profileLiveRef = null; // Référence Firebase du listener temps réel du profil ouvert (voir openProfileSheet/closeProfileSheetListener)
function genererLienPartage(nomArtisan, metierArtisan, idArtisan) {
    const lienApp = `https://ghislaintankat-cyber.github.io/Jobmarket-cameroon/?id=${idArtisan}`;

    const message =
    `Regarde ce profil sur JobMarket Cameroon : *${nomArtisan}* (${metierArtisan}). Tu peux le localiser et le contacter ici : ${lienApp}`;

    return `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
  }

// ===== MAP INIT =====
const map = L.map('map', {
  zoomControl: false,
  maxZoom: 20
}).setView([3.848, 11.502], 13);

// ===== CALQUES DE CARTE AVEC CACHE NAVIGATEUR ET ÉCONOMIE DATA =====
const satelliteLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { 
  subdomains: ['mt0','mt1','mt2','mt3'], 
  maxZoom: 20,
  updateWhenIdle: true,       // Attend que l'utilisateur s'arrête de glisser pour charger (économie de Mo)
  updateWhenZooming: false,   // Ne charge pas les images intermédiaires pendant un zoom rapide
  keepBuffer: 6               // Garde en mémoire le quartier actuel pour un retour instantané sans internet
});

const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
  maxZoom: 20,
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 6
});

// Carte affichée par défaut : vue SATELLITE. L'utilisateur peut basculer
// sur la vue "rues" (plus claire) avec le bouton de calque de la carte.
satelliteLayer.addTo(map);
const jobsLayer = L.featureGroup().addTo(map);

// ===== SPLASH =====
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('splash').classList.add('hide');
    setTimeout(() => {
      document.getElementById('splash').style.display='none';
      maybeShowLangPicker();
    }, 600);
  }, 2200);
});

// Affiche le sélecteur de langue une seule fois (au tout premier lancement, ou tant
// qu'aucune langue n'a été choisie explicitement). Une fois qu'une langue est choisie
// (ici ou via le menu langue en haut de l'écran), 'appLangChosen' est mémorisé et ce
// panneau ne réapparaît plus.
function maybeShowLangPicker() {
  if (localStorage.getItem('appLangChosen')) { maybeShowOnboarding(); return; }
  const picker = document.getElementById('langPicker');
  if (picker) picker.style.display = 'flex';
}

function closeLangPicker() {
  localStorage.setItem('appLangChosen', '1');
  const picker = document.getElementById('langPicker');
  if (picker) picker.style.display = 'none';
  maybeShowOnboarding();
}

// ===== ONBOARDING (3 écrans, une seule fois par appareil) =====
let onbIndex = 0;
const ONB_SLIDE_COUNT = 3;

function maybeShowOnboarding() {
  if (localStorage.getItem('jmc_onboarding_seen')) return;
  const overlay = document.getElementById('onboardingOverlay');
  if (overlay) overlay.style.display = 'flex';
}

function onboardingNext() {
  if (onbIndex >= ONB_SLIDE_COUNT - 1) { skipOnboarding(); return; }
  onbIndex++;
  document.querySelectorAll('.onb-slide').forEach(el => el.classList.toggle('active', +el.dataset.slide === onbIndex));
  document.querySelectorAll('.onb-dot').forEach(el => el.classList.toggle('active', +el.dataset.dot === onbIndex));
  const btn = document.getElementById('onbNextBtn');
  if (btn && onbIndex === ONB_SLIDE_COUNT - 1) btn.textContent = t('onbStart');
}

function skipOnboarding() {
  localStorage.setItem('jmc_onboarding_seen', '1');
  const overlay = document.getElementById('onboardingOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ===== TOAST =====
let toastTimer;
function showToast(msg, type='info') {
  const t = document.getElementById('toast');
  clearTimeout(toastTimer);
  t.className = `show ${type}`;
  t.textContent = msg;
  toastTimer = setTimeout(() => { t.className = ''; }, 3000);
}

// ===== DÉTECTION HORS CONNEXION =====
// navigator.onLine + les événements online/offline détectent une coupure
// réseau franche (mode avion, zone sans couverture) — pas une connexion
// lente/instable, que le navigateur ne peut pas distinguer d'une connexion
// normale. C'est volontairement simple : le but est juste d'éviter qu'un
// utilisateur se demande pourquoi "rien ne marche" quand il n'a tout
// simplement plus de réseau, pas de diagnostiquer la qualité du signal.
function initOfflineDetection() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  const update = () => { banner.style.transform = navigator.onLine ? 'translateY(-100%)' : 'translateY(0)'; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ===== VIBRATION (retour haptique) =====
// Fonction unique et sécurisée utilisée partout dans l'app.
// Remarque : la vibration ne fonctionne que sur téléphone Android (Chrome/Edge/Samsung
// Internet). Elle n'existe pas sur iPhone (Safari ne l'a jamais implémentée) ni sur
// ordinateur (pas de moteur de vibration), et Firefox l'a retirée en 2024 : dans ces cas
// navigator.vibrate est absent ou inactif, ce n'est pas un bug de l'application.
function vibrateDevice(ms) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) { /* ignore silencieusement si le navigateur refuse l'appel */ }
}

// ===== INTERNATIONALISATION (FR / EN / IT / DE / ZH) =====
const I18N = {
  fr: {
    reviewRateLimited: "Vous avez déjà noté ce prestataire récemment — un nouvel avis sera possible plus tard.",
    toastPaymentPending: "Paiement reçu, activation en cours...",
    toastLoginToPay: "Connecte-toi d'abord pour payer.",
    toastOpeningPayment: "Ouverture du paiement...",
    toastPaymentFailed: "Le paiement n'a pas pu démarrer. Réessaie.",
    payProTitle: "⭐ Passer au compte PRO",
    payProDesc: "Sois mieux classé, annonces illimitées, badge doré et statistiques.",
    payProButton: "Devenir Pro — 1 500 FCFA / mois",
    payVerifiedButton: "✅ Badge Identité vérifiée — 500 FCFA",
    payBoostButton: "🚀 Pack 3 boosts — 500 FCFA",
    emptyStateNoJobs: "Aucun job trouvé",
    settingsNotifications: "Notifications", settingsManageNotifications: "Gérer les préférences",
    saveLabel: "Sauvegarder", savedLabel: "Sauvegardé", jobSavedToast: "Annonce sauvegardée !", jobUnsavedToast: "Annonce retirée des sauvegardes", filterAllJobs: "Tous", filterSavedJobs: "Sauvegardés",
    tipSettings: "Paramètres", settingsTitle: "Paramètres", settingsLanguage: "Langue", settingsTheme: "Thème", themeDark: "Sombre", themeLight: "Clair",
    showMoreText: "...voir plus", showLessText: "voir moins",
    jobModerationBlocked: "Publication refusée : {reason}", jobModerationBlockedGeneric: "Cette annonce ne peut pas être publiée telle quelle. Merci de la modifier.",
    resultsPlural: "résultats", resultSingular: "résultat", searchIntentPrefix: "Aucun résultat exact. Vouliez-vous dire :", mapViewActivated: "Vue plan activée", satelliteViewActivated: "Vue satellite activée", activateLocationForRadius: "Active ta position pour filtrer par distance",
    btnSuggestCategory: "✨ Suggérer la catégorie", aiCategoryMinLength: "Écrivez d'abord un titre ou une description avant d'utiliser l'IA.", aiCategoryLoading: "✨ Analyse en cours...", aiCategorySuggested: "Catégorie suggérée : {category}",
    whatsappOpenedSuccess: "WhatsApp ouvert !",
    shareOnWhatsappBtn: "🔄 Partager sur WhatsApp", viewRouteBtn: "Voir l'itinéraire", jobNotFoundAlert: "Job non trouvé", errorPrefix: "Erreur : ", sharedOnWhatsapp: "Partagé sur WhatsApp !",
    jobUpdated: "Annonce mise à jour !", jobPublished: "Job publié avec succès !",
    // ===== Cles ajoutees pour la traduction automatique des annonces =====
    jobTranslatedNotice: "🌐 Traduit automatiquement", viewOriginalText: "Voir l'original", viewTranslationText: "Voir la traduction",
    translatingInProgress: "Traduction en cours...",
    // ===== Nouvelles cles ajoutees (audit traduction complet) =====
    btnImproveDesc: "✨ Améliorer avec l'IA", btnSuggestPrice: "💡 Suggérer un prix", btnOptimizeProfile: "✨ Optimiser avec l'IA",
    btnScamCheck: "🛡️ Analyser les signaux d'alerte", aiImproveMinLength: "Écrivez d'abord une courte description avant d'utiliser l'IA.", aiImproveLoading: "✨ Amélioration en cours...",
    aiImproveSuccess: "Description améliorée !", aiUnavailable: "L'IA n'est pas disponible pour le moment, réessayez plus tard.", aiConnectionError: "Impossible de contacter l'IA. Vérifiez votre connexion.",
    aiOptimizeMinLength: "Renseignez d'abord vos compétences avant d'utiliser l'IA.", aiOptimizeLoading: "✨ Optimisation en cours...", aiOptimizeSuccess: "Profil optimisé !",
    aiPriceMinLength: "Renseignez d'abord un titre ou une description avant de demander un prix.", aiPriceLoading: "💡 Calcul en cours...", aiPriceEstimateLabel: "💡 Estimation :", aiPriceUseEstimation: "Utiliser cette estimation",
    aiPriceApplied: "Prix appliqué", aiScamNothingToAnalyze: "Rien à analyser sur cette annonce.", aiScamLoading: "🛡️ Analyse en cours...",
    aiScamDisclaimer: "Analyse automatique du texte, pas une preuve — restez vigilant et vérifiez avant de payer quoi que ce soit à l'avance.", splashSubtitle: "Artisans qualifiés près de vous", langModalTitle: "Choisissez votre langue",
    offlineBannerText: "Pas de connexion internet — certaines actions peuvent échouer",
    shareNewJobTitle: "Annonce publiée !", shareNewJobBody: "Partage-la maintenant sur WhatsApp pour toucher plus de monde dès les premières minutes.", shareNewJobBtn: "Partager sur WhatsApp",
    copyLinkBtn: "Copier le lien", linkCopied: "Lien copié !", copyLinkFailed: "Impossible de copier le lien",
    markAsFilled: "Marquer comme pourvu", markAsOpenAgain: "Réactiver l'annonce", filledBadgeLabel: "Pourvu",
    toastMarkedFilled: "Annonce marquée comme pourvue — elle n'apparaît plus publiquement.", toastMarkedOpenAgain: "Annonce réactivée — elle est de nouveau visible.",
    onbSkip: "Passer", onbNext: "Suivant", onbStart: "Commencer",
    onbTitle1: "Trouvez un pro près de chez vous", onbBody1: "Explorez la carte pour découvrir des artisans qualifiés autour de vous, avec leur note et leur distance.",
    onbTitle2: "Publiez votre besoin en quelques secondes", onbBody2: "Appuyez sur le bouton + pour décrire ce dont vous avez besoin. Les prestataires proches sont alertés aussitôt.",
    onbTitle3: "Contactez en toute confiance", onbBody3: "Consultez les avis et les badges vérifiés, puis échangez directement via le chat sécurisé de l'app.",
    emptyZoneSub: "Publiez le premier job dans cette zone", adminNoDocWarning: "⚠️ Aucun document envoyé dans l'app — vérifier via WhatsApp", noNewJobsYet: "Aucun nouveau job pour l'instant",
    positionSelectedLabel: "📍 Position sélectionnée", loadingWhatsappContacts: "Chargement des contacts WhatsApp...", interestedPeopleTitle: "Personnes intéressées",
    noContactYet: "Personne ne vous a encore contacté pour ce besoin.", yourWhatsappNumberLabel: "Ton numéro WhatsApp", whatsappNumberHint: "C'est sur ce numéro que tu recevras ton code de vérification à 7 chiffres.",
    idPhotoHint: "📄 Photo de ta pièce d'identité (CNI, passeport...)", tapToAddPhoto: "Toucher pour ajouter la photo", selfieHint: "🤳 Selfie de toi tenant la même pièce à côté de ton visage",
    tapToAddSelfie: "Toucher pour ajouter le selfie", noReviewsYet: "Pas encore d'avis pour ce prestataire.", loadingReviews: "Chargement des avis...",
    reviewsLoadError: "Erreur de chargement des avis.", contactBeforeReview: "Contactez ce prestataire par WhatsApp pour pouvoir laisser un avis ensuite.", alreadyReviewed: "✓ Vous avez déjà laissé un avis pour cet échange.",
    reviewModalTitle: "Comment ça s'est passé ?", prefSaveError: "Préférence non enregistrée (réseau instable ?), réessayez.", welcomeBack: "Bon retour !",
    welcomeUser: "Bienvenue {name}", someUploadsFailed: "{n} photo(s) n'ont pas pu être envoyée(s) (réseau instable ?), le reste de l'annonce est publié quand même.", rejectedWrongType: "{n} fichier(s) ignoré(s) : format non supporté (JPG, PNG, WEBP ou GIF uniquement)",
    rejectedTooBig: "{n} photo(s) ignorée(s) : plus de {mb} Mo", noWhatsappManualCode: "Aucun numéro WhatsApp enregistré pour ce profil. Code à transmettre manuellement : {code}", myPublicationsCount: "Vous avez {n} publication(s)",
    newJobToast: "🎉 Nouveau job : {title} ({location}) vient d'être publié !", invalidPhotoFormat: "Photo invalide : JPG/PNG/WEBP, max {mb} Mo.", positionSavedComplete: "Position enregistrée ! Complétez le formulaire.",
    positionSavedFill: "Position enregistrée ! Remplissez le formulaire de job.", photoUploadError: "Erreur lors de l'envoi de la photo (réseau instable ?), réessayez.", whatsappOpenError: "Erreur lors de l'ouverture de WhatsApp. Réessayez.",
    chooseRatingFirst: "Choisissez une note avant d'envoyer", reviewSendError: "Erreur lors de l'envoi de l'avis", mustBeLoggedIn: "Vous devez être connecté.",
    fillNameAndJob: "Veuillez renseigner votre nom/société et votre métier/spécialité.", profileSavedSuccess: "Profil Pro enregistré avec succès !", genericError: "Une erreur est survenue.",
    mustBeLoggedInWhatsapp: "Vous devez être connecté pour écrire sur WhatsApp.", mustCompleteProfileContact: "Vous devez compléter votre profil (nom/société et métier/spécialité) pour contacter cette personne.", phoneUnavailable: "Numéro de téléphone indisponible.",
    cannotComputeRoute: "Impossible de calculer l'itinéraire sans votre position.",
    notifTitle: "Nouveaux jobs", publishBtn: "Publier",
    catAll: "Tous", catBtp: "BTP", catElec: "Electricite", catPlomberie: "Plomberie",
    navMap: "Carte", navList: "Liste", navSearch: "Chercher", navAccount: "Compte",
    waMsgReferral: "Rejoins-moi sur JobMarket Cameroon pour trouver ou proposer des services près de chez toi : {link}",
    waMsgShareJob: "🔊 *NOUVELLE OFFRE D'EMPLOI*\n\n*{title}*\n{desc}{requirements}\n\n💰 Rémunération : {price} XAF\n📍 Lieu : {location}\n📞 Contact : {phone}\n\nPlus de détails ici : {link}",
    waMsgRequirementsLabel: "📋 *Exigences :*",
    waMsgOrConnector: " ou ",
    waMsgContactProvider: "Bonjour, je vous contacte depuis JobMarket pour : \"{jobTitle}\".\n\n--- Profil du prestataire ---\nNom / Société : {profileName}\nMétier : {proTitle}\nCompétences : {proSkills}\n\nEst-ce toujours disponible ?",
    catMenage: "Menage", catJardinage: "Jardinage", catMecanique: "Mecanique", catInfo: "Informatique",
    tipLocate: "Ma position", tipZoomIn: "Zoom +", tipZoomOut: "Zoom -", tipMapStyle: "Style carte",
    tipLang: "Langue", tipSearch: "Rechercher", tipNotifications: "Notifications", tipMessages: "Messages", tipClose: "Fermer",
    distanceLabel: "Distance", itinLabel: "Itineraire", calculating: "Calcul en cours...", cancelBtn: "Annuler",
    publishTitle: "Publier un Job", fieldCategory: "Categorie",
    optBtp: "BTP / Maconnerie", optElec: "Electricite", optPlomberie: "Plomberie", optMenage: "Menage / Nettoyage",
    optJardinage: "Jardinage", optMecanique: "Mecanique Auto", optInfo: "Informatique",
    fieldTitle: "Titre du job", phTitle: "Ex: Pose de carrelage salle de bain",
    fieldDesc: "Description", phDesc: "Decrivez le travail a effectuer...",
    fieldRequirements: "Exigences (optionnel)", phRequirements: "Ex: Ponctuel, experience minimum 2 ans, materiel personnel...", requirementsLabel: "Exigences",
    fieldPrice: "Prix (XAF)", phPrice: "Ex: 15 000 XAF",
    fieldPhone: "Telephone", fieldPhone2: "Deuxieme numero (optionnel)", fieldLandmark: "Repere / Quartier", phLandmark: "Ex: Bastos, pres du rond-point...",
    fieldPhotos: "Photos (jusqu'a 5)", uploadTitle: "Ajouter des photos",
    uploadSub: "JPG, PNG, WEBP — Max 5 images, 8 Mo chacune", publishNow: "Publier maintenant",
    jobsNearby: "Jobs proches", emptyTitle: "Aucun job trouve", emptySub: "Publiez le premier job dans cette zone",
    myAccount: "Mon Compte", userFallback: "Utilisateur", notConnected: "Non connecte", profileIncomplete: "Profil incomplet",
    tabSignup: "Creer compte", tabLogin: "Connexion", fieldPassword: "Mot de passe", phPassword: "Minimum 8 caracteres",
    createAccountBtn: "Creer mon compte", loginBtn: "Se connecter", forgotPassword: "Mot de passe oublié ?", orWord: "ou", continueGoogle: "Continuer avec Google",
    adminDashboard: "Dashboard Admin", secureChat: "Chat sécurisé", myListings: "Mes publications", myProProfile: "Mon Profil Pro",
    notifPrefsTitle: "Notifications", notifPrefsIntro: "Choisissez les catégories pour lesquelles vous voulez être notifié(e) des nouvelles offres. Décochez celles qui ne vous concernent pas.",
    notifPrimerTitle: "Ne ratez plus aucun job", notifPrimerBody: "Soyez alerté(e) dès qu'un nouveau job correspondant à vos catégories est publié près de chez vous.",
    notifPrimerLater: "Plus tard", notifPrimerEnable: "Activer les alertes",
    installPromptTitle: "Installe l'app sur ton téléphone", installPromptBody: "Accès plus rapide depuis l'écran d'accueil, comme une vraie application.", installPromptInstall: "Installer",
    boostExpiryTitle: "Ta mise en avant expire bientôt", boostExpiryBody: "\"{title}\" redescend dans le classement dans environ {hours}h.", boostExpiryRenewBtn: "Renouveler (1 crédit)",
    notifBlockedTip: "Notifications bloquées. Activez-les dans les réglages de votre navigateur pour ne plus rater de job.",
    notifDistanceLabel: "Distance maximale", notifDistanceHint: "Vous ne serez notifié(e) que pour les jobs situés dans ce rayon autour de votre position (nécessite la géolocalisation activée).",
    notifGpsNudgeTitle: "Position non activée", notifGpsNudgeBody: "Activez votre position pour que le filtre de distance ci-dessous fonctionne vraiment.", notifGpsNudgeBtn: "Activer",
    logout: "Déconnexion", artisanProfile: "Profil de l'artisan",
    descNeed: "Description du besoin :", editListing: "Modifier l'annonce", deleteListing: "Supprimer l'annonce",
    shareWhatsApp: "Partager sur WhatsApp", seeItinerary: "Voir l'itinéraire",
    photoWord: "Photo", changePhoto: "Changer photo", fieldNameCompany: "Nom / Société", phName: "Ex: Jean Dupont ou Dupont Entreprise",
    fieldCompany: "Société", fieldJobTitle: "Ton métier / Spécialité", phJobTitle: "Ex: Électricien, Maçon, Designer...",
    fieldSkills: "Compétences (séparées par des virgules)", phSkills: "Ex: Installation de compteurs, Dépannage d'urgence, Câblage...",
    saveChanges: "Enregistrer les modifications",
    emailVerified: "Email vérifié", emailNotVerified: "Email non vérifié — cliquez le lien reçu par email à l'inscription.",
    profileVerified: "Profil vérifié", requestSent: "⏳ Demande envoyée, en attente de validation.",
    profileNotVerified: "Profil non vérifié. Une pièce d'identité ou une preuve de métier peut débloquer le badge ✓.",
    requestVerificationBtn: "Demander la vérification",
    referralProgram: "Programme de parrainage",
    referralExplain: "Invitez des artisans/clients avec votre lien. Tous les 3 filleuls inscrits, vous débloquez une mise en avant gratuite (7 jours) pour une de vos annonces.",
    copyBtn: "Copier", referralCountText: "{count} filleul(s) inscrit(s) — plus que {next} pour votre prochain crédit.",
    creditsAvailable: "{credits} crédit(s) de mise en avant disponible(s)", publishToBoost: "Publiez une annonce pour pouvoir la booster.",
    activeBoost: "Actif", boostBtn: "Booster",
    chatPanelTitle: "Assistant sécurisé", chatOfflineBadge: "Hors ligne · privé",
    chatWelcomeMsg: "Bonjour ! Je peux vous aider à utiliser JobMarket, publier une demande, trouver un artisan, comprendre les prix et repérer les signaux de fraude. Mes réponses restent sur cet appareil.",
    chatSuggestion1: "Comment publier un job ?", chatSuggestion2: "Comment éviter une arnaque ?",
    chatSuggestion3: "Comment calculer ma marge ?", chatSuggestion4: "Comment gérer mes publications ?",
    chatSafetyNotice: "Aucune clé IA, aucun message envoyé à un modèle externe. Ne partagez jamais de mot de passe, code SMS, carte bancaire ou document d'identité dans le chat.",
    chatInputPlaceholder: "Votre message...",
    adminBadge: "ADMIN", adminStatJobsTotal: "Jobs total", adminStatUsers: "Utilisateurs",
    adminStatToday: "Publiés aujourd'hui", adminStatCountry: "Pays actif", adminStatNotifOpenRate: "Taux d'ouverture notifs (7j)", adminStatContactsWeek: "Contacts WhatsApp (7j)", adminStatReviewsWeek: "Avis laissés (7j)", adminStatSignupsWeek: "Inscriptions (7j)", adminStatBoostsWeek: "Boosts utilisés (7j)", adminStatSearchesWeek: "Recherches (7j)",
    adminVerificationsTitle: "Vérifications en attente", adminAllJobsTitle: "Tous les jobs",
    adminLoading: "Chargement...", adminNoPending: "Aucune demande en attente.",
    reportLink: "Signaler cette annonce", reportModalTitle: "Signaler cette annonce",
    reportModalIntro: "Un signal utile pour l'équipe : décrivez ce qui vous semble problématique. Les signalements abusifs peuvent être retracés jusqu'à votre compte.",
    reportReasonLabel: "Motif", reportReasonFraud: "Arnaque / fraude suspectée", reportReasonInappropriate: "Contenu inapproprié",
    reportReasonMisleading: "Prix ou description trompeurs", reportReasonDuplicate: "Annonce en double / spam", reportReasonOther: "Autre",
    reportCommentLabel: "Détails (optionnel)", phReportComment: "Expliquez brièvement le problème...", reportSubmitBtn: "Envoyer le signalement",
    adminReportsTitle: "Signalements en attente", adminNoReports: "Aucun signalement en attente.", adminJobDeleted: "Job déjà supprimé",
    adminDismissReport: "Ignorer", adminDeleteJob: "Supprimer le job", adminConfirmDeleteJob: "Supprimer définitivement ce job ?",
    adminLoadError: "Erreur de chargement.",
    adminNoName: "Sans nom", adminNoJobTitle: "Métier non renseigné",
    adminApprove: "Valider ✓", adminReject: "Refuser", adminAnonymous: "Anonyme", adminDeleteBtn: "Suppr.",
    btnUseEstimate: "Utiliser cette estimation",
    scamAutoAnalysisNote: "Analyse automatique du texte, pas une preuve — restez vigilant et vérifiez avant de payer quoi que ce soit à l'avance.",
    priceEstimateLabel: "💡 Estimation :",
    toastFillAllFields: "Remplissez tous les champs",
    toastAccountCreated: "Compte créé ! Vérifiez votre email.",
    toastWelcomeBack: "Bon retour !",
    toastWelcomeName: "Bienvenue {name}",
    toastLoggedOut: "Déconnecté",
    toastEnterEmailFirst: "Entrez votre email d’abord, puis cliquez sur le lien",
    toastEmailSent: "Email envoyé ! Vérifiez votre boîte de réception.",
    toastResetLinkMaybeSent: "Si un compte existe avec cet email, un lien a été envoyé.",
    toastGpsNotSupported: "GPS non supporté",
    toastGpsUnavailable: "Position GPS non disponible",
    toastLoginToPublish: "Connectez-vous pour publier",
    toastFillRequiredFields: "Remplissez les champs obligatoires",
    toastSomePhotosFailed: "{count} photo(s) n'ont pas pu être envoyée(s) (réseau instable ?), le reste de l'annonce est publié quand même.",
    toastListingUpdated: "Annonce mise à jour !",
    toastJobPublished: "Job publié avec succès !",
    toastPublishError: "Erreur lors de la publication",
    toastGpsRequiredPublish: "GPS requis pour publier",
    toastFilesWrongType: "{count} fichier(s) ignoré(s) : format non supporté (JPG, PNG, WEBP ou GIF uniquement)",
    toastFilesTooBig: "{count} photo(s) ignorée(s) : plus de {max} Mo",
    toastGpsRequired: "Position GPS requise",
    toastMapViewOn: "Vue plan activée",
    toastSatelliteViewOn: "Vue satellite activée",
    toastFilterCategoryHint: "Filtrez par catégorie en haut",
    toastLoginToReport: "Connectez-vous pour signaler une annonce.",
    toastReportSent: "Signalement envoyé, merci.",
    toastAlreadyReported: "Vous avez déjà signalé cette annonce.",
    toastSendErrorRetry: "Erreur lors de l'envoi, réessayez.",
    toastAdminOnly: "Accès réservé aux administrateurs",
    toastErrorRetry: "Erreur, réessayez.",
    toastJobDeleted: "Job supprimé.",
    toastCodeGenerated: "Code généré et WhatsApp ouvert pour l'envoyer !",
    toastNoWhatsAppNumber: "Aucun numéro WhatsApp enregistré pour ce profil. Code à transmettre manuellement : {code}",
    toastValidationError: "Erreur lors de la validation",
    toastRequestRejected: "Demande refusée",
    toastGenericError: "Erreur",
    toastDeleteError: "Erreur lors de la suppression",
    toastPleaseLogin: "Connectez-vous",
    toastNoListingsFound: "Aucune publication trouvée",
    toastYouHaveListings: "Vous avez {count} publication(s)",
    toastPrefNotSaved: "Préférence non enregistrée (réseau instable ?), réessayez.",
    toastWriteDescFirst: "Écrivez d'abord une courte description avant d'utiliser l'IA.",
    toastAiUnavailable: "L'IA n'est pas disponible pour le moment, réessayez plus tard.",
    toastDescImproved: "Description améliorée !",
    toastAiConnectionError: "Impossible de contacter l'IA. Vérifiez votre connexion.",
    toastFillSkillsFirst: "Renseignez d'abord vos compétences avant d'utiliser l'IA.",
    toastProfileOptimized: "Profil optimisé !",
    toastFillTitleOrDescFirst: "Renseignez d'abord un titre ou une description avant de demander un prix.",
    toastPriceApplied: "Prix appliqué",
    toastNothingToAnalyze: "Rien à analyser sur cette annonce.",
    toastNewJobPublished: "🎉 Nouveau job : {title} ({location}) vient d'être publié !",
    toastPositionSavedComplete: "Position enregistrée ! Complétez le formulaire.",
    toastPositionSavedFill: "Position enregistrée ! Remplissez le formulaire de job.",
    toastCantEditOthers: "Vous ne pouvez modifier que vos propres publications",
    toastEditFieldsThenValidate: "Modifiez les champs puis validez",
    toastCantDeleteOthers: "Vous ne pouvez supprimer que vos propres publications",
    toastListingDeleted: "Annonce supprimée",
    toastLoginToEditProfile: "Connectez-vous pour modifier votre profil",
    toastInvalidPhoto: "Photo invalide : JPG/PNG/WEBP, max {max} Mo.",
    toastLinkCopied: "Lien copié !",
    toastCopyFailed: "Impossible de copier",
    toastNoCreditsAvailable: "Aucun crédit disponible",
    toastBoostedSeven: "Annonce mise en avant pour 7 jours !",
    toastBoostError: "Erreur lors de la mise en avant",
    toastNeedIdAndSelfie: "Ajoute une photo de ta pièce d'identité ET un selfie avant d'envoyer.",
    toastNeedValidWhatsApp: "Entre un numéro WhatsApp valide (ex: +237650420710) pour recevoir ton code.",
    toastRequestSent: "Demande envoyée !",
    toastPhotoSendError: "Erreur lors de l'envoi des photos",
    toastCodeMustBe7Digits: "Le code doit contenir exactement 7 chiffres.",
    toastNoCodePending: "Aucun code en attente pour ce profil.",
    toastWrongCode: "Code incorrect, réessaie.",
    toastProfileVerified: "Profil vérifié !",
    toastCodeVerifyError: "Erreur lors de la vérification du code",
    toastPhotoUploadError: "Erreur lors de l'envoi de la photo (réseau instable ?), réessayez.",
    toastWhatsAppOpenError: "Erreur lors de l'ouverture de WhatsApp. Réessayez.",
    toastWhatsAppOpened: "WhatsApp ouvert!",
    toastSharedWhatsApp: "Partagé sur WhatsApp!",
    toastChooseRatingFirst: "Choisissez une note avant d'envoyer",
    toastReviewThanks: "Merci pour votre avis !",
    toastReviewSendError: "Erreur lors de l'envoi de l'avis",
    toastEnableLocationForDistance: "Active ta position pour filtrer par distance",
    reviewsTitle: "Avis",
    reviewsNoneYet: "Pas encore d'avis pour ce prestataire.",
    reviewsCountWord: "avis",
    reviewsLoading: "Chargement des avis...",
    reviewsContactFirst: "Contactez ce prestataire par WhatsApp pour pouvoir laisser un avis ensuite.",
    reviewsAlreadyDone: "✓ Vous avez déjà laissé un avis pour cet échange.",
    reviewsProviderFallback: "ce prestataire",
    reviewsLeaveBtn: "⭐ Laisser un avis",
    reviewsJobFallback: "ce besoin",
    reviewPromptQuestion: "Comment ça s'est passé ?",
    reviewPromptWith: "Avec {name} pour “{title}”",
    reviewCommentPlaceholder: "Commentaire (optionnel)",
    reviewSendBtn: "Envoyer",
    reviewSending: "Envoi...",
    searchJobPlaceholder: "Rechercher un job (ex: plombier, menage...)",
    verifyCodePlaceholder: "Code à 7 chiffres",
    companyNamePlaceholder: "Ex: Les Bâtisseurs du Cameroun",
    phoneValidTitle: "Numero de telephone valide, ex: 6XX XXX XXX",
    whatsappVerifiedTitle: "Numéro vérifié par WhatsApp",
    emailVerifiedTitle: "Email vérifié",
    verifiedBadgeLabel: "Vérifié",
    closeAriaLabel: "Fermer",
    backAriaLabel: "Retour",
    faqAriaLabel: "Questions fréquentes",
    altSelfieSubmitted: "Selfie de vérification soumis",
    altIdSubmitted: "Pièce d'identité soumise",
    altDocumentPreview: "Aperçu du document sélectionné",
    altJobPhoto: "Photo de l'annonce",
    altProfilePhotoPreview: "Aperçu de la photo de profil",
    altGeneratedAvatar: "Avatar généré à partir du nom",
    altSelectedPhotoPreview: "Aperçu de la photo sélectionnée",
    altProfilePhoto: "Photo de profil"
  },
  en: {
    reviewRateLimited: "You've already reviewed this provider recently — a new review will be possible later.",
    toastPaymentPending: "Payment received, activating...",
    toastLoginToPay: "Log in first to make a payment.",
    toastOpeningPayment: "Opening payment...",
    toastPaymentFailed: "Payment could not start. Please try again.",
    payProTitle: "⭐ Upgrade to PRO",
    payProDesc: "Better ranking, unlimited listings, gold badge and stats.",
    payProButton: "Go Pro — 1,500 FCFA / month",
    payVerifiedButton: "✅ Verified Identity badge — 500 FCFA",
    payBoostButton: "🚀 3-boost pack — 500 FCFA",
    emptyStateNoJobs: "No jobs found",
    settingsNotifications: "Notifications", settingsManageNotifications: "Manage preferences",
    saveLabel: "Save", savedLabel: "Saved", jobSavedToast: "Listing saved!", jobUnsavedToast: "Listing removed from saved", filterAllJobs: "All", filterSavedJobs: "Saved",
    tipSettings: "Settings", settingsTitle: "Settings", settingsLanguage: "Language", settingsTheme: "Theme", themeDark: "Dark", themeLight: "Light",
    showMoreText: "...show more", showLessText: "show less",
    jobModerationBlocked: "Publication refused: {reason}", jobModerationBlockedGeneric: "This listing cannot be published as is. Please edit it.",
    resultsPlural: "results", resultSingular: "result", searchIntentPrefix: "No exact match. Did you mean:", mapViewActivated: "Map view activated", satelliteViewActivated: "Satellite view activated", activateLocationForRadius: "Enable your location to filter by distance",
    btnSuggestCategory: "✨ Suggest category", aiCategoryMinLength: "Write a title or description first before using AI.", aiCategoryLoading: "✨ Analyzing...", aiCategorySuggested: "Suggested category: {category}",
    whatsappOpenedSuccess: "WhatsApp opened!",
    shareOnWhatsappBtn: "🔄 Share on WhatsApp", viewRouteBtn: "View route", jobNotFoundAlert: "Job not found", errorPrefix: "Error: ", sharedOnWhatsapp: "Shared on WhatsApp!",
    jobUpdated: "Listing updated!", jobPublished: "Job published successfully!",
    // ===== Cles ajoutees pour la traduction automatique des annonces =====
    jobTranslatedNotice: "🌐 Automatically translated", viewOriginalText: "View original", viewTranslationText: "View translation",
    translatingInProgress: "Translating...",
    // ===== Nouvelles cles ajoutees (audit traduction complet) =====
    btnImproveDesc: "✨ Improve with AI", btnSuggestPrice: "💡 Suggest a price", btnOptimizeProfile: "✨ Optimize with AI",
    btnScamCheck: "🛡️ Analyze warning signs", aiImproveMinLength: "Write a short description first before using AI.", aiImproveLoading: "✨ Improving...",
    aiImproveSuccess: "Description improved!", aiUnavailable: "AI is not available right now, please try again later.", aiConnectionError: "Could not reach the AI. Check your connection.",
    aiOptimizeMinLength: "Fill in your skills first before using AI.", aiOptimizeLoading: "✨ Optimizing...", aiOptimizeSuccess: "Profile optimized!",
    aiPriceMinLength: "Fill in a title or description first before asking for a price.", aiPriceLoading: "💡 Calculating...", aiPriceEstimateLabel: "💡 Estimate:", aiPriceUseEstimation: "Use this estimate",
    aiPriceApplied: "Price applied", aiScamNothingToAnalyze: "Nothing to analyze on this listing.", aiScamLoading: "🛡️ Analyzing...",
    aiScamDisclaimer: "Automatic text analysis, not proof — stay alert and check before paying anything upfront.", splashSubtitle: "Qualified tradespeople near you", langModalTitle: "Choose your language",
    offlineBannerText: "No internet connection — some actions may fail",
    shareNewJobTitle: "Listing published!", shareNewJobBody: "Share it now on WhatsApp to reach more people in the first few minutes.", shareNewJobBtn: "Share on WhatsApp",
    copyLinkBtn: "Copy link", linkCopied: "Link copied!", copyLinkFailed: "Couldn't copy the link",
    markAsFilled: "Mark as filled", markAsOpenAgain: "Reopen listing", filledBadgeLabel: "Filled",
    toastMarkedFilled: "Listing marked as filled — no longer shown publicly.", toastMarkedOpenAgain: "Listing reopened — visible again.",
    onbSkip: "Skip", onbNext: "Next", onbStart: "Get started",
    onbTitle1: "Find a pro near you", onbBody1: "Browse the map to discover qualified tradespeople around you, with their rating and distance.",
    onbTitle2: "Post your need in seconds", onbBody2: "Tap the + button to describe what you need. Nearby providers are notified instantly.",
    onbTitle3: "Reach out with confidence", onbBody3: "Check reviews and verified badges, then chat directly through the app's secure chat.",
    emptyZoneSub: "Post the first job in this area", adminNoDocWarning: "⚠️ No document sent in the app — verify via WhatsApp", noNewJobsYet: "No new jobs for now",
    positionSelectedLabel: "📍 Position selected", loadingWhatsappContacts: "Loading WhatsApp contacts...", interestedPeopleTitle: "Interested people",
    noContactYet: "No one has contacted you about this request yet.", yourWhatsappNumberLabel: "Your WhatsApp number", whatsappNumberHint: "You'll receive your 7-digit verification code on this number.",
    idPhotoHint: "📄 Photo of your ID (national ID card, passport...)", tapToAddPhoto: "Tap to add the photo", selfieHint: "🤳 Selfie of you holding the same document next to your face",
    tapToAddSelfie: "Tap to add the selfie", noReviewsYet: "No reviews yet for this provider.", loadingReviews: "Loading reviews...",
    reviewsLoadError: "Error loading reviews.", contactBeforeReview: "Contact this provider via WhatsApp so you can leave a review afterwards.", alreadyReviewed: "✓ You have already left a review for this exchange.",
    reviewModalTitle: "How did it go?", prefSaveError: "Preference not saved (unstable network?), please try again.", welcomeBack: "Welcome back!",
    welcomeUser: "Welcome {name}", someUploadsFailed: "{n} photo(s) could not be uploaded (unstable network?), the rest of the listing was published anyway.", rejectedWrongType: "{n} file(s) ignored: unsupported format (JPG, PNG, WEBP or GIF only)",
    rejectedTooBig: "{n} photo(s) ignored: over {mb} MB", noWhatsappManualCode: "No WhatsApp number saved for this profile. Code to share manually: {code}", myPublicationsCount: "You have {n} listing(s)",
    newJobToast: "🎉 New job: {title} ({location}) was just posted!", invalidPhotoFormat: "Invalid photo: JPG/PNG/WEBP, max {mb} MB.", positionSavedComplete: "Position saved! Complete the form.",
    positionSavedFill: "Position saved! Fill in the job form.", photoUploadError: "Error uploading the photo (unstable network?), please try again.", whatsappOpenError: "Error opening WhatsApp. Please try again.",
    chooseRatingFirst: "Choose a rating before sending", reviewSendError: "Error sending the review", mustBeLoggedIn: "You must be logged in.",
    fillNameAndJob: "Please fill in your name/company and your trade/specialty.", profileSavedSuccess: "Pro Profile saved successfully!", genericError: "An error occurred.",
    mustBeLoggedInWhatsapp: "You must be logged in to message on WhatsApp.", mustCompleteProfileContact: "You must complete your profile (name/company and trade/specialty) to contact this person.", phoneUnavailable: "Phone number unavailable.",
    cannotComputeRoute: "Cannot calculate the route without your position.",
    notifTitle: "New jobs", publishBtn: "Post",
    catAll: "All", catBtp: "Construction", catElec: "Electrical", catPlomberie: "Plumbing",
    navMap: "Map", navList: "List", navSearch: "Search", navAccount: "Account",
    waMsgReferral: "Join me on JobMarket Cameroon to find or offer services near you: {link}",
    waMsgShareJob: "🔊 *NEW JOB OPENING*\n\n*{title}*\n{desc}{requirements}\n\n💰 Pay: {price} XAF\n📍 Location: {location}\n📞 Contact: {phone}\n\nMore details here: {link}",
    waMsgRequirementsLabel: "📋 *Requirements:*",
    waMsgOrConnector: " or ",
    waMsgContactProvider: "Hello, I'm contacting you from JobMarket about: \"{jobTitle}\".\n\n--- Provider profile ---\nName / Company: {profileName}\nTrade: {proTitle}\nSkills: {proSkills}\n\nIs this still available?",
    catMenage: "Cleaning", catJardinage: "Gardening", catMecanique: "Mechanics", catInfo: "IT",
    tipLocate: "My location", tipZoomIn: "Zoom +", tipZoomOut: "Zoom -", tipMapStyle: "Map style",
    tipLang: "Language", tipSearch: "Search", tipNotifications: "Notifications", tipMessages: "Messages", tipClose: "Close",
    distanceLabel: "Distance", itinLabel: "Route", calculating: "Calculating...", cancelBtn: "Cancel",
    publishTitle: "Post a Job", fieldCategory: "Category",
    optBtp: "Construction / Masonry", optElec: "Electrical", optPlomberie: "Plumbing", optMenage: "Cleaning",
    optJardinage: "Gardening", optMecanique: "Auto Mechanics", optInfo: "IT Services",
    fieldTitle: "Job title", phTitle: "E.g: Bathroom tiling",
    fieldDesc: "Description", phDesc: "Describe the work needed...",
    fieldRequirements: "Requirements (optional)", phRequirements: "E.g: Punctual, min. 2 years experience, own tools...", requirementsLabel: "Requirements",
    fieldPrice: "Price (XAF)", phPrice: "E.g: 15,000 XAF",
    fieldPhone: "Phone", fieldPhone2: "Second number (optional)", fieldLandmark: "Landmark / Neighborhood", phLandmark: "E.g: Bastos, near the roundabout...",
    fieldPhotos: "Photos (up to 5)", uploadTitle: "Add photos",
    uploadSub: "JPG, PNG, WEBP — Max 5 images, 8 MB each", publishNow: "Publish now",
    jobsNearby: "Nearby jobs", emptyTitle: "No jobs found", emptySub: "Post the first job in this area",
    myAccount: "My Account", userFallback: "User", notConnected: "Not logged in", profileIncomplete: "Incomplete profile",
    tabSignup: "Sign up", tabLogin: "Log in", fieldPassword: "Password", phPassword: "Minimum 8 characters",
    createAccountBtn: "Create my account", loginBtn: "Log in", forgotPassword: "Forgot password?", orWord: "or", continueGoogle: "Continue with Google",
    adminDashboard: "Admin Dashboard", secureChat: "Secure chat", myListings: "My listings", myProProfile: "My Pro Profile",
    notifPrefsTitle: "Notifications", notifPrefsIntro: "Choose which categories you want to be notified about for new listings. Uncheck the ones that don't concern you.",
    notifPrimerTitle: "Never miss a job again", notifPrimerBody: "Get alerted the moment a new job in your categories is posted near you.",
    notifPrimerLater: "Later", notifPrimerEnable: "Enable alerts",
    installPromptTitle: "Install the app on your phone", installPromptBody: "Faster access from your home screen, just like a real app.", installPromptInstall: "Install",
    boostExpiryTitle: "Your boost is expiring soon", boostExpiryBody: "\"{title}\" will drop back in the ranking in about {hours}h.", boostExpiryRenewBtn: "Renew (1 credit)",
    notifBlockedTip: "Notifications are blocked. Enable them in your browser settings to stop missing new jobs.",
    notifDistanceLabel: "Maximum distance", notifDistanceHint: "You'll only be notified about jobs within this radius of your location (requires location enabled).",
    notifGpsNudgeTitle: "Location not enabled", notifGpsNudgeBody: "Turn on your location so the distance filter below actually works.", notifGpsNudgeBtn: "Enable",
    logout: "Log out", artisanProfile: "Provider's profile",
    descNeed: "Job description:", editListing: "Edit listing", deleteListing: "Delete listing",
    shareWhatsApp: "Share on WhatsApp", seeItinerary: "See route",
    photoWord: "Photo", changePhoto: "Change photo", fieldNameCompany: "Name / Company", phName: "E.g: John Doe or Doe Company",
    fieldCompany: "Company", fieldJobTitle: "Your trade / Specialty", phJobTitle: "E.g: Electrician, Mason, Designer...",
    fieldSkills: "Skills (comma-separated)", phSkills: "E.g: Meter installation, Emergency repairs, Wiring...",
    saveChanges: "Save changes",
    emailVerified: "Email verified", emailNotVerified: "Email not verified — click the link sent to your email at signup.",
    profileVerified: "Verified profile", requestSent: "⏳ Request sent, pending approval.",
    profileNotVerified: "Unverified profile. An ID or proof of trade can unlock the ✓ badge.",
    requestVerificationBtn: "Request verification",
    referralProgram: "Referral program",
    referralExplain: "Invite providers/clients with your link. Every 3 signups, you unlock a free 7-day boost for one of your listings.",
    copyBtn: "Copy", referralCountText: "{count} referral(s) — {next} more to your next credit.",
    creditsAvailable: "{credits} boost credit(s) available", publishToBoost: "Post a listing to be able to boost it.",
    activeBoost: "Active", boostBtn: "Boost",
    chatPanelTitle: "Secure Assistant", chatOfflineBadge: "Offline · private",
    chatWelcomeMsg: "Hello! I can help you use JobMarket, post a request, find a tradesperson, understand pricing and spot fraud warning signs. My replies stay on this device.",
    chatSuggestion1: "How do I post a job?", chatSuggestion2: "How do I avoid a scam?",
    chatSuggestion3: "How do I calculate my margin?", chatSuggestion4: "How do I manage my listings?",
    chatSafetyNotice: "No AI key, no message sent to an external model. Never share a password, SMS code, bank card or ID document in the chat.",
    chatInputPlaceholder: "Your message...",
    adminBadge: "ADMIN", adminStatJobsTotal: "Total jobs", adminStatUsers: "Users",
    adminStatToday: "Posted today", adminStatCountry: "Active country", adminStatNotifOpenRate: "Notif open rate (7d)", adminStatContactsWeek: "WhatsApp contacts (7d)", adminStatReviewsWeek: "Reviews left (7d)", adminStatSignupsWeek: "Signups (7d)", adminStatBoostsWeek: "Boosts used (7d)", adminStatSearchesWeek: "Searches (7d)",
    adminVerificationsTitle: "Pending verifications", adminAllJobsTitle: "All jobs",
    adminLoading: "Loading...", adminNoPending: "No pending requests.",
    reportLink: "Report this listing", reportModalTitle: "Report this listing",
    reportModalIntro: "A useful signal for the team: describe what seems wrong. Abusive reports can be traced back to your account.",
    reportReasonLabel: "Reason", reportReasonFraud: "Suspected scam / fraud", reportReasonInappropriate: "Inappropriate content",
    reportReasonMisleading: "Misleading price or description", reportReasonDuplicate: "Duplicate listing / spam", reportReasonOther: "Other",
    reportCommentLabel: "Details (optional)", phReportComment: "Briefly explain the issue...", reportSubmitBtn: "Submit report",
    adminReportsTitle: "Pending reports", adminNoReports: "No pending reports.", adminJobDeleted: "Job already deleted",
    adminDismissReport: "Dismiss", adminDeleteJob: "Delete job", adminConfirmDeleteJob: "Permanently delete this job?",
    adminLoadError: "Loading error.",
    adminNoName: "No name", adminNoJobTitle: "Profession not specified",
    adminApprove: "Approve ✓", adminReject: "Reject", adminAnonymous: "Anonymous", adminDeleteBtn: "Delete",
    btnUseEstimate: "Use this estimate",
    scamAutoAnalysisNote: "Automatic text analysis, not proof — stay alert and verify before paying anything upfront.",
    priceEstimateLabel: "💡 Estimate:",
    toastFillAllFields: "Fill in all fields",
    toastAccountCreated: "Account created! Check your email.",
    toastWelcomeBack: "Welcome back!",
    toastWelcomeName: "Welcome {name}",
    toastLoggedOut: "Logged out",
    toastEnterEmailFirst: "Enter your email first, then click the link",
    toastEmailSent: "Email sent! Check your inbox.",
    toastResetLinkMaybeSent: "If an account exists with this email, a link has been sent.",
    toastGpsNotSupported: "GPS not supported",
    toastGpsUnavailable: "GPS location unavailable",
    toastLoginToPublish: "Log in to publish",
    toastFillRequiredFields: "Fill in the required fields",
    toastSomePhotosFailed: "{count} photo(s) could not be uploaded (unstable network?); the rest of the listing was still published.",
    toastListingUpdated: "Listing updated!",
    toastJobPublished: "Job published successfully!",
    toastPublishError: "Error while publishing",
    toastGpsRequiredPublish: "GPS required to publish",
    toastFilesWrongType: "{count} file(s) ignored: unsupported format (JPG, PNG, WEBP or GIF only)",
    toastFilesTooBig: "{count} photo(s) ignored: over {max} MB",
    toastGpsRequired: "GPS location required",
    toastMapViewOn: "Map view enabled",
    toastSatelliteViewOn: "Satellite view enabled",
    toastFilterCategoryHint: "Filter by category at the top",
    toastLoginToReport: "Log in to report a listing.",
    toastReportSent: "Report sent, thank you.",
    toastAlreadyReported: "You have already reported this listing.",
    toastSendErrorRetry: "Error while sending, please try again.",
    toastAdminOnly: "Access restricted to administrators",
    toastErrorRetry: "Error, please try again.",
    toastJobDeleted: "Job deleted.",
    toastCodeGenerated: "Code generated and WhatsApp opened to send it!",
    toastNoWhatsAppNumber: "No WhatsApp number registered for this profile. Code to share manually: {code}",
    toastValidationError: "Error during validation",
    toastRequestRejected: "Request rejected",
    toastGenericError: "Error",
    toastDeleteError: "Error while deleting",
    toastPleaseLogin: "Log in",
    toastNoListingsFound: "No listings found",
    toastYouHaveListings: "You have {count} listing(s)",
    toastPrefNotSaved: "Preference not saved (unstable network?), please try again.",
    toastWriteDescFirst: "Write a short description first before using AI.",
    toastAiUnavailable: "AI is currently unavailable, please try again later.",
    toastDescImproved: "Description improved!",
    toastAiConnectionError: "Unable to reach the AI. Check your connection.",
    toastFillSkillsFirst: "Enter your skills first before using AI.",
    toastProfileOptimized: "Profile optimized!",
    toastFillTitleOrDescFirst: "Enter a title or description first before requesting a price.",
    toastPriceApplied: "Price applied",
    toastNothingToAnalyze: "Nothing to analyze on this listing.",
    toastNewJobPublished: "🎉 New job: {title} ({location}) was just published!",
    toastPositionSavedComplete: "Location saved! Complete the form.",
    toastPositionSavedFill: "Location saved! Fill in the job form.",
    toastCantEditOthers: "You can only edit your own listings",
    toastEditFieldsThenValidate: "Edit the fields then confirm",
    toastCantDeleteOthers: "You can only delete your own listings",
    toastListingDeleted: "Listing deleted",
    toastLoginToEditProfile: "Log in to edit your profile",
    toastInvalidPhoto: "Invalid photo: JPG/PNG/WEBP, max {max} MB.",
    toastLinkCopied: "Link copied!",
    toastCopyFailed: "Unable to copy",
    toastNoCreditsAvailable: "No credits available",
    toastBoostedSeven: "Listing boosted for 7 days!",
    toastBoostError: "Error while boosting",
    toastNeedIdAndSelfie: "Add a photo of your ID AND a selfie before sending.",
    toastNeedValidWhatsApp: "Enter a valid WhatsApp number (e.g: +237650420710) to receive your code.",
    toastRequestSent: "Request sent!",
    toastPhotoSendError: "Error while sending photos",
    toastCodeMustBe7Digits: "The code must contain exactly 7 digits.",
    toastNoCodePending: "No pending code for this profile.",
    toastWrongCode: "Incorrect code, try again.",
    toastProfileVerified: "Profile verified!",
    toastCodeVerifyError: "Error while verifying the code",
    toastPhotoUploadError: "Error while uploading the photo (unstable network?), please try again.",
    toastWhatsAppOpenError: "Error while opening WhatsApp. Please try again.",
    toastWhatsAppOpened: "WhatsApp opened!",
    toastSharedWhatsApp: "Shared on WhatsApp!",
    toastChooseRatingFirst: "Choose a rating before sending",
    toastReviewThanks: "Thank you for your review!",
    toastReviewSendError: "Error while sending the review",
    toastEnableLocationForDistance: "Enable your location to filter by distance",
    reviewsTitle: "Reviews",
    reviewsNoneYet: "No reviews yet for this provider.",
    reviewsCountWord: "reviews",
    reviewsLoading: "Loading reviews...",
    reviewsContactFirst: "Contact this provider via WhatsApp to be able to leave a review afterwards.",
    reviewsAlreadyDone: "✓ You have already left a review for this exchange.",
    reviewsProviderFallback: "this provider",
    reviewsLeaveBtn: "⭐ Leave a review",
    reviewsJobFallback: "this request",
    reviewPromptQuestion: "How did it go?",
    reviewPromptWith: "With {name} for “{title}”",
    reviewCommentPlaceholder: "Comment (optional)",
    reviewSendBtn: "Send",
    reviewSending: "Sending...",
    searchJobPlaceholder: "Search a job (e.g: plumber, cleaning...)",
    verifyCodePlaceholder: "7-digit code",
    companyNamePlaceholder: "E.g: Cameroon Builders",
    phoneValidTitle: "Valid phone number, e.g: 6XX XXX XXX",
    whatsappVerifiedTitle: "Number verified via WhatsApp",
    emailVerifiedTitle: "Email verified",
    verifiedBadgeLabel: "Verified",
    closeAriaLabel: "Close",
    backAriaLabel: "Back",
    faqAriaLabel: "Frequently asked questions",
    altSelfieSubmitted: "Verification selfie submitted",
    altIdSubmitted: "ID document submitted",
    altDocumentPreview: "Selected document preview",
    altJobPhoto: "Listing photo",
    altProfilePhotoPreview: "Profile photo preview",
    altGeneratedAvatar: "Avatar generated from the name",
    altSelectedPhotoPreview: "Selected photo preview",
    altProfilePhoto: "Profile photo"
  },
  it: {
    reviewRateLimited: "Hai già recensito questo prestatore di recente — una nuova recensione sarà possibile più avanti.",
    toastPaymentPending: "Pagamento ricevuto, attivazione in corso...",
    toastLoginToPay: "Accedi prima di pagare.",
    toastOpeningPayment: "Apertura del pagamento...",
    toastPaymentFailed: "Il pagamento non è potuto partire. Riprova.",
    payProTitle: "⭐ Passa a PRO",
    payProDesc: "Migliore posizionamento, annunci illimitati, badge dorato e statistiche.",
    payProButton: "Diventa Pro — 1.500 FCFA / mese",
    payVerifiedButton: "✅ Badge Identità verificata — 500 FCFA",
    payBoostButton: "🚀 Pacchetto 3 boost — 500 FCFA",
    emptyStateNoJobs: "Nessun lavoro trovato",
    settingsNotifications: "Notifiche", settingsManageNotifications: "Gestisci preferenze",
    saveLabel: "Salva", savedLabel: "Salvato", jobSavedToast: "Annuncio salvato!", jobUnsavedToast: "Annuncio rimosso dai salvati", filterAllJobs: "Tutti", filterSavedJobs: "Salvati",
    tipSettings: "Impostazioni", settingsTitle: "Impostazioni", settingsLanguage: "Lingua", settingsTheme: "Tema", themeDark: "Scuro", themeLight: "Chiaro",
    showMoreText: "...vedi altro", showLessText: "vedi meno",
    jobModerationBlocked: "Pubblicazione rifiutata: {reason}", jobModerationBlockedGeneric: "Questo annuncio non può essere pubblicato così com'è. Modificalo, per favore.",
    resultsPlural: "risultati", resultSingular: "risultato", searchIntentPrefix: "Nessun risultato esatto. Intendevi:", mapViewActivated: "Vista mappa attivata", satelliteViewActivated: "Vista satellite attivata", activateLocationForRadius: "Attiva la tua posizione per filtrare per distanza",
    btnSuggestCategory: "✨ Suggerisci categoria", aiCategoryMinLength: "Scrivi prima un titolo o una descrizione prima di usare l'IA.", aiCategoryLoading: "✨ Analisi in corso...", aiCategorySuggested: "Categoria suggerita: {category}",
    whatsappOpenedSuccess: "WhatsApp aperto!",
    shareOnWhatsappBtn: "🔄 Condividi su WhatsApp", viewRouteBtn: "Vedi itinerario", jobNotFoundAlert: "Lavoro non trovato", errorPrefix: "Errore: ", sharedOnWhatsapp: "Condiviso su WhatsApp!",
    jobUpdated: "Annuncio aggiornato!", jobPublished: "Lavoro pubblicato con successo!",
    // ===== Cles ajoutees pour la traduction automatique des annonces =====
    jobTranslatedNotice: "🌐 Tradotto automaticamente", viewOriginalText: "Vedi originale", viewTranslationText: "Vedi traduzione",
    translatingInProgress: "Traduzione in corso...",
    // ===== Nouvelles cles ajoutees (audit traduction complet) =====
    btnImproveDesc: "✨ Migliora con l'IA", btnSuggestPrice: "💡 Suggerisci un prezzo", btnOptimizeProfile: "✨ Ottimizza con l'IA",
    btnScamCheck: "🛡️ Analizza i segnali d'allarme", aiImproveMinLength: "Scrivi prima una breve descrizione prima di usare l'IA.", aiImproveLoading: "✨ Miglioramento in corso...",
    aiImproveSuccess: "Descrizione migliorata!", aiUnavailable: "L'IA non è disponibile al momento, riprova più tardi.", aiConnectionError: "Impossibile contattare l'IA. Controlla la tua connessione.",
    aiOptimizeMinLength: "Inserisci prima le tue competenze prima di usare l'IA.", aiOptimizeLoading: "✨ Ottimizzazione in corso...", aiOptimizeSuccess: "Profilo ottimizzato!",
    aiPriceMinLength: "Inserisci prima un titolo o una descrizione prima di chiedere un prezzo.", aiPriceLoading: "💡 Calcolo in corso...", aiPriceEstimateLabel: "💡 Stima:", aiPriceUseEstimation: "Usa questa stima",
    aiPriceApplied: "Prezzo applicato", aiScamNothingToAnalyze: "Niente da analizzare in questo annuncio.", aiScamLoading: "🛡️ Analisi in corso...",
    aiScamDisclaimer: "Analisi automatica del testo, non una prova — resta vigile e verifica prima di pagare qualsiasi cosa in anticipo.", splashSubtitle: "Artigiani qualificati vicino a te", langModalTitle: "Scegli la tua lingua",
    offlineBannerText: "Nessuna connessione internet — alcune azioni potrebbero non funzionare",
    shareNewJobTitle: "Annuncio pubblicato!", shareNewJobBody: "Condividilo subito su WhatsApp per raggiungere più persone nei primi minuti.", shareNewJobBtn: "Condividi su WhatsApp",
    copyLinkBtn: "Copia il link", linkCopied: "Link copiato!", copyLinkFailed: "Impossibile copiare il link",
    markAsFilled: "Segna come coperto", markAsOpenAgain: "Riattiva annuncio", filledBadgeLabel: "Coperto",
    toastMarkedFilled: "Annuncio segnato come coperto — non più visibile pubblicamente.", toastMarkedOpenAgain: "Annuncio riattivato — di nuovo visibile.",
    onbSkip: "Salta", onbNext: "Avanti", onbStart: "Inizia",
    onbTitle1: "Trova un professionista vicino a te", onbBody1: "Esplora la mappa per scoprire artigiani qualificati intorno a te, con valutazione e distanza.",
    onbTitle2: "Pubblica la tua richiesta in pochi secondi", onbBody2: "Tocca il pulsante + per descrivere ciò di cui hai bisogno. I professionisti vicini vengono avvisati subito.",
    onbTitle3: "Contatta con fiducia", onbBody3: "Consulta le recensioni e i badge verificati, poi chatta direttamente tramite la chat sicura dell'app.",
    emptyZoneSub: "Pubblica il primo lavoro in questa zona", adminNoDocWarning: "⚠️ Nessun documento inviato nell'app — verificare via WhatsApp", noNewJobsYet: "Nessun nuovo lavoro al momento",
    positionSelectedLabel: "📍 Posizione selezionata", loadingWhatsappContacts: "Caricamento contatti WhatsApp...", interestedPeopleTitle: "Persone interessate",
    noContactYet: "Nessuno ti ha ancora contattato per questa richiesta.", yourWhatsappNumberLabel: "Il tuo numero WhatsApp", whatsappNumberHint: "Riceverai il tuo codice di verifica a 7 cifre su questo numero.",
    idPhotoHint: "📄 Foto del tuo documento d'identità (CI, passaporto...)", tapToAddPhoto: "Tocca per aggiungere la foto", selfieHint: "🤳 Selfie con lo stesso documento tenuto vicino al viso",
    tapToAddSelfie: "Tocca per aggiungere il selfie", noReviewsYet: "Ancora nessuna recensione per questo prestatore.", loadingReviews: "Caricamento recensioni...",
    reviewsLoadError: "Errore nel caricamento delle recensioni.", contactBeforeReview: "Contatta questo prestatore via WhatsApp per poter lasciare una recensione in seguito.", alreadyReviewed: "✓ Hai già lasciato una recensione per questo scambio.",
    reviewModalTitle: "Com'è andata?", prefSaveError: "Preferenza non salvata (rete instabile?), riprova.", welcomeBack: "Bentornato!",
    welcomeUser: "Benvenuto {name}", someUploadsFailed: "{n} foto non sono state caricate (rete instabile?), il resto dell'annuncio è stato comunque pubblicato.", rejectedWrongType: "{n} file ignorati: formato non supportato (solo JPG, PNG, WEBP o GIF)",
    rejectedTooBig: "{n} foto ignorate: oltre {mb} MB", noWhatsappManualCode: "Nessun numero WhatsApp registrato per questo profilo. Codice da comunicare manualmente: {code}", myPublicationsCount: "Hai {n} annuncio/i",
    newJobToast: "🎉 Nuovo lavoro: {title} ({location}) è appena stato pubblicato!", invalidPhotoFormat: "Foto non valida: JPG/PNG/WEBP, max {mb} MB.", positionSavedComplete: "Posizione salvata! Completa il modulo.",
    positionSavedFill: "Posizione salvata! Compila il modulo del lavoro.", photoUploadError: "Errore durante l'invio della foto (rete instabile?), riprova.", whatsappOpenError: "Errore durante l'apertura di WhatsApp. Riprova.",
    chooseRatingFirst: "Scegli una valutazione prima di inviare", reviewSendError: "Errore durante l'invio della recensione", mustBeLoggedIn: "Devi essere connesso.",
    fillNameAndJob: "Inserisci il tuo nome/azienda e la tua professione/specialità.", profileSavedSuccess: "Profilo Pro salvato con successo!", genericError: "Si è verificato un errore.",
    mustBeLoggedInWhatsapp: "Devi essere connesso per scrivere su WhatsApp.", mustCompleteProfileContact: "Devi completare il tuo profilo (nome/azienda e professione/specialità) per contattare questa persona.", phoneUnavailable: "Numero di telefono non disponibile.",
    cannotComputeRoute: "Impossibile calcolare l'itinerario senza la tua posizione.",
    notifTitle: "Nuovi lavori", publishBtn: "Pubblica",
    catAll: "Tutti", catBtp: "Edilizia", catElec: "Elettricità", catPlomberie: "Idraulica",
    navMap: "Mappa", navList: "Lista", navSearch: "Cerca", navAccount: "Account",
    waMsgReferral: "Unisciti a me su JobMarket Cameroon per trovare o offrire servizi vicino a te: {link}",
    waMsgShareJob: "🔊 *NUOVA OFFERTA DI LAVORO*\n\n*{title}*\n{desc}{requirements}\n\n💰 Compenso: {price} XAF\n📍 Luogo: {location}\n📞 Contatto: {phone}\n\nMaggiori dettagli qui: {link}",
    waMsgRequirementsLabel: "📋 *Requisiti:*",
    waMsgOrConnector: " o ",
    waMsgContactProvider: "Ciao, ti contatto da JobMarket per: \"{jobTitle}\".\n\n--- Profilo del fornitore ---\nNome / Azienda: {profileName}\nMestiere: {proTitle}\nCompetenze: {proSkills}\n\nÈ ancora disponibile?",
    catMenage: "Pulizie", catJardinage: "Giardinaggio", catMecanique: "Meccanica", catInfo: "Informatica",
    tipLocate: "La mia posizione", tipZoomIn: "Zoom +", tipZoomOut: "Zoom -", tipMapStyle: "Stile mappa",
    tipLang: "Lingua", tipSearch: "Cerca", tipNotifications: "Notifiche", tipMessages: "Messaggi", tipClose: "Chiudi",
    distanceLabel: "Distanza", itinLabel: "Itinerario", calculating: "Calcolo in corso...", cancelBtn: "Annulla",
    publishTitle: "Pubblica un lavoro", fieldCategory: "Categoria",
    optBtp: "Edilizia / Muratura", optElec: "Elettricità", optPlomberie: "Idraulica", optMenage: "Pulizie",
    optJardinage: "Giardinaggio", optMecanique: "Meccanica auto", optInfo: "Informatica",
    fieldTitle: "Titolo del lavoro", phTitle: "Es: Posa piastrelle bagno",
    fieldDesc: "Descrizione", phDesc: "Descrivi il lavoro da svolgere...",
    fieldRequirements: "Requisiti (facoltativo)", phRequirements: "Es: Puntuale, esperienza minima 2 anni, attrezzatura propria...", requirementsLabel: "Requisiti",
    fieldPrice: "Prezzo (XAF)", phPrice: "Es: 15.000 XAF",
    fieldPhone: "Telefono", fieldPhone2: "Secondo numero (facoltativo)", fieldLandmark: "Punto di riferimento / Quartiere", phLandmark: "Es: Bastos, vicino alla rotonda...",
    fieldPhotos: "Foto (fino a 5)", uploadTitle: "Aggiungi foto",
    uploadSub: "JPG, PNG, WEBP — Max 5 immagini, 8 MB ciascuna", publishNow: "Pubblica ora",
    jobsNearby: "Lavori vicini", emptyTitle: "Nessun lavoro trovato", emptySub: "Pubblica il primo lavoro in questa zona",
    myAccount: "Il mio account", userFallback: "Utente", notConnected: "Non connesso", profileIncomplete: "Profilo incompleto",
    tabSignup: "Crea account", tabLogin: "Accedi", fieldPassword: "Password", phPassword: "Minimo 8 caratteri",
    createAccountBtn: "Crea il mio account", loginBtn: "Accedi", forgotPassword: "Password dimenticata?", orWord: "oppure", continueGoogle: "Continua con Google",
    adminDashboard: "Pannello Admin", secureChat: "Chat sicura", myListings: "I miei annunci", myProProfile: "Il mio profilo Pro",
    notifPrefsTitle: "Notifiche", notifPrefsIntro: "Scegli le categorie per cui vuoi ricevere notifiche di nuovi annunci. Deseleziona quelle che non ti interessano.",
    notifPrimerTitle: "Non perdere più nessun lavoro", notifPrimerBody: "Ricevi un avviso non appena viene pubblicato un nuovo lavoro nelle tue categorie vicino a te.",
    notifPrimerLater: "Più tardi", notifPrimerEnable: "Attiva gli avvisi",
    installPromptTitle: "Installa l'app sul tuo telefono", installPromptBody: "Accesso più rapido dalla schermata iniziale, come una vera app.", installPromptInstall: "Installa",
    boostExpiryTitle: "La tua promozione sta per scadere", boostExpiryBody: "\"{title}\" scenderà in classifica tra circa {hours}h.", boostExpiryRenewBtn: "Rinnova (1 credito)",
    notifBlockedTip: "Notifiche bloccate. Attivale nelle impostazioni del browser per non perdere nuovi lavori.",
    notifDistanceLabel: "Distanza massima", notifDistanceHint: "Riceverai notifiche solo per i lavori entro questo raggio dalla tua posizione (richiede la geolocalizzazione attiva).",
    notifGpsNudgeTitle: "Posizione non attivata", notifGpsNudgeBody: "Attiva la tua posizione perché il filtro di distanza qui sotto funzioni davvero.", notifGpsNudgeBtn: "Attiva",
    logout: "Disconnetti", artisanProfile: "Profilo del fornitore",
    descNeed: "Descrizione del lavoro:", editListing: "Modifica annuncio", deleteListing: "Elimina annuncio",
    shareWhatsApp: "Condividi su WhatsApp", seeItinerary: "Vedi itinerario",
    photoWord: "Foto", changePhoto: "Cambia foto", fieldNameCompany: "Nome / Azienda", phName: "Es: Mario Rossi o Rossi Srl",
    fieldCompany: "Azienda", fieldJobTitle: "Il tuo mestiere / Specialità", phJobTitle: "Es: Elettricista, Muratore, Designer...",
    fieldSkills: "Competenze (separate da virgole)", phSkills: "Es: Installazione contatori, Riparazioni urgenti, Cablaggio...",
    saveChanges: "Salva modifiche",
    emailVerified: "Email verificata", emailNotVerified: "Email non verificata — clicca il link ricevuto via email all'iscrizione.",
    profileVerified: "Profilo verificato", requestSent: "⏳ Richiesta inviata, in attesa di approvazione.",
    profileNotVerified: "Profilo non verificato. Un documento d'identità o una prova del mestiere può sbloccare il badge ✓.",
    requestVerificationBtn: "Richiedi verifica",
    referralProgram: "Programma di referral",
    referralExplain: "Invita fornitori/clienti con il tuo link. Ogni 3 iscritti, sblocchi una promozione gratuita (7 giorni) per uno dei tuoi annunci.",
    copyBtn: "Copia", referralCountText: "{count} invitato/i iscritto/i — ancora {next} per il prossimo credito.",
    creditsAvailable: "{credits} credito/i di promozione disponibile/i", publishToBoost: "Pubblica un annuncio per poterlo promuovere.",
    activeBoost: "Attivo", boostBtn: "Promuovi",
    chatPanelTitle: "Assistente sicuro", chatOfflineBadge: "Offline · privato",
    chatWelcomeMsg: "Ciao! Posso aiutarti a usare JobMarket, pubblicare una richiesta, trovare un artigiano, capire i prezzi e riconoscere i segnali di truffa. Le mie risposte restano su questo dispositivo.",
    chatSuggestion1: "Come pubblico un lavoro?", chatSuggestion2: "Come evito una truffa?",
    chatSuggestion3: "Come calcolo il mio margine?", chatSuggestion4: "Come gestisco i miei annunci?",
    chatSafetyNotice: "Nessuna chiave IA, nessun messaggio inviato a un modello esterno. Non condividere mai password, codici SMS, carte bancarie o documenti d'identità in chat.",
    chatInputPlaceholder: "Il tuo messaggio...",
    adminBadge: "ADMIN", adminStatJobsTotal: "Lavori totali", adminStatUsers: "Utenti",
    adminStatToday: "Pubblicati oggi", adminStatCountry: "Paese attivo", adminStatNotifOpenRate: "Tasso apertura notifiche (7g)", adminStatContactsWeek: "Contatti WhatsApp (7g)", adminStatReviewsWeek: "Recensioni lasciate (7g)", adminStatSignupsWeek: "Iscrizioni (7g)", adminStatBoostsWeek: "Boost utilizzati (7g)", adminStatSearchesWeek: "Ricerche (7g)",
    adminVerificationsTitle: "Verifiche in attesa", adminAllJobsTitle: "Tutti i lavori",
    adminLoading: "Caricamento...", adminNoPending: "Nessuna richiesta in attesa.",
    reportLink: "Segnala questo annuncio", reportModalTitle: "Segnala questo annuncio",
    reportModalIntro: "Un segnale utile per il team: descrivi cosa ti sembra problematico. Le segnalazioni abusive possono essere ricondotte al tuo account.",
    reportReasonLabel: "Motivo", reportReasonFraud: "Truffa / frode sospetta", reportReasonInappropriate: "Contenuto inappropriato",
    reportReasonMisleading: "Prezzo o descrizione ingannevoli", reportReasonDuplicate: "Annuncio duplicato / spam", reportReasonOther: "Altro",
    reportCommentLabel: "Dettagli (facoltativo)", phReportComment: "Spiega brevemente il problema...", reportSubmitBtn: "Invia segnalazione",
    adminReportsTitle: "Segnalazioni in attesa", adminNoReports: "Nessuna segnalazione in attesa.", adminJobDeleted: "Lavoro già eliminato",
    adminDismissReport: "Ignora", adminDeleteJob: "Elimina lavoro", adminConfirmDeleteJob: "Eliminare definitivamente questo lavoro?",
    adminLoadError: "Errore di caricamento.",
    adminNoName: "Senza nome", adminNoJobTitle: "Mestiere non specificato",
    adminApprove: "Approva ✓", adminReject: "Rifiuta", adminAnonymous: "Anonimo", adminDeleteBtn: "Elimina",
    btnUseEstimate: "Usa questa stima",
    scamAutoAnalysisNote: "Analisi automatica del testo, non una prova — resta vigile e verifica prima di pagare qualsiasi cosa in anticipo.",
    priceEstimateLabel: "💡 Stima:",
    toastFillAllFields: "Compila tutti i campi",
    toastAccountCreated: "Account creato! Controlla la tua email.",
    toastWelcomeBack: "Bentornato!",
    toastWelcomeName: "Benvenuto/a {name}",
    toastLoggedOut: "Disconnesso",
    toastEnterEmailFirst: "Inserisci prima la tua email, poi clicca sul link",
    toastEmailSent: "Email inviata! Controlla la tua casella di posta.",
    toastResetLinkMaybeSent: "Se esiste un account con questa email, è stato inviato un link.",
    toastGpsNotSupported: "GPS non supportato",
    toastGpsUnavailable: "Posizione GPS non disponibile",
    toastLoginToPublish: "Accedi per pubblicare",
    toastFillRequiredFields: "Compila i campi obbligatori",
    toastSomePhotosFailed: "{count} foto non caricate (rete instabile?): il resto dell'annuncio è stato comunque pubblicato.",
    toastListingUpdated: "Annuncio aggiornato!",
    toastJobPublished: "Lavoro pubblicato con successo!",
    toastPublishError: "Errore durante la pubblicazione",
    toastGpsRequiredPublish: "GPS richiesto per pubblicare",
    toastFilesWrongType: "{count} file ignorati: formato non supportato (solo JPG, PNG, WEBP o GIF)",
    toastFilesTooBig: "{count} foto ignorate: oltre {max} MB",
    toastGpsRequired: "Posizione GPS richiesta",
    toastMapViewOn: "Vista mappa attivata",
    toastSatelliteViewOn: "Vista satellite attivata",
    toastFilterCategoryHint: "Filtra per categoria in alto",
    toastLoginToReport: "Accedi per segnalare un annuncio.",
    toastReportSent: "Segnalazione inviata, grazie.",
    toastAlreadyReported: "Hai già segnalato questo annuncio.",
    toastSendErrorRetry: "Errore durante l'invio, riprova.",
    toastAdminOnly: "Accesso riservato agli amministratori",
    toastErrorRetry: "Errore, riprova.",
    toastJobDeleted: "Lavoro eliminato.",
    toastCodeGenerated: "Codice generato e WhatsApp aperto per inviarlo!",
    toastNoWhatsAppNumber: "Nessun numero WhatsApp registrato per questo profilo. Codice da comunicare manualmente: {code}",
    toastValidationError: "Errore durante la convalida",
    toastRequestRejected: "Richiesta rifiutata",
    toastGenericError: "Errore",
    toastDeleteError: "Errore durante l'eliminazione",
    toastPleaseLogin: "Accedi",
    toastNoListingsFound: "Nessun annuncio trovato",
    toastYouHaveListings: "Hai {count} annuncio/i",
    toastPrefNotSaved: "Preferenza non salvata (rete instabile?), riprova.",
    toastWriteDescFirst: "Scrivi prima una breve descrizione prima di usare l'IA.",
    toastAiUnavailable: "L'IA non è disponibile al momento, riprova più tardi.",
    toastDescImproved: "Descrizione migliorata!",
    toastAiConnectionError: "Impossibile contattare l'IA. Controlla la tua connessione.",
    toastFillSkillsFirst: "Inserisci prima le tue competenze prima di usare l'IA.",
    toastProfileOptimized: "Profilo ottimizzato!",
    toastFillTitleOrDescFirst: "Inserisci prima un titolo o una descrizione prima di richiedere un prezzo.",
    toastPriceApplied: "Prezzo applicato",
    toastNothingToAnalyze: "Niente da analizzare in questo annuncio.",
    toastNewJobPublished: "🎉 Nuovo lavoro: {title} ({location}) appena pubblicato!",
    toastPositionSavedComplete: "Posizione salvata! Completa il modulo.",
    toastPositionSavedFill: "Posizione salvata! Compila il modulo del lavoro.",
    toastCantEditOthers: "Puoi modificare solo i tuoi annunci",
    toastEditFieldsThenValidate: "Modifica i campi e conferma",
    toastCantDeleteOthers: "Puoi eliminare solo i tuoi annunci",
    toastListingDeleted: "Annuncio eliminato",
    toastLoginToEditProfile: "Accedi per modificare il tuo profilo",
    toastInvalidPhoto: "Foto non valida: JPG/PNG/WEBP, max {max} MB.",
    toastLinkCopied: "Link copiato!",
    toastCopyFailed: "Impossibile copiare",
    toastNoCreditsAvailable: "Nessun credito disponibile",
    toastBoostedSeven: "Annuncio in evidenza per 7 giorni!",
    toastBoostError: "Errore durante la promozione",
    toastNeedIdAndSelfie: "Aggiungi una foto del tuo documento E un selfie prima di inviare.",
    toastNeedValidWhatsApp: "Inserisci un numero WhatsApp valido (es: +237650420710) per ricevere il tuo codice.",
    toastRequestSent: "Richiesta inviata!",
    toastPhotoSendError: "Errore durante l'invio delle foto",
    toastCodeMustBe7Digits: "Il codice deve contenere esattamente 7 cifre.",
    toastNoCodePending: "Nessun codice in attesa per questo profilo.",
    toastWrongCode: "Codice errato, riprova.",
    toastProfileVerified: "Profilo verificato!",
    toastCodeVerifyError: "Errore durante la verifica del codice",
    toastPhotoUploadError: "Errore durante il caricamento della foto (rete instabile?), riprova.",
    toastWhatsAppOpenError: "Errore durante l'apertura di WhatsApp. Riprova.",
    toastWhatsAppOpened: "WhatsApp aperto!",
    toastSharedWhatsApp: "Condiviso su WhatsApp!",
    toastChooseRatingFirst: "Scegli una valutazione prima di inviare",
    toastReviewThanks: "Grazie per la tua recensione!",
    toastReviewSendError: "Errore durante l'invio della recensione",
    toastEnableLocationForDistance: "Attiva la tua posizione per filtrare per distanza",
    reviewsTitle: "Recensioni",
    reviewsNoneYet: "Nessuna recensione per questo prestatore.",
    reviewsCountWord: "recensioni",
    reviewsLoading: "Caricamento recensioni...",
    reviewsContactFirst: "Contatta questo prestatore su WhatsApp per poter lasciare una recensione in seguito.",
    reviewsAlreadyDone: "✓ Hai già lasciato una recensione per questo scambio.",
    reviewsProviderFallback: "questo prestatore",
    reviewsLeaveBtn: "⭐ Lascia una recensione",
    reviewsJobFallback: "questa richiesta",
    reviewPromptQuestion: "Com'è andata?",
    reviewPromptWith: "Con {name} per “{title}”",
    reviewCommentPlaceholder: "Commento (facoltativo)",
    reviewSendBtn: "Invia",
    reviewSending: "Invio...",
    searchJobPlaceholder: "Cerca un lavoro (es: idraulico, pulizie...)",
    verifyCodePlaceholder: "Codice a 7 cifre",
    companyNamePlaceholder: "Es: I Costruttori del Camerun",
    phoneValidTitle: "Numero di telefono valido, es: 6XX XXX XXX",
    whatsappVerifiedTitle: "Numero verificato via WhatsApp",
    emailVerifiedTitle: "Email verificata",
    verifiedBadgeLabel: "Verificato",
    closeAriaLabel: "Chiudi",
    backAriaLabel: "Indietro",
    faqAriaLabel: "Domande frequenti",
    altSelfieSubmitted: "Selfie di verifica inviato",
    altIdSubmitted: "Documento d'identità inviato",
    altDocumentPreview: "Anteprima del documento selezionato",
    altJobPhoto: "Foto dell'annuncio",
    altProfilePhotoPreview: "Anteprima della foto del profilo",
    altGeneratedAvatar: "Avatar generato dal nome",
    altSelectedPhotoPreview: "Anteprima della foto selezionata",
    altProfilePhoto: "Foto del profilo"
  },
  de: {
    reviewRateLimited: "Sie haben diesen Anbieter kürzlich bereits bewertet — eine neue Bewertung ist später möglich.",
    toastPaymentPending: "Zahlung erhalten, wird aktiviert...",
    toastLoginToPay: "Melde dich zuerst an, um zu bezahlen.",
    toastOpeningPayment: "Zahlung wird geöffnet...",
    toastPaymentFailed: "Zahlung konnte nicht gestartet werden. Versuch's erneut.",
    payProTitle: "⭐ Auf PRO upgraden",
    payProDesc: "Bessere Platzierung, unbegrenzte Anzeigen, goldenes Abzeichen und Statistiken.",
    payProButton: "Pro werden — 1.500 FCFA / Monat",
    payVerifiedButton: "✅ Abzeichen 'Verifizierte Identität' — 500 FCFA",
    payBoostButton: "🚀 3er-Boost-Paket — 500 FCFA",
    emptyStateNoJobs: "Keine Aufträge gefunden",
    settingsNotifications: "Benachrichtigungen", settingsManageNotifications: "Einstellungen verwalten",
    saveLabel: "Speichern", savedLabel: "Gespeichert", jobSavedToast: "Anzeige gespeichert!", jobUnsavedToast: "Anzeige aus Gespeichert entfernt", filterAllJobs: "Alle", filterSavedJobs: "Gespeichert",
    tipSettings: "Einstellungen", settingsTitle: "Einstellungen", settingsLanguage: "Sprache", settingsTheme: "Design", themeDark: "Dunkel", themeLight: "Hell",
    showMoreText: "...mehr anzeigen", showLessText: "weniger anzeigen",
    jobModerationBlocked: "Veröffentlichung abgelehnt: {reason}", jobModerationBlockedGeneric: "Diese Anzeige kann so nicht veröffentlicht werden. Bitte bearbeiten Sie sie.",
    resultsPlural: "Ergebnisse", resultSingular: "Ergebnis", searchIntentPrefix: "Keine exakte Übereinstimmung. Meinten Sie:", mapViewActivated: "Kartenansicht aktiviert", satelliteViewActivated: "Satellitenansicht aktiviert", activateLocationForRadius: "Aktivieren Sie Ihren Standort, um nach Entfernung zu filtern",
    btnSuggestCategory: "✨ Kategorie vorschlagen", aiCategoryMinLength: "Schreiben Sie zuerst einen Titel oder eine Beschreibung, bevor Sie die KI nutzen.", aiCategoryLoading: "✨ Wird analysiert...", aiCategorySuggested: "Vorgeschlagene Kategorie: {category}",
    whatsappOpenedSuccess: "WhatsApp geöffnet!",
    shareOnWhatsappBtn: "🔄 Auf WhatsApp teilen", viewRouteBtn: "Route anzeigen", jobNotFoundAlert: "Auftrag nicht gefunden", errorPrefix: "Fehler: ", sharedOnWhatsapp: "Auf WhatsApp geteilt!",
    jobUpdated: "Anzeige aktualisiert!", jobPublished: "Auftrag erfolgreich veröffentlicht!",
    // ===== Cles ajoutees pour la traduction automatique des annonces =====
    jobTranslatedNotice: "🌐 Automatisch übersetzt", viewOriginalText: "Original anzeigen", viewTranslationText: "Übersetzung anzeigen",
    translatingInProgress: "Wird übersetzt...",
    // ===== Nouvelles cles ajoutees (audit traduction complet) =====
    btnImproveDesc: "✨ Mit KI verbessern", btnSuggestPrice: "💡 Preis vorschlagen", btnOptimizeProfile: "✨ Mit KI optimieren",
    btnScamCheck: "🛡️ Warnsignale analysieren", aiImproveMinLength: "Schreiben Sie zuerst eine kurze Beschreibung, bevor Sie die KI nutzen.", aiImproveLoading: "✨ Wird verbessert...",
    aiImproveSuccess: "Beschreibung verbessert!", aiUnavailable: "Die KI ist momentan nicht verfügbar, bitte versuchen Sie es später erneut.", aiConnectionError: "Die KI konnte nicht erreicht werden. Überprüfen Sie Ihre Verbindung.",
    aiOptimizeMinLength: "Geben Sie zuerst Ihre Fähigkeiten ein, bevor Sie die KI nutzen.", aiOptimizeLoading: "✨ Wird optimiert...", aiOptimizeSuccess: "Profil optimiert!",
    aiPriceMinLength: "Geben Sie zuerst einen Titel oder eine Beschreibung ein, bevor Sie einen Preis anfordern.", aiPriceLoading: "💡 Wird berechnet...", aiPriceEstimateLabel: "💡 Schätzung:", aiPriceUseEstimation: "Diese Schätzung verwenden",
    aiPriceApplied: "Preis übernommen", aiScamNothingToAnalyze: "Nichts zu analysieren bei dieser Anzeige.", aiScamLoading: "🛡️ Wird analysiert...",
    aiScamDisclaimer: "Automatische Textanalyse, kein Beweis — bleiben Sie wachsam und prüfen Sie, bevor Sie im Voraus etwas bezahlen.", splashSubtitle: "Qualifizierte Handwerker in Ihrer Nähe", langModalTitle: "Wählen Sie Ihre Sprache",
    offlineBannerText: "Keine Internetverbindung — einige Aktionen funktionieren möglicherweise nicht",
    shareNewJobTitle: "Anzeige veröffentlicht!", shareNewJobBody: "Teile sie jetzt auf WhatsApp, um in den ersten Minuten mehr Leute zu erreichen.", shareNewJobBtn: "Auf WhatsApp teilen",
    copyLinkBtn: "Link kopieren", linkCopied: "Link kopiert!", copyLinkFailed: "Link konnte nicht kopiert werden",
    markAsFilled: "Als besetzt markieren", markAsOpenAgain: "Anzeige reaktivieren", filledBadgeLabel: "Besetzt",
    toastMarkedFilled: "Anzeige als besetzt markiert — nicht mehr öffentlich sichtbar.", toastMarkedOpenAgain: "Anzeige reaktiviert — wieder sichtbar.",
    onbSkip: "Überspringen", onbNext: "Weiter", onbStart: "Loslegen",
    onbTitle1: "Finden Sie einen Profi in Ihrer Nähe", onbBody1: "Durchsuchen Sie die Karte, um qualifizierte Handwerker in Ihrer Nähe mit Bewertung und Entfernung zu entdecken.",
    onbTitle2: "Veröffentlichen Sie Ihren Bedarf in Sekunden", onbBody2: "Tippen Sie auf +, um zu beschreiben, was Sie brauchen. Anbieter in der Nähe werden sofort benachrichtigt.",
    onbTitle3: "Kontaktieren Sie mit Vertrauen", onbBody3: "Prüfen Sie Bewertungen und verifizierte Badges und chatten Sie dann direkt über den sicheren Chat der App.",
    emptyZoneSub: "Veröffentlichen Sie den ersten Auftrag in dieser Gegend", adminNoDocWarning: "⚠️ Kein Dokument in der App gesendet — über WhatsApp überprüfen", noNewJobsYet: "Momentan keine neuen Aufträge",
    positionSelectedLabel: "📍 Position ausgewählt", loadingWhatsappContacts: "WhatsApp-Kontakte werden geladen...", interestedPeopleTitle: "Interessierte Personen",
    noContactYet: "Bisher hat Sie niemand zu dieser Anfrage kontaktiert.", yourWhatsappNumberLabel: "Ihre WhatsApp-Nummer", whatsappNumberHint: "Sie erhalten Ihren 7-stelligen Bestätigungscode auf dieser Nummer.",
    idPhotoHint: "📄 Foto Ihres Ausweisdokuments (Personalausweis, Reisepass...)", tapToAddPhoto: "Tippen, um das Foto hinzuzufügen", selfieHint: "🤳 Selfie von Ihnen mit demselben Dokument neben Ihrem Gesicht",
    tapToAddSelfie: "Tippen, um das Selfie hinzuzufügen", noReviewsYet: "Noch keine Bewertungen für diesen Anbieter.", loadingReviews: "Bewertungen werden geladen...",
    reviewsLoadError: "Fehler beim Laden der Bewertungen.", contactBeforeReview: "Kontaktieren Sie diesen Anbieter über WhatsApp, um danach eine Bewertung abgeben zu können.", alreadyReviewed: "✓ Sie haben für diesen Austausch bereits eine Bewertung abgegeben.",
    reviewModalTitle: "Wie ist es gelaufen?", prefSaveError: "Einstellung nicht gespeichert (instabile Verbindung?), bitte erneut versuchen.", welcomeBack: "Willkommen zurück!",
    welcomeUser: "Willkommen {name}", someUploadsFailed: "{n} Foto(s) konnten nicht hochgeladen werden (instabile Verbindung?), der Rest der Anzeige wurde trotzdem veröffentlicht.", rejectedWrongType: "{n} Datei(en) übersprungen: nicht unterstütztes Format (nur JPG, PNG, WEBP oder GIF)",
    rejectedTooBig: "{n} Foto(s) übersprungen: über {mb} MB", noWhatsappManualCode: "Keine WhatsApp-Nummer für dieses Profil gespeichert. Code manuell mitteilen: {code}", myPublicationsCount: "Sie haben {n} Anzeige(n)",
    newJobToast: "🎉 Neuer Auftrag: {title} ({location}) wurde gerade veröffentlicht!", invalidPhotoFormat: "Ungültiges Foto: JPG/PNG/WEBP, max. {mb} MB.", positionSavedComplete: "Position gespeichert! Füllen Sie das Formular aus.",
    positionSavedFill: "Position gespeichert! Füllen Sie das Auftragsformular aus.", photoUploadError: "Fehler beim Hochladen des Fotos (instabile Verbindung?), bitte erneut versuchen.", whatsappOpenError: "Fehler beim Öffnen von WhatsApp. Bitte erneut versuchen.",
    chooseRatingFirst: "Wählen Sie eine Bewertung, bevor Sie senden", reviewSendError: "Fehler beim Senden der Bewertung", mustBeLoggedIn: "Sie müssen angemeldet sein.",
    fillNameAndJob: "Bitte geben Sie Ihren Namen/Firma und Ihren Beruf/Ihre Spezialität ein.", profileSavedSuccess: "Profi-Profil erfolgreich gespeichert!", genericError: "Ein Fehler ist aufgetreten.",
    mustBeLoggedInWhatsapp: "Sie müssen angemeldet sein, um über WhatsApp zu schreiben.", mustCompleteProfileContact: "Sie müssen Ihr Profil (Name/Firma und Beruf/Spezialität) vervollständigen, um diese Person zu kontaktieren.", phoneUnavailable: "Telefonnummer nicht verfügbar.",
    cannotComputeRoute: "Route kann ohne Ihren Standort nicht berechnet werden.",
    notifTitle: "Neue Jobs", publishBtn: "Veröffentlichen",
    catAll: "Alle", catBtp: "Bau", catElec: "Elektrik", catPlomberie: "Sanitär",
    navMap: "Karte", navList: "Liste", navSearch: "Suchen", navAccount: "Konto",
    waMsgReferral: "Begleite mich auf JobMarket Cameroon, um Dienstleistungen in deiner Nähe zu finden oder anzubieten: {link}",
    waMsgShareJob: "🔊 *NEUES STELLENANGEBOT*\n\n*{title}*\n{desc}{requirements}\n\n💰 Vergütung: {price} XAF\n📍 Ort: {location}\n📞 Kontakt: {phone}\n\nMehr Details hier: {link}",
    waMsgRequirementsLabel: "📋 *Anforderungen:*",
    waMsgOrConnector: " oder ",
    waMsgContactProvider: "Hallo, ich kontaktiere Sie über JobMarket bezüglich: \"{jobTitle}\".\n\n--- Anbieterprofil ---\nName / Firma: {profileName}\nBeruf: {proTitle}\nFähigkeiten: {proSkills}\n\nIst das noch verfügbar?",
    catMenage: "Reinigung", catJardinage: "Gartenarbeit", catMecanique: "Mechanik", catInfo: "IT",
    tipLocate: "Mein Standort", tipZoomIn: "Zoom +", tipZoomOut: "Zoom -", tipMapStyle: "Kartenstil",
    tipLang: "Sprache", tipSearch: "Suchen", tipNotifications: "Benachrichtigungen", tipMessages: "Nachrichten", tipClose: "Schließen",
    distanceLabel: "Entfernung", itinLabel: "Route", calculating: "Berechnung läuft...", cancelBtn: "Abbrechen",
    publishTitle: "Job veröffentlichen", fieldCategory: "Kategorie",
    optBtp: "Bau / Maurerarbeiten", optElec: "Elektrik", optPlomberie: "Sanitär", optMenage: "Reinigung",
    optJardinage: "Gartenarbeit", optMecanique: "Kfz-Mechanik", optInfo: "IT-Dienste",
    fieldTitle: "Jobtitel", phTitle: "Z.B: Badezimmerfliesen verlegen",
    fieldDesc: "Beschreibung", phDesc: "Beschreiben Sie die auszuführende Arbeit...",
    fieldRequirements: "Anforderungen (optional)", phRequirements: "Z.B: Pünktlich, min. 2 Jahre Erfahrung, eigenes Werkzeug...", requirementsLabel: "Anforderungen",
    fieldPrice: "Preis (XAF)", phPrice: "Z.B: 15.000 XAF",
    fieldPhone: "Telefon", fieldPhone2: "Zweite Nummer (optional)", fieldLandmark: "Orientierungspunkt / Viertel", phLandmark: "Z.B: Bastos, nahe dem Kreisverkehr...",
    fieldPhotos: "Fotos (bis zu 5)", uploadTitle: "Fotos hinzufügen",
    uploadSub: "JPG, PNG, WEBP — Max. 5 Bilder, je 8 MB", publishNow: "Jetzt veröffentlichen",
    jobsNearby: "Jobs in der Nähe", emptyTitle: "Keine Jobs gefunden", emptySub: "Veröffentlichen Sie den ersten Job in dieser Gegend",
    myAccount: "Mein Konto", userFallback: "Benutzer", notConnected: "Nicht angemeldet", profileIncomplete: "Profil unvollständig",
    tabSignup: "Konto erstellen", tabLogin: "Anmelden", fieldPassword: "Passwort", phPassword: "Mindestens 8 Zeichen",
    createAccountBtn: "Konto erstellen", loginBtn: "Anmelden", forgotPassword: "Passwort vergessen?", orWord: "oder", continueGoogle: "Mit Google fortfahren",
    adminDashboard: "Admin-Bereich", secureChat: "Sicherer Chat", myListings: "Meine Anzeigen", myProProfile: "Mein Profi-Profil",
    notifPrefsTitle: "Benachrichtigungen", notifPrefsIntro: "Wählen Sie die Kategorien, für die Sie über neue Angebote benachrichtigt werden möchten. Deaktivieren Sie die, die Sie nicht betreffen.",
    notifPrimerTitle: "Verpassen Sie keinen Job mehr", notifPrimerBody: "Werden Sie sofort benachrichtigt, wenn ein neuer Job in Ihren Kategorien in Ihrer Nähe veröffentlicht wird.",
    notifPrimerLater: "Später", notifPrimerEnable: "Benachrichtigungen aktivieren",
    installPromptTitle: "Installiere die App auf deinem Handy", installPromptBody: "Schnellerer Zugriff vom Startbildschirm, wie eine echte App.", installPromptInstall: "Installieren",
    boostExpiryTitle: "Deine Hervorhebung läuft bald ab", boostExpiryBody: "\"{title}\" fällt in etwa {hours}Std. wieder in der Rangliste zurück.", boostExpiryRenewBtn: "Verlängern (1 Guthaben)",
    notifBlockedTip: "Benachrichtigungen sind blockiert. Aktivieren Sie sie in den Browsereinstellungen, um keine neuen Jobs mehr zu verpassen.",
    notifDistanceLabel: "Maximale Entfernung", notifDistanceHint: "Sie werden nur über Jobs in diesem Umkreis um Ihren Standort benachrichtigt (Standortfreigabe erforderlich).",
    notifGpsNudgeTitle: "Standort nicht aktiviert", notifGpsNudgeBody: "Aktivieren Sie Ihren Standort, damit der Entfernungsfilter unten wirklich funktioniert.", notifGpsNudgeBtn: "Aktivieren",
    logout: "Abmelden", artisanProfile: "Profil des Anbieters",
    descNeed: "Beschreibung des Auftrags:", editListing: "Anzeige bearbeiten", deleteListing: "Anzeige löschen",
    shareWhatsApp: "Auf WhatsApp teilen", seeItinerary: "Route anzeigen",
    photoWord: "Foto", changePhoto: "Foto ändern", fieldNameCompany: "Name / Firma", phName: "Z.B: Max Mustermann oder Mustermann GmbH",
    fieldCompany: "Firma", fieldJobTitle: "Ihr Beruf / Fachgebiet", phJobTitle: "Z.B: Elektriker, Maurer, Designer...",
    fieldSkills: "Fähigkeiten (durch Kommas getrennt)", phSkills: "Z.B: Zählerinstallation, Notreparaturen, Verkabelung...",
    saveChanges: "Änderungen speichern",
    emailVerified: "E-Mail bestätigt", emailNotVerified: "E-Mail nicht bestätigt — klicken Sie auf den bei der Anmeldung erhaltenen Link.",
    profileVerified: "Profil verifiziert", requestSent: "⏳ Anfrage gesendet, Prüfung ausstehend.",
    profileNotVerified: "Profil nicht verifiziert. Ein Ausweis oder Nachweis kann das ✓-Abzeichen freischalten.",
    requestVerificationBtn: "Verifizierung anfordern",
    referralProgram: "Empfehlungsprogramm",
    referralExplain: "Laden Sie Anbieter/Kunden mit Ihrem Link ein. Alle 3 Anmeldungen schalten Sie eine kostenlose 7-tägige Hervorhebung für eine Ihrer Anzeigen frei.",
    copyBtn: "Kopieren", referralCountText: "{count} Empfehlung(en) — noch {next} bis zum nächsten Guthaben.",
    creditsAvailable: "{credits} Hervorhebungs-Guthaben verfügbar", publishToBoost: "Veröffentlichen Sie eine Anzeige, um sie hervorheben zu können.",
    activeBoost: "Aktiv", boostBtn: "Hervorheben",
    chatPanelTitle: "Sicherer Assistent", chatOfflineBadge: "Offline · privat",
    chatWelcomeMsg: "Hallo! Ich kann Ihnen helfen, JobMarket zu nutzen, eine Anfrage zu veröffentlichen, einen Handwerker zu finden, Preise zu verstehen und Betrugssignale zu erkennen. Meine Antworten bleiben auf diesem Gerät.",
    chatSuggestion1: "Wie veröffentliche ich einen Job?", chatSuggestion2: "Wie vermeide ich Betrug?",
    chatSuggestion3: "Wie berechne ich meine Marge?", chatSuggestion4: "Wie verwalte ich meine Anzeigen?",
    chatSafetyNotice: "Kein KI-Schlüssel, keine Nachricht wird an ein externes Modell gesendet. Teilen Sie im Chat niemals Passwörter, SMS-Codes, Bankkarten oder Ausweisdokumente.",
    chatInputPlaceholder: "Ihre Nachricht...",
    adminBadge: "ADMIN", adminStatJobsTotal: "Jobs gesamt", adminStatUsers: "Benutzer",
    adminStatToday: "Heute veröffentlicht", adminStatCountry: "Aktives Land", adminStatNotifOpenRate: "Öffnungsrate Benachrichtigungen (7T)", adminStatContactsWeek: "WhatsApp-Kontakte (7T)", adminStatReviewsWeek: "Abgegebene Bewertungen (7T)", adminStatSignupsWeek: "Anmeldungen (7T)", adminStatBoostsWeek: "Genutzte Boosts (7T)", adminStatSearchesWeek: "Suchanfragen (7T)",
    adminVerificationsTitle: "Ausstehende Verifizierungen", adminAllJobsTitle: "Alle Jobs",
    adminLoading: "Wird geladen...", adminNoPending: "Keine ausstehenden Anfragen.",
    reportLink: "Diese Anzeige melden", reportModalTitle: "Diese Anzeige melden",
    reportModalIntro: "Ein hilfreiches Signal für das Team: Beschreiben Sie, was Ihnen problematisch erscheint. Missbräuchliche Meldungen können zu Ihrem Konto zurückverfolgt werden.",
    reportReasonLabel: "Grund", reportReasonFraud: "Vermuteter Betrug", reportReasonInappropriate: "Unangemessener Inhalt",
    reportReasonMisleading: "Irreführender Preis oder Beschreibung", reportReasonDuplicate: "Doppelte Anzeige / Spam", reportReasonOther: "Sonstiges",
    reportCommentLabel: "Details (optional)", phReportComment: "Beschreiben Sie kurz das Problem...", reportSubmitBtn: "Meldung senden",
    adminReportsTitle: "Ausstehende Meldungen", adminNoReports: "Keine ausstehenden Meldungen.", adminJobDeleted: "Job bereits gelöscht",
    adminDismissReport: "Verwerfen", adminDeleteJob: "Job löschen", adminConfirmDeleteJob: "Diesen Job endgültig löschen?",
    adminLoadError: "Ladefehler.",
    adminNoName: "Ohne Namen", adminNoJobTitle: "Beruf nicht angegeben",
    adminApprove: "Genehmigen ✓", adminReject: "Ablehnen", adminAnonymous: "Anonym", adminDeleteBtn: "Löschen",
    btnUseEstimate: "Diese Schätzung verwenden",
    scamAutoAnalysisNote: "Automatische Textanalyse, kein Beweis — bleiben Sie wachsam und prüfen Sie, bevor Sie im Voraus etwas bezahlen.",
    priceEstimateLabel: "💡 Schätzung:",
    toastFillAllFields: "Bitte alle Felder ausfüllen",
    toastAccountCreated: "Konto erstellt! Überprüfen Sie Ihre E-Mail.",
    toastWelcomeBack: "Willkommen zurück!",
    toastWelcomeName: "Willkommen {name}",
    toastLoggedOut: "Abgemeldet",
    toastEnterEmailFirst: "Geben Sie zuerst Ihre E-Mail-Adresse ein und klicken Sie dann auf den Link",
    toastEmailSent: "E-Mail gesendet! Überprüfen Sie Ihren Posteingang.",
    toastResetLinkMaybeSent: "Falls ein Konto mit dieser E-Mail existiert, wurde ein Link gesendet.",
    toastGpsNotSupported: "GPS nicht unterstützt",
    toastGpsUnavailable: "GPS-Position nicht verfügbar",
    toastLoginToPublish: "Melden Sie sich an, um zu veröffentlichen",
    toastFillRequiredFields: "Bitte Pflichtfelder ausfüllen",
    toastSomePhotosFailed: "{count} Foto(s) konnten nicht hochgeladen werden (instabiles Netzwerk?), der Rest der Anzeige wurde trotzdem veröffentlicht.",
    toastListingUpdated: "Anzeige aktualisiert!",
    toastJobPublished: "Job erfolgreich veröffentlicht!",
    toastPublishError: "Fehler bei der Veröffentlichung",
    toastGpsRequiredPublish: "GPS erforderlich zum Veröffentlichen",
    toastFilesWrongType: "{count} Datei(en) ignoriert: nicht unterstütztes Format (nur JPG, PNG, WEBP oder GIF)",
    toastFilesTooBig: "{count} Foto(s) ignoriert: über {max} MB",
    toastGpsRequired: "GPS-Position erforderlich",
    toastMapViewOn: "Kartenansicht aktiviert",
    toastSatelliteViewOn: "Satellitenansicht aktiviert",
    toastFilterCategoryHint: "Oben nach Kategorie filtern",
    toastLoginToReport: "Melden Sie sich an, um eine Anzeige zu melden.",
    toastReportSent: "Meldung gesendet, danke.",
    toastAlreadyReported: "Sie haben diese Anzeige bereits gemeldet.",
    toastSendErrorRetry: "Fehler beim Senden, bitte erneut versuchen.",
    toastAdminOnly: "Zugang nur für Administratoren",
    toastErrorRetry: "Fehler, bitte erneut versuchen.",
    toastJobDeleted: "Job gelöscht.",
    toastCodeGenerated: "Code erstellt und WhatsApp zum Versenden geöffnet!",
    toastNoWhatsAppNumber: "Keine WhatsApp-Nummer für dieses Profil registriert. Code manuell mitteilen: {code}",
    toastValidationError: "Fehler bei der Validierung",
    toastRequestRejected: "Anfrage abgelehnt",
    toastGenericError: "Fehler",
    toastDeleteError: "Fehler beim Löschen",
    toastPleaseLogin: "Bitte anmelden",
    toastNoListingsFound: "Keine Anzeigen gefunden",
    toastYouHaveListings: "Sie haben {count} Anzeige(n)",
    toastPrefNotSaved: "Einstellung nicht gespeichert (instabiles Netzwerk?), bitte erneut versuchen.",
    toastWriteDescFirst: "Schreiben Sie zuerst eine kurze Beschreibung, bevor Sie die KI nutzen.",
    toastAiUnavailable: "Die KI ist derzeit nicht verfügbar, bitte später erneut versuchen.",
    toastDescImproved: "Beschreibung verbessert!",
    toastAiConnectionError: "KI kann nicht erreicht werden. Überprüfen Sie Ihre Verbindung.",
    toastFillSkillsFirst: "Geben Sie zuerst Ihre Fähigkeiten ein, bevor Sie die KI nutzen.",
    toastProfileOptimized: "Profil optimiert!",
    toastFillTitleOrDescFirst: "Geben Sie zuerst einen Titel oder eine Beschreibung ein, bevor Sie einen Preis anfordern.",
    toastPriceApplied: "Preis übernommen",
    toastNothingToAnalyze: "Bei dieser Anzeige gibt es nichts zu analysieren.",
    toastNewJobPublished: "🎉 Neuer Job: {title} ({location}) wurde gerade veröffentlicht!",
    toastPositionSavedComplete: "Position gespeichert! Formular vervollständigen.",
    toastPositionSavedFill: "Position gespeichert! Job-Formular ausfüllen.",
    toastCantEditOthers: "Sie können nur Ihre eigenen Anzeigen bearbeiten",
    toastEditFieldsThenValidate: "Felder bearbeiten und dann bestätigen",
    toastCantDeleteOthers: "Sie können nur Ihre eigenen Anzeigen löschen",
    toastListingDeleted: "Anzeige gelöscht",
    toastLoginToEditProfile: "Melden Sie sich an, um Ihr Profil zu bearbeiten",
    toastInvalidPhoto: "Ungültiges Foto: JPG/PNG/WEBP, max. {max} MB.",
    toastLinkCopied: "Link kopiert!",
    toastCopyFailed: "Kopieren nicht möglich",
    toastNoCreditsAvailable: "Keine Guthaben verfügbar",
    toastBoostedSeven: "Anzeige für 7 Tage hervorgehoben!",
    toastBoostError: "Fehler beim Hervorheben",
    toastNeedIdAndSelfie: "Fügen Sie ein Foto Ihres Ausweises UND ein Selfie hinzu, bevor Sie senden.",
    toastNeedValidWhatsApp: "Geben Sie eine gültige WhatsApp-Nummer ein (z.B.: +237650420710), um Ihren Code zu erhalten.",
    toastRequestSent: "Anfrage gesendet!",
    toastPhotoSendError: "Fehler beim Senden der Fotos",
    toastCodeMustBe7Digits: "Der Code muss genau 7 Ziffern enthalten.",
    toastNoCodePending: "Kein ausstehender Code für dieses Profil.",
    toastWrongCode: "Falscher Code, bitte erneut versuchen.",
    toastProfileVerified: "Profil verifiziert!",
    toastCodeVerifyError: "Fehler bei der Code-Überprüfung",
    toastPhotoUploadError: "Fehler beim Hochladen des Fotos (instabiles Netzwerk?), bitte erneut versuchen.",
    toastWhatsAppOpenError: "Fehler beim Öffnen von WhatsApp. Bitte erneut versuchen.",
    toastWhatsAppOpened: "WhatsApp geöffnet!",
    toastSharedWhatsApp: "Auf WhatsApp geteilt!",
    toastChooseRatingFirst: "Wählen Sie eine Bewertung, bevor Sie senden",
    toastReviewThanks: "Vielen Dank für Ihre Bewertung!",
    toastReviewSendError: "Fehler beim Senden der Bewertung",
    toastEnableLocationForDistance: "Aktivieren Sie Ihren Standort, um nach Entfernung zu filtern",
    reviewsTitle: "Bewertungen",
    reviewsNoneYet: "Noch keine Bewertungen für diesen Anbieter.",
    reviewsCountWord: "Bewertungen",
    reviewsLoading: "Bewertungen werden geladen...",
    reviewsContactFirst: "Kontaktieren Sie diesen Anbieter über WhatsApp, um später eine Bewertung abgeben zu können.",
    reviewsAlreadyDone: "✓ Sie haben bereits eine Bewertung für diesen Austausch abgegeben.",
    reviewsProviderFallback: "diesen Anbieter",
    reviewsLeaveBtn: "⭐ Bewertung abgeben",
    reviewsJobFallback: "diese Anfrage",
    reviewPromptQuestion: "Wie ist es gelaufen?",
    reviewPromptWith: "Mit {name} für “{title}”",
    reviewCommentPlaceholder: "Kommentar (optional)",
    reviewSendBtn: "Senden",
    reviewSending: "Wird gesendet...",
    searchJobPlaceholder: "Job suchen (z.B.: Klempner, Reinigung...)",
    verifyCodePlaceholder: "7-stelliger Code",
    companyNamePlaceholder: "Z.B.: Die Bauherren Kameruns",
    phoneValidTitle: "Gültige Telefonnummer, z.B.: 6XX XXX XXX",
    whatsappVerifiedTitle: "Nummer über WhatsApp verifiziert",
    emailVerifiedTitle: "E-Mail verifiziert",
    verifiedBadgeLabel: "Verifiziert",
    closeAriaLabel: "Schließen",
    backAriaLabel: "Zurück",
    faqAriaLabel: "Häufig gestellte Fragen",
    altSelfieSubmitted: "Verifizierungs-Selfie eingereicht",
    altIdSubmitted: "Ausweisdokument eingereicht",
    altDocumentPreview: "Vorschau des ausgewählten Dokuments",
    altJobPhoto: "Anzeigenfoto",
    altProfilePhotoPreview: "Vorschau des Profilfotos",
    altGeneratedAvatar: "Aus dem Namen generierter Avatar",
    altSelectedPhotoPreview: "Vorschau des ausgewählten Fotos",
    altProfilePhoto: "Profilfoto"
  },
  zh: {
    reviewRateLimited: "您近期已评价过该服务者 — 稍后可再次评价。",
    toastPaymentPending: "已收到付款,正在激活...",
    toastLoginToPay: "请先登录再付款。",
    toastOpeningPayment: "正在打开支付...",
    toastPaymentFailed: "支付无法启动,请重试。",
    payProTitle: "⭐ 升级为 PRO",
    payProDesc: "排名更靠前、发布不限量、金色徽章和统计数据。",
    payProButton: "升级 Pro — 1500 FCFA / 月",
    payVerifiedButton: "✅ 身份认证徽章 — 500 FCFA",
    payBoostButton: "🚀 3 次置顶套餐 — 500 FCFA",
    emptyStateNoJobs: "未找到工作",
    settingsNotifications: "通知", settingsManageNotifications: "管理偏好设置",
    saveLabel: "收藏", savedLabel: "已收藏", jobSavedToast: "已收藏该信息!", jobUnsavedToast: "已从收藏中移除", filterAllJobs: "全部", filterSavedJobs: "已收藏",
    tipSettings: "设置", settingsTitle: "设置", settingsLanguage: "语言", settingsTheme: "主题", themeDark: "深色", themeLight: "浅色",
    showMoreText: "...显示更多", showLessText: "收起",
    jobModerationBlocked: "发布被拒绝:{reason}", jobModerationBlockedGeneric: "该信息目前无法发布,请修改后重试。",
    resultsPlural: "个结果", resultSingular: "个结果", searchIntentPrefix: "未找到精确匹配。您是否想搜索:", mapViewActivated: "已切换到地图视图", satelliteViewActivated: "已切换到卫星视图", activateLocationForRadius: "请开启定位以按距离筛选",
    btnSuggestCategory: "✨ 建议分类", aiCategoryMinLength: "请先输入标题或描述,然后再使用AI。", aiCategoryLoading: "✨ 分析中...", aiCategorySuggested: "建议分类:{category}",
    whatsappOpenedSuccess: "WhatsApp已打开!",
    shareOnWhatsappBtn: "🔄 分享到WhatsApp", viewRouteBtn: "查看路线", jobNotFoundAlert: "未找到该工作", errorPrefix: "错误:", sharedOnWhatsapp: "已分享到WhatsApp!",
    jobUpdated: "信息已更新!", jobPublished: "工作发布成功!",
    // ===== Cles ajoutees pour la traduction automatique des annonces =====
    jobTranslatedNotice: "🌐 自动翻译", viewOriginalText: "查看原文", viewTranslationText: "查看译文",
    translatingInProgress: "翻译中...",
    // ===== Nouvelles cles ajoutees (audit traduction complet) =====
    btnImproveDesc: "✨ 用AI优化", btnSuggestPrice: "💡 建议价格", btnOptimizeProfile: "✨ 用AI优化资料",
    btnScamCheck: "🛡️ 分析风险信号", aiImproveMinLength: "请先输入简短描述,然后再使用AI。", aiImproveLoading: "✨ 优化中...",
    aiImproveSuccess: "描述已优化!", aiUnavailable: "AI暂时不可用,请稍后再试。", aiConnectionError: "无法连接AI。请检查您的网络连接。",
    aiOptimizeMinLength: "请先填写您的技能,然后再使用AI。", aiOptimizeLoading: "✨ 优化中...", aiOptimizeSuccess: "资料已优化!",
    aiPriceMinLength: "请先填写标题或描述,然后再请求价格建议。", aiPriceLoading: "💡 计算中...", aiPriceEstimateLabel: "💡 估算:", aiPriceUseEstimation: "使用此估算",
    aiPriceApplied: "价格已应用", aiScamNothingToAnalyze: "此信息暂无可分析内容。", aiScamLoading: "🛡️ 分析中...",
    aiScamDisclaimer: "此为文本自动分析结果,并非证据 — 请保持警惕,在提前付款前务必核实。", splashSubtitle: "身边的专业工匠", langModalTitle: "选择您的语言",
    offlineBannerText: "无网络连接 — 部分操作可能无法完成",
    shareNewJobTitle: "发布成功！", shareNewJobBody: "现在就分享到WhatsApp，在最初几分钟触达更多人。", shareNewJobBtn: "分享到WhatsApp",
    copyLinkBtn: "复制链接", linkCopied: "链接已复制！", copyLinkFailed: "无法复制链接",
    markAsFilled: "标记为已完成", markAsOpenAgain: "重新开放", filledBadgeLabel: "已完成",
    toastMarkedFilled: "已标记为完成——不再公开显示。", toastMarkedOpenAgain: "已重新开放——再次可见。",
    onbSkip: "跳过", onbNext: "下一步", onbStart: "开始使用",
    onbTitle1: "寻找您附近的专业人士", onbBody1: "浏览地图,发现您周围合格的工匠,查看他们的评分和距离。",
    onbTitle2: "几秒钟内发布您的需求", onbBody2: "点击 + 按钮描述您的需求,附近的服务商会立即收到通知。",
    onbTitle3: "放心联系", onbBody3: "查看评价和认证徽章,然后通过应用内的安全聊天直接交流。",
    emptyZoneSub: "成为此区域首个发布工作的人", adminNoDocWarning: "⚠️ 应用内未上传任何文件 — 请通过WhatsApp核实", noNewJobsYet: "暂无新的工作机会",
    positionSelectedLabel: "📍 已选定位置", loadingWhatsappContacts: "正在加载WhatsApp联系人...", interestedPeopleTitle: "感兴趣的人",
    noContactYet: "目前还没有人就此需求联系您。", yourWhatsappNumberLabel: "您的WhatsApp号码", whatsappNumberHint: "您将在此号码上收到7位数验证码。",
    idPhotoHint: "📄 身份证件照片(身份证、护照等)", tapToAddPhoto: "点击添加照片", selfieHint: "🤳 手持同一证件贴近面部的自拍照",
    tapToAddSelfie: "点击添加自拍照", noReviewsYet: "该服务者暂无评价。", loadingReviews: "正在加载评价...",
    reviewsLoadError: "评价加载出错。", contactBeforeReview: "请先通过WhatsApp联系该服务者,之后才能留下评价。", alreadyReviewed: "✓ 您已针对此次交流留下评价。",
    reviewModalTitle: "体验如何?", prefSaveError: "偏好设置未保存(网络不稳定?),请重试。", welcomeBack: "欢迎回来!",
    welcomeUser: "欢迎 {name}", someUploadsFailed: "{n}张照片上传失败(网络不稳定?),但信息的其余部分已成功发布。", rejectedWrongType: "已忽略{n}个文件:格式不支持(仅支持JPG、PNG、WEBP或GIF)",
    rejectedTooBig: "已忽略{n}张照片:超过{mb} MB", noWhatsappManualCode: "该资料未保存WhatsApp号码。请手动告知验证码:{code}", myPublicationsCount: "您有{n}条发布信息",
    newJobToast: "🎉 新工作:{title}({location})刚刚发布!", invalidPhotoFormat: "照片无效:仅支持JPG/PNG/WEBP,最大{mb} MB。", positionSavedComplete: "位置已保存!请填写表单。",
    positionSavedFill: "位置已保存!请填写工作表单。", photoUploadError: "照片上传出错(网络不稳定?),请重试。", whatsappOpenError: "打开WhatsApp时出错,请重试。",
    chooseRatingFirst: "请先选择评分再发送", reviewSendError: "评价发送失败", mustBeLoggedIn: "您必须先登录。",
    fillNameAndJob: "请填写您的姓名/公司名称及职业/专长。", profileSavedSuccess: "专业资料保存成功!", genericError: "发生了错误。",
    mustBeLoggedInWhatsapp: "您必须先登录才能在WhatsApp上发送消息。", mustCompleteProfileContact: "您必须先完善资料(姓名/公司名称及职业/专长)才能联系此人。", phoneUnavailable: "电话号码不可用。",
    cannotComputeRoute: "没有您的位置信息,无法计算路线。",
    notifTitle: "新工作", publishBtn: "发布",
    catAll: "全部", catBtp: "建筑", catElec: "电工", catPlomberie: "水管",
    navMap: "地图", navList: "列表", navSearch: "搜索", navAccount: "账户",
    waMsgReferral: "加入我在JobMarket Cameroon,寻找或提供您附近的服务:{link}",
    waMsgShareJob: "🔊 *新工作机会*\n\n*{title}*\n{desc}{requirements}\n\n💰 报酬：{price} XAF\n📍 地点：{location}\n📞 联系方式：{phone}\n\n详情请点击：{link}",
    waMsgRequirementsLabel: "📋 *要求：*",
    waMsgOrConnector: " 或 ",
    waMsgContactProvider: "您好,我通过JobMarket联系您,关于:\"{jobTitle}\"。\n\n--- 服务商资料 ---\n姓名/公司:{profileName}\n职业:{proTitle}\n技能:{proSkills}\n\n请问这个还可以预约吗?",
    catMenage: "清洁", catJardinage: "园艺", catMecanique: "机械", catInfo: "信息技术",
    tipLocate: "我的位置", tipZoomIn: "放大", tipZoomOut: "缩小", tipMapStyle: "地图样式",
    tipLang: "语言", tipSearch: "搜索", tipNotifications: "通知", tipMessages: "消息", tipClose: "关闭",
    distanceLabel: "距离", itinLabel: "路线", calculating: "计算中...", cancelBtn: "取消",
    publishTitle: "发布工作", fieldCategory: "类别",
    optBtp: "建筑/泥瓦", optElec: "电工", optPlomberie: "水管工", optMenage: "清洁",
    optJardinage: "园艺", optMecanique: "汽车机械", optInfo: "信息技术服务",
    fieldTitle: "工作标题", phTitle: "例:浴室瓷砖铺设",
    fieldDesc: "描述", phDesc: "描述需要完成的工作...",
    fieldRequirements: "要求（选填）", phRequirements: "例：守时、至少2年经验、自备工具...", requirementsLabel: "要求",
    fieldPrice: "价格 (XAF)", phPrice: "例:15,000 XAF",
    fieldPhone: "电话", fieldPhone2: "第二个号码（选填）", fieldLandmark: "地标/街区", phLandmark: "例:巴斯托斯,环岛附近...",
    fieldPhotos: "照片(最多5张)", uploadTitle: "添加照片",
    uploadSub: "JPG, PNG, WEBP — 最多5张图片,每张8MB", publishNow: "立即发布",
    jobsNearby: "附近的工作", emptyTitle: "未找到工作", emptySub: "在该区域发布第一份工作",
    myAccount: "我的账户", userFallback: "用户", notConnected: "未登录", profileIncomplete: "个人资料不完整",
    tabSignup: "创建账户", tabLogin: "登录", fieldPassword: "密码", phPassword: "至少8个字符",
    createAccountBtn: "创建我的账户", loginBtn: "登录", forgotPassword: "忘记密码?", orWord: "或", continueGoogle: "使用Google继续",
    adminDashboard: "管理员面板", secureChat: "安全聊天", myListings: "我的发布", myProProfile: "我的专业资料",
    notifPrefsTitle: "通知", notifPrefsIntro: "选择您希望收到新发布通知的类别。取消勾选与您无关的类别。",
    notifPrimerTitle: "不再错过任何工作机会", notifPrimerBody: "您所在分类附近一有新工作发布，立即通知您。",
    notifPrimerLater: "以后再说", notifPrimerEnable: "开启提醒",
    installPromptTitle: "将应用安装到手机", installPromptBody: "从主屏幕直接打开，像真正的应用一样更快捷。", installPromptInstall: "安装",
    boostExpiryTitle: "你的置顶推广即将到期", boostExpiryBody: "\"{title}\" 大约 {hours} 小时后将回落排名。", boostExpiryRenewBtn: "续期(1个额度)",
    notifBlockedTip: "通知已被屏蔽。请在浏览器设置中开启通知，以免错过新工作。",
    notifDistanceLabel: "最大距离", notifDistanceHint: "只有在此范围内的工作机会才会通知您（需要开启定位）。",
    notifGpsNudgeTitle: "定位未开启", notifGpsNudgeBody: "开启定位后，下面的距离筛选才能真正生效。", notifGpsNudgeBtn: "开启",
    logout: "退出登录", artisanProfile: "服务商资料",
    descNeed: "需求描述:", editListing: "编辑发布", deleteListing: "删除发布",
    shareWhatsApp: "在WhatsApp上分享", seeItinerary: "查看路线",
    photoWord: "照片", changePhoto: "更换照片", fieldNameCompany: "姓名/公司", phName: "例:张三 或 张三公司",
    fieldCompany: "公司", fieldJobTitle: "您的职业/专长", phJobTitle: "例:电工,泥瓦匠,设计师...",
    fieldSkills: "技能(用逗号分隔)", phSkills: "例:电表安装,紧急维修,布线...",
    saveChanges: "保存更改",
    emailVerified: "邮箱已验证", emailNotVerified: "邮箱未验证 — 请点击注册时收到的邮件链接。",
    profileVerified: "资料已验证", requestSent: "⏳ 申请已发送,等待审核。",
    profileNotVerified: "资料未验证。身份证件或职业证明可解锁 ✓ 徽章。",
    requestVerificationBtn: "申请验证",
    referralProgram: "推荐计划",
    referralExplain: "用您的链接邀请服务商/客户。每3次注册,您将解锁一次为期7天的免费推广,用于您的一条发布。",
    copyBtn: "复制", referralCountText: "已有{count}位受邀者注册 — 还差{next}位即可获得下一个额度。",
    creditsAvailable: "可用推广额度:{credits}个", publishToBoost: "发布一条信息后才能进行推广。",
    activeBoost: "生效中", boostBtn: "推广",
    chatPanelTitle: "安全助手", chatOfflineBadge: "离线·私密",
    chatWelcomeMsg: "您好!我可以帮助您使用 JobMarket、发布需求、寻找工匠、了解价格并识别欺诈信号。我的回复只保存在本设备上。",
    chatSuggestion1: "如何发布工作?", chatSuggestion2: "如何避免诈骗?",
    chatSuggestion3: "如何计算我的利润?", chatSuggestion4: "如何管理我的发布?",
    chatSafetyNotice: "没有AI密钥,不会向外部模型发送任何消息。切勿在聊天中分享密码、短信验证码、银行卡或身份证件。",
    chatInputPlaceholder: "您的消息...",
    adminBadge: "管理员", adminStatJobsTotal: "工作总数", adminStatUsers: "用户",
    adminStatToday: "今日发布", adminStatCountry: "活跃国家", adminStatNotifOpenRate: "通知打开率（7天）", adminStatContactsWeek: "WhatsApp联系（7天）", adminStatReviewsWeek: "已留评价（7天）", adminStatSignupsWeek: "注册数（7天）", adminStatBoostsWeek: "已用推广（7天）", adminStatSearchesWeek: "搜索次数（7天）",
    adminVerificationsTitle: "待处理的验证", adminAllJobsTitle: "所有工作",
    adminLoading: "加载中...", adminNoPending: "没有待处理的申请。",
    reportLink: "举报此招聘信息", reportModalTitle: "举报此招聘信息",
    reportModalIntro: "为团队提供有用的信号：请描述您认为有问题的地方。滥用举报可追溯到您的账户。",
    reportReasonLabel: "原因", reportReasonFraud: "疑似诈骗", reportReasonInappropriate: "内容不当",
    reportReasonMisleading: "价格或描述误导", reportReasonDuplicate: "重复发布/垃圾信息", reportReasonOther: "其他",
    reportCommentLabel: "详情（选填）", phReportComment: "简要说明问题...", reportSubmitBtn: "提交举报",
    adminReportsTitle: "待处理举报", adminNoReports: "没有待处理的举报。", adminJobDeleted: "工作已删除",
    adminDismissReport: "忽略", adminDeleteJob: "删除工作", adminConfirmDeleteJob: "确定永久删除此工作吗？",
    adminLoadError: "加载错误。",
    adminNoName: "无名称", adminNoJobTitle: "职业未填写",
    adminApprove: "批准 ✓", adminReject: "拒绝", adminAnonymous: "匿名", adminDeleteBtn: "删除",
    btnUseEstimate: "使用此估算",
    scamAutoAnalysisNote: "此为文本自动分析，并非证据——请保持警惕，在提前付款前进行核实。",
    priceEstimateLabel: "💡 估算：",
    toastFillAllFields: "请填写所有字段",
    toastAccountCreated: "账户已创建！请检查您的邮箱。",
    toastWelcomeBack: "欢迎回来！",
    toastWelcomeName: "欢迎 {name}",
    toastLoggedOut: "已退出登录",
    toastEnterEmailFirst: "请先输入您的邮箱，然后点击链接",
    toastEmailSent: "邮件已发送！请查看您的收件箱。",
    toastResetLinkMaybeSent: "如果该邮箱存在账户，已发送链接。",
    toastGpsNotSupported: "不支持GPS",
    toastGpsUnavailable: "GPS位置不可用",
    toastLoginToPublish: "登录后即可发布",
    toastFillRequiredFields: "请填写必填字段",
    toastSomePhotosFailed: "{count} 张照片上传失败（网络不稳定？），其余信息已成功发布。",
    toastListingUpdated: "信息已更新！",
    toastJobPublished: "工作发布成功！",
    toastPublishError: "发布时出错",
    toastGpsRequiredPublish: "发布需要GPS",
    toastFilesWrongType: "已忽略 {count} 个文件：格式不支持（仅支持 JPG、PNG、WEBP 或 GIF）",
    toastFilesTooBig: "已忽略 {count} 张照片：超过 {max} MB",
    toastGpsRequired: "需要GPS位置",
    toastMapViewOn: "已启用地图视图",
    toastSatelliteViewOn: "已启用卫星视图",
    toastFilterCategoryHint: "在顶部按类别筛选",
    toastLoginToReport: "登录后即可举报信息。",
    toastReportSent: "举报已发送，谢谢。",
    toastAlreadyReported: "您已经举报过此信息。",
    toastSendErrorRetry: "发送出错，请重试。",
    toastAdminOnly: "仅限管理员访问",
    toastErrorRetry: "出错了，请重试。",
    toastJobDeleted: "工作已删除。",
    toastCodeGenerated: "验证码已生成，WhatsApp已打开以便发送！",
    toastNoWhatsAppNumber: "该资料未注册WhatsApp号码。请手动告知验证码：{code}",
    toastValidationError: "验证时出错",
    toastRequestRejected: "请求已拒绝",
    toastGenericError: "错误",
    toastDeleteError: "删除时出错",
    toastPleaseLogin: "请登录",
    toastNoListingsFound: "未找到发布信息",
    toastYouHaveListings: "您有 {count} 条发布信息",
    toastPrefNotSaved: "偏好设置未保存（网络不稳定？），请重试。",
    toastWriteDescFirst: "使用AI之前请先写一段简短描述。",
    toastAiUnavailable: "AI目前不可用，请稍后重试。",
    toastDescImproved: "描述已优化！",
    toastAiConnectionError: "无法连接AI，请检查网络连接。",
    toastFillSkillsFirst: "使用AI之前请先填写您的技能。",
    toastProfileOptimized: "资料已优化！",
    toastFillTitleOrDescFirst: "请求价格之前请先填写标题或描述。",
    toastPriceApplied: "价格已应用",
    toastNothingToAnalyze: "此信息没有可分析的内容。",
    toastNewJobPublished: "🎉 新工作：{title}（{location}）刚刚发布！",
    toastPositionSavedComplete: "位置已保存！请填写表格。",
    toastPositionSavedFill: "位置已保存！请填写工作表单。",
    toastCantEditOthers: "您只能编辑自己发布的信息",
    toastEditFieldsThenValidate: "修改字段后确认",
    toastCantDeleteOthers: "您只能删除自己发布的信息",
    toastListingDeleted: "信息已删除",
    toastLoginToEditProfile: "登录后即可编辑您的资料",
    toastInvalidPhoto: "照片无效：仅支持JPG/PNG/WEBP，最大 {max} MB。",
    toastLinkCopied: "链接已复制！",
    toastCopyFailed: "无法复制",
    toastNoCreditsAvailable: "没有可用额度",
    toastBoostedSeven: "信息已置顶推广7天！",
    toastBoostError: "推广时出错",
    toastNeedIdAndSelfie: "发送前请添加身份证照片和自拍照。",
    toastNeedValidWhatsApp: "请输入有效的WhatsApp号码（例如：+237650420710）以接收验证码。",
    toastRequestSent: "请求已发送！",
    toastPhotoSendError: "发送照片时出错",
    toastCodeMustBe7Digits: "验证码必须为7位数字。",
    toastNoCodePending: "该资料没有待验证的代码。",
    toastWrongCode: "验证码错误，请重试。",
    toastProfileVerified: "资料已验证！",
    toastCodeVerifyError: "验证代码时出错",
    toastPhotoUploadError: "上传照片时出错（网络不稳定？），请重试。",
    toastWhatsAppOpenError: "打开WhatsApp时出错，请重试。",
    toastWhatsAppOpened: "WhatsApp已打开！",
    toastSharedWhatsApp: "已分享到WhatsApp！",
    toastChooseRatingFirst: "发送前请先选择评分",
    toastReviewThanks: "感谢您的评价！",
    toastReviewSendError: "发送评价时出错",
    toastEnableLocationForDistance: "启用定位以按距离筛选",
    reviewsTitle: "评价",
    reviewsNoneYet: "该服务商暂无评价。",
    reviewsCountWord: "条评价",
    reviewsLoading: "正在加载评价...",
    reviewsContactFirst: "请通过WhatsApp联系该服务商，之后才能留下评价。",
    reviewsAlreadyDone: "✓ 您已经为此次交流留下过评价。",
    reviewsProviderFallback: "该服务商",
    reviewsLeaveBtn: "⭐ 留下评价",
    reviewsJobFallback: "此需求",
    reviewPromptQuestion: "进展如何？",
    reviewPromptWith: "与{name}就“{title}”",
    reviewCommentPlaceholder: "评论（选填）",
    reviewSendBtn: "发送",
    reviewSending: "发送中...",
    searchJobPlaceholder: "搜索工作（例如：水管工、清洁...）",
    verifyCodePlaceholder: "7位数字验证码",
    companyNamePlaceholder: "例如：喀麦隆建筑者",
    phoneValidTitle: "有效电话号码，例如：6XX XXX XXX",
    whatsappVerifiedTitle: "已通过WhatsApp验证号码",
    emailVerifiedTitle: "邮箱已验证",
    verifiedBadgeLabel: "已认证",
    closeAriaLabel: "关闭",
    backAriaLabel: "返回",
    faqAriaLabel: "常见问题",
    altSelfieSubmitted: "已提交验证自拍照",
    altIdSubmitted: "已提交身份证件",
    altDocumentPreview: "所选文件预览",
    altJobPhoto: "信息照片",
    altProfilePhotoPreview: "头像预览",
    altGeneratedAvatar: "根据姓名生成的头像",
    altSelectedPhotoPreview: "所选照片预览",
    altProfilePhoto: "头像"
  }
};

let currentLang = localStorage.getItem('appLang') || (navigator.language && navigator.language.startsWith('en') ? 'en' : 'fr');

function t(key) {
  return (I18N[currentLang] && I18N[currentLang][key]) || (I18N.fr && I18N.fr[key]) || key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const text = t(el.getAttribute('data-i18n-title'));
    el.title = text;
    // Un bouton avec seulement une icône (pas de texte visible) n'a rien à
    // annoncer pour un lecteur d'écran sans ça — le title seul n'est pas
    // fiable partout (souvent ignoré au clavier/tactile). On réutilise le
    // même texte traduit comme nom accessible.
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);
  });
  document.documentElement.lang = currentLang || 'fr'; // pour que les lecteurs d'écran prononcent le contenu dans la bonne langue, pas seulement l'affichage
}

function toggleLangMenu() {
  const menu = document.getElementById('langMenu');
  if (menu) menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
}

function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('appLang', lang);
  localStorage.setItem('appLangChosen', '1');
  applyTranslations();
  if (typeof currentUser !== 'undefined' && currentUser && !currentUser.isAnonymous && typeof syncLangToProfile === 'function') {
    syncLangToProfile(currentUser.uid);
  }
  const menu = document.getElementById('langMenu');
  if (menu) menu.style.display = 'none';
  const picker = document.getElementById('langPicker');
  if (picker) picker.style.display = 'none';
  if (typeof maybeShowOnboarding === 'function') maybeShowOnboarding();
  // Ré-affiche les listes/dynamiques dont le texte dépend de la langue (catégories, etc.)
  if (typeof allJobs !== 'undefined' && typeof updateJobsList === 'function') updateJobsList(allJobs);
  // Les popups de la carte déjà créés ne se régénèrent jamais tout seuls
  // (Leaflet ne les reconstruit pas automatiquement) — sans ceci, une
  // annonce déjà affichée restait figée dans l'ancienne langue.
  if (typeof refreshAllPopupsLanguage === 'function') refreshAllPopupsLanguage();
}

// Ferme les panneaux Paramètres/Notifications si on clique ailleurs sur la page
document.addEventListener('click', function(e) {
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsPanel && settingsPanel.style.display === 'block' && !settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
    settingsPanel.style.display = 'none';
  }
  const notifPanel = document.getElementById('notifPanel');
  const notifBtn = document.getElementById('notifBtn');
  if (notifPanel && notifPanel.style.display === 'block' && !notifPanel.contains(e.target) && e.target !== notifBtn && !notifBtn.contains(e.target)) {
    notifPanel.style.display = 'none';
  }
});

// ===== PARTAGE & LIENS PROFONDS =====
const APP_BASE_URL = 'https://ghislaintankat-cyber.github.io/Jobmarket-cameroon/';

// Relais "notif instantanée" (voir worker/index.js) : appelé juste après la
// publication d'un nouveau job pour déclencher le workflow GitHub Actions
// immédiatement, sans attendre le cron de secours (15 min). Best-effort
// uniquement — si le relais est indisponible, le cron prend simplement le
// relais un peu plus tard, aucune notification n'est perdue.
// ⚠️ À REMPLACER après avoir déployé le worker (voir worker/wrangler.toml) :
const NOTIFY_TRIGGER_URL = 'https://jobmarket-notify-trigger.ghislaintankat.workers.dev';
const NOTIFY_TRIGGER_SECRET = 'a8f3k29dQmZp71xR9kLm'; // doit être IDENTIQUE au secret TRIGGER_SECRET du worker

function triggerInstantNotify(eventType) {
  try {
    fetch(NOTIFY_TRIGGER_URL, {
      method: 'POST',
      headers: { 'X-Trigger-Secret': NOTIFY_TRIGGER_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: eventType || 'new-job' })
    }).catch(() => {}); // silencieux : le cron de secours couvre déjà ce cas
  } catch (e) { /* idem */ }
}

// URL du worker d'aperçu de partage (voir worker/share-preview.js) : sert
// un aperçu Open Graph spécifique au job aux robots (WhatsApp, Facebook...),
// et redirige les vraies personnes directement vers l'app. Nécessaire car
// index.html est une SPA sans serveur : impossible de faire varier les
// balises og:* par job directement dans la page.
const SHARE_PREVIEW_URL = 'https://jobmarket-share.ghislaintankat.workers.dev';

// Recalcul serveur de la note moyenne d'un prestataire (voir
// worker/rating-sync.js) : le client ne peut plus écrire ratingAvg/
// ratingCount lui-même (voir database.rules.json — ces deux champs sont
// réservés aux admins), pour empêcher quiconque de forger une note
// flatteuse ou de saboter celle d'un concurrent. Ce worker relit tous les
// avis réels du prestataire et écrit la moyenne exacte avec des privilèges
// admin. Appelé juste après l'ajout d'un nouvel avis — non bloquant : si
// l'appel échoue, l'avis est déjà enregistré, seule la moyenne affichée
// restera temporairement en retard d'un avis (elle se corrigera au
// prochain avis soumis avec succès).
const RATING_SYNC_URL = 'https://jobmarket-rating-sync.ghislaintankat.workers.dev';

// URL du worker d'activation de boost (voir worker/activate-boost.js) : le
// client ne peut plus écrire jobs/{id}/boosted ni boostedUntil lui-même
// (voir database.rules.json — réservés aux admins) ni faire confiance à un
// update() multi-chemins pour lier ça à la dépense d'un crédit, puisque les
// règles Firebase valident chaque champ indépendamment. Ce worker vérifie
// le vrai ID token de l'utilisateur, relit son solde de crédits réel, et
// écrit boosted+boostedUntil+boostCredits ensemble avec des privilèges
// admin — remplace à toi seul l'ancienne logique de useBoostCredit().
// IMPORTANT : à remplacer par l'URL réelle une fois le worker déployé.
const BOOST_ACTIVATE_URL = 'https://jobmarket-activate-boost.ghislaintankat.workers.dev';
// URL du worker de paiement NotchPay (abonnement Pro, badge vérifié, pack boosts)
const PAYMENT_URL = 'https://jobmarket-payment.ghislaintankat.workers.dev';
// URL du worker de soumission d'avis (voir worker/submit-review.js) : le
// client ne peut plus écrire reviews/ lui-même (réservé aux admins/workers
// dans database.rules.json) — ce worker vérifie le vrai ID token, le
// contact réel associé, et applique un délai anti-abus par prestataire.
const SUBMIT_REVIEW_URL = 'https://jobmarket-submit-review.ghislaintankat.workers.dev';

function syncOwnerRating(jobOwnerUid) {
  try {
    fetch(RATING_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobOwnerUid })
    }).catch(() => {}); // silencieux : voir commentaire ci-dessus
  } catch (e) { /* idem */ }
}

// ===== Traduction automatique des annonces (voir worker/translate-job.js) =====
//
// Une annonce publiée dans une langue reste lisible pour tout le monde :
// si le lecteur a choisi une autre langue que celle d'origine de
// l'annonce, on la traduit à la volée (via Llama/Groq), puis on met le
// résultat en cache dans Firebase (jobs/{id}/translations/{lang}) pour que
// les visiteurs suivants n'aient plus jamais besoin de re-traduire la
// même annonce dans la même langue — l'IA n'est donc appelée qu'une seule
// fois par annonce et par langue, jamais à chaque vue.
const TRANSLATE_WORKER_URL = 'https://jobmarket-translate-job.ghislaintankat.workers.dev';

async function getTranslatedJobContent(job, jobId) {
  const sourceLang = job.lang || 'fr'; // annonces publiées avant l'ajout de ce champ : on suppose fr
  if (currentLang === sourceLang) return null; // déjà dans la bonne langue, rien à faire

  if (job.translations && job.translations[currentLang]) {
    return job.translations[currentLang]; // déjà en cache, aucun appel IA nécessaire
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(TRANSLATE_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: job.title || '',
        desc: job.desc || '',
        requirements: job.requirements || '',
        targetLang: currentLang
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.fallback || typeof data.title !== 'string' || typeof data.desc !== 'string') return null;

    const translation = { title: data.title, desc: data.desc, requirements: data.requirements || '' };

    // Mise en cache best-effort : si l'écriture échoue (règle Firebase, réseau...),
    // on affiche quand même la traduction pour CETTE visite, tant pis pour le cache.
    db.ref(`jobs/${jobId}/translations/${currentLang}`).set(translation).catch(() => {});
    if (!job.translations) job.translations = {};
    job.translations[currentLang] = translation;

    return translation;
  } catch (err) {
    return null; // silencieux : on retombe sur le texte original, jamais d'erreur visible ici
  }
}

// Version SYNCHRONE, cache uniquement (jamais d'appel réseau) : à utiliser
// dans les gestionnaires de clic qui doivent rester synchrones (ex: ouvrir
// WhatsApp) — un `await` avant `window.open()` ferait bloquer la popup par
// le navigateur sur mobile/Safari, car le "geste utilisateur" serait perdu
// pendant l'attente. Si la traduction n'est pas encore en cache, on
// retombe simplement sur le texte original — pas de traduction à la volée
// ici, seulement quand le popup/carte l'a déjà pré-chargée.
function getJobDisplayContent(job) {
  const sourceLang = job.lang || 'fr';
  if (currentLang !== sourceLang && job.translations && job.translations[currentLang]) {
    return job.translations[currentLang];
  }
  return { title: job.title || '', desc: job.desc || '', requirements: job.requirements || '' };
}

// Traduction paresseuse du popup carte : ne se déclenche qu'à l'OUVERTURE
// réelle du popup par l'utilisateur (pas au chargement de la carte), pour
// ne jamais lancer des dizaines d'appels IA d'un coup pour des annonces
// que personne ne regarde. Le contenu original s'affiche immédiatement à
// l'ouverture, la traduction (cache ou IA) le remplace dès qu'elle arrive.
async function translateMapPopupIfNeeded(job, jobId, marker) {
  const translation = await getTranslatedJobContent(job, jobId);
  if (!translation) return;
  // Le popup a pu être refermé entre-temps — Leaflet ignore silencieusement
  // les mises à jour DOM sur un popup fermé, donc pas besoin de vérifier ici.
  const popupEl = marker.getPopup()?.getElement();
  if (!popupEl) return;
  const titleEl = popupEl.querySelector('[data-map-popup-title]');
  const descEl = popupEl.querySelector('[data-map-popup-desc]');
  const noticeEl = popupEl.querySelector('[data-map-popup-translation-notice]');
  if (titleEl) titleEl.innerText = translation.title;
  if (descEl) descEl.innerText = translation.desc;
  if (noticeEl) {
    noticeEl.style.display = 'block';
    noticeEl.innerText = t('jobTranslatedNotice');
  }
}

// Bouton "...voir plus" du popup carte (style WhatsApp) : bascule entre
// description tronquée à 3 lignes et texte complet, sans jamais recharger
// le popup — juste une classe CSS qui va et vient.
function toggleDescClamp(btn) {
  const descEl = btn.previousElementSibling;
  if (!descEl || !descEl.classList.contains('popup-desc-clamp')) return;
  const expanded = descEl.classList.toggle('expanded');
  btn.textContent = expanded ? t('showLessText') : t('showMoreText');
}

// Bascule "voir l'original" / "voir la traduction" dans le popup d'une annonce.
window.__jobTranslationState = { showingTranslation: false, original: null, translated: null };

function toggleJobTranslation() {
  const state = window.__jobTranslationState;
  state.showingTranslation = !state.showingTranslation;
  const content = state.showingTranslation ? state.translated : state.original;
  if (!content) return;
  const titleEl = document.getElementById('previewTitle');
  const descEl = document.getElementById('previewDescription');
  if (titleEl) titleEl.innerText = content.title || titleEl.innerText;
  if (descEl) descEl.innerText = content.desc || descEl.innerText;
  renderTranslationNotice(state.showingTranslation);
}

function renderTranslationNotice(showingTranslation) {
  const descEl = document.getElementById('previewDescription');
  if (!descEl) return;
  let notice = document.getElementById('previewTranslationNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'previewTranslationNotice';
    notice.style.cssText = 'margin-top:8px;font-size:12px;color:var(--text-dim,#9999BC);display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    descEl.insertAdjacentElement('afterend', notice);
  }
  notice.innerHTML = `<span>${t('jobTranslatedNotice')}</span><button type="button" onclick="toggleJobTranslation()" style="background:none;border:none;color:var(--accent,#25D366);text-decoration:underline;cursor:pointer;font-size:12px;padding:0;">${showingTranslation ? t('viewOriginalText') : t('viewTranslationText')}</button>`;
  notice.style.display = 'flex';
}

function hideTranslationNotice() {
  const notice = document.getElementById('previewTranslationNotice');
  if (notice) notice.style.display = 'none';
}

function getJobShareLink(jobId) {
  return `${SHARE_PREVIEW_URL}/job/${jobId}`;
}

function getReferralLink(uid) {
  return `${APP_BASE_URL}#ref=${uid}`;
}

// Mémorise un éventuel code de parrainage présent dans le lien d'arrivée
// (#ref=UID), pour l'associer au compte au moment de l'inscription.
let deepLinkJobId = null;
let deepLinkFromPush = false; // vient d'un clic sur notif (voir sw.js, src=push) vs un lien WhatsApp partagé
let deepLinkVariant = null; // variante A/B (ou "digest") de la notif cliquée, pour le suivi du taux d'ouverture
let deepLinkThreadId = null; // conversation à ouvrir après connexion (clic sur une notif de message, app fermée)
(function captureIncomingLinks() {
  try {
    const hash = window.location.hash || '';
    const refMatch = hash.match(/ref=([a-zA-Z0-9_-]+)/);
    if (refMatch && refMatch[1]) localStorage.setItem('pendingReferralCode', refMatch[1]);
    const jobMatch = hash.match(/job=([a-zA-Z0-9_-]+)/);
    if (jobMatch && jobMatch[1]) deepLinkJobId = jobMatch[1];
    // Lien profond vers une conversation (clic sur une notif de message quand
    // l'app était fermée) : on mémorise le threadId, ouvert une fois connecté.
    const threadMatch = hash.match(/thread=([^&]+)/);
    if (threadMatch && threadMatch[1]) { try { deepLinkThreadId = decodeURIComponent(threadMatch[1]); } catch(e) { deepLinkThreadId = threadMatch[1]; } }
    if (/[#?&]src=push/.test(hash)) deepLinkFromPush = true;
    const variantMatch = hash.match(/variant=([a-zA-Z0-9_-]+)/);
    if (variantMatch && variantMatch[1]) deepLinkVariant = decodeURIComponent(variantMatch[1]);
  } catch(e) { /* ignore */ }
})();

// Applique le parrainage mémorisé à un nouveau compte : incrémente le
// compteur du parrain et débloque un crédit de mise en avant tous les 3
// filleuls. Ne s'exécute qu'une fois par inscription (isNewUser).
async function applyPendingReferral(newUser) {
  try {
    const refUid = localStorage.getItem('pendingReferralCode');
    if (!refUid || refUid === newUser.uid) return;
    localStorage.removeItem('pendingReferralCode');

    await db.ref('profiles/' + newUser.uid).update({ referredBy: refUid });

    const refSnap = await db.ref('profiles/' + refUid + '/referralCount').transaction(cur => (cur || 0) + 1);
    const newCount = refSnap.snapshot.val();
    if (newCount > 0 && newCount % 3 === 0) {
      await db.ref('profiles/' + refUid + '/boostCredits').transaction(cur => (cur || 0) + 1);
    }
  } catch(e) {
    console.warn('applyPendingReferral error', e);
  }
}

// ===== FIREBASE AUTH =====
// Retour depuis la page de paiement NotchPay (voir la redirection GET
// /webhook du worker jobmarket-payment) : on informe juste la personne que
// c'est en cours de traitement — l'activation réelle (isPro/verified/
// boostCredits) vient du webhook serveur vérifié, qui peut prendre
// quelques secondes à arriver ; profilesCache la reflétera dès que prête,
// sans que la personne ait besoin de recharger la page.
if (new URLSearchParams(window.location.search).get('paid') === '1') {
  // Message de bienvenue après paiement : on remercie et on rassure.
  // L'activation réelle (isPro/verified) arrive via le webhook serveur,
  // en quelques secondes. On rafraîchit le profil un peu plus tard pour
  // que la personne voie son nouveau statut sans recharger.
  setTimeout(() => showToast('🎉 Merci ! Paiement reçu, ton compte s\'active dans quelques secondes...', 'success'), 500);
  const cleanUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, '', cleanUrl);
  // Rafraîchit le profil après 6s (le temps que le webhook active le compte)
  setTimeout(() => {
    try {
      const u = auth.currentUser;
      if (u && !u.isAnonymous && typeof openProfileSheet === 'function') {
        db.ref('profiles/' + u.uid).once('value').then(snap => {
          const p = snap.val() || {};
          if (p.isPro || p.verified) {
            showToast('✅ Ton compte est activé ! Merci de ta confiance. 🙏', 'success');
          }
        }).catch(() => {});
      }
    } catch (_) {}
  }, 6000);
}

auth.onAuthStateChanged(user => {
  currentUser = user;
  updateAccountUI(user);
  if (user && !user.isAnonymous) {
    maybeShowNotifPrimer();
    syncLangToProfile(user.uid);
    checkPendingReviews(user.uid);
    syncEmailVerifiedBadge(user);
    setupPresence(user.uid);
    refreshAdminStatus(user.uid);
    syncSavedJobs(user.uid);
    startInboxBadgeWatch(user.uid); // badge de messages non-lus en temps réel
    if (deepLinkFromPush && !deepLinkJobId && !deepLinkThreadId) { logNotificationOpened(deepLinkVariant); deepLinkFromPush = false; deepLinkVariant = null; } // clic sur une notif sans cible précise (ex: résumé de relance)
    // Clic sur une notif de message alors que l'app était fermée : on ouvre la
    // conversation maintenant que l'utilisateur est bien connecté.
    if (deepLinkThreadId) {
      const tId = deepLinkThreadId; deepLinkThreadId = null;
      if (deepLinkFromPush) { logNotificationOpened(deepLinkVariant); deepLinkFromPush = false; deepLinkVariant = null; }
      setTimeout(() => { try { openUserChatFromThreadId(tId); } catch(e) {} }, 800); // petit délai : laisse profilesCache se remplir pour afficher le nom
    }
  } else {
    teardownPresence();
    refreshAdminStatus(null);
    savedJobIds = new Set();
    stopInboxBadgeWatch();
    // Visiteur sans session : tentative de connexion ANONYME (repli,
    // best-effort) pour pouvoir sauvegarder des jobs sans créer de compte.
    // Petite attente + re-vérification pour ne pas entrer en concurrence
    // avec la restauration d'une session qui existe déjà (IndexedDB).
    // Si l'option "Anonyme" est désactivée dans Firebase, l'échec est
    // silencieux (plus d'erreur rouge dans la console).
    if (!user) {
      setTimeout(() => {
        if (!auth.currentUser) auth.signInAnonymously().catch(() => {});
      }, 600);
    }
  }
});

// Charge la liste des jobs sauvegardés/favoris de la personne connectée
// (léger : juste les clés, pas les jobs entiers — voir showSavedJobs()
// pour la jointure avec allJobs au moment de l'affichage).
function syncSavedJobs(uid) {
  db.ref('profiles/' + uid + '/savedJobs').once('value').then(snap => {
    savedJobIds = new Set(snap.exists() ? Object.keys(snap.val()) : []);
  }).catch(() => {});
}

// Bascule l'état sauvegardé d'une annonce. Optimiste côté UI (le bouton
// change immédiatement), best-effort côté écriture — cohérent avec le
// reste de l'app (ex: préférences de notification).
function toggleSaveJob(jobId) {
  if (!currentUser || currentUser.isAnonymous) { showToast(t('toastPleaseLogin'), 'error'); return; }
  const nowSaved = !savedJobIds.has(jobId);
  if (nowSaved) savedJobIds.add(jobId); else savedJobIds.delete(jobId);

  db.ref('profiles/' + currentUser.uid + '/savedJobs/' + jobId).set(nowSaved ? true : null).catch(() => {
    // Écriture échouée : on annule l'état optimiste pour rester cohérent avec Firebase.
    if (nowSaved) savedJobIds.delete(jobId); else savedJobIds.add(jobId);
    updateSaveButtonsUI(jobId);
    showToast(t('prefSaveError'), 'error');
  });

  updateSaveButtonsUI(jobId);
  refreshJobsSheetIfOpen();
  showToast(nowSaved ? t('jobSavedToast') : t('jobUnsavedToast'), 'success');
}

// Si le panneau Liste est ouvert au moment où on sauvegarde/désauvegarde un
// job, on le rafraîchit tout de suite (badge 🔖 sur la carte, ou carte qui
// disparaît de l'onglet "Sauvegardés") au lieu d'attendre une réouverture.
function refreshJobsSheetIfOpen() {
  const sheet = document.getElementById('jobsSheet');
  if (!sheet || !sheet.classList.contains('open')) return;
  if (jobsSheetFilter === 'saved') showSavedJobsInSheet(); else showAllJobsInSheet();
}

// Un même job peut avoir un bouton "🔖" affiché à deux endroits en même
// temps (popup carte ET modale détaillée) — on met les deux à jour.
function updateSaveButtonsUI(jobId) {
  const saved = savedJobIds.has(jobId);
  document.querySelectorAll(`[data-save-btn="${jobId}"]`).forEach(btn => {
    btn.textContent = saved ? '🔖 ' + t('savedLabel') : '🔖 ' + t('saveLabel');
    btn.classList.toggle('saved', saved);
  });
}
// que sendNotifications.js puisse envoyer les notifications push dans SA
// langue plutôt qu'en français pour tout le monde. Écrit uniquement si la
// valeur a changé, pour ne pas spammer la DB à chaque connexion.
async function syncLangToProfile(uid) {
  try {
    const snap = await db.ref('profiles/' + uid + '/lang').once('value');
    if (snap.val() !== currentLang) {
      await db.ref('profiles/' + uid).update({ lang: currentLang });
    }
  } catch (e) {
    console.warn('syncLangToProfile error', e);
  }
}

// Badge automatique et gratuit : dès que Firebase confirme que l'email est
// vérifié (lien cliqué, ou compte Google — toujours pré-vérifié), on
// l'enregistre dans le profil public. Aucune action manuelle, aucun coût,
// aucune limite de volume — ça marche pareil pour 10 ou 200 000 comptes.
async function syncEmailVerifiedBadge(user) {
  try {
    await user.reload(); // rafraîchit le statut depuis les serveurs Firebase
    if (user.emailVerified) {
      const snap = await db.ref('profiles/' + user.uid + '/emailVerified').once('value');
      if (snap.val() !== true) {
        await db.ref('profiles/' + user.uid).update({ emailVerified: true });
      }
    }
  } catch (e) {
    console.warn('syncEmailVerifiedBadge error', e);
  }
}

// La connexion anonyme des visiteurs est gérée dans onAuthStateChanged
// ci-dessus (avec garde anti-concurrence) — plus d'appel brutal au
// chargement qui cassait la session ou polluait la console quand
// l'option "Anonyme" est désactivée dans Firebase.

function signupEmail() {
  const emailEl = document.getElementById('email');
  const passEl = document.getElementById('password');
  if (!validateFields(['email', 'password'])) return;
  if (!emailEl.value || !passEl.value) { showToast(t('toastFillAllFields'), 'error'); return; }
  auth.createUserWithEmailAndPassword(emailEl.value, passEl.value)
    .then(res => {
      res.user.sendEmailVerification();
      showToast(t('toastAccountCreated'), 'success');
      bumpDailyStat('signups');
      applyPendingReferral(res.user);
    })
    .catch(err => showToast(err.message, 'error'));
}

function loginEmail() {
  const emailEl = document.getElementById('email');
  const passEl = document.getElementById('password');
  if (!validateFields(['email', 'password'])) return;
  auth.signInWithEmailAndPassword(emailEl.value, passEl.value)
    .then(res => showToast(t('welcomeBack'), 'success'))
    .catch(err => showToast(err.message, 'error'));
}

function loginGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(res => {
      showToast(t('welcomeUser').replace('{name}', res.user.displayName), 'success');
      if (res.additionalUserInfo && res.additionalUserInfo.isNewUser) {
        applyPendingReferral(res.user);
      }
    })
    .catch(err => showToast(err.message, 'error'));
}

function logout() {
  auth.signOut().then(() => showToast(t('toastLoggedOut'), 'info'));
}

function isProfileComplete(profile) {
  return profile && (profile.name || profile.company) && profile.jobTitle;
}

function updateAccountUI(user) {
  const avatarEl = document.getElementById('userAvatar');
  const nameEl = document.getElementById('accountName');
  const emailEl = document.getElementById('accountEmail');
  const statusEl = document.getElementById('profileStatus');
  const authSection = document.getElementById('authSection');
  const userDash = document.getElementById('userDashboard');

  if (!user || user.isAnonymous) {
    if (avatarEl) avatarEl.textContent = 'JM';
    if (nameEl) nameEl.textContent = 'Visiteur';
    if (emailEl) emailEl.textContent = 'Connectez-vous pour publier';
    if (statusEl) statusEl.textContent = 'Profil incomplet';
    if (authSection) authSection.classList.remove('hidden');
    if (userDash) userDash.classList.add('hidden');
    return;
  }

  db.ref('profiles/' + user.uid).once('value').then(snapshot => {
    const profile = snapshot.val() || {};
    const displayName = profile.name || profile.company || user.displayName || user.email || 'Utilisateur';
    const initials = displayName.split(' ').map(v => v[0]).join('').substring(0,2).toUpperCase();

    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = user.email || 'Connexion Google';
    if (statusEl) statusEl.textContent = isProfileComplete(profile) ? 'Profil complet' : 'Profil incomplet';

    if (authSection) authSection.classList.add('hidden');
    if (userDash) userDash.classList.remove('hidden');
  }).catch(err => {
    console.warn('Profile load failed', err);
    if (authSection) authSection.classList.add('hidden');
    if (userDash) userDash.classList.remove('hidden');
  });
}

function switchAuthTab(tab) {
  currentAuthTab = tab;
  document.querySelectorAll('.auth-tab').forEach((el,i) => {
    el.classList.toggle('active', (i===0 && tab==='signup') || (i===1 && tab==='login'));
  });
  const btn = document.getElementById('authMainBtn');
  const forgotLink = document.getElementById('forgotPasswordLink');
  if (tab === 'signup') {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${t('createAccountBtn')}`;
    btn.onclick = signupEmail;
    if (forgotLink) forgotLink.classList.add('hidden');
  } else {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> ${t('loginBtn')}`;
    btn.onclick = loginEmail;
    if (forgotLink) forgotLink.classList.remove('hidden');
  }
}

function forgotPassword() {
  const emailEl = document.getElementById('email');
  const email = emailEl.value.trim();
  if (!email) {
    showToast(t('toastEnterEmailFirst'), 'error');
    emailEl.focus();
    return;
  }
  auth.sendPasswordResetEmail(email)
    .then(() => showToast(t('toastEmailSent'), 'success'))
    .catch(err => {
      // Firebase renvoie parfois "user-not-found" — on reste volontairement
      // vague dans le message pour ne pas confirmer/infirmer l'existence
      // d'un compte a quelqu'un de malveillant.
      showToast(t('toastResetLinkMaybeSent'), 'info');
    });
}

// ===== GEOLOCATION =====
let initialLocationSet = false; // Bloque le recentrage après le premier chargement

function locateMe() {
  if (!navigator.geolocation) { showToast(t('toastGpsNotSupported'), 'error'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    updateUserLocation(pos);
    navigator.geolocation.watchPosition(updateUserLocation, console.error, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 15000
    });
    syncJobs();
  }, () => {
    showToast(t('toastGpsUnavailable'), 'error');
    syncJobs();
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

function updateUserLocation(position) {
  userCoords = { lat: position.coords.latitude, lng: position.coords.longitude };
  if (userMarker) map.removeLayer(userMarker);
  if (accuracyCircle) map.removeLayer(accuracyCircle);

  accuracyCircle = L.circle([userCoords.lat, userCoords.lng], {
    radius: position.coords.accuracy,
    color: '#007AFF', fillColor: '#007AFF', fillOpacity: 0.1
  }).addTo(map);

  userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
    radius: 10, color: '#fff', weight: 3,
    fillColor: '#007AFF', fillOpacity: 1
  }).addTo(map);

  // 🎯 FORCE LE CENTRAGE UNIQUEMENT LA TOUTE PREMIÈRE FOIS AU DÉMARRAGE
  if (!initialLocationSet) {
    map.setView([userCoords.lat, userCoords.lng], 16); // Centre et zoom (16) sur toi au départ
    initialLocationSet = true; // Bloque les prochains recentrages forcés
  }

  const dist = allJobs.length > 0 ? Math.max(...allJobs.map(j=>j.dist)).toFixed(1) : '--';
  document.getElementById('maxDistDisplay').textContent = dist === '--' ? '--' : dist;

  maybeSyncLocationToProfile(userCoords.lat, userCoords.lng);
  }

// Enregistre la position dans le profil pour que sendNotifications.js puisse
// filtrer les jobs par proximité. Limité pour ne pas spammer la DB à chaque
// mise à jour GPS (qui peut arriver plusieurs fois par minute) : seulement
// si on a bougé de plus de 300m, ou si 2 minutes se sont écoulées.
let lastLocationSyncAt = 0;
let lastSyncedCoords = null;
function maybeSyncLocationToProfile(lat, lng) {
  if (!currentUser || currentUser.isAnonymous) return;
  const now = Date.now();
  const movedEnough = !lastSyncedCoords || calcDist(lastSyncedCoords.lat, lastSyncedCoords.lng, lat, lng) > 0.3;
  const longEnough = (now - lastLocationSyncAt) > 2 * 60 * 1000;
  if (!movedEnough && !longEnough) return;
  lastLocationSyncAt = now;
  lastSyncedCoords = { lat, lng };
  db.ref('profiles/' + currentUser.uid).update({ lat, lng }).catch(() => {});
}

// ===== JOB PUBLISH (création ou modification) =====
async function addJob() {
  if (!currentUser || currentUser.isAnonymous) {
    showToast(t('toastLoginToPublish'), 'error');
    return;
  }

  if (!validateFields(['title', 'desc', 'price', 'phone'])) return;

  const titleVal = document.getElementById('title').value.trim();
  const priceVal = document.getElementById('price').value.trim();
  const phoneVal = document.getElementById('phone').value.trim();
  const phone2Val = document.getElementById('phone2').value.trim();

  if (!titleVal || !priceVal || !phoneVal) {
    showToast(t('toastFillRequiredFields'), 'error');
    return;
  }

  // Si on modifie une annonce existante, on la retrouve pour garder sa date
  // d'origine et ses photos si l'utilisateur n'en choisit pas de nouvelles.
  const existingJob = editingJobId ? allJobs.find(j => j.id === editingJobId) : null;

  const publishBtn = document.getElementById('publishBtn');
  publishBtn.disabled = true;
  publishBtn.innerHTML = '<div class="spinner"></div> ' + (editingJobId ? 'Enregistrement...' : 'Publication...');

  const resetPublishBtn = () => {
    publishBtn.disabled = false;
    publishBtn.innerHTML = editingJobId
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Enregistrer les modifications'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Publier maintenant';
  };

  // Termine la publication une fois qu'on connait la position (GPS ou appui long sur la carte)
  const publishWithPosition = async (latitude, longitude) => {
    try {
      let uploadedImages = [];
      const files = document.getElementById('jobImages').files;
      const maxFiles = Math.min(files.length, 5);

      let failedUploads = 0;
      for (let i = 0; i < maxFiles; i++) {
        const file = files[i];
        // Filet de sécurité : revalidation avant l'envoi, même si le fichier
        // a déjà été filtré à la sélection.
        if (!ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
          console.warn('Fichier rejeté avant envoi (type/taille invalide):', file.name);
          continue;
        }
        try {
          const url = await uploadToCloudinary(file);
          uploadedImages.push(url);
        } catch (imgErr) {
          console.warn('Image upload failed:', imgErr);
          failedUploads++;
        }
      }
      if (failedUploads > 0) {
        showToast(t('someUploadsFailed').replace('{n}', failedUploads), 'error');
      }

      // En modification, si aucune nouvelle photo n'est choisie, on garde les anciennes
      if (editingJobId && uploadedImages.length === 0 && existingJob) {
        uploadedImages = existingJob.images || (existingJob.image ? [existingJob.image] : []);
      }

      const catVal = document.getElementById('category').value.split('|');
      const jobData = {
        title: titleVal,
        price: priceVal,
        phone: phoneVal,
        phone2: phone2Val,
        landmark: document.getElementById('landmark').value.trim(),
        desc: document.getElementById('desc').value.trim(),
        requirements: document.getElementById('requirements').value.trim(),
        // CORRECTION SANS CROCHETS : On utilise .at() pour contourner le bug
        icon: catVal.at(0),
        color: catVal.at(1),
        lat: latitude,
        lng: longitude,
        images: uploadedImages,
        image: uploadedImages.at(0) || '', // CORRECTION SANS CROCHETS
        user: currentUser.uid,
        userName: currentUser.displayName || currentUser.email,
        timestamp: (editingJobId && existingJob) ? existingJob.timestamp : Date.now(),
        country: 'Cameroon',
        currency: 'XAF',
        // Langue dans laquelle l'annonce a été rédigée à l'origine : sert de
        // référence pour savoir quand la traduction automatique doit se
        // déclencher (inutile si le lecteur est déjà dans cette langue).
        lang: (editingJobId && existingJob && existingJob.lang) ? existingJob.lang : currentLang
      };

      // Modération automatique : ne bloque QUE les cas clairement
      // inappropriés (voir MODERATE_JOB_SYSTEM_PROMPT dans chat-proxy.js).
      // "Fail-open" strict : toute panne, timeout ou réponse ambiguë de
      // l'IA laisse la publication continuer normalement — jamais bloquer
      // une annonce légitime pour une raison d'infrastructure. Le système
      // de signalement existant reste le filet de sécurité principal.
      try {
        const modController = new AbortController();
        const modTimeout = setTimeout(() => modController.abort(), 8000);
        const modRes = await fetch(CHAT_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'moderate_job',
            title: jobData.title,
            description: jobData.desc,
            requirements: jobData.requirements
          }),
          signal: modController.signal
        });
        clearTimeout(modTimeout);
        if (modRes.ok) {
          const modData = await modRes.json();
          if (!modData.fallback && modData.flagged === true) {
            showToast(modData.reason ? t('jobModerationBlocked').replace('{reason}', modData.reason) : t('jobModerationBlockedGeneric'), 'error');
            resetPublishBtn();
            return;
          }
        }
      } catch (modErr) {
        // Silencieux et volontaire : voir commentaire "fail-open" ci-dessus.
      }

      if (editingJobId) {
        // Le texte a peut-être changé : toute traduction mise en cache
        // deviendrait fausse/périmée. On l'efface pour forcer une nouvelle
        // traduction à la prochaine lecture par un utilisateur concerné.
        await db.ref('jobs/' + editingJobId + '/translations').remove().catch(() => {});
        await db.ref('jobs/' + editingJobId).update(jobData);
        showToast(t('jobUpdated'), 'success');
      } else {
        const newRef = await db.ref('jobs').push(jobData);
        showToast(t('jobPublished'), 'success');
        bumpDailyStat('jobsPublished');
        triggerInstantNotify();
        promptShareNewJob(newRef.key, jobData);
      }
      editingJobId = null;
      resetJobForm();
      toggleJobForm();
      syncJobs();
    } catch (error) {
      console.error(error);
      showToast(t('toastPublishError'), 'error');
    }
    resetPublishBtn();
  };

  // CORRECTION : si une position a déjà été choisie par appui long sur la carte
  // (champs jobLat/jobLng déjà remplis), on publie directement avec cette position
  // au lieu d'exiger en plus l'autorisation GPS de l'appareil — sinon la publication
  // échouait avec "GPS requis pour publier" même quand la position était déjà connue.
  const presetLat = document.getElementById('jobLat').value;
  const presetLng = document.getElementById('jobLng').value;
  if (presetLat && presetLng) {
    await publishWithPosition(parseFloat(presetLat), parseFloat(presetLng));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => publishWithPosition(pos.coords.latitude, pos.coords.longitude),
    () => {
      showToast(t('toastGpsRequiredPublish'), 'error');
      resetPublishBtn();
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

function resetJobForm() {
  ['title','price','phone','landmark','desc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('jobImages').value = '';
  document.getElementById('imagePreviews').innerHTML = '';
  // Vider les coordonnées après publication
  if(document.getElementById('jobLat')) document.getElementById('jobLat').value = '';
  if(document.getElementById('jobLng')) document.getElementById('jobLng').value = '';
}

// ===== IMAGE PREVIEW =====
// ===== VALIDATION DES PHOTOS AVANT ENVOI =====
// Empêche l'envoi de fichiers qui ne sont pas des images ou trop volumineux :
// sans ça, n'importe qui peut envoyer n'importe quel fichier (taille illimitée,
// type quelconque) via le formulaire, ce qui abuse le compte Cloudinary de l'app.
const MAX_IMAGE_SIZE_MB = 8;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Compresse une image côté client AVANT l'envoi à Cloudinary, avec CompressorJS
// (déjà chargé dans le <head> mais jamais utilisé jusqu'ici — les photos
// partaient donc à taille originale, jusqu'à 8 Mo chacune). Ça réduit fortement
// la data consommée à la publication ET au chargement pour tout le monde
// ensuite, ce qui compte beaucoup sur les connexions 3G/4G au Cameroun.
// Repli : si la compression échoue pour une raison quelconque, on renvoie le
// fichier original plutôt que de bloquer la publication.
function compressImageFile(file) {
    return new Promise((resolve) => {
        if (typeof Compressor === 'undefined' || !ALLOWED_IMAGE_TYPES.includes(file.type) || file.type === 'image/gif') {
            resolve(file); // GIF non compressé (perte d'animation), et repli si la lib n'a pas chargé
            return;
        }
        new Compressor(file, {
            quality: 0.6,
            maxWidth: 1280,
            maxHeight: 1280,
            convertSize: Infinity, // ne convertit jamais en JPEG un PNG à transparence
            success(result) { resolve(result); },
            error(err) { console.warn('Compression image échouée, envoi du fichier original', err); resolve(file); }
        });
    });
}

// Upload compressé vers Cloudinary avec retry automatique (réseau mobile
// instable = très fréquent). Avant, chaque endroit qui uploadait une photo
// (job, vérification, profil) réimplémentait son propre fetch() et
// abandonnait silencieusement au 1er échec — l'utilisateur ne savait même
// pas que sa photo n'était pas passée. Ici : jusqu'à 2 tentatives
// supplémentaires avec un court délai, puis on lève une erreur claire si
// tout échoue, à charge de l'appelant de prévenir l'utilisateur.
async function uploadToCloudinary(file, { retries = 2 } = {}) {
    const compressed = await compressImageFile(file);
    const formData = new FormData();
    formData.append('file', compressed, file.name);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
                method: 'POST', body: formData
            });
            const data = await res.json();
            if (data.secure_url) return data.secure_url;
            lastErr = new Error(data.error?.message || 'upload sans secure_url');
        } catch (err) {
            lastErr = err;
        }
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
    console.warn('Upload Cloudinary échoué après ' + (retries + 1) + ' tentative(s):', lastErr);
    throw lastErr || new Error('upload failed');
}

function validateImageFiles(fileList) {
  const files = Array.from(fileList).slice(0, 5);
  const valid = [];
  let rejectedWrongType = 0;
  let rejectedTooBig = 0;
  files.forEach(file => {
    const tooBig = file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024;
    const wrongType = !ALLOWED_IMAGE_TYPES.includes(file.type);
    if (wrongType) rejectedWrongType++;
    else if (tooBig) rejectedTooBig++;
    else valid.push(file);
  });
  return { valid, rejectedWrongType, rejectedTooBig };
}

function previewImages(input) {
  const container = document.getElementById('imagePreviews');
  container.innerHTML = '';

  const { valid, rejectedWrongType, rejectedTooBig } = validateImageFiles(input.files);

  if (rejectedWrongType > 0) {
    showToast(t('rejectedWrongType').replace('{n}', rejectedWrongType), 'error');
  }
  if (rejectedTooBig > 0) {
    showToast(t('rejectedTooBig').replace('{n}', rejectedTooBig).replace('{mb}', MAX_IMAGE_SIZE_MB), 'error');
  }

  // On remplace la sélection par uniquement les fichiers valides, pour être
  // certain que seules ces images pourront réellement être envoyées ensuite.
  try {
    const dt = new DataTransfer();
    valid.forEach(file => dt.items.add(file));
    input.files = dt.files;
  } catch (e) { /* DataTransfer non supporté : la vérification à l'envoi reste active */ }

  valid.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = document.createElement('img');
      img.className = 'image-preview-item';
      img.src = e.target.result;
      container.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
  }

// ===== SECURITE AFFICHAGE =====
// Neutralise tout code HTML/script caché dans du texte saisi par les
// utilisateurs (titre de job, nom de profil, etc.) avant de l'insérer
// dans la page, pour empêcher les injections de code (XSS).
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Les photos sont hébergées sur Cloudinary, qui sait redimensionner à la
// volée gratuitement via l'URL (pas besoin de compte payant ni de
// retraitement côté serveur) — mais jusqu'ici, l'app servait toujours
// l'image en pleine résolution d'origine, même pour une vignette de 40px.
// Cette fonction insère les paramètres de transformation dans l'URL :
// w_/h_ = dimensions cibles, c_fill = recadrage centré sans déformation,
// g_auto = recadrage intelligent (garde le sujet principal), q_auto =
// qualité automatique, f_auto = format le plus léger selon le navigateur
// (WebP/AVIF quand supporté). Ne touche jamais aux URLs qui ne viennent
// pas de Cloudinary (ui-avatars.com, data: URIs de prévisualisation
// locale...) — elles sont renvoyées telles quelles.
function cloudinaryResize(url, width, height) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  const h = height || width;
  const transform = `w_${width},h_${h},c_fill,g_auto,q_auto,f_auto`;
  return url.replace('/upload/', `/upload/${transform}/`);
}

// Vérifie une liste de champs par leur id avec les règles HTML natives
// (required, minlength, maxlength, pattern...) et affiche le message
// d'aide du navigateur sur le premier champ invalide trouvé.
function validateFields(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && typeof el.checkValidity === 'function' && !el.checkValidity()) {
      el.reportValidity();
      return false;
    }
  }
  return true;
}

// ===== SYNC JOBS =====
function getCatIcon(cat) {
  const icons = {
    btp: 'BTP', electricite: 'ELEC', plomberie: 'PLO',
    menage: 'MEN', jardinage: 'JAR', mecanique: 'MEC', informatique: 'INFO'
  };
  return icons[cat] || 'JOB';
}

function getCatLabel(cat) {
  const keys = {
    btp: 'optBtp', electricite: 'optElec', plomberie: 'optPlomberie',
    menage: 'optMenage', jardinage: 'optJardinage', mecanique: 'optMecanique', informatique: 'optInfo'
  };
  return keys[cat] ? t(keys[cat]) : cat;
}

// Nombre maximum d'annonces gardées en mémoire/affichées à la fois. Sans
// cette limite, la base grossirait indéfiniment et chaque utilisateur
// télécharge­rait un jeu de données de plus en plus lourd à chaque
// chargement de l'app. Les annonces les PLUS RÉCENTES sont toujours
// prioritaires (limitToLast sur les clés push, qui sont déjà
// chronologiques) — les plus anciennes, généralement moins pertinentes
// pour une demande de service, sortent progressivement de la vue.
const JOBS_LIMIT = 500;

// Construit le marqueur Leaflet (icône + popup) d'UNE SEULE annonce. Isolé
// dans sa propre fonction pour pouvoir être appelé annonce par annonce
// (ajout, modification) au lieu de tout reconstruire à chaque fois.
// Construit le HTML du popup d'une annonce. Isolé dans sa propre fonction
// (au lieu d'être codé en dur dans createJobMarker) pour pouvoir être
// régénéré à volonté — notamment quand la langue change : Leaflet ne
// reconstruit jamais tout seul un popup déjà créé, donc sans ça, une
// popup ouverte AVANT un changement de langue restait figée dans
// l'ancienne langue jusqu'au rechargement complet de la page.
function buildJobPopupHtml(job, jobId) {
  return `
      <div style="min-width:240px;font-family:'DM Sans',sans-serif;">
        <div data-map-popup-title style="font-family:'Syne',sans-serif;font-weight:800;font-size:16px;margin-bottom:6px;">${job.title}</div>
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;">
          <span style="background:rgba(37,211,102,0.15);color:#25D366;padding:4px 10px;border-radius:12px;font-weight:700;font-size:13px;">${job.price} XAF</span>
          <span style="background:rgba(255,215,0,0.12);color:#FFD700;padding:4px 10px;border-radius:12px;font-size:12px;">${getCatLabel(job.icon)}</span>
        </div>
        ${(() => {
          const p = profilesCache[job.user] || {};
          let badge = '';
          if (p.verified) {
            badge = `<span style="display:inline-flex;align-items:center;gap:3px;color:var(--blue);font-size:12px;font-weight:600;"><svg width="13" height="13" viewBox="0 0 24 24" fill="var(--blue)"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>${t('verifiedBadgeLabel')}</span>`;
          } else if (p.phoneVerified) {
            badge = `<span style="font-size:12px;color:var(--green,#25D366);font-weight:600;">📱 ${t('whatsappVerifiedTitle')}</span>`;
          } else if (p.emailVerified) {
            badge = `<span style="font-size:12px;color:var(--text-dim);font-weight:600;">✉️ ${t('emailVerifiedTitle')}</span>`;
          }
          const rating = p.ratingCount ? `<span style="font-size:12px;color:#FFD700;font-weight:700;">★ ${p.ratingAvg.toFixed(1)} (${p.ratingCount})</span>` : '';
          return (badge || rating) ? `<div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;">${badge}${rating}</div>` : '';
        })()}
        ${job.landmark ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;">${job.landmark}</div>` : ''}
        ${job.desc ? `<div data-map-popup-desc class="popup-desc-clamp" style="font-size:13px;margin-bottom:4px;line-height:1.5;">${job.desc}</div>${job.desc.length > 100 ? `<button type="button" onclick="toggleDescClamp(this)" class="popup-desc-toggle" style="background:none;border:none;color:var(--accent,#25D366);font-size:12px;font-weight:700;cursor:pointer;padding:0 0 10px 0;">${t('showMoreText')}</button>` : ''}` : ''}
        ${job.requirements ? `<div style="font-size:12px;margin-bottom:10px;line-height:1.5;background:rgba(255,215,0,0.08);border-radius:10px;padding:8px 10px;"><strong>📋 ${t('requirementsLabel')}</strong><br>${job.requirements.replace(/\n/g, '<br>')}</div>` : ''}
        ${job.images?.length ? job.images.slice(0,2).map(img => `<img src="${cloudinaryResize(img, 500, 300)}" loading="lazy" alt="${t('altJobPhoto')}" style="width:100%;margin-bottom:6px;border-radius:10px;max-height:120px;object-fit:cover;">`).join('') : ''}
        <div data-map-popup-translation-notice style="display:none;margin:6px 0;font-size:11px;color:var(--text-dim);"></div>
        <button onclick="popupWhatsAppClick('${jobId}')" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#25D366;color:white;padding:12px;text-align:center;border-radius:12px;margin-top:8px;border:none;width:100%;cursor:pointer;font-weight:700;font-size:14px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.987-1.417A9.953 9.953 0 0 0 11.999 22C17.522 22 22 17.523 22 12S17.522 2 11.999 2zm0 18.17a8.14 8.14 0 0 1-4.152-1.135l-.297-.176-3.078.875.876-3.003-.194-.308A8.11 8.11 0 0 1 3.83 12c0-4.509 3.661-8.17 8.169-8.17 4.508 0 8.17 3.661 8.17 8.17 0 4.508-3.662 8.17-8.17 8.17z"/></svg>
          WhatsApp
        </button>
        
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button onclick="popupShareClick('${jobId}')" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;background:#007AFF;color:white;padding:12px;text-align:center;border-radius:12px;border:none;cursor:pointer;font-weight:700;font-size:14px;">
             ${t('shareOnWhatsappBtn')}
          </button>
          <button onclick="copyJobLink('${jobId}')" title="${t('copyLinkBtn')}" style="flex-shrink:0;width:46px;background:var(--surface2,#252538);color:var(--text);border:1px solid var(--border);border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
        <button onclick="drawRoute(${job.lat},${job.lng})" style="width:100%;background:var(--blue);color:white;padding:12px;border:none;border-radius:12px;margin-top:6px;font-weight:700;font-size:14px;cursor:pointer;">
          ${t('viewRouteBtn')}
        </button>
        <button onclick="toggleSaveJob('${jobId}')" data-save-btn="${jobId}" class="${savedJobIds.has(jobId) ? 'saved' : ''}" style="width:100%;background:none;border:1px solid var(--border,#333);color:var(--text-dim,#999);padding:8px;border-radius:8px;font-size:12px;cursor:pointer;margin-top:6px;">
          🔖 ${savedJobIds.has(jobId) ? t('savedLabel') : t('saveLabel')}
        </button>
        <button onclick="openReportModal('${jobId}')" style="width:100%;background:none;color:var(--text-dim);padding:8px;border:none;font-size:12px;cursor:pointer;margin-top:4px;text-decoration:underline;">
          🚩 ${t('reportLink')}
        </button>
      </div>
    `;
}

// Après un changement de langue, régénère le contenu de TOUS les popups
// déjà créés (sans recréer les marqueurs eux-mêmes — juste leur popup),
// pour qu'une annonce déjà affichée bascule bien dans la nouvelle langue
// au lieu de rester figée dans l'ancienne jusqu'au rechargement.
function refreshAllPopupsLanguage() {
  allJobs.forEach(job => {
    if (job.marker) job.marker.setPopupContent(buildJobPopupHtml(job, job.id));
  });
}

function createJobMarker(job, jobId) {
  const icon = L.divIcon({
    html: `<div style="
      background:${job.color || '#FFD700'};
      color:#111;font-weight:800;font-size:9px;
      padding:6px 8px;border-radius:10px;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);
      white-space:nowrap;
      border:2px solid rgba(255,255,255,0.3);
    ">${getCatIcon(job.icon)}</div>`,
    iconSize: [null, null],
    className: ''
  });

  const marker = L.marker([job.lat, job.lng], { icon })
    .addTo(jobsLayer)
    .bindPopup(buildJobPopupHtml(job, jobId), { maxWidth: 280 });
  marker.on('popupopen', () => translateMapPopupIfNeeded(job, jobId, marker));
  return marker;
}

function removeJobMarker(jobId) {
  const existing = jobsById[jobId];
  if (existing && existing.marker) {
    jobsLayer.removeLayer(existing.marker);
    existing.marker.remove();
  }
}

// Recalcule les compteurs/statistiques dérivés d'allJobs (déjà en mémoire,
// donc quasi gratuit — contrairement à avant, ceci ne redéclenche JAMAIS
// un téléchargement Firebase).
function recalcJobStats() {
  const today = new Date().setHours(0, 0, 0, 0);
  const todayCount = allJobs.filter(j => j.timestamp > today).length;

  document.getElementById('jobCountBadge').textContent = allJobs.length;
  document.getElementById('adminTotalJobs').textContent = allJobs.length;
  document.getElementById('adminTodayJobs').textContent = todayCount;

  if (userCoords && allJobs.length > 0) {
    const maxDist = allJobs.reduce((m, j) => Math.max(m, j.dist), 0);
    document.getElementById('maxDistDisplay').textContent = maxDist.toFixed(1);
  }

  if (typeof refreshNotifPanel === 'function') refreshNotifPanel();
}

// Les annonces boostées (parrainage) passent devant, puis tri par distance.
// Appelé après chaque ajout/modification pour garder l'ordre cohérent.
function resortAllJobs() {
  const now = Date.now();
  allJobs.sort((a, b) => {
    const aBoost = a.boosted && a.boostedUntil > now ? 1 : 0;
    const bBoost = b.boosted && b.boostedUntil > now ? 1 : 0;
    if (aBoost !== bBoost) return bBoost - aBoost;
    return a.dist - b.dist;
  });
}

function syncJobs() {
  try {
    const jobsQuery = db.ref('jobs').limitToLast(JOBS_LIMIT);
    let initialLoadDone = false;

    // ---- Chargement initial : UN SEUL aller-retour réseau, borné à
    // JOBS_LIMIT annonces, UN SEUL rendu — au lieu de retélécharger et
    // tout reconstruire à chaque changement comme avant.
    jobsQuery.once('value').then(snap => {
      allJobs = [];
      jobsById = {};
      jobsLayer.clearLayers();

      snap.forEach(child => {
        const job = child.val();
        const jobId = child.key;
        const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, job.lat, job.lng) : 999;
        const jobWithId = { ...job, id: jobId, dist };
        jobWithId.marker = createJobMarker(job, jobId);
        allJobs.push(jobWithId);
        jobsById[jobId] = jobWithId;
      });

      resortAllJobs();
      applyFilters();
      recalcJobStats();

      // Lien profond : quelqu'un a cliqué sur un lien "#job=..." partagé sur WhatsApp
      if (deepLinkJobId && jobsById[deepLinkJobId]) {
        const idToOpen = deepLinkJobId;
        deepLinkJobId = null;
        if (deepLinkFromPush) { logNotificationOpened(deepLinkVariant); deepLinkFromPush = false; deepLinkVariant = null; }
        setTimeout(() => openJobPreview(idToOpen), 300);
      }

      initialLoadDone = true;
    }).catch(e => console.error('Sync jobs initial load error:', e));

    // ---- Mises à jour EN DIRECT après le chargement initial : chacune ne
    // porte que sur l'annonce concernée, jamais un re-téléchargement complet.
    jobsQuery.on('child_added', snap => {
      if (!initialLoadDone) return; // déjà traité par le chargement initial ci-dessus
      const job = snap.val();
      const jobId = snap.key;
      if (jobsById[jobId]) return; // déjà présent (évite un doublon si les deux écouteurs se chevauchent)

      const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, job.lat, job.lng) : 999;
      const jobWithId = { ...job, id: jobId, dist };
      jobWithId.marker = createJobMarker(job, jobId);
      allJobs.push(jobWithId);
      jobsById[jobId] = jobWithId;

      resortAllJobs();
      applyFilters();
      recalcJobStats();
    });

    jobsQuery.on('child_changed', snap => {
      const job = snap.val();
      const jobId = snap.key;
      if (!jobsById[jobId]) return; // pas encore vu (rare, cas limite au tout début du chargement)

      removeJobMarker(jobId);
      const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, job.lat, job.lng) : 999;
      const jobWithId = { ...job, id: jobId, dist };
      jobWithId.marker = createJobMarker(job, jobId);
      jobsById[jobId] = jobWithId;
      const idx = allJobs.findIndex(j => j.id === jobId);
      if (idx !== -1) allJobs[idx] = jobWithId; else allJobs.push(jobWithId);

      resortAllJobs();
      applyFilters();
      recalcJobStats();
    });

    jobsQuery.on('child_removed', snap => {
      const jobId = snap.key;
      if (!jobsById[jobId]) return;

      removeJobMarker(jobId);
      delete jobsById[jobId];
      allJobs = allJobs.filter(j => j.id !== jobId);

      applyFilters();
      recalcJobStats();
    });
  } catch(e) {
    console.error('Sync jobs error:', e);
  }
}

function updateJobsList(jobs) {
  const list = document.getElementById('listContent');
  if (!list) return;

  try { renderArtisanOfMonth(); } catch (_) {}

  if (jobs.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <div class="empty-title" data-i18n="emptyStateNoJobs">Aucun job trouvé</div>
      <div class="empty-sub" data-i18n="emptyZoneSub">Publiez le premier job dans cette zone</div>
    </div>`;
    return;
  }

  // On génère les cartes et on ajoute openJobPreview('${job.id}') au clic !
  list.innerHTML = jobs.map((job, i) => `
    <div class="job-card" style="animation-delay:${i*0.04}s${(job.boosted && job.boostedUntil > Date.now()) ? ';border:1px solid var(--gold,#FFD700);' : ''}${job.status === 'filled' ? ';opacity:0.6;' : ''}" onclick="focusJob(${job.lat},${job.lng}); openJobPreview('${job.id}')">
      <div class="job-card-icon" style="background:${job.color || '#FFD700'}22;">
        <span style="font-size:11px;font-weight:800;color:${job.color || '#FFD700'};">${getCatIcon(job.icon)}</span>
      </div>
      <div class="job-card-body">
        <div class="job-card-title">${job.status === 'filled' ? '✅ ' : ''}${(job.boosted && job.boostedUntil > Date.now()) ? '🚀 ' : ''}${((profilesCache[job.user]||{}).isPro && ((profilesCache[job.user]||{}).proUntil||0) > Date.now()) ? '⭐ ' : ''}${savedJobIds.has(job.id) ? '🔖 ' : ''}${escapeHtml(job.title)}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:2px;">${job.status === 'filled' ? t('filledBadgeLabel') + ' · ' : ''}${escapeHtml(job.landmark) || getCatLabel(job.icon)}</div>
        <div class="job-card-meta">
          <span class="job-card-price">${job.price}</span>
          <span style="color:var(--text-dim);font-size:11px;">XAF</span>
        </div>
      </div>
      <div class="job-card-right">
        <div class="job-card-dist">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/></svg>
          ${job.dist >= 999 ? '-- km' : job.dist.toFixed(1) + ' km'}
        </div>
        ${(() => {
          const p = profilesCache[job.user] || {};
          let badge = '';
          // Badge PRO doré (abonné actif) — affiché en priorité pour se démarquer
          if (p.isPro && (p.proUntil || 0) > Date.now()) {
            badge += `<span title="Artisan PRO" style="font-size:10px;font-weight:800;color:#0A0A0F;background:linear-gradient(135deg,#FFD700,#E6B800);padding:2px 6px;border-radius:8px;">PRO</span>`;
          }
          if (p.verified) {
            badge += `<svg class="job-card-verified" viewBox="0 0 24 24" fill="var(--blue)"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>`;
          } else if (p.phoneVerified) {
            badge += `<span title="${t('whatsappVerifiedTitle')}" style="font-size:11px;color:var(--green,#25D366);">📱</span>`;
          } else if (p.emailVerified) {
            badge += `<span title="${t('emailVerifiedTitle')}" style="font-size:11px;color:var(--text-dim);">✉️</span>`;
          }
          const avail = availabilityBadge(p);
          const activity = avail ? '' : activityBadge(p); // évite d'empiler dispo + actif
          const rating = p.ratingCount ? `<span style="font-size:11px;color:#FFD700;font-weight:700;">★ ${p.ratingAvg.toFixed(1)}</span>` : '';
          return badge + avail + activity + rating;
        })()}
      </div>
    </div>
  `).join('');
}

function focusJob(lat, lng) {
  closeSheet('jobsSheet');
  map.setView([lat, lng], 16);
}

// ===== ROUTE =====
function drawRoute(lat, lng) {
  if (!userCoords) { showToast(t('toastGpsRequired'), 'error'); return; }
  if (routeControl) { try { map.removeControl(routeControl); } catch(e){} }
  try {
    routeControl = L.Routing.control({
      waypoints: [L.latLng(userCoords.lat, userCoords.lng), L.latLng(lat, lng)],
      routeWhileDragging: false, addWaypoints: false,
      createMarker: () => null,
      lineOptions: { styles: [{ color: '#007AFF', weight: 5, opacity: 0.85 }] },
      show: false
    }).addTo(map);
    routeControl.on('routesfound', e => {
      const route = e.routes[0];
      const dist = (route.summary.totalDistance / 1000).toFixed(1);
      const mins = Math.ceil(route.summary.totalTime / 60);
      document.getElementById('itinPanel').classList.remove('hidden');
      document.getElementById('itinDist').textContent = dist + ' km';
      document.getElementById('itinTime').textContent = `Environ ${mins} min en voiture`;
    });
    map.closePopup();
  } catch(e) { console.error(e); }
}

function clearRoute() {
  if (routeControl) { try { map.removeControl(routeControl); } catch(e){} routeControl = null; }
  document.getElementById('itinPanel').classList.add('hidden');
}

// ===== FILTER =====
function filterJobs(cat, el) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  currentCategory = cat;
  applyFilters();
}

// ===== FILTRE UNIFIÉ : catégorie + recherche texte + rayon =====
// Filtre à la fois la liste (sheet) ET les marqueurs affichés sur la carte,
// pour que "sélectionner un type de job" affecte vraiment la carte.
function applyFilters() {
  const searchLower = currentSearchText.trim().toLowerCase();

  const filtered = allJobs.filter(job => {
    const matchesCategory = currentCategory === 'all' || job.icon === currentCategory;
    const matchesSearch = !searchLower ||
      (job.title && job.title.toLowerCase().includes(searchLower)) ||
      (job.desc && job.desc.toLowerCase().includes(searchLower));
    const matchesRadius = currentRadiusKm == null || (userCoords && job.dist <= currentRadiusKm);
    const notFilled = job.status !== 'filled';
    return matchesCategory && matchesSearch && matchesRadius && notFilled;
  });

  updateJobsList(filtered);

  // Montre/cache les marqueurs sur la carte pour correspondre au filtre actif
  const visibleIds = new Set(filtered.map(j => j.id));
  allJobs.forEach(job => {
    if (!job.marker) return;
    const shouldShow = visibleIds.has(job.id);
    const isOnMap = jobsLayer.hasLayer(job.marker);
    if (shouldShow && !isOnMap) jobsLayer.addLayer(job.marker);
    if (!shouldShow && isOnMap) jobsLayer.removeLayer(job.marker);
  });

  const countEl = document.getElementById('searchResultsCount');
  if (countEl) countEl.textContent = filtered.length + ' ' + (filtered.length > 1 ? t('resultsPlural') : t('resultSingular'));

  // Recherche intelligente : ne se déclenche QUE quand la recherche par
  // mot-clé exact ne trouve RIEN, et seulement après un court délai sans
  // frappe (pas à chaque touche) — pour ne jamais appeler l'IA pendant que
  // la personne tape encore, et rester très économe en appels.
  hideSearchIntentSuggestion();
  clearTimeout(window.__searchIntentTimer);
  if (searchLower.length >= 3 && filtered.length === 0) {
    window.__searchIntentTimer = setTimeout(() => askSearchIntent(searchLower), 900);
  }
}

// Bascule "did-you-mean" affichée sous le compteur de résultats quand la
// recherche par mot-clé échoue mais que l'IA détecte une catégorie
// probable (ex: "robinet qui fuit" -> Plomberie). Un clic applique le
// filtre catégorie correspondant — jamais automatique, toujours un choix.
async function askSearchIntent(query) {
  // Le texte de recherche a pu changer pendant le délai : on vérifie qu'il
  // s'agit toujours de la même requête avant d'afficher quoi que ce soit.
  if (currentSearchText.trim().toLowerCase() !== query) return;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'search_intent', query }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return;

    const data = await res.json();
    if (data.fallback || !data.category || data.category === 'none') return;
    if (currentSearchText.trim().toLowerCase() !== query) return; // toujours d'actualité ?

    showSearchIntentSuggestion(data.category);
  } catch (err) {
    // Silencieux : la recherche par mot-clé reste utilisable normalement,
    // ce n'est qu'une suggestion en plus, jamais un blocage.
  }
}

function showSearchIntentSuggestion(category) {
  const countEl = document.getElementById('searchResultsCount');
  if (!countEl) return;
  let box = document.getElementById('searchIntentSuggestion');
  if (!box) {
    box = document.createElement('div');
    box.id = 'searchIntentSuggestion';
    box.style.cssText = 'margin-top:6px;font-size:13px;color:var(--text-dim,#9999BC);';
    countEl.insertAdjacentElement('afterend', box);
  }
  const label = t(CATEGORY_LABEL_KEYS[category]);
  box.innerHTML = `${t('searchIntentPrefix')} <button type="button" onclick="applySearchIntentCategory('${category}')" style="background:none;border:none;color:var(--accent,#25D366);text-decoration:underline;cursor:pointer;font-size:13px;font-weight:700;padding:0;">${label}</button> ?`;
  box.style.display = 'block';
}

function hideSearchIntentSuggestion() {
  const box = document.getElementById('searchIntentSuggestion');
  if (box) box.style.display = 'none';
}

function applySearchIntentCategory(category) {
  hideSearchIntentSuggestion();
  const btn = document.querySelector(`.cat-btn[onclick*="filterJobs('${category}'"]`);
  filterJobs(category, btn || null);
}

// ===== CALC DISTANCE =====
function calcDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// ===== MAP STYLE TOGGLE =====
function toggleMapStyle() {
  if (currentMapStyle === 'satellite') {
    map.removeLayer(satelliteLayer);
    streetLayer.addTo(map);
    currentMapStyle = 'street';
    showToast(t('mapViewActivated'), 'info');
  } else {
    map.removeLayer(streetLayer);
    satelliteLayer.addTo(map);
    currentMapStyle = 'satellite';
    showToast(t('satelliteViewActivated'), 'info');
  }
}

// ===== NAVIGATION =====
// Sélecteur "Tous / Sauvegardés" du panneau Liste (voir jobsFilterAllBtn /
// jobsFilterSavedBtn dans le HTML). Ne touche jamais allJobs lui-même —
// juste ce qui est affiché dans ce panneau précis.
function showAllJobsInSheet() {
  jobsSheetFilter = 'all';
  document.getElementById('jobsFilterAllBtn')?.classList.add('active');
  document.getElementById('jobsFilterSavedBtn')?.classList.remove('active');
  updateJobsList(allJobs);
}

function showSavedJobsInSheet() {
  jobsSheetFilter = 'saved';
  document.getElementById('jobsFilterSavedBtn')?.classList.add('active');
  document.getElementById('jobsFilterAllBtn')?.classList.remove('active');
  if (!currentUser || currentUser.isAnonymous) {
    showToast(t('toastPleaseLogin'), 'error');
    updateJobsList([]);
    return;
  }
  const saved = allJobs.filter(j => savedJobIds.has(j.id));
  updateJobsList(saved);
}

function activateNav(tab) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav' + tab.charAt(0).toUpperCase() + tab.slice(1))?.classList.add('active');

  if (tab !== 'search') {
    const panel = document.getElementById('searchPanel');
    if (panel) panel.classList.remove('open');
  }

  if (tab === 'map') {
    closeSheet('jobsSheet');
    closeOverlay('accountPage');
  } else if (tab === 'list') {
    closeOverlay('accountPage');
    openSheet('jobsSheet');
  } else if (tab === 'account') {
    closeSheet('jobsSheet');
    openOverlay('accountPage');
  } else if (tab === 'search') {
    closeOverlay('accountPage');
    openSheet('jobsSheet');
    const panel = document.getElementById('searchPanel');
    if (panel) {
      panel.classList.add('open');
      const input = document.getElementById('jobSearchInput');
      if (input) input.focus();
    }
  }
}

function toggleJobForm() {
  const sheet = document.getElementById('jobFormSheet');
  const willOpen = !sheet.classList.contains('open');
  sheet.classList.toggle('open');
  if (!willOpen) {
    // Fermeture sans avoir publié/enregistré : on sort du mode édition et on
    // efface la position pré-sélectionnée, pour ne pas modifier le mauvais
    // job ou réutiliser une position périmée la prochaine fois.
    editingJobId = null;
    const inputLat = document.getElementById('jobLat');
    const inputLng = document.getElementById('jobLng');
    if (inputLat) inputLat.value = '';
    if (inputLng) inputLng.value = '';
    const publishBtn = document.getElementById('publishBtn');
    if (publishBtn) publishBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Publier maintenant';
  }
}

function openSheet(id) { document.getElementById(id).classList.add('open'); }
function closeSheet(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'profileSheet' && profileLiveRef) {
        profileLiveRef.off();
        profileLiveRef = null;
    }
}
function openOverlay(id) { document.getElementById(id).classList.add('open'); }
function closeOverlay(id) {
  document.getElementById(id).classList.remove('open');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('navMap').classList.add('active');
}

// ===== ADMIN =====
let reportingJobId = null;

function openReportModal(jobId) {
  if (!currentUser || currentUser.isAnonymous) {
    showToast(t('toastLoginToReport'), 'error');
    return;
  }
  reportingJobId = jobId;
  document.getElementById('reportReason').value = 'fraud';
  document.getElementById('reportComment').value = '';
  openOverlay('reportModal');
}

async function submitReport() {
  if (!reportingJobId || !currentUser) return;
  const reason = document.getElementById('reportReason').value;
  const comment = document.getElementById('reportComment').value.trim();

  try {
    // Clé = jobId + reporterUid plutôt qu'un push() : empêche naturellement
    // la même personne de signaler dix fois la même annonce (voir règle
    // Firebase, qui refuse l'écrasement d'un signalement déjà existant).
    const reportId = `${reportingJobId}_${currentUser.uid}`;
    await db.ref('reports/' + reportId).set({
      jobId: reportingJobId,
      reporterUid: currentUser.uid,
      reason,
      comment,
      timestamp: Date.now(),
      status: 'pending'
    });
    triggerInstantNotify('new-report'); // prévient l'admin instantanément, sans attendre le cron
    closeOverlay('reportModal');
    showToast(t('toastReportSent'), 'success');
  } catch (e) {
    console.warn('Erreur envoi signalement', e);
    showToast(e && e.code === 'PERMISSION_DENIED' ? t('toastAlreadyReported') : t('toastSendErrorRetry'), 'error');
  }
}

function openAdminPanel() {
  if (!currentUser || !isAdmin) {
    showToast(t('toastAdminOnly'), 'error');
    return;
  }
  openOverlay('adminPanel');
  loadAdminJobs();
  loadPendingVerifications();
  loadNotifOpenRate();
  loadDailyStats();
  loadPendingReports();
}

async function loadPendingReports() {
  const list = document.getElementById('adminReportsList');
  if (!list) return;
  list.innerHTML = `<div style="font-size:13px;color:var(--text-dim);">${t('adminLoading')}</div>`;

  try {
    const [reportsSnap, jobsSnap] = await Promise.all([
      db.ref('reports').orderByChild('status').equalTo('pending').once('value'),
      db.ref('jobs').once('value')
    ]);
    const reports = reportsSnap.val() || {};
    const jobs = jobsSnap.val() || {};
    const entries = Object.entries(reports);

    if (!entries.length) {
      list.innerHTML = `<div style="font-size:13px;color:var(--text-dim);">${t('adminNoReports')}</div>`;
      return;
    }

    const reasonLabels = {
      fraud: t('reportReasonFraud'), inappropriate: t('reportReasonInappropriate'),
      misleading: t('reportReasonMisleading'), duplicate: t('reportReasonDuplicate'), other: t('reportReasonOther')
    };

    list.innerHTML = entries.map(([reportId, report]) => {
      const job = jobs[report.jobId];
      const jobTitle = job ? escapeHtml(job.title) : `<em>${t('adminJobDeleted')}</em>`;
      const reasonLabel = reasonLabels[report.reason] || report.reason;
      const date = new Date(report.timestamp).toLocaleString();
      return `<div style="background:var(--surface,#1E1E2E);border-radius:12px;padding:12px;margin-bottom:10px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${jobTitle}</div>
        <div style="font-size:12px;color:var(--danger,#FF3B30);margin-bottom:4px;">🚩 ${escapeHtml(reasonLabel)}</div>
        ${report.comment ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">"${escapeHtml(report.comment)}"</div>` : ''}
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">${date}</div>
        <div style="display:flex;gap:8px;">
          <button onclick="dismissReport('${reportId}')" style="flex:1;padding:8px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--text);font-size:12px;cursor:pointer;">${t('adminDismissReport')}</button>
          ${job ? `<button onclick="deleteReportedJob('${reportId}','${report.jobId}')" style="flex:1;padding:8px;border-radius:8px;border:none;background:var(--danger,#FF3B30);color:#fff;font-size:12px;cursor:pointer;">${t('adminDeleteJob')}</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.warn('Erreur chargement signalements', e);
    list.innerHTML = `<div style="font-size:13px;color:var(--danger,#FF3B30);">${t('adminLoadError')}</div>`;
  }
}

async function dismissReport(reportId) {
  try {
    await db.ref('reports/' + reportId + '/status').set('dismissed');
    loadPendingReports();
  } catch (e) { showToast(t('toastErrorRetry'), 'error'); }
}

async function deleteReportedJob(reportId, jobId) {
  if (!confirm(t('adminConfirmDeleteJob'))) return;
  try {
    await db.ref('jobs/' + jobId).remove();
    await db.ref('reports/' + reportId + '/status').set('resolved');
    loadPendingReports();
    loadAdminJobs();
    showToast(t('toastJobDeleted'), 'success');
  } catch (e) { showToast(t('toastErrorRetry'), 'error'); }
}

// Agrège notifStats/{date}/{sent,opened} sur les 7 derniers jours pour
// donner une idée grossière (pas exacte à la notif près, mais utile en
// tendance) de l'engagement. "sent" est écrit par les scripts serveur
// (sendNotifications.js, sendReengagement.js), "opened" par le client
// quand quelqu'un arrive dans l'app via une notification (voir sw.js +
// le message 'open-job' plus bas).
async function loadNotifOpenRate() {
  const el = document.getElementById('adminNotifOpenRate');
  if (!el) return;
  try {
    let totalSent = 0, totalOpened = 0;
    const variantTotals = {}; // { A: {sent, opened}, B: {...}, digest: {...} }
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      days.push(d.toISOString().slice(0, 10));
    }
    const snaps = await Promise.all(days.map(d => db.ref('notifStats/' + d).once('value')));
    snaps.forEach(snap => {
      const v = snap.val();
      if (!v) return;
      Object.entries(v).forEach(([variant, stats]) => {
        const sent = (stats && stats.sent) || 0;
        const opened = (stats && stats.opened) || 0;
        totalSent += sent; totalOpened += opened;
        if (!variantTotals[variant]) variantTotals[variant] = { sent: 0, opened: 0 };
        variantTotals[variant].sent += sent;
        variantTotals[variant].opened += opened;
      });
    });
    el.textContent = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) + '%' : '--';

    const breakdownEl = document.getElementById('adminNotifOpenRateBreakdown');
    if (breakdownEl) {
      const parts = ['A', 'B'].map(v => {
        const s = variantTotals[v];
        if (!s || s.sent === 0) return `${v}: --`;
        return `${v}: ${Math.round((s.opened / s.sent) * 100)}% (${s.sent})`;
      });
      breakdownEl.textContent = parts.join(' · ');
    }
  } catch (e) {
    console.warn('loadNotifOpenRate error', e);
    el.textContent = '--';
  }
}

// Agrège dailyStats/{date}/{metric} sur les 7 derniers jours pour le
// dashboard admin — même principe que loadNotifOpenRate() juste au-dessus :
// 7 petites lectures (une par jour) au lieu de scanner jobs/job_contacts/
// reviews en entier, qui grossiraient indéfiniment avec l'usage de l'app.
async function loadDailyStats() {
  const targets = {
    jobContacts: 'adminStatContacts',
    reviewsSubmitted: 'adminStatReviews',
    signups: 'adminStatSignups',
    boostsUsed: 'adminStatBoosts',
    searches: 'adminStatSearches'
  };
  if (!Object.values(targets).some(id => document.getElementById(id))) return;
  try {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      days.push(d.toISOString().slice(0, 10));
    }
    const snaps = await Promise.all(days.map(d => db.ref('dailyStats/' + d).once('value')));
    const totals = {};
    snaps.forEach(snap => {
      const v = snap.val();
      if (!v) return;
      Object.entries(v).forEach(([metric, count]) => {
        totals[metric] = (totals[metric] || 0) + (count || 0);
      });
    });
    Object.entries(targets).forEach(([metric, elId]) => {
      const el = document.getElementById(elId);
      if (el) el.textContent = totals[metric] || 0;
    });
  } catch (e) {
    console.warn('loadDailyStats error', e);
    Object.values(targets).forEach(elId => {
      const el = document.getElementById(elId);
      if (el) el.textContent = '--';
    });
  }
}

async function loadPendingVerifications() {
  const list = document.getElementById('adminVerificationsList');
  if (!list) return;
  list.innerHTML = `<div style="font-size:13px;color:var(--text-dim);">${t('adminLoading')}</div>`;

  try {
    const snap = await db.ref('profiles').orderByChild('verificationRequested').startAt(1).once('value');
    const pending = [];
    snap.forEach(child => {
      const p = child.val();
      if (p && !p.verified) pending.push({ uid: child.key, ...p });
    });

    if (pending.length === 0) {
      list.innerHTML = `<div style="font-size:13px;color:var(--text-dim);margin-bottom:16px;">${t('adminNoPending')}</div>`;
      return;
    }

    list.innerHTML = pending.map(p => {
      const docs = p.verificationDocs || {};
      const photos = (docs.idPhotoUrl || docs.selfiePhotoUrl) ? `
        <div style="display:flex;gap:6px;margin-top:8px;">
          ${docs.idPhotoUrl ? `<a href="${docs.idPhotoUrl}" target="_blank" rel="noopener"><img src="${cloudinaryResize(docs.idPhotoUrl, 120, 120)}" loading="lazy" alt="${t('altIdSubmitted')}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--border);"></a>` : ''}
          ${docs.selfiePhotoUrl ? `<a href="${docs.selfiePhotoUrl}" target="_blank" rel="noopener"><img src="${cloudinaryResize(docs.selfiePhotoUrl, 120, 120)}" loading="lazy" alt="${t('altSelfieSubmitted')}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;border:1px solid var(--border);"></a>` : ''}
        </div>` : `<div style="font-size:11px;color:var(--danger,#e74c3c);margin-top:6px;">${t('adminNoDocWarning')}</div>`;
      return `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <div style="font-weight:700;font-size:14px;">${escapeHtml(p.name || p.company || t('adminNoName'))}</div>
          <div style="font-size:12px;color:var(--text-dim);">${escapeHtml(p.jobTitle || t('adminNoJobTitle'))}</div>
          <div style="font-size:12px;color:var(--green,#25D366);margin-top:2px;">📱 ${p.whatsappNumber ? escapeHtml(p.whatsappNumber) : 'Non renseigné'}</div>
          ${photos}
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button onclick="approveVerification('${p.uid}')" style="background:var(--blue);border:none;color:white;padding:8px 12px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;">${t('adminApprove')}</button>
          <button onclick="rejectVerification('${p.uid}')" style="background:none;border:1px solid var(--border);color:var(--text-dim);padding:8px 12px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;">${t('adminReject')}</button>
        </div>
      </div>
    `;}).join('');
  } catch (e) {
    console.error('loadPendingVerifications error', e);
    list.innerHTML = '<div style="font-size:13px;color:var(--danger);">Erreur de chargement.</div>';
  }
}

// Approuver ne rend plus le profil "verified" instantanément : ça génère un code
// à 7 chiffres, l'enregistre sur le profil, et ouvre WhatsApp pré-rempli vers le
// numéro fourni par le demandeur pour le lui transmettre. Le profil ne passera à
// verified: true que lorsque la personne aura saisi ce code dans l'app (voir
// confirmVerificationCode). Les documents restent visibles tant que le code n'a
// pas été confirmé, au cas où il faille les revérifier.
async function approveVerification(uid) {
  // Ouvert tout de suite, dans le même clic, avant les appels Firebase ci-dessous
  // (voir openWhatsAppPlaceholderTab) pour ne jamais être bloqué par le navigateur.
  const waWindow = openWhatsAppPlaceholderTab();
  try {
    const snap = await db.ref('profiles/' + uid).once('value');
    const profile = snap.val() || {};
    const code = generateVerificationCode();

    await db.ref('profiles/' + uid).update({ verificationCode: code, verificationRequested: null });

    const name = profile.name || profile.company || 'Utilisateur';
    const whatsappNumber = profile.whatsappNumber;

    if (whatsappNumber) {
      const message = `Bonjour ${name}, ta demande de vérification JobMarket a été acceptée ✅.\nVoici ton code de vérification à saisir dans l'app : ${code}`;
      openWhatsAppReliably(waWindow, whatsappNumber, message);
      showToast(t('toastCodeGenerated'), 'success');
    } else {
      if (waWindow) waWindow.close();
      showToast(t('noWhatsappManualCode').replace('{code}', code), 'info');
    }
    loadPendingVerifications();
  } catch (e) {
    console.error('approveVerification error', e);
    if (waWindow) waWindow.close();
    showToast(t('toastValidationError'), 'error');
  }
}

async function rejectVerification(uid) {
  if (!confirm('Refuser cette demande ? La personne pourra en refaire une plus tard.')) return;
  try {
    await db.ref('profiles/' + uid).update({ verificationRequested: null, verificationDocs: null });
    showToast(t('toastRequestRejected'), 'info');
    loadPendingVerifications();
  } catch (e) {
    console.error('rejectVerification error', e);
    showToast(t('toastGenericError'), 'error');
  }
}

function loadAdminJobs() {
  const list = document.getElementById('adminJobsList');
  list.innerHTML = allJobs.map(job => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:700;font-size:14px;">${escapeHtml(job.title)}</div>
        <div style="font-size:12px;color:var(--text-dim);">${escapeHtml(job.userName) || t('adminAnonymous')} - ${getCatLabel(job.icon)}</div>
      </div>
      <button onclick="deleteJob('${job.id}')" style="background:var(--danger);border:none;color:white;padding:8px 12px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;">${t('adminDeleteBtn')}</button>
    </div>
  `).join('');
  // Avant : ne comptait que les gens ayant publié un job (sous-estimait le total).
  // Maintenant : compte tous les profils enregistrés (profilesCache est déjà tenu
  // à jour en temps réel par syncProfilesCache()).
  document.getElementById('adminTotalUsers').textContent = Object.keys(profilesCache).length;
}

async function deleteJob(id) {
  if (!confirm('Supprimer ce job ?')) return;
  try {
    await db.ref('jobs/' + id).remove();
    showToast(t('toastJobDeleted'), 'success');
    loadAdminJobs();
  } catch(e) { showToast(t('toastDeleteError'), 'error'); }
}

// Récupère les annonces d'UN utilisateur directement depuis Firebase (pas
// depuis allJobs, plafonné à JOBS_LIMIT) — sinon une personne dont
// l'annonce est plus ancienne que ce plafond ne la verrait plus dans "Mes
// publications", alors qu'elle reste bien en ligne pour tout le monde.
async function fetchUserJobs(uid) {
  const snap = await db.ref('jobs').orderByChild('user').equalTo(uid).once('value');
  const jobs = [];
  snap.forEach(child => jobs.push({ ...child.val(), id: child.key }));
  return jobs;
}

async function openMyJobs() {
  if (!currentUser || currentUser.isAnonymous) { showToast(t('toastPleaseLogin'), 'error'); return; }
  const myJobs = await fetchUserJobs(currentUser.uid);
  if (myJobs.length === 0) { showToast(t('toastNoListingsFound'), 'info'); return; }
  showToast(t('myPublicationsCount').replace('{n}', myJobs.length), 'info');
  closeOverlay('accountPage');
  openSheet('jobsSheet');
  updateJobsList(myJobs);
  checkBoostExpiry(myJobs);
}

// Prévient le propriétaire quand une de ses annonces boostées arrive à
// échéance sous 24h, avec un bouton pour la renouveler en un tap (réutilise
// useBoostCredit(), déjà utilisé pour un premier boost — prolonger revient
// au même : nouvelle échéance à +7 jours, un crédit consommé). Un seul
// rappel affiché à la fois — la plus proche de l'échéance — et seulement
// si un crédit est disponible, sinon rien à proposer.
async function checkBoostExpiry(myJobs) {
  const now = Date.now();
  const soon = myJobs
    .filter(j => j.boosted && j.boostedUntil > now && (j.boostedUntil - now) < 24 * 60 * 60 * 1000)
    .sort((a, b) => a.boostedUntil - b.boostedUntil)[0];
  if (!soon) return;

  try {
    const snap = await db.ref('profiles/' + currentUser.uid + '/boostCredits').once('value');
    const credits = snap.val() || 0;
    if (credits <= 0) return;

    const hoursLeft = Math.max(1, Math.round((soon.boostedUntil - now) / (60 * 60 * 1000)));
    const banner = document.getElementById('boostExpiryBanner');
    const body = document.getElementById('boostExpiryBody');
    const renewBtn = document.getElementById('boostExpiryRenewBtn');
    if (!banner || !body || !renewBtn) return;
    // Contrairement aux 2 autres bandeaux, celui-ci n'a pas de boucle de
    // retentative dédiée — s'il est occupé maintenant, on laisse passer
    // cette fois (checkBoostExpiry sera rappelée au prochain chargement).
    if (isBottomBannerBusy('boostExpiryBanner')) return;

    body.textContent = t('boostExpiryBody').replace('{title}', soon.title).replace('{hours}', hoursLeft);
    renewBtn.onclick = async () => { await useBoostCredit(soon.id); dismissBoostExpiryBanner(); };
    banner.style.display = 'block';
  } catch (e) {
    console.warn('checkBoostExpiry error', e);
  }
}

function dismissBoostExpiryBanner() {
  const banner = document.getElementById('boostExpiryBanner');
  if (banner) banner.style.display = 'none';
}

// ===== PRÉFÉRENCES DE NOTIFICATION PAR CATÉGORIE =====
// Même modèle "sparse" que la présence/les tokens : on ne stocke QUE les
// catégories explicitement décochées (false) sous notifyPrefs/{uid}/.
// Absence de préférence = catégorie activée par défaut. Ça évite toute
// migration pour les comptes existants, et scripts/sendNotifications.js
// applique exactement la même règle côté serveur pour filtrer les push.
const NOTIF_CATEGORIES = [
  { key: 'btp', i18n: 'optBtp', color: '#FF9500' },
  { key: 'electricite', i18n: 'optElec', color: '#FFD700' },
  { key: 'plomberie', i18n: 'optPlomberie', color: '#007AFF' },
  { key: 'menage', i18n: 'optMenage', color: '#25D366' },
  { key: 'jardinage', i18n: 'optJardinage', color: '#34C759' },
  { key: 'mecanique', i18n: 'optMecanique', color: '#FF3B30' },
  { key: 'informatique', i18n: 'optInfo', color: '#AF52DE' }
];

async function openNotifPrefs() {
  if (!currentUser || currentUser.isAnonymous) { showToast(t('toastPleaseLogin'), 'error'); return; }
  closeOverlay('accountPage');
  openOverlay('notifPrefsPage');

  const list = document.getElementById('notifPrefsList');
  list.innerHTML = '';

  let prefs = {};
  try {
    const snap = await db.ref('notifyPrefs/' + currentUser.uid).once('value');
    prefs = snap.val() || {};
  } catch (e) {
    console.warn('Chargement préférences notif échoué', e);
  }

  const currentMaxDist = typeof prefs.maxDistanceKm === 'number' ? prefs.maxDistanceKm : 25;
  const hasLocation = !!(userCoords && typeof userCoords.lat === 'number');

  const gpsNudge = hasLocation ? '' : `
    <div id="notifGpsNudge" style="background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.25);border-radius:14px;padding:14px;margin-bottom:16px;display:flex;gap:12px;align-items:center;">
      <span style="font-size:22px;flex-shrink:0;">📍</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;color:var(--text);font-weight:600;margin-bottom:2px;" data-i18n="notifGpsNudgeTitle">Position non activée</div>
        <div style="font-size:12px;color:var(--text-dim);" data-i18n="notifGpsNudgeBody">Activez votre position pour que le filtre de distance ci-dessous fonctionne vraiment.</div>
      </div>
      <button onclick="locateMe(); setTimeout(openNotifPrefs, 800);" style="flex-shrink:0;padding:8px 14px;background:var(--gold,#FFD700);border:none;border-radius:10px;color:#0A0A0F;font-size:12px;font-weight:700;cursor:pointer;" data-i18n="notifGpsNudgeBtn">Activer</button>
    </div>`;

  list.innerHTML = gpsNudge + NOTIF_CATEGORIES.map(cat => {
    const checked = prefs[cat.key] !== false; // pas de préférence enregistrée = activé
    return `<label style="display:flex;align-items:center;gap:12px;padding:14px 4px;border-bottom:1px solid var(--border,#222);cursor:pointer;">
      <span style="width:10px;height:10px;border-radius:50%;background:${cat.color};flex-shrink:0;"></span>
      <span style="flex:1;">${t(cat.i18n)}</span>
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="setNotifCategoryPref('${cat.key}', this.checked)" style="width:20px;height:20px;accent-color:var(--gold,#FFD700);"/>
    </label>`;
  }).join('') + `
    <div style="padding:18px 4px 4px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span data-i18n="notifDistanceLabel">Distance maximale</span>
        <span id="notifDistanceValue" style="color:var(--gold,#FFD700);font-weight:700;">${currentMaxDist} km</span>
      </div>
      <input type="range" min="5" max="100" step="5" value="${currentMaxDist}"
        oninput="document.getElementById('notifDistanceValue').textContent = this.value + ' km'"
        onchange="setNotifDistancePref(parseInt(this.value, 10))"
        style="width:100%;accent-color:var(--gold,#FFD700);">
      <div style="color:var(--text-dim);font-size:12px;margin-top:6px;" data-i18n="notifDistanceHint">Vous ne serez notifié(e) que pour les jobs situés dans ce rayon autour de votre position (nécessite la géolocalisation activée).</div>
    </div>`;
  applyTranslations();
}

async function setNotifDistancePref(km) {
  if (!currentUser) return;
  try {
    await db.ref(`notifyPrefs/${currentUser.uid}/maxDistanceKm`).set(km);
  } catch (e) {
    console.warn('Écriture préférence distance échouée', e);
    showToast(t('prefSaveError'), 'error');
  }
}

async function setNotifCategoryPref(categoryKey, enabled) {
  if (!currentUser) return;
  try {
    // Réactiver = simplement retirer la clé (repli sur le comportement par
    // défaut), pas besoin d'écrire explicitement "true".
    await db.ref(`notifyPrefs/${currentUser.uid}/${categoryKey}`).set(enabled ? null : false);
  } catch (e) {
    console.warn('Écriture préférence notif échouée', e);
    showToast(t('prefSaveError'), 'error');
  }
}

// ===== CHAT (assistant "Chat sécurisé", propulsé par Llama 3.3 70B via
// Groq — gratuit, sans carte bancaire — appelé via un worker Cloudflare
// qui garde la clé API secrète, avec repli automatique sur des réponses
// locales si le worker est indisponible ou en cas de panne réseau. Le
// prompt système vit désormais dans worker/chat-proxy.js, pas ici, pour
// n'avoir qu'une seule version faisant foi.) =====

let chatHistory = []; // historique envoyé à l'API — en mémoire seulement
let chatLoading = false;

function openChat() {
  closeOverlay('accountPage');
  openOverlay('chatPage');
}

function scrollChatToBottom() {
  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

function addChatBubble(role, text, isError) {
  const container = document.getElementById('chatMessages');
  const el = document.createElement('div');
  el.className = 'chat-msg ' + (role === 'user' ? 'mine' : 'theirs') + (isError ? ' error' : '');
  el.textContent = text;
  container.appendChild(el);
  scrollChatToBottom();
  return el;
}

function showChatTyping() {
  const container = document.getElementById('chatMessages');
  const el = document.createElement('div');
  el.className = 'chat-msg theirs';
  el.id = 'chatTypingIndicator';
  el.textContent = '···';
  container.appendChild(el);
  scrollChatToBottom();
}

function hideChatTyping() {
  const el = document.getElementById('chatTypingIndicator');
  if (el) el.remove();
}

// No external model or API key is used by this chat.
// NOTE : le chat reste volontairement 100% local (voir callChatAI plus bas) plutôt que
// d'appeler une IA distante. Sur un site statique comme celui-ci, une clé d'API IA
// placée dans le code serait visible par n'importe qui et pourrait être volée/abusée —
// ce qui contredirait la promesse « Hors ligne · privé » affichée dans le chat.
// Tout le texte ci-dessous est traduit dans les 5 langues de l'app (fr/en/it/de/zh) et
// la réponse renvoyée dépend toujours de currentLang, pour que l'assistant réponde dans
// la langue actuellement choisie plutôt que toujours en français.

const CHAT_NUM_LOCALE = { fr: 'fr-FR', en: 'en-US', it: 'it-IT', de: 'de-DE', zh: 'zh-CN' };

// Petites phrases (salutations, aide, absence de réponse...) traduites dans les 5
// langues. {topics} est remplacé par la liste des sujets (topicsSummary) au moment de
// l'affichage.
const CHAT_STRINGS = {
  fr: {
    greeting: `Bonjour ! Posez-moi une question sur JobMarket, un prix, une marge ou la sécurité d'un profil.`,
    thanks: `Avec plaisir ! N'hésitez pas si vous avez une autre question.`,
    goodbye: `À bientôt sur JobMarket !`,
    help: `Je peux vous aider sur : {topics}. Posez votre question directement, ou touchez une suggestion ci-dessus.`,
    emptyPrompt: `Écrivez votre question et je vous répondrai sur les fonctions de JobMarket, les prix ou la sécurité.`,
    noAnswer: `Je n'ai pas de réponse approuvée pour ce sujet précis. Je peux aider avec : {topics}. Pour une décision financière importante ou une accusation de fraude, demandez une vérification humaine.`,
    topicsSummary: `publier une demande (bouton + ou appui long sur la carte), trouver un artisan, contacter par WhatsApp, repérer une arnaque, calculer un prix, une marge ou un pourcentage, faire un calcul rapide (ex : 2500*8), le compte et le Profil Pro, gérer vos publications, laisser un avis, vérifier votre numéro par SMS, les photos, la carte et l'itinéraire, et les notifications`,
    marginTemplate: `Avec un coût de {cost} FCFA et un prix de vente de {price} FCFA, la marge brute est de {margin} FCFA par unité ({rate} % du prix de vente). C'est une estimation : retirez aussi transport, matériel, commissions et taxes avant de décider.`,
    calcTemplate: `Résultat : {expr} = {result}.`,
    percentTemplate: `{rate} % de {base} FCFA = {result} FCFA.`,
    percentDiscountTemplate: `Avec une remise de {rate} % sur {base} FCFA, la réduction est de {result} FCFA — nouveau prix : {finalPrice} FCFA.`
  },
  en: {
    greeting: `Hello! Ask me a question about JobMarket, a price, a margin, or a profile's safety.`,
    thanks: `You're welcome! Feel free to ask if you have another question.`,
    goodbye: `See you soon on JobMarket!`,
    help: `I can help with: {topics}. Ask your question directly, or tap a suggestion above.`,
    emptyPrompt: `Type your question and I'll answer about JobMarket's features, pricing, or safety.`,
    noAnswer: `I don't have an approved answer for that exact topic. I can help with: {topics}. For an important financial decision or a fraud accusation, ask for a human review.`,
    topicsSummary: `posting a request (+ button or long-press on the map), finding a tradesperson, contacting via WhatsApp, spotting a scam, calculating a price, a margin or a percentage, doing a quick calculation (e.g. 2500*8), your account and Pro Profile, managing your listings, leaving a review, verifying your phone by SMS, photos, the map and route, and notifications`,
    marginTemplate: `With a cost of {cost} FCFA and a selling price of {price} FCFA, the gross margin is {margin} FCFA per unit ({rate}% of the selling price). This is an estimate: also subtract transport, materials, commissions and taxes before deciding.`,
    calcTemplate: `Result: {expr} = {result}.`,
    percentTemplate: `{rate}% of {base} FCFA = {result} FCFA.`,
    percentDiscountTemplate: `With a {rate}% discount on {base} FCFA, the reduction is {result} FCFA — new price: {finalPrice} FCFA.`
  },
  it: {
    greeting: `Ciao! Fammi una domanda su JobMarket, un prezzo, un margine o la sicurezza di un profilo.`,
    thanks: `Con piacere! Non esitare se hai un'altra domanda.`,
    goodbye: `A presto su JobMarket!`,
    help: `Posso aiutarti su: {topics}. Fai la tua domanda direttamente, oppure tocca un suggerimento qui sopra.`,
    emptyPrompt: `Scrivi la tua domanda e ti risponderò sulle funzioni di JobMarket, i prezzi o la sicurezza.`,
    noAnswer: `Non ho una risposta approvata per questo argomento specifico. Posso aiutarti con: {topics}. Per una decisione finanziaria importante o un'accusa di frode, richiedi una verifica umana.`,
    topicsSummary: `pubblicare una richiesta (pulsante + o pressione prolungata sulla mappa), trovare un artigiano, contattare via WhatsApp, riconoscere una truffa, calcolare un prezzo, un margine o una percentuale, fare un calcolo rapido (es. 2500*8), l'account e il Profilo Pro, gestire i tuoi annunci, lasciare una recensione, verificare il tuo numero via SMS, le foto, la mappa e l'itinerario, e le notifiche`,
    marginTemplate: `Con un costo di {cost} FCFA e un prezzo di vendita di {price} FCFA, il margine lordo è di {margin} FCFA per unità ({rate}% del prezzo di vendita). È una stima: sottrai anche trasporto, materiali, commissioni e tasse prima di decidere.`,
    calcTemplate: `Risultato: {expr} = {result}.`,
    percentTemplate: `{rate}% di {base} FCFA = {result} FCFA.`,
    percentDiscountTemplate: `Con uno sconto del {rate}% su {base} FCFA, la riduzione è di {result} FCFA — nuovo prezzo: {finalPrice} FCFA.`
  },
  de: {
    greeting: `Hallo! Stellen Sie mir eine Frage zu JobMarket, einem Preis, einer Marge oder der Sicherheit eines Profils.`,
    thanks: `Gern geschehen! Fragen Sie ruhig, wenn Sie noch etwas wissen möchten.`,
    goodbye: `Bis bald auf JobMarket!`,
    help: `Ich kann Ihnen helfen bei: {topics}. Stellen Sie Ihre Frage direkt oder tippen Sie oben auf einen Vorschlag.`,
    emptyPrompt: `Schreiben Sie Ihre Frage und ich antworte zu den Funktionen von JobMarket, Preisen oder Sicherheit.`,
    noAnswer: `Ich habe keine geprüfte Antwort zu genau diesem Thema. Ich kann helfen bei: {topics}. Bei einer wichtigen finanziellen Entscheidung oder einem Betrugsverdacht bitten Sie um eine menschliche Prüfung.`,
    topicsSummary: `eine Anfrage veröffentlichen (Schaltfläche + oder langes Drücken auf der Karte), einen Handwerker finden, über WhatsApp Kontakt aufnehmen, Betrug erkennen, einen Preis, eine Marge oder einen Prozentsatz berechnen, eine schnelle Rechnung machen (z. B. 2500*8), Ihr Konto und Profi-Profil, Ihre Anzeigen verwalten, eine Bewertung hinterlassen, Ihre Nummer per SMS verifizieren, Fotos, die Karte und Route sowie Benachrichtigungen`,
    marginTemplate: `Bei Kosten von {cost} FCFA und einem Verkaufspreis von {price} FCFA beträgt die Bruttomarge {margin} FCFA pro Einheit ({rate}% des Verkaufspreises). Dies ist eine Schätzung: Ziehen Sie vor einer Entscheidung auch Transport, Material, Provisionen und Steuern ab.`,
    calcTemplate: `Ergebnis: {expr} = {result}.`,
    percentTemplate: `{rate}% von {base} FCFA = {result} FCFA.`,
    percentDiscountTemplate: `Bei einem Rabatt von {rate}% auf {base} FCFA beträgt die Ermäßigung {result} FCFA — neuer Preis: {finalPrice} FCFA.`
  },
  zh: {
    greeting: `您好!请向我提问关于JobMarket、价格、利润或资料安全性的问题。`,
    thanks: `不客气!如果还有其他问题,请随时问我。`,
    goodbye: `JobMarket再见!`,
    help: `我可以帮助您了解:{topics}。您可以直接输入问题,或点击上方的建议。`,
    emptyPrompt: `请输入您的问题,我会为您解答关于JobMarket功能、价格或安全方面的内容。`,
    noAnswer: `我没有针对这个具体话题的标准答案。我可以帮助您了解:{topics}。对于重要的财务决定或欺诈指控,请申请人工审核。`,
    topicsSummary: `发布需求(点击+按钮或在地图上长按)、寻找工匠、通过WhatsApp联系、识别诈骗、计算价格、利润或百分比、快速运算(例如 2500*8)、账户与专业资料、管理您的发布信息、留下评价、通过短信验证您的号码、照片、地图与路线,以及通知`,
    marginTemplate: `成本为{cost} FCFA,销售价格为{price} FCFA时,每单位毛利为{margin} FCFA(占销售价格的{rate}%)。这只是估算:做决定前还需扣除运输、材料、佣金和税费。`,
    calcTemplate: `结果:{expr} = {result}。`,
    percentTemplate: `{base} FCFA 的 {rate}% = {result} FCFA。`,
    percentDiscountTemplate: `在 {base} FCFA 上享受 {rate}% 折扣,减免金额为 {result} FCFA — 新价格:{finalPrice} FCFA。`
  }
};

// Retourne une phrase courte (CHAT_STRINGS) dans la langue actuelle, avec repli sur le
// français si la langue n'existe pas ou si la clé est absente.
function csText(key) {
  const lang = (typeof currentLang !== 'undefined' && CHAT_STRINGS[currentLang]) ? currentLang : 'fr';
  return (CHAT_STRINGS[lang] && CHAT_STRINGS[lang][key]) || CHAT_STRINGS.fr[key] || '';
}

// Base de connaissances locale : chaque sujet a des mots-clés dans les 5 langues (pour
// reconnaître la question quelle que soit la langue tapée par l'utilisateur) et une
// réponse traduite dans les 5 langues (pour répondre dans la langue actuellement
// sélectionnée au lieu de toujours répondre en français).
const LOCAL_CHAT_KNOWLEDGE = [
  {
    terms:['boost','mise en avant','mettre en avant','credit de boost','renouveler le boost','expire bientot','booster mon annonce','boost my listing','highlight my listing','boost credit','renew my boost','expiring soon','promuovere il mio annuncio','credito di promozione','rinnovare la promozione','sta per scadere','anzeige hervorheben','boost guthaben','hervorhebung verlangern','lauft bald ab','置顶推广','推广额度','续期推广','即将到期'],
    answers: {
      fr: `Une annonce boostée 🚀 reste en tête du classement pendant 7 jours. Vous gagnez des crédits de boost en parrainant d'autres utilisateurs (Compte → Parrainage). Quand un boost approche de son expiration, un bandeau propose de le renouveler en un tap depuis « Mes publications » si vous avez un crédit disponible.`,
      en: `A boosted 🚀 listing stays at the top of the ranking for 7 days. You earn boost credits by referring other users (Account → Referral). When a boost is about to expire, a banner offers a one-tap renewal from "My listings" if you have a credit available.`,
      it: `Un annuncio promosso 🚀 resta in cima alla classifica per 7 giorni. Guadagni crediti promozione invitando altri utenti (Account → Programma referral). Quando una promozione sta per scadere, un banner propone di rinnovarla in un tocco da «I miei annunci» se hai un credito disponibile.`,
      de: `Eine hervorgehobene 🚀 Anzeige bleibt 7 Tage lang ganz oben in der Rangliste. Sie erhalten Boost-Guthaben, indem Sie andere Nutzer werben (Konto → Empfehlungsprogramm). Wenn eine Hervorhebung bald abläuft, bietet ein Banner unter "Meine Anzeigen" eine Verlängerung mit einem Tippen an, sofern Sie ein Guthaben haben.`,
      zh: `置顶推广🚀的发布信息会在排名中保持首位7天。通过邀请其他用户注册(账户→推荐计划)可获得推广额度。当推广即将到期时,如果您还有可用额度,系统会在"我的发布"页面弹出提示,一键即可续期。`
    }
  },
  {
    terms:['partager','partager une annonce','partager sur whatsapp','diffuser mon annonce','lien de partage','share a listing','share on whatsapp','spread my listing','share link','condividere un annuncio','condividere su whatsapp','link di condivisione','anzeige teilen','auf whatsapp teilen','freigabelink','分享发布','分享到whatsapp','分享链接'],
    answers: {
      fr: `Ouvrez une annonce sur la carte et appuyez sur « Partager » pour l'envoyer sur WhatsApp avec un lien direct — utile pour toucher plus de monde. Juste après avoir publié une annonce, l'app vous propose aussi de la partager immédiatement.`,
      en: `Open a listing on the map and tap "Share" to send it on WhatsApp with a direct link — useful for reaching more people. Right after posting a listing, the app also offers to share it immediately.`,
      it: `Apri un annuncio sulla mappa e tocca «Condividi» per inviarlo su WhatsApp con un link diretto — utile per raggiungere più persone. Subito dopo aver pubblicato un annuncio, l'app propone anche di condividerlo immediatamente.`,
      de: `Öffnen Sie eine Anzeige auf der Karte und tippen Sie auf "Teilen", um sie mit einem direkten Link auf WhatsApp zu senden — nützlich, um mehr Leute zu erreichen. Direkt nach der Veröffentlichung schlägt die App auch vor, die Anzeige sofort zu teilen.`,
      zh: `在地图上打开一条发布信息,点击"分享"即可通过WhatsApp发送直达链接——有助于触达更多人。发布成功后,应用也会立即提示您分享该发布信息。`
    }
  },
  {
    terms:['mes publications','ma publication','supprimer une annonce','supprimer mon job','modifier une annonce','modifier mon job','my listings','my listing','delete a listing','delete my job','edit a listing','edit my job','i miei annunci','eliminare un annuncio','modificare un annuncio','meine anzeigen','anzeige loschen','anzeige bearbeiten','我的发布','删除发布','修改发布'],
    answers: {
      fr: `Ouvrez Compte → « Mes publications » (connexion requise) pour voir toutes vos annonces, avec un bouton pour supprimer celles que vous avez publiées. Il n'y a pas encore de modification directe : supprimez l'ancienne annonce puis republiez-en une nouvelle à jour.`,
      en: `Open Account → "My listings" (login required) to see all your listings, with a button to delete the ones you posted. There is no direct editing yet: delete the old listing and post a new, up-to-date one instead.`,
      it: `Apri Account → «I miei annunci» (accesso richiesto) per vedere tutti i tuoi annunci, con un pulsante per eliminare quelli che hai pubblicato. Non è ancora possibile modificarli direttamente: elimina il vecchio annuncio e pubblicane uno nuovo aggiornato.`,
      de: `Öffnen Sie Konto → "Meine Anzeigen" (Anmeldung erforderlich), um alle Ihre Anzeigen zu sehen, mit einer Schaltfläche zum Löschen der von Ihnen veröffentlichten. Eine direkte Bearbeitung ist noch nicht möglich: Löschen Sie die alte Anzeige und veröffentlichen Sie stattdessen eine neue, aktuelle.`,
      zh: `打开"我的账户"→"我的发布"(需要登录)查看您所有的发布信息,并可删除您发布过的信息。目前还不支持直接修改:请删除旧的发布,然后重新发布一条最新的信息。`
    }
  },
  {
    terms:['profil pro','mon profil','completer mon profil','photo de profil','competences','specialite','metier','pro profile','my profile','complete my profile','profile photo','my skills','my specialty','my trade','profilo pro','il mio profilo','le mie competenze','la mia specialita','il mio mestiere','profi-profil','mein profil','meine fahigkeiten','mein fachgebiet','mein beruf','专业资料','我的资料','我的技能','我的专长','我的职业'],
    answers: {
      fr: `Dans Compte → « Mon Profil Pro », renseignez votre nom (ou société), votre métier/spécialité, vos compétences et une photo si vous le souhaitez. Un profil complet (nom ou société, et métier/spécialité) est nécessaire pour contacter un artisan par WhatsApp ou partager une annonce.`,
      en: `In Account → "My Pro Profile", fill in your name (or company), your trade/specialty, your skills and a photo if you'd like. A complete profile (name or company, plus trade/specialty) is required to contact a tradesperson on WhatsApp or share a listing.`,
      it: `In Account → «Il mio profilo Pro», inserisci il tuo nome (o azienda), il tuo mestiere/specialità, le tue competenze e una foto se lo desideri. Un profilo completo (nome o azienda, e mestiere/specialità) è necessario per contattare un artigiano su WhatsApp o condividere un annuncio.`,
      de: `Geben Sie unter Konto → "Mein Profi-Profil" Ihren Namen (oder Ihre Firma), Ihren Beruf/Ihre Spezialität, Ihre Fähigkeiten und optional ein Foto an. Ein vollständiges Profil (Name oder Firma sowie Beruf/Spezialität) ist erforderlich, um einen Handwerker über WhatsApp zu kontaktieren oder eine Anzeige zu teilen.`,
      zh: `在"我的账户"→"我的专业资料"中,填写您的姓名(或公司名)、职业/专长、技能,如果需要还可以上传照片。完整的资料(姓名或公司名,以及职业/专长)是通过WhatsApp联系工匠或分享发布信息的必要条件。`
    }
  },
  {
    terms:['photo','photos','image','images','picture','pictures','foto','immagine','immagini','bild','bilder','照片','图片'],
    answers: {
      fr: `Vous pouvez ajouter jusqu'à 5 photos (JPG ou PNG) à une annonce depuis la zone « Ajouter des photos » du formulaire de publication. Elles sont compressées automatiquement pour rester rapides à charger, même avec une connexion lente.`,
      en: `You can add up to 5 photos (JPG or PNG) to a listing from the "Add photos" area of the posting form. They are automatically compressed to stay fast to load, even on a slow connection.`,
      it: `Puoi aggiungere fino a 5 foto (JPG o PNG) a un annuncio dall'area «Aggiungi foto» del modulo di pubblicazione. Vengono compresse automaticamente per rimanere veloci da caricare, anche con una connessione lenta.`,
      de: `Sie können bis zu 5 Fotos (JPG oder PNG) über den Bereich "Fotos hinzufügen" im Veröffentlichungsformular zu einer Anzeige hinzufügen. Sie werden automatisch komprimiert, damit sie auch bei langsamer Verbindung schnell laden.`,
      zh: `您可以在发布表单的"添加照片"区域为发布信息添加最多5张照片(JPG或PNG格式)。照片会自动压缩,即使网络较慢也能快速加载。`
    }
  },
  {
    terms:['zoom','satellite','style carte','style de carte','vue plan','ma position','localiser','distance','map style','plan view','my location','locate me','stile mappa','la mia posizione','kartenstil','mein standort','meine entfernung','缩放','卫星地图','地图样式','我的位置','距离徽章'],
    answers: {
      fr: `Les boutons sur le côté droit de la carte permettent de centrer sur votre position, zoomer/dézoomer, et basculer entre vue satellite et plan. Le badge « Distance » indique la distance jusqu'au job le plus éloigné actuellement affiché.`,
      en: `The buttons on the right side of the map let you center on your location, zoom in/out, and switch between satellite and map view. The "Distance" badge shows the distance to the farthest job currently displayed.`,
      it: `I pulsanti sul lato destro della mappa permettono di centrare sulla tua posizione, zoomare avanti/indietro e passare dalla vista satellitare a quella cartina. Il badge «Distanza» indica la distanza dal lavoro più lontano attualmente visualizzato.`,
      de: `Mit den Schaltflächen auf der rechten Seite der Karte können Sie auf Ihren Standort zentrieren, vergrößern/verkleinern und zwischen Satelliten- und Kartenansicht wechseln. Das Abzeichen "Entfernung" zeigt die Entfernung zum derzeit am weitesten entfernten angezeigten Job.`,
      zh: `地图右侧的按钮可以让您定位到自己的位置、放大/缩小,以及在卫星视图和平面地图之间切换。"距离"徽章显示到当前显示的最远工作的距离。`
    }
  },
  {
    terms:['itineraire','trajet','chemin','route vers','see route','get directions','way to get','path to','itinerario','percorso','tragitto','route anzeigen','wegbeschreibung','查看路线','行程路线'],
    answers: {
      fr: `Ouvrez une annonce puis appuyez sur « Voir l'itinéraire » : la carte trace le chemin depuis votre position et affiche la distance et le temps estimé. Utilisez « Annuler » dans le panneau itinéraire pour l'effacer.`,
      en: `Open a listing then tap "See route": the map draws the path from your location and shows the distance and estimated time. Use "Cancel" in the route panel to clear it.`,
      it: `Apri un annuncio poi tocca «Vedi itinerario»: la mappa traccia il percorso dalla tua posizione e mostra la distanza e il tempo stimato. Usa «Annulla» nel pannello itinerario per cancellarlo.`,
      de: `Öffnen Sie eine Anzeige und tippen Sie auf "Route anzeigen": Die Karte zeichnet den Weg von Ihrem Standort aus und zeigt Entfernung und geschätzte Zeit an. Verwenden Sie "Abbrechen" im Routenfenster, um sie zu löschen.`,
      zh: `打开一条发布信息,然后点击"查看路线":地图会从您的位置绘制路径,并显示距离和预计时间。在路线面板中点击"取消"即可清除路线。`
    }
  },
  {
    terms:['notification','notifications','cloche','alerte','new jobs bell','notification bell','notifica','notifiche','campanella','benachrichtigung','glocke','新工作通知','铃铛提醒'],
    answers: {
      fr: `La cloche en haut de l'écran affiche les nouveaux jobs publiés autour de vous. Un point s'allume quand il y a du nouveau ; appuyez dessus pour voir la liste. Pour choisir les catégories qui vous intéressent, allez dans Paramètres (⚙️) → Notifications.`,
      en: `The bell at the top of the screen shows new jobs posted near you. A dot lights up when there's something new; tap it to see the list. To choose which categories you're interested in, go to Settings (⚙️) → Notifications.`,
      it: `La campanella in alto sullo schermo mostra i nuovi lavori pubblicati vicino a te. Un puntino si accende quando c'è qualcosa di nuovo; toccalo per vedere l'elenco. Per scegliere le categorie che ti interessano, vai su Impostazioni (⚙️) → Notifiche.`,
      de: `Die Glocke oben im Bildschirm zeigt neue Jobs in Ihrer Nähe an. Ein Punkt leuchtet auf, wenn es etwas Neues gibt; tippen Sie darauf, um die Liste zu sehen. Um die für Sie interessanten Kategorien auszuwählen, gehen Sie zu Einstellungen (⚙️) → Benachrichtigungen.`,
      zh: `屏幕顶部的铃铛图标会显示您附近发布的新工作。有新内容时会出现一个红点;点击它即可查看列表。如需选择您感兴趣的类别,请前往"设置"(⚙️)→"通知"。`
    }
  },
  {
    terms:['gps requis','gps bloque','position refusee','autoriser ma position','gps required','gps blocked','location denied','allow my location','gps richiesto','posizione rifiutata','gps erforderlich','standort verweigert','需要gps','位置被拒绝'],
    answers: {
      fr: `Si « GPS requis pour publier » s'affiche, votre téléphone ou navigateur a refusé l'accès à la position. Autorisez la localisation dans les réglages du navigateur pour ce site, puis réessayez. Si vous avez choisi l'emplacement par appui long sur la carte, cette autorisation n'est pas nécessaire : la position choisie est utilisée directement.`,
      en: `If "GPS required to post" appears, your phone or browser has denied location access. Allow location for this site in your browser settings, then try again. If you chose the location with a long press on the map, this permission isn't needed: the chosen spot is used directly.`,
      it: `Se compare «GPS richiesto per pubblicare», il telefono o il browser ha rifiutato l'accesso alla posizione. Consenti la geolocalizzazione per questo sito nelle impostazioni del browser, poi riprova. Se hai scelto il punto con una pressione prolungata sulla mappa, questa autorizzazione non è necessaria: la posizione scelta viene usata direttamente.`,
      de: `Wenn "GPS zum Veröffentlichen erforderlich" angezeigt wird, hat Ihr Telefon oder Browser den Standortzugriff verweigert. Erlauben Sie die Standortfreigabe für diese Website in den Browsereinstellungen und versuchen Sie es erneut. Wenn Sie den Ort durch langes Drücken auf der Karte gewählt haben, ist diese Berechtigung nicht nötig: Der gewählte Standort wird direkt verwendet.`,
      zh: `如果出现"发布需要GPS"提示,说明您的手机或浏览器拒绝了位置访问权限。请在浏览器设置中允许该网站获取位置信息,然后重试。如果您是通过长按地图选择位置的,则不需要此权限:所选位置会被直接使用。`
    }
  },
  {
    terms:['whatsapp ne fonctionne pas','whatsapp ne marche pas','page telecharger whatsapp','ouvrir application whatsapp','whatsapp indisponible','lien whatsapp casse','probleme whatsapp','whatsapp not working','whatsapp wont open','whatsapp download page','open app or download','whatsapp unavailable','broken whatsapp link','whatsapp problem','whatsapp non funziona','whatsapp non si apre','pagina scarica whatsapp','apri app o scarica','whatsapp non disponibile','link whatsapp rotto','problema whatsapp','whatsapp funktioniert nicht','whatsapp offnet sich nicht','whatsapp download seite','app offnen oder herunterladen','whatsapp nicht verfugbar','defekter whatsapp link','whatsapp problem','whatsapp打不开','whatsapp无法打开','下载whatsapp页面','打开应用或下载','whatsapp不可用','whatsapp链接损坏','whatsapp问题'],
    answers: {
      fr: `Le bouton WhatsApp doit ouvrir directement la conversation, sans passer par une page intermédiaire. Si une page « Ouvrir l'app / Télécharger » s'affiche quand même, c'est en général que WhatsApp n'est pas installé sur cet appareil, ou que le navigateur bloque les fenêtres pop-up : autorisez les pop-up pour ce site, ou installez WhatsApp puis réessayez. Sur ordinateur sans l'application, WhatsApp Web s'ouvre normalement à la place.`,
      en: `The WhatsApp button should open the conversation directly, without going through an intermediate page. If an "Open app / Download" page appears anyway, it's usually because WhatsApp isn't installed on this device, or the browser is blocking pop-ups: allow pop-ups for this site, or install WhatsApp and try again. On a computer without the app, WhatsApp Web opens instead.`,
      it: `Il pulsante WhatsApp deve aprire direttamente la conversazione, senza passare da una pagina intermedia. Se compare comunque una pagina «Apri app / Scarica», di solito è perché WhatsApp non è installato su questo dispositivo, oppure il browser blocca i pop-up: consenti i pop-up per questo sito, oppure installa WhatsApp e riprova. Su computer senza l'app, si apre invece WhatsApp Web.`,
      de: `Die WhatsApp-Schaltfläche sollte das Gespräch direkt öffnen, ohne eine Zwischenseite. Wenn trotzdem eine Seite "App öffnen / Herunterladen" erscheint, liegt das meist daran, dass WhatsApp auf diesem Gerät nicht installiert ist oder der Browser Pop-ups blockiert: Erlauben Sie Pop-ups für diese Website oder installieren Sie WhatsApp und versuchen Sie es erneut. Am Computer ohne die App öffnet sich stattdessen WhatsApp Web.`,
      zh: `WhatsApp按钮应该直接打开对话,而不经过中间页面。如果仍然出现"打开应用/下载"页面,通常是因为此设备未安装WhatsApp,或浏览器阻止了弹出窗口:请为此网站允许弹出窗口,或安装WhatsApp后重试。在没有安装应用的电脑上,会改为打开WhatsApp网页版。`
    }
  },
  {
    terms:['contacter','whatsapp','appeler un artisan','envoyer un message','joindre quelqu un','contact via whatsapp','call a tradesperson','send a message','reach someone','contattare','chiamare un artigiano','inviare un messaggio','kontaktieren','anrufen','nachricht senden','联系工匠','拨打电话','发送消息'],
    answers: {
      fr: `Ouvrez l'annonce puis utilisez WhatsApp seulement si vous êtes connecté et votre profil est complet. Gardez une trace écrite de ce qui est convenu : prestation, prix, délai et conditions. Ne communiquez jamais de code de connexion ou de carte bancaire.`,
      en: `Open the listing and use WhatsApp only once you're logged in and your profile is complete. Keep a written record of what's agreed: the service, price, timeline and conditions. Never share a login code or bank card details.`,
      it: `Apri l'annuncio e usa WhatsApp solo se sei connesso e il tuo profilo è completo. Tieni traccia scritta di quanto concordato: prestazione, prezzo, tempi e condizioni. Non comunicare mai codici di accesso o dati della carta bancaria.`,
      de: `Öffnen Sie die Anzeige und nutzen Sie WhatsApp nur, wenn Sie angemeldet sind und Ihr Profil vollständig ist. Halten Sie schriftlich fest, was vereinbart wurde: Leistung, Preis, Frist und Bedingungen. Geben Sie niemals einen Anmeldecode oder Bankkartendaten weiter.`,
      zh: `打开发布信息,只有在您已登录且资料完整的情况下才能使用WhatsApp联系。请保留书面记录已约定的内容:服务内容、价格、期限和条件。切勿透露登录验证码或银行卡信息。`
    }
  },
  {
    terms:['arnaque','fraude','faux profil','fake profile','escroquerie','profil suspect','securite du profil','verification du profil','scam','fraud','suspicious profile','profile safety','profile verification','truffa','frode','profilo falso','profilo sospetto','sicurezza del profilo','betrug','gefalschtes profil','verdachtiges profil','诈骗','欺诈','假资料','可疑资料','资料验证'],
    answers: {
      fr: `Un signal n'est pas une preuve de fraude. Soyez prudent si un profil est très récent, refuse un devis écrit, demande un paiement immédiat ou vous pousse à quitter la plateforme. Vérifiez les informations, gardez les échanges, et demandez une revue humaine avant d'accuser ou de bloquer quelqu'un.`,
      en: `A warning sign isn't proof of fraud. Be careful if a profile is very new, refuses a written quote, asks for immediate payment, or pushes you to leave the platform. Check the details, keep your conversations, and ask for a human review before accusing or blocking anyone.`,
      it: `Un segnale non è una prova di frode. Fai attenzione se un profilo è molto recente, rifiuta un preventivo scritto, chiede un pagamento immediato o ti spinge a lasciare la piattaforma. Verifica le informazioni, conserva gli scambi e chiedi una revisione umana prima di accusare o bloccare qualcuno.`,
      de: `Ein Warnsignal ist kein Beweis für Betrug. Seien Sie vorsichtig, wenn ein Profil sehr neu ist, ein schriftliches Angebot ablehnt, sofortige Zahlung verlangt oder Sie drängt, die Plattform zu verlassen. Überprüfen Sie die Angaben, bewahren Sie den Schriftverkehr auf und bitten Sie um eine menschliche Prüfung, bevor Sie jemanden beschuldigen oder blockieren.`,
      zh: `出现可疑信号并不代表一定是欺诈。如果某个资料非常新、拒绝提供书面报价、要求立即付款,或催促您离开平台,请务必谨慎。核实相关信息,保留聊天记录,在指控或屏蔽他人之前,请申请人工审核。`
    }
  },
  {
    terms:['prix','tarif','cout','marge','benefice','budget','devis','rentable','price','pricing','cost','margin','profit','quote','profitable','prezzo','tariffa','costo','margine','profitto','preventivo','preis','tarif','kosten','gewinn','angebot','价格','费用','成本','利润','报价'],
    answers: {
      fr: `Pour évaluer un prix : marge brute = prix de vente − coût direct. Pour une activité, ajoutez aussi transport, matériel, commission, temps et taxes. Demandez plusieurs devis comparables et évitez les promesses de prix ou de bénéfice garanti. Astuce : donnez-moi un coût et un prix de vente (deux nombres) et je calcule la marge ; tapez un pourcentage (ex : 15% de 20000) pour une remise ou une commission ; ou tapez directement un calcul (ex : 2500*8) pour un résultat rapide.`,
      en: `To evaluate a price: gross margin = selling price − direct cost. For a full activity, also add transport, materials, commission, time and taxes. Ask for several comparable quotes and be wary of promises of guaranteed prices or profit. Tip: give me a cost and a selling price (two numbers) and I'll calculate the margin; type a percentage (e.g. 15% of 20000) for a discount or commission; or type a calculation directly (e.g. 2500*8) for a quick result.`,
      it: `Per valutare un prezzo: margine lordo = prezzo di vendita − costo diretto. Per un'attività, aggiungi anche trasporto, materiali, commissione, tempo e tasse. Chiedi più preventivi comparabili ed evita le promesse di prezzo o profitto garantito. Consiglio: dammi un costo e un prezzo di vendita (due numeri) e calcolerò il margine; scrivi una percentuale (es. 15% di 20000) per uno sconto o una commissione; oppure scrivi direttamente un calcolo (es. 2500*8) per un risultato rapido.`,
      de: `Um einen Preis zu bewerten: Bruttomarge = Verkaufspreis − direkte Kosten. Für eine Tätigkeit auch Transport, Material, Provision, Zeit und Steuern hinzufügen. Holen Sie mehrere vergleichbare Angebote ein und seien Sie vorsichtig bei Versprechen von garantierten Preisen oder Gewinnen. Tipp: Nennen Sie mir einen Kostenpreis und einen Verkaufspreis (zwei Zahlen), und ich berechne die Marge; geben Sie einen Prozentsatz ein (z. B. 15% von 20000) für einen Rabatt oder eine Provision; oder geben Sie direkt eine Rechnung ein (z. B. 2500*8) für ein schnelles Ergebnis.`,
      zh: `评估价格的方法:毛利 = 销售价格 − 直接成本。对于一项活动,还需加上运输、材料、佣金、时间和税费。请索取多个可比报价,警惕承诺"保证价格"或"保证利润"的说法。小贴士:告诉我成本和销售价格(两个数字),我可以帮您计算利润;输入百分比(例如15%的20000)可计算折扣或佣金;或直接输入运算(例如2500*8)快速得到结果。`
    }
  },
  {
    terms:['compte','connexion','se connecter','creer un compte','inscription','mot de passe','log in','create an account','sign up','password','accesso','accedere','creare un account','registrazione','konto','anmelden','konto erstellen','registrierung','passwort','账户','登录','注册账户','密码'],
    answers: {
      fr: `Ouvrez Compte, puis « Créer compte » (email + mot de passe, ou Google) ou « Connexion » si vous en avez déjà un. Il faut être connecté pour publier une demande ou contacter quelqu'un par WhatsApp. Ne partagez jamais votre mot de passe ou un code reçu par SMS, même à quelqu'un qui prétend être du support.`,
      en: `Open Account, then "Create account" (email + password, or Google) or "Log in" if you already have one. You need to be logged in to post a request or contact someone on WhatsApp. Never share your password or an SMS code, even with someone claiming to be support.`,
      it: `Apri Account, poi «Crea account» (email + password, o Google) oppure «Accedi» se ne hai già uno. Devi essere connesso per pubblicare una richiesta o contattare qualcuno su WhatsApp. Non condividere mai la tua password o un codice ricevuto via SMS, nemmeno con qualcuno che dice di essere del supporto.`,
      de: `Öffnen Sie Konto und dann "Konto erstellen" (E-Mail + Passwort oder Google) oder "Anmelden", falls Sie bereits eines haben. Sie müssen angemeldet sein, um eine Anfrage zu veröffentlichen oder jemanden über WhatsApp zu kontaktieren. Geben Sie niemals Ihr Passwort oder einen per SMS erhaltenen Code weiter, auch nicht an jemanden, der behauptet, vom Support zu sein.`,
      zh: `打开"账户",然后选择"创建账户"(邮箱+密码,或使用Google)或"登录"(如果您已有账户)。发布需求或通过WhatsApp联系他人都需要先登录。切勿泄露您的密码或通过短信收到的验证码,即使对方自称是客服人员。`
    }
  },
  {
    terms:['trouver un artisan','rechercher un prestataire','artisan proche','filtre categorie','find a tradesperson','search for a provider','nearby tradesperson','filter by category','trovare un artigiano','cercare un fornitore','artigiano vicino','filtro categoria','handwerker finden','anbieter suchen','handwerker in der nahe','kategorie filter','寻找工匠','搜索服务商','附近的工匠','按类别筛选'],
    answers: {
      fr: `Utilisez la carte ou la liste, puis filtrez par catégorie (BTP, Électricité, Plomberie, Ménage, Jardinage, Mécanique, Informatique). Pour chercher par mot-clé, appuyez sur l'onglet « Chercher » en bas de l'écran. Ouvrez une annonce pour comparer la description, le prix et les informations visibles. Avant de choisir un artisan, demandez un devis écrit, vérifiez son profil et convenez du travail avant tout paiement.`,
      en: `Use the map or the list, then filter by category (Construction, Electrical, Plumbing, Cleaning, Gardening, Mechanics, IT). To search by keyword, tap the "Search" tab at the bottom of the screen. Open a listing to compare the description, price and visible information. Before choosing a tradesperson, ask for a written quote, check their profile and agree on the work before making any payment.`,
      it: `Usa la mappa o l'elenco, poi filtra per categoria (Edilizia, Elettricità, Idraulica, Pulizie, Giardinaggio, Meccanica, Informatica). Per cercare per parola chiave, tocca la scheda «Cerca» in basso sullo schermo. Apri un annuncio per confrontare descrizione, prezzo e informazioni visibili. Prima di scegliere un artigiano, chiedi un preventivo scritto, verifica il suo profilo e concorda il lavoro prima di qualsiasi pagamento.`,
      de: `Nutzen Sie die Karte oder die Liste und filtern Sie dann nach Kategorie (Bau, Elektrik, Sanitär, Reinigung, Gartenarbeit, Mechanik, IT). Um nach Stichwort zu suchen, tippen Sie unten im Bildschirm auf den Tab "Suchen". Öffnen Sie eine Anzeige, um Beschreibung, Preis und sichtbare Informationen zu vergleichen. Bevor Sie sich für einen Handwerker entscheiden, fordern Sie ein schriftliches Angebot an, prüfen Sie sein Profil und vereinbaren Sie die Arbeit, bevor Sie bezahlen.`,
      zh: `使用地图或列表功能,按类别筛选(建筑、电工、水管、清洁、园艺、机械、信息技术)。如需按关键词搜索,请点击屏幕底部的"搜索"标签。打开一条发布信息以比较描述、价格及可见信息。在选择工匠之前,请索取书面报价、核实其资料,并在付款前就工作内容达成一致。`
    }
  },
  {
    terms:['publier','poster une annonce','ajouter un job','creer une demande','appui long','publish a job','post a listing','add a job','create a request','long press on map','pubblicare un lavoro','postare un annuncio','creare una richiesta','pressione prolungata','job veroffentlichen','anzeige posten','anfrage erstellen','langes drucken','发布工作','添加工作','创建需求','长按地图'],
    answers: {
      fr: `Deux façons de publier : appuyez sur le gros bouton + doré en bas de l'écran, ou faites un appui long (clic droit sur ordinateur) directement à l'endroit voulu sur la carte puis « Publier un job ici ». Choisissez une catégorie, ajoutez un titre clair, le budget, votre téléphone et une description précise. Ne publiez pas de mot de passe, code SMS ou document d'identité.`,
      en: `Two ways to post: tap the big gold + button at the bottom of the screen, or long-press (right-click on a computer) directly on the desired spot on the map, then "Post a job here". Choose a category, add a clear title, the budget, your phone number and a precise description. Don't post a password, SMS code or ID document.`,
      it: `Due modi per pubblicare: tocca il grande pulsante dorato + in basso sullo schermo, oppure fai una pressione prolungata (clic destro su computer) direttamente nel punto desiderato sulla mappa e poi «Pubblica un lavoro qui». Scegli una categoria, aggiungi un titolo chiaro, il budget, il tuo telefono e una descrizione precisa. Non pubblicare password, codici SMS o documenti d'identità.`,
      de: `Zwei Möglichkeiten zu veröffentlichen: Tippen Sie auf die große goldene +-Schaltfläche unten im Bildschirm, oder drücken Sie lange (Rechtsklick am Computer) direkt an der gewünschten Stelle auf der Karte und dann "Job hier veröffentlichen". Wählen Sie eine Kategorie, fügen Sie einen klaren Titel, das Budget, Ihre Telefonnummer und eine genaue Beschreibung hinzu. Veröffentlichen Sie kein Passwort, keinen SMS-Code und kein Ausweisdokument.`,
      zh: `有两种发布方式:点击屏幕底部的金色大"+"按钮,或者直接在地图上想要的位置长按(电脑上为右键点击),然后选择"在此发布工作"。选择类别,填写清晰的标题、预算、电话号码和详细描述。请勿发布密码、短信验证码或身份证件。`
    }
  },
  {
    terms:['supprimer mes donnees','effacer mes donnees','confidentialite','vie privee','delete my data','erase my data','my data','privacy policy','eliminare i miei dati','riservatezza','privacy','meine daten loschen','datenschutz','删除我的数据','隐私政策'],
    answers: {
      fr: `L'assistant local ne stocke pas vos questions sur un serveur. Pour les données de votre compte JobMarket, utilisez le support officiel afin de demander la procédure adaptée ; ne partagez pas de documents sensibles dans le chat.`,
      en: `The local assistant doesn't store your questions on a server. For your JobMarket account data, use official support to request the right procedure; don't share sensitive documents in the chat.`,
      it: `L'assistente locale non memorizza le tue domande su un server. Per i dati del tuo account JobMarket, contatta il supporto ufficiale per richiedere la procedura adatta; non condividere documenti sensibili in chat.`,
      de: `Der lokale Assistent speichert Ihre Fragen nicht auf einem Server. Wenden Sie sich für Ihre JobMarket-Kontodaten an den offiziellen Support, um das passende Verfahren zu erfragen; teilen Sie keine sensiblen Dokumente im Chat.`,
      zh: `本地助手不会将您的问题存储在服务器上。关于您的JobMarket账户数据,请联系官方客服以获取相应的处理流程;请勿在聊天中分享敏感文件。`
    }
  },
  {
    terms:['laisser un avis','ecrire un avis','donner une note','noter un prestataire','avis client','comment laisser un avis','leave a review','write a review','rate a provider','leave feedback','rating a provider','lasciare una recensione','scrivere una recensione','valutare un fornitore','recensione cliente','bewertung hinterlassen','bewertung schreiben','anbieter bewerten','kundenbewertung','留下评价','写评价','给服务商评分','客户评价'],
    answers: {
      fr: `Après avoir contacté un prestataire par WhatsApp depuis une annonce, rouvrez cette même annonce : un bouton « Laisser un avis » apparaît en bas de la fiche. Choisissez une note de 1 à 5 étoiles et ajoutez un commentaire si vous le souhaitez. Vous ne pouvez noter que quelqu'un que vous avez réellement contacté, et une seule fois par échange.`,
      en: `After contacting a provider via WhatsApp from a listing, reopen that same listing: a "Leave a review" button appears at the bottom. Choose a rating from 1 to 5 stars and add a comment if you'd like. You can only review someone you actually contacted, and only once per exchange.`,
      it: `Dopo aver contattato un fornitore su WhatsApp da un annuncio, riapri lo stesso annuncio: in fondo apparirà un pulsante «Lascia una recensione». Scegli una valutazione da 1 a 5 stelle e, se vuoi, aggiungi un commento. Puoi valutare solo chi hai davvero contattato, e una sola volta per scambio.`,
      de: `Nachdem Sie einen Anbieter über WhatsApp aus einer Anzeige kontaktiert haben, öffnen Sie dieselbe Anzeige erneut: Unten erscheint eine Schaltfläche "Bewertung hinterlassen". Wählen Sie eine Bewertung von 1 bis 5 Sternen und fügen Sie bei Bedarf einen Kommentar hinzu. Sie können nur jemanden bewerten, den Sie tatsächlich kontaktiert haben, und nur einmal pro Austausch.`,
      zh: `通过某条发布信息用WhatsApp联系服务商后,重新打开该发布信息:底部会出现"留下评价"按钮。选择1到5星的评分,并可选择添加评论。您只能评价您真正联系过的人,且每次沟通只能评价一次。`
    }
  },
  {
    terms:['erreur sms','code sms invalide','je ne recois pas le code','trop de tentatives sms','erreur recaptcha','recaptcha','erreur de verification','numero deja utilise sms','sms error','invalid sms code','not receiving the code','too many sms attempts','recaptcha error','verification error','number already in use sms','errore sms','codice sms non valido','non ricevo il codice','troppi tentativi sms','errore recaptcha','errore di verifica','numero gia utilizzato sms','sms fehler','ungultiger sms code','ich erhalte den code nicht','zu viele sms versuche','recaptcha fehler','verifizierungsfehler','nummer bereits verwendet sms','短信错误','验证码无效','没有收到验证码','短信尝试次数过多','recaptcha错误','验证错误','号码已被使用短信'],
    answers: {
      fr: `Si l'envoi du code échoue, le message indique maintenant la cause précise : numéro déjà utilisé sur un autre compte, trop de SMS envoyés aujourd'hui, trop de tentatives, ou site non autorisé pour la vérification. Vous pouvez réessayer directement après une erreur : le composant de sécurité (reCAPTCHA invisible) se réinitialise désormais automatiquement, donc corriger la cause (attendre un peu, vérifier le numéro) suffit pour qu'une nouvelle tentative fonctionne.`,
      en: `If sending the code fails, the message now shows the exact cause: the number is already used on another account, too many SMS sent today, too many attempts, or the site isn't authorized for verification. You can retry right after an error: the security component (invisible reCAPTCHA) now resets automatically, so fixing the cause (waiting a bit, checking the number) is enough for a new attempt to work.`,
      it: `Se l'invio del codice fallisce, il messaggio ora indica la causa precisa: numero già usato su un altro account, troppi SMS inviati oggi, troppi tentativi, oppure sito non autorizzato per la verifica. Puoi riprovare subito dopo un errore: il componente di sicurezza (reCAPTCHA invisibile) ora si reimposta automaticamente, quindi basta correggere la causa (aspettare un po', verificare il numero) perché un nuovo tentativo funzioni.`,
      de: `Wenn das Senden des Codes fehlschlägt, zeigt die Meldung jetzt die genaue Ursache: die Nummer wird bereits für ein anderes Konto verwendet, es wurden heute zu viele SMS versendet, zu viele Versuche, oder die Website ist für die Verifizierung nicht autorisiert. Sie können es direkt nach einem Fehler erneut versuchen: die Sicherheitskomponente (unsichtbares reCAPTCHA) wird jetzt automatisch zurückgesetzt, sodass es genügt, die Ursache zu beheben (etwas warten, die Nummer prüfen), damit ein neuer Versuch funktioniert.`,
      zh: `如果发送验证码失败,现在的提示会说明具体原因:该号码已被其他账户使用、今日发送短信次数过多、尝试次数过多,或该网站未获验证授权。出错后您可以直接重试:安全组件(隐形reCAPTCHA)现在会自动重置,因此只需解决问题原因(稍等片刻、核实号码)即可让新的尝试成功。`
    }
  },
  {
    terms:['verifier mon numero','verification par sms','numero verifie','code sms','verifier mon telephone','badge telephone','verify my number','sms verification','verified phone','otp code','verify my phone','phone badge','verificare il mio numero','verifica sms','telefono verificato','codice sms','meine nummer verifizieren','sms verifizierung','verifiziertes telefon','sms code','验证我的号码','短信验证','已验证电话','验证码'],
    answers: {
      fr: `Dans Compte → « Mon Profil Pro », entrez votre numéro au format international (ex : +237650420710) puis appuyez sur « Envoyer le code ». Vous recevez un SMS avec un code à saisir pour valider. Une fois vérifié, un badge 📱 apparaît sur vos annonces : c'est un signal de confiance gratuit et automatique, différent du badge ✓ qui demande une vérification manuelle par pièce d'identité.`,
      en: `In Account → "My Pro Profile", enter your number in international format (e.g. +237650420710) and tap "Send code". You'll receive an SMS with a code to confirm. Once verified, a 📱 badge appears on your listings — a free, automatic trust signal, different from the ✓ badge which requires manual ID verification.`,
      it: `In Account → «Il mio Profilo Pro», inserisci il tuo numero in formato internazionale (es. +237650420710) e tocca «Invia codice». Riceverai un SMS con un codice da confermare. Una volta verificato, apparirà un badge 📱 sui tuoi annunci: un segnale di fiducia gratuito e automatico, diverso dal badge ✓ che richiede una verifica manuale tramite documento.`,
      de: `Gehen Sie zu Konto → "Mein Profi-Profil", geben Sie Ihre Nummer im internationalen Format ein (z. B. +237650420710) und tippen Sie auf "Code senden". Sie erhalten eine SMS mit einem Bestätigungscode. Nach der Verifizierung erscheint ein 📱-Abzeichen auf Ihren Anzeigen — ein kostenloses, automatisches Vertrauenssignal, anders als das ✓-Abzeichen, das eine manuelle Ausweisprüfung erfordert.`,
      zh: `在"账户"→"我的专业资料"中,输入国际格式的号码(例如 +237650420710),然后点击"发送验证码"。您会收到一条含验证码的短信,输入以确认。验证成功后,您的发布信息上会出现📱标志——这是一个免费、自动的信任标志,不同于需要人工核实身份证件的✓标志。`
    }
  },
  {
    terms:['badge verifie','vérification cni','piece identite','carte identite','pièce d\'identité','obtenir le badge','comment verifier mon profil','code de verification','code a 7 chiffres','verify my identity','id verification','identity badge','how to verify my profile','verification code','7 digit code','verifica identita','carta d\'identita','ottenere il badge','codice di verifica','codice a 7 cifre','come verificare il profilo','identitatsprufung','ausweis verifizierung','verifizierungscode','7-stelliger code','abzeichen erhalten','身份验证','验证徽章','身份证验证','验证码','七位数验证码','如何验证资料'],
    answers: {
      fr: `Pour obtenir le badge ✓ (vérification manuelle), ouvrez Compte → « Mon Profil Pro », section vérification : ajoutez une photo de votre pièce d'identité (CNI, passeport...), un selfie où vous tenez cette même pièce à côté de votre visage, et votre numéro WhatsApp. Après l'envoi, un administrateur examine la demande ; une fois acceptée, vous recevez un code à 7 chiffres sur WhatsApp à saisir dans l'app pour finaliser la vérification et débloquer le badge ✓.`,
      en: `To get the ✓ badge (manual verification), open Account → "My Pro Profile", verification section: add a photo of your ID (national ID card, passport...), a selfie of you holding that same document next to your face, and your WhatsApp number. After sending, an admin reviews the request; once accepted, you'll receive a 7-digit code on WhatsApp to enter in the app to finish the verification and unlock the ✓ badge.`,
      it: `Per ottenere il badge ✓ (verifica manuale), apri Account → «Il mio profilo Pro», sezione verifica: aggiungi una foto del tuo documento d'identità (carta d'identità, passaporto...), un selfie in cui tieni lo stesso documento accanto al viso, e il tuo numero WhatsApp. Dopo l'invio, un amministratore esamina la richiesta; una volta accettata, riceverai su WhatsApp un codice a 7 cifre da inserire nell'app per completare la verifica e sbloccare il badge ✓.`,
      de: `Um das ✓-Abzeichen zu erhalten (manuelle Verifizierung), öffnen Sie Konto → "Mein Profi-Profil", Bereich Verifizierung: fügen Sie ein Foto Ihres Ausweises (Personalausweis, Reisepass...), ein Selfie mit diesem Dokument neben Ihrem Gesicht, und Ihre WhatsApp-Nummer hinzu. Nach dem Senden prüft ein Administrator die Anfrage; nach der Annahme erhalten Sie per WhatsApp einen 7-stelligen Code, den Sie in der App eingeben, um die Verifizierung abzuschließen und das ✓-Abzeichen freizuschalten.`,
      zh: `要获得✓认证徽章(人工审核),请打开"账户"→"我的专业资料"的验证部分:上传您的身份证件照片(身份证、护照等)、一张您手持同一证件靠近脸部的自拍照,以及您的WhatsApp号码。提交后,管理员会审核申请;通过后,您将通过WhatsApp收到一个7位数验证码,在应用中输入即可完成验证并解锁✓徽章。`
    }
  }
];

// Remarque sur l'ordre ci-dessus : en cas d'égalité de score entre deux sujets, le
// premier du tableau l'emporte (tri stable). Les sujets les plus spécifiques sont donc
// volontairement placés avant les sujets génériques ("publier", "trouver") pour éviter
// qu'un mot très fréquent (ex: "annonce", "job") ne détourne systématiquement vers le
// mauvais sujet. Ordre et mots-clés vérifiés par une batterie de tests avant mise en ligne.

function normaliseChatText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getMarginAnswer(text) {
  const lower = normaliseChatText(text);
  if (!/(marge|prix|cout|budget|benefice|margin|price|cost|profit|margine|prezzo|costo|profitto|preis|kosten|gewinn|利润|价格|成本|预算)/.test(lower)) return null;
  const values = (text.match(/\b\d+(?:[\s,.]\d{3})*(?:[,.]\d+)?\b/g) || []).map(v => Number(v.replace(/[\s.]/g, '').replace(',', '.'))).filter(Number.isFinite);
  if (values.length < 2) return null;
  const cost = values[0], price = values[1], margin = price - cost;
  const marginRate = price > 0 ? (margin / price) * 100 : 0;
  const lang = (typeof currentLang !== 'undefined' && CHAT_NUM_LOCALE[currentLang]) ? currentLang : 'fr';
  const locale = CHAT_NUM_LOCALE[lang];
  return csText('marginTemplate')
    .replace('{cost}', cost.toLocaleString(locale))
    .replace('{price}', price.toLocaleString(locale))
    .replace('{margin}', margin.toLocaleString(locale))
    .replace('{rate}', marginRate.toFixed(1));
}

// --- Calculatrice arithmétique locale, sans eval() (sécurité : ce fichier est un site
// statique, eval()/Function() sur du texte utilisateur serait une porte ouverte à des
// injections). Supporte + - * / et les parenthèses. Les nombres peuvent utiliser un
// espace ou un point comme séparateur de milliers et une virgule comme décimale (même
// convention que la marge ci-dessus), pour coller aux habitudes locales de saisie des
// prix (ex : "20 000" ou "20.000").
function safeEvalArithmetic(expr) {
  const tokens = expr.match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || !tokens.length) return null;
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  function parseFactor() {
    const tok = peek();
    if (tok === undefined) throw new Error('fin inattendue');
    if (tok === '(') {
      consume();
      const v = parseExpr();
      if (peek() === ')') consume(); else throw new Error('parenthese manquante');
      return v;
    }
    if (tok === '-') { consume(); return -parseFactor(); }
    if (tok === '+') { consume(); return parseFactor(); }
    consume();
    const n = Number(tok);
    if (!Number.isFinite(n)) throw new Error('nombre invalide');
    return n;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const rhs = parseFactor();
      v = op === '*' ? v * rhs : v / rhs;
    }
    return v;
  }
  function parseExpr() {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const rhs = parseTerm();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }
  try {
    const result = parseExpr();
    if (pos !== tokens.length) return null; // texte restant non consommé : pas une expression propre
    return Number.isFinite(result) ? result : null;
  } catch (e) {
    return null;
  }
}

// Repère une expression arithmétique explicite dans un texte libre (ex : "2500*8",
// "20000 + 15000 - 3000", "(2000+3000)*4") et la nettoie pour safeEvalArithmetic.
// Renvoie null s'il n'y a pas d'opérateur binaire clair, pour ne pas confondre un
// numéro de téléphone (+237...) ou une date (18-07-2026) avec un calcul.
function extractCalcExpression(rawText) {
  let t = String(rawText || '');
  t = t.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  // "x" comme signe de multiplication seulement entre deux chiffres (ex: "5 x 1200"),
  // jamais à l'intérieur d'un mot.
  t = t.replace(/(\d)\s*x\s*(\d)/gi, '$1*$2');
  // Nombres "à la française" : espace/point = milliers, virgule = décimale.
  t = t.replace(/\d+(?:[\s.]\d{3})*(?:,\d+)?/g, m => m.replace(/[\s.]/g, '').replace(',', '.'));
  const kept = t.replace(/[^0-9+\-*/(). ]/g, ' ');
  const tokens = kept.match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || tokens.length < 3) return null;
  let binaryOps = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (['+', '-', '*', '/'].includes(tokens[i])) {
      const isUnary = (i === 0) || tokens[i - 1] === '(';
      if (!isUnary) binaryOps++;
    }
  }
  if (binaryOps < 1) return null;
  // Évite de traiter une date (ex: 18-07-2026 ou 18/07/2026) comme une soustraction/division.
  if (tokens.length === 5 && tokens[1] === tokens[3] && (tokens[1] === '-' || tokens[1] === '/') &&
      /^\d{1,2}$/.test(tokens[0]) && /^\d{1,2}$/.test(tokens[2]) && /^\d{4}$/.test(tokens[4])) {
    return null;
  }
  if (tokens.filter(tok => tok === '(').length !== tokens.filter(tok => tok === ')').length) return null;
  return tokens.join('');
}

function getCalcAnswer(text) {
  const expr = extractCalcExpression(text);
  if (!expr) return null;
  const result = safeEvalArithmetic(expr);
  if (result === null) return null;
  const lang = (typeof currentLang !== 'undefined' && CHAT_NUM_LOCALE[currentLang]) ? currentLang : 'fr';
  const locale = CHAT_NUM_LOCALE[lang];
  // Ré-affiche l'expression avec les signes usuels plutôt que les symboles internes.
  const displayExpr = expr.replace(/\*/g, '×').replace(/\//g, '÷');
  return csText('calcTemplate')
    .replace('{expr}', displayExpr)
    .replace('{result}', result.toLocaleString(locale, { maximumFractionDigits: 2 }));
}

// Calcule "N % de M" (remise, commission, taxe...) quand le texte contient un seul
// pourcentage et un seul autre nombre — sans dépendre du mot de liaison ("de", "of",
// "di", "von", "çš""), pour fonctionner dans les 5 langues. Si des mots de remise/rabais
// sont présents, affiche en plus le prix final après réduction.
function getPercentAnswer(text) {
  const percentMatches = text.match(/\d+(?:[.,]\d+)?\s*%/g);
  if (!percentMatches || percentMatches.length !== 1) return null;
  const percentValue = Number(percentMatches[0].replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(percentValue)) return null;
  const allNumbers = text.match(/\d+(?:[\s.]\d{3})*(?:,\d+)?/g) || [];
  const withoutPercentToken = allNumbers.filter(n => !percentMatches[0].startsWith(n));
  if (withoutPercentToken.length !== 1) return null;
  const base = Number(withoutPercentToken[0].replace(/[\s.]/g, '').replace(',', '.'));
  if (!Number.isFinite(base) || base === 0) return null;
  const amount = base * (percentValue / 100);
  const lang = (typeof currentLang !== 'undefined' && CHAT_NUM_LOCALE[currentLang]) ? currentLang : 'fr';
  const locale = CHAT_NUM_LOCALE[lang];
  const isDiscount = /remise|rabais|reduction|discount|sconto|riduzione|rabatt|折扣|优惠|减免/.test(normaliseChatText(text));
  if (isDiscount) {
    return csText('percentDiscountTemplate')
      .replace('{rate}', percentValue.toLocaleString(locale))
      .replace('{base}', base.toLocaleString(locale))
      .replace('{result}', amount.toLocaleString(locale, { maximumFractionDigits: 2 }))
      .replace('{finalPrice}', (base - amount).toLocaleString(locale, { maximumFractionDigits: 2 }));
  }
  return csText('percentTemplate')
    .replace('{rate}', percentValue.toLocaleString(locale))
    .replace('{base}', base.toLocaleString(locale))
    .replace('{result}', amount.toLocaleString(locale, { maximumFractionDigits: 2 }));
}

function localChatAnswer(question) {
  const text = normaliseChatText(question);
  if (!text) return csText('emptyPrompt');

  // Petites formules de politesse reconnues dans les 5 langues, seulement quand c'est
  // tout le message (une vraie question qui contient juste un de ces mots ailleurs
  // n'est pas affectée).
  if (/^(bonjour|salut|bonsoir|coucou|bjr|slt|hello|hi|hey|ciao|buongiorno|buonasera|hallo|guten tag|你好|您好)[ !?.]*$/.test(text)) {
    return csText('greeting');
  }
  if (/^(merci|merci beaucoup|ok merci|top merci|thanks|thank you|thanks a lot|grazie|grazie mille|danke|danke schon|谢谢|谢谢你)[ !?.]*$/.test(text)) {
    return csText('thanks');
  }
  if (/^(au revoir|a bientot|bonne journee|bonne soiree|bye|goodbye|see you|see you soon|arrivederci|a presto|auf wiedersehen|tschuss|再见)[ !?.]*$/.test(text)) {
    return csText('goodbye');
  }
  if (/^(aide|help|menu|que peux tu faire|qu est ce que tu sais faire|what can you do|cosa puoi fare|was kannst du tun|帮助|你能做什么)[ !?.]*$/.test(text)) {
    return csText('help').replace('{topics}', csText('topicsSummary'));
  }

  const marginAnswer = getMarginAnswer(question);
  if (marginAnswer) return marginAnswer;

  const percentAnswer = getPercentAnswer(question);
  if (percentAnswer) return percentAnswer;

  const calcAnswer = getCalcAnswer(question);
  if (calcAnswer) return calcAnswer;

  const lang = (typeof currentLang !== 'undefined' && CHAT_STRINGS[currentLang]) ? currentLang : 'fr';
  const ranked = LOCAL_CHAT_KNOWLEDGE.map(item => ({ item, score: item.terms.reduce((n, term) => n + (text.includes(normaliseChatText(term)) ? 1 : 0), 0) })).sort((a,b) => b.score - a.score)[0];
  if (ranked && ranked.score > 0) return ranked.item.answers[lang] || ranked.item.answers.fr;
  return csText('noAnswer').replace('{topics}', csText('topicsSummary'));
}

function askChatSuggestion(button) {
  const input = document.getElementById('chatInput');
  // On utilise toujours la question de référence en français (data-query) pour la
  // recherche de réponse dans la base de connaissances, même si le bouton est
  // affiché dans une autre langue — sinon la recherche par mots-clés ne trouve rien.
  input.value = button.dataset.query || button.textContent;
  sendChatMessage();
}

// URL du worker qui sécurise l'appel au modèle Llama (via Groq) — voir
// worker/chat-proxy.js pour le pourquoi (la clé API ne doit jamais être
// dans ce fichier, qui est public).
const CHAT_PROXY_URL = 'https://jobmarket-chat-proxy.ghislaintankat.workers.dev';

async function callChatAI(messages) {
  const lastMessage = messages[messages.length - 1];
  const question = lastMessage ? lastMessage.content : '';

  try {
    // Délai de sécurité : si le worker met trop de temps à répondre (ex:
    // Groq lent, connexion capricieuse), on bascule sur l'assistant local
    // plutôt que de laisser la personne face à un chargement infini.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, lang: currentLang }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return localChatAnswer(question);

    const data = await res.json();
    if (data.fallback || !data.reply) return localChatAnswer(question);
    return data.reply;
  } catch (err) {
    // Réseau indisponible, timeout, worker injoignable... dans tous les
    // cas, mieux vaut une réponse locale limitée qu'un message d'erreur —
    // l'assistant reste utilisable même hors ligne ou si Groq est en panne.
    return localChatAnswer(question);
  }
}

// Bouton "✨ Améliorer avec l'IA" du formulaire de publication : reformule
// le titre + la description en une annonce plus claire, via le même worker
// que le chat mais avec mode:'rewrite_job' (prompt différent côté worker,
// voir chat-proxy.js). Pas de repli local ici — si l'IA n'est pas
// disponible, on prévient simplement l'utilisateur plutôt que d'improviser
// une reformulation approximative avec des règles fixes.
async function improveJobDescription() {
  const titleEl = document.getElementById('title');
  const descEl = document.getElementById('desc');
  const categoryEl = document.getElementById('category');
  const btn = document.getElementById('improveDescBtn');
  if (!titleEl || !descEl || !btn) return;

  const title = titleEl.value.trim();
  const desc = descEl.value.trim();
  if (desc.length < 10) {
    showToast(t('aiImproveMinLength'), 'error');
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('aiImproveLoading');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'rewrite_job',
        title,
        description: desc,
        category: categoryEl ? categoryEl.value.split('|')[0] : '',
        lang: currentLang
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('worker-http-error');

    const data = await res.json();
    if (data.fallback || !data.title || !data.description) {
      showToast(t('aiUnavailable'), 'error');
      return;
    }

    titleEl.value = data.title;
    descEl.value = data.description;
    showToast(t('aiImproveSuccess'), 'success');
  } catch (err) {
    showToast(t('aiConnectionError'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// Bouton "✨ Optimiser avec l'IA" du Profil Pro : reformule le métier et
// les compétences de façon plus professionnelle, via le même worker avec
// mode:'optimize_profile'. Ne touche jamais au nom/société (identité de
// la personne, pas à reformuler), seulement au métier/spécialité et aux
// compétences déclarées — sans jamais en inventer de nouvelles.
async function optimizeArtisanProfile() {
  const jobTitleEl = document.getElementById('jobTitle');
  const skillsEl = document.getElementById('skills');
  const btn = document.getElementById('optimizeProfileBtn');
  if (!jobTitleEl || !skillsEl || !btn) return;

  const jobTitle = jobTitleEl.value.trim();
  const skills = skillsEl.value.trim();
  if (skills.length < 5) {
    showToast(t('aiOptimizeMinLength'), 'error');
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('aiOptimizeLoading');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'optimize_profile', jobTitle, skills, lang: currentLang }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('worker-http-error');

    const data = await res.json();
    if (data.fallback || !data.jobTitle || !data.skills) {
      showToast(t('aiUnavailable'), 'error');
      return;
    }

    jobTitleEl.value = data.jobTitle;
    skillsEl.value = data.skills;
    showToast(t('aiOptimizeSuccess'), 'success');
  } catch (err) {
    showToast(t('aiConnectionError'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// Bouton "💡 Suggérer un prix" du formulaire de publication : donne une
// fourchette indicative en FCFA via mode:'suggest_price'. Contrairement
// aux autres boutons IA, on n'écrase pas automatiquement le champ prix
// (c'est une estimation générale, pas une donnée certaine) — on affiche
// la suggestion à côté et la personne décide d'appliquer ou non via un
// second bouton, pour garder la main sur son prix final.
async function suggestJobPrice() {
  const titleEl = document.getElementById('title');
  const descEl = document.getElementById('desc');
  const categoryEl = document.getElementById('category');
  const priceEl = document.getElementById('price');
  const btn = document.getElementById('suggestPriceBtn');
  const box = document.getElementById('priceSuggestionBox');
  if (!titleEl || !descEl || !priceEl || !btn || !box) return;

  const title = titleEl.value.trim();
  const desc = descEl.value.trim();
  if (!title && desc.length < 10) {
    showToast(t('aiPriceMinLength'), 'error');
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('aiPriceLoading');
  box.style.display = 'none';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'suggest_price',
        title,
        description: desc,
        category: categoryEl ? categoryEl.value.split('|')[0] : '',
        lang: currentLang
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('worker-http-error');

    const data = await res.json();
    if (data.fallback || typeof data.rangeLow !== 'number' || typeof data.rangeHigh !== 'number') {
      showToast(t('aiUnavailable'), 'error');
      return;
    }

    const fmt = (n) => n.toLocaleString('fr-FR');
    const suggestedText = `${fmt(data.rangeLow)} - ${fmt(data.rangeHigh)} FCFA`;
    box.innerHTML = `${t('aiPriceEstimateLabel') || '💡'} <strong>${suggestedText}</strong><br>${data.note}<br><button type="button" onclick="document.getElementById('price').value='${suggestedText.replace(/'/g, "\\'")}'; showToast(t('aiPriceApplied'), 'success');" style="margin-top:6px;background:none;border:none;color:var(--accent,#25D366);text-decoration:underline;cursor:pointer;font-size:12px;padding:0;">${t('aiPriceUseEstimation')}</button>`;
    box.style.display = 'block';
  } catch (err) {
    showToast(t('aiConnectionError'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// Bouton "✨ Suggérer la catégorie" du formulaire de publication : lit le
// titre/description et propose la catégorie la plus pertinente parmi les
// 7 existantes (mode:'suggest_category'), même quand le texte ne contient
// pas le mot-clé exact. La catégorie n'est jamais changée automatiquement
// sans action de la personne — le bouton PRÉ-SÉLECTIONNE juste l'option
// dans le menu déroulant, qui reste modifiable avant publication.
const CATEGORY_SELECT_VALUES = {
  btp: 'btp|#FF9500',
  electricite: 'electricite|#FFD700',
  plomberie: 'plomberie|#007AFF',
  menage: 'menage|#25D366',
  jardinage: 'jardinage|#34C759',
  mecanique: 'mecanique|#FF3B30',
  informatique: 'informatique|#AF52DE'
};
// Les clés i18n des libellés ne suivent pas une capitalisation simple du
// code (ex: "electricite" -> "optElec", pas "optElectricite") — mappage explicite.
const CATEGORY_LABEL_KEYS = {
  btp: 'optBtp', electricite: 'optElec', plomberie: 'optPlomberie',
  menage: 'optMenage', jardinage: 'optJardinage', mecanique: 'optMecanique', informatique: 'optInfo'
};

async function suggestJobCategory() {
  const titleEl = document.getElementById('title');
  const descEl = document.getElementById('desc');
  const categoryEl = document.getElementById('category');
  const btn = document.getElementById('suggestCategoryBtn');
  if (!titleEl || !descEl || !categoryEl || !btn) return;

  const title = titleEl.value.trim();
  const desc = descEl.value.trim();
  if (!title && desc.length < 10) {
    showToast(t('aiCategoryMinLength'), 'error');
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('aiCategoryLoading');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'suggest_category', title, description: desc }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('worker-http-error');

    const data = await res.json();
    const selectValue = data.category && CATEGORY_SELECT_VALUES[data.category];
    if (data.fallback || !selectValue) {
      showToast(t('aiUnavailable'), 'error');
      return;
    }

    categoryEl.value = selectValue;
    showToast(t('aiCategorySuggested').replace('{category}', t(CATEGORY_LABEL_KEYS[data.category])), 'success');
  } catch (err) {
    showToast(t('aiConnectionError'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// Bouton "🛡️ Analyser les signaux d'alerte" sur la fiche d'une annonce :
// analyse le texte (titre/description/prix) via mode:'check_scam_signals'.
// N'analyse QUE le texte de l'annonce affichée (window.currentPreviewJob,
// posé par openJobPreview) — jamais le profil ou l'historique de son
// auteur, que ce worker ne connaît pas. Le résultat reste une invitation à
// la vigilance, jamais une accusation : le texte l'explique clairement à
// chaque niveau de risque, et le bouton "Signaler" existant reste la
// action à utiliser en cas de doute réel, pas ce simple indicateur.
async function analyzeScamSignals() {
  const job = window.currentPreviewJob;
  const btn = document.getElementById('scamCheckBtn');
  const box = document.getElementById('scamCheckBox');
  if (!job || !btn || !box) return;

  const title = (job.title || '').trim();
  const desc = (job.desc || '').trim();
  if (!title && !desc) {
    showToast(t('aiScamNothingToAnalyze'), 'error');
    return;
  }

  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('aiScamLoading');
  box.style.display = 'none';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'check_scam_signals',
        title,
        description: desc,
        price: job.price ? String(job.price) : '',
        lang: currentLang
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error('worker-http-error');

    const data = await res.json();
    const validLevels = ['low', 'medium', 'high'];
    if (data.fallback || !validLevels.includes(data.riskLevel)) {
      showToast(t('aiUnavailable'), 'error');
      return;
    }

    const styles = {
      low: { bg: 'rgba(37,211,102,0.12)', color: '#25D366', icon: '✅' },
      medium: { bg: 'rgba(255,215,0,0.12)', color: '#FFD700', icon: '⚠️' },
      high: { bg: 'rgba(255,59,48,0.12)', color: '#FF3B30', icon: '🚨' }
    };
    const s = styles[data.riskLevel];
    box.style.background = s.bg;
    box.style.color = s.color;
    box.innerHTML = `${s.icon} ${data.note}<br><span style="opacity:0.7;font-size:11px;">${t('aiScamDisclaimer')}</span>`;
    box.style.display = 'block';
  } catch (err) {
    showToast(t('aiConnectionError'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg || chatLoading) return;

  addChatBubble('user', msg);
  chatHistory.push({ role: 'user', content: msg });
  input.value = '';

  chatLoading = true;
  showChatTyping();

  try {
    const reply = await callChatAI(chatHistory);
    hideChatTyping();
    addChatBubble('assistant', reply);
    chatHistory.push({ role: 'assistant', content: reply });
  } catch (err) {
    hideChatTyping();
    addChatBubble('assistant', "Impossible de contacter l'assistant. Vérifiez votre connexion et réessayez.", true);
  } finally {
    chatLoading = false;
  }
}

function handleChatKey(e) {
  if (e.key === 'Enter') sendChatMessage();
}

// ===== PWA =====
// Un seul service worker (sw.js) gère à la fois le cache offline ET les
// notifications push — deux SW séparés au même scope se marchent dessus.
let swRegistrationPromise = null;
if ('serviceWorker' in navigator) {
  swRegistrationPromise = navigator.serviceWorker.register('sw.js').catch(() => null);

  // Clic sur une notification push pendant que l'app est déjà ouverte :
  // sw.js nous poste le jobId concerné (voir notificationclick dans sw.js)
  // plutôt que de recharger toute la page pour ça.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data) return;
    const d = event.data;

    // Ancien format (notif de job) : conservé pour compatibilité.
    if (d.type === 'open-job') {
      logNotificationOpened(d.variant);
      const jobId = d.jobId;
      if (!jobId) return;
      if (typeof jobsById !== 'undefined' && jobsById[jobId]) {
        openJobPreview(jobId);
      } else {
        deepLinkJobId = jobId; // les jobs ne sont pas encore chargés, le mécanisme existant prendra le relais
      }
      return;
    }

    // Nouveau format générique (job / quote / message) posté par sw.js.
    if (d.type === 'open-notif') {
      logNotificationOpened(d.variant); // ce message ne vient que d'un clic sur une notif
      handleNotifOpen(d.notifType, d);
      return;
    }
  });
}

// Aiguille l'ouverture selon le type de notification cliquée.
//   - message / message-admin -> ouvre la conversation via son threadId
//   - quote / quote-admin      -> ouvre l'annonce concernée (le devis y est lié)
//   - job (défaut)             -> ouvre l'annonce
function handleNotifOpen(notifType, d) {
  d = d || {};
  if ((notifType === 'message' || notifType === 'message-admin') && d.threadId) {
    openUserChatFromThreadId(d.threadId);
    return;
  }
  // quote / job / autre : on ouvre l'annonce si on a un jobId
  const jobId = d.jobId;
  if (!jobId) return;
  if (typeof jobsById !== 'undefined' && jobsById[jobId]) {
    openJobPreview(jobId);
  } else {
    deepLinkJobId = jobId;
  }
}

// Ouvre la conversation in-app à partir d'un threadId.
// Rappel du format (voir makeThreadId) : "<uidTrié1>_<uidTrié2>__<jobId|general>".
// On en extrait l'AUTRE participant (peerUid) et le jobId pour rappeler
// openUserChat() tel quel — c'est plus fiable que de deviner, car openUserChat
// reconstruit lui-même le même threadId.
function openUserChatFromThreadId(threadId) {
  try {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) { showToast('Connecte-toi pour voir le message.', 'error'); return; }
    const parts = String(threadId).split('__');
    const uidPair = (parts[0] || '').split('_');
    const jobId = parts[1] && parts[1] !== 'general' ? parts[1] : null;
    // L'autre participant = celui des deux uid qui n'est pas moi.
    const peerUid = uidPair.find(u => u && u !== user.uid);
    if (!peerUid) { showToast('Conversation introuvable.', 'error'); return; }
    const peerName = (typeof profilesCache !== 'undefined' && profilesCache[peerUid] && profilesCache[peerUid].name) || 'Utilisateur';
    openUserChat(peerUid, jobId, peerName);
  } catch (e) {
    console.error('openUserChatFromThreadId error', e);
  }
}

// Compteur d'ouvertures suite à une notification, par variante A/B (ou
// "digest" pour la relance des inactifs) — sert au dashboard admin pour
// comparer le taux d'ouverture des formulations testées. Transaction plutôt
// qu'un simple set() pour éviter que deux ouvertures simultanées s'écrasent.
function logNotificationOpened(variant) {
  if (!currentUser) return;
  const key = variant || 'unknown';
  try {
    const today = new Date().toISOString().slice(0, 10);
    // ServerValue.increment plutôt que transaction : une transaction exige
    // le DROIT DE LIRE le nœud avant (or notifStats n'est lisible que par
    // l'admin), donc elle échouait silencieusement pour tout user normal.
    // L'incrément est fait CÔTÉ SERVEUR : atomique, aucune lecture requise.
    db.ref('notifStats/' + today + '/' + key + '/opened').set(firebase.database.ServerValue.increment(1)).catch(() => {});
  } catch (e) { /* stat non critique, on ignore silencieusement */ }
}

// Compteur léger pour le dashboard admin (jobs publiés, contacts WhatsApp,
// avis laissés, inscriptions, boosts utilisés...) — une seule valeur par
// jour et par métrique dans dailyStats/{date}/{metric}, jamais l'historique
// complet des jobs/contacts/avis eux-mêmes. Ça permet d'afficher des
// tendances (aujourd'hui, cette semaine) sans jamais retélécharger toute la
// base — même principe que notifStats/logNotificationOpened ci-dessus,
// généralisé à toutes les actions clés de l'app. Transaction plutôt que
// get()+set() pour rester correct même si deux actions arrivent en même
// temps sur des appareils différents. Jamais bloquant : une stat ratée ne
// doit jamais empêcher l'action réelle (publication, contact...) d'aboutir
// — c'est pourquoi chaque appel est fire-and-forget avec son propre
// try/catch.
function bumpDailyStat(metric) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // ServerValue.increment plutôt que transaction : une transaction exige
    // le DROIT DE LIRE le nœud avant (or dailyStats n'est lisible que par
    // l'admin), donc elle échouait silencieusement pour tout user normal —
    // le dashboard admin ne se remplissait presque jamais. L'incrément
    // serveur est atomique et ne nécessite aucune lecture.
    db.ref('dailyStats/' + today + '/' + metric).set(firebase.database.ServerValue.increment(1)).catch(() => {});
  } catch (e) { /* stat non critique, on ignore silencieusement */ }
}

// ===== PUSH NOTIFICATIONS =====
// Clé VAPID publique (Firebase Console > Paramètres du projet > Cloud
// Messaging > Certificats Web Push). Obligatoire pour obtenir un jeton.
const FCM_VAPID_KEY = 'BDjptctrpoeyowsCJT_qcpnUzy15FJm6lCcmq6rtNlCh9BpqS1MpQMSuQsvoMsIA_PIreqDR3PAS1ZxvsgbvRAg';

// ===== ACCROCHE NOTIFICATIONS (avant le popup natif) =====
// Règle d'or : Notification.requestPermission() n'est JAMAIS appelé sans
// action volontaire de la personne. Un refus au popup natif est quasi
// irréversible (le site ne peut plus jamais le redéclencher), donc on
// maximise les chances d'un "Autoriser" en expliquant d'abord la valeur
// via notre propre bannière, et on ne montre le popup natif que si la
// personne clique elle-même sur "Activer les alertes".
const NOTIF_PRIMER_SNOOZE_KEY = 'jobmarket_notif_primer_snooze';
const NOTIF_PRIMER_SNOOZE_DAYS = 3;

// ===== INSTALLATION PWA =====
const INSTALL_SNOOZE_KEY = 'jmc_install_snoozed_at';
const INSTALL_SNOOZE_DAYS = 10;
let deferredInstallPrompt = null;

// "beforeinstallprompt" ne se déclenche que si le navigateur juge l'app
// installable (manifest valide, service worker actif...) — donc rien à
// vérifier nous-mêmes côté critères, seulement empêcher la mini-barre
// native de s'afficher toute seule et garder l'événement pour notre bouton.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  maybeShowInstallPrompt();
});

// Déjà installée (ouverte en mode standalone, ou l'utilisateur vient de
// l'installer) : plus jamais de bannière à afficher.
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const banner = document.getElementById('installPrompt');
  if (banner) banner.style.display = 'none';
  try { localStorage.setItem(INSTALL_SNOOZE_KEY, 'installed'); } catch (e) {}
});

// Vrai si un des 3 bandeaux du bas (install, rappel notifications, rappel
// boost) est actuellement visible. Centralisé ici et vérifié JUSTE AVANT
// chaque affichage réel (pas seulement au tout début d'un délai) — sinon
// deux bandeaux programmés à des délais différents peuvent quand même finir
// par s'afficher en même temps si l'un d'eux apparaît PENDANT le délai
// d'attente de l'autre.
function isBottomBannerBusy(excludeId) {
  return ['installPrompt', 'notifPrimer', 'boostExpiryBanner'].some(id => {
    if (id === excludeId) return false;
    const el = document.getElementById(id);
    return el && el.style.display !== 'none' && el.style.display !== '';
  });
}

function maybeShowInstallPrompt() {
  if (!deferredInstallPrompt) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return; // déjà installée

  const snoozed = localStorage.getItem(INSTALL_SNOOZE_KEY);
  if (snoozed === 'installed') return;
  const snoozedAt = parseInt(snoozed || '0', 10);
  const daysSince = (Date.now() - snoozedAt) / (1000 * 60 * 60 * 24);
  if (snoozedAt && daysSince < INSTALL_SNOOZE_DAYS) return;

  // On évite de superposer plusieurs bandeaux du bas en même temps
  // (rappel notifications, rappel boost...) : si l'un d'eux est déjà
  // visible, on retente un peu plus tard plutôt que de s'empiler dessus.
  if (isBottomBannerBusy('installPrompt')) { setTimeout(maybeShowInstallPrompt, 3000); return; }

  setTimeout(() => {
    // Re-vérification juste avant l'affichage réel : un autre bandeau a pu
    // apparaître pendant ces 6 secondes d'attente.
    if (isBottomBannerBusy('installPrompt')) { setTimeout(maybeShowInstallPrompt, 3000); return; }
    const banner = document.getElementById('installPrompt');
    if (banner && deferredInstallPrompt) banner.style.display = 'block';
  }, 6000);
}

async function respondToInstallPrompt(accepted) {
  const banner = document.getElementById('installPrompt');
  if (banner) banner.style.display = 'none';

  if (!accepted || !deferredInstallPrompt) {
    localStorage.setItem(INSTALL_SNOOZE_KEY, Date.now().toString());
    return;
  }

  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice; // 'accepted' | 'dismissed'
  if (outcome !== 'accepted') localStorage.setItem(INSTALL_SNOOZE_KEY, Date.now().toString());
  deferredInstallPrompt = null;
}

function maybeShowNotifPrimer() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

  // Déjà autorisé : pas besoin de bannière, on récupère juste le jeton en silence.
  if (Notification.permission === 'granted') { registerPushToken(); return; }

  // Déjà refusé au niveau du navigateur : redemander ne fera qu'agacer,
  // le popup natif ne réapparaîtra plus de toute façon.
  if (Notification.permission === 'denied') return;

  // "Plus tard" récemment cliqué : on respecte le délai avant de redemander.
  const snoozedAt = parseInt(localStorage.getItem(NOTIF_PRIMER_SNOOZE_KEY) || '0', 10);
  const daysSince = (Date.now() - snoozedAt) / (1000 * 60 * 60 * 24);
  if (snoozedAt && daysSince < NOTIF_PRIMER_SNOOZE_DAYS) return;

  // Petit délai pour laisser la personne découvrir la carte d'abord plutôt
  // que de lui sauter dessus dès l'arrivée : le contexte augmente le taux
  // d'acceptation du popup natif qui suit.
  setTimeout(() => {
    if (isBottomBannerBusy('notifPrimer')) { setTimeout(maybeShowNotifPrimer, 3000); return; }
    const banner = document.getElementById('notifPrimer');
    if (banner) banner.style.display = 'block';
  }, 4000);
}

function respondToNotifPrimer(accepted) {
  const banner = document.getElementById('notifPrimer');
  if (banner) banner.style.display = 'none';

  if (!accepted) {
    localStorage.setItem(NOTIF_PRIMER_SNOOZE_KEY, Date.now().toString());
    return;
  }

  localStorage.removeItem(NOTIF_PRIMER_SNOOZE_KEY);
  registerPushToken();
}

function registerPushToken() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
  if (!FCM_VAPID_KEY || FCM_VAPID_KEY === 'COLLE_TA_CLE_VAPID_ICI') return;
  if (!swRegistrationPromise) return;

  swRegistrationPromise
    .then(registration => {
      if (!registration) throw new Error('Service worker non enregistré');
      const messaging = firebase.messaging();
      Notification.requestPermission().then(permission => {
        if (permission !== 'granted') return;
        messaging.getToken({ vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: registration })
          .then(token => {
            if (currentUser && token) db.ref('notificationTokens/' + currentUser.uid).set(token);
          })
          .catch(err => console.warn('Jeton notification indisponible:', err.message));
      });

      // Un message reçu pendant que l'onglet est ouvert et au premier plan
      // NE DOIT PAS déclencher une notification système : la personne voit
      // déjà le job apparaître en direct via la bulle/panneau (section
      // "NOTIFICATIONS DES JOBS EN TEMPS RÉEL" plus bas), et le serveur ne
      // devrait de toute façon plus lui envoyer de push tant qu'elle est
      // active (voir setupPresence). On garde ce listener pour absorber le
      // message sans rien afficher, plutôt que de laisser passer le
      // comportement par défaut du SDK — c'est justement ce qui causait des
      // notifications en double avec sw.js quand les deux gestionnaires se
      // déclenchaient pour le même message.
      // Les notifs de "nouveau job" n'ont pas de champ "type" et sont
      // volontairement ignorées ici : la personne les voit déjà apparaître
      // en direct dans le fil (section "NOTIFICATIONS DES JOBS EN TEMPS
      // RÉEL" plus bas), et le serveur ne push de toute façon pas tant
      // qu'elle est active (voir setupPresence). MAIS tous les autres
      // types (contact, avis, rappels...) n'ont pas d'équivalent "déjà
      // visible en direct" : sans ce toast, ils disparaissaient
      // silencieusement dès que l'app était au premier plan — ce qui a été
      // repéré en testant le rappel de profil.
      messaging.onMessage((payload) => {
        const data = payload.data || {};
        if (data.type && data.title) {
          showToast(data.title + (data.body ? ' — ' + data.body : ''), 'info');
          if (typeof refreshNotifPanel === 'function') refreshNotifPanel();
        }
      });
    })
    .catch(err => console.warn('Service worker de notifications indisponible:', err.message));
}

// ===== PRÉSENCE (actif dans l'app / hors app) =====
// But : que le script d'envoi de notifications (scripts/sendNotifications.js)
// sache qui est "en train d'utiliser l'app" en ce moment, comme WhatsApp.
// Ces personnes ne reçoivent PAS de notification push : elles voient déjà
// le nouveau job apparaître en direct (bulle + panneau, section suivante).
// Tout le monde d'autre (app fermée, en arrière-plan, ou pas connecté)
// reçoit la notification push normalement.
let presenceUid = null;

function setupPresence(uid) {
  presenceUid = uid;

  // À chaque (re)connexion au serveur Firebase, on programme une
  // bascule automatique sur "inactive" si la connexion tombe (app tuée,
  // réseau coupé, onglet fermé...) — ça marche même sans code côté client
  // au moment de la coupure.
  db.ref('.info/connected').on('value', snap => {
    if (snap.val() !== true) return;
    db.ref('presence/' + uid).onDisconnect().set({
      state: 'inactive',
      lastChanged: firebase.database.ServerValue.TIMESTAMP
    }).then(writePresenceState);
  });

  // Bascule active/inactive selon que l'onglet/l'app est au premier plan
  // ou non (Page Visibility API) — c'est ce qui distingue "j'ai l'app
  // ouverte devant moi" de "l'app tourne juste en arrière-plan".
  document.addEventListener('visibilitychange', writePresenceState);
  window.addEventListener('pagehide', writePresenceState);
  writePresenceState();
}

function writePresenceState() {
  if (!presenceUid) return;
  const isVisible = document.visibilityState === 'visible';
  db.ref('presence/' + presenceUid).set({
    state: isVisible ? 'active' : 'inactive',
    lastChanged: firebase.database.ServerValue.TIMESTAMP
  });
  // Trace distincte de "presence" (qui est éphémère/temps réel) : sert
  // uniquement à scripts/sendReengagement.js pour savoir depuis combien de
  // temps quelqu'un n'a pas eu l'app au premier plan, afin de lui proposer
  // un résumé de rattrapage s'il devient inactif pendant plusieurs jours.
  if (isVisible) {
    db.ref('profiles/' + presenceUid).update({ lastActiveAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  }
}

function teardownPresence() {
  if (presenceUid) {
    db.ref('presence/' + presenceUid).set({
      state: 'inactive',
      lastChanged: firebase.database.ServerValue.TIMESTAMP
    });
  }
  presenceUid = null;
}

  // ===== NOTIFICATIONS DES JOBS EN TEMPS RÉEL =====
let chargementInitialJobs = true;

// On attend que Firebase finisse de charger les anciens jobs au démarrage
// (limitToLast(1) suffit : on n'a besoin que d'UNE réponse pour savoir que
// la connexion Firebase répond, pas de retélécharger tout le jeu de
// données rien que pour lever ce drapeau).
db.ref('jobs').limitToLast(1).once('value', () => {
  chargementInitialJobs = false;
  refreshNotifPanel();
});

// Dès qu'un NOUVEAU job est validé dans la base de données au Cameroun
db.ref('jobs').limitToLast(1).on('child_added', (snapshot) => {
  // Si la page vient d'être ouverte, on ignore les anciens jobs
  if (chargementInitialJobs) return;

  const nouveauJob = snapshot.val();
  
  // On utilise ta fonction showToast pour afficher la bulle d'alerte en direct !
  showToast(t('newJobToast').replace('{title}', nouveauJob.title).replace('{location}', nouveauJob.landmark || 'Cameroun'), 'info');
  refreshNotifPanel();
});

// ===== PANNEAU DE NOTIFICATIONS (jobs manqués depuis la dernière visite) =====
const NOTIF_SEEN_KEY = 'jobmarket_dernier_vu';

function getLastSeenNotifTime() {
  const stored = localStorage.getItem(NOTIF_SEEN_KEY);
  return stored ? parseInt(stored, 10) : Date.now();
}

function timeAgo(timestamp) {
  const diffMin = Math.floor((Date.now() - timestamp) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  return `il y a ${Math.floor(diffH / 24)} j`;
}

// Badge sur l'icône de l'app (barre des tâches / écran d'accueil PWA) —
// support natif Chrome/Edge desktop + Android, ignoré silencieusement
// ailleurs (Safari/iOS ne l'implémente pas encore).
function updateAppBadge(count) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  } catch (e) { /* ignore silencieusement */ }
}

function refreshNotifPanel() {
  const lastSeen = getLastSeenNotifTime();
  const newJobs = allJobs.filter(j => j.timestamp > lastSeen).sort((a, b) => b.timestamp - a.timestamp);

  const dot = document.getElementById('notifDot');
  if (dot) dot.style.display = newJobs.length > 0 ? 'block' : 'none';
  updateAppBadge(newJobs.length);

  const list = document.getElementById('notifList');
  if (!list) return;

  if (newJobs.length === 0) {
    list.innerHTML = '<div style="padding:16px;color:var(--text-dim);text-align:center;font-size:13px;">' + t('noNewJobsYet') + '</div>';
    return;
  }

  list.innerHTML = newJobs.map(j => `
    <div style="padding:10px 8px;border-radius:8px;cursor:pointer;" onclick="closeNotifPanel();focusJob(${j.lat}, ${j.lng})" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
      <div style="font-weight:600;font-size:13px;">${escapeHtml(j.title)}</div>
      <div style="font-size:12px;color:var(--text-dim);margin-top:2px;">${escapeHtml(j.landmark) || getCatLabel(j.icon)} · ${timeAgo(j.timestamp)}</div>
    </div>
  `).join('');
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const isOpen = panel.style.display === 'block';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    const settingsPanel = document.getElementById('settingsPanel');
    if (settingsPanel) settingsPanel.style.display = 'none'; // un seul panneau ouvert à la fois, plus lisible
    refreshNotifPanel();
    // Marque comme vues : la prochaine ouverture ne montrera que les jobs postérieurs à maintenant
    localStorage.setItem(NOTIF_SEEN_KEY, Date.now().toString());
    updateAppBadge(0);
    setTimeout(() => { const dot = document.getElementById('notifDot'); if (dot) dot.style.display = 'none'; }, 300);
  }
}

function closeNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (panel) panel.style.display = 'none';
}

  // ===== PUBLIER UN JOB PAR APPUI LONG SUR LA CARTE =====
map.on('contextmenu', function(e) {
  const lat = e.latlng.lat;
  const lng = e.latlng.lng;

  vibrateDevice(150);

  L.popup()
    .setLatLng(e.latlng)
    .setContent(`
      <div style="text-align:center; font-family:'DM Sans',sans-serif; padding:5px;">
        <b style="color:var(--text,#F0F0F8); display:block; margin-bottom:10px; font-family:'Syne',sans-serif;" data-i18n="positionSelectedLabel">📍 Position sélectionnée</b>
        <button onclick="preparerNouveauJob(${lat}, ${lng})" style="background:linear-gradient(135deg,var(--gold,#FFD700),#E6B800); color:#0A0A0F; border:none; padding:10px 16px; border-radius:12px; font-family:'Syne',sans-serif; font-weight:700; cursor:pointer;">
          âž• Publier un job ici
        </button>
      </div>
    `)
    .openOn(map);
});

// Fonction déclenchée quand on clique sur le bouton du popup
function preparerNouveauJob(lat, lng) {
  // 1. On ferme le popup de la carte
  map.closePopup();
  
  // 2. On renseigne les champs de coordonnées cachés du formulaire
  const inputLat = document.getElementById('jobLat');
  const inputLng = document.getElementById('jobLng');
  
  if (inputLat && inputLng) {
    inputLat.value = lat;
    inputLng.value = lng;
  }
  
  // 3. On ouvre directement le formulaire de publication (jobFormSheet).
  // CORRECTION : l'ancien code cliquait sur le premier bouton dont le onclick
  // contenait "toggle" — or c'est le bouton des notifications (toggleNotifPanel)
  // qui arrive avant le bouton "Publier" (toggleJobForm) dans la page. Résultat :
  // le panneau de notifications s'ouvrait à la place du formulaire, et il était
  // impossible d'ajouter un job depuis la carte. On cible maintenant directement
  // le bon panneau, sans ambiguïté.
  const sheet = document.getElementById('jobFormSheet');
  if (sheet) {
    sheet.classList.add('open');
    showToast(t('positionSavedComplete'), "success");
  } else {
    showToast(t('positionSavedFill'), "success");
  }
}
  
// ==========================================
// 1. FONCTION COMMUNE : GÉNÉRATEUR WHATSAPP INTERNATIONAL
// ==========================================
function genererLienWhatsApp(phone, titreJob, metier = "", competences = "") {
    if (!phone) return '#';
    
    // Nettoyage du numéro
    let numPropre = phone.toString().replace(/[^\d+]/g, '');
    
    // Retire le '+' ou '00' s'il est présent au début
    if (numPropre.startsWith('+')) {
        numPropre = numPropre.substring(1);
    } else if (numPropre.startsWith('00')) {
        numPropre = numPropre.substring(2);
    }

    // REGLE CAMEROUN : Si 9 chiffres commençant par 6, 2 ou 3 -> Ajoute le 237 automatiquement
    if (numPropre.length === 9 && (numPropre.startsWith('6') || numPropre.startsWith('2') || numPropre.startsWith('3'))) {
        numPropre = '237' + numPropre;
    }

    // Construction du message avec les détails pro
    let texte = `Bonjour, je vous contacte depuis JobMarket pour : "${titreJob}".`;
    
    if (metier || competences) {
        texte += `\n\n--- Profil du prestataire ---\n`;
        if (metier) texte += `Métier : ${metier}\n`;
        if (competences) texte += `Compétences : ${competences}\n`;
    }
    
    texte += `\nEst-ce toujours disponible ?`;
    
    return `https://api.whatsapp.com/send?phone=${numPropre}&text=${encodeURIComponent(texte)}`;
}
  
// ==========================================
// VERSION CORRIGÉE : OPEN JOB PREVIEW
// ==========================================
async function openJobPreview(jobId) {
    const job = allJobs.find(j => j.id === jobId);
    if (!job) {
        console.error("Impossible de trouver le job :", jobId);
        return;
    }

    window.currentPreviewJob = job;

    // ===== STATISTIQUES : compter une vue pour le propriétaire de l'annonce =====
    // (on ne compte pas si l'utilisateur regarde sa propre annonce)
    try {
        if (auth.currentUser && job.user && job.user !== auth.currentUser.uid) {
            countProfileView(job.user);
        }
    } catch (_) {}

    const saveBtnEl = document.getElementById('previewSaveBtn');
    if (saveBtnEl) {
        saveBtnEl.setAttribute('data-save-btn', jobId);
        updateSaveButtonsUI(jobId);
    }

    // Est-ce ma propre annonce ? On affiche "Modifier"/"Supprimer" dans ce cas,
    // et on masque le bouton "Contacter par WhatsApp" (inutile pour se contacter soi-même).
    const isOwner = !!(auth.currentUser && job.user === auth.currentUser.uid);
    const ownerActionsEl = document.getElementById('previewOwnerActions');
    const whatsAppBtnEl = document.getElementById('previewWhatsAppBtn');
    if (ownerActionsEl) ownerActionsEl.classList.toggle('hidden', !isOwner);
    if (whatsAppBtnEl) whatsAppBtnEl.classList.toggle('hidden', isOwner);
    const quoteBtnEl = document.getElementById('previewQuoteBtn');
    if (quoteBtnEl) quoteBtnEl.classList.toggle('hidden', isOwner);
    const chatBtnEl = document.getElementById('previewChatBtn');
    if (chatBtnEl) chatBtnEl.classList.toggle('hidden', isOwner);

    const toggleFilledLabelEl = document.getElementById('previewToggleFilledLabel');
    if (toggleFilledLabelEl) {
      toggleFilledLabelEl.textContent = job.status === 'filled' ? t('markAsOpenAgain') : t('markAsFilled');
    }

    // Pas utile d'analyser sa propre annonce pour des signaux d'alerte, et on
    // réinitialise l'affichage à chaque ouverture pour ne pas montrer le
    // résultat d'une annonce précédente.
    const scamCheckContainer = document.getElementById('previewScamCheck');
    const scamCheckBox = document.getElementById('scamCheckBox');
    if (scamCheckContainer) scamCheckContainer.style.display = isOwner ? 'none' : 'block';
    if (scamCheckBox) { scamCheckBox.style.display = 'none'; scamCheckBox.innerHTML = ''; }

    document.getElementById('previewTitle').innerText = job.title || 'Titre non spécifié';

    const priceBadge = document.getElementById('previewPriceBadge');
    if (priceBadge) priceBadge.innerText = (job.price ? job.price : '0') + ' XAF';

    const catBadge = document.getElementById('previewCategoryBadge');
    if (catBadge) catBadge.innerText = (typeof getCatLabel === 'function') ? getCatLabel(job.icon) : 'Général';

    const prevCat = document.getElementById('previewCategory');
    if (prevCat) prevCat.innerText = (typeof getCatLabel === 'function') ? getCatLabel(job.icon) : 'Général';

    const emailEl = document.getElementById('previewEmail');
    if (emailEl) emailEl.innerText = job.email || job.phone || job.userName || 'Non spécifié';

    document.getElementById('previewDescription').innerText = job.desc || 'Aucune description fournie.';

    // Traduction automatique si l'annonce n'est pas dans la langue actuelle :
    // on affiche d'abord l'original immédiatement (pas d'attente bloquante),
    // puis on bascule sur la traduction dès qu'elle est prête (cache ou IA).
    window.__jobTranslationState = {
      showingTranslation: false,
      original: { title: job.title || '', desc: job.desc || '' },
      translated: null
    };
    hideTranslationNotice();
    getTranslatedJobContent(job, jobId).then(translation => {
      // L'utilisateur a peut-être fermé ce popup / ouvert une autre annonce
      // entre-temps : on ignore un résultat devenu obsolète.
      if (!window.currentPreviewJob || window.currentPreviewJob.id !== jobId || !translation) return;
      window.__jobTranslationState.translated = translation;
      window.__jobTranslationState.showingTranslation = true;
      const titleEl = document.getElementById('previewTitle');
      const descEl = document.getElementById('previewDescription');
      if (titleEl) titleEl.innerText = translation.title;
      if (descEl) descEl.innerText = translation.desc;
      renderTranslationNotice(true);
    });

    // Avis sur l'auteur de l'annonce : visibles par TOUT LE MONDE (pas seulement
    // le propriétaire), pour que la personne puisse juger la fiabilité avant de contacter.
    renderOwnerReviews(job.user);

    // Bouton "Laisser un avis" si j'ai déjà contacté ce prestataire pour CETTE annonce.
    renderMyReviewAction(job);

    // AFFICHER LES CONTACTS SI C'EST MON ANNONCE
    const contactsContainer = document.getElementById('previewContactsContainer');
    if (contactsContainer) {
        contactsContainer.innerHTML = '';
        const user = auth.currentUser;
        
        if (user && job.user === user.uid) {
            contactsContainer.innerHTML = '<div style="margin-top: 15px; font-size: 14px; color: var(--text-dim);">' + t('loadingWhatsappContacts') + '</div>';
            
            try {
                const contactEntries = await fetchJobContactsFromIndex('job_contacts_by_job/' + jobId);
                if (contactEntries.length === 0) {
                    contactsContainer.innerHTML = `
                        <div style="margin-top: 20px; padding: 15px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px;">
                            <h3 style="margin:0 0 10px 0; font-size: 16px; color: var(--text);" data-i18n="interestedPeopleTitle">Personnes intéressées</h3>
                            <p style="font-size: 13px; color: var(--text-dim); margin: 0;" data-i18n="noContactYet">Personne ne vous a encore contacté pour ce besoin.</p>
                        </div>`;
                } else {
                    const uniqueContacts = new Map();
                    contactEntries.forEach(entry => {
                        const data = entry.val;
                        if (data && data.contactUid && !uniqueContacts.has(data.contactUid)) {
                            uniqueContacts.set(data.contactUid, data);
                        }
                    });
                    
                    if (uniqueContacts.size === 0) {
                        contactsContainer.innerHTML = `
                            <div style="margin-top: 20px; padding: 15px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px;">
                                <h3 style="margin:0 0 10px 0; font-size: 16px; color: var(--text);" data-i18n="interestedPeopleTitle">Personnes intéressées</h3>
                                <p style="font-size: 13px; color: var(--text-dim); margin: 0;" data-i18n="noContactYet">Personne ne vous a encore contacté pour ce besoin.</p>
                            </div>`;
                    } else {
                        let html = `
                            <div style="margin-top: 20px; padding: 15px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px;">
                                <h3 style="margin:0 0 10px 0; font-size: 16px; color: var(--text);">${uniqueContacts.size} personne(s) intéressée(s) :</h3>
                                <div style="display: flex; flex-direction: column; gap: 10px;">`;
                        for (let [contactUid] of uniqueContacts) {
                            const userSnapshot = await db.ref(`profiles/${contactUid}`).once('value');
                            const userData = userSnapshot.val() || {};
                            const name = userData.name || 'Utilisateur';
                            const jobTitle = userData.jobTitle || 'Non spécifié';
                            const profileImg = userData.profileImage || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name) + '&background=25D366&color=fff';
                            html += `
                                <div style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 5px; border-radius: 10px; transition: background 0.2s;" onclick="viewUserProfile('${contactUid}')" onmouseover="this.style.background='rgba(255,255,255,0.06)'" onmouseout="this.style.background='transparent'">
                                    <img src="${escapeHtml(cloudinaryResize(profileImg, 80, 80))}" loading="lazy" alt="${t('altProfilePhoto')}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; border: 2px solid #25D366;">
                                    <div>
                                        <div style="font-weight: bold; color: var(--text); font-size: 14px;">${escapeHtml(name)}</div>
                                        <div style="font-size: 12px; color: var(--text-dim);">${escapeHtml(jobTitle)}</div>
                                    </div>
                                </div>`;
                        }
                        html += `</div></div>`;
                        contactsContainer.innerHTML = html;
                    }
                }
            } catch(e) {
                console.error("Erreur chargement contacts", e);
                contactsContainer.innerHTML = '<div style="margin-top: 15px; font-size: 14px; color: var(--danger);">Erreur de chargement.</div>';
            }
        }
    }

    document.getElementById('jobPreviewDrawer').classList.add('open');
}

// Bascule le statut "pourvu" d'une annonce (réservé au propriétaire). Une
// annonce pourvue disparaît de la carte/liste publiques (voir applyFilters,
// filtre notFilled) mais reste visible dans "Mes publications" — on ne
// supprime rien, juste un champ status, réversible en un tap si besoin
// (ex: le prestataire trouvé s'est finalement désisté).
async function toggleJobFilledFromPreview() {
    const job = window.currentPreviewJob;
    if (!job) return;
    if (!currentUser || job.user !== currentUser.uid) {
        showToast(t('toastCantEditOthers'), 'error');
        return;
    }
    const nowFilled = job.status !== 'filled';
    try {
        await db.ref('jobs/' + job.id).update({ status: nowFilled ? 'filled' : null });
        showToast(nowFilled ? t('toastMarkedFilled') : t('toastMarkedOpenAgain'), 'success');
        closeJobPreview();
    } catch (e) {
        console.error('toggleJobFilledFromPreview error', e);
        showToast(t('toastSendErrorRetry'), 'error');
    }
}

// Pré-remplit le formulaire avec les données existantes pour modifier une annonce
function editJobFromPreview() {
    const job = window.currentPreviewJob;
    if (!job) return;
    if (!currentUser || job.user !== currentUser.uid) {
        showToast(t('toastCantEditOthers'), 'error');
        return;
    }

    editingJobId = job.id;

    document.getElementById('title').value = job.title || '';
    document.getElementById('price').value = job.price || '';
    document.getElementById('phone').value = job.phone || '';
    document.getElementById('phone2').value = job.phone2 || '';
    document.getElementById('landmark').value = job.landmark || '';
    document.getElementById('desc').value = job.desc || '';
    document.getElementById('requirements').value = job.requirements || '';

    const catSelect = document.getElementById('category');
    if (catSelect) {
        const opt = Array.from(catSelect.options).find(o => o.value.split('|')[0] === job.icon);
        if (opt) catSelect.value = opt.value;
    }

    const inputLat = document.getElementById('jobLat');
    const inputLng = document.getElementById('jobLng');
    if (inputLat) inputLat.value = job.lat;
    if (inputLng) inputLng.value = job.lng;

    const publishBtn = document.getElementById('publishBtn');
    if (publishBtn) publishBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Enregistrer les modifications';

    document.getElementById('jobPreviewDrawer').classList.remove('open');
    document.getElementById('jobFormSheet').classList.add('open');
    showToast(t('toastEditFieldsThenValidate'), 'info');
}

// Supprime l'annonce actuellement affichée dans le drawer (réservé au propriétaire)
async function deleteJobFromPreview() {
    const job = window.currentPreviewJob;
    if (!job) return;
    if (!currentUser || job.user !== currentUser.uid) {
        showToast(t('toastCantDeleteOthers'), 'error');
        return;
    }
    if (!confirm('Supprimer définitivement cette annonce ?')) return;
    try {
        await db.ref('jobs/' + job.id).remove();
        showToast(t('toastListingDeleted'), 'success');
        document.getElementById('jobPreviewDrawer').classList.remove('open');
        syncJobs();
    } catch (e) {
        console.error(e);
        showToast(t('toastDeleteError'), 'error');
    }
}

// ==========================================
// FONCTION DE FERMETURE DU VOLET
// ==========================================
function closeJobPreview() {
    const drawer = document.getElementById('jobPreviewDrawer');
    if (drawer) {
        drawer.classList.remove('open');
    }
}

// Si la modale détaillée OU la fiche de profil est actuellement ouverte et
// affiche précisément CE prestataire, on rafraîchit sa note/ses avis tout
// de suite (sans attendre une fermeture/réouverture manuelle) — typiquement
// juste après qu'un avis vient d'être laissé et que rating-sync.js a
// recalculé la note côté serveur.
function refreshOpenPreviewIfShowingProfile(uid) {
  const drawer = document.getElementById('jobPreviewDrawer');
  const job = window.currentPreviewJob;
  if (drawer && drawer.classList.contains('open') && job && job.user === uid) {
    renderOwnerReviews(job.user);
  }

  const profileSheet = document.getElementById('profileSheet');
  if (profileSheet && profileSheet.classList.contains('open') && window.currentProfileSheetUid === uid) {
    renderProfileBadgeAndRating(profilesCache[uid] || {});
    renderOwnerReviews(uid, 'profileReviewsBox');
  }
}
 
 // Fonction pour ouvrir un panneau et charger les données de l'utilisateur
// ==========================================
// GESTION DES PROFILS (LECTURE SEULE ET ÉDITION)
// ==========================================

// 1. Voir le profil de quelqu'un d'autre (Lecture seule)
// Affiche le badge "vérifié" + résumé de note (★ moyenne / nb d'avis) en
// tête de la fiche profil — que ce soit la sienne ou celle d'un autre.
function renderProfileBadgeAndRating(profile) {
    const el = document.getElementById('profileBadgeRating');
    if (!el) return;

    const verifiedHtml = profile.verified ? `
        <div style="display:flex;align-items:center;gap:6px;color:var(--blue);font-weight:700;font-size:13px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--blue)"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
            Profil vérifié
        </div>` : '';

    const count = profile.ratingCount || 0;
    const avg = profile.ratingAvg || 0;
    const ratingHtml = count > 0 ? `
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;">
            <span style="color:var(--gold,#FFD700);letter-spacing:1px;">${'★★★★★☆☆☆☆☆'.slice(5 - Math.round(avg), 10 - Math.round(avg))}</span>
            <span style="color:var(--text-dim,#9999BC);">${avg.toFixed(1)}/5 · ${count} avis</span>
        </div>` : '';

    if (!verifiedHtml && !ratingHtml) { el.innerHTML = ''; return; }
    el.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin:4px 0 16px 0;';
    el.innerHTML = verifiedHtml + ratingHtml;
}

async function viewUserProfile(uid) {
    if (typeof closeJobPreview === 'function') closeJobPreview();
    
    const sheet = document.getElementById('profileSheet');
    if (!sheet) return;

    sheet.classList.add('open');
    window.currentProfileSheetUid = uid; // pour refreshOpenPreviewIfShowingProfile()

    try {
        const snapshot = await db.ref(`profiles/${uid}`).once('value');
        const data = snapshot.val() || {};

        const nameInput = document.getElementById('profileName');
        const companyInput = document.getElementById('profileCompany');
        const jobTitleInput = document.getElementById('jobTitle');
        const skillsInput = document.getElementById('skills');
        
        if (nameInput) { nameInput.value = data.name || 'Non spécifié'; nameInput.readOnly = true; }
        if (companyInput) { companyInput.value = data.company || 'Non spécifié'; companyInput.readOnly = true; }
        if (jobTitleInput) { jobTitleInput.value = data.jobTitle || 'Non spécifié'; jobTitleInput.readOnly = true; }
        if (skillsInput) { skillsInput.value = data.skills || 'Non spécifié'; skillsInput.readOnly = true; }
        
        const saveBtn = document.getElementById('saveProfileBtn');
        if (saveBtn) saveBtn.style.display = 'none';
        
        const changePhotoBtn = document.querySelector("button[onclick*='profileImageInput']");
        if (changePhotoBtn) changePhotoBtn.style.display = 'none';

        const headerTitle = document.querySelector('.profile-sheet-header h2');
        if (headerTitle) headerTitle.innerText = t("artisanProfile");

        if (data.profileImage) {
            document.getElementById('profileImagePreview').innerHTML = `<img src="${escapeHtml(data.profileImage)}" alt="${t('altProfilePhotoPreview')}" style="width:100%; height:100%; object-fit:cover;">`;
        } else {
            const name = data.name || 'Utilisateur';
            document.getElementById('profileImagePreview').innerHTML = `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=25D366&color=fff" alt="${t('altGeneratedAvatar')}" style="width:100%; height:100%; object-fit:cover;">`;
        }

        // Le profil d'un AUTRE utilisateur n'affiche jamais ses blocs privés
        // (statut de vérification, parrainage) — uniquement badge/note/avis.
        const verifBox = document.getElementById('verificationStatusBox');
        if (verifBox) verifBox.style.display = 'none';
        const refBox = document.getElementById('referralBox');
        if (refBox) refBox.style.display = 'none';

        renderProfileBadgeAndRating(data);
        renderOwnerReviews(uid, 'profileReviewsBox');
    } catch (error) {
        console.error("Erreur profil:", error);
    }
}

// 2. Ouvrir TON propre profil (Mode édition)
async function openProfileSheet() {
    const previewDrawer = document.getElementById('jobPreviewDrawer');
    if (previewDrawer) previewDrawer.classList.remove('open');

    const sheet = document.getElementById('profileSheet');
    if (sheet) sheet.classList.add('open');

    vibrateDevice(50);

    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
        showToast(t('toastLoginToEditProfile'), 'error');
        return;
    }

    try {
        const snapshot = await db.ref(`profiles/${user.uid}`).once('value');
        const data = snapshot.val() || {};
        
        const nameInput = document.getElementById('profileName');
        const companyInput = document.getElementById('profileCompany');
        const jobTitleInput = document.getElementById('jobTitle');
        const skillsInput = document.getElementById('skills');
        
        if (nameInput) { nameInput.value = data.name || ''; nameInput.readOnly = false; }
        if (companyInput) { companyInput.value = data.company || ''; companyInput.readOnly = false; }
        if (jobTitleInput) { jobTitleInput.value = data.jobTitle || ''; jobTitleInput.readOnly = false; }
        if (skillsInput) { skillsInput.value = data.skills || ''; skillsInput.readOnly = false; }
        
        const saveBtn = document.getElementById('saveProfileBtn');
        if (saveBtn) saveBtn.style.display = 'block';
        
        const changePhotoBtn = document.querySelector("button[onclick*='profileImageInput']");
        if (changePhotoBtn) changePhotoBtn.style.display = 'inline-block';

        const headerTitle = document.querySelector('.profile-sheet-header h2');
        if (headerTitle) headerTitle.innerText = t("myProProfile");

        if (data.profileImage) {
            document.getElementById('profileImagePreview').innerHTML = `<img src="${escapeHtml(data.profileImage)}" alt="${t('altProfilePhotoPreview')}" style="width:100%; height:100%; object-fit:cover;">`;
        } else {
            document.getElementById('profileImagePreview').innerHTML = `<span style="color: #666; font-size: 12px;">Photo</span>`;
        }

        renderVerificationStatus(data, user);
        renderReferralBox(data, user);
        renderAchievements(data);
        renderPortfolio(data);
        renderAvailability(data);
        renderProStats(data);
        renderPaymentButtons(data);

        const verifBox = document.getElementById('verificationStatusBox');
        if (verifBox) verifBox.style.display = 'block';
        const refBox = document.getElementById('referralBox');
        if (refBox) refBox.style.display = 'block';

        renderProfileBadgeAndRating(data);
        renderOwnerReviews(user.uid, 'profileReviewsBox');

        // Écoute en temps réel : si l'admin accepte la vérification (ou toute
        // autre mise à jour du profil) PENDANT que la fiche est déjà ouverte,
        // l'espace pour le code à 7 chiffres apparaît directement, sans avoir
        // à fermer/rouvrir la fiche.
        if (profileLiveRef) { profileLiveRef.off(); }
        profileLiveRef = db.ref(`profiles/${user.uid}`);
        profileLiveRef.on('value', (snap) => {
            const freshData = snap.val() || {};
            renderVerificationStatus(freshData, user);
            renderReferralBox(freshData, user);
            renderProfileBadgeAndRating(freshData);
        });
    } catch (error) {
        console.error("Erreur profil:", error);
    }
}

// Affiche le badge "Vérifié" ou un bouton pour demander la vérification.
// La vérification elle-même reste 100% manuelle : vous recevez la demande
// sur WhatsApp, vous vérifiez la personne vous-même, puis vous passez
// "verified" à true directement dans Firebase Console (Realtime Database
// → profiles → {uid} → verified = true). Aucun code à toucher pour valider.
function renderVerificationStatus(profile, user) {
    const box = document.getElementById('verificationStatusBox');
    if (!box) return;

    const emailBadge = profile.emailVerified
        ? `<div style="font-size:12px;color:var(--text-dim,#9999BC);margin-bottom:8px;">✉️ ${t('emailVerified')}</div>`
        : `<div style="font-size:12px;color:var(--text-dim,#9999BC);margin-bottom:8px;">${t('emailNotVerified')}</div>`;

    if (profile.verified) {
        box.innerHTML = emailBadge;
        return;
    }

    // NOUVEAU : la demande a été acceptée par l'admin, un code à 7 chiffres a été
    // généré et envoyé sur WhatsApp — il ne reste qu'à le saisir ici pour finaliser.
    if (profile.verificationCode) {
        box.innerHTML = emailBadge + `
            <div style="font-size:13px;color:var(--green,#25D366);font-weight:700;margin-top:10px;margin-bottom:8px;">
                ✅ Demande acceptée ! Entre le code à 7 chiffres reçu sur WhatsApp pour finaliser ta vérification.
            </div>
            <div style="display:flex;gap:6px;">
                <input id="verifyCodeInput" type="text" inputmode="numeric" maxlength="7" data-i18n-placeholder="verifyCodePlaceholder" placeholder="Code à 7 chiffres" style="flex:1;min-width:0;background:rgba(255,255,255,0.05);border:1px solid var(--border,#333);color:var(--text,#fff);padding:10px 12px;border-radius:8px;font-size:16px;letter-spacing:2px;">
                <button type="button" id="confirmVerificationCodeBtn" onclick="confirmVerificationCode()" style="background:var(--gold,#FFD700);border:none;color:#111;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">Valider le code</button>
            </div>`;
        return;
    }

    const requestSent = profile.verificationRequested;
    if (requestSent) {
        box.innerHTML = emailBadge + `
            <div style="font-size:13px;color:var(--text-dim,#9999BC);margin-top:10px;">
                ${t('requestSent')}
            </div>`;
        return;
    }

    box.innerHTML = emailBadge + `
        <div style="font-size:13px;color:var(--text-dim,#9999BC);margin-top:10px;margin-bottom:10px;">
            ${t('profileNotVerified')}
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px;">
            <div>
                <div style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:700;color:var(--green,#25D366);margin-bottom:6px;">
                    <span style="font-size:20px;">📱</span> <span data-i18n="yourWhatsappNumberLabel">Ton numéro WhatsApp</span> <span style="font-size:11px;font-weight:600;color:#111;background:var(--green,#25D366);padding:2px 8px;border-radius:10px;">OBLIGATOIRE</span>
                </div>
                <input id="verifyWhatsAppInput" type="tel" placeholder="Ex: +237650420710" value="${escapeHtml(profile.whatsappNumber || '')}" style="width:100%;box-sizing:border-box;background:rgba(37,211,102,0.08);border:2px solid var(--green,#25D366);color:var(--text,#fff);padding:14px 12px;border-radius:10px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
                <div style="font-size:11px;color:var(--text-dim,#9999BC);margin-top:4px;" data-i18n="whatsappNumberHint">C'est sur ce numéro que tu recevras ton code de vérification à 7 chiffres.</div>
            </div>
            <div>
                <div style="font-size:12px;color:var(--text-dim,#9999BC);margin-bottom:4px;" data-i18n="idPhotoHint">📄 Photo de ta pièce d'identité (CNI, passeport...)</div>
                <input type="file" id="verifyIdPhotoInput" accept="image/*" style="display:none;" onchange="previewVerificationPhoto(this,'verifyIdPhotoPreview')">
                <div id="verifyIdPhotoPreview" onclick="document.getElementById('verifyIdPhotoInput').click()" style="cursor:pointer;height:90px;border:2px dashed var(--gold,#FFD700);background:rgba(255,215,0,0.06);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:12px;font-weight:700;color:var(--gold,#FFD700);overflow:hidden;text-align:center;">
                    <span style="font-size:24px;">📄</span>
                    <span data-i18n="tapToAddPhoto">Toucher pour ajouter la photo</span>
                </div>
            </div>
            <div>
                <div style="font-size:12px;color:var(--text-dim,#9999BC);margin-bottom:4px;" data-i18n="selfieHint">🤳 Selfie de toi tenant la même pièce à côté de ton visage</div>
                <input type="file" id="verifySelfiePhotoInput" accept="image/*" style="display:none;" onchange="previewVerificationPhoto(this,'verifySelfiePhotoPreview')">
                <div id="verifySelfiePhotoPreview" onclick="document.getElementById('verifySelfiePhotoInput').click()" style="cursor:pointer;height:90px;border:2px dashed var(--gold,#FFD700);background:rgba(255,215,0,0.06);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font-size:12px;font-weight:700;color:var(--gold,#FFD700);overflow:hidden;text-align:center;">
                    <span style="font-size:24px;">🤳</span>
                    <span data-i18n="tapToAddSelfie">Toucher pour ajouter le selfie</span>
                </div>
            </div>
        </div>
        <button type="button" id="requestVerificationBtn" onclick="requestVerification()" style="background:none;border:1px solid var(--blue);color:var(--blue);padding:8px 14px;border-radius:20px;cursor:pointer;font-size:13px;font-weight:700;width:100%;">${t('requestVerificationBtn')}</button>
    `;
}

// Prévisualise la photo choisie (CNI ou selfie) directement dans son cadre.
function previewVerificationPhoto(input, previewId) {
    const preview = document.getElementById(previewId);
    if (!preview || !input.files || !input.files[0]) return;
    const file = input.files[0];
    if (!ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        showToast(t('invalidPhotoFormat').replace('{mb}', MAX_IMAGE_SIZE_MB), 'error');
        input.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => { preview.innerHTML = `<img src="${reader.result}" alt="${t('altSelectedPhotoPreview')}" style="width:100%;height:100%;object-fit:cover;">`; };
    reader.readAsDataURL(file);
}

// Upload une photo de vérification compressée vers Cloudinary, renvoie son URL.
async function uploadVerificationPhoto(file) {
    return uploadToCloudinary(file);
}

// Affiche le lien de parrainage personnel, le nombre de filleuls, et permet
// d'utiliser un crédit de mise en avant gagné (1 crédit tous les 3 filleuls).
function renderReferralBox(profile, user) {
    const box = document.getElementById('referralBox');
    if (!box) return;

    const link = getReferralLink(user.uid);
    const count = profile.referralCount || 0;
    const credits = profile.boostCredits || 0;
    const toNext = 3 - (count % 3);

    let html = `
        <div style="font-weight:700;font-size:14px;margin-bottom:8px;">🎁 ${t('referralProgram')}</div>
        <div style="font-size:12px;color:var(--text-dim,#9999BC);margin-bottom:10px;">
            ${t('referralExplain')}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
            <input readonly value="${link}" onclick="this.select()" style="flex:1;min-width:0;background:rgba(255,255,255,0.05);border:1px solid var(--border,#333);color:var(--text,#fff);padding:8px 10px;border-radius:8px;font-size:12px;">
            <button type="button" onclick="copyReferralLink('${link}')" style="background:var(--blue);border:none;color:white;padding:8px 12px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">${t('copyBtn')}</button>
        </div>
        <button type="button" onclick="shareReferralLink('${link}')" style="width:100%;background:#25D366;border:none;color:white;padding:10px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:10px;">📞 ${t('shareWhatsApp')}</button>
        <div style="font-size:12px;color:var(--text-dim,#9999BC);">
            ${t('referralCountText').replace('{count}', count).replace('{next}', toNext)}
        </div>
    `;

    if (credits > 0) {
        html += `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border,#333);">
            <div style="font-size:13px;font-weight:700;color:var(--gold,#FFD700);margin-bottom:8px;">✨ ${t('creditsAvailable').replace('{credits}', credits)}</div>
            <div id="boostJobPicker" style="font-size:12px;color:var(--text-dim,#9999BC);">${t('loadingReviews')}</div>
        </div>`;
    }

    box.innerHTML = html;
    if (credits > 0) renderBoostJobPicker(user.uid);
}

// Récupère et affiche les annonces boostables directement depuis Firebase
// (pas depuis allJobs, plafonné à JOBS_LIMIT) — mêmes raisons que
// fetchUserJobs ci-dessus : une annonce plus ancienne que ce plafond
// resterait boostable mais invisible dans ce sélecteur sinon.
async function renderBoostJobPicker(uid) {
    const pickerEl = document.getElementById('boostJobPicker');
    if (!pickerEl) return;
    const myJobs = await fetchUserJobs(uid);
    if (!document.getElementById('boostJobPicker')) return; // panneau refermé entre-temps
    if (myJobs.length === 0) {
        pickerEl.innerHTML = `<div style="font-size:12px;color:var(--text-dim,#9999BC);">${t('publishToBoost')}</div>`;
        return;
    }
    pickerEl.innerHTML = myJobs.map(j => {
        const isBoosted = j.boosted && j.boostedUntil > Date.now();
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;">
            <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(j.title)}</span>
            ${isBoosted
                ? `<span style="font-size:11px;color:var(--gold,#FFD700);white-space:nowrap;">🚀 ${t('activeBoost')}</span>`
                : `<button type="button" onclick="useBoostCredit('${j.id}')" style="background:var(--gold,#FFD700);color:#111;border:none;padding:5px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;">${t('boostBtn')}</button>`}
        </div>`;
    }).join('');
}

function copyReferralLink(link) {
    navigator.clipboard.writeText(link)
        .then(() => showToast(t('toastLinkCopied'), 'success'))
        .catch(() => showToast(t('toastCopyFailed'), 'error'));
}

function shareReferralLink(link) {
    const message = t('waMsgReferral').replace('{link}', link);
    openWhatsAppReliably(null, null, message);
}

// Consomme un crédit de mise en avant pour booster une annonce 7 jours.
async function useBoostCredit(jobId) {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;
    try {
        const snap = await db.ref('profiles/' + user.uid + '/boostCredits').once('value');
        const credits = snap.val() || 0;
        if (credits <= 0) { showToast(t('toastNoCreditsAvailable'), 'error'); return; }

        // L'activation elle-même passe désormais par un worker serveur (voir
        // worker/activate-boost.js) : lui seul peut lier de façon fiable
        // l'écriture de jobs/{id}/boosted+boostedUntil à la dépense réelle
        // d'un crédit, puisque les règles Firebase valident chaque champ
        // indépendamment et ne peuvent pas garantir qu'un update() multi-
        // chemins côté client a bien touché les deux à la fois. Le worker
        // vérifie aussi que ce job appartient bien à l'utilisateur courant.
        const idToken = await user.getIdToken();
        const res = await fetch(BOOST_ACTIVATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, jobId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            if (data.error === 'no_credits') { showToast(t('toastNoCreditsAvailable'), 'error'); return; }
            throw new Error(data.error || 'boost_failed');
        }

        showToast(t('toastBoostedSeven'), 'success');
        bumpDailyStat('boostsUsed');
        const freshSnap = await db.ref('profiles/' + user.uid).once('value');
        renderReferralBox(freshSnap.val() || {}, user);
    } catch (e) {
        console.error('useBoostCredit error', e);
        showToast(t('toastBoostError'), 'error');
    }
}

// ─────────────────────────────────────────────────────────────
//  Lance un paiement (Pro, badge vérifié, ou pack de boosts) via NotchPay.
//  plan = 'pro_month' | 'verified' | 'boost_pack'
// ─────────────────────────────────────────────────────────────
async function startPayment(plan) {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
        showToast(t('toastLoginToPay'), 'error');
        return;
    }
    try {
        showToast(t('toastOpeningPayment'), 'info');
        const idToken = await user.getIdToken();
        const res = await fetch(PAYMENT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken, plan })
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success || !data.authorization_url) {
            throw new Error(data.error || 'payment_failed');
        }

        // Redirige vers la page de paiement MoMo / Orange Money
        window.location.href = data.authorization_url;
    } catch (e) {
        console.error('startPayment error', e);
        showToast(t('toastPaymentFailed'), 'error');
    }
}

async function requestVerification() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;

    const idInput = document.getElementById('verifyIdPhotoInput');
    const selfieInput = document.getElementById('verifySelfiePhotoInput');
    const waInput = document.getElementById('verifyWhatsAppInput');
    const idFile = idInput && idInput.files && idInput.files[0];
    const selfieFile = selfieInput && selfieInput.files && selfieInput.files[0];
    const whatsappNumber = waInput ? waInput.value.trim() : '';

    if (!idFile || !selfieFile) {
        showToast(t('toastNeedIdAndSelfie'), 'error');
        return;
    }
    if (!/^\+?\d{8,15}$/.test(whatsappNumber.replace(/[\s.-]/g, ''))) {
        showToast(t('toastNeedValidWhatsApp'), 'error');
        return;
    }

    const btn = document.getElementById('requestVerificationBtn');
    const originalBtnText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = 'Envoi des photos...'; }

    // Ouvert tout de suite, dans le même clic : l'envoi des photos peut prendre
    // plusieurs secondes, et le navigateur bloquerait sinon l'ouverture de WhatsApp
    // une fois l'upload terminé (elle ne serait plus liée directement au clic
    // d'origine — même problème que pour le contact d'un prestataire, voir plus bas).
    const waWindow = openWhatsAppPlaceholderTab();

    try {
        const snap = await db.ref('profiles/' + user.uid).once('value');
        const profile = snap.val() || {};
        const name = profile.name || profile.company || user.displayName || 'Utilisateur';
        const jobTitle = profile.jobTitle || 'Non spécifié';

        const [idPhotoUrl, selfiePhotoUrl] = await Promise.all([
            uploadVerificationPhoto(idFile),
            uploadVerificationPhoto(selfieFile)
        ]);

        await db.ref('profiles/' + user.uid).update({
            verificationRequested: Date.now(),
            verificationDocs: { idPhotoUrl, selfiePhotoUrl },
            whatsappNumber: whatsappNumber
        });

        const message = `Bonjour, je souhaite faire vérifier mon profil JobMarket.\nNom : ${name}\nMétier : ${jobTitle}\nNuméro WhatsApp : ${whatsappNumber}\nMes documents ont été envoyés directement dans l'app (visibles dans le panel admin).`;
        openWhatsAppReliably(waWindow, ADMIN_WHATSAPP_NUMBER, message);

        renderVerificationStatus({ ...profile, verificationRequested: true, whatsappNumber }, user);
        showToast(t('toastRequestSent'), 'success');
    } catch (e) {
        console.error('requestVerification error', e);
        if (waWindow) waWindow.close();
        showToast(t('toastPhotoSendError'), 'error');
        if (btn) { btn.disabled = false; btn.innerText = originalBtnText; }
    }
}

// Vérifie le code à 7 chiffres saisi par l'utilisateur contre celui généré par
// l'admin lors de l'acceptation (voir approveVerification). Si ça correspond,
// le profil passe enfin à verified: true.
async function confirmVerificationCode() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;

    const input = document.getElementById('verifyCodeInput');
    const code = input ? input.value.trim() : '';
    if (!/^\d{7}$/.test(code)) {
        showToast(t('toastCodeMustBe7Digits'), 'error');
        return;
    }

    const btn = document.getElementById('confirmVerificationCodeBtn');
    const originalBtnText = btn ? btn.innerText : '';
    if (btn) { btn.disabled = true; btn.innerText = 'Vérification...'; }

    try {
        const snap = await db.ref('profiles/' + user.uid).once('value');
        const profile = snap.val() || {};

        if (!profile.verificationCode) {
            showToast(t('toastNoCodePending'), 'error');
            if (btn) { btn.disabled = false; btn.innerText = originalBtnText; }
            return;
        }

        if (code !== String(profile.verificationCode)) {
            showToast(t('toastWrongCode'), 'error');
            if (btn) { btn.disabled = false; btn.innerText = originalBtnText; }
            return;
        }

        await db.ref('profiles/' + user.uid).update({
            verified: true,
            phoneVerified: true, // le code envoyé au numéro WhatsApp fourni, puis re-saisi ici, prouve la possession du numéro — ce champ n'était jusqu'ici jamais mis à jour malgré cette preuve
            verificationCode: null,
            verificationRequested: null,
            verificationDocs: null
        });

        showToast(t('toastProfileVerified'), 'success');
        const freshSnap = await db.ref('profiles/' + user.uid).once('value');
        renderVerificationStatus(freshSnap.val() || {}, user);
    } catch (e) {
        console.error('confirmVerificationCode error', e);
        showToast(t('toastCodeVerifyError'), 'error');
        if (btn) { btn.disabled = false; btn.innerText = originalBtnText; }
    }
}

// Génère un code de vérification à 7 chiffres (1000000-9999999, toujours 7 chiffres).
function generateVerificationCode() {
    return String(Math.floor(1000000 + Math.random() * 9000000));
}
   
// 1. Sauvegarde du profil
async function saveProfile() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
        alert(t('mustBeLoggedIn'));
        return;
    }

    const btn = document.getElementById('saveProfileBtn');
    if (!validateFields(['profileName', 'profileCompany', 'jobTitle', 'skills'])) return;
    const originalText = btn.innerText;
    btn.disabled = true;

    const name = document.getElementById('profileName').value.trim();
    const company = document.getElementById('profileCompany').value.trim();
    const jobTitle = document.getElementById('jobTitle').value.trim();
    const skills = document.getElementById('skills').value.trim();
    let profileImageUrl = null;

    const fileInput = document.getElementById('profileImageInput');
    if (fileInput && fileInput.files && fileInput.files[0]) {
        const profileFile = fileInput.files[0];
        if (!ALLOWED_IMAGE_TYPES.includes(profileFile.type) || profileFile.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
            alert(`Photo invalide : formats acceptés JPG, PNG, WEBP, GIF — taille max ${MAX_IMAGE_SIZE_MB} Mo.`);
            btn.disabled = false;
            return;
        }
        btn.innerText = "Téléchargement...";
        try {
            profileImageUrl = await uploadToCloudinary(profileFile);
        } catch(e) {
            console.warn("Erreur upload photo", e);
            showToast(t('photoUploadError'), 'error');
            btn.innerText = originalText;
            btn.disabled = false;
            return;
        }
    }

    if (!name || !jobTitle) {
        alert(t('fillNameAndJob'));
        btn.innerText = originalText;
        btn.disabled = false;
        return;
    }

    btn.innerText = "Enregistrement en cours...";

    try {
        const updateData = {
            name,
            company,
            jobTitle,
            skills,
            profileUpdated: Date.now()
        };
        if (profileImageUrl) updateData.profileImage = profileImageUrl;

        await db.ref(`profiles/${user.uid}`).update(updateData);
        if (name && user.displayName !== name) {
            user.updateProfile({ displayName: name }).catch(() => {});
        }

        if (profileImageUrl && document.getElementById('userAvatar')) {
            const avatarEl = document.getElementById('userAvatar');
            avatarEl.innerHTML = '';
            avatarEl.style.backgroundImage = `url('${cloudinaryResize(profileImageUrl, 100, 100)}')`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
        }

        alert(t('profileSavedSuccess'));
        closeSheet('profileSheet');
        updateAccountUI(user);
    } catch (error) {
        console.error("Erreur d'enregistrement:", error);
        alert(t('genericError'));
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// ==========================================
// PORTFOLIO PHOTOS (réalisations de l'artisan)
// ==========================================

// Affiche la galerie du portfolio dans le profil (appelée à l'ouverture du profil).
function renderPortfolio(profile) {
    const gallery = document.getElementById('portfolioGallery');
    if (!gallery) return;
    const photos = (profile && profile.portfolio) ? Object.entries(profile.portfolio) : [];
    if (photos.length === 0) {
        gallery.innerHTML = `<div style="font-size:12px;color:var(--text-dim,#777);">Aucune photo pour l'instant.</div>`;
        return;
    }
    gallery.innerHTML = photos.map(([key, url]) => `
        <div style="position:relative;width:90px;height:90px;border-radius:10px;overflow:hidden;border:1px solid var(--border,#333);">
            <img src="${url}" style="width:100%;height:100%;object-fit:cover;" loading="lazy">
            <button onclick="deletePortfolioPhoto('${key}')" title="Supprimer"
                style="position:absolute;top:3px;right:3px;width:22px;height:22px;border:none;border-radius:50%;background:rgba(192,57,57,0.9);color:#fff;font-size:12px;cursor:pointer;line-height:1;">✕</button>
        </div>
    `).join('');
}

// Upload d'une photo de réalisation vers Cloudinary puis Firebase (max 6).
async function uploadPortfolioPhoto(event) {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) { showToast(t('mustBeLoggedIn'), 'error'); return; }
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
        showToast(`Photo invalide (JPG/PNG/WEBP, max ${MAX_IMAGE_SIZE_MB} Mo).`, 'error');
        return;
    }

    // Limite à 6 photos
    try {
        const snap = await db.ref('profiles/' + user.uid + '/portfolio').once('value');
        const current = snap.val() || {};
        if (Object.keys(current).length >= 6) {
            showToast('Maximum 6 photos. Supprime-en une d\'abord.', 'error');
            event.target.value = '';
            return;
        }
    } catch (_) {}

    showToast('Téléchargement de la photo...', 'info');
    try {
        const url = await uploadToCloudinary(file);
        await db.ref('profiles/' + user.uid + '/portfolio').push(url);
        const fresh = await db.ref('profiles/' + user.uid).once('value');
        renderPortfolio(fresh.val() || {});
        showToast('Photo ajoutée ! 📸', 'success');
    } catch (e) {
        console.error('Portfolio upload error', e);
        showToast(t('photoUploadError'), 'error');
    } finally {
        event.target.value = '';
    }
}

// Supprime une photo du portfolio.
async function deletePortfolioPhoto(key) {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;
    try {
        await db.ref('profiles/' + user.uid + '/portfolio/' + key).remove();
        const fresh = await db.ref('profiles/' + user.uid).once('value');
        renderPortfolio(fresh.val() || {});
        showToast('Photo supprimée.', 'info');
    } catch (e) {
        console.error('Portfolio delete error', e);
        showToast(t('genericError'), 'error');
    }
}

// ==========================================
// DISPONIBILITÉ EN TEMPS RÉEL
// ==========================================

// Affiche l'état des boutons de disponibilité selon le profil.
function renderAvailability(profile) {
    const map = { now: 'availBtnNow', week: 'availBtnWeek', busy: 'availBtnBusy' };
    const active = (profile && profile.availability) || '';
    Object.entries(map).forEach(([val, id]) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (val === active) {
            // bouton actif = rempli
            const color = val === 'now' ? '#2EA067' : (val === 'week' ? '#E88A2A' : '#C03939');
            btn.style.background = color;
            btn.style.color = '#fff';
        } else {
            btn.style.background = 'none';
            btn.style.color = val === 'now' ? '#2EA067' : (val === 'week' ? '#E88A2A' : '#C03939');
        }
    });
}

// Enregistre la disponibilité choisie.
async function setAvailability(status) {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) { showToast(t('mustBeLoggedIn'), 'error'); return; }
    try {
        await db.ref('profiles/' + user.uid).update({
            availability: status,
            availabilityUpdated: Date.now()
        });
        renderAvailability({ availability: status });
        const labels = { now: 'Disponible 🟢', week: 'Cette semaine 🟠', busy: 'Occupé 🔴' };
        showToast('Statut mis à jour : ' + labels[status], 'success');
    } catch (e) {
        console.error('setAvailability error', e);
        showToast(t('genericError'), 'error');
    }
}

// Renvoie un petit badge HTML de disponibilité pour les cartes (ou '' si aucun/périmé).
function availabilityBadge(profile) {
    if (!profile || !profile.availability) return '';
    // "Disponible aujourd'hui" expire après 24h pour rester fiable
    if (profile.availability === 'now') {
        const updated = profile.availabilityUpdated || 0;
        if (Date.now() - updated > 24 * 60 * 60 * 1000) return '';
        return `<span style="font-size:10px;font-weight:700;color:#2EA067;background:rgba(46,160,103,0.15);padding:2px 6px;border-radius:8px;">🟢 Dispo</span>`;
    }
    if (profile.availability === 'week') {
        return `<span style="font-size:10px;font-weight:700;color:#E88A2A;background:rgba(232,138,42,0.15);padding:2px 6px;border-radius:8px;">🟠 Cette sem.</span>`;
    }
    return '';
}

// ==========================================
// SCORE DE RÉACTIVITÉ / ACTIVITÉ RÉCENTE
// ==========================================
// Basé sur lastActiveAt (déjà suivi par l'app). Un artisan actif récemment
// répond généralement plus vite : c'est un vrai signal de confiance, honnête,
// exactement comme "Actif il y a X" sur les grandes applications.

// Renvoie un badge court pour les cartes (ou '' si trop ancien / inconnu).
function activityBadge(profile) {
    if (!profile || !profile.lastActiveAt) return '';
    const diff = Date.now() - profile.lastActiveAt;
    const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
    if (diff < 15 * min) {
        return `<span title="Actif à l'instant" style="font-size:10px;font-weight:700;color:#2EA067;background:rgba(46,160,103,0.15);padding:2px 6px;border-radius:8px;">⚡ Actif</span>`;
    }
    if (diff < 24 * hour) {
        return `<span title="Actif aujourd'hui" style="font-size:10px;font-weight:700;color:#2D6CDF;background:rgba(45,108,223,0.12);padding:2px 6px;border-radius:8px;">🕐 Aujourd'hui</span>`;
    }
    return '';
}

// Texte détaillé de la dernière activité (pour le profil / la fiche détaillée).
function lastActiveText(profile) {
    if (!profile || !profile.lastActiveAt) return 'Activité inconnue';
    const diff = Date.now() - profile.lastActiveAt;
    const min = 60 * 1000, hour = 60 * min, day = 24 * hour;
    if (diff < 5 * min) return '⚡ Actif à l\'instant';
    if (diff < hour) return '🕐 Actif il y a ' + Math.round(diff / min) + ' min';
    if (diff < day) return '🕐 Actif il y a ' + Math.round(diff / hour) + ' h';
    if (diff < 7 * day) return '📅 Actif il y a ' + Math.round(diff / day) + ' j';
    return '📅 Inactif depuis un moment';
}

// ==========================================
// STATISTIQUES POUR LES ARTISANS PRO
// ==========================================

// Incrémente de façon atomique le compteur de vues d'un profil, par semaine.
// Structure : profiles/{uid}/stats/views/{semaine}  et  .../viewsTotal
function countProfileView(ownerUid) {
    const week = getWeekKey();
    const base = db.ref('profiles/' + ownerUid + '/stats');
    // Compteur de la semaine courante
    base.child('views/' + week).transaction(v => (v || 0) + 1).catch(() => {});
    // Compteur total (à vie)
    base.child('viewsTotal').transaction(v => (v || 0) + 1).catch(() => {});
}

// Renvoie une clé de semaine du type "2026-W33".
function getWeekKey() {
    const d = new Date();
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
    return d.getFullYear() + '-W' + week;
}

// Affiche le tableau de stats dans le profil.
// Les stats détaillées sont réservées aux PRO (levier d'abonnement) ;
// les non-PRO voient un aperçu flouté qui donne envie de passer Pro.
function renderProStats(profile) {
    const box = document.getElementById('proStatsBox');
    if (!box) return;
    const stats = (profile && profile.stats) || {};
    const week = getWeekKey();
    const viewsWeek = (stats.views && stats.views[week]) || 0;
    const viewsTotal = stats.viewsTotal || 0;
    const isPro = profile && profile.isPro && (profile.proUntil || 0) > Date.now();

    if (isPro) {
        box.innerHTML = `
          <div style="font-weight:700;font-size:14px;color:var(--gold,#FFD700);margin-bottom:8px;">📊 Mes statistiques (PRO)</div>
          <div style="display:flex;gap:10px;">
            <div style="flex:1;text-align:center;padding:12px;background:rgba(255,215,0,0.08);border-radius:10px;">
              <div style="font-size:22px;font-weight:800;color:var(--gold,#FFD700);">${viewsWeek}</div>
              <div style="font-size:11px;color:var(--text-dim,#999);">Vues cette semaine</div>
            </div>
            <div style="flex:1;text-align:center;padding:12px;background:rgba(46,160,103,0.08);border-radius:10px;">
              <div style="font-size:22px;font-weight:800;color:#2EA067;">${viewsTotal}</div>
              <div style="font-size:11px;color:var(--text-dim,#999);">Vues au total</div>
            </div>
          </div>`;
    } else {
        box.innerHTML = `
          <div style="font-weight:700;font-size:14px;color:var(--gold,#FFD700);margin-bottom:8px;">📊 Mes statistiques</div>
          <div style="position:relative;padding:14px;background:rgba(255,255,255,0.04);border-radius:10px;text-align:center;">
            <div style="filter:blur(4px);user-select:none;font-size:22px;font-weight:800;color:var(--gold,#FFD700);">•• vues cette semaine</div>
            <div style="font-size:12px;color:var(--text-dim,#999);margin-top:8px;">🔒 Passe au compte <b>PRO</b> pour voir combien de clients regardent ton profil.</div>
          </div>`;
    }
}

// ==========================================
// ADAPTER LES BOUTONS DE PAIEMENT selon le statut
// ==========================================
// Évite qu'une personne DÉJÀ vérifiée (manuellement par l'admin ou par un
// paiement précédent) repaie 500 FCFA pour rien. Idem pour le Pro actif.
function renderPaymentButtons(profile) {
    profile = profile || {};

    // Bouton "Badge vérifié" : si déjà vérifié -> on remplace par un état "déjà vérifié"
    const vBtn = document.getElementById('payVerifiedBtn');
    if (vBtn) {
        if (profile.verified) {
            vBtn.textContent = '✅ Déjà vérifié';
            vBtn.disabled = true;
            vBtn.style.opacity = '0.6';
            vBtn.style.cursor = 'default';
            vBtn.onclick = null;
        } else {
            vBtn.textContent = '✅ Badge Identité vérifiée — 500 FCFA';
            vBtn.disabled = false;
            vBtn.style.opacity = '1';
            vBtn.style.cursor = 'pointer';
            vBtn.onclick = function () { startPayment('verified'); };
        }
    }

    // Bouton "Devenir Pro" : si déjà Pro actif -> montre la date d'expiration
    const pBtn = document.getElementById('payProBtn');
    if (pBtn) {
        if (profile.isPro && (profile.proUntil || 0) > Date.now()) {
            const d = new Date(profile.proUntil);
            const dateStr = d.toLocaleDateString('fr-FR');
            pBtn.textContent = '⭐ PRO actif jusqu\'au ' + dateStr + ' (renouveler)';
            // On garde le bouton cliquable : il peut renouveler / prolonger
            pBtn.onclick = function () { startPayment('pro_month'); };
        } else {
            pBtn.textContent = 'Devenir Pro — 1 500 FCFA / mois';
            pBtn.onclick = function () { startPayment('pro_month'); };
        }
    }
}

// ==========================================
// DEVIS (RETIRE) - remplace par la messagerie in-app
// ==========================================
// Le systeme de devis faisait doublon avec la messagerie : c'est deja la
// personne qui a besoin d'aide qui publie le job, donc le travailleur
// interesse n'a qu'a DISCUTER directement. Ces fonctions redirigent vers la
// conversation, au cas ou un ancien bouton les appellerait encore.
function openQuoteModal() {
    if (typeof openUserChatFromPreview === 'function') openUserChatFromPreview();
}
function closeQuoteModal() {
    const m = document.getElementById('quoteModal'); if (m) m.style.display = 'none';
}
function sendQuoteRequest() {
    if (typeof openUserChatFromPreview === 'function') openUserChatFromPreview();
}

// ==========================================
// ARTISAN DU MOIS
// ==========================================
function renderArtisanOfMonth() {
    const box = document.getElementById('artisanOfMonthBox');
    if (!box) return;
    let best = null;
    for (const uid in profilesCache) {
        const p = profilesCache[uid];
        if (!p || !p.ratingCount || p.ratingCount < 3) continue;
        const score = (p.ratingAvg || 0) * 1000 + p.ratingCount;
        if (!best || score > best.score) best = { uid, p, score };
    }
    if (!best) { box.innerHTML = ''; return; }
    const p = best.p;
    const name = escapeHtml(p.name || 'Artisan');
    const job = escapeHtml(p.jobTitle || '');
    const avatar = p.profileImage
        ? `<img src="${p.profileImage}" style="width:46px;height:46px;border-radius:50%;object-fit:cover;border:2px solid #FFD700;">`
        : `<div style="width:46px;height:46px;border-radius:50%;background:#FFD70022;display:flex;align-items:center;justify-content:center;font-weight:800;color:#FFD700;">${name.charAt(0).toUpperCase()}</div>`;
    box.innerHTML = `
      <div onclick="openPublicProfile('${best.uid}')" style="cursor:pointer;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,rgba(255,215,0,0.14),rgba(255,215,0,0.03));border:1px solid rgba(255,215,0,0.35);">
        ${avatar}
        <div style="flex:1;min-width:0;">
          <div style="font-size:11px;font-weight:800;color:#FFD700;letter-spacing:0.5px;">🏆 ARTISAN DU MOIS</div>
          <div style="font-weight:700;font-size:14px;color:var(--text,#fff);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}${job ? ' · ' + job : ''}</div>
          <div style="font-size:12px;color:#FFD700;font-weight:700;">★ ${(p.ratingAvg||0).toFixed(1)} <span style="color:var(--text-dim,#999);font-weight:400;">(${p.ratingCount} avis)</span></div>
        </div>
        <div style="font-size:11px;color:var(--text-dim,#999);">Voir ›</div>
      </div>`;
}
function openPublicProfile(uid) {
    if (typeof viewUserProfile === 'function') { viewUserProfile(uid); return; }
    showToast('Profil : ' + ((profilesCache[uid]||{}).name || uid), 'info');
}

// ==========================================
// CERTIFICATION / BADGES DE COMPÉTENCE (automatiques)
// ==========================================
function computeAchievementBadges(profile) {
    const badges = [];
    const count = profile.ratingCount || 0;
    const avg = profile.ratingAvg || 0;
    if (profile.verified) badges.push({ icon: '🛡️', label: 'Identité vérifiée', color: '#2D6CDF' });
    if (profile.isPro && (profile.proUntil || 0) > Date.now()) badges.push({ icon: '⭐', label: 'Membre PRO', color: '#FFD700' });
    if (count >= 1)  badges.push({ icon: '🤝', label: 'Premier client', color: '#2EA067' });
    if (count >= 10) badges.push({ icon: '🔥', label: '10+ clients servis', color: '#E88A2A' });
    if (count >= 50) badges.push({ icon: '🏅', label: '50+ clients servis', color: '#C03939' });
    if (count >= 5 && avg >= 4.5) badges.push({ icon: '👑', label: 'Excellence (4.5★+)', color: '#FFD700' });
    if (profile.portfolio && Object.keys(profile.portfolio).length >= 3) badges.push({ icon: '📸', label: 'Portfolio complet', color: '#7A4EC2' });
    return badges;
}
function renderAchievements(profile) {
    const box = document.getElementById('achievementsBox');
    if (!box) return;
    const badges = computeAchievementBadges(profile || {});
    if (badges.length === 0) {
        box.innerHTML = `<div style="font-weight:700;font-size:14px;color:var(--gold,#FFD700);margin-bottom:6px;">🎓 Mes badges</div>
          <div style="font-size:12px;color:var(--text-dim,#999);">Sers des clients et complète ton profil pour débloquer des badges de confiance.</div>`;
        return;
    }
    box.innerHTML = `<div style="font-weight:700;font-size:14px;color:var(--gold,#FFD700);margin-bottom:8px;">🎓 Mes badges (${badges.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${badges.map(b => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:${b.color};background:${b.color}1A;border:1px solid ${b.color}55;padding:5px 10px;border-radius:20px;">${b.icon} ${b.label}</span>`).join('')}
      </div>`;
}

// ==========================================
// ============================================================
// MESSAGERIE IN-APP — « CHAT SÉCURISÉ » (widget style WhatsApp)
// ============================================================
// L'interface est le widget « chat-widget.js » (objet global W), branché
// ici sur Firebase :
//   - Liste des conversations : userInboxes/{moi}/threads (temps réel)
//   - Messages : chats/{threadId}/messages (temps réel, 200 derniers)
//   - UNE conversation unique par personne : threadId = uidA_uidB triés,
//     quel que soit le job (le job est mémorisé dans chats/.../meta et
//     affiché en bannière) — recontacter la même personne CONTINUE la
//     discussion au lieu de tout recommencer.
//   - Envoi : participants → message → méta → boîtes de réception →
//     non-lus (+ index userThreads, filet de sécurité)
// Chaque écriture cible la référence du thread (jamais la racine) :
// c'est ce que les règles Firebase autorisent.

let chatThread = null;         // thread actuellement ouvert
let chatMsgsRef = null, chatTypingPeerRef = null, chatPresenceRef = null;
let inboxRef = null;           // écoute de ma boîte de réception (badge + liste)
let chatOverlayOpen = false, chatWidgetReady = false;
let lastInboxSnapshot = [];    // dernier snapshot de mes threads
let pendingChatSend = null;    // envoi optimiste en attente de confirmation
let pendingJobBar = null;      // job à afficher en bannière à l'ouverture
let chatTypingTimeout = null, lastChatTypingSent = 0;
let presenceCache = null, presenceCacheTs = 0;

// threadId = les deux uid triés (une conversation par personne, comme
// WhatsApp — le job ne change plus la conversation)
function makeThreadId(uidA, uidB) {
    return [uidA, uidB].sort().join('_');
}
function initials(name) {
    if (!name) return '?';
    const p = String(name).trim().split(/\s+/);
    return ((p[0] || '')[0] || '?').toUpperCase() + (p[1] ? (p[1][0] || '').toUpperCase() : '');
}
function formatChatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}
// Format WhatsApp pour la liste : HH:MM (aujourd'hui), « Hier », jour de la
// semaine (moins de 7 jours), sinon la date complète.
function formatInboxTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), now = new Date();
    if (d.toDateString() === now.toDateString()) return formatChatTime(ts);
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Hier';
    if ((now - d) / 86400000 < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
    return d.toLocaleDateString('fr-FR');
}
function formatDaySep(ts) {
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    if (sameDay) return "Aujourd'hui";
    if (d.toDateString() === yest.toDateString()) return 'Hier';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// L'autre participant d'un thread : son uid figure dans le threadId
function peerUidOf(threadId) {
    const me = auth.currentUser;
    if (!me || !threadId) return null;
    const pair = String(threadId).split('__')[0];
    return pair.split('_').find(u => u && u !== me.uid) || null;
}
// Nom « live » depuis le cache des profils (sinon '' = on retombe sur le stocké)
function livePeerName(peerUid) {
    return (peerUid && profilesCache[peerUid] && profilesCache[peerUid].name) || '';
}
// Avatar : vraie photo de profil (redimensionnée Cloudinary) ou initiales
function avatarSrcFor(name, imgUrl) {
    if (imgUrl && typeof cloudinaryResize === 'function') return cloudinaryResize(imgUrl, 96, 96);
    const init = initials(name || '?');
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><rect width='96' height='96' fill='#2D6CDF'/><text x='48' y='58' font-size='38' font-family='Arial,sans-serif' fill='#fff' text-anchor='middle'>" + init + "</text></svg>";
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
// data URL (fichier lu par le widget) -> File (pour l'upload Cloudinary)
function dataURLtoFile(dataUrl, filename) {
    const parts = dataUrl.split(',');
    const mime = (parts[0].match(/:(.*?);/) || [null, 'image/jpeg'])[1];
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], filename || 'photo.jpg', { type: mime });
}

// ============================================================
// OUVERTURE / FERMETURE DE L'ÉCRAN « MESSAGES »
// ============================================================
function openMessagesInbox() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) { showToast('Connecte-toi pour voir tes messages.', 'error'); return; }
    const ov = document.getElementById('chatWidgetOverlay');
    if (ov) {
        ov.style.display = 'flex';
        // mon avatar dans l'en-tête de la sidebar
        const myAv = document.getElementById('waMyAv');
        if (myAv) myAv.src = avatarSrcFor(livePeerName(user.uid) || user.displayName || 'Moi', (profilesCache[user.uid] || {}).profileImage);
    }
    chatOverlayOpen = true;
    if (!chatWidgetReady && window.W) {
        chatWidgetReady = true;
        W.init({ theme: (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark') });
        patchChatWidgetForFirebase();
        W.on('chatOpened', (cid) => onChatWidgetOpened(cid));
        W.on('typing', onChatWidgetTyping);
    }
    if (window.W) W.setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    // filets : reconstruit les entrées manquantes, puis affiche la liste
    if (lastInboxSnapshot.length) {
        repairInboxFromThreadsIndex(user.uid).then(() => syncChatWidgetConvs()).catch(() => syncChatWidgetConvs());
    } else {
        db.ref('userInboxes/' + user.uid + '/threads').once('value').then(s => {
            lastInboxSnapshot = Object.entries(s.val() || {});
            return repairInboxFromThreadsIndex(user.uid);
        }).then(() => syncChatWidgetConvs()).catch(() => syncChatWidgetConvs());
    }
}

function closeMessagesInbox() {
    const ov = document.getElementById('chatWidgetOverlay');
    if (ov) ov.style.display = 'none';
    chatOverlayOpen = false;
    detachChatListeners();
    if (window.W && W.goBack) W.goBack();
}
function closeUserChat() {
    // compatibilité : « fermer la conversation » = retour à la liste
    if (window.W && W.goBack) W.goBack();
}

// ============================================================
// LISTE DES CONVERSATIONS (contacts du widget, depuis userInboxes)
// ============================================================
function syncChatWidgetConvs() {
    if (!window.W) return;
    const me = auth.currentUser;
    if (!me) return;
    // Présence (en ligne / vu à…) : 1 lecture, cache 30 s
    const useCache = presenceCache && (Date.now() - presenceCacheTs < 30000);
    const doRender = (pres) => {
        if (!chatOverlayOpen) return;
        // Aperçus des conversations NON ouvertes (la conv ouverte est gérée
        // par son propre listener temps réel)
        lastInboxSnapshot.forEach(([tid, e]) => {
            if (W.activeId === tid) return;
            if (!e) { if (W.convs[tid]) delete W.convs[tid]; return; }
            const fromMe = e.lastFrom === me.uid;
            W.convs[tid] = [{
                id: 'last_' + tid,
                from: fromMe ? 'me' : 'them',
                text: e.lastMessage || '',
                _ts: e.lastAt || 0,
                time: e.lastAt ? formatInboxTime(e.lastAt) : '',
                date: e.lastAt ? formatDaySep(e.lastAt) : 'Aujourd\'hui',
                unread: !fromMe && (e.unread || 0) > 0,
                status: fromMe ? 'sent' : undefined
            }];
        });
        W.setContacts(lastInboxSnapshot.map(([tid, e]) => {
            e = e || {};
            const peerUid = peerUidOf(tid) || e.peerUid;
            const p = pres[peerUid] || {};
            const prof = profilesCache[peerUid] || {};
            const name = livePeerName(peerUid) || e.peerName || 'Utilisateur';
            return {
                id: tid,
                name: name,
                avatar: avatarSrcFor(name, prof.profileImage),
                online: p.state === 'active',
                lastSeen: p.lastChanged ? 'il y a ' + timeAgo(p.lastChanged) : '',
                about: e.jobTitle || prof.jobTitle || ''
            };
        }).filter(c => c.id));
    };
    if (useCache) doRender(presenceCache);
    else db.ref('presence').once('value').then(s => {
        presenceCache = s.val() || {};
        presenceCacheTs = Date.now();
        doRender(presenceCache);
    }).catch(() => doRender({}));
}

// ============================================================
// OUVERTURE D'UNE CONVERSATION (branchement temps réel Firebase)
// ============================================================
function onChatWidgetOpened(cid) {
    const user = auth.currentUser;
    if (!user) return;
    // Conversation au format ancien (« uidA_uidB__job ») : on la consolide
    // dans la conversation unique du duo (« uidA_uidB ») — les anciens
    // messages sont migrés par healLegacyThreadsForPair (idempotent).
    if (String(cid).indexOf('__') !== -1) {
        const pairId = String(cid).split('__')[0];
        const pUid = peerUidOf(pairId);
        if (window.W) {
            // le contact au format nouveau doit exister dans le widget pour
            // que openChat fonctionne
            if (pUid && !W.contacts.some(c => c.id === pairId)) {
                const nm = livePeerName(pUid) || 'Utilisateur';
                W.contacts.push({ id: pairId, name: nm, avatar: avatarSrcFor(nm, (profilesCache[pUid] || {}).profileImage), online: false, lastSeen: '', about: '' });
            }
            W.openChat(pairId);
        }
        return;
    }
    const peerUid = peerUidOf(cid);
    // Bannière « job » : job demandé à l'ouverture, sinon celle du thread
    if (pendingJobBar) {
        setJobBar(pendingJobBar.jobId, pendingJobBar.jobTitle);
        pendingJobBar = null;
    } else {
        db.ref('chats/' + cid + '/meta').once('value').then(s => {
            const m = s.val() || {};
            if (chatThread === cid) setJobBar(m.jobId || null, m.jobTitle || null);
        }).catch(() => {});
    }
    attachChatListeners(cid, peerUid);
    // marque lu + réparation (entrée d'inbox, anciens threads) — dans l'ordre
    markChatRead(cid);
    healLegacyThreadsForPair(user, cid).then(() => repairInboxEntryForCurrentChat(cid)).catch(() => {});
    if (typeof updateQuickReplies === 'function') updateQuickReplies();
}

function attachChatListeners(cid, peerUid) {
    detachChatListeners();
    const me = auth.currentUser;
    if (!me) return;
    chatThread = cid;
    // Messages (lecture complète du dernier segment : gère ajouts,
    // suppressions, réactions, accusés — le widget re-rend)
    chatMsgsRef = db.ref('chats/' + cid + '/messages').limitToLast(200);
    chatMsgsRef.on('value', (snap) => {
        if (!chatOverlayOpen || !window.W || W.activeId !== cid) return;
        const msgs = [];
        snap.forEach(ch => {
            const m = ch.val();
            if (!m || m.deleted) return;
            if (m.deletedFor && m.deletedFor[me.uid]) return;
            msgs.push(mapWidgetMsg(ch.key, m, cid));
        });
        // Envoi optimiste pas encore confirmé par Firebase : on garde la
        // bulle locale tant que le vrai message n'est pas arrivé
        if (pendingChatSend && pendingChatSend.cid === cid) {
            const window = pendingChatSend.dataImage ? 60000 : 6000;
            const matched = msgs.some(m => m.from === 'me' && Math.abs((m._ts || 0) - pendingChatSend.ts) < window &&
                ((pendingChatSend.text && m.text === pendingChatSend.text) || (pendingChatSend.dataImage && m.image)));
            if (matched) pendingChatSend = null;
            else msgs.push(pendingChatSend.tempMsg);
        }
        W.setMessages(cid, msgs);
    });
    if (peerUid) {
        // « en train d'écrire… » de l'autre
        chatTypingPeerRef = db.ref('chats/' + cid + '/meta/typing/' + peerUid);
        chatTypingPeerRef.on('value', (snap) => {
            if (!window.W || W.activeId !== cid) return;
            const ts = snap.val();
            if (ts && (Date.now() - ts) < 4000) W.showTyping(cid);
            else W.hideTyping(cid);
        });
        // Présence : « en ligne » / « vu il y a … »
        chatPresenceRef = db.ref('presence/' + peerUid);
        chatPresenceRef.on('value', (snap) => {
            if (!window.W) return;
            const p = snap.val();
            const c = W.contacts.find(c => c.id === cid);
            if (c) {
                c.online = !!(p && p.state === 'active');
                c.lastSeen = p && p.lastChanged ? 'il y a ' + timeAgo(p.lastChanged) : '';
                if (W.activeId === cid && W._updHead) W._updHead(c);
            }
        });
    }
}

function detachChatListeners() {
    if (chatMsgsRef) { chatMsgsRef.off(); chatMsgsRef = null; }
    if (chatTypingPeerRef) { chatTypingPeerRef.off(); chatTypingPeerRef = null; }
    if (chatPresenceRef) { chatPresenceRef.off(); chatPresenceRef = null; }
    chatThread = null;
}

// Message Firebase -> objet message du widget
function mapWidgetMsg(key, m, cid) {
    const me = auth.currentUser;
    const mine = m.from === me.uid;
    const peerUid = peerUidOf(cid);
    const read = m.readBy && peerUid && m.readBy[peerUid];
    const out = {
        id: key,
        fbId: key,
        from: mine ? 'me' : (m.from || 'them'),
        _ts: m.timestamp || 0,
        time: m.timestamp ? formatChatTime(m.timestamp) : '',
        date: m.timestamp ? formatDaySep(m.timestamp) : 'Aujourd\'hui'
    };
    if (m.text) out.text = m.text;
    if (m.imageUrl) out.image = m.imageUrl;
    if (mine) out.status = read ? 'read' : 'sent';
    if (!mine && !(m.readBy && m.readBy[me.uid])) out.unread = true;
    if (m.replyTo && m.replyTo.id) out.replyTo = m.replyTo.id;
    if (m.reactions && m.reactions.length) out.reactions = m.reactions;
    if (m.edited) out.edited = true;
    return out;
}

// Bannière « job » au-dessus des messages (cliquable -> ouvre l'annonce)
function setJobBar(jobId, jobTitle) {
    const bar = document.getElementById('waJobBar');
    if (!bar) return;
    if (jobId && jobId !== 'general') {
        bar.textContent = '📋 ' + (jobTitle || 'Voir l\'annonce concernée');
        bar.dataset.jobId = jobId;
        bar.style.display = 'block';
    } else {
        bar.style.display = 'none';
        bar.dataset.jobId = '';
    }
    if (typeof updateQuickReplies === 'function') updateQuickReplies();
}
function openJobFromChat() {
    const bar = document.getElementById('waJobBar');
    const jid = bar && bar.dataset.jobId;
    if (!jid || jid === 'general') return;
    if (typeof jobsById !== 'undefined' && jobsById[jid]) openJobPreview(jid);
    else if (typeof openJobPreview === 'function') openJobPreview(jid);
}

// ============================================================
// RÉPONSES RAPIDES (chips contextuelles au-dessus de la saisie)
// — Réponses types d'une coordination de travail, en 1 tap.
// Affichées quand une conversation est ouverte ; le jeu de chips
// change selon qu'un job est affiché en bannière (coordination)
// ou non (réponses générales). Un tap insère le texte dans la
// saisie (style WhatsApp : on peut encore éditer avant d'envoyer).
// ============================================================
const QUICK_REPLIES = {
    job: ['Je suis disponible', "C'est combien ?", 'Quand tu commences ?', 'Je suis en route', "D'accord, on part", 'Merci beaucoup'],
    general: ['Bonjour', 'Je suis disponible', "D'accord", 'Merci beaucoup', "Je t'appelle"]
};
let quickRepliesContext = '';
function renderQuickReplies(context) {
    const row = document.getElementById('waQuickRow');
    if (!row) return;
    quickRepliesContext = context;
    const list = QUICK_REPLIES[context] || QUICK_REPLIES.general;
    row.innerHTML = '';
    list.forEach(text => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'wa-quick-chip';
        chip.textContent = text;
        chip.addEventListener('click', () => {
            const txt = document.getElementById('waTxt');
            if (!txt) return;
            const cur = txt.value;
            txt.value = (cur && !/[\s,]$/.test(cur) ? cur + ' ' : cur) + text;
            if (window.W && W.autoResize) W.autoResize(txt);
            txt.focus();
        });
        row.appendChild(chip);
    });
}
function updateQuickReplies() {
    const bar = document.getElementById('waQuickReplies');
    if (!bar || !window.W) return;
    const inputArea = document.getElementById('waInputArea');
    const open = !!W.activeId && !!inputArea && inputArea.style.display !== 'none';
    if (!open) { bar.classList.remove('active'); quickRepliesContext = ''; return; }
    const jobBar = document.getElementById('waJobBar');
    const hasJob = !!(jobBar && jobBar.style.display === 'block' && jobBar.dataset.jobId && jobBar.dataset.jobId !== 'general');
    const ctx = hasJob ? 'job' : 'general';
    if (ctx !== quickRepliesContext) renderQuickReplies(ctx);
    bar.classList.add('active');
}

// ============================================================
// POINTS D'ENTRÉE (bouton job, notification, liste)
// ============================================================
function openUserChatFromPreview() {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) { showToast('Connecte-toi pour discuter.', 'error'); return; }
    const job = window.currentPreviewJob;
    if (!job || !job.user) return;
    if (job.user === user.uid) { showToast('C\'est ta propre annonce.', 'info'); return; }
    const name = (profilesCache[job.user] || {}).name || 'Utilisateur';
    openUserChat(job.user, job.id, name, job.title);
}

// Point d'entrée unique : ouvre/CONTINUE la conversation avec peerUid
// (thread unique par personne — le job fourni sert à la bannière/contexte)
function openUserChat(peerUid, jobId, peerName, jobTitle) {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) { showToast('Connecte-toi pour discuter.', 'error'); return; }
    const tid = makeThreadId(user.uid, peerUid);
    pendingJobBar = { jobId: jobId || null, jobTitle: jobTitle || null };
    // mémorise le job en contexte du thread (bannière pour la prochaine fois)
    if (jobId && jobId !== 'general') {
        const upd = { jobId: jobId };
        if (jobTitle) upd.jobTitle = String(jobTitle).slice(0, 120);
        db.ref('chats/' + tid + '/meta').update(upd).catch(() => {});
    }
    // assure que la conv figure dans ma boîte (même sans entrée encore)
    if (!lastInboxSnapshot.some(([t]) => t === tid)) {
        lastInboxSnapshot.push([tid, { peerUid: peerUid, peerName: peerName || 'Utilisateur', jobTitle: jobTitle || null }]);
    }
    openMessagesInbox();
    if (window.W) {
        const existing = W.contacts.find(c => c.id === tid);
        if (!existing) {
            const name = peerName || livePeerName(peerUid) || 'Utilisateur';
            W.contacts.push({ id: tid, name: name, avatar: avatarSrcFor(name, (profilesCache[peerUid] || {}).profileImage), online: false, lastSeen: '', about: jobTitle || '' });
            W.renderChats();
        }
        W.openChat(tid);
    }
}

// ============================================================
// ENVOI (widget -> Firebase) : optimiste + 6 écritures ciblées
// ============================================================
function patchChatWidgetForFirebase() {
    if (!window.W || W.__patched) return;
    W.__patched = true;
    const origDeleteMessage = W.deleteMessage;
    W.__origDelete = origDeleteMessage;

    // ---- ENVOI : le widget appelle W.sendMessage(cid, data) ; on le branche
    // sur Firebase. La bulle apparaît immédiatement (optimiste) puis le vrai
    // message Firebase la remplace (listener temps réel). ----
    W.sendMessage = function(cid, data) {
        const me = auth.currentUser;
        if (!me || !cid) return null;
        data = data || {};
        const tempMsg = {
            id: 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            from: 'me',
            _ts: Date.now(),
            time: formatChatTime(Date.now()),
            date: 'Aujourd\'hui',
            status: 'sent'
        };
        if (data.text) tempMsg.text = data.text;
        if (data.image) tempMsg.image = data.image;
        if (data.replyTo) {
            const rm = (W.convs[cid] || []).find(x => x.id === data.replyTo);
            if (rm) {
                tempMsg.replyTo = rm.fbId || rm.id;
                tempMsg.__reply = {
                    id: rm.fbId || rm.id,
                    text: (rm.text || (rm.image ? '📷 Photo' : '')).slice(0, 300),
                    fromName: rm.from === 'me' ? 'Toi' : ((W.contacts.find(c => c.id === cid) || {}).name || 'Utilisateur')
                };
            }
        }
        W.addMessage(cid, tempMsg);
        const isDataImage = !!(data.image && String(data.image).startsWith('data:'));
        pendingChatSend = { cid: cid, ts: Date.now(), text: data.text || '', dataImage: isDataImage, tempMsg: tempMsg };
        const clearPending = () => { if (pendingChatSend && pendingChatSend.tempMsg === tempMsg) pendingChatSend = null; };
        setTimeout(clearPending, isDataImage ? 65000 : 10000);
        if (isDataImage) {
            sendChatPhotoToThread(cid, tempMsg, data.image, tempMsg.__reply || undefined, clearPending);
        } else {
            const payload = {};
            if (data.text) payload.text = String(data.text).slice(0, 800);
            if (data.image && !String(data.image).startsWith('data:')) payload.imageUrl = data.image; // transfert d'une image déjà hébergée
            if (tempMsg.__reply) payload.replyTo = tempMsg.__reply;
            sendChatMessageToThread(cid, payload, clearPending);
        }
        return tempMsg;
    };

    // ---- MODIFIER un message : aussi dans Firebase (champ text) ----
    const origEditMessage = W.editMessage;
    W.editMessage = function(cid, mid, newText) {
        origEditMessage.call(this, cid, mid, newText);
        const m = (this.convs[cid] || []).find(x => x.id === mid);
        const fid = m && m.fbId;
        if (fid) {
            db.ref('chats/' + cid + '/messages/' + fid + '/text').set(String(newText || '').slice(0, 800))
                .then(() => { if (m) m.edited = true; })
                .catch(() => {});
        }
    };

    // ---- SUPPRIMER : « pour moi » (deletedFor) ou « pour tout le monde »
    // (deleted, auteur seulement, 15 minutes — la règle Firebase l'applique) ----
    W.deleteMessage = function(cid, mid) {
        const me = auth.currentUser;
        const m = (this.convs[cid] || []).find(x => x.id === mid);
        const fid = m && m.fbId;
        let forEveryone = false;
        if (m && fid && m.from === 'me' && (Date.now() - (m._ts || 0)) < 15 * 60 * 1000) {
            forEveryone = confirm('Supprimer ce message pour TOUT LE MONDE ?\n\nOK     = pour tout le monde\nAnnuler = seulement pour moi');
        }
        origDeleteMessage.call(this, cid, mid);
        if (!me || !fid) return; // message optimiste jamais envoyé : rien à écrire
        const ref = db.ref('chats/' + cid + '/messages/' + fid);
        if (forEveryone && m && m.from === 'me') ref.child('deleted').set(true).catch(() => {});
        else ref.child('deletedFor/' + me.uid).set(true).catch(() => {});
    };

    // ---- Lightbox : bouton « Enregistrer » la photo ----
    const origOpenLB = W.openLB;
    W.openLB = function(src) {
        origOpenLB.call(this, src);
        const lb = document.getElementById('waLB');
        let b = document.getElementById('waLBSave');
        if (lb && !b) {
            b = document.createElement('button');
            b.id = 'waLBSave';
            b.textContent = '💾 Enregistrer';
            b.style.cssText = 'position:absolute;bottom:18px;right:18px;background:rgba(255,255,255,.18);color:#fff;border:none;border-radius:24px;padding:10px 18px;font-size:14px;cursor:pointer;';
            lb.appendChild(b);
        }
        if (b) b.onclick = (e) => { e.stopPropagation(); downloadChatImage(src); };
    };

    // ---- Photos : images uniquement, contrôle de taille ----
    W.onFile = function(inp) {
        const f = inp.files && inp.files[0];
        inp.value = '';
        if (!f || !this.activeId) return;
        if (!f.type || !f.type.startsWith('image/')) { if (typeof showToast === 'function') showToast('Images uniquement (JPG, PNG, WEBP, GIF).', 'error'); return; }
        if (f.size > 8 * 1024 * 1024) { if (typeof showToast === 'function') showToast('Photo trop lourde (max 8 Mo).', 'error'); return; }
        const r = new FileReader();
        r.onload = (e) => this.sendMessage(this.activeId, { image: e.target.result });
        r.readAsDataURL(f);
    };

    // ---- Transfert d'un message vers une autre conversation ----
    W._doFwd = function(cid) {
        const src = this._fwdMsg;
        const toCid = cid;
        this.closeFwd();
        if (!src || !toCid || toCid === this.activeId) return;
        const data = {};
        if (src.text) data.text = src.text;
        if (src.image) data.image = src.image;
        this.sendMessage(toCid, data);
    };

    // ---- Bouton envoyer : texte uniquement (pas d'enregistrement vocal) ----
    W.onSendBtn = function() {
        const t = document.getElementById('waTxt');
        if (t && t.value.trim()) this._send();
    };

    // ---- Thème : le widget pose data-theme sur #wa, nos CSS le lisent sur
    // l'overlay parent -> on le met des deux côtés (clair/suivi de l'app) ----
    const origSetTheme = W.setTheme;
    W.setTheme = function(t) {
        const ov = document.getElementById('chatWidgetOverlay');
        if (ov) ov.setAttribute('data-theme', t);
        origSetTheme.call(this, t);
    };

    // ---- Réponses rapides : masquées quand on ferme la conversation ----
    const origGoBack = W.goBack;
    W.goBack = function() {
        if (typeof updateQuickReplies === 'function') updateQuickReplies();
        return origGoBack.apply(this, arguments);
    };
}

// Écriture Firebase de l'envoi : 6 étapes ciblées (aucune à la racine)
async function sendChatMessageToThread(threadId, payload, onDone) {
    const me = auth.currentUser;
    if (!me) return;
    const peerUid = peerUidOf(threadId);
    if (!peerUid) return;
    try {
        const msgId = db.ref('chats/' + threadId + '/messages').push().key;
        const now = Date.now();
        const myName = String((profilesCache[me.uid] || {}).name || me.displayName || 'Utilisateur').slice(0, 60);
        const peerName = String((profilesCache[peerUid] || {}).name || 'Utilisateur').slice(0, 60);
        const preview = payload.imageUrl ? '📷 Photo' : (payload.text || '').slice(0, 100);
        const msg = { from: me.uid, to: peerUid, timestamp: now, readBy: { [me.uid]: true } };
        if (payload.text) msg.text = payload.text;
        if (payload.imageUrl) msg.imageUrl = payload.imageUrl;
        if (payload.replyTo) msg.replyTo = payload.replyTo;

        // 0) index userThreads (filet de sécurité des conversations)
        db.ref('userThreads/' + me.uid + '/' + threadId).set(true).catch(() => {});
        db.ref('userThreads/' + peerUid + '/' + threadId).set(true).catch(() => {});
        // 1) participants (nécessaire pour les écritures d'inbox)
        await db.ref('chats/' + threadId + '/meta/participants').update({ [me.uid]: true, [peerUid]: true });
        // 2) le message
        await db.ref('chats/' + threadId + '/messages/' + msgId).set(msg);
        // 3) le méta (fusion : participants/typing/job préservés)
        const metaUpd = {
            names: { [me.uid]: myName, [peerUid]: peerName },
            lastMessage: preview,
            lastAt: now,
            lastFrom: me.uid
        };
        await db.ref('chats/' + threadId + '/meta').update(metaUpd);
        // 4) boîte de réception du DESTINATAIRE (aperçu de la conversation)
        await writeWithRetry(() => db.ref('userInboxes/' + peerUid + '/threads/' + threadId).update({
            peerUid: me.uid, peerName: myName,
            lastMessage: preview, lastAt: now, lastFrom: me.uid
        }));
        // 5) MA boîte de réception
        await db.ref('userInboxes/' + me.uid + '/threads/' + threadId).update({
            peerUid: peerUid, peerName: peerName,
            lastMessage: preview, lastAt: now, lastFrom: me.uid
        });
        // 6) non-lus du DESTINATAIRE +1
        await db.ref('userInboxes/' + peerUid + '/threads/' + threadId + '/unread').transaction(c => (c || 0) + 1);

        // nettoyage du « en train d'écrire » + notification instantanée
        db.ref('chats/' + threadId + '/meta/typing/' + me.uid).remove().catch(() => {});
        if (typeof triggerInstantNotify === 'function') triggerInstantNotify('new-message');
        if (onDone) onDone();
    } catch (e) {
        console.error('sendChatMessageToThread error', e);
        // l'envoi a échoué : on retire la bulle optimiste
        if (window.W && pendingChatSend) {
            try { W.__origDelete ? W.__origDelete.call(W, threadId, pendingChatSend.tempMsg.id) : W.deleteMessage(threadId, pendingChatSend.tempMsg.id); } catch (e2) {}
        }
        if (onDone) onDone();
        showToast('Erreur envoi : ' + ((e && e.message) || 'réseau instable'), 'error');
    }
}

// Envoi d'une photo venue du widget (data URL) : compression éventuelle,
// upload Cloudinary, puis écriture Firebase avec l'URL finale.
async function sendChatPhotoToThread(threadId, tempMsg, dataUrl, replyTo, onDone) {
    try {
        const file = dataURLtoFile(dataUrl);
        let uploadFile = file;
        if (window.CompressorJS && file.size > 1024 * 1024) {
            try {
                uploadFile = await new Promise((res, rej) => {
                    new window.CompressorJS(file, { quality: 0.8, success: res, error: rej });
                });
            } catch (e) { uploadFile = file; }
        }
        const url = await uploadToCloudinary(uploadFile);
        // la bulle optimiste (data:URL locale) passe à l'URL Cloudinary
        if (window.W) {
            const conv = W.convs[threadId] || [];
            const m = conv.find(x => x.id === tempMsg.id);
            if (m) { m.image = url; if (W.activeId === threadId && W.renderMsgs) W.renderMsgs(); }
        }
        await sendChatMessageToThread(threadId, { imageUrl: url, replyTo: replyTo || undefined }, onDone);
    } catch (e) {
        console.error('sendChatPhotoToThread error', e);
        if (window.W && pendingChatSend) {
            try { W.__origDelete ? W.__origDelete.call(W, threadId, pendingChatSend.tempMsg.id) : W.deleteMessage(threadId, pendingChatSend.tempMsg.id); } catch (e2) {}
        }
        if (onDone) onDone();
        showToast('Erreur envoi de la photo : ' + ((e && e.message) || 'réseau instable'), 'error');
    }
}

// Petit retry (1 fois, après 400 ms) pour les écritures d'inbox
async function writeWithRetry(fn, retries) {
    retries = retries === undefined ? 1 : retries;
    try {
        await fn();
    } catch (e) {
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 400));
            return writeWithRetry(fn, retries - 1);
        }
        throw e;
    }
}

// « En train d'écrire… » : le widget émet l'événement « typing » à la frappe
function onChatWidgetTyping() {
    const user = auth.currentUser;
    const cid = window.W && W.activeId;
    if (!user || !cid) return;
    const now = Date.now();
    if (now - lastChatTypingSent > 2000) {
        lastChatTypingSent = now;
        db.ref('chats/' + cid + '/meta/typing/' + user.uid).set(now).catch(() => {});
    }
    clearTimeout(chatTypingTimeout);
    chatTypingTimeout = setTimeout(() => {
        db.ref('chats/' + cid + '/meta/typing/' + user.uid).remove().catch(() => {});
    }, 3000);
}

// ============================================================
// MARQUER COMME LU (badge + accusés ✓✓)
// ============================================================
async function markChatRead(threadId) {
    const user = auth.currentUser;
    if (!user || !threadId) return;
    try {
        // mon compteur de non-lus -> 0
        await db.ref('userInboxes/' + user.uid + '/threads/' + threadId + '/unread').set(0);
        // messages reçus non lus -> readBy (déclenche le ✓✓ chez l'autre)
        const snap = await db.ref('chats/' + threadId + '/messages').limitToLast(50).once('value');
        const updates = {};
        snap.forEach(ch => {
            const m = ch.val();
            if (m && m.from !== user.uid && !(m.readBy && m.readBy[user.uid])) {
                updates[ch.key] = { readBy: { [user.uid]: true } };
            }
        });
        if (Object.keys(updates).length) await db.ref('chats/' + threadId + '/messages').update(updates);
    } catch (e) { /* non critique */ }
}

// ============================================================
// ÉCOUTE DE MA BOÎTE DE RÉCEPTION (badge topbar + liste du widget)
// ============================================================
function startInboxBadgeWatch(uid) {
    stopInboxBadgeWatch();
    // Écoute UNIQUEMENT ma propre boîte de réception (quelques Ko) —
    // jamais tout /chats (refusé par les règles + très lourd).
    inboxRef = db.ref('userInboxes/' + uid + '/threads');
    inboxRef.on('value', (snap) => {
        const data = snap.val() || {};
        const entries = Object.entries(data);
        lastInboxSnapshot = entries;
        // Badge topbar : somme des non-lus
        let total = 0;
        entries.forEach(([k, e]) => total += (e && e.unread) || 0);
        const badge = document.getElementById('messagesBadge');
        if (badge) {
            if (total > 0) { badge.textContent = total > 99 ? '99+' : total; badge.style.display = 'flex'; }
            else badge.style.display = 'none';
        }
        // Si l'écran Messages est ouvert, la liste suit en direct
        if (chatOverlayOpen) syncChatWidgetConvs();
    });
}
function stopInboxBadgeWatch() {
    if (inboxRef) { inboxRef.off(); inboxRef = null; }
    const badge = document.getElementById('messagesBadge');
    if (badge) badge.style.display = 'none';
}

// ============================================================
// FILETS DE SÉCURITÉ (réparations automatiques)
// ============================================================
// Répare l'entrée d'inbox de LA conversation ouverte si elle manque
// (ex. : message envoyé par une ancienne version qui ne l'écrivait pas)
async function repairInboxEntryForCurrentChat(threadId) {
    const user = auth.currentUser;
    if (!user || !threadId) return;
    try {
        const mine = await db.ref('userInboxes/' + user.uid + '/threads/' + threadId).once('value');
        if (mine.exists()) return;
        const metaSnap = await db.ref('chats/' + threadId + '/meta').once('value');
        const mv = metaSnap.val() || {};
        const peerUid = peerUidOf(threadId);
        if (!peerUid) return;
        await db.ref('userInboxes/' + user.uid + '/threads/' + threadId).update({
            peerUid: peerUid,
            peerName: (mv.names && mv.names[peerUid]) || livePeerName(peerUid) || 'Utilisateur',
            lastMessage: mv.lastMessage || '',
            lastAt: mv.lastAt || Date.now(),
            lastFrom: mv.lastFrom || null
        });
    } catch (e) { /* non critique : la réparation serveur rattrapera */ }
}

// Filet client : avant le passage à « une conversation par personne », les
// threads contenaient le job (« uidA_uidB__job »). Si des messages de ce duo
// sont encore dans un ancien thread et que la migration serveur n'a pas
// encore tourné, on copie ici les messages manquants dans le thread du duo,
// à l'ouverture de la conversation. Idempotent (même clé = même message).
async function healLegacyThreadsForPair(user, pairId) {
    try {
        // Threads au format ancien (« pairId__job ») : ceux listés dans
        // l'index userThreads ET ceux encore visibles dans ma boîte de
        // réception (anciennes conversations, avant l'index).
        const idx = await db.ref('userThreads/' + user.uid).once('value');
        const idxKeys = Object.keys(idx.val() || {});
        let inboxKeys = lastInboxSnapshot.map(([t]) => t);
        if (!inboxKeys.length) {
            const inSnap = await db.ref('userInboxes/' + user.uid + '/threads').once('value');
            inboxKeys = Object.keys(inSnap.val() || {});
        }
        const legacyKeys = [...new Set(idxKeys.concat(inboxKeys))].filter(k => k !== pairId && k.startsWith(pairId + '__'));
        if (!legacyKeys.length) return;

        const targetMsgsSnap = await db.ref('chats/' + pairId + '/messages').once('value');
        const targetMsgs = (targetMsgsSnap.val() && typeof targetMsgsSnap.val() === 'object') ? targetMsgsSnap.val() : {};
        const tMetaSnap = await db.ref('chats/' + pairId + '/meta').once('value');
        const tMeta = (tMetaSnap.val() && typeof tMetaSnap.val() === 'object') ? tMetaSnap.val() : {};

        const updates = { messages: {}, meta: {} };
        let targetIsEmpty = !Object.keys(targetMsgs).length;
        const migratedKeys = [];

        for (const k of legacyKeys) {
            const t = (await db.ref('chats/' + k).once('value')).val();
            if (!t || typeof t !== 'object') continue; // déjà migré/supprimé
            migratedKeys.push(k);
            const meta = t.meta || {};
            const msgs = t.messages || {};
            for (const mid of Object.keys(msgs)) {
                if (msgs[mid] && !targetMsgs[mid]) updates.messages[mid] = msgs[mid];
            }
            if (targetIsEmpty && Object.keys(meta).length) {
                // thread du duo vide : on recopie aussi le contexte
                const participantsUpd = {}, namesUpd = {};
                Object.keys(meta.participants || {}).forEach(p => {
                    if (!tMeta.participants || !tMeta.participants[p]) participantsUpd[p] = true;
                    if (meta.names && meta.names[p] && (!tMeta.names || !tMeta.names[p])) namesUpd[p] = meta.names[p];
                });
                if (Object.keys(participantsUpd).length) updates.meta.participants = participantsUpd;
                if (Object.keys(namesUpd).length) updates.meta.names = namesUpd;
                if (!tMeta.jobId && meta.jobId) updates.meta.jobId = meta.jobId;
                if (!tMeta.jobTitle && meta.jobTitle) updates.meta.jobTitle = meta.jobTitle;
                if (!tMeta.lastAt && meta.lastAt) {
                    updates.meta.lastAt = meta.lastAt;
                    if (meta.lastMessage) updates.meta.lastMessage = meta.lastMessage;
                    if (meta.lastFrom) updates.meta.lastFrom = meta.lastFrom;
                }
            }
        }

        if (!Object.keys(updates.messages).length && !Object.keys(updates.meta).length) return;
        const write = {};
        if (Object.keys(updates.messages).length) write.messages = updates.messages;
        if (Object.keys(updates.meta).length) write.meta = updates.meta;
        // référence chats/{pairId} : autorisée (je suis dans le threadId)
        await db.ref('chats/' + pairId).update(write);

        // La conversation unique du duo doit figurer dans ma boîte de
        // réception (si elle n'existait pas, les messages venaient du thread
        // ancien qui vient d'être migré).
        if (migratedKeys.length) {
            const finalMetaSnap = await db.ref('chats/' + pairId + '/meta').once('value');
            const fm = finalMetaSnap.val() || {};
            const pairInboxSnap = await db.ref('userInboxes/' + user.uid + '/threads/' + pairId).once('value');
            if (!pairInboxSnap.exists()) {
                const pUid = peerUidOf(pairId);
                if (pUid) {
                    await db.ref('userInboxes/' + user.uid + '/threads/' + pairId).update({
                        peerUid: pUid,
                        peerName: (fm.names && fm.names[pUid]) || livePeerName(pUid) || 'Utilisateur',
                        jobId: fm.jobId || 'general',
                        jobTitle: fm.jobTitle || null,
                        lastMessage: fm.lastMessage || '',
                        lastAt: fm.lastAt || Date.now(),
                        lastFrom: fm.lastFrom || null
                    });
                }
            }
            // Nettoyage : les threads anciens ont servi à migrer, on les
            // retire (messages déjà recopiés) + leurs entrées d'inbox au
            // format ancien (sinon double ligne pour la même personne).
            for (const k of migratedKeys) {
                db.ref('userInboxes/' + user.uid + '/threads/' + k).set(null).catch(() => {});
                db.ref('userThreads/' + user.uid + '/' + k).set(null).catch(() => {});
                db.ref('chats/' + k).set(null).catch(() => {});
            }
        }
    } catch (e) {
        console.warn('healLegacyThreadsForPair:', e);
    }
}

// Filet de la LISTE : l'index userThreads sait quelles conversations
// existent pour moi même si leur entrée d'inbox a été perdue. Reconstruit
// les entrées manquantes (appelé à l'ouverture de l'écran Messages).
async function repairInboxFromThreadsIndex(uid) {
    try {
        const idx = await db.ref('userThreads/' + uid).once('value');
        const idxThreads = Object.keys(idx.val() || {});
        if (!idxThreads.length) return;
        const inboxSnap = await db.ref('userInboxes/' + uid + '/threads').once('value');
        const inbox = inboxSnap.val() || {};
        for (const tid of idxThreads) {
            if (inbox[tid] && inbox[tid].peerUid) continue;
            try {
                const metaSnap = await db.ref('chats/' + tid + '/meta').once('value');
                const mv = metaSnap.val() || {};
                if (!mv.participants || !Object.keys(mv.participants).length) continue;
                const peerUid = peerUidOf(tid);
                if (!peerUid) continue;
                await db.ref('userInboxes/' + uid + '/threads/' + tid).update({
                    peerUid: peerUid,
                    peerName: (mv.names && mv.names[peerUid]) || livePeerName(peerUid) || 'Utilisateur',
                    lastMessage: mv.lastMessage || '',
                    lastAt: mv.lastAt || Date.now(),
                    lastFrom: mv.lastFrom || null
                });
                const i = lastInboxSnapshot.findIndex(([t]) => t === tid);
                if (i >= 0) lastInboxSnapshot[i] = [tid, { peerUid: peerUid, peerName: (mv.names && mv.names[peerUid]) || livePeerName(peerUid) || 'Utilisateur', lastMessage: mv.lastMessage || '', lastAt: mv.lastAt || Date.now(), lastFrom: mv.lastFrom || null }];
                else lastInboxSnapshot.push([tid, { peerUid: peerUid, peerName: (mv.names && mv.names[peerUid]) || livePeerName(peerUid) || 'Utilisateur', lastMessage: mv.lastMessage || '', lastAt: mv.lastAt || Date.now(), lastFrom: mv.lastFrom || null }]);
            } catch (e) { /* une entrée ne bloque pas les autres */ }
        }
    } catch (e) { /* non critique */ }
}

// Enregistre la photo sur l'appareil (paramètre « dl » de Cloudinary)
function downloadChatImage(url) {
    try {
        const dlUrl = url + (url.includes('?') ? '&' : '?') + 'dl=jobmarket-photo.jpg';
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = 'jobmarket-photo.jpg';
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    } catch (e) {
        window.open(url, '_blank');
    }
}

  // ==========================================
// NOUVEAUX BOUTONS DU PANNEAU
// ==========================================

// Formate un numéro camerounais en format international sans '+' ni espaces
// (237XXXXXXXXX), pour les liens wa.me. Gère les formats locaux courants :
// avec ou sans 0 initial, avec ou sans indicatif 237 déjà présent (l'ancienne
// version ne gérait que les numéros commençant déjà par 6 ou 2).
function formatCameroonPhoneForWhatsApp(phoneRaw) {
    let clean = String(phoneRaw || '').replace(/\D/g, '');
    if (clean.startsWith('00237')) clean = clean.slice(2); // 00237... -> 237...
    if (clean.startsWith('0') && !clean.startsWith('237')) clean = clean.slice(1); // format local avec 0 initial
    if (!clean.startsWith('237')) clean = '237' + clean;
    return clean;
}

// Détecte un appareil mobile (Android/iOS) pour choisir la bonne stratégie
// d'ouverture de WhatsApp ci-dessous.
function isMobileDevice() {
    return /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// Sur ordinateur, on pré-ouvre un onglet vide DANS LE MÊME CLIC (avant les
// appels Firebase potentiellement lents), pour ne pas être bloqué par le
// bloqueur de popups une fois la préparation du message terminée. On ne le
// fait PAS sur mobile : rediriger un onglet ouvert via window.open() casse
// l'ouverture directe de l'app WhatsApp par lien App Links (voir plus bas).
function openWhatsAppPlaceholderTab() {
    if (isMobileDevice()) return null;
    try {
        return window.open('', '_blank');
    } catch (e) {
        return null;
    }
}

// Ouvre WhatsApp. Sur mobile : navigue l'onglet ACTUEL vers le lien officiel
// "Click to Chat" (wa.me), reconnu par Android (App Links) et iOS (Universal
// Links) pour ouvrir l'app installée DIRECTEMENT, sans page intermédiaire —
// c'est la seule méthode fiable même après un délai (attente Firebase), une
// popup ouverte via window.open() n'étant plus reconnue comme un geste
// utilisateur direct par beaucoup de navigateurs mobiles.
// Sur ordinateur : redirige l'onglet pré-ouvert (ou en ouvre un nouveau) vers
// WhatsApp Web, en gardant JobMarket Cameroon ouvert dans l'onglet d'origine.
function openWhatsAppReliably(placeholderWindow, phoneRaw, message) {
    const text = encodeURIComponent(message || '');
    const phonePart = phoneRaw ? formatCameroonPhoneForWhatsApp(phoneRaw) : '';
    const url = `https://wa.me/${phonePart}?text=${text}`;

    if (placeholderWindow && !placeholderWindow.closed) {
        placeholderWindow.location.href = url;
        return;
    }

    if (!isMobileDevice()) {
        const win = window.open(url, '_blank');
        if (win) return;
        // Popup bloquée malgré tout : on retombe sur la navigation directe ci-dessous.
    }

    window.location.href = url;
}

// Message de premier contact : au lieu du message-modèle rigide (variables
// collées bout à bout), l'IA rédige un message qui relie explicitement les
// compétences réelles de l'artisan au besoin décrit dans CETTE annonce
// précise (voir buildCraftContactMessagePrompt dans chat-proxy.js) — sans
// jamais inventer une compétence non fournie par le profil.
//
// "Fail-open" comme la modération : toute panne, lenteur ou réponse
// invalide de l'IA retombe silencieusement sur le message-modèle existant,
// qui reste parfaitement fonctionnel — jamais bloquer un contact pour une
// raison d'infrastructure secondaire.
// Enregistre le contact UNE SEULE FOIS par (job, utilisateur) — clé
// déterministe plutôt que push(), avec vérification d'existence avant
// écriture. Avant, chaque clic sur "Contacter" (depuis la fiche du job OU
// depuis le popup de la carte) créait une NOUVELLE entrée job_contacts
// même pour le même job — donc plusieurs entrées "non notées" en même
// temps pour une seule vraie interaction, ce qui faisait réapparaître le
// prompt d'avis à chaque rechargement.
//
// Écrit aussi deux INDEX légers (job_contacts_by_user, job_contacts_by_job)
// dans la même opération atomique que job_contacts lui-même — nécessaire
// depuis que job_contacts/.read est restreint aux deux parties concernées
// (voir database.rules.json) : Firebase ne peut pas filtrer une requête
// orderByChild() ligne par ligne selon qui a le droit de voir chaque
// entrée, donc pour retrouver "mes contacts" ou "qui a contacté mon job"
// sans exposer tout job_contacts à tout le monde, chaque index ne contient
// que des clés — on relit ensuite job_contacts/{clé} un par un via
// fetchJobContactsFromIndex(), ce qui est autorisé puisque le lecteur est
// alors forcément l'une des deux parties (contactUid ou jobOwnerUid).
//
// Renvoie true si une NOUVELLE entrée a été créée (pour ne notifier/
// compter que les vrais nouveaux contacts, pas les réouvertures de
// conversation).
async function recordJobContactOnce(job, uid) {
  const key = job.id + '_' + uid;
  const existing = await db.ref('job_contacts/' + key).once('value');
  if (existing.exists()) return false;
  // 3 écritures ciblées — PAS une update() à la racine (toujours refusée
  // par les règles, voir pushChatMessage). L'ordre compte : les deux index
  // vérifient dans leurs règles que job_contacts/{clé} existe déjà et
  // appartient bien à l'utilisateur connecté.
  await db.ref('job_contacts/' + key).set({
    jobId: job.id,
    jobOwnerUid: job.user,
    contactUid: uid,
    timestamp: Date.now(),
    reviewed: false, // passera à true quand un avis aura été laissé ou ignoré
    notifiedOwner: false // passera à true une fois le propriétaire notifié (voir scripts/sendContactNotifications.js)
  });
  await db.ref('job_contacts_by_user/' + uid + '/' + key).set(true);
  await db.ref('job_contacts_by_job/' + job.id + '/' + key).set(true);
  return true;
}

// Relit en clair les entrées job_contacts listées par un index (by_user ou
// by_job) — factorisé car les trois usages (mes contacts pour un avis, mon
// historique complet, les contacts reçus sur mon job) suivent exactement
// le même schéma : lire l'index (juste des clés), puis chaque entrée
// job_contacts correspondante.
async function fetchJobContactsFromIndex(indexPath) {
  const indexSnap = await db.ref(indexPath).once('value');
  if (!indexSnap.exists()) return [];
  const keys = Object.keys(indexSnap.val());
  const entries = await Promise.all(keys.map(async key => {
    const snap = await db.ref('job_contacts/' + key).once('value');
    return { key, val: snap.val() };
  }));
  return entries.filter(e => e.val); // ignore les clés dont l'entrée aurait disparu entre-temps
}

async function craftContactMessage(job, profile) {
  const proTitle = profile.jobTitle || 'Non spécifié';
  const proSkills = profile.skills || 'Non spécifiés';
  const profileName = profile.name || profile.company || 'Prestataire';
  const displayContent = getJobDisplayContent(job); // titre déjà traduit si en cache

  const fallbackMessage = t('waMsgContactProvider')
      .replace('{jobTitle}', displayContent.title)
      .replace('{profileName}', profileName)
      .replace('{proTitle}', proTitle)
      .replace('{proSkills}', proSkills);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'craft_contact_message',
        jobTitle: displayContent.title,
        jobDesc: displayContent.desc,
        proTitle,
        proSkills,
        lang: job.lang || currentLang // langue lue par l'auteur de l'annonce
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return fallbackMessage;

    const data = await res.json();
    if (data.fallback || typeof data.message !== 'string' || !data.message.trim()) return fallbackMessage;
    return data.message;
  } catch (err) {
    return fallbackMessage;
  }
}

async function contactViaWhatsAppFromPreview() {
    const job = window.currentPreviewJob;
    if (!job) return;

    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
        alert(t('mustBeLoggedInWhatsapp'));
        closeJobPreview();
        if(typeof openOverlay === 'function') openOverlay('accountPage');
        return;
    }

    // Ouvert tout de suite, dans le même clic, pour ne pas être bloqué par le
    // navigateur après les appels Firebase ci-dessous (voir openWhatsAppPlaceholderTab).
    const waWindow = openWhatsAppPlaceholderTab();

    try {
        const snapshot = await db.ref(`profiles/${user.uid}`).once('value');
        const profile = snapshot.val() || {};
        if (!isProfileComplete(profile)) {
            if (waWindow) waWindow.close();
            alert(t('mustCompleteProfileContact'));
            closeJobPreview();
            openProfileSheet();
            return;
        }

        const phone = job.phone;
        if (!phone) {
            if (waWindow) waWindow.close();
            alert(t('phoneUnavailable'));
            return;
        }

        const isNewContact = await recordJobContactOnce(job, user.uid);
        if (isNewContact) {
            bumpDailyStat('jobContacts');
            triggerInstantNotify('new-contact'); // prévient le propriétaire du job instantanément, sans attendre le cron
        }

        const message = await craftContactMessage(job, profile);
        openWhatsAppReliably(waWindow, phone, message);

    } catch (e) {
        console.error("Erreur", e);
        if (waWindow) waWindow.close();
        showToast(t('whatsappOpenError'), 'error');
    }
}

function shareJobViaWhatsApp() {
    // Volontairement ouvert à tout le monde, connecté ou non : c'est le
    // principal levier de croissance virale de l'app, aucune barrière ici.
    const job = window.currentPreviewJob;
    if (!job) return;
    const link = getJobShareLink(job.id);
    const displayContent = getJobDisplayContent(job);
    const requirementsBlock = displayContent.requirements ? '\n\n' + t('waMsgRequirementsLabel') + '\n' + displayContent.requirements : '';
    const phonesText = job.phone2 ? (job.phone + t('waMsgOrConnector') + job.phone2) : (job.phone || '—');
    const message = t('waMsgShareJob').replace('{title}', (displayContent.title || '').toUpperCase()).replace('{desc}', displayContent.desc || '').replace('{requirements}', requirementsBlock).replace('{location}', job.landmark || 'Non spécifié').replace('{price}', job.price).replace('{phone}', phonesText).replace('{link}', link);
    openWhatsAppReliably(null, null, message);
}

function drawRouteFromPreview() {
    const job = window.currentPreviewJob;
    if (!job) return;
    closeJobPreview();
    if (typeof userCoords !== 'undefined' && userCoords) {
        focusJob(job.lat, job.lng);
        drawRoute(job.lat, job.lng);
    } else {
        alert(t('cannotComputeRoute'));
    }
}
      
     // ==========================================
// SECURITE POUR LES BOUTONS SUR LA CARTE (INFOBULLE)
// ==========================================
window.popupWhatsAppClick = async function(jobId) {
    console.log('popupWhatsAppClick appelé avec jobId:', jobId);
    console.log('jobsById keys:', Object.keys(jobsById));
    
    const job = jobsById[jobId];
    if (!job) {
        console.error('Job non trouvé avec l\'ID:', jobId);
        alert(t('jobNotFoundAlert'));
        return;
    }

    const user = auth.currentUser;
    if (!user || user.isAnonymous) {
        alert(t('mustBeLoggedInWhatsapp'));
        if(typeof openOverlay === 'function') openOverlay('accountPage');
        return;
    }

    // Ouvert tout de suite, dans le même clic (voir openWhatsAppPlaceholderTab
    // et contactViaWhatsAppFromPreview pour l'explication du blocage mobile).
    const waWindow = openWhatsAppPlaceholderTab();

    try {
        const snapshot = await db.ref(`profiles/${user.uid}`).once('value');
        const profile = snapshot.val() || {};
        if (!isProfileComplete(profile)) {
            if (waWindow) waWindow.close();
            alert(t('mustCompleteProfileContact'));
            if(typeof openProfileSheet === 'function') openProfileSheet();
            return;
        }

        const phone = job.phone;
        if (!phone) {
            if (waWindow) waWindow.close();
            alert(t('phoneUnavailable'));
            return;
        }

        const isNewContact = await recordJobContactOnce(job, user.uid);
        if (isNewContact) {
            bumpDailyStat('jobContacts');
            triggerInstantNotify('new-contact'); // prévient le propriétaire du job instantanément, sans attendre le cron
        }

        const message = await craftContactMessage(job, profile);
        openWhatsAppReliably(waWindow, phone, message);
        showToast(t('whatsappOpenedSuccess'), 'success');

    } catch (e) {
        console.error("Erreur:", e);
        if (waWindow) waWindow.close();
        alert(t('errorPrefix') + e.message);
    }
}

// Logique de partage WhatsApp, factorisée pour être appelable soit depuis le
// popup de la carte (job déjà dans jobsById), soit juste après la
// publication d'une annonce (jobData tenu en main, pas encore forcément
// synchronisé dans jobsById à cet instant précis — voir promptShareNewJob).
function shareJobViaWhatsApp(jobId, job) {
    const link = getJobShareLink(jobId);
    const displayContent = getJobDisplayContent(job);
    const requirementsBlock = displayContent.requirements ? '\n\n' + t('waMsgRequirementsLabel') + '\n' + displayContent.requirements : '';
    const phonesText = job.phone2 ? (job.phone + t('waMsgOrConnector') + job.phone2) : (job.phone || '—');
    const message = t('waMsgShareJob').replace('{title}', (displayContent.title || '').toUpperCase()).replace('{desc}', displayContent.desc || '').replace('{requirements}', requirementsBlock).replace('{location}', job.landmark || 'Non spécifié').replace('{price}', job.price).replace('{phone}', phonesText).replace('{link}', link);
    openWhatsAppReliably(null, null, message);
    showToast(t('sharedOnWhatsapp'), 'success');
}

// Copie le lien direct d'une annonce, pour la partager par un autre canal
// que WhatsApp (SMS, Facebook, Telegram...). navigator.clipboard n'est pas
// disponible sur tous les navigateurs Android plus anciens encore en usage
// au Cameroun — d'où le repli sur document.execCommand('copy'), obsolète
// mais bien plus largement supporté.
function copyJobLink(jobId) {
  const link = getJobShareLink(jobId);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link)
      .then(() => showToast(t('linkCopied'), 'success'))
      .catch(() => copyJobLinkFallback(link));
  } else {
    copyJobLinkFallback(link);
  }
}

function copyJobLinkFallback(link) {
  try {
    const el = document.createElement('textarea');
    el.value = link;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast(t('linkCopied'), 'success');
  } catch (e) {
    showToast(t('copyLinkFailed'), 'error');
  }
}

window.popupShareClick = function(jobId) {
    // Ouvert à tout le monde, connecté ou non — c'est le principal levier
    // de croissance virale de l'app.
    const job = jobsById[jobId];
    if (!job) {
        console.error('Job non trouvé avec l\'ID:', jobId);
        alert(t('jobNotFoundAlert'));
        return;
    }
    shareJobViaWhatsApp(jobId, job);
}

// Propose de partager l'annonce tout de suite après une publication réussie.
function promptShareNewJob(jobId, job) {
    const modal = document.getElementById('shareNewJobModal');
    const btn = document.getElementById('shareNewJobBtn');
    if (!modal || !btn) return;
    btn.onclick = () => { modal.style.display = 'none'; shareJobViaWhatsApp(jobId, job); };
    modal.style.display = 'flex';
}
 
// ===== SYSTÈME D'AVIS =====
// Après un contact WhatsApp, on propose au client de noter la prestation
// à son retour dans l'app (au moins 3h après le contact, pour laisser le
// temps que la prestation ait vraiment eu lieu).
const REVIEW_DELAY_MS = 3 * 60 * 60 * 1000; // 3 heures

// Affiche la note moyenne + les derniers avis détaillés (avec commentaire) reçus
// par l'auteur d'une annonce. Contrairement au badge ★ affiché sur les cartes,
// ceci montre les commentaires eux-mêmes : c'est ce qui construit la confiance
// avant que quelqu'un ne décide de contacter la personne.
async function renderOwnerReviews(ownerUid, containerId) {
    containerId = containerId || 'previewOwnerReviews';
    const box = document.getElementById(containerId);
    if (!box || !ownerUid) { if (box) box.innerHTML = ''; return; }

    const ownerProfile = profilesCache[ownerUid] || {};
    const avg = ownerProfile.ratingAvg || 0;
    const count = ownerProfile.ratingCount || 0;

    if (count === 0) {
        box.innerHTML = `
            <div style="margin-top:16px;padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">
                <h3 style="margin:0 0 6px 0;font-size:15px;color:var(--text);">${t('reviewsTitle')}</h3>
                <p style="font-size:13px;color:var(--text-dim);margin:0;" data-i18n="noReviewsYet">Pas encore d'avis pour ce prestataire.</p>
            </div>`;
        return;
    }

    const fullStars = Math.round(avg);
    const starsHtml = '★★★★★☆☆☆☆☆'.slice(5 - fullStars, 10 - fullStars);

    const listId = containerId + 'ReviewsList';
    box.innerHTML = `
        <div style="margin-top:16px;padding:14px;background:var(--surface);border:1px solid var(--border);border-radius:12px;">
            <h3 style="margin:0 0 8px 0;font-size:15px;color:var(--text);display:flex;align-items:center;gap:8px;">
                ${t('reviewsTitle')} <span style="color:var(--gold,#FFD700);font-size:14px;letter-spacing:2px;">${starsHtml}</span>
                <span style="font-size:12px;color:var(--text-dim);font-weight:400;">${avg.toFixed(1)}/5 · ${count} ${t('reviewsCountWord')}</span>
            </h3>
            <div id="${listId}" style="display:flex;flex-direction:column;gap:10px;margin-top:10px;">
                <div style="font-size:12px;color:var(--text-dim);" data-i18n="loadingReviews">Chargement des avis...</div>
            </div>
        </div>`;

    try {
        const snap = await db.ref('reviews').orderByChild('jobOwnerUid').equalTo(ownerUid).limitToLast(10).once('value');
        const listEl = document.getElementById(listId);
        if (!listEl) return;
        if (!snap.exists()) { listEl.innerHTML = ''; return; }

        const items = [];
        snap.forEach(child => items.push(child.val()));
        items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        listEl.innerHTML = items.map(r => {
            const reviewer = profilesCache[r.reviewerUid] || {};
            const name = reviewer.name || reviewer.company || t('userFallback');
            const stars = '★★★★★☆☆☆☆☆'.slice(5 - (r.rating || 0), 10 - (r.rating || 0));
            const when = (typeof timeAgo === 'function' && r.timestamp) ? timeAgo(r.timestamp) : '';
            const comment = r.comment ? `<div style="font-size:13px;color:var(--text);margin-top:3px;">${escapeHtml(r.comment)}</div>` : '';
            return `
                <div style="border-top:1px solid var(--border);padding-top:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:13px;font-weight:700;color:var(--text);">${escapeHtml(name)}</span>
                        <span style="font-size:12px;color:var(--gold,#FFD700);letter-spacing:1px;">${stars}</span>
                    </div>
                    ${comment}
                    ${when ? `<div style="font-size:11px;color:var(--text-dim);margin-top:3px;">${when}</div>` : ''}
                </div>`;
        }).join('');

        // Résumé IA des avis : évite d'obliger un visiteur à tout lire pour
        // se faire une idée. Seulement si assez de commentaires substantiels
        // (sinon un résumé n'apporte rien qu'une lecture directe ne donne
        // pas déjà). Affiché seulement quand prêt, jamais bloquant.
        const commentsForSummary = items.map(r => r.comment).filter(c => c && c.trim().length >= 8);
        if (commentsForSummary.length >= 3) {
            getReviewsSummary(ownerUid, commentsForSummary).then(summary => {
                if (!summary) return;
                const currentListEl = document.getElementById(listId);
                if (!currentListEl) return; // popup peut avoir été fermé entre-temps
                const summaryEl = document.createElement('div');
                summaryEl.style.cssText = 'font-size:12px;color:var(--text-dim,#9999BC);font-style:italic;padding-bottom:8px;border-bottom:1px solid var(--border,#333);margin-bottom:2px;';
                summaryEl.textContent = '💬 ' + summary;
                currentListEl.insertAdjacentElement('afterbegin', summaryEl);
            });
        }
    } catch (e) {
        console.warn('renderOwnerReviews error', e);
        const listEl = document.getElementById(listId);
        if (listEl) listEl.innerHTML = '<div style="font-size:12px;color:var(--text-dim);">' + t('reviewsLoadError') + '</div>';
    }
}

// Résumé IA des avis d'un prestataire, mis en cache dans Firebase pour
// n'appeler l'IA qu'UNE FOIS par (langue, nombre d'avis) — tous les
// visiteurs suivants dans la même langue réutilisent le même résumé tant
// qu'aucun nouvel avis n'est arrivé. Dès qu'un nouvel avis change le
// compte, la clé de cache change aussi, ce qui force naturellement une
// regénération plutôt qu'un résumé obsolète.
async function getReviewsSummary(ownerUid, comments) {
  const cacheKey = `${currentLang}_${comments.length}`;
  try {
    const cached = await db.ref(`profiles/${ownerUid}/reviewSummaries/${cacheKey}`).once('value');
    if (cached.exists() && cached.val().text) return cached.val().text;
  } catch (e) {
    // lecture cache échouée : on tente quand même une génération ci-dessous
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(CHAT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'summarize_reviews', comments, lang: currentLang }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.fallback || typeof data.summary !== 'string' || !data.summary.trim()) return null;

    db.ref(`profiles/${ownerUid}/reviewSummaries/${cacheKey}`).set({ text: data.summary }).catch(() => {});
    return data.summary;
  } catch (err) {
    return null; // silencieux : la liste d'avis reste utilisable normalement sans résumé
  }
}

// Affiche un bouton "Laisser un avis" si l'utilisateur connecté a déjà
// contacté ce prestataire pour CETTE annonce précise. C'est ce qui manquait :
// avant, un avis ne pouvait être laissé que via une popup automatique
// apparaissant 3h après le contact — sans bouton, cliquer ne faisait donc rien.
async function renderMyReviewAction(job) {
    const box = document.getElementById('previewReviewAction');
    if (!box) return;
    box.innerHTML = '';

    const user = auth.currentUser;
    const isOwner = !!(user && job.user === user.uid);
    if (!user || user.isAnonymous || isOwner) return; // pas de bouton pour soi-même ou visiteur non connecté

    try {
        const entries = await fetchJobContactsFromIndex('job_contacts_by_user/' + user.uid);
        let myContactKey = null;
        let myContact = null;
        entries.forEach(entry => {
            if (entry.val && entry.val.jobId === job.id) {
                myContactKey = entry.key;
                myContact = entry.val;
            }
        });

        if (!myContactKey) {
            box.innerHTML = `<div style="margin-top:12px;font-size:12px;color:var(--text-dim);">${t('contactBeforeReview')}</div>`;
            return;
        }

        if (myContact.reviewed) {
            box.innerHTML = `<div style="margin-top:12px;font-size:12px;color:var(--green,#25D366);">${t('alreadyReviewed')}</div>`;
            return;
        }

        const ownerProfile = profilesCache[job.user] || {};
        const ownerName = ownerProfile.name || ownerProfile.company || t('reviewsProviderFallback');
        box.innerHTML = `<button type="button" onclick="showReviewPrompt('${myContactKey}', '${job.user}', '${escapeHtml(job.title || '')}', '${escapeHtml(ownerName)}')" style="margin-top:12px;width:100%;background:var(--gold,#FFD700);border:none;color:#111;padding:12px;border-radius:12px;font-weight:800;cursor:pointer;">${t('reviewsLeaveBtn')}</button>`;
    } catch (e) {
        console.warn('renderMyReviewAction error', e);
    }
}

async function checkPendingReviews(uid) {
  try {
    const entries = await fetchJobContactsFromIndex('job_contacts_by_user/' + uid);
    if (!entries.length) return;

    let pending = null;
    let pendingKey = null;
    entries.forEach(entry => {
      const data = entry.val;
      if (!pending && data && data.reviewed === false && (Date.now() - data.timestamp) > REVIEW_DELAY_MS) {
        pending = data;
        pendingKey = entry.key;
      }
    });
    if (!pending) return;

    const jobSnap = await db.ref('jobs/' + pending.jobId).once('value');
    const job = jobSnap.val();
    const jobTitle = job ? job.title : t('reviewsJobFallback');
    const ownerProfile = profilesCache[pending.jobOwnerUid] || {};
    const ownerName = ownerProfile.name || ownerProfile.company || t('reviewsProviderFallback');

    showReviewPrompt(pendingKey, pending.jobOwnerUid, jobTitle, ownerName);
  } catch (e) {
    console.warn('checkPendingReviews error', e);
  }
}

function showReviewPrompt(contactKey, jobOwnerUid, jobTitle, ownerName) {
  if (document.getElementById('reviewPromptOverlay')) return; // déjà affiché

  let selectedRating = 0;
  const overlay = document.createElement('div');
  overlay.id = 'reviewPromptOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--surface,#1a1a1a);border-radius:16px;padding:24px;max-width:360px;width:100%;text-align:center;">
      <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:17px;margin-bottom:6px;" data-i18n="reviewModalTitle">Comment ça s'est passé ?</div>
      <div style="font-size:13px;color:var(--text-dim,#9999BC);margin-bottom:16px;">${t('reviewPromptWith').replace('{name}', escapeHtml(ownerName)).replace('{title}', escapeHtml(jobTitle))}</div>
      <div id="reviewStars" style="font-size:32px;margin-bottom:16px;">
        <span class="review-star" data-value="1" style="cursor:pointer;padding:4px;display:inline-block;">☆</span><span class="review-star" data-value="2" style="cursor:pointer;padding:4px;display:inline-block;">☆</span><span class="review-star" data-value="3" style="cursor:pointer;padding:4px;display:inline-block;">☆</span><span class="review-star" data-value="4" style="cursor:pointer;padding:4px;display:inline-block;">☆</span><span class="review-star" data-value="5" style="cursor:pointer;padding:4px;display:inline-block;">☆</span>
      </div>
      <textarea id="reviewComment" placeholder="${t('reviewCommentPlaceholder')}" maxlength="500" style="width:100%;min-height:70px;border-radius:10px;padding:10px;background:var(--surface);color:var(--text);border:1px solid var(--border,#333);margin-bottom:14px;box-sizing:border-box;font-size:16px;"></textarea>
      <div style="display:flex;gap:10px;">
        <button id="reviewSkipBtn" type="button" style="flex:1;background:none;border:1px solid var(--border,#333);color:var(--text-dim,#9999BC);padding:12px;border-radius:12px;cursor:pointer;font-weight:600;">${t('notifPrimerLater')}</button>
        <button id="reviewSubmitBtn" type="button" style="flex:1;background:#FFD700;color:#111;padding:12px;border:none;border-radius:12px;cursor:pointer;font-weight:800;">${t('reviewSendBtn')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Étoiles : 5 zones cliquables distinctes plutôt qu'un calcul de position sur une
  // seule chaîne de texte — plus fiable au doigt sur mobile (zone de clic imprécise
  // avec letter-spacing) et impossible à "manquer" en cliquant entre deux étoiles.
  const starEls = Array.from(overlay.querySelectorAll('.review-star'));
  function renderStars(rating) {
    starEls.forEach((el, i) => { el.textContent = (i < rating) ? '★' : '☆'; });
  }
  starEls.forEach(el => {
    el.addEventListener('click', () => {
      selectedRating = Number(el.dataset.value);
      renderStars(selectedRating);
    });
  });

  overlay.querySelector('#reviewSkipBtn').onclick = async () => {
    try {
      await db.ref('job_contacts/' + contactKey + '/reviewed').set(true);
    } catch (e) {
      console.warn('Skip avis: écriture échouée (sera reproposé plus tard)', e);
    }
    overlay.remove();
  };

  const submitBtn = overlay.querySelector('#reviewSubmitBtn');
  submitBtn.onclick = async () => {
    if (selectedRating === 0) {
      showToast(t('chooseRatingFirst'), 'error');
      return;
    }
    // Feedback visuel immédiat + anti double-clic : sans ça, sur un réseau lent,
    // cliquer donne l'impression que "rien ne se passe" pendant l'attente du
    // serveur, et un second clic peut envoyer l'avis deux fois.
    submitBtn.disabled = true;
    submitBtn.textContent = t('reviewSending');
    const comment = overlay.querySelector('#reviewComment').value.trim();
    try {
      const idToken = await auth.currentUser.getIdToken();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(SUBMIT_REVIEW_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, contactKey, rating: selectedRating, comment }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        // "rate_limited" (délai anti-abus, 1 avis par prestataire tous les
        // 30 jours) mérite un message différent d'une vraie erreur —
        // l'action n'a pas échoué techniquement, elle est juste refusée
        // volontairement par la protection anti-faux-avis.
        if (data.error === 'rate_limited') {
          showToast(t('reviewRateLimited'), 'error');
        } else if (data.error === 'already_reviewed') {
          showToast(t('alreadyReviewed'), 'error');
          overlay.remove();
          return;
        } else {
          showToast(t('reviewSendError'), 'error');
        }
        submitBtn.disabled = false;
        submitBtn.textContent = t('reviewSendBtn');
        return;
      }

      triggerInstantNotify('new-review'); // prévient le prestataire noté instantanément, sans attendre le cron

      // Le calcul de la moyenne (ratingAvg/ratingCount) reste séparé de la
      // création de l'avis elle-même : ces deux champs sont réservés aux
      // admins côté règles Firebase, recalculés par rating-sync.js à partir
      // des avis réels — voir syncOwnerRating() plus haut dans ce fichier.
      syncOwnerRating(jobOwnerUid);

      bumpDailyStat('reviewsSubmitted');
      showToast(t('toastReviewThanks'), 'success');
      overlay.remove();
    } catch (e) {
      console.error('submitReview error', e);
      showToast(t('reviewSendError'), 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = t('reviewSendBtn');
    }
  };
}

// ===== INIT =====
locateMe();
applyTranslations();
syncJobs();
syncProfilesCache();


// ===== VIBRATION POUR CHAQUE CLIC =====
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
    vibrateDevice(50);
  }
});


// ===== Recherche par nom de job + filtre par rayon (vraiment câblés cette fois) =====
function toggleSearchPanel() {
  const panel = document.getElementById('searchPanel');
  if (!panel) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    const input = document.getElementById('jobSearchInput');
    if (input) input.focus();
  }
}

function toggleSettingsPanel() {
  const panel = document.getElementById('settingsPanel');
  if (!panel) return;
  const opening = (panel.style.display === 'none' || !panel.style.display);
  panel.style.display = opening ? 'block' : 'none';
  if (opening) {
    const notifPanel = document.getElementById('notifPanel');
    if (notifPanel) notifPanel.style.display = 'none'; // un seul panneau ouvert à la fois, plus lisible
  }
}

// Bascule thème sombre/clair, persisté pour les prochaines visites (voir
// aussi le script d'initialisation précoce en tout début de <head>, qui
// applique ce choix avant même le premier rendu pour éviter un flash).
function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const next = isLight ? 'dark' : 'light';
  if (next === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try { localStorage.setItem('jmc_theme', next); } catch (e) {}
  updateThemeToggleUI(next);

  // Aligne aussi la barre de statut du téléphone/navigateur (balise
  // theme-color) sur le nouveau thème — sans ça, elle restait toujours
  // sombre même en thème clair, puisqu'elle est indépendante du CSS.
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta) themeColorMeta.setAttribute('content', next === 'light' ? '#FFFFFF' : '#0A0A0F');
}

function updateThemeToggleUI(theme) {
  const icon = document.getElementById('themeToggleIcon');
  const label = document.getElementById('themeToggleLabel');
  if (icon) icon.textContent = theme === 'light' ? '☀️' : '🌙';
  if (label) label.textContent = theme === 'light' ? t('themeLight') : t('themeDark');
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeToggleUI(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  initOfflineDetection();

  const input = document.getElementById('jobSearchInput');
  if (input) {
    // Anti-rebond dédié à la stat : applyFilters() doit rester instantané à
    // chaque frappe pour l'expérience de recherche, mais compter une
    // "recherche" à chaque caractère tapé exploserait le nombre d'écritures
    // pour un signal sans intérêt. On ne compte qu'une fois l'utilisateur
    // arrêté de taper, et seulement si le texte a changé depuis la dernière
    // fois comptée (évite de recompter au focus/blur sans frappe réelle).
    let searchStatTimer = null;
    let lastCountedSearch = '';
    input.addEventListener('input', (e) => {
      currentSearchText = e.target.value;
      applyFilters();

      clearTimeout(searchStatTimer);
      searchStatTimer = setTimeout(() => {
        const term = currentSearchText.trim();
        if (term.length >= 2 && term !== lastCountedSearch) {
          lastCountedSearch = term;
          bumpDailyStat('searches');
        }
      }, 800);
    });
  }

  document.querySelectorAll('#radiusFilters .filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#radiusFilters .filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const r = parseFloat(btn.dataset.radius);
      currentRadiusKm = (!r || r === 0) ? null : r;
      if (currentRadiusKm && !userCoords) {
        showToast(t('activateLocationForRadius'), 'error');
      }
      applyFilters();
    });
  });
});
