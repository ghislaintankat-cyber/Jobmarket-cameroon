// FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

// NAV
function showScreen(s){

jobsScreen.classList.add("hidden");
mapScreen.classList.add("hidden");
accountScreen.classList.add("hidden");
businessScreen.classList.add("hidden");

if(s==="jobs") jobsScreen.classList.remove("hidden");

if(s==="map"){
mapScreen.classList.remove("hidden");

/* 🔥 FIX CARTE GRISE */
setTimeout(()=>{ map.invalidateSize(); },300);
setTimeout(()=>{ map.invalidateSize(); },800);
setTimeout(()=>{ map.invalidateSize(); },1500);
}

if(s==="account") accountScreen.classList.remove("hidden");
if(s==="business") businessScreen.classList.remove("hidden");
}

// MAP INIT
let map = L.map('map', {
center:[3.8,11.5],
zoom:6
});

L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',{
maxZoom:19
}).addTo(map);

let userLat, userLng;
let routeLine;

// GPS
navigator.geolocation.watchPosition(pos=>{
userLat = pos.coords.latitude;
userLng = pos.coords.longitude;
});

// LOAD JOBS
db.ref("jobs").on("value", snap=>{

let data = snap.val();
jobsScreen.innerHTML="";

if(!data) return;

Object.entries(data).forEach(([id,job])=>{

jobsScreen.innerHTML += `
<div class="job">
<b>${job.title}</b><br>
${job.price || ""} FCFA<br>
<button onclick="contact('${job.phone}','${job.title}')">Contacter</button>
</div>`;

let marker = L.circleMarker([job.lat,job.lng],{color:"orange"}).addTo(map);

marker.bindPopup(`
<b>${job.title}</b><br>
${job.desc || ""}<br>
💰 ${job.price || ""}<br><br>

<button onclick="route(${job.lat},${job.lng})">Itinéraire</button><br><br>

<a href="tel:${job.phone}">📞</a><br><br>

<a href="https://wa.me/${job.phone}?text=Bonjour je viens de JobMarket et je suis intéressé par ${job.title}">
💬 WhatsApp
</a>
`);

});

});

// ADD JOB
function addJob(){

let title = titleInput.value || document.getElementById("title").value;
let desc = document.getElementById("desc").value;
let price = document.getElementById("price").value;
let phone = document.getElementById("phone").value;

navigator.geolocation.getCurrentPosition(pos=>{

db.ref("jobs").push({
title,
desc,
price,
phone,
lat:pos.coords.latitude,
lng:pos.coords.longitude
});

alert("Job publié !");
toggleForm();

});

}

// FORM
function toggleForm(){
jobForm.classList.toggle("hidden");
}

// CONTACT
function contact(phone,title){
window.open(`https://wa.me/${phone}?text=Bonjour je viens de JobMarket et je suis intéressé par ${title}`);
}

// ROUTE
async function route(lat,lng){

if(routeLine) map.removeLayer(routeLine);

let url = `https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${lng},${lat}?overview=full&geometries=geojson`;

let res = await fetch(url);
let data = await res.json();

let coords = data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
routeLine = L.polyline(coords,{color:"red"}).addTo(map);

map.fitBounds(routeLine.getBounds());

let dist = data.routes[0].distance/1000;
document.getElementById("distance").innerText = dist.toFixed(2);

let msg = new SpeechSynthesisUtterance("Distance "+dist.toFixed(1)+" kilomètres");
speechSynthesis.speak(msg);

}

// AUTH
function register(){
auth.createUserWithEmailAndPassword(email.value,password.value);
}

function login(){
auth.signInWithEmailAndPassword(email.value,password.value);
}

function googleLogin(){
let provider = new firebase.auth.GoogleAuthProvider();
auth.signInWithPopup(provider);
}

// PROFILE
function saveProfile(){

let user = auth.currentUser;
if(!user) return alert("Connecte-toi");

db.ref("users/"+user.uid).set({
pseudo:pseudo.value,
cv:cv.value,
mode:mode.value
});

}

// BUSINESS
function boostJob(){
alert("Paiement bientôt disponible");
}

/* 🔥 FIX GLOBAL FINAL */
setTimeout(()=>{ map.invalidateSize(); },2000);
