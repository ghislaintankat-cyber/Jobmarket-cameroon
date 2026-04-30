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
const CLOUDINARY_CLOUD_NAME = "dvoab3mzb";
const CLOUDINARY_UPLOAD_PRESET = "job_preset";

let map = L.map('map',{zoomControl:false}).setView([3.848,11.502],13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {subdomains:['mt0','mt1','mt2','mt3']}).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;
let routeControl = null;
let allJobs = [];

auth.signInAnonymously();

function locateMe(){
 navigator.geolocation.watchPosition(pos=>{
   userCoords = {lat:pos.coords.latitude,lng:pos.coords.longitude};
   L.circleMarker([userCoords.lat,userCoords.lng],{radius:8,color:'#fff',fillColor:'#007AFF',fillOpacity:1}).addTo(map);
   map.flyTo([userCoords.lat,userCoords.lng],14);
   syncJobs();
 });
}

function calcDist(a,b,c,d){
 const R=6371; const dLat=(c-a)*Math.PI/180; const dLon=(d-b)*Math.PI/180;
 const x=Math.sin(dLat/2)**2 + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLon/2)**2;
 return R*(2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)));
}

function syncJobs(){
 db.ref('jobs').on('value',snap=>{
   allJobs=[];
   snap.forEach(child=>{
     let j=child.val();
     let dist=userCoords?calcDist(userCoords.lat,userCoords.lng,j.lat,j.lng):999;
     allJobs.push({...j,id:child.key,dist});
   });
   allJobs.sort((a,b)=>a.dist-b.dist);
   render(allJobs);
 });
}

function render(jobs){
 jobsLayer.clearLayers();
 jobs.forEach(j=>{
   const icon=L.divIcon({
     html:`<div style="width:26px;height:26px;background:linear-gradient(45deg,gold,orange,yellow);border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;"></div>`,
     className:'', iconSize:[26,26], iconAnchor:[13,26]
   });

   L.marker([j.lat,j.lng],{icon}).addTo(jobsLayer).bindPopup(`
    <div>
      <b>${j.title}</b><br>
      <span style='color:green'>${j.price}</span><br>
      <a href='https://wa.me/${j.phone}' style='display:block;background:#25D366;color:white;padding:8px;text-align:center;border-radius:8px;margin-top:8px'>WhatsApp</a>
      <a href='tel:${j.phone}' style='display:block;background:#007AFF;color:white;padding:8px;text-align:center;border-radius:8px;margin-top:5px'>Appeler</a>
      <button onclick='drawRoute(${j.lat},${j.lng})' style='width:100%;background:red;color:white;padding:8px;border:none;border-radius:8px;margin-top:8px'>Itinéraire</button>
    </div>
   `);
 });
 updateJobsList(jobs);
}

async function uploadMultipleImages(files){
 let urls=[];
 for(const file of files){
   const fd=new FormData();
   fd.append('file',file);
   fd.append('upload_preset',CLOUDINARY_UPLOAD_PRESET);
   const res=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,{method:'POST',body:fd});
   const data=await res.json();
   urls.push(data.secure_url);
 }
 return urls;
}

async function addJob(){
 const cat=document.getElementById('category').value.split('|');
 const files=document.getElementById('jobImages').files;
 const imageUrls = files.length ? await uploadMultipleImages(files) : [];
 navigator.geolocation.getCurrentPosition(pos=>{
   db.ref('jobs').push({
     title:title.value, price:price.value, phone:phone.value,
     landmark:landmark.value, desc:desc.value,
     icon:cat[0], color:cat[1], images:imageUrls,
     lat:pos.coords.latitude, lng:pos.coords.longitude,
     user:auth.currentUser.uid, verified:false,
     ratingAvg:5, timestamp:Date.now()
   });
   showNotification('Job publié avec succès');
   toggleForm();
 });
}

function drawRoute(lat,lng){
 if(!userCoords) return;
 if(routeControl) map.removeControl(routeControl);
 routeControl=L.Routing.control({
   waypoints:[L.latLng(userCoords.lat,userCoords.lng),L.latLng(lat,lng)],
   routeWhileDragging:false, addWaypoints:false, createMarker:()=>null,
   lineOptions:{styles:[{color:'red',weight:5}]}
 }).addTo(map);
 speechSynthesis.speak(new SpeechSynthesisUtterance('Itinéraire lancé'));
}

function signupEmail(){ auth.createUserWithEmailAndPassword(email.value,password.value); }
function loginEmail(){ auth.signInWithEmailAndPassword(email.value,password.value); }
function loginGoogle(){ auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); }

function requestUserVerification(){
 db.ref('verifications').push({uid:auth.currentUser.uid,status:'pending',timestamp:Date.now()});
 showNotification('Demande envoyée');
}

function loadAdminStats(){
 Promise.all([
  db.ref('jobs').once('value'), db.ref('users').once('value'),
  db.ref('reports').once('value'), db.ref('verifications').once('value')
 ]).then(([a,b,c,d])=>{
  totalJobs.innerText=a.numChildren();
  totalUsers.innerText=b.numChildren();
  fraudReports.innerText=c.numChildren();
  pendingVerifications.innerText=Object.values(d.val()||{}).filter(v=>v.status==='pending').length;
 });
}

function showNotification(text){
 const div=document.createElement('div');
 div.className='live-notification'; div.innerText=text;
 document.body.appendChild(div);
 setTimeout(()=>div.remove(),4000);
}

function updateJobsList(jobs){
 listContent.innerHTML = jobs.map(j=>`<div><b>${j.title}</b> - ${j.dist.toFixed(1)} km</div>`).join('');
}

function toggleForm(){ formBox.classList.toggle('hidden'); }
function openAccount(){ accountPage.classList.remove('hidden'); }
function showMap(){ jobsList.classList.add('hidden'); accountPage.classList.add('hidden'); }
function filterJobs(cat){ render(cat==='all'?allJobs:allJobs.filter(j=>j.icon===cat)); }

locateMe();
