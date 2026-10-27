/* ═══════════════════════════════════════════════════════════════════════════
   config-carte.js — LA CLÉ QUI ACTIVE LA CARTE GOOGLE
   -----------------------------------------------------------------------------
   C'EST LE SEUL FICHIER À MODIFIER. Colle ta clé entre les guillemets
   ci-dessous, dépose le fichier sur GitHub, et la carte devient EXACTEMENT
   celle de Google Maps : imagerie satellite, noms de rues, noms de quartiers
   et icônes des lieux.

   Sans clé : l'application garde la carte actuelle (Esri + noms
   d'OpenStreetMap). Rien ne casse, rien ne manque — c'est simplement moins
   détaillé.

   ─────────────────────────────────────────────────────────────────────────
   COMMENT OBTENIR LA CLÉ (5 minutes, Google l'offre)
   ─────────────────────────────────────────────────────────────────────────
   1. console.cloud.google.com → créer un projet (nom : JobMarket)
   2. « Facturation » → ajouter un moyen de paiement
      (Google offre 200 $ par mois ; 100 000 tuiles gratuites — de quoi
       couvrir très largement JobMarket. Utilisation normale : 0 F.)
   3. « API et services » → Bibliothèque → chercher « Map Tiles API »
      → ACTIVER
   4. « API et services » → Identifiants → Créer une clé API → copier
   5. RESTREINDRE LA CLÉ (indispensable, elle est publique) :
      • Restrictions relatives aux applications → Sites Web
        → ajouter : ghislaintankat-cyber.github.io/*
      • Restrictions relatives aux API → Map Tiles API uniquement
   6. Coller la clé ci-dessous, entre les guillemets.

   ─────────────────────────────────────────────────────────────────────────
   POURQUOI CETTE CLÉ N'EST PAS UN SECRET
   ─────────────────────────────────────────────────────────────────────────
   Une clé de carte est visible par nature : elle voyage dans le navigateur.
   Ce qui la protège, c'est la RESTRICTION par site web (point 5) : même si
   quelqu'un la copie, elle ne fonctionnera que sur ton adresse.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ↓↓↓  COLLE TA CLÉ ICI, ENTRE LES GUILLEMETS  ↓↓↓ */
window.JMC_GOOGLE_KEY = "";

/* Rien d'autre à modifier. */
