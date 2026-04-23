// 🔥 CONFIGURATION FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// 👑 IDENTIFIANTS ADMIN
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";
let currentUser = null;

// 🗺️ INITIALISATION CARTE SATELLITE
let map = L.map("map", { zoomControl: false, tap: false }).setView([3.848, 11.502], 13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}',{ subdomains:['mt0','mt1','mt2','mt3'] }).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;

// 🛡️ AUTHENTIFICATION ET SÉCURITÉ
auth.signInAnonymously();

auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
        // 🚨 VÉRIFICATION DU BANISSEMENT
        db.ref("banned_users/" + user.uid).on("value", snap => {
            if (snap.exists()) {
                document.body.innerHTML = `
                    <div style="background:#800000; color:white; height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:20px; font-family:sans-serif;">
                        <h1 style="font-size:60px; margin:0;">🚨</h1>
                        <h1>COMPTE SUSPENDU</h1>
                        <p>Votre accès a été révoqué pour violation des règles ou signalements d'arnaques.</p>
                    </div>`;
            }
        });

        // Activation du bouton Admin
        if (isAdmin()) {
            document.getElementById("adminBtn").classList.remove("hidden");
        }
    }
});

function isAdmin() {
    return currentUser && currentUser.uid === ADMIN_UID;
}

// ⏳ AJOUT DE JOB AVEC ANTI-SPAM
window.addJob = () => {
    if (!currentUser) return alert("Veuillez patienter, connexion en cours...");

    // Anti-Spam: Limite à 1 post toutes les 2 minutes (120000 ms)
    let lastPostTime = localStorage.getItem('lastPostTime') || 0;
    let timeDiff = Date.now() - lastPostTime;
    if (timeDiff < 120000) {
        let secondsLeft = Math.ceil((120000 - timeDiff) / 1000);
        return alert(`🚨 Anti-Spam : Veuillez patienter ${secondsLeft} secondes avant de publier.`);
    }

    const title = document.getElementById('title').value;
    const price = document.getElementById('price').value;
    const phone = document.getElementById('phone').value;
    const desc = document.getElementById('desc').value;
    const cat = document.getElementById('category').value.split('|');

    if (!title || !price || !phone) return alert("Remplissez les champs obligatoires.");

    navigator.geolocation.getCurrentPosition(pos => {
        let ref = db.ref("jobs").push();
        ref.set({
            id: ref.key,
            title, price, phone, desc,
            icon: cat, color: cat,
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            user: currentUser.uid,
            ratingAvg: 5.0, ratingCount: 1, timestamp: Date.now()
        }).then(() => {
            localStorage.setItem('lastPostTime', Date.now()); // Enregistre l'heure du succès
            toggleForm();
            alert("Mission publiée avec succès !");
            document.getElementById('title').value = ''; // Reset form
        }).catch(() => alert("Erreur : Impossible de publier."));
    }, () => alert("Activez votre GPS pour publier."));
};

// 📍 CHARGEMENT ET AFFICHAGE DES JOBS
function loadJobs() {
    db.ref("jobs").on("value", snap => {
        jobsLayer.clearLayers();
        if (!snap.exists()) return;

        snap.forEach(child => {
            const j = child.val();
            if (j.lat && j.lng) {
                const dist = userCoords ? getDistance(userCoords.lat, userCoords.lng, j.lat, j.lng).toFixed(1) : "?";
                const customIcon = L.divIcon({
                    html: `
                        <div class="job-marker-container">
                            <div class="marker-icon-circle" style="background:${j.color}">${j.icon}</div>
                            <div class="marker-info">
                                <p class="marker-title">${j.title}</p>
                                <div class="marker-stats"><span style="color:#FFD700">⭐ ${j.ratingAvg}</span> <span style="color:#888;">• ${dist} km</span></div>
                            </div>
                        </div>`,
                    className: '', iconSize:, iconAnchor:
                });

                L.marker([j.lat, j.lng], { icon: customIcon })
                 .on('click', () => focusJob(j.lat, j.lng))
                 .addTo(jobsLayer);
            }
        });
        updateJobsList();
    });
}

// 📋 LISTE TRIÉE PAR PROXIMITÉ
function updateJobsList() {
    const list = document.getElementById('listContent');
    list.innerHTML = "";
    
    db.ref("jobs").once("value", snap => {
        let jobsArray = [];
        snap.forEach(d => {
            let j = d.val();
            let dist = userCoords ? getDistance(userCoords.lat, userCoords.lng, j.lat, j.lng) : 999;
            jobsArray.push({ ...j, dist });
        });

        jobsArray.sort((a, b) => a.dist - b.dist);

        jobsArray.forEach(j => {
            list.innerHTML += `
                <div style="background:#1a1a1a; padding:15px; border-radius:15px; margin-bottom:12px; border-left: 5px solid ${j.color};">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h4 style="margin:0;">${j.icon} ${j.title}</h4>
                        <span style="color:var(--primary); font-weight:bold; font-size:12px;">${j.dist.toFixed(1)} km</span>
                    </div>
                    <p style="color:#2ecc71; font-weight:bold; margin:8px 0;">${j.price}</p>
                    <div style="display:flex; gap:10px; margin-top:10px">
                        <a href="https://wa.me/${j.phone}" style="background:#25D366; color:white; padding:10px; text-decoration:none; border-radius:8px; font-weight:bold; text-align:center; flex:1;">WhatsApp</a>
                        <button onclick="focusJob(${j.lat}, ${j.lng})" style="background:#4facfe; color:white; padding:10px; border:none; border-radius:8px; font-weight:bold; cursor:pointer; flex:1;">Voir sur carte</button>
                    </div>
                </div>`;
        });
    });
}

// 🛠️ FONCTIONS ADMIN (Gérer et Bannir)
window.openAdmin = () => document.getElementById("adminPanel").classList.remove("hidden");
window.closeAdmin = () => document.getElementById("adminPanel").classList.add("hidden");

window.loadAdminJobs = () => {
    const c = document.getElementById("adminContent");
    c.innerHTML = "<p>Chargement...</p>";
    db.ref("jobs").once("value", snap => {
        c.innerHTML = "<h3>📦 Jobs Actifs</h3>";
        snap.forEach(d => {
            let j = d.val();
            c.innerHTML += `
            <div style="background:#222; padding:10px; margin-bottom:10px; border-radius:8px; display:flex; justify-content:space-between;">
                <span>${j.title} (${j.price})</span>
                <button onclick="deleteJob('${j.id}')" style="background:#ff4757; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer;">❌</button>
            </div>`;
        });
    });
};

window.deleteJob = (id) => {
    if(confirm("Supprimer ce job ?")) db.ref("jobs/" + id).remove().then(() => loadAdminJobs());
};

window.loadUsers = () => {
    const c = document.getElementById("adminContent");
    let users = {};
    db.ref("jobs").once("value", snap => {
        snap.forEach(d => { if(d.val().user) users[d.val().user] = true; });
        c.innerHTML = "<h3>👤 Utilisateurs Actifs</h3>";
        Object.keys(users).forEach(uid => {
            let btn = (uid !== ADMIN_UID) 
                ? `<button onclick="banUser('${uid}')" style="background:#ff4757; color:white; padding:8px; border:none; border-radius:5px; cursor:pointer;">🔨 Bannir</button>` 
                : `<span style="color:yellow;">👑 Admin</span>`;
            c.innerHTML += `
            <div style="background:#222; padding:15px; margin-bottom:10px; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:12px; color:#888;">ID: ${uid.substring(0,8)}...</span>
                ${btn}
            </div>`;
        });
    });
};

window.banUser = (uid) => {
    if(confirm("🚨 VOULEZ-VOUS VRAIMENT BANNIR CET UTILISATEUR ? (Action irréversible)")) {
        db.ref("banned_users/" + uid).set(true).then(() => {
            alert("✅ Utilisateur banni. Il ne peut plus rien publier ou voir.");
            loadUsers();
        });
    }
};

// ⚙️ UTILITAIRES GPS ET UI
function locateMe() {
    navigator.geolocation.getCurrentPosition(pos => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        L.circleMarker([userCoords.lat, userCoords.lng], { radius: 8, color: '#fff', fillColor: '#00f2fe', fillOpacity: 1 }).addTo(map);
        map.flyTo([userCoords.lat, userCoords.lng], 14);
        loadJobs();
    }, () => loadJobs()); // Si refus, charge quand même les jobs
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const a = Math.sin((lat2-lat1)*Math.PI/360)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin((lon2-lon1)*Math.PI/360)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

window.showMap = () => { document.getElementById('jobsList').classList.add("hidden"); document.getElementById('formBox').classList.add("hidden"); map.invalidateSize(); };
window.showList = () => { document.getElementById('jobsList').classList.remove("hidden"); document.getElementById('formBox').classList.add("hidden"); updateJobsList(); };
window.toggleForm = () => { document.getElementById('formBox').classList.toggle("hidden"); };
window.focusJob = (lat, lng) => { showMap(); map.flyTo([lat, lng], 16, {duration: 1.5}); };

// DÉMARRAGE
locateMe();
