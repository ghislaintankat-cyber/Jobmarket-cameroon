const firebaseConfig = {
    apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
    authDomain: "jobmarketfuture.firebaseapp.com",
    databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
    projectId: "jobmarketfuture"
};
if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); }

const db = firebase.database();
const auth = firebase.auth();

let map = L.map('map', {zoomControl:false}).setView([3.848,11.502],13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;
let routeControl = null;
let allJobs = [];

// 1. GESTION DE LA CONNEXION INTELLIGENTE
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('userInfo').innerText = user.isAnonymous ? "Connecté (Anonyme)" : `Connecté : ${user.email || 'Google'}`;
    } else {
        auth.signInAnonymously().catch(e => console.error("Erreur Auth:", e));
    }
});

function locateMe(){
    navigator.geolocation.getCurrentPosition(pos=>{
        userCoords = { lat:pos.coords.latitude, lng:pos.coords.longitude };

        L.circleMarker([userCoords.lat,userCoords.lng],{
            radius:8, color:'#fff', fillColor:'#007AFF', fillOpacity:1
        }).addTo(map);

        map.flyTo([userCoords.lat,userCoords.lng],14);
        syncJobs();
    }, ()=>{
        alert("Activez la géolocalisation pour voir les missions autour de vous.");
        syncJobs();
    });
}

function syncJobs(){
    db.ref('jobs').on('value', snap=>{
        allJobs=[];
        snap.forEach(child=>{
            let j = child.val();
            let dist = userCoords ? calcDist(userCoords.lat,userCoords.lng,j.lat,j.lng) : 999;
            allJobs.push({...j,id:child.key,dist});
        });
        allJobs.sort((a,b)=>a.dist-b.dist);
        render(allJobs);
    });
}

function render(jobs){
    jobsLayer.clearLayers();
    jobs.forEach(j=>{
        const icon = L.divIcon({
            html:`<div style="width:20px;height:20px;background:${j.color};border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(0,0,0,0.4);"></div>`,
            className:'', iconSize:, iconAnchor:
        });

        L.marker([j.lat,j.lng],{icon}).addTo(jobsLayer)
        .bindPopup(`
            <div style="min-width:180px;">
                <b style="font-size:16px;">${j.title}</b><br>
                <span style="color:green; font-weight:bold;">${j.price}</span><br>
                <small>📍 ${j.landmark || 'Non précisé'}</small>
                <div style="display:flex; gap:5px; margin-top:8px;">
                    <a href="https://wa.me/${j.phone}" style="flex:1; background:#25D366; color:white; padding:8px; text-align:center; border-radius:8px; text-decoration:none;">WhatsApp</a>
                    <a href="tel:${j.phone}" style="flex:1; background:#007AFF; color:white; padding:8px; text-align:center; border-radius:8px; text-decoration:none;">Appel</a>
                </div>
                <button onclick="drawRoute(${j.lat},${j.lng})" style="width:100%; background:#E74C3C; color:white; padding:8px; border:none; border-radius:8px; margin-top:8px; font-weight:bold; cursor:pointer;">Voir l'itinéraire</button>
            </div>
        `);
    });
    updateJobsList(jobs);
}

// 2. VALIDATION STRICTE DU FORMULAIRE
function addJob(){
    const cat = document.getElementById('category').value.split('|');
    const titleVal = document.getElementById('title').value.trim();
    const priceVal = document.getElementById('price').value.trim();
    const phoneVal = document.getElementById('phone').value.trim();
    const landmarkVal = document.getElementById('landmark').value.trim();
    const descVal = document.getElementById('desc').value.trim();

    if(!titleVal || !priceVal || !phoneVal) {
        return alert("Veuillez remplir le Titre, le Prix et le Numéro de téléphone.");
    }

    navigator.geolocation.getCurrentPosition(pos=>{
        const ref = db.ref('jobs').push();
        ref.set({
            title: titleVal, price: priceVal, phone: phoneVal,
            landmark: landmarkVal, desc: descVal,
            icon: cat, color: cat,
            lat: pos.coords.latitude, lng: pos.coords.longitude,
            user: auth.currentUser ? auth.currentUser.uid : 'anonymous',
            ratingAvg: 5, timestamp: Date.now()
        }).then(() => {
            alert("Mission publiée avec succès !");
            toggleForm();
            // Réinitialiser les champs
            document.getElementById('title').value = "";
            document.getElementById('price').value = "";
            document.getElementById('desc').value = "";
        });
    }, () => alert("Impossible de publier : le GPS est requis."));
}

// 3. ITINÉRAIRE SANS POLLUER L'ÉCRAN
function drawRoute(lat,lng){
    if(!userCoords) return alert("Veuillez d'abord activer votre GPS (bouton 📍).");

    if(routeControl) { map.removeControl(routeControl); }

    routeControl = L.Routing.control({
        waypoints: [ L.latLng(userCoords.lat,userCoords.lng), L.latLng(lat,lng) ],
        routeWhileDragging: false,
        addWaypoints: false,
        show: false, // <-- CRUCIAL : Masque le panneau de texte Leaflet
        createMarker: () => null,
        lineOptions: {styles: [{color: '#E74C3C', weight: 5, opacity: 0.8}]}
    }).addTo(map);

    document.getElementById('itineraryPanel').classList.remove('hidden');
    
    // Calcul rapide de distance pour le panneau UI
    const dist = calcDist(userCoords.lat, userCoords.lng, lat, lng);
    document.getElementById('itineraryDistance').innerText = dist.toFixed(1) + " km";
}

function updateJobsList(jobs){
    const list = document.getElementById('listContent');
    list.innerHTML = jobs.map(j=>`
        <div style="background:white; padding:15px; border-radius:15px; margin-bottom:10px; border: 1px solid #eee;">
            <div style="display:flex; justify-content:space-between;">
                <b>${j.title}</b> <small style="color:#007AFF; font-weight:bold;">${j.dist.toFixed(1)} km</small>
            </div>
            <b style="color:#25D366; display:block; margin:5px 0;">${j.price}</b>
            <a href="https://wa.me/${j.phone}" style="display:block; background:#25D366; color:white; padding:10px; text-align:center; border-radius:8px; margin-top:8px; text-decoration:none; font-weight:bold;">Contacter via WhatsApp</a>
        </div>
    `).join('');
}

// 4. AUTHENTIFICATION SÉCURISÉE
function loginEmail(){
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    if(!e || !p) return alert("Remplissez l'email et le mot de passe.");
    
    auth.signInWithEmailAndPassword(e, p).then(() => {
        alert("Connecté !"); openAccount();
    }).catch(err => alert(err.message));
}

function loginGoogle(){
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).then(() => {
        alert("Connecté avec Google !"); openAccount();
    }).catch(err => alert(err.message));
}

function logout() {
    auth.signOut().then(() => {
        alert("Déconnecté.");
        document.getElementById('userInfo').innerText = "";
    });
}

function toggleForm(){ document.getElementById('formBox').classList.toggle('hidden'); }
function showList(){ document.getElementById('jobsList').classList.remove('hidden'); }
function showMap(){ 
    document.getElementById('jobsList').classList.add('hidden'); 
    document.getElementById('accountPage').classList.add('hidden'); 
}
function openAccount(){ document.getElementById('accountPage').classList.remove('hidden'); }

function filterJobs(cat){
    if(cat==='all') return render(allJobs);
    render(allJobs.filter(j=>j.icon===cat));
}

function calcDist(la1,lo1,la2,lo2){
    const R=6371; const dLat=(la2-la1)*Math.PI/180; const dLon=(lo2-lo1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*(2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

locateMe();
