var firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

// MAP SATELLITE + NOMS
let map = L.map('map').setView([3.8,11.5],15);

L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png').addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{opacity:0.3}).addTo(map);

setTimeout(()=>map.invalidateSize(),500);

// GPS
let userLat,userLng;

navigator.geolocation.watchPosition(pos=>{
userLat=pos.coords.latitude;
userLng=pos.coords.longitude;
map.setView([userLat,userLng],17);
});

// DISTANCE
function distance(lat,lng){
let d=Math.sqrt((lat-userLat)**2+(lng-userLng)**2);
return (d*111).toFixed(2);
}

// DRAW ROUTE
let routeLine;

function drawRoute(lat,lng){
if(routeLine) map.removeLayer(routeLine);

routeLine = L.polyline([
[userLat,userLng],
[lat,lng]
],{color:"yellow"}).addTo(map);

speak("Itinéraire lancé");
}

// VOICE
function speak(text){
speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// LOAD JOBS
db.ref("jobs").on("value", snap=>{
let data=snap.val();
jobsPanel.innerHTML="";

Object.entries(data).sort((a,b)=>{
return distance(a[1].lat,a[1].lng) - distance(b[1].lat,b[1].lng);
}).forEach(([id,job])=>{

jobsPanel.innerHTML+=`
<div class="job">
<b>${job.title}</b><br>
${job.price} FCFA<br>
⭐ ${job.rating || 0}
<img src="${job.image || ''}">
<br>
<button class="whatsapp" onclick="contact('${job.phone}','${job.title}')">WhatsApp</button>
<button class="call" onclick="call('${job.phone}')">Appel</button>
<button class="delete" onclick="deleteJob('${id}','${job.owner}','${job.boost}')">✖</button>
</div>
`;

let marker=L.marker([job.lat,job.lng]).addTo(map);

marker.bindPopup(`
<img src="${job.image}" width="100%">
<b>${job.title}</b><br>
⭐ ${job.rating || 0}<br>
${distance(job.lat,job.lng)} km<br>
<button onclick="drawRoute(${job.lat},${job.lng})">🧭 Itinéraire</button>
<button onclick="contact('${job.phone}','${job.title}')">WhatsApp</button>
`);
});
});

// ADD JOB
function addJob(){
if(!auth.currentUser) return alert("Connecte-toi");

navigator.geolocation.getCurrentPosition(pos=>{
db.ref("jobs").push({
title:title.value,
desc:desc.value,
price:price.value,
phone:phone.value,
image:image.value,
lat:pos.coords.latitude,
lng:pos.coords.longitude,
rating:0,
owner:auth.currentUser.uid,
boost:false
});
});
}

// DELETE
function deleteJob(id,owner,boost){
let user = auth.currentUser;

if(!user) return;

if(user.uid === owner || boost === true || prompt("Code admin ?")==="237BO"){
db.ref("jobs/"+id).remove();
}
}

// CONTACT
function contact(phone,title){
window.open(`https://wa.me/${phone}?text=Bonjour JobMarket pour ${title}`);
}

function call(phone){
window.open(`tel:${phone}`);
}

// NAV
function show(s){
jobsPanel.classList.add("hidden");
accountPanel.classList.add("hidden");
businessPanel.classList.add("hidden");

if(s==="jobs") jobsPanel.classList.remove("hidden");
if(s==="account") accountPanel.classList.remove("hidden");
if(s==="business") businessPanel.classList.remove("hidden");
}

// AUTH
function register(){auth.createUserWithEmailAndPassword(email.value,password.value);}
function login(){auth.signInWithEmailAndPassword(email.value,password.value);}
function googleLogin(){
let provider=new firebase.auth.GoogleAuthProvider();
auth.signInWithPopup(provider);
}

// CV
function saveCV(){
let user=auth.currentUser;
db.ref("users/"+user.uid).set({
cv:cv.value,
role:role.value
});
}

// FORM
function toggleForm(){
form.classList.toggle("hidden");
}

// AI
function openAI(){
let q=prompt("Pose ta question");
alert("Réponse IA bientôt connectée");
}

// BOOST
function payBoost(){
alert("Paiement bientôt actif");
    }
