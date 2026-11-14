/* ═══════════════════════════════════════════════════════════════════════════
   itineraire.js — LE MOTEUR D'ITINÉRAIRE DE JOBMARKET (vague 20261030c)

   POURQUOI CE FICHIER EXISTE SÉPARÉMENT
   ---------------------------------------------------------------------------
   Deux raisons, toutes deux mesurées.

   1. LE POIDS. Le module pèse 2,6 Ko compressés. Ajouté à app.js, il faisait
      franchir le garde-fou de 232 Ko (mesuré : 233,2). Or il ne sert QUE si
      l'utilisateur demande un itinéraire — c'est-à-dire rarement, et jamais
      au démarrage. La règle du projet est explicite : une fonctionnalité
      volumineuse se charge à la demande (comme routes.js et lieux-osm.js),
      jamais dans le premier écran.

   2. LA DÉPENDANCE RETIRÉE. Avant, ce travail était fait par
      leaflet-routing-machine, chargée depuis unpkg.com : 200 Ko de JavaScript
      plus une feuille de style, pour n'afficher au bout du compte qu'une ligne
      et deux nombres. On interroge maintenant directement le serveur de
      routage public (le même que celui qu'utilisait la bibliothèque) et on
      dessine nous-mêmes le tracé et les étapes.

   Mesures du 9/11 sur Yaoundé (3.848, 11.502 → 3.866, 11.517) :
     voiture  4,2 km   6 min   199 points, 8 étapes, rues nommées
     vélo     5,6 km  24 min
     à pied   5,5 km  73 min
   Trois modes réels : proposer « 6 min en voiture » quand le trajet est de
   73 minutes à pied n'est pas une information, c'est une erreur.

   Chargé par drawRoute() dans app.js (voir jmcAssurerItineraire).
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   (20261030c) L'ITINÉRAIRE COMME GOOGLE — SANS CDN, AVEC LES ÉTAPES

   Ce qui existait : `leaflet-routing-machine`, chargée depuis unpkg.com au
   premier clic (200 Ko de JavaScript + une feuille de style), pour n'afficher
   au bout du compte qu'une ligne et deux nombres — « 4,2 km » / « 6 min ». Le
   guidage, c'est-à-dire l'essentiel, n'était pas affiché.

   Ce qui change : on interroge directement le serveur de routage, en une seule
   requête, et on dessine nous-mêmes. Mesures du 9/11 sur Yaoundé
   (3.848, 11.502 → 3.866, 11.517) :

     voiture  4,2 km   6 min     199 points de tracé, 8 étapes, rues nommées
     vélo     5,6 km  24 min
     à pied   5,5 km  73 min

   Trois gains, tous mesurables :
     1. **200 Ko de moins** : plus aucune bibliothèque tierce n'est chargée.
        Le serveur de routage est le MÊME que celui qu'utilisait la
        bibliothèque (router.project-osrm.org) ; on supprime l'intermédiaire.
     2. **Les étapes** : « Tournez à droite sur Rue 3.054, puis 593 m ». C'est
        ce qui fait la différence entre une ligne et un itinéraire.
     3. **Trois modes** : voiture, vélo, à pied. Au Cameroun, beaucoup
        d'artisans marchent et ne peuvent pas payer un taxi — proposer
        « 6 min en voiture » quand le trajet réel est de 73 minutes à pied
        n'est pas une information, c'est une erreur.

   Le repli à vol d'oiseau de la vague 20261030a est conservé : si le serveur
   ne répond pas, l'écran n'est jamais vide et dit franchement ce qu'il montre.
   ═══════════════════════════════════════════════════════════════════════════ */

const JMC_ITIN_MODES = {
  voiture: {
    url: "https://routing.openstreetmap.de/routed-car/route/v1/car/",
    emoji: "🚗", fr: "Voiture", en: "Car"
  },
  velo: {
    url: "https://routing.openstreetmap.de/routed-bike/route/v1/bike/",
    emoji: "🚲", fr: "Vélo", en: "Bike"
  },
  pied: {
    url: "https://routing.openstreetmap.de/routed-foot/route/v1/foot/",
    emoji: "🚶", fr: "À pied", en: "Walk"
  }
};

let jmcItinMode = "voiture";
try {
  const m = localStorage.getItem("jmc_itin_mode");
  if (m && JMC_ITIN_MODES[m]) jmcItinMode = m;
} catch (e) {}

/* Le tracé et le drapeau d'arrivée sont à nous : plus de « control » tiers. */
let jmcItinCalque = null, jmcItinArrivee = null, jmcItinEnCours = null;
let jmcItinDernier = null;      /* { lat, lng } pour rejouer au changement de mode */
/* (20261030e) progression du guidage : les étapes OSRM et l'étape actuellement
   attendue. L'index ne peut qu'avancer, jamais reculer (le GPS dérive). */
let jmcItinEtapesRoute = [];
let jmcItinEtapeIndex = 0;
let jmcItinDernierePosition = null;

function jmcItineraireNettoyer() {
  try {
    if (jmcItinCalque) { map.removeLayer(jmcItinCalque); jmcItinCalque = null; }
    if (jmcItinArrivee) { map.removeLayer(jmcItinArrivee); jmcItinArrivee = null; }
  } catch (e) {}
  return true;
}

/* Traduction d'une étape OSRM en une phrase qu'on peut lire en marchant. */
function jmcEtapeTexte(etape) {
  const fr = jmcEnFrancais();
  const m = (etape && etape.maneuver) || {};
  const type = String(m.type || "");
  const mod = String(m.modifier || "");
  const nom = String(etape && etape.name || "").trim();
  const ou = nom ? (fr ? " sur " : " onto ") + nom : "";

  let dire;
  if ("depart" === type) dire = fr ? "Partez" : "Start";
  else if ("arrive" === type) dire = fr ? "Vous êtes arrivé" : "You have arrived";
  else if ("roundabout" === type || "rotary" === type) {
    const sortie = Number(m.exit);
    dire = fr
      ? ("Au rond-point" + (sortie >= 1 ? ", prenez la " + sortie + "e sortie" : ""))
      : ("At the roundabout" + (sortie >= 1 ? ", take exit " + sortie : ""));
  } else if ("uturn" === type) dire = fr ? "Faites demi-tour" : "Make a U-turn";
  else if ("merge" === type) dire = fr ? "Insérez-vous" : "Merge";
  else if ("fork" === type) dire = /left|gauche/.test(mod)
    ? (fr ? "Restez à gauche" : "Keep left")
    : (fr ? "Restez à droite" : "Keep right");
  else if ("end of road" === type) dire = /left|gauche/.test(mod)
    ? (fr ? "Au bout de la rue, à gauche" : "At the end, turn left")
    : (fr ? "Au bout de la rue, à droite" : "At the end, turn right");
  else if ("new name" === type || "continue" === type || "straight" === type) {
    dire = fr ? "Continuez tout droit" : "Continue straight";
    /* « new name » = la rue change de nom, on ne tourne pas : le nom seul
       suffit, et c'est plus court à lire. */
    if ("new name" === type && nom) return (fr ? "Continuez" : "Continue") + ou;
  } else if (/left|gauche/.test(mod)) {
    dire = /slight/.test(mod)
      ? (fr ? "Serrez à gauche" : "Slight left")
      : /sharp/.test(mod) ? (fr ? "Tournez fort à gauche" : "Sharp left")
      : (fr ? "Tournez à gauche" : "Turn left");
  } else if (/right|droite/.test(mod)) {
    dire = /slight/.test(mod)
      ? (fr ? "Serrez à droite" : "Slight right")
      : /sharp/.test(mod) ? (fr ? "Tournez fort à droite" : "Sharp right")
      : (fr ? "Tournez à droite" : "Turn right");
  } else {
    dire = fr ? "Continuez" : "Continue";
  }
  return dire + (("arrive" === type || "depart" === type) ? "" : ou);
}

function jmcEtapeIcone(etape) {
  const m = (etape && etape.maneuver) || {};
  const type = String(m.type || ""), mod = String(m.modifier || "");
  if ("arrive" === type) return "⚑";
  if ("depart" === type) return "●";
  if ("roundabout" === type || "rotary" === type) return "↻";
  if ("uturn" === type) return "↺";
  if ("merge" === type || "fork" === type) return "⤴";
  if (/left|gauche/.test(mod)) return "↰";
  if (/right|droite/.test(mod)) return "↱";
  return "↑";
}

/* « 593 m » / « 1,3 km » — jamais « 0,0 km ». */
function jmcEtapeDistance(metres) {
  const d = Number(metres) || 0;
  if (d < 950) return Math.round(d / 10) * 10 + " m";
  return (d / 1000).toFixed(d < 9500 ? 1 : 0).replace(".", ",") + " km";
}

function jmcItineraireAfficher(route, mode, destination) {
  try {
    const fr = jmcEnFrancais();
    const panel = document.getElementById("itinPanel");
    if (!panel) return false;

    const dist = (Number(route.distance) || 0) / 1000;
    const minutes = Math.max(1, Math.round((Number(route.duration) || 0) / 60));
    const etapes = ((route.legs && route.legs[0] && route.legs[0].steps) || []).slice(0, 40);

    /* Le panneau : les trois modes, puis le chiffre, puis les étapes. */
    const modes = Object.keys(JMC_ITIN_MODES).map(function (cle) {
      const M = JMC_ITIN_MODES[cle];
      const actif = cle === mode;
      return '<button type="button" class="jmc-itin-mode' + (actif ? " jmc-actif" : "") + '"'
        + ' onclick="jmcItinModeChanger(\'' + cle + '\')" aria-pressed="' + (actif ? "true" : "false") + '">'
        + '<span aria-hidden="true">' + M.emoji + "</span>"
        + "<span>" + (fr ? M.fr : M.en) + "</span></button>";
    }).join("");

    const lignes = etapes.map(function (e, i) {
      const dernier = i === etapes.length - 1;
      return '<div class="jmc-itin-etape' + (dernier ? " jmc-itin-fin" : "") + '" data-jmc-etape="' + i + '">'
        + '<span class="jmc-itin-ico" aria-hidden="true">' + jmcEtapeIcone(e) + "</span>"
        + '<span class="jmc-itin-txt">' + jmcEtapeTexte(e) + "</span>"
        + '<span class="jmc-itin-dist">' + jmcEtapeDistance(e.distance) + "</span>"
        + "</div>";
    }).join("");

    panel.innerHTML =
      '<div class="jmc-itin-tete">'
      + '<span class="itin-label">' + (fr ? "Itinéraire" : "Route")
      + (destination ? " · " + String(destination).replace(/[<>&"]/g, "").slice(0, 28) : "") + "</span>"
      + '<button type="button" class="jmc-itin-x" onclick="jmcItinReduire()" aria-label="'
      + (fr ? "Fermer" : "Close") + '">✕</button></div>'
      + '<div class="jmc-itin-modes">' + modes + "</div>"
      + '<div class="itin-value" id="itinDist">' + jmcDistanceTexte(dist) + "</div>"
      + '<div class="itin-sub" id="itinTime">' + (fr
        ? "environ " + minutes + " min · " + (fr ? JMC_ITIN_MODES[mode].fr.toLowerCase() : mode)
        : "about " + minutes + " min · " + JMC_ITIN_MODES[mode].en.toLowerCase()) + "</div>"
      + '<div class="jmc-itin-prochain" id="jmcItinProchain">'
      + '<span class="jmc-itin-prochain-titre">' + (fr ? "PROCHAINE MANŒUVRE" : "NEXT TURN") + "</span>"
      + '<span class="jmc-itin-prochain-ligne"><span class="jmc-itin-prochain-ico" id="jmcItinProchainIco">↑</span>'
      + '<span class="jmc-itin-prochain-texte" id="jmcItinProchainTexte">' + (fr ? "Préparation du guidage…" : "Preparing guidance…") + "</span></span>"
      + '<span class="jmc-itin-prochain-dist" id="jmcItinProchainDist"></span></div>'
      + (lignes ? '<div class="jmc-itin-etapes">' + lignes + "</div>" : "")
      + '<button type="button" class="jmc-itin-annuler" onclick="clearRoute()">'
      + (fr ? "Annuler" : "Cancel") + "</button>";

    panel.classList.remove("hidden", "jmc-itin-reduit");
    try { jmcItinBouton(); } catch (e) {}
    /* (20261030e) préparer le guidage sans attendre la prochaine mesure GPS. */
    jmcItinProgressionInitialiser(route);
    return true;
  } catch (e) { return false; }
}

/* Distance GPS → prochain point de manœuvre (Haversine, en mètres). */
function jmcItinDistanceMetres(lat1, lon1, lat2, lon2) {
  const r = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function jmcItinProchainIndex(steps) {
  for (let i = 0; i < steps.length; i++) {
    const type = String((steps[i].maneuver || {}).type || "");
    if ("depart" !== type) return i;
  }
  return Math.max(0, steps.length - 1);
}

/* Initialiser le panneau à la première manœuvre après le départ. */
function jmcItinProgressionInitialiser(route) {
  try {
    jmcItinEtapesRoute = ((route.legs || [])[0] || {}).steps || [];
    jmcItinEtapeIndex = jmcItinProchainIndex(jmcItinEtapesRoute);
    jmcItinDernierePosition = null;
    /* Dès le calcul, utiliser la position GPS déjà connue pour donner une vraie
       distance jusqu'au prochain virage, pas la longueur brute de l'étape. */
    let position = null;
    try { position = window.userCoords; } catch (e) {}
    if (position && isFinite(position.lat) && isFinite(position.lng)) jmcItinProgressTick(position);
    else jmcItinProgressionPeindre(undefined);
    return jmcItinEtapesRoute.length;
  } catch (e) { jmcItinEtapesRoute = []; return 0; }
}

/* Met à jour UNIQUEMENT les petits éléments du panneau (pas son innerHTML :
   sinon le défilement des étapes sauterait à chaque mesure GPS). */
function jmcItinProgressionPeindre(distanceM) {
  try {
    const panel = document.getElementById("itinPanel");
    if (!panel || panel.classList.contains("hidden")) return true;
    const etapes = jmcItinEtapesRoute;
    const active = etapes[jmcItinEtapeIndex];
    const texte = document.getElementById("jmcItinProchainTexte");
    const icone = document.getElementById("jmcItinProchainIco");
    const dist = document.getElementById("jmcItinProchainDist");
    if (!active) {
      if (texte) texte.textContent = jmcEnFrancais() ? "Itinéraire terminé" : "Route completed";
      if (icone) icone.textContent = "⚑";
      if (dist) dist.textContent = "";
    } else {
      if (texte) texte.textContent = jmcEtapeTexte(active);
      if (icone) icone.textContent = jmcEtapeIcone(active);
      if (dist) dist.textContent = null !== distanceM && void 0 !== distanceM && isFinite(distanceM)
        ? jmcEtapeDistance(Math.max(0, distanceM))
        : jmcEtapeDistance(active.distance);
    }
    const rows = panel.querySelectorAll(".jmc-itin-etape[data-jmc-etape]");
    for (let i = 0; i < rows.length; i++) {
      const k = Number(rows[i].getAttribute("data-jmc-etape"));
      rows[i].classList.toggle("jmc-itin-passee", k < jmcItinEtapeIndex);
      rows[i].classList.toggle("jmc-itin-active", k === jmcItinEtapeIndex);
    }
    return true;
  } catch (e) { return false; }
}

/* Appelée à chaque mesure GPS. La prochaine manœuvre passe en tête quand
   l'utilisateur s'en approche. Hystérésis : l'index ne recule JAMAIS si le GPS
   dérive de quelques mètres. Le seuil s'adapte à la précision, entre 25 et 65 m. */
function jmcItinProgressTick(coords) {
  try {
    if (!jmcItinEtapesRoute.length || !coords || !isFinite(coords.lat) || !isFinite(coords.lng)) return false;
    /* (20261112c) Le suivi continue même si le panneau est réduit : sinon l'index
       de manœuvre gèle et, à la réouverture, le guidage repart d'un virage déjà
       passé. Seul « Annuler » (qui vide jmcItinEtapesRoute) arrête le suivi. */
    const panel = document.getElementById("itinPanel");
    jmcItinDernierePosition = { lat: Number(coords.lat), lng: Number(coords.lng) };
    let active = jmcItinEtapesRoute[jmcItinEtapeIndex];
    let location = active && active.maneuver && active.maneuver.location;
    let distance = location && location.length >= 2
      ? jmcItinDistanceMetres(coords.lat, coords.lng, Number(location[1]), Number(location[0]))
      : (active ? Number(active.distance) || 0 : 0);
    const precision = Number(coords.accuracy || (typeof jmcPrecisionMetres !== "undefined" && jmcPrecisionMetres) || 0);
    const seuil = Math.max(25, Math.min(65, precision * 0.65));
    let garde = 0;
    while (active && "arrive" !== String((active.maneuver || {}).type || "")
        && distance <= seuil && jmcItinEtapeIndex < jmcItinEtapesRoute.length - 1 && garde++ < 5) {
      jmcItinEtapeIndex++;
      active = jmcItinEtapesRoute[jmcItinEtapeIndex];
      location = active && active.maneuver && active.maneuver.location;
      distance = location && location.length >= 2
        ? jmcItinDistanceMetres(coords.lat, coords.lng, Number(location[1]), Number(location[0]))
        : (active ? Number(active.distance) || 0 : 0);
    }
    jmcItinProgressionPeindre(distance);
    return { index: jmcItinEtapeIndex, distance: distance, seuil: seuil };
  } catch (e) { return false; }
}

/* ─── Réduire / rouvrir le panneau d'itinéraire ───────────────────────────
   La croix RÉDUIT le panneau : le tracé reste sur la carte.
   Le bouton flottant le rouvre. « Annuler » (clearRoute) efface tout. */

/* Petit bandeau dans le panneau : « mémorisé il y a X ». Prend la place du
   bloc « prochaine manœuvre », qui n'a aucun sens sur un trajet enregistré. */
function jmcItinBandeauMemorise(at) {
  try {
    const panel = document.getElementById("itinPanel");
    if (!panel) return false;
    const cible = document.getElementById("jmcItinProchain");
    if (!cible) return false;
    const fr = jmcEnFrancais();
    const b = cible.querySelector(".jmc-itin-memo");
    const texte = (fr ? "Itinéraire mémorisé " : "Saved route ") + jmcItinAge(at);
    if (b) { b.textContent = texte; return true; }
    const el = document.createElement("div");
    el.className = "jmc-itin-memo";
    el.textContent = texte;
    cible.appendChild(el);
    return true;
  } catch (e) { return false; }
}

function jmcItinReduire() {
  try {
    const panel = document.getElementById("itinPanel");
    if (!panel) return false;
    panel.classList.add("hidden", "jmc-itin-reduit");
    jmcItinBouton();
    return true;
  } catch (e) { return false; }
}

/* Remet le panneau en place, sans recalculer l'itinéraire. */
/* Appelée aussi par clearRoute() (app.js) pour que « Annuler » retire le bouton. */
function jmcItinReductionOublier() {
  try {
    const panel = document.getElementById("itinPanel");
    if (panel) panel.classList.remove("jmc-itin-reduit");
    const b = document.getElementById("jmcItinRouvrir");
    if (b && b.parentNode) b.parentNode.removeChild(b);
    return true;
  } catch (e) { return false; }
}

function jmcItinRouvrir() {
  try {
    const panel = document.getElementById("itinPanel");
    if (!panel) return false;
    panel.classList.remove("hidden", "jmc-itin-reduit");
    jmcItinBouton();
    return true;
  } catch (e) { return false; }
}

/* Le bouton flottant n'existe QUE pendant un itinéraire réduit. */
function jmcItinBouton() {
  try {
    const panel = document.getElementById("itinPanel");
    const reduit = !!(panel && panel.classList.contains("jmc-itin-reduit"));
    let b = document.getElementById("jmcItinRouvrir");
    if (!reduit) {
      if (b && b.parentNode) b.parentNode.removeChild(b);
      return false;
    }
    if (b) return true;
    const fr = jmcEnFrancais();
    b = document.createElement("button");
    b.id = "jmcItinRouvrir";
    b.type = "button";
    b.setAttribute("onclick", "jmcItinRouvrir()");
    b.setAttribute("aria-label", fr ? "Revoir l'itinéraire" : "Show route");
    b.innerHTML = '<span aria-hidden="true">🧭</span><span>' + (fr ? "Itinéraire" : "Route") + "</span>";
    document.body.appendChild(b);
    return true;
  } catch (e) { return false; }
}

function jmcItineraireDessiner(route) {
  try {
    jmcItineraireNettoyer();
    const coords = (route.geometry && route.geometry.coordinates) || [];
    if (coords.length < 2) return false;
    /* GeoJSON = [lon, lat] ; Leaflet veut [lat, lon]. */
    const points = coords.map(function (c) { return [Number(c[1]), Number(c[0])]; });

    jmcItinCalque = L.layerGroup();
    /* Liseré blanc DESSOUS, trait bleu dessus : sur une photo satellite, un
       trait bleu seul se perd dans les toits gris. */
    L.polyline(points, {
      color: "#FFFFFF", weight: 9, opacity: 0.92, lineJoin: "round", lineCap: "round", interactive: false
    }).addTo(jmcItinCalque);
    L.polyline(points, {
      color: "#1A73E8", weight: 5, opacity: 1, lineJoin: "round", lineCap: "round", interactive: false
    }).addTo(jmcItinCalque);
    jmcItinCalque.addTo(map);

    const fin = points[points.length - 1];
    jmcItinArrivee = L.marker(fin, {
      icon: L.divIcon({
        className: "jmc-itin-drapeau",
        html: '<div class="jmc-itin-drapeau-in" aria-hidden="true">🏁</div>',
        iconSize: [22, 22], iconAnchor: [11, 11]
      }),
      interactive: false, keyboard: false, zIndexOffset: 1500
    }).addTo(map);

    try {
      map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [30, 120], paddingBottomRight: [30, 260], maxZoom: 17 });
    } catch (e) {}
    return true;
  } catch (e) { return false; }
}

/* Lit la réponse OSRM. Renvoie la route, ou null avec la raison. */
function jmcItineraireLire(donnees) {
  try {
    if (!donnees || "Ok" !== donnees.code || !donnees.routes || !donnees.routes.length) {
      return { route: null, raison: (donnees && donnees.code) || "reponse-vide" };
    }
    return { route: donnees.routes[0], raison: "" };
  } catch (e) { return { route: null, raison: "illisible" }; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   (20261113a) ITINÉRAIRES CONSULTABLES HORS LIGNE

   Pourquoi un cache « maison » et pas celui du service worker : dans l'APK le
   service worker tourne en mode `pushOnly` — il n'installe AUCUN cache et
   n'intercepte AUCUNE requête (c'est volontaire, pour ne jamais resservir un
   fichier périmé). Il ne peut donc rien garder pour nous.

   On garde la dernière réponse OSRM par destination et par mode dans
   localStorage. Le calcul en ligne reste prioritaire : si le réseau répond,
   c'est SA réponse qui s'affiche, jamais celle du cache. Le cache ne sert que
   lorsque le serveur est injoignable.
   ─────────────────────────────────────────────────────────────────────────── */

/* Préfixe volontairement distinct de "jmc_itin_", qui est déjà utilisé par le
   réglage jmc_itin_mode : avec un préfixe commun, l'élagage supprimait le
   réglage de l'utilisateur. */
const JMC_ITIN_CACHE_PREFIXE = "jmc_itincache_";
const JMC_ITIN_CACHE_MAX = 5;

function jmcItinCleCache(lat, lon, mode) {
  /* Le mode est un mot ("pied", "velo", "voiture") : le convertir en nombre
     donnait NaN et faisait partager la même entrée aux trois modes. */
  const m = String(mode || "voiture").replace(/[^a-z]/gi, "") || "voiture";
  /* ~11 m de précision : deux points à quelques mètres près réutilisent la
     même entrée, et on ne stocke pas 50 clés pour un même carrefour. */
  return JMC_ITIN_CACHE_PREFIXE + m
    + "_" + Number(lat).toFixed(4) + "_" + Number(lon).toFixed(4);
}

function jmcItinCacheLire(lat, lon, mode) {
  try {
    const cle = jmcItinCleCache(lat, lon, mode);
    const brut = localStorage.getItem(cle);
    if (!brut) return null;
    const e = JSON.parse(brut);
    if (!e || !e.routes || !e.routes.length) return null;
    return { routes: e.routes, at: Number(e.at) || 0 };
  } catch (e) { return null; }
}

function jmcItinCacheEcrire(lat, lon, mode, routes) {
  try {
    if (!routes || !routes.length) return false;
    const cle = jmcItinCleCache(lat, lon, mode);
    const donnees = JSON.stringify({ routes: routes, at: Date.now() });
    /* Si le quota refuse, on purge nos propres entrées puis on réessaie une
       fois. Si ça refuse encore, on abandonne sans bruit : un itinéraire qui
       n'a pas pu être mémorisé ne doit pas faire échouer l'affichage. */
    try {
      localStorage.setItem(cle, donnees);
    } catch (e1) {
      try {
        jmcItinCacheElaguer(0);
        localStorage.setItem(cle, donnees);
      } catch (e2) { return false; }
    }
    jmcItinCacheElaguer(JMC_ITIN_CACHE_MAX);
    return true;
  } catch (e) { return false; }
}

/* Ne garde que les N entrées les plus récentes, et seulement les nôtres. */
function jmcItinCacheElaguer(max) {
  try {
    const entrees = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(JMC_ITIN_CACHE_PREFIXE) !== 0) continue;
      let at = 0;
      try { at = Number(JSON.parse(localStorage.getItem(k)).at) || 0; } catch (e) {}
      entrees.push({ k: k, at: at });
    }
    entrees.sort(function (a, b) { return b.at - a.at; });
    for (let i = max; i < entrees.length; i++) {
      try { localStorage.removeItem(entrees[i].k); } catch (e) {}
    }
    return entrees.length;
  } catch (e) { return 0; }
}

/* « il y a 3 h », « il y a 2 j » — court et honnête. */
function jmcItinAge(at) {
  const fr = jmcEnFrancais();
  const s = Math.max(0, Math.round((Date.now() - Number(at || 0)) / 1000));
  if (s < 120) return fr ? "à l'instant" : "just now";
  const m = Math.round(s / 60);
  if (m < 60) return (fr ? "il y a " : "") + m + (fr ? " min" : " min ago");
  const h = Math.round(m / 60);
  if (h < 24) return (fr ? "il y a " : "") + h + (fr ? " h" : " h ago");
  const j = Math.round(h / 24);
  return (fr ? "il y a " : "") + j + (fr ? " j" : " d ago");
}

async function jmcItineraire(versLat, versLng, destination) {
  const fr = jmcEnFrancais();
  const dire = function (txt, type) { try { showToast(txt, type || "info"); } catch (e) {} };
  const la = Number(versLat), lo = Number(versLng);
  if (!isFinite(la) || !isFinite(lo)) return false;
  if (!userCoords || !isFinite(userCoords.lat)) {
    dire(fr ? "Activez votre position pour calculer un itinéraire." : "Turn on your location to get directions.", "error");
    return false;
  }
  jmcItinDernier = { lat: la, lng: lo, nom: destination || "" };
  const mode = JMC_ITIN_MODES[jmcItinMode] ? jmcItinMode : "voiture";
  const M = JMC_ITIN_MODES[mode];
  const url = M.url + userCoords.lng + "," + userCoords.lat + ";" + lo + "," + la
    + "?overview=full&geometries=geojson&steps=true";

  try { jmcEffacerVoldOiseau(); } catch (e) {}
  const panel = document.getElementById("itinPanel");
  if (panel) {
    panel.classList.remove("hidden");
    const d = document.getElementById("itinDist");
    const t = document.getElementById("itinTime");
    if (d) d.textContent = "--";
    if (t) t.textContent = fr ? "Calcul en cours…" : "Calculating…";
  }

  let donnees = null;
  try {
    const controleur = new AbortController();
    const minuterie = setTimeout(function () { try { controleur.abort(); } catch (e) {} }, 15000);
    /* jmcFetchIA route les POST par le pont natif dans l'APK ; ici c'est un GET,
       et le serveur de routage autorise explicitement toutes les origines
       (`access-control-allow-origin: *`, mesuré). Un `fetch` simple suffit donc,
       y compris dans la WebView. */
    const reponse = await jmcFetchIA(url, { signal: controleur.signal });
    clearTimeout(minuterie);
    if (reponse && reponse.ok) donnees = await reponse.json();
  } catch (e) { donnees = null; }

  let lecture = jmcItineraireLire(donnees);
  let depuisCache = false;

  /* ── Repli : un itinéraire déjà calculé pour cette destination ──────────── */
  if (!lecture.route) {
    const garde = jmcItinCacheLire(la, lo, mode);
    if (garde) {
      const relu = jmcItineraireLire({ code: "Ok", routes: garde.routes });
      if (relu.route) {
        lecture = relu;
        depuisCache = true;
        if (panel) panel.classList.remove("hidden");
        dire(fr
          ? "Hors ligne : itinéraire mémorisé (" + jmcItinAge(garde.at) + ")."
          : "Offline: saved route (" + jmcItinAge(garde.at) + ").", "info");
      }
    }
  }

  if (!lecture.route) {
    /* Écran jamais vide : on montre la direction à vol d'oiseau, franchement. */
    let secours = false;
    try { secours = jmcTraceVoldOiseau(la, lo); } catch (e) {}
    if (secours) {
      dire(fr ? "Serveur d'itinéraire muet : direction à vol d'oiseau affichée."
        : "Routing server silent: showing the straight-line direction.", "info");
    } else {
      if (panel) panel.classList.add("hidden");
      dire(fr ? "Itinéraire indisponible pour le moment." : "Directions unavailable right now.", "error");
    }
    return false;
  }

  /* Succès réseau : on mémorise pour la prochaine fois hors ligne.
     ATTENTION : lecture.route est DÉJÀ la route (routes[0]), pas la réponse
     OSRM entière. Chercher lecture.route.routes ne trouvait rien et le cache
     restait vide. */
  try {
    if (lecture.route && lecture.route.geometry) {
      jmcItinCacheEcrire(la, lo, mode, [lecture.route]);
    }
  } catch (e) {}

  const dessine = jmcItineraireDessiner(lecture.route);
  jmcItineraireAfficher(lecture.route, mode, destination);
  if (depuisCache) {
    try {
      const age = jmcItinCacheLire(la, lo, mode);
      jmcItinBandeauMemorise(age ? age.at : Date.now());
    } catch (e) {}
  }
  if (!dessine) {
    try { jmcTraceVoldOiseau(la, lo); } catch (e) {}
  }
  return true;
}

/* Changer de mode recalcule le MÊME trajet avec l'autre profil. */
async function jmcItinModeChanger(mode) {
  if (!JMC_ITIN_MODES[mode] || mode === jmcItinMode) return false;
  jmcItinMode = mode;
  try { localStorage.setItem("jmc_itin_mode", mode); } catch (e) {}
  if (!jmcItinDernier) return false;
  return jmcItineraire(jmcItinDernier.lat, jmcItinDernier.lng, jmcItinDernier.nom);
}

/* ─────────── exposition (les boutons HTML en ont besoin) ─────────── */
try {
  window.jmcItineraire = jmcItineraire;
  window.jmcItinModeChanger = jmcItinModeChanger;
  window.jmcItineraireNettoyer = jmcItineraireNettoyer;
  window.jmcEtapeTexte = jmcEtapeTexte;
  window.jmcEtapeIcone = jmcEtapeIcone;
  window.jmcEtapeDistance = jmcEtapeDistance;
  window.jmcItineraireAfficher = jmcItineraireAfficher;
  window.jmcItinReduire = jmcItinReduire;
  window.jmcItinCacheLire = jmcItinCacheLire;
  window.jmcItinCacheEcrire = jmcItinCacheEcrire;
  window.jmcItinCacheElaguer = jmcItinCacheElaguer;
  window.jmcItinRouvrir = jmcItinRouvrir;
  window.jmcItinReductionOublier = jmcItinReductionOublier;
  window.jmcItineraireLire = jmcItineraireLire;
  window.jmcItinProgressionInitialiser = jmcItinProgressionInitialiser;
  window.jmcItinProgressTick = jmcItinProgressTick;
  window.jmcItinProgressionPeindre = jmcItinProgressionPeindre;
  window.jmcItinDistanceMetres = jmcItinDistanceMetres;
  window.jmcItinMode = function () { return jmcItinMode; };
} catch (e) {}
