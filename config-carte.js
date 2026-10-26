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
      (Vérifiez les tarifs ACTUELS de « Map Tiles API – 2D Tiles » : un quota
       gratuit mensuel existe, puis c'est payant au volume. Chaque ouverture
       de la carte charge plusieurs dizaines de tuiles.)
      FIXEZ UN QUOTA JOURNALIER : API et services → Map Tiles API → Quotas.
      Quand il est atteint, l'application bascule toute seule sur la carte
      Esri, sans frais.
   3. « API et services » → Bibliothèque → chercher « Map Tiles API »
      → ACTIVER
   4. « API et services » → Identifiants → Créer une clé API → copier
   5. RESTREINDRE LA CLÉ (indispensable, elle est publique) :
      • Restrictions relatives aux applications → Sites Web
        → ajouter : ghislaintankat-cyber.github.io/*
        → ajouter aussi : localhost/*   (sinon l'application Android
          n'aura pas la carte Google : son adresse interne est localhost)
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
