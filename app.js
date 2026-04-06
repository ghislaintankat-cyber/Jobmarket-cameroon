var firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

// MAP
let map = L.map('map').setView([3.8,11.5],6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{opacity:0.5}).addTo(map);
L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{opacity:0.6}).addTo(map);

// FIX MAP BUG
setTimeout(()=>map.invalidateSize(),500);

// NAV
function show(s){
jobsPanel.classList.add("hidden");
accountPanel.classList.add("hidden");
businessPanel.classList.add("hidden");

if(s==="jobs") jobsPanel.classList.remove("hidden");
if(s==="account") accountPanel.classList.remove("hidden");
if(s==="business") businessPanel.classList.remove("hidden");
}

// GPS
let userLat,userLng;

navigator.geolocation.watchPosition(pos=>{
userLat=pos.coords.latitude;
userLng=pos.coords.longitude;
});

// DISTANCE
function distance(lat,lng){
if(!userLat) return 0;
let d=Math.sqrt((lat-userLat)**2+(lng-userLng)**2);
return (d*111).toFixed(2);
}

// LOAD JOBS
db.ref("jobs").on("value", snap=>{
let data=snap.val();
jobsPanel.innerHTML="";
if(!data) return;

Object.entries(data).forEach(([id,job])=>{

jobsPanel.innerHTML+=`
<div class="job">
<b>${job.title}</b><br>
${job.price} FCFA<br>
⭐ ${job.rating || 0}
<img src="${job.image || ''}">
<br>
<button onclick="contact('${job.phone}','${job.title}')">WhatsApp</button>
<button onclick="call('${job.phone}')">Appel</button>
<button onclick="rateJob('${id}',5)">⭐</button>
<button onclick="deleteJob('${id}')">❌</button>
</div>
`;

let marker=L.marker([job.lat,job.lng]).addTo(map);

marker.bindPopup(`
<b>${job.title}</b><br>
Distance: ${distance(job.lat,job.lng)} km<br>
<button onclick="navigate(${job.lat},${job.lng})">🧭 Aller</button>
`);
});
});

// ADD JOB
function addJob(){

if(!auth.currentUser){
alert("Connecte-toi");
return;
}

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
boost:false
});
alert("Publié");
});
}

// CONTACT
function contact(phone,title){
window.open(`https://wa.me/${phone}?text=Bonjour, je viens de JobMarket pour ${title}`);
}

function call(phone){
window.open(`tel:${phone}`);
}

// NAVIGATE
function navigate(lat,lng){
window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
}

// VOICE
function speak(text){
speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// RATE
function rateJob(id,r){
db.ref("jobs/"+id+"/rating").set(r);
}

// ADMIN
function deleteJob(id){
let code=prompt("Code admin ?");
if(code==="237BO"){
db.ref("jobs/"+id).remove();
}
}

// AUTH
function register(){
auth.createUserWithEmailAndPassword(email.value,password.value);
}

function login(){
auth.signInWithEmailAndPassword(email.value,password.value);
}

function googleLogin(){
let provider=new firebase.auth.GoogleAuthProvider();
auth.signInWithPopup(provider);
}

// CV
function saveCV(){
let user=auth.currentUser;
if(!user) return alert("Connecte-toi");

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
async function askAI(){
let text=prompt("Décris ton job");

let res=await fetch("https://TON-BACKEND.onrender.com/ai",{
method:"POST",
headers:{"Content-Type":"application/json"},
body:JSON.stringify({message:text})
});

let data=await res.json();
desc.value=data.reply;
}

// BOOST
function payBoost(){
alert("Paiement bientôt actif");
  }
