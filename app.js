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

let map = L.map('map', {zoomControl:false}).setView([3.848,11.502],13);
L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    subdomains:['mt0','mt1','mt2','mt3']
}).addTo(map);

let jobsLayer = L.featureGroup().addTo(map);
let userCoords = null;
let routeControl = null;
let allJobs = [];

auth.signInAnonymously();

function locateMe(){
    navigator.geolocation.getCurrentPosition(pos=>{
        userCoords = {
            lat:pos.coords.latitude,
            lng:pos.coords.longitude
        };

        L.circleMarker([userCoords.lat,userCoords.lng],{
            radius:8,
            color:'#fff',
            fillColor:'#007AFF',
            fillOpacity:1
        }).addTo(map);

        map.flyTo([userCoords.lat,userCoords.lng],14);
        syncJobs();
    }, ()=>syncJobs());
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
            className:'',
            iconSize:[20,20],
            iconAnchor:[10,10]
        });

        L.marker([j.lat,j.lng],{icon}).addTo(jobsLayer)
        .bindPopup(`
            <div>
                <b>${j.title}</b><br>
                <span style="color:green">${j.price}</span><br>
                <small>${j.landmark || ''}</small>
                <a href="https://wa.me/${j.phone}" style="display:block;background:#25D366;color:white;padding:8px;text-align:center;border-radius:8px;margin-top:8px">WhatsApp</a>
                <a href="tel:${j.phone}" style="display:block;background:#007AFF;color:white;padding:8px;text-align:center;border-radius:8px;margin-top:5px">Appeler</a>
                <div style="text-align:center;color:gold;margin-top:8px">${'★'.repeat(Math.round(j.ratingAvg || 5))}</div>
                <button onclick="drawRoute(${j.lat},${j.lng})" style="width:100%;background:red;color:white;padding:8px;border:none;border-radius:8px;margin-top:8px">Itinéraire</button>
            </div>
        `);
    });

    updateJobsList(jobs);
}

function addJob(){
    const cat = document.getElementById('category').value.split('|');

    navigator.geolocation.getCurrentPosition(pos=>{
        const ref = db.ref('jobs').push();
        ref.set({
            title:title.value,
            price:price.value,
            phone:phone.value,
            landmark:landmark.value,
            desc:desc.value,
            icon:cat[0],
            color:cat[1],
            lat:pos.coords.latitude,
            lng:pos.coords.longitude,
            user:auth.currentUser.uid,
            ratingAvg:5,
            timestamp:Date.now()
        });

        toggleForm();
    });
}

function drawRoute(lat,lng){
    if(!userCoords) return alert('Active GPS');

    if(routeControl){
        map.removeControl(routeControl);
    }

    routeControl = L.Routing.control({
        waypoints:[
            L.latLng(userCoords.lat,userCoords.lng),
            L.latLng(lat,lng)
        ],
        routeWhileDragging:false,
        addWaypoints:false,
        createMarker:()=>null,
        lineOptions:{styles:[{color:'red',weight:5}]}
    }).addTo(map);
}

function updateJobsList(jobs){
    const list = document.getElementById('listContent');
    list.innerHTML = jobs.map(j=>`
        <div style="background:white;padding:15px;border-radius:15px;margin-bottom:10px">
            <b>${j.title}</b><br>
            <small>${j.dist.toFixed(1)} km</small><br>
            <b style="color:green">${j.price}</b>
            <a href="https://wa.me/${j.phone}" style="display:block;background:#25D366;color:white;padding:8px;text-align:center;border-radius:8px;margin-top:8px">WhatsApp</a>
        </div>
    `).join('');
}

function loginEmail(){
    auth.signInWithEmailAndPassword(email.value,password.value)
    .catch(e=>alert(e.message));
}

function loginGoogle(){
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider);
}

function toggleForm(){
    formBox.classList.toggle('hidden');
}

function showList(){
    jobsList.classList.remove('hidden');
}

function showMap(){
    jobsList.classList.add('hidden');
    accountPage.classList.add('hidden');
}

function openAccount(){
    accountPage.classList.remove('hidden');
}

function filterJobs(cat){
    if(cat==='all') return render(allJobs);
    render(allJobs.filter(j=>j.icon===cat));
}

function calcDist(la1,lo1,la2,lo2){
    const R=6371;
    const dLat=(la2-la1)*Math.PI/180;
    const dLon=(lo2-lo1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*(2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)));
}

locateMe();
