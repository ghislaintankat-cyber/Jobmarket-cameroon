import { renderJobs } from "./ui.js";

function loadJobs() {
  fetch("https://jobmarket-backend-6gqm.onrender.com/jobs")
    .then(res => res.json())
    .then(data => renderJobs(data));
}

loadJobs();
