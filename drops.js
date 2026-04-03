import { db } from "./firebase.js";

export function addJob() {
  const title = document.getElementById("title").value;
  const phone = document.getElementById("phone").value;

  fetch("https://jobmarket-backend-6gqm.onrender.com/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title, phone })
  })
  .then(res => res.json())
  .then(data => {
    alert("Job added!");
    console.log(data);
  });
}
