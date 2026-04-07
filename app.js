let map, userMarker, jobs=[], routeLine;

const API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjlmYzFmYWRmNDMxNTRmNzliM2MyNzJiMTc0ODA5NzQyIiwiaCI6Im11cm11cjY0In0=";

/* NAV */
function showPage(p){
  document.querySelectorAll(".page").forEach(x=>x.classList.remove("active"));
  document.getElementById(p).classList.add("active");
  if(p==="mapPage") setTimeout(()=>map.invalidateSize(),200);
}

/* MAP */
function initMap(){

  const sat = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
  );

  const labels = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png"
  );

  map = L.map("map",{center:[3.848,11.502],zoom:17,layers:[sat,labels]});

  navigator.geolocation.watchPosition(pos=>{
    let lat=pos.coords.latitude;
    let lng=pos.coords.longitude;

    if(userMarker){
      userMarker.setLatLng([lat,lng]);
    }else{
      userMarker=L.circleMarker([lat,lng],{radius:12,color:"blue"}).addTo(map);
    }
  });

  loadJobs();
}

/* CENTER */
function centerUser(){
  if(userMarker){
    map.setView(userMarker.getLatLng(),18);
  }
}

/* ADD JOB */
function addJob(){

  let job={
    title:title.value,
    desc:desc.value,
    price:price.value,
    phone:phone.value,
    lat:userMarker.getLatLng().lat,
    lng:userMarker.getLatLng().lng,
    boosted:false
  };

  push(ref(db,"jobs"),job);

  formBox.classList.add("hidden");
}

/* LOAD */
function loadJobs(){
  onValue(ref(db,"jobs"),snap=>{
    jobs=[];
    map.eachLayer(l=>{
      if(l instanceof L.CircleMarker && l!==userMarker){
        map.removeLayer(l);
      }
    });

    snap.forEach(c=>{
      let job=c.val();
      jobs.push(job);
      addMarker(job);
    });

    displayJobs();
  });
}

/* MARKER */
function addMarker(job){

  let m=L.circleMarker([job.lat,job.lng],{
    radius:10,
    color:job.boosted?"gold":"green"
  }).addTo(map);

  m.bindPopup(`
    <b>${job.title}</b><br>
    ${job.desc}<br>
    💰 ${job.price}<br><br>

    <button onclick='routeTo(${JSON.stringify(job)})'>🧭 Itinéraire</button><br><br>

    <a href="https://wa.me/${job.phone}?text=Je viens de JobMarket">
    WhatsApp</a>
  `);
}

/* LIST */
function displayJobs(){
  jobsPage.innerHTML="";
  jobs.forEach(j=>{
    jobsPage.innerHTML+=`
    <div class="job-card">
      <b>${j.title}</b><br>
      ${j.desc}<br>
      💰 ${j.price}
    </div>`;
  });
}

/* ROUTE */
async function routeTo(job){

  let start=userMarker.getLatLng();

  let res=await fetch("https://api.openrouteservice.org/v2/directions/foot-walking",{
    method:"POST",
    headers:{
      "Authorization":API_KEY,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      coordinates:[
        [start.lng,start.lat],
        [job.lng,job.lat]
      ]
    })
  });

  let data=await res.json();

  let coords=data.features[0].geometry.coordinates;
  let route=coords.map(c=>[c[1],c[0]]);

  if(routeLine) map.removeLayer(routeLine);
  routeLine=L.polyline(route,{color:"blue"}).addTo(map);

  speak(data.features[0].properties.segments[0].steps);
}

/* VOICE */
function speak(steps){
  let i=0;
  function next(){
    if(i>=steps.length)return;
    let u=new SpeechSynthesisUtterance(steps[i].instruction);
    speechSynthesis.speak(u);
    i++;
    setTimeout(next,4000);
  }
  next();
}

/* AI */
async function askAI(){
  let msg=aiInput.value;

  let res=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{
      "Authorization":"Bearer blnk_ak_r0pHacaGW4nnsrvbeHq8PX_D4HM_cBmrLcm-99F501VQyJC0",
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:"gpt-4o-mini",
      messages:[{role:"user",content:msg}]
    })
  });

  let data=await res.json();
  aiResponse.innerText=data.choices[0].message.content;
}

/* FORM */
function openForm(){
  formBox.classList.remove("hidden");
    }
