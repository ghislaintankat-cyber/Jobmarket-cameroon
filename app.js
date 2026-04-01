import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Variables utilisateur
let userLat = null;
let userLng = null;
let userMarker;
let accuracyCircle;

// Initialisation de la carte
const map = L.map('map', { zoomControl: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Fonction Mathématique Pro : Formule de Haversine pour la distance
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return (R * c).toFixed(1); 
}

// 📍 GESTION DU POINT BLEU EN TEMPS RÉEL
navigator.geolocation.watchPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;

    if (userMarker) map.removeLayer(userMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);

    userMarker = L.circleMarker([userLat, userLng], {
        radius: 8, color: "white", weight: 2, fillColor: "#2563eb", fillOpacity: 1
    }).addTo(map);

    accuracyCircle = L.circle([userLat, userLng], {
        radius: accuracy, color: "#3b82f6", fillOpacity: 0.15, weight: 1
    }).addTo(map);

}, err => console.error("GPS Error", err), { enableHighAccuracy: true });

// 📥 CHARGEMENT DES JOBS ET GÉNÉRATION DES CARTES PREMIUM
onValue(ref(db, 'jobs'), snapshot => {
    const data = snapshot.val();
    if (!data) return;

    // Nettoyage (on garde l'utilisateur)
    map.eachLayer((layer) => {
        if (layer instanceof L.Marker && layer !== userMarker) map.removeLayer(layer);
    });

    Object.entries(data).forEach(([id, job]) => {
        if (job.lat && job.lng) {
            const marker = L.marker([job.lat, job.lng]).addTo(map);
            
            // Calcul distance
            let distBadge = "";
            if (userLat && userLng) {
                const distKm = getDistance(userLat, userLng, job.lat, job.lng);
                distBadge = `<div class="job-card-distance">${distKm} km</div>`;
            }

            // Génération de la carte HTML Premium
            const cardHTML = `
                <div class="job-card">
                    <div class="job-card-header">
                        <h4 class="job-card-title">${job.title}</h4>
                        ${distBadge}
                    </div>
                    <div class="job-card-desc">${job.description}</div>
                    
                    <div class="action-grid">
                        <a href="https://wa.me/237${job.phone}" target="_blank" class="btn-wa">💬 WhatsApp</a>
                        <a href="tel:+237${job.phone}" class="btn-call">📞 Appeler</a>
                        <button class="btn-boost" onclick="boost('${id}')">💎 Booster (500 FCFA)</button>
                    </div>
                </div>
            `;
            marker.bindPopup(cardHTML);
        }
    });
});

// 📤 PUBLIER UN JOB
window.createJob = () => {
    const title = document.getElementById("title").value;
    const desc = document.getElementById("desc").value;
    const phone = document.getElementById("phone").value;

    if (!title || !desc || !phone) {
        alert("Veuillez remplir tous les champs !");
        return;
    }

    navigator.geolocation.getCurrentPosition(pos => {
        push(ref(db, 'jobs'), {
            title, desc, phone,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            date: Date.now()
        });
        alert("✅ Offre d'emploi publiée !");
        document.getElementById("title").value = "";
        document.getElementById("desc").value = "";
        document.getElementById("phone").value = "";
    }, err => alert("Activez votre GPS."));
};

// 💰 PAIEMENT RENDER
window.boost = async (jobId) => {
    const backendURL = "https://jobmarket-backend-6gqm.onrender.com/pay";
    try {
        const res = await fetch(backendURL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: jobId, amount: 500, email: "paiement@jobmarket.cm" })
        });
        const data = await res.json();
        if (data.status === "success") window.location.href = data.data.link;
    } catch (error) {
        alert("Le serveur se réveille, réessayez dans quelques secondes.");
    }
};
