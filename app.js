// CONFIGURATION FIREBASE EXACTE
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.firebasestorage.app",
  messagingSenderId: "351669024349",
  appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4",
  measurementId: "G-89ZNJZX2W3"
};

// Initialisation (Version Compat pour maintenir la stabilité de ton code)
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// GESTION DE LA NAVIGATION
function showScreen(screenName) {
  // Cacher tous les écrans
  document.querySelectorAll('.screen').forEach(el => el.classList.add("hidden"));
  
  // Afficher le bon écran
  const activeScreen = document.getElementById(screenName + 'Screen');
  if(activeScreen) activeScreen.classList.remove("hidden");

  // 🔥 LE VRAI FIX POUR LA CARTE GRISE 🔥
  if(screenName === "map") {
    requestAnimationFrame(() => {
      map.invalidateSize();
    });
  }
}

// INITIALISATION CARTE LEAFLET
let map = L.map('map', {
  center: [3.8, 11.5], // Yaoundé par défaut
  zoom: 6,
  zoomControl: false
});

L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

let userLat, userLng;
let routeLine;

// GPS UTILISATEUR
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
  }, err => console.log("Erreur GPS", err), { enableHighAccuracy: true });
}

// CHARGEMENT DES JOBS
db.ref("jobs").on("value", snap => {
  let data = snap.val();
  const jobsContainer = document.getElementById("jobsScreen");
  jobsContainer.innerHTML = "";

  // Nettoyer les anciens marqueurs de la carte (sauf la route)
  map.eachLayer(layer => {
    if (layer instanceof L.CircleMarker) map.removeLayer(layer);
  });

  if (!data) {
    jobsContainer.innerHTML = "<p>Aucune annonce pour le moment.</p>";
    return;
  }

  Object.entries(data).forEach(([id, job]) => {
    // 1. Ajouter à la liste
    jobsContainer.innerHTML += `
      <div class="job">
        <h3 style="margin-top:0;">${job.title}</h3>
        <p style="color: #666; font-size: 14px;">${job.desc || "Pas de description"}</p>
        <b style="color: #28a745;">${job.price || "À négocier"} FCFA</b><br><br>
        <button onclick="contact('${job.phone}','${job.title}')" class="btn-primary">Contacter via WhatsApp</button>
      </div>
    `;

    // 2. Ajouter sur la carte
    if (job.lat && job.lng) {
      let marker = L.circleMarker([job.lat, job.lng], {
        color: "#FFD700",
        fillColor: "#FFA500",
        fillOpacity: 0.8,
        radius: 8
      }).addTo(map);

      marker.bindPopup(`
        <b style="font-size:16px;">${job.title}</b><br>
        ${job.desc || ""}<br>
        <b style="color:green;">💰 ${job.price || "À discuter"}</b><br><br>
        <div style="display:flex; gap:5px;">
          <button onclick="route(${job.lat},${job.lng})" style="padding:8px; border-radius:5px; border:1px solid #ccc;">Itinéraire</button>
          <button onclick="contact('${job.phone}','${job.title}')" style="background:#25D366; color:white; padding:8px; border:none; border-radius:5px;">WhatsApp</button>
        </div>
      `);
    }
  });
});

// PUBLIER UN JOB
function addJob() {
  let title = document.getElementById("title").value;
  let desc = document.getElementById("desc").value;
  let price = document.getElementById("price").value;
  let phone = document.getElementById("phone").value;

  if (!title || !phone) return alert("Le titre et le téléphone sont obligatoires !");

  if (!userLat || !userLng) {
    alert("Veuillez activer votre GPS pour publier.");
    return;
  }

  db.ref("jobs").push({
    title, desc, price, phone,
    lat: userLat,
    lng: userLng,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  }).then(() => {
    alert("Annonce publiée avec succès !");
    toggleForm();
    // Vider le formulaire
    document.getElementById("title").value = "";
    document.getElementById("desc").value = "";
    document.getElementById("price").value = "";
    document.getElementById("phone").value = "";
  });
}

// AFFICHER/CACHER LE FORMULAIRE
function toggleForm() {
  document.getElementById("jobForm").classList.toggle("hidden");
}

// CONTACTER VIA WHATSAPP
function contact(phone, title) {
  if (!phone) return alert("Pas de numéro fourni.");
  let formattedPhone = phone.replace(/\s+/g, '');
  window.open(`https://wa.me/${formattedPhone}?text=Bonjour, je viens de JobMarket et je suis intéressé par : ${title}`);
}

// CALCUL DE L'ITINÉRAIRE (OSRM)
async function route(lat, lng) {
  if (!userLat || !userLng) return alert("Votre position GPS est introuvable.");

  if (routeLine) map.removeLayer(routeLine);

  let url = `https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${lng},${lat}?overview=full&geometries=geojson`;

  try {
    let res = await fetch(url);
    let data = await res.json();

    if(data.routes && data.routes.length > 0) {
      let coords = data.routes.geometry.coordinates.map(c => [c, c]);
      routeLine = L.polyline(coords, {color: "blue", weight: 5}).addTo(map);
      map.fitBounds(routeLine.getBounds());

      let dist = data.routes.distance / 1000;
      document.getElementById("distance").innerText = dist.toFixed(1);

      if('speechSynthesis' in window) {
        let msg = new SpeechSynthesisUtterance(`Distance estimée : ${dist.toFixed(1)} kilomètres`);
        msg.lang = 'fr-FR';
        window.speechSynthesis.speak(msg);
      }
    }
  } catch (e) {
    alert("Erreur de calcul de l'itinéraire.");
  }
}

// AUTHENTIFICATION
function getVal(id) { return document.getElementById(id).value; }

function register() {
  auth.createUserWithEmailAndPassword(getVal("email"), getVal("password"))
    .then(() => alert("Compte créé !"))
    .catch(err => alert(err.message));
}

function login() {
  auth.signInWithEmailAndPassword(getVal("email"), getVal("password"))
    .then(() => alert("Connecté !"))
    .catch(err => alert(err.message));
}

function googleLogin() {
  let provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider)
    .then(() => alert("Connecté avec Google !"))
    .catch(err => alert(err.message));
}

// PROFIL
function saveProfile() {
  let user = auth.currentUser;
  if (!user) return alert("Veuillez vous connecter d'abord.");

  db.ref("users/" + user.uid).set({
    pseudo: getVal("pseudo"),
    cv: getVal("cv"),
    mode: getVal("mode")
  }).then(() => alert("Profil mis à jour !"));
}

// BUSINESS (MOCK)
function boostJob() {
  alert("Le système de paiement pour booster votre annonce sera bientôt disponible !");
}

// Lancer l'application sur l'écran "Jobs" par défaut
showScreen('jobs');
