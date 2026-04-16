// 🔥 FIREBASE CONFIG
const firebaseConfig = {
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

let currentUser;
const ADMIN_UID = "TON_UID_ICI"; // 🔥 remplace

auth.onAuthStateChanged(user=>{
  currentUser = user;
});

// 🔐 AUTH
function register(){
  auth.createUserWithEmailAndPassword(email.value,password.value);
}
function login(){
  auth.signInWithEmailAndPassword(email.value,password.value);
}

// 🗺️ MAP
let map = L.map("map").setView([3.848,11.502],15);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom:19 }
).addTo(map);

let userMarker;

navigator.geolocation.watchPosition(pos=>{
  let lat=pos.coords.latitude;
  let lng=pos.coords.longitude;

  if(userMarker){
    userMarker.setLatLng([lat,lng]);
  }else{
    userMarker = L.circleMarker([lat,lng],{radius:8,color:"blue"}).addTo(map);
  }

},{enableHighAccuracy:true});

// ➕ FORM
function openForm(){
  formBox.classList.toggle("hidden");
}

// 💾 ADD JOB
function addJob(){

  if(!currentUser){
    alert("Connecte-toi");
    return;
  }

  navigator.geolocation.getCurrentPosition(pos=>{

    let ref = db.ref("jobs").push();

    ref.set({
      id: ref.key,
      title:title.value,
      desc:desc.value,
      price:price.value,
      phone:phone.value,
      lat:pos.coords.latitude,
      lng:pos.coords.longitude,
      user: currentUser.uid,
      time: Date.now()
    });

    alert("✅ Job ajouté");
    formBox.classList.add("hidden");

  });
}

// 📄 LISTE JOBS
function loadJobsList(){

  jobsList.innerHTML="Chargement...";

  db.ref("jobs").limitToLast(50).once("value",snap=>{

    jobsList.innerHTML="";

    snap.forEach(d=>{
      let j=d.val();

      jobsList.innerHTML+=`
      <div style="background:#222;margin:10px;padding:10px;border-radius:10px">
        <b>${j.title}</b><br>
        💰 ${j.price || ""}<br>

        <a href="https://wa.me/${j.phone}" style="color:#25D366">WhatsApp</a><br>
        <a href="tel:${j.phone}" style="color:#1E90FF">Appeler</a><br>

        <button onclick="openChat('${j.user}')">💬 Chat</button>

        ${(currentUser && (currentUser.uid===j.user || currentUser.uid===ADMIN_UID)) ?
        `<button onclick="deleteJob('${j.id}')" style="background:red;color:white">Supprimer</button>`:""}
      </div>
      `;
    });

  });
}

// 🗑️ DELETE
function deleteJob(id){
  db.ref("jobs/"+id).remove();
}

// 💬 CHAT GLOBAL
function showChat(){
  map.style.display="none";
  chatBox.classList.remove("hidden");
  jobsList.classList.add("hidden");
}

function sendMessage(){

  if(!currentUser)return;

  db.ref("messages").push({
    text:msgInput.value,
    user:currentUser.uid
  });

  msgInput.value="";
}

db.ref("messages").limitToLast(20).on("value",snap=>{

  messages.innerHTML="";

  snap.forEach(d=>{
    let m=d.val();

    messages.innerHTML+=`
    <div>${m.text}</div>
    `;
  });

});

// 🧭 NAV
function showMap(){
  map.style.display="block";
  jobsList.classList.add("hidden");
  chatBox.classList.add("hidden");
}

function showList(){
  map.style.display="none";
  jobsList.classList.remove("hidden");
  chatBox.classList.add("hidden");
  loadJobsList();
}

function showAccount(){
  map.style.display="none";
  accountBox.classList.remove("hidden");
  jobsList.classList.add("hidden");
  }
