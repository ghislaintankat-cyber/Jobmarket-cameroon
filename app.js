// 🔥 CONFIGURATION FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database(), auth = firebase.auth();

// 🗺️ INITIALISATION CARTE (On affiche la carte tout de suite)
let map = L.map("map", { zoomControl: false, tap: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{ 
    subdomains:['mt0','mt1','mt2','mt3'],
    attribution: '© Google Maps'
}).addTo(map);

// Couche dédiée aux jobs (pour pouvoir les rafraîchir proprement)
let jobsLayer = L.featureGroup().addTo(map);
let userMarker, userCoords = null;

// --- 🛡️ FONCTION CORE : CHARGEMENT DES JOBS ---
function loadJobsDirectly() {
    console.log("Démarrage du flux de données...");
    
    // .on('value') : Écoute en temps réel. Si un job est ajouté, il apparaît SANS recharger.
    db.ref("jobs").on("value", snap => {
        jobsLayer.clearLayers(); // On nettoie l'ancienne vue
        
        if (!snap.exists()) return console.log("Base de données vide.");

        snap.forEach(child => {
            const j = child.val();
            if (j.lat && j.lng) {
                // Création du marqueur avec le prix visible
                const customIcon = L.divIcon({
                    html: `
                        <div class="custom-marker" style="border-color: ${j.color || '#00f2fe'}">
                            <span class="marker-icon">${j.icon || '💼'}</span>
                            <span class="marker-price">${j.price}</span>
                        </div>
                    `,
                    className: '',
                    iconSize:,
                    iconAnchor:
                });

                const m = L.marker([j.lat, j.lng], { icon: customIcon });
                m.bindPopup(`<b>${j.title}</b><br><button onclick="showList()">Détails</button>`);
                jobsLayer.addLayer(m);
            }
        });
        console.log("Marqueurs mis à jour sur la carte.");
    });
}

// --- 🎯 GESTION DU GPS (En parallèle) ---
function locateMe() {
    navigator.geolocation.getCurrentPosition(pos => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker([userCoords.lat, userCoords.lng], { 
            radius: 10, color: '#fff', weight: 3, fillColor: '#00f2fe', fillOpacity: 1 
        }).addTo(map);

        // On centre la carte une seule fois au début
        map.flyTo([userCoords.lat, userCoords.lng], 14);
        
        // On met à jour la liste pour le tri par proximité
        updateJobsList(); 
    }, (err) => {
        console.warn("GPS non disponible, on reste sur la vue par défaut.");
    }, { enableHighAccuracy: true });
}

// --- 🏁 LANCEMENT GÉNÉRAL ---
// 1. On charge les jobs tout de suite (Priorité n°1)
loadJobsDirectly();

// 2. On cherche l'utilisateur (Priorité n°2)
locateMe();

// --- AUTRES FONCTIONS (Gardées du code précédent) ---
window.showMap = () => { hideAll(); document.getElementById('map').style.display="block"; map.invalidateSize(); };
window.showList = () => { hideAll(); document.getElementById('jobsList').classList.remove("hidden"); updateJobsList(); };
window.showAccount = () => { hideAll(); document.getElementById('accountBox').classList.remove("hidden"); };
window.toggleForm = () => document.getElementById('formBox').classList.toggle("hidden");
function hideAll() { ['jobsList','accountBox','formBox'].forEach(id => document.getElementById(id).classList.add("hidden")); }
