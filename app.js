// =============================== // JOBMARKET CAMEROON PRO MAX FINAL APP.JS // ===============================

const firebaseConfig = { apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE", authDomain: "jobmarketfuture.firebaseapp.com", databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com", projectId: "jobmarketfuture", storageBucket: "jobmarketfuture.appspot.com", messagingSenderId: "123456789", appId: "1:123456789:web:jobmarketcameroon" };

firebase.initializeApp(firebaseConfig);

const db = firebase.database(); const auth = firebase.auth();

const CLOUDINARY_CLOUD_NAME = "dvoab3mzb"; const CLOUDINARY_UPLOAD_PRESET = "job_preset"; const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

let userCoords = null; let routeControl = null; let allJobs = []; let currentUser = null; let userMarker = null; let accuracyCircle = null; let watchId = null;

// =============================== // MAP // =============================== const map = L.map('map', { zoomControl: false, maxZoom: 20 }).setView([3.848, 11.502], 13);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20 }).addTo(map);

const jobsLayer = L.featureGroup().addTo(map);

// =============================== // AUTH // =============================== auth.onAuthStateChanged(user => { if (user) { currentUser = user; updateAccountUI(user); } });

auth.signInAnonymously().catch(console.error);

function signupEmail() { auth.createUserWithEmailAndPassword(email.value, password.value) .then(res => { alert(Bienvenue dans JobMarket Cameroon, ${res.user.email}); }) .catch(err => alert(err.message)); }

function loginEmail() { auth.signInWithEmailAndPassword(email.value, password.value) .then(res => { alert(Bienvenue de retour sur JobMarket Cameroon, ${res.user.email}); }) .catch(err => alert(err.message)); }

function loginGoogle() { const provider = new firebase.auth.GoogleAuthProvider(); auth.signInWithPopup(provider) .then(res => { alert(Bienvenue dans JobMarket Cameroon, ${res.user.displayName}); }) .catch(err => alert(err.message)); }

function logout() { auth.signOut(); alert("Déconnexion réussie"); }

function updateAccountUI(user) { const avatar = document.getElementById("userAvatar"); if (!avatar) return;

const name = user.displayName || user.email || "User";
const initials = name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
avatar.innerHTML = initials;

}

// =============================== // GPS PREMIUM // =============================== function locateMe() { if (!navigator.geolocation) { alert("GPS non supporté"); return; }

navigator.geolocation.getCurrentPosition(position => {
    updateUserLocation(position);

    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(updateUserLocation, console.error, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
    });

    syncJobs();
}, err => {
    alert("Impossible d'obtenir votre position exacte");
    syncJobs();
}, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
});

}

function updateUserLocation(position) { userCoords = { lat: position.coords.latitude, lng: position.coords.longitude };

if (userMarker) map.removeLayer(userMarker);
if (accuracyCircle) map.removeLayer(accuracyCircle);

accuracyCircle = L.circle([userCoords.lat, userCoords.lng], {
    radius: position.coords.accuracy,
    color: '#007AFF',
    fillColor: '#007AFF',
    fillOpacity: 0.15
}).addTo(map);

userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
    radius: 10,
    color: '#ffffff',
    weight: 3,
    fillColor: '#007AFF',
    fillOpacity: 1
}).addTo(map);

map.flyTo([userCoords.lat, userCoords.lng], map.getZoom(), {
    animate: true,
    duration: 1.5
});

}

// =============================== // JOBS // =============================== function syncJobs() { db.ref('jobs').on('value', snapshot => { allJobs = [];

snapshot.forEach(child => {
        const job = child.val();
        const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, job.lat, job.lng) : 999;
        allJobs.push({
            ...job,
            id: child.key,
            dist
        });
    });

    allJobs.sort((a, b) => a.dist - b.dist);
    renderJobs(allJobs);
});

}

function renderJobs(jobs) { jobsLayer.clearLayers();

jobs.forEach(job => {
    const markerIcon = L.divIcon({
        className: '',
        html: `
            <div style="
                width:26px;
                height:26px;
                border-radius:50%;
                background: radial-gradient(circle, gold, orange, red);
                border:3px solid white;
                box-shadow:0 0 18px gold;
            "></div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    const popupButtons = `
        <a href="https://wa.me/${job.phone}?text=J'ai vu votre offre sur JobMarket Cameroon et je suis intéressé." target="_blank" style="display:block;background:#25D366;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">WhatsApp</a>
        <a href="tel:${job.phone}" style="display:block;background:#007AFF;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">Appeler</a>
        <button onclick="drawRoute(${job.lat},${job.lng})" style="width:100%;background:red;color:white;padding:10px;border:none;border-radius:10px;margin-top:8px;">Itinéraire vocal</button>
        ${(currentUser && (currentUser.uid === job.user || currentUser.uid === ADMIN_UID)) ? `<button onclick="deleteJob('${job.id}')" style="width:100%;background:black;color:white;padding:10px;border:none;border-radius:10px;margin-top:8px;">Supprimer</button>` : ''}
    `;

    L.marker([job.lat, job.lng], { icon: markerIcon })
        .addTo(jobsLayer)
        .bindPopup(`
            <div style="min-width:220px">
                <b>${job.title}</b><br>
                <span style="color:green;font-weight:bold">${job.price}</span><br>
                <small>${job.landmark || ''}</small><br>
                ${job.image ? `<img src="${job.image}" style="width:100%;margin-top:8px;border-radius:10px;">` : ''}
                <div style="color:gold;text-align:center;margin-top:8px;">${'★'.repeat(Math.round(job.ratingAvg || 5))}</div>
                ${popupButtons}
            </div>
        `);
});

updateJobsList(jobs);

}

async function addJob() { if (!currentUser || currentUser.isAnonymous) { alert("Connectez-vous pour publier un job"); return; }

const publishBtn = document.getElementById("publishBtn");
if (publishBtn) publishBtn.innerText = "Publication...";

try {
    const cat = document.getElementById('category').value.split('|');

    navigator.geolocation.getCurrentPosition(async pos => {
        let imageUrl = "";
        const imageFile = document.getElementById("jobImage")?.files[0];

        if (imageFile) {
            const formData = new FormData();
            formData.append("file", imageFile);
            formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

            const response = await fetch(
                `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
                {
                    method: "POST",
                    body: formData
                }
            );

            const data = await response.json();
            imageUrl = data.secure_url;
        }

        const jobData = {
            title: title.value,
            price: price.value,
            phone: phone.value,
            landmark: landmark.value,
            desc: desc.value,
            icon: cat[0],
            color: cat[1],
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            user: currentUser.uid,
            userName: currentUser.displayName || currentUser.email,
            ratingAvg: 5,
            verified: true,
            timestamp: Date.now(),
            image: imageUrl
        };

        await db.ref('jobs').push(jobData);

        alert("Job bel et bien publié. Félicitations !");
        resetJobForm();
        toggleForm();
        syncJobs();

        if (publishBtn) publishBtn.innerText = "Publier";
    }, () => {
        alert("GPS requis pour publier");
    }, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
    });
} catch (e) {
    alert("Erreur publication");
    if (publishBtn) publishBtn.innerText = "Publier";
}

}

function resetJobForm() { ["title", "price", "phone", "landmark", "desc", "jobImage"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; }); }

function deleteJob(jobId) { if (!confirm("Supprimer ce job ?")) return; db.ref(jobs/${jobId}).remove(); }

// =============================== // ROUTING + VOICE // =============================== function drawRoute(lat, lng) { if (!userCoords) { alert("Active GPS"); return; }

if (routeControl) map.removeControl(routeControl);

routeControl = L.Routing.control({
    waypoints: [
        L.latLng(userCoords.lat, userCoords.lng),
        L.latLng(lat, lng)
    ],
    routeWhileDragging: false,
    addWaypoints: false,
    createMarker: () => null,
    lineOptions: {
        styles: [{ color: 'red', weight: 6 }]
    }
}).addTo(map);

routeControl.on('routesfound', function (e) {
    const route = e.routes[0];
    document.getElementById("itineraryPanel")?.classList.remove("hidden");
    document.getElementById("itineraryDistance").innerText = `${(route.summary.totalDistance / 1000).toFixed(2)} km`;

    speakInstructions(route.instructions);
});

}

function speakInstructions(instructions) { if (!('speechSynthesis' in window)) return;

let index = 0;

function speakNext() {
    if (index >= instructions.length) return;

    const utterance = new SpeechSynthesisUtterance(instructions[index].text);
    utterance.lang = "fr-FR";
    utterance.onend = () => {
        index++;
        setTimeout(speakNext, 1500);
    };

    speechSynthesis.speak(utterance);
}

speakNext();

}

// =============================== // UI HELPERS // =============================== function toggleForm() { formBox.classList.toggle('hidden'); }

function showList() { jobsList.classList.remove('hidden'); accountPage.classList.add('hidden'); }

function showMap() { jobsList.classList.add('hidden'); accountPage.classList.add('hidden'); formBox.classList.add('hidden'); }

function openAccount() { accountPage.classList.remove('hidden'); jobsList.classList.add('hidden'); }

function filterJobs(cat) { if (cat === 'all') return renderJobs(allJobs); renderJobs(allJobs.filter(job => job.icon === cat)); }

function updateJobsList(jobs) { const list = document.getElementById('listContent'); if (!list) return;

list.innerHTML = jobs.map(job => `
    <div style="background:white;padding:15px;border-radius:16px;margin-bottom:12px;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
        <b>${job.title}</b><br>
        <small>${job.dist.toFixed(2)} km</small><br>
        <span style="color:green;font-weight:bold">${job.price}</span><br>
        <small>${job.userName || ''}</small>
        <a href="https://wa.me/${job.phone}?text=J'ai vu votre offre sur JobMarket Cameroon et je suis intéressé." target="_blank" style="display:block;background:#25D366;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">WhatsApp</a>
    </div>
`).join('');

}

function calcDist(lat1, lon1, lat2, lon2) { const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;

const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

}

// =============================== // START // =============================== locateMe();// =============================== // JOBMARKET CAMEROON PRO MAX FINAL APP.JS // ===============================

const firebaseConfig = { apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE", authDomain: "jobmarketfuture.firebaseapp.com", databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com", projectId: "jobmarketfuture", storageBucket: "jobmarketfuture.appspot.com", messagingSenderId: "123456789", appId: "1:123456789:web:jobmarketcameroon" };

firebase.initializeApp(firebaseConfig);

const db = firebase.database(); const auth = firebase.auth();

const CLOUDINARY_CLOUD_NAME = "dvoab3mzb"; const CLOUDINARY_UPLOAD_PRESET = "job_preset"; const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

let userCoords = null; let routeControl = null; let allJobs = []; let currentUser = null; let userMarker = null; let accuracyCircle = null; let watchId = null;

// =============================== // MAP // =============================== const map = L.map('map', { zoomControl: false, maxZoom: 20 }).setView([3.848, 11.502], 13);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20 }).addTo(map);

const jobsLayer = L.featureGroup().addTo(map);

// =============================== // AUTH // =============================== auth.onAuthStateChanged(user => { if (user) { currentUser = user; updateAccountUI(user); } });

auth.signInAnonymously().catch(console.error);

function signupEmail() { auth.createUserWithEmailAndPassword(email.value, password.value) .then(res => { alert(Bienvenue dans JobMarket Cameroon, ${res.user.email}); }) .catch(err => alert(err.message)); }

function loginEmail() { auth.signInWithEmailAndPassword(email.value, password.value) .then(res => { alert(Bienvenue de retour sur JobMarket Cameroon, ${res.user.email}); }) .catch(err => alert(err.message)); }

function loginGoogle() { const provider = new firebase.auth.GoogleAuthProvider(); auth.signInWithPopup(provider) .then(res => { alert(Bienvenue dans JobMarket Cameroon, ${res.user.displayName}); }) .catch(err => alert(err.message)); }

function logout() { auth.signOut(); alert("Déconnexion réussie"); }

function updateAccountUI(user) { const avatar = document.getElementById("userAvatar"); if (!avatar) return;

const name = user.displayName || user.email || "User";
const initials = name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
avatar.innerHTML = initials;

}

// =============================== // GPS PREMIUM // =============================== function locateMe() { if (!navigator.geolocation) { alert("GPS non supporté"); return; }

navigator.geolocation.getCurrentPosition(position => {
    updateUserLocation(position);

    if (watchId) navigator.geolocation.clearWatch(watchId);

    watchId = navigator.geolocation.watchPosition(updateUserLocation, console.error, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
    });

    syncJobs();
}, err => {
    alert("Impossible d'obtenir votre position exacte");
    syncJobs();
}, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 0
});

}

function updateUserLocation(position) { userCoords = { lat: position.coords.latitude, lng: position.coords.longitude };

if (userMarker) map.removeLayer(userMarker);
if (accuracyCircle) map.removeLayer(accuracyCircle);

accuracyCircle = L.circle([userCoords.lat, userCoords.lng], {
    radius: position.coords.accuracy,
    color: '#007AFF',
    fillColor: '#007AFF',
    fillOpacity: 0.15
}).addTo(map);

userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
    radius: 10,
    color: '#ffffff',
    weight: 3,
    fillColor: '#007AFF',
    fillOpacity: 1
}).addTo(map);

map.flyTo([userCoords.lat, userCoords.lng], map.getZoom(), {
    animate: true,
    duration: 1.5
});

}

// =============================== // JOBS // =============================== function syncJobs() { db.ref('jobs').on('value', snapshot => { allJobs = [];

snapshot.forEach(child => {
        const job = child.val();
        const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, job.lat, job.lng) : 999;
        allJobs.push({
            ...job,
            id: child.key,
            dist
        });
    });

    allJobs.sort((a, b) => a.dist - b.dist);
    renderJobs(allJobs);
});

}

function renderJobs(jobs) { jobsLayer.clearLayers();

jobs.forEach(job => {
    const markerIcon = L.divIcon({
        className: '',
        html: `
            <div style="
                width:26px;
                height:26px;
                border-radius:50%;
                background: radial-gradient(circle, gold, orange, red);
                border:3px solid white;
                box-shadow:0 0 18px gold;
            "></div>
        `,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
    });

    const popupButtons = `
        <a href="https://wa.me/${job.phone}?text=J'ai vu votre offre sur JobMarket Cameroon et je suis intéressé." target="_blank" style="display:block;background:#25D366;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">WhatsApp</a>
        <a href="tel:${job.phone}" style="display:block;background:#007AFF;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">Appeler</a>
        <button onclick="drawRoute(${job.lat},${job.lng})" style="width:100%;background:red;color:white;padding:10px;border:none;border-radius:10px;margin-top:8px;">Itinéraire vocal</button>
        ${(currentUser && (currentUser.uid === job.user || currentUser.uid === ADMIN_UID)) ? `<button onclick="deleteJob('${job.id}')" style="width:100%;background:black;color:white;padding:10px;border:none;border-radius:10px;margin-top:8px;">Supprimer</button>` : ''}
    `;

    L.marker([job.lat, job.lng], { icon: markerIcon })
        .addTo(jobsLayer)
        .bindPopup(`
            <div style="min-width:220px">
                <b>${job.title}</b><br>
                <span style="color:green;font-weight:bold">${job.price}</span><br>
                <small>${job.landmark || ''}</small><br>
                ${job.image ? `<img src="${job.image}" style="width:100%;margin-top:8px;border-radius:10px;">` : ''}
                <div style="color:gold;text-align:center;margin-top:8px;">${'★'.repeat(Math.round(job.ratingAvg || 5))}</div>
                ${popupButtons}
            </div>
        `);
});

updateJobsList(jobs);

}

async function addJob() { if (!currentUser || currentUser.isAnonymous) { alert("Connectez-vous pour publier un job"); return; }

const publishBtn = document.getElementById("publishBtn");
if (publishBtn) publishBtn.innerText = "Publication...";

try {
    const cat = document.getElementById('category').value.split('|');

    navigator.geolocation.getCurrentPosition(async pos => {
        let imageUrl = "";
        const imageFile = document.getElementById("jobImage")?.files[0];

        if (imageFile) {
            const formData = new FormData();
            formData.append("file", imageFile);
            formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

            const response = await fetch(
                `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
                {
                    method: "POST",
                    body: formData
                }
            );

            const data = await response.json();
            imageUrl = data.secure_url;
        }

        const jobData = {
            title: title.value,
            price: price.value,
            phone: phone.value,
            landmark: landmark.value,
            desc: desc.value,
            icon: cat[0],
            color: cat[1],
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            user: currentUser.uid,
            userName: currentUser.displayName || currentUser.email,
            ratingAvg: 5,
            verified: true,
            timestamp: Date.now(),
            image: imageUrl
        };

        await db.ref('jobs').push(jobData);

        alert("Job bel et bien publié. Félicitations !");
        resetJobForm();
        toggleForm();
        syncJobs();

        if (publishBtn) publishBtn.innerText = "Publier";
    }, () => {
        alert("GPS requis pour publier");
    }, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
    });
} catch (e) {
    alert("Erreur publication");
    if (publishBtn) publishBtn.innerText = "Publier";
}

}

function resetJobForm() { ["title", "price", "phone", "landmark", "desc", "jobImage"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; }); }

function deleteJob(jobId) { if (!confirm("Supprimer ce job ?")) return; db.ref(jobs/${jobId}).remove(); }

// =============================== // ROUTING + VOICE // =============================== function drawRoute(lat, lng) { if (!userCoords) { alert("Active GPS"); return; }

if (routeControl) map.removeControl(routeControl);

routeControl = L.Routing.control({
    waypoints: [
        L.latLng(userCoords.lat, userCoords.lng),
        L.latLng(lat, lng)
    ],
    routeWhileDragging: false,
    addWaypoints: false,
    createMarker: () => null,
    lineOptions: {
        styles: [{ color: 'red', weight: 6 }]
    }
}).addTo(map);

routeControl.on('routesfound', function (e) {
    const route = e.routes[0];
    document.getElementById("itineraryPanel")?.classList.remove("hidden");
    document.getElementById("itineraryDistance").innerText = `${(route.summary.totalDistance / 1000).toFixed(2)} km`;

    speakInstructions(route.instructions);
});

}

function speakInstructions(instructions) { if (!('speechSynthesis' in window)) return;

let index = 0;

function speakNext() {
    if (index >= instructions.length) return;

    const utterance = new SpeechSynthesisUtterance(instructions[index].text);
    utterance.lang = "fr-FR";
    utterance.onend = () => {
        index++;
        setTimeout(speakNext, 1500);
    };

    speechSynthesis.speak(utterance);
}

speakNext();

}

// =============================== // UI HELPERS // =============================== function toggleForm() { formBox.classList.toggle('hidden'); }

function showList() { jobsList.classList.remove('hidden'); accountPage.classList.add('hidden'); }

function showMap() { jobsList.classList.add('hidden'); accountPage.classList.add('hidden'); formBox.classList.add('hidden'); }

function openAccount() { accountPage.classList.remove('hidden'); jobsList.classList.add('hidden'); }

function filterJobs(cat) { if (cat === 'all') return renderJobs(allJobs); renderJobs(allJobs.filter(job => job.icon === cat)); }

function updateJobsList(jobs) { const list = document.getElementById('listContent'); if (!list) return;

list.innerHTML = jobs.map(job => `
    <div style="background:white;padding:15px;border-radius:16px;margin-bottom:12px;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
        <b>${job.title}</b><br>
        <small>${job.dist.toFixed(2)} km</small><br>
        <span style="color:green;font-weight:bold">${job.price}</span><br>
        <small>${job.userName || ''}</small>
        <a href="https://wa.me/${job.phone}?text=J'ai vu votre offre sur JobMarket Cameroon et je suis intéressé." target="_blank" style="display:block;background:#25D366;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">WhatsApp</a>
    </div>
`).join('');

}

function calcDist(lat1, lon1, lat2, lon2) { const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;

const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));

}

// =============================== // START // =============================== locateMe();
