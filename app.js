// 🔥 FIREBASE
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

// NAVIGATION
function showScreen(s){
  jobsScreen.classList.add("hidden");
  mapScreen.classList.add("hidden");
  accountScreen.classList.add("hidden");
  businessScreen.classList.add("hidden");

  if(s==="jobs") jobsScreen.classList.remove("hidden");
  if(s==="map") mapScreen.classList.remove("hidden");
  if(s==="account") accountScreen.classList.remove("hidden");
  if(s==="business") businessScreen.classList.remove("hidden");
}

// MAP
let map = L.map('map').setView([3.8,11.5],6);

// satellite + labels
L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(map);

let userLat, userLng;
let routeLine;

// GPS
navigator.geolocation.watchPosition(pos=>{
  userLat = pos.coords.latitude;
  userLng = pos.coords.longitude;

  if(routeLine){
    let last = routeLine.getLatLngs().slice(-1)[0];
    let d = distance(userLat,userLng,last.lat,last.lng);

    if(d < 0.2){
      speak("Vous êtes arrivé");
    }
  }
});

// LOAD JOBS
let markers = [];

db.ref("jobs").on("value", snap=>{

  markers.forEach(m => map.removeLayer(m));
  markers = [];

  let data = snap.val();
  jobsScreen.innerHTML="";

  if(!data) return;

  Object.entries(data).forEach(([id,job])=>{

    // LIST
    jobsScreen.innerHTML += `
    <div class="job">
      <b>${job.title}</b><br>
      <button onclick="contact('${job.phone}','${job.title}')">Contacter</button>
    </div>`;

    // MAP
    let marker = L.circleMarker([job.lat,job.lng],{
      color: job.boosted ? "red" : "orange"
    }).addTo(map);

    markers.push(marker);

    marker.bindPopup(`
      <b>${job.title}</b><br>
      <img src="${job.image || ''}" width="100"><br>

      <button onclick="route(${job.lat},${job.lng})">Itinéraire</button><br>

      <a href="tel:${job.phone}">📞</a><br>

      <a href="https://wa.me/${job.phone}?text=Bonjour je viens de JobMarket et je suis intéressé par ${job.title}">
      💬 WhatsApp
      </a>
    `);

  });

});

// ADD JOB
function addJob(){

let title = prompt("Service ?");
let phone = prompt("Téléphone ?");
let image = prompt("Image URL ?");

navigator.geolocation.getCurrentPosition(pos=>{

db.ref("jobs").push({
title,
phone,
image,
lat:pos.coords.latitude,
lng:pos.coords.longitude,
boosted:false
});

});

}

// CONTACT
function contact(phone,title){
window.open(`https://wa.me/${phone}?text=Bonjour je viens de JobMarket et je suis intéressé par ${title}`);
}

// ROUTE REAL
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

speak("Distance "+dist.toFixed(1)+" kilomètres");

}

// DISTANCE
function distance(lat1,lon1,lat2,lon2){
let R=6371;
let dLat=(lat2-lat1)*Math.PI/180;
let dLon=(lon2-lon1)*Math.PI/180;
let a=Math.sin(dLat/2)**2+
Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
Math.sin(dLon/2)**2;
return R*(2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

// VOICE
function speak(text){
let msg = new SpeechSynthesisUtterance(text);
msg.lang="fr-FR";
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
alert("Paiement à connecter");
    }
