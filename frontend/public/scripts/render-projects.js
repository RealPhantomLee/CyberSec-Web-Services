async function loadCards(){

const response = await fetch("data/portfolio.json?v=" + Date.now());
const projects = await response.json();

const grid = document.getElementById("projects-grid");

grid.innerHTML = "";

projects.forEach(project => {

const card = document.createElement("div");

card.className = "project-card";
card.dataset.slug = project.slug;

card.innerHTML = `
<div class="project-title">${project.title}</div>
<div class="project-desc">${project.description}</div>
`;

grid.appendChild(card);

});

}

loadCards();
