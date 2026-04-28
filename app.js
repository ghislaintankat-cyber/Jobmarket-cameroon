const firebaseConfig = {
 apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
 authDomain: "jobmarketfuture.firebaseapp.com",
 databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
 projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
const ADMIN_UID = "GrajEM98vOc1w3FUr9XeTN90rfl2";

let map = L.map('map').setView([3.848,11.502],13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
 subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

let jobsLayer = L.layerGroup().addTo(map);
let userCoords = null;
let routeControl = null;

navigator.geolocation.watchPosition(pos => {
 userCoords = {
   lat: pos.coords.latitude,
   lng: pos.coords.longitude
 };
 syncJobs();
});

function syncJobs(){
 db.ref('jobs').on('value', snap => {
   jobsLayer.clearLayers();
   snap.forEach(child => {
     const j = child.val();

     const icon = L.divIcon({
       html:`<div class="rainbow-marker"></div>`,
       className:'',
       iconSize:[42,42],
       iconAnchor:[21,42]
     });

     L.marker([j.lat,j.lng], {icon}).addTo(jobsLayer)
      .bindPopup(`
       <b>${j.title}</b><br>
       ${j.price}<br>
       <a href="https://wa.me/${j.phone}">WhatsApp</a><br>
       <a href="tel:${j.phone}">Appeler</a><br>
       <button onclick="drawRoute(${j.lat},${j.lng})">Itinéraire</button>
       <button onclick="likeJob('${child.key}')">👍</button>
      `);
   });
 });
}

function drawRoute(lat,lng){
 if(routeControl) map.removeControl(routeControl);
 routeControl = L.Routing.control({
   waypoints:[
     L.latLng(userCoords.lat,userCoords.lng),
     L.latLng(lat,lng)
   ],
   lineOptions:{ styles:[{color:'red',weight:6}] },
   createMarker:()=>null
 }).addTo(map);

 speechSynthesis.speak(new SpeechSynthesisUtterance("Itinéraire démarré"));

 navigator.geolocation.watchPosition(pos => {
   let msg = "Continuez tout droit";
   speechSynthesis.speak(new SpeechSynthesisUtterance(msg));
 });
}

function addJob(){
 navigator.geolocation.getCurrentPosition(pos => {
   db.ref('jobs').push({
     title:document.getElementById('title').value,
     price:document.getElementById('price').value,
     phone:document.getElementById('phone').value,
     desc:document.getElementById('desc').value,
     lat:pos.coords.latitude,
     lng:pos.coords.longitude,
     user:auth.currentUser ? auth.currentUser.uid : 'anon',
     likes:0
   });
   alert('Job publié avec succès');
 });
}

function likeJob(jobId){
 db.ref('jobs/'+jobId+'/likes').transaction(v => (v||0)+1);
}

function loginGoogle(){
 const provider = new firebase.auth.GoogleAuthProvider();
 auth.signInWithPopup(provider).then(res => updateUserUI(res.user));
}

function updateUserUI(user){
 const name = user.displayName || user.email;
 const initial = name.charAt(0).toUpperCase();
 document.getElementById('userAvatar').innerText = initial;
 document.getElementById('userName').innerText = name;
 document.getElementById('userEmail').innerText = user.email;
 alert('Connecté avec succès : '+name);
}

function togglePublish(){
 document.getElementById('publishDrawer').classList.toggle('hidden');
}

function toggleAccount(){
 document.getElementById('accountDrawer').classList.toggle('hidden');
}

function showMap(){
 document.getElementById('publishDrawer').classList.add('hidden');
 document.getElementById('accountDrawer').classList.add('hidden');
}

function filterJobs(cat){
 // extensible pour catégories futures
}

auth.signInAnonymously();
