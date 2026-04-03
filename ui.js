export function renderJobs(jobs) {
  const list = document.getElementById("jobs");
  list.innerHTML = "";

  jobs.forEach(job => {
    const li = document.createElement("li");
    li.textContent = job.title + " - " + job.phone;
    list.appendChild(li);
  });
}
