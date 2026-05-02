const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture",
    storageBucket: "jobmarketfuture.appspot.com",
    messagingSenderId: "123456789",
    appId: "1:123456789:web:jobmarketcameroon"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

const CLOUDINARY_CLOUD_NAME = "dvoab3mzb";
const CLOUDINARY_UPLOAD_PRESET = "job_preset";
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

let userCoords = null;
let currentUser = null;
let allJobs = [];
let jobsLayer = null;
let routeControl = null;
let userMarker = null;
let accuracyCircle = null;

const map = L.map('map', {
    zoomControl: false,
    maxZoom: 20
}).setView([3.848, 11.502], 13);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
    maxZoom: 20
}).addTo(map);

jobsLayer = L.featureGroup().addTo(map);

auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) updateAccountUI(user);
});

auth.signInAnonymously().catch(console.error);

function signupEmail() {
    auth.createUserWithEmailAndPassword(email.value, password.value)
        .then(res => {
            res.user.sendEmailVerification();
            alert(`Bienvenue dans JobMarket Cameroon, ${res.user.email}`);
        })
        .catch(err => alert(err.message));
}

function loginEmail() {
    auth.signInWithEmailAndPassword(email.value, password.value)
        .then(res => alert(`Bon retour sur JobMarket Cameroon, ${res.user.email}`))
        .catch(err => alert(err.message));
}

function loginGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider)
        .then(res => alert(`Bienvenue ${res.user.displayName}`))
        .catch(err => alert(err.message));
}

function logout() {
    auth.signOut();
}

function updateAccountUI(user) {
    const avatar = document.getElementById('userAvatar');
    if (!avatar) return;
    const name = user.displayName || user.email || 'JM';
    const initials = name.split(' ').map(v => v[0]).join('').substring(0,2).toUpperCase();
    avatar.innerText = initials;
}

function locateMe() {
    navigator.geolocation.getCurrentPosition(pos => {
        updateUserLocation(pos);
        navigator.geolocation.watchPosition(updateUserLocation, console.error, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 15000
        });
        syncJobs();
    }, () => syncJobs(), {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
    });
}

function updateUserLocation(position) {
    userCoords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
    };

    if (userMarker) map.removeLayer(userMarker);
    if (accuracyCircle) map.removeLayer(accuracyCircle);

    accuracyCircle = L.circle([userCoords.lat, userCoords.lng], {
        radius: position.coords.accuracy,
        color: '#007AFF',
        fillColor: '#007AFF',
        fillOpacity: 0.12
    }).addTo(map);

    userMarker = L.circleMarker([userCoords.lat, userCoords.lng], {
        radius: 10,
        color: '#fff',
        weight: 3,
        fillColor: '#007AFF',
        fillOpacity: 1
    }).addTo(map);
}

function syncJobs() {
    db.ref('jobs').on('value', snap => {
        allJobs = [];
        snap.forEach(child => {
            const job = child.val();
            const dist = userCoords ? calcDist(userCoords.lat, userCoords.lng, job.lat, job.lng) : 999;
            allJobs.push({ ...job, id: child.key, dist });
        });
        allJobs.sort((a,b) => a.dist - b.dist);
        renderJobs(allJobs);
    });
}

function renderJobs(jobs) {
    jobsLayer.clearLayers();

    jobs.forEach(job => {
        const markerIcon = L.divIcon({
            className: '',
            html: `<div style="width:28px;height:28px;border-radius:50%;background:radial-gradient(circle,gold,#ff9800,#ff3b30);border:3px solid white;box-shadow:0 0 18px gold;"></div>`,
            iconSize: [28,28],
            iconAnchor: [14,14]
        });

        L.marker([job.lat, job.lng], { icon: markerIcon })
            .addTo(jobsLayer)
            .bindPopup(`
                <div style="min-width:230px">
                    <b>${job.title}</b><br>
                    <span style="color:green;font-weight:bold">${job.price}</span><br>
                    <small>${job.landmark || ''}</small><br>
                    ${job.image ? `<img src="${job.image}" style="width:100%;margin-top:8px;border-radius:10px;">` : ''}
                    <div style="color:gold;text-align:center;margin-top:8px;">${'★'.repeat(Math.round(job.ratingAvg || 5))}</div>
                    <a href="https://wa.me/${job.phone}?text=J'ai vu votre offre sur JobMarket Cameroon et je suis intéressé." target="_blank" style="display:block;background:#25D366;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">WhatsApp</a>
                    <a href="tel:${job.phone}" style="display:block;background:#007AFF;color:white;padding:10px;text-align:center;border-radius:10px;margin-top:8px;text-decoration:none;">Appeler</a>
                    <button onclick="drawRoute(${job.lat},${job.lng})" style="width:100%;background:red;color:white;padding:10px;border:none;border-radius:10px;margin-top:8px;">Itinéraire vocal</button>
                </div>
            `);
    });

    updateJobsList(jobs);
}

async function addJob() {
    if (!currentUser || currentUser.isAnonymous) {
        alert('Connectez-vous pour publier');
        return;
    }

    navigator.geolocation.getCurrentPosition(async pos => {
        let imageUrl = '';
        const imageFile = document.getElementById('jobImage').files[0];

        if (imageFile) {
            const formData = new FormData();
            formData.append('file', imageFile);
            formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

            const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            imageUrl = data.secure_url;
        }

        const cat = category.value.split('|');

        await db.ref('jobs').push({
            title: title.value,
            price: price.value,
            phone: phone.value,
            landmark: landmark.value,
            desc: desc.value,
            icon: cat[0],
            color: cat[1],
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            image: imageUrl,
            user: currentUser.uid,
            userName: currentUser.displayName || currentUser.email,
            verified: true,
            ratingAvg: 5,
            timestamp: Date.now()
        });

        alert('Job bel et bien publié. Félicitations !');
        toggleForm();
    }, () => alert('GPS requis'));
}

function drawRoute(lat, lng) {
    if (!userCoords) return;

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
}

function updateJobsList(jobs) {
    listContent.innerHTML = jobs.map(job => `
        <div style="background:white;padding:15px;border-radius:16px;margin-bottom:12px;">
            <b>${job.title}</b><br>
            <small>${job.dist.toFixed(2)} km</small><br>
            <span style="color:green;font-weight:bold">${job.price}</span>
        </div>
    `).join('');
}

function toggleForm(){ formBox.classList.toggle('hidden'); }
function showList(){ jobsList.classList.remove('hidden'); }
function showMap(){ jobsList.classList.add('hidden'); accountPage.classList.add('hidden'); }
function openAccount(){ accountPage.classList.remove('hidden'); }
function filterJobs(cat){ if(cat==='all') return renderJobs(allJobs); renderJobs(allJobs.filter(j=>j.icon===cat)); }

function calcDist(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2-lat1) * Math.PI/180;
    const dLon = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

locateMe();
