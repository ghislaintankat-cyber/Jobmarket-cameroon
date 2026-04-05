// FIREBASE CONFIG (TON CODE)
var firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.appspot.com",
  messagingSenderId: "351669024349",
  appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4"
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
academyScreen.classList.add("hidden");

if(s==="jobs") jobsScreen.classList.remove("hidden");

if(s==="map"){
mapScreen.classList.remove("hidden");
setTimeout(()=>map.invalidateSize(),300);
setTimeout(()=>map.invalidateSize(),1000);
}

if(s==="account") accountScreen.classList.remove("hidden");
if(s==="business") businessScreen.classList.remove("hidden");
if(s==="academy") academyScreen.classList.remove("hidden");
}

// MAP
let map = L.map('map').setView([3.8,11.5],6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let userLat,userLng,routeLine;

navigator.geolocation.watchPosition(pos=>{
userLat=pos.coords.latitude;
userLng=pos.coords.longitude;
});

// JOBS
db.ref("jobs").on("value", snap=>{
let data=snap.val();
jobsScreen.innerHTML="";

if(!data) return;

Object.values(data).forEach(job=>{

jobsScreen.innerHTML+=`
<div class="job">
<b>${job.title}</b><br>
${job.price||""} FCFA<br>
<button onclick="contact('${job.phone}','${job.title}')">Contacter</button>
</div>`;

let marker=L.marker([job.lat,job.lng]).addTo(map);

marker.bindPopup(`
<b>${job.title}</b><br>
${job.desc||""}<br>
<button onclick="route(${job.lat},${job.lng})">Itinéraire</button><br>
<a href="tel:${job.phone}">📞</a><br>
<a href="https://wa.me/${job.phone}?text=Bonjour je viens de JobMarket pour ${job.title}">
WhatsApp
</a>
`);
});
});

// ADD JOB
function addJob(){
navigator.geolocation.getCurrentPosition(pos=>{
db.ref("jobs").push({
title:title.value,
desc:desc.value,
price:price.value,
phone:phone.value,
lat:pos.coords.latitude,
lng:pos.coords.longitude
});
alert("Job publié !");
});
}

// CONTACT
function contact(phone,title){
window.open(`https://wa.me/${phone}?text=Bonjour je viens de JobMarket pour ${title}`);
}

// ROUTE
async function route(lat,lng){
let url=`https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${lng},${lat}?overview=full&geometries=geojson`;

let res=await fetch(url);
let data=await res.json();

let coords=data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);

if(routeLine) map.removeLayer(routeLine);
routeLine=L.polyline(coords,{color:"red"}).addTo(map);

map.fitBounds(routeLine.getBounds());

let dist=data.routes[0].distance/1000;
distance.innerText=dist.toFixed(2);

speechSynthesis.speak(new SpeechSynthesisUtterance("Distance "+dist.toFixed(1)+" kilomètres"));
}

// AUTH
function register(){auth.createUserWithEmailAndPassword(email.value,password.value);}
function login(){auth.signInWithEmailAndPassword(email.value,password.value);}
function googleLogin(){auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());}

// PROFILE
function saveProfile(){
let user=auth.currentUser;
if(!user) return alert("Connecte-toi");

db.ref("users/"+user.uid).set({
pseudo:pseudo.value,
cv:cv.value,
mode:mode.value
});
}

// BUSINESS
function boostJob(){
alert("Boost bientôt actif");
}

// ACADEMY
function openLesson(type){
if(type==="bapteme"){
lessonContent.innerHTML="Créer profil pro + GPS + étoiles ⭐";
}
if(type==="fontaine"){
lessonContent.innerHTML="Boost = plus de clients + plus d'argent 💰";
}
  }
