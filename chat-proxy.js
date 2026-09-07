// ===== JobMarket Cameroon : proxy sécurisé pour l'assistant IA =====
//
// Rôle : le chat intégré (index.html, sendChatMessage/callChatAI) a besoin
// d'appeler un vrai modèle de langage (Llama 3.3 70B via Cloudflare Workers
// AI, gratuit, sans carte bancaire, inclus dans le même compte Cloudflare
// que ce worker) — sans jamais exposer de clé API dans index.html, qui est
// un fichier public sur GitHub.
//
// Contrairement à l'ancienne intégration Groq, Workers AI ne demande AUCUNE
// clé API séparée : l'accès au modèle se fait via le binding `env.AI`,
// configuré une fois dans wrangler.toml (voir section [ai] binding = "AI").
// Rien à stocker en secret, rien à faire fuiter.
//
// Ce worker reçoit l'historique de conversation depuis le client, ajoute
// le prompt système (gardé ici, pas côté client, pour rester la seule
// source de vérité), appelle Workers AI, et renvoie uniquement la réponse
// texte au client.
//
// Le quota gratuit Workers AI (10 000 "neurones"/jour à la date de cette
// intégration — largement suffisant pour un chat de support) est PARTAGÉ
// par toute l'app. Un budget journalier prudent reste appliqué ici par
// précaution (abus, boucle, bot), même si le risque de "facture surprise"
// n'existe plus avec Workers AI (pas de carte liée au compte). Si le
// budget est atteint, le worker répond avec fallback:true plutôt qu'une
// erreur, pour que le client bascule proprement sur l'assistant local
// (règles simples, toujours disponible) au lieu d'un message d'erreur.

const ALLOWED_ORIGIN = "https://ghislaintankat-cyber.github.io";

// Modèle Cloudflare Workers AI. Llama 3.3 70B en version fp8 "fast" :
// bon compromis qualité/vitesse, disponible gratuitement sur le compte
// standard. Voir https://developers.cloudflare.com/workers-ai/models/
// pour la liste complète si ce modèle venait à changer de nom/disparaître.
const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Marge large sous le plafond réel (10 000 neurones/jour) : les appels de
// ce worker sont courts (max_tokens <= 400), donc cette limite est très
// confortable — elle protège surtout contre un abus/bot plutôt que contre
// un vrai risque de dépassement de quota en usage normal.
const DAILY_BUDGET = 2000;

// Protection contre l'abus par une seule IP (bot, boucle, ou simplement
// une personne qui spamme le chat) : sans ça, une seule source pourrait
// épuiser à elle seule tout le budget quotidien partagé (DAILY_BUDGET)
// et priver tous les autres utilisateurs d'IA pour le reste de la
// journée. Fenêtre glissante de 10 minutes, best-effort comme le reste
// (si le KV est indisponible, on laisse passer plutôt que de bloquer).
const IP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const IP_RATE_LIMIT_MAX = 12; // requêtes max par IP sur la fenêtre

// Protection contre un pic global inhabituel (tous utilisateurs
// confondus). Workers AI n'a pas de plafond "requêtes/minute" partagé
// aussi strict que Groq, mais on garde un garde-fou raisonnable — un pic
// massif et soudain est plus probablement un bug ou un bot qu'un usage
// légitime. IMPORTANT : ce compteur reste partagé avec worker/translate-job.js
// s'il utilise aussi Workers AI — les deux workers doivent être liés au
// MÊME namespace KV (voir AI_RATE_LIMIT_KV) pour compter ensemble.
const SHARED_RPM_LIMIT = 40;

const CHAT_SYSTEM_PROMPT = `Tu es l'assistant du support client de JobMarket Cameroon, une application qui met en relation des particuliers avec des artisans et prestataires de proximité (BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique, etc.).

Tu peux aider avec :
- Comment publier un job / une demande de service : appuyer sur le gros bouton + doré en bas de l'écran, ou faire un appui long (clic droit sur ordinateur) directement à l'endroit voulu sur la carte
- Comment trouver un artisan proche : filtrer par catégorie sur la carte/liste, ou taper un mot-clé via l'onglet "Chercher" en bas de l'écran (recherche intelligente si aucun résultat exact)
- Comment contacter ou évaluer un artisan, et comment partager une annonce (bouton Partager sur WhatsApp ou Copier le lien, dans le popup de la carte ou juste après une publication)
- Le système de mise en avant (boost) : une annonce boostée reste en tête du classement 7 jours ; des crédits de boost s'obtiennent en parrainant d'autres utilisateurs (Compte → Parrainage) ; un rappel propose de renouveler en un tap avant expiration
- Des questions sur le compte, les notifications, ou l'utilisation générale de l'application
- Des conseils généraux pour bien décrire un job ou choisir le bon prestataire

En plus du support de l'application, tu peux aussi répondre à des questions générales d'économie, de finance personnelle et de gestion d'entreprise/petit commerce (fixer ses prix, calculer une marge, gérer sa trésorerie, épargner, développer sa clientèle, formaliser une activité, etc.) — beaucoup d'utilisateurs de JobMarket sont eux-mêmes des artisans ou des entrepreneurs indépendants, donc ce type de conseil reste utile dans ce contexte. Reste toutefois général et pédagogique : tu n'es pas comptable ni conseiller financier agréé, précise-le si la question implique une décision financière importante ou spécifique, et recommande alors un professionnel.

Sur les notifications, plus précisément :
- Elles se règlent dans Paramètres (icône ⚙️, en haut de l'écran) → section "Notifications" : on peut y choisir les catégories de jobs pour lesquelles on veut être alerté (BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique), et un curseur "Distance maximale" (5 à 100 km) pour ne recevoir que les jobs proches de sa position.
- Le curseur de distance ne fonctionne que si la géolocalisation de l'app est activée ; sans position connue, l'utilisateur continue de recevoir toutes les notifications de ses catégories choisies, sans filtrage par distance.
- Si les notifications ne s'affichent jamais du tout, la cause la plus fréquente est que le navigateur a été refusé au popup d'autorisation : il faut alors l'activer manuellement dans les réglages du navigateur (l'app ne peut pas redemander toute seule après un refus).

Réponds toujours de façon brève et directe (2-4 phrases maximum sauf si la question exige plus de détail), dans la langue utilisée par la personne.

Si la demande concerne un problème de compte nécessitant une action humaine (paiement contesté, signalement d'abus, suppression de compte), explique brièvement ce que tu peux faire et précise qu'un agent humain prendra le relais si nécessaire — ne prétends jamais avoir effectué une action que tu ne peux pas réellement faire (pas d'accès aux comptes, paiements, ou données réelles).

Si la question sort complètement du cadre de JobMarket Cameroon ET n'a aucun rapport avec l'économie, la finance ou la gestion d'entreprise, dis-le poliment et recentre la conversation.`;

// Prompt séparé (pas le même que le chat) pour la fonctionnalité "Améliorer
// avec l'IA" du formulaire de publication : ici on ne discute pas, on
// reformule un titre + une description bruts en une annonce claire, sans
// jamais inventer de détails que la personne n'a pas donnés (prix, délai,
// adresse...). Sortie strictement en JSON pour un parsing fiable côté client.
const REWRITE_SYSTEM_PROMPT = `Tu reformules des annonces de demande de service pour l'application JobMarket Cameroon (mise en relation particuliers/artisans : BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique).

On te donne un titre et une description bruts, parfois courts, mal orthographiés ou imprécis. Réécris-les pour qu'ils soient clairs, complets et utiles à un artisan qui doit décider s'il peut faire le travail — sans changer le sens ni inventer des détails non fournis (pas de prix, pas de délai, pas d'adresse si non donnés).

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"title": "...", "description": "..."}

Le titre : 5 à 12 mots, clair et concret.
La description : 2 à 5 phrases, dans la même langue que le texte original, gardant tous les détails factuels donnés (matériaux, quantités, contraintes) et en clarifiant seulement la formulation.`;

// Prompt séparé pour le bouton "Optimiser avec l'IA" du Profil Pro : on
// reformule le métier/spécialité + les compétences en formulation plus
// professionnelle et attractive pour un client qui compare des profils —
// sans jamais ajouter une compétence que la personne n'a pas mentionnée
// (ce serait mentir sur ses qualifications réelles).
const OPTIMIZE_PROFILE_SYSTEM_PROMPT = `Tu aides des artisans et prestataires (BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique) à présenter leur métier et leurs compétences de façon professionnelle sur JobMarket Cameroon, une app qui les met en relation avec des clients particuliers.

On te donne un métier/spécialité et une liste de compétences bruts, parfois vagues, mal orthographiés ou trop informels. Reformule-les pour qu'ils donnent une meilleure impression à un client qui compare plusieurs profils — sans jamais inventer ou ajouter une compétence non mentionnée à l'origine, et sans exagérer (pas de superlatifs non fondés comme "meilleur", "expert n°1").

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"jobTitle": "...", "skills": "..."}

jobTitle : 2 à 5 mots, le métier/spécialité clarifié.
skills : liste de compétences séparées par des virgules, dans la même langue que le texte original, reformulées de façon claire et professionnelle, en gardant le même nombre d'éléments (ne pas en ajouter ni en retirer).`;

// Prompt séparé pour le bouton "Suggérer un prix" du formulaire de
// publication : donne une fourchette indicative en FCFA pour le marché
// camerounais, à partir de la catégorie/titre/description du job. C'est
// une estimation générale (pas une donnée de marché vérifiée en temps
// réel) — le prompt doit rester honnête là-dessus plutôt que donner un
// faux sentiment de précision.
const SUGGEST_PRICE_SYSTEM_PROMPT = `Tu estimes une fourchette de prix indicative, en FCFA (franc CFA), pour des demandes de services publiées sur JobMarket Cameroon (particuliers cherchant des artisans/prestataires : BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique), à partir de ta connaissance générale du marché camerounais.

Sois honnête sur le fait qu'il s'agit d'une estimation générale, pas d'une donnée de marché vérifiée en temps réel — les prix réels varient selon la ville, le prestataire et les matériaux.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"rangeLow": 0, "rangeHigh": 0, "note": "..."}

rangeLow et rangeHigh : des nombres entiers en FCFA (pas de texte, pas de séparateurs).
note : une phrase courte (max 25 mots), dans la même langue que le titre/description fournis, précisant que c'est une estimation générale et rappelant le principal facteur de variation (ex : matériaux, distance, urgence).`;

// Prompt séparé pour le bouton "Analyser les signaux d'alerte" sur une
// annonce, avant de contacter son auteur. Analyse UNIQUEMENT le texte de
// l'annonce (titre/description/prix) — pas le profil ni l'historique de la
// personne, que ce worker ne connaît pas. Doit rester prudent : un signal
// textuel n'est jamais une preuve, seulement une invitation à la vigilance.
const SCAM_CHECK_SYSTEM_PROMPT = `Tu analyses le texte d'une annonce publiée sur JobMarket Cameroon (une demande de service d'un particulier envers un artisan/prestataire) pour repérer des signaux textuels habituellement associés aux arnaques : demande de paiement intégral ou d'acompte avant tout travail effectué, pression d'urgence artificielle, prix très en dehors du marché normal (dans un sens ou l'autre), demande de quitter la plateforme immédiatement, informations vagues ou contradictoires, demande de données sensibles (mot de passe, code reçu par SMS, pièce d'identité complète) dans le texte même de l'annonce.

Tu n'as accès qu'au texte de l'annonce, pas au profil de son auteur ni à son historique — reste donc prudent : un signal textuel n'est jamais une preuve de fraude, seulement une invitation à la vigilance. La grande majorité des annonces sont légitimes.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"riskLevel": "low", "note": "..."}

riskLevel : "low" (rien de particulier à signaler), "medium" (un ou deux signaux à surveiller) ou "high" (plusieurs signaux nets).
note : 1 à 2 phrases courtes, dans la même langue que l'annonce, expliquant brièvement ce qui a été repéré (ou l'absence de signal si "low"), sans jamais accuser formellement l'auteur.`;

// Prompt séparé pour le bouton "Suggérer la catégorie" du formulaire de
// publication : lit le titre/description et propose la catégorie la plus
// pertinente parmi les 7 existantes, même quand le texte ne contient pas
// le mot-clé exact (ex: "robinet qui fuit" -> plomberie). Sert à réduire
// les erreurs de catégorisation manuelle, qui cassaient déjà une fois le
// filtrage des notifications par catégorie (voir historique du projet).
const SUGGEST_CATEGORY_SYSTEM_PROMPT = `Tu classes une annonce de demande de service publiée sur JobMarket Cameroon dans l'une de ces 7 catégories exactes (réponds avec le code, pas le libellé) :
- btp (BTP / Maçonnerie)
- electricite (Électricité)
- plomberie (Plomberie)
- menage (Ménage / Nettoyage)
- jardinage (Jardinage)
- mecanique (Mécanique Auto)
- informatique (Informatique)

On te donne un titre et une description, parfois courts ou vagues. Choisis la catégorie la plus pertinente parmi les 7 ci-dessus, même si le texte ne contient pas le mot exact (ex: "robinet qui fuit" -> plomberie, "écran qui ne s'allume plus" -> informatique, "gazon à tondre" -> jardinage).

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"category": "plomberie", "confidence": "high"}

category : impérativement l'un des 7 codes exacts ci-dessus, rien d'autre.
confidence : "high", "medium" ou "low" selon la clarté du texte pour cette classification.`;

// Prompt séparé pour la "recherche intelligente" : ne s'active QUE quand
// la recherche par mot-clé exact n'a rien trouvé (voir index.html,
// déclenché après un délai sans frappe, pas à chaque touche). Interprète
// l'intention derrière une recherche en langage naturel qui ne contient
// pas le mot-clé exact d'une catégorie.
const SEARCH_INTENT_SYSTEM_PROMPT = `Tu interprètes une recherche tapée par un utilisateur de JobMarket Cameroon (petites annonces de services : BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique) pour laquelle la recherche par mot-clé exact n'a donné AUCUN résultat.

On te donne le texte recherché. Détermine s'il décrit clairement un besoin correspondant à l'une de ces 7 catégories (réponds avec le code) :
- btp, electricite, plomberie, menage, jardinage, mecanique, informatique

Exemples : "robinet qui fuit" -> plomberie ; "écran cassé" -> informatique ; "gazon à tondre" -> jardinage ; "peinture mur salon" -> btp.

Si le texte ne décrit CLAIREMENT aucune de ces catégories (nom de personne, mot sans rapport, texte trop vague ou ambigu), réponds "none" plutôt que de deviner au hasard.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"category": "plomberie"}

category : l'un des 7 codes exacts ci-dessus, ou "none".`;

// Prompt séparé pour la modération automatique à la publication : ne
// bloque QUE les cas clairement et sans ambiguïté problématiques — en cas
// de doute, il ne faut RIEN signaler. Ce n'est pas un filtre de qualité
// (fautes, style, manque de détails), seulement un filet contre le
// contenu manifestement inapproprié, en complément (pas en remplacement)
// du système de signalement existant qui reste la voie principale.
const MODERATE_JOB_SYSTEM_PROMPT = `Tu vérifies une annonce avant sa publication sur JobMarket Cameroon (petites annonces de services entre particuliers et artisans/prestataires : BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique).

Ton seul rôle : repérer un contenu CLAIREMENT et SANS AMBIGUÏTÉ inapproprié pour cette plateforme, à savoir :
- contenu à caractère sexuel ou suggestif,
- propos haineux, discriminatoires ou insultants envers un groupe ou une personne,
- menaces ou harcèlement,
- demande d'une activité clairement illégale (drogue, armes, faux documents, etc.),
- contenu qui n'a manifestement AUCUN rapport avec une demande de service (spam, publicité sans lien).

Tu n'es PAS un correcteur de qualité : une annonce mal écrite, vague, courte, ou juste étrange n'est PAS un motif de signalement. En cas de doute, ne signale RIEN — la grande majorité des annonces sont légitimes, et un faux signalement empêcherait injustement une personne de publier.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"flagged": false, "reason": ""}

flagged : true UNIQUEMENT si un des critères ci-dessus est manifeste, false sinon.
reason : si flagged est true, une phrase courte (max 20 mots) dans la même langue que l'annonce expliquant le motif ; sinon une chaîne vide.`;

// Langues supportées par l'app, utilisées pour rédiger le message de
// contact dans la langue de l'annonce (celle lue par son auteur, pas
// forcément celle de l'artisan qui contacte).
const LANG_NAMES = { fr: "français", en: "English", it: "italiano", de: "Deutsch", zh: "中文" };

// Construit une instruction de langue à ajouter à la fin d'un prompt système,
// à partir de `body.lang` (currentLang envoyé par le client, reflétant la
// langue actuellement choisie dans l'app). Plus fiable que de laisser le
// modèle deviner la langue depuis le texte fourni — notamment sur des
// entrées courtes ou ambiguës (ex: un titre de 2 mots, un prix seul).
// N'écrase rien si `lang` est absent ou non reconnu : le prompt garde alors
// sa consigne générique existante ("même langue que le texte fourni").
function languageInstruction(lang) {
  const name = lang && LANG_NAMES[lang];
  if (!name) return "";
  return `\n\nRéponds impérativement en ${name}, quelle que soit la langue du texte fourni ci-dessus — c'est la langue actuellement choisie par l'utilisateur dans l'application.`;
}

// Prompt (construit dynamiquement, voir buildCraftContactMessagePrompt) pour
// le bouton "contacter via WhatsApp" : au lieu d'un message-modèle générique
// ("Bonjour, je suis intéressé..."), l'IA rédige un premier message qui relie
// EXPLICITEMENT les compétences réelles de l'artisan au besoin décrit dans
// CETTE annonce précise — plus de chances d'obtenir une réponse. Ne doit
// jamais inventer une compétence ou expérience non fournie.
function buildCraftContactMessagePrompt(targetLangName) {
  return `Tu rédiges, au nom d'un artisan/prestataire, un premier message WhatsApp à envoyer au particulier qui a publié une demande de service sur JobMarket Cameroon (BTP, électricité, plomberie, ménage, jardinage, mécanique, informatique).

On te donne : le titre et la description de la demande du particulier, ainsi que le métier/spécialité, les compétences et la disponibilité déclarée de l'artisan qui contacte.

Rédige un message court (3 à 5 phrases), professionnel mais chaleureux, qui :
- se présente brièvement par son métier,
- explique concrètement en quoi ses compétences répondent AU BESOIN PRÉCIS décrit dans l'annonce (pas une présentation générique copiable sur n'importe quelle annonce),
- évoque NATURELLEMENT sa disponibilité si elle est connue (ex. « disponible cette semaine » — ne JAMAIS affirmer « disponible maintenant » si la donnée dit « cette semaine »),
- propose la suite (échanger sur les détails, un devis, un rendez-vous).

Règle absolue : n'invente JAMAIS une compétence, certification, ou expérience qui n'est pas dans les données fournies.

Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"message": "..."}

Le message doit être rédigé en ${targetLangName}.`;
}

// Prompt pour le résumé des avis d'un prestataire : évite d'obliger un
// visiteur à lire une dizaine de commentaires un par un pour se faire une
// idée. Doit rester fidèle et honnête — jamais inventer un consensus s'il
// n'y en a pas, jamais citer un commentaire mot pour mot (vie privée +
// évite la surreprésentation d'un avis isolé).
const SUMMARIZE_REVIEWS_SYSTEM_PROMPT = `Tu résumes des avis clients laissés sur un prestataire de services sur JobMarket Cameroon, à partir des commentaires fournis (un par ligne, sans les notes en étoiles).

Rédige un résumé court (une seule phrase, 25 mots maximum) reflétant fidèlement le ton général qui se dégage des commentaires : points positifs récurrents ET, s'il y en a, réserves ou critiques qui reviennent plusieurs fois. Reste factuel et neutre, sans superlatif non fondé ("le meilleur", "parfait"). Ne cite JAMAIS un commentaire mot pour mot et ne mentionne aucun nom.

Si les avis sont trop peu nombreux, trop courts, ou trop contradictoires pour dégager une tendance claire, dis-le simplement (ex: "Avis encore limités pour dégager une tendance claire") plutôt que d'inventer un consensus qui n'existe pas.

Réponds dans la langue indiquée. Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni balises markdown, au format exact :
{"summary": "..."}`;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}

// Extrait un objet JSON depuis la réponse texte du modèle, pour les modes
// SANS response_format json_schema (ex: si un jour on ajoute un mode texte
// libre). Nettoie les balises markdown (```json ... ```) que le modèle
// ajoute parfois malgré la consigne "réponds uniquement en JSON".
function extractJson(text) {
  const cleaned = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned);
}

// Normalise la réponse d'un mode JSON structuré (voir *_SCHEMA plus bas et
// response_format dans aiPayload) : quand response_format:json_schema est
// utilisé, Workers AI renvoie déjà un OBJET JS dans aiResult.response (pas
// une chaîne à parser) — voir la doc "JSON Mode" de Workers AI. On garde
// quand même un repli vers extractJson() par robustesse, au cas où le
// modèle renverrait malgré tout une chaîne (comportement observé variable
// selon les modèles/versions).
function parseAiReply(reply) {
  if (reply && typeof reply === "object") return reply;
  return extractJson(reply);
}

// Schémas JSON stricts imposés au modèle via response_format (voir doc
// Workers AI "JSON Mode"). Sans ça, un modèle open-weight comme Llama
// suit BEAUCOUP moins fidèlement une simple consigne textuelle "réponds
// en JSON" que ne le faisait Groq avec son response_format:json_object —
// c'était la cause des échecs sur les modes structurés (rewrite, optimize,
// suggest_price, etc.) alors que le chat simple fonctionnait déjà.
const REWRITE_SCHEMA = { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title", "description"] };
const OPTIMIZE_PROFILE_SCHEMA = { type: "object", properties: { jobTitle: { type: "string" }, skills: { type: "string" } }, required: ["jobTitle", "skills"] };
const SUGGEST_PRICE_SCHEMA = { type: "object", properties: { rangeLow: { type: "number" }, rangeHigh: { type: "number" }, note: { type: "string" } }, required: ["rangeLow", "rangeHigh", "note"] };
const SCAM_CHECK_SCHEMA = { type: "object", properties: { riskLevel: { type: "string", enum: ["low", "medium", "high"] }, note: { type: "string" } }, required: ["riskLevel", "note"] };
const SUGGEST_CATEGORY_SCHEMA = { type: "object", properties: { category: { type: "string", enum: ["btp", "electricite", "plomberie", "menage", "jardinage", "mecanique", "informatique"] }, confidence: { type: "string", enum: ["high", "medium", "low"] } }, required: ["category", "confidence"] };
const SEARCH_INTENT_SCHEMA = { type: "object", properties: { category: { type: "string", enum: ["btp", "electricite", "plomberie", "menage", "jardinage", "mecanique", "informatique", "none"] } }, required: ["category"] };
const MODERATE_JOB_SCHEMA = { type: "object", properties: { flagged: { type: "boolean" }, reason: { type: "string" } }, required: ["flagged", "reason"] };
const CRAFT_CONTACT_MESSAGE_SCHEMA = { type: "object", properties: { message: { type: "string" } }, required: ["message"] };
const SUMMARIZE_REVIEWS_SCHEMA = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
// Auto-réponse d'absence (20260905f) : quand un message arrive alors que
// l'artisan ne regarde pas l'app, le client propose une courte réponse dans
// sa voix, étiquetée « réponse automatique » dans la conversation.
// Sécurité : aucun prix, aucun engagement, aucun horaire précis — le profil
// de l'artisan et l'annonce liée fournissent le contexte.
const AWAY_REPLY_SCHEMA = { type: "object", properties: { message: { type: "string" } }, required: ["message"] };
function buildAwayReplyPrompt(targetLangName) {
  return `Tu rédiges une réponse automatique (absence) pour un artisan de JobMarket Cameroon.
Le client a envoyé un message alors que l'artisan est momentanément absent.
Règles STRICTES :
- Réponds en ${targetLangName}, à la 1re personne, comme si l'artisan lui-même écrivait (l'app étiquette déjà le message « réponse automatique »).
- 1 à 2 phrases courtes (max 280 caractères).
- Accuse la réception du message et dis que tu réponds très bientôt (quelques minutes).
- Tu peux mentionner ton métier si c'est pertinent ; JAMAIS de PRIX, JAMAIS d'horaire précis, JAMAIS d'engagement ferme.
- Ne parle jamais de ton absence technique, ni de l'application.
- Pas de longue question ; une seule question simple maximum si vraiment indispensable.`;
}
// Suggestions de réponse IA (20260905g) : l'artisan reçoit 1-2 réponses
// professionnelles prêtes à envoyer, dans sa voix. Le client (app.js) fournit
// les 6 derniers messages, le profil (métier/compétences/dispo) et l'annonce
// liée. Sécurité : aucun prix inventé (le prix de l'annonce liée peut être
// cité), aucun engagement ferme, max 200 caractères par suggestion.
const SUGGEST_REPLY_SCHEMA = { type: "object", properties: { suggestions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 2 } }, required: ["suggestions"] };
// Traduction de message (20260905k) : un client écrit dans SA langue, l'artisan
// reçoit dans LA SIENNE. Traduction fidèle (ton, précision), ni plus ni moins.
const TRANSLATE_SCHEMA = { type: "object", properties: { translation: { type: "string" } }, required: ["translation"] };
function buildTranslatePrompt(fromLang, toLang) {
  return `Traduis le message de ${fromLang} vers ${toLang}.
Règles STRICTES :
- Traduction fidèle : même information, même ton (courtois et naturel), ni plus ni moins.
- Conserve les noms, chiffres, prix et noms de quartier tels quels.
- Réponds UNIQUEMENT avec la traduction (pas de commentaire, pas de guillemets).`;
}

function buildSuggestReplyPrompt(targetLangName) {
  return `Tu aides un artisan de JobMarket Cameroon à rédiger une réponse rapide dans sa conversation in-app avec un client.
Contexte : les derniers messages de la conversation, le profil de l'artisan (métier, compétences, disponibilité) et éventuellement l'annonce liée.
Règles STRICTES pour chaque suggestion :
- Rédigée en ${targetLangName}, à la 1re personne, comme si l'artisan écrivait lui-même.
- 1 phrase (max 200 caractères), ton professionnel et chaleureux.
- Répond directement au dernier message du client (question, prix, disponibilité...).
- Tu peux citer le prix DE L'ANNONCE LIÉE s'il est fourni ; JAMAIS inventer de prix.
- Jamais d'engagement ferme (horaire exact, garantie) ; proposer de se caler rapidement.
- Les 2 suggestions doivent être DIFFÉRENTES (ex. une courte dispo + une avec un détail métier).`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    const isRewriteMode = body.mode === "rewrite_job";
    const isOptimizeProfileMode = body.mode === "optimize_profile";
    const isSuggestPriceMode = body.mode === "suggest_price";
    const isScamCheckMode = body.mode === "check_scam_signals";
    const isSuggestCategoryMode = body.mode === "suggest_category";
    const isSearchIntentMode = body.mode === "search_intent";
    const isModerateJobMode = body.mode === "moderate_job";
    const isCraftContactMessageMode = body.mode === "craft_contact_message";
    const isSummarizeReviewsMode = body.mode === "summarize_reviews";
    const isAwayReplyMode = body.mode === "ai_away_reply";
    const isSuggestReplyMode = body.mode === "suggest_reply";
    const isTranslateMode = body.mode === "translate_message";

    // Langue actuellement choisie dans l'app (currentLang côté client), si
    // reconnue — voir languageInstruction() plus haut.
    const requestLang = (typeof body.lang === "string" && LANG_NAMES[body.lang]) ? body.lang : null;

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!isRewriteMode && !isOptimizeProfileMode && !isSuggestPriceMode && !isScamCheckMode && !isSuggestCategoryMode && !isSearchIntentMode && !isModerateJobMode && !isCraftContactMessageMode && !isSummarizeReviewsMode && !isAwayReplyMode && !isSuggestReplyMode && !isTranslateMode && !messages.length) {
      return jsonResponse({ error: "No messages provided" }, 400);
    }
    if (isRewriteMode && !String(body.description || "").trim()) {
      return jsonResponse({ error: "No description provided" }, 400);
    }
    if (isOptimizeProfileMode && !String(body.skills || "").trim()) {
      return jsonResponse({ error: "No skills provided" }, 400);
    }
    if (isSuggestPriceMode && !String(body.title || "").trim() && !String(body.description || "").trim()) {
      return jsonResponse({ error: "No title or description provided" }, 400);
    }
    if (isScamCheckMode && !String(body.title || "").trim() && !String(body.description || "").trim()) {
      return jsonResponse({ error: "No title or description provided" }, 400);
    }
    if (isSuggestCategoryMode && !String(body.title || "").trim() && !String(body.description || "").trim()) {
      return jsonResponse({ error: "No title or description provided" }, 400);
    }
    if (isSearchIntentMode && !String(body.query || "").trim()) {
      return jsonResponse({ error: "No query provided" }, 400);
    }
    if (isModerateJobMode && !String(body.title || "").trim() && !String(body.description || "").trim()) {
      return jsonResponse({ error: "No title or description provided" }, 400);
    }
    if (isCraftContactMessageMode && !String(body.jobTitle || "").trim() && !String(body.jobDesc || "").trim()) {
      return jsonResponse({ error: "No job title or description provided" }, 400);
    }
    if (isSummarizeReviewsMode && (!Array.isArray(body.comments) || !body.comments.length)) {
      return jsonResponse({ error: "No comments provided" }, 400);
    }
    if (isAwayReplyMode && !String(body.incomingMessage || "").trim()) {
      return jsonResponse({ error: "No incoming message provided" }, 400);
    }
    if (isSuggestReplyMode && !(Array.isArray(body.lastMessages) && body.lastMessages.length)) {
      return jsonResponse({ error: "No lastMessages provided" }, 400);
    }
    if (isTranslateMode && !String(body.text || "").trim()) {
      return jsonResponse({ error: "No text provided" }, 400);
    }

    // Garde-fou contre un pic global inhabituel — voir SHARED_RPM_LIMIT.
    // Vérifié en premier puisqu'il protège tout le monde, y compris les IP
    // encore sous leur propre limite individuelle.
    if (env.AI_RATE_LIMIT_KV) {
      try {
        const minuteKey = `rpm-${new Date().toISOString().slice(0, 16)}`; // YYYY-MM-DDTHH:MM
        const rpmCount = parseInt((await env.AI_RATE_LIMIT_KV.get(minuteKey)) || "0", 10);
        if (rpmCount >= SHARED_RPM_LIMIT) {
          return jsonResponse({ fallback: true, reason: "shared-rate-limit-reached" }, 200);
        }
        await env.AI_RATE_LIMIT_KV.put(minuteKey, String(rpmCount + 1), { expirationTtl: 120 }); // 2 min, large marge
      } catch (err) {
        console.warn("Rate limit partagé indisponible, on continue sans limiter", err);
      }
    }

    // Protection par IP : voir IP_RATE_LIMIT_* plus haut. Vérifiée avant le
    // budget journalier partagé pour qu'une IP déjà bloquée ne consomme pas
    // ce budget commun à la place des autres utilisateurs.
    if (env.CHAT_BUDGET_KV) {
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const bucket = Math.floor(Date.now() / IP_RATE_LIMIT_WINDOW_MS);
        const ipKey = `ip-rate-${clientIp}-${bucket}`;
        const ipCount = parseInt((await env.CHAT_BUDGET_KV.get(ipKey)) || "0", 10);
        if (ipCount >= IP_RATE_LIMIT_MAX) {
          return jsonResponse({ fallback: true, reason: "rate-limited" }, 200);
        }
        await env.CHAT_BUDGET_KV.put(ipKey, String(ipCount + 1), { expirationTtl: 900 }); // 15 min, large marge sur la fenêtre de 10 min
      } catch (err) {
        console.warn("Rate limit IP indisponible, on continue sans limiter", err);
      }
    }

    // Budget journalier partagé, suivi via KV. Best-effort comme les
    // autres workers de cette app : si le KV est indisponible, on laisse
    // passer plutôt que de bloquer l'assistant pour une raison
    // d'infrastructure secondaire.
    if (env.CHAT_BUDGET_KV) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const key = `chat-count-${today}`;
        const current = parseInt((await env.CHAT_BUDGET_KV.get(key)) || "0", 10);
        if (current >= DAILY_BUDGET) {
          return jsonResponse({ fallback: true, reason: "daily-budget-reached" }, 200);
        }
        await env.CHAT_BUDGET_KV.put(key, String(current + 1), { expirationTtl: 172800 }); // 2 jours, large marge
      } catch (err) {
        console.warn("Budget KV indisponible, on continue sans limiter", err);
      }
    }

    // Ne garder que les 10 derniers échanges : suffisant pour le contexte
    // d'un chat de support, et ça borne le coût/latence de chaque appel.
    // (Non utilisé en mode réécriture, qui n'a pas d'historique.)
    const trimmedMessages = messages.slice(-10).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 2000)
    }));

    // Payload envoyé à env.AI.run() : juste { messages, temperature,
    // max_tokens }, pas de champ "model" (déjà passé en 1er argument de
    // run()) ni "response_format" (spécifique à l'API OpenAI/Groq — ici on
    // s'appuie sur l'instruction JSON dans chaque prompt système + le
    // nettoyage best-effort de extractJson()).
    const aiPayload = isRewriteMode
      ? {
          messages: [
            { role: "system", content: REWRITE_SYSTEM_PROMPT + languageInstruction(requestLang) },
            {
              role: "user",
              content: `Catégorie : ${String(body.category || "non précisée").slice(0, 50)}\nTitre : ${String(body.title || "").slice(0, 150)}\nDescription : ${String(body.description || "").slice(0, 2000)}`
            }
          ],
          temperature: 0.3,
          max_tokens: 300,
          response_format: { type: "json_schema", json_schema: REWRITE_SCHEMA }
        }
      : isOptimizeProfileMode
      ? {
          messages: [
            { role: "system", content: OPTIMIZE_PROFILE_SYSTEM_PROMPT + languageInstruction(requestLang) },
            {
              role: "user",
              content: `Métier/Spécialité : ${String(body.jobTitle || "non précisé").slice(0, 100)}\nCompétences : ${String(body.skills || "").slice(0, 1000)}`
            }
          ],
          temperature: 0.3,
          max_tokens: 300,
          response_format: { type: "json_schema", json_schema: OPTIMIZE_PROFILE_SCHEMA }
        }
      : isSuggestPriceMode
      ? {
          messages: [
            { role: "system", content: SUGGEST_PRICE_SYSTEM_PROMPT + languageInstruction(requestLang) },
            {
              role: "user",
              content: `Catégorie : ${String(body.category || "non précisée").slice(0, 50)}\nTitre : ${String(body.title || "").slice(0, 150)}\nDescription : ${String(body.description || "").slice(0, 2000)}`
            }
          ],
          temperature: 0.3,
          max_tokens: 200,
          response_format: { type: "json_schema", json_schema: SUGGEST_PRICE_SCHEMA }
        }
      : isScamCheckMode
      ? {
          messages: [
            { role: "system", content: SCAM_CHECK_SYSTEM_PROMPT + languageInstruction(requestLang) },
            {
              role: "user",
              content: `Titre : ${String(body.title || "").slice(0, 150)}\nPrix affiché : ${String(body.price || "non précisé").slice(0, 30)}\nDescription : ${String(body.description || "").slice(0, 2000)}`
            }
          ],
          temperature: 0.2,
          max_tokens: 200,
          response_format: { type: "json_schema", json_schema: SCAM_CHECK_SCHEMA }
        }
      : isSuggestCategoryMode
      ? {
          messages: [
            { role: "system", content: SUGGEST_CATEGORY_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Titre : ${String(body.title || "").slice(0, 150)}\nDescription : ${String(body.description || "").slice(0, 2000)}`
            }
          ],
          temperature: 0.2,
          max_tokens: 100,
          response_format: { type: "json_schema", json_schema: SUGGEST_CATEGORY_SCHEMA }
        }
      : isSearchIntentMode
      ? {
          messages: [
            { role: "system", content: SEARCH_INTENT_SYSTEM_PROMPT },
            { role: "user", content: `Recherche : ${String(body.query || "").slice(0, 200)}` }
          ],
          temperature: 0.2,
          max_tokens: 50,
          response_format: { type: "json_schema", json_schema: SEARCH_INTENT_SCHEMA }
        }
      : isModerateJobMode
      ? {
          messages: [
            { role: "system", content: MODERATE_JOB_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Titre : ${String(body.title || "").slice(0, 150)}\nDescription : ${String(body.description || "").slice(0, 2000)}\nExigences : ${String(body.requirements || "").slice(0, 800)}`
            }
          ],
          temperature: 0.1,
          max_tokens: 100,
          response_format: { type: "json_schema", json_schema: MODERATE_JOB_SCHEMA }
        }
      : isCraftContactMessageMode
      ? {
          messages: [
            {
              role: "system",
              content: buildCraftContactMessagePrompt(LANG_NAMES[body.lang] || "français")
            },
            {
              role: "user",
              content: `Titre de la demande : ${String(body.jobTitle || "").slice(0, 150)}\nDescription de la demande : ${String(body.jobDesc || "").slice(0, 1500)}\nMétier/spécialité de l'artisan : ${String(body.proTitle || "non précisé").slice(0, 100)}\nCompétences de l'artisan : ${String(body.proSkills || "non précisées").slice(0, 500)}\nDisponibilité déclarée de l'artisan : ${( { now: "disponible maintenant", week: "disponible cette semaine", busy: "occupé actuellement" } )[String(body.availability || "")] || "non précisée"}`
            }
          ],
          temperature: 0.4,
          max_tokens: 350,
          response_format: { type: "json_schema", json_schema: CRAFT_CONTACT_MESSAGE_SCHEMA }
        }
      : isSummarizeReviewsMode
      ? {
          messages: [
            { role: "system", content: SUMMARIZE_REVIEWS_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Langue de réponse : ${LANG_NAMES[body.lang] || "français"}\nCommentaires :\n${body.comments.slice(0, 20).map(c => String(c).slice(0, 300)).join("\n")}`
            }
          ],
          temperature: 0.3,
          max_tokens: 100,
          response_format: { type: "json_schema", json_schema: SUMMARIZE_REVIEWS_SCHEMA }
        }
      : isAwayReplyMode
      ? {
          messages: [
            {
              role: "system",
              content: buildAwayReplyPrompt(LANG_NAMES[body.lang] || "français")
            },
            {
              role: "user",
              content: `Derniers messages de la conversation :\n${(body.lastMessages || [String(body.incomingMessage || '')]).slice(-8).map(m => String(m).slice(0, 300)).join("\n")}\n${body.jobContext ? "Annonce ACTUELLE de la conversation (si le message en porte, réponds à CELLE-CI, pas à une autre) : " + String(body.jobContext).slice(0, 400) : ""}
${body.peerJobs && body.peerJobs.length ? "Autres annonces de l'artisan (contexte seulement) : " + body.peerJobs.slice(0, 5).join(" ; ").slice(0, 300) : ""}
${body.persona ? "Style et préférences de l'artisan (mémorisés depuis ses VRAIES conversations et ses confidences à l'assistant — imite SON ton, ses formules, sa longueur de message ; jamais un ton générique) : " + String(body.persona).slice(0, 900) : ""}`
            }
          ],
          temperature: 0.4,
          max_tokens: 200,
          response_format: { type: "json_schema", json_schema: AWAY_REPLY_SCHEMA }
        }
      : isSuggestReplyMode
      ? {
          messages: [
            {
              role: "system",
              content: buildSuggestReplyPrompt(LANG_NAMES[body.lang] || "français")
            },
            {
              role: "user",
              content: `Derniers messages de la conversation :\n${(body.lastMessages || []).slice(-8).map(m => String(m).slice(0, 300)).join("\n")}\nMétier de l'artisan : ${String(body.proTitle || "non précisé").slice(0, 100)}\nCompétences : ${String(body.proSkills || "non précisées").slice(0, 500)}\nDisponibilité déclarée : ${String(body.availability || "non précisée").slice(0, 40)}\n${body.jobContext ? "Annonce ACTUELLE de la conversation (réponds à CELLE-CI, pas à une autre) : " + String(body.jobContext).slice(0, 400) : ""}
${body.peerJobs && body.peerJobs.length ? "Autres annonces de l'artisan (contexte seulement) : " + body.peerJobs.slice(0, 5).join(" ; ").slice(0, 300) : ""}
${body.persona ? "Style et préférences de l'artisan (mémorisés depuis ses VRAIES conversations et ses confidences à l'assistant — imite SON ton, ses formules, sa longueur de message ; jamais un ton générique) : " + String(body.persona).slice(0, 900) : ""}`
            }
          ],
          temperature: 0.5,
          max_tokens: 250,
          response_format: { type: "json_schema", json_schema: SUGGEST_REPLY_SCHEMA }
        }
      : isTranslateMode
      ? {
          messages: [{ role: "system", content: buildTranslatePrompt(LANG_NAMES[body.from] || "français", LANG_NAMES[body.to] || "anglais") }, { role: "user", content: String(body.text).slice(0, 1000) }],
          temperature: 0.2,
          max_tokens: 500
        }
      : {
          messages: [{ role: "system", content: CHAT_SYSTEM_PROMPT + languageInstruction(requestLang) }, ...trimmedMessages],
          temperature: 0.4,
          max_tokens: 400
        };

    try {
      // env.AI.run() : pas de fetch manuel, pas de clé API, pas de gestion
      // de code HTTP — le binding lève une exception en cas d'erreur
      // (modèle indisponible, payload invalide, etc.), attrapée ci-dessous
      // par le catch englobant, comme pour toute autre panne du worker.
      const aiResult = await env.AI.run(AI_MODEL, aiPayload);
      const reply = aiResult && aiResult.response;

      if (!reply) {
        return jsonResponse({ fallback: true, reason: "empty-response" }, 200);
      }

      if (isRewriteMode) {
        try {
          const parsed = parseAiReply(reply);
          if (!parsed.title || !parsed.description) throw new Error("missing-fields");
          return jsonResponse({ title: parsed.title, description: parsed.description });
        } catch (parseErr) {
          console.error("Réponse de réécriture non-JSON", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isOptimizeProfileMode) {
        try {
          const parsed = parseAiReply(reply);
          if (!parsed.jobTitle || !parsed.skills) throw new Error("missing-fields");
          return jsonResponse({ jobTitle: parsed.jobTitle, skills: parsed.skills });
        } catch (parseErr) {
          console.error("Réponse d'optimisation de profil non-JSON", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isSuggestPriceMode) {
        try {
          const parsed = parseAiReply(reply);
          if (typeof parsed.rangeLow !== "number" || typeof parsed.rangeHigh !== "number" || !parsed.note) {
            throw new Error("missing-fields");
          }
          return jsonResponse({ rangeLow: parsed.rangeLow, rangeHigh: parsed.rangeHigh, note: parsed.note });
        } catch (parseErr) {
          console.error("Réponse de suggestion de prix non-JSON", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isScamCheckMode) {
        try {
          const parsed = parseAiReply(reply);
          const validLevels = ["low", "medium", "high"];
          if (!validLevels.includes(parsed.riskLevel) || !parsed.note) throw new Error("missing-fields");
          return jsonResponse({ riskLevel: parsed.riskLevel, note: parsed.note });
        } catch (parseErr) {
          console.error("Réponse d'analyse anti-arnaque non-JSON", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isSuggestCategoryMode) {
        try {
          const parsed = parseAiReply(reply);
          const validCategories = ["btp", "electricite", "plomberie", "menage", "jardinage", "mecanique", "informatique"];
          if (!validCategories.includes(parsed.category)) throw new Error("invalid-category");
          const confidence = ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium";
          return jsonResponse({ category: parsed.category, confidence });
        } catch (parseErr) {
          console.error("Réponse de suggestion de catégorie non-JSON ou invalide", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isSearchIntentMode) {
        try {
          const parsed = parseAiReply(reply);
          const validCategories = ["btp", "electricite", "plomberie", "menage", "jardinage", "mecanique", "informatique", "none"];
          if (!validCategories.includes(parsed.category)) throw new Error("invalid-category");
          return jsonResponse({ category: parsed.category });
        } catch (parseErr) {
          console.error("Réponse de recherche intelligente non-JSON ou invalide", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isModerateJobMode) {
        try {
          const parsed = parseAiReply(reply);
          if (typeof parsed.flagged !== "boolean") throw new Error("missing-fields");
          return jsonResponse({ flagged: parsed.flagged, reason: parsed.flagged ? String(parsed.reason || "") : "" });
        } catch (parseErr) {
          console.error("Réponse de modération non-JSON ou invalide", reply);
          // Fail-open : en cas de doute technique, on NE bloque JAMAIS une
          // publication légitime — le système de signalement reste le
          // filet de sécurité principal après coup.
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isCraftContactMessageMode) {
        try {
          const parsed = parseAiReply(reply);
          if (typeof parsed.message !== "string" || !parsed.message.trim()) throw new Error("missing-fields");
          return jsonResponse({ message: parsed.message });
        } catch (parseErr) {
          console.error("Réponse de message de contact non-JSON ou invalide", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }
      if (isSuggestReplyMode) {
        try {
          const parsed = parseAiReply(reply);
          if (!Array.isArray(parsed.suggestions) || !parsed.suggestions.length) throw new Error("missing-fields");
          return jsonResponse({
            suggestions: parsed.suggestions
              .map(s => String(s).trim().slice(0, 200))
              .filter(Boolean)
              .slice(0, 2)
          });
        } catch (parseErr) {
          console.error("Suggestions de réponse non-JSON ou invalides", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isTranslateMode) {
        try {
          let tr = String(reply).trim();
          const parsed = parseAiReply(reply);
          if (parsed && typeof parsed.translation === "string" && parsed.translation.trim()) tr = parsed.translation.trim();
          tr = tr.replace(/^["'`]/, "").replace(/["'"]$/, "").trim();
          if (!tr) throw new Error("empty-translation");
          return jsonResponse({ translation: tr.slice(0, 1000) });
        } catch (parseErr) {
          console.error("Traduction invalide", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }
      if (isAwayReplyMode) {
        try {
          const parsed = parseAiReply(reply);
          if (typeof parsed.message !== "string" || !parsed.message.trim()) throw new Error("missing-fields");
          return jsonResponse({ message: parsed.message.trim().slice(0, 500) });
        } catch (parseErr) {
          console.error("Réponse d'absence non-JSON ou invalide", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      if (isSummarizeReviewsMode) {
        try {
          const parsed = parseAiReply(reply);
          if (typeof parsed.summary !== "string" || !parsed.summary.trim()) throw new Error("missing-fields");
          return jsonResponse({ summary: parsed.summary });
        } catch (parseErr) {
          console.error("Réponse de résumé d'avis non-JSON ou invalide", reply);
          return jsonResponse({ fallback: true, reason: "parse-error" }, 200);
        }
      }

      return jsonResponse({ reply });
    } catch (err) {
      console.error("Erreur worker chat-proxy (Workers AI)", err);
      return jsonResponse({ fallback: true, reason: "worker-error" }, 200);
    }
  }
};
