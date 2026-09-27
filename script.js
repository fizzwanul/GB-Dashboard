const $ = (s, root = document) => root.querySelector(s); const $$ = (s, root = document) => [...root.querySelectorAll(s)];

// === 1. KONFIGURASI API GOOGLE SHEETS ===
const API_URL = "https://script.google.com/macros/s/AKfycbxYpvxxkElZVostCLGLV51N_kU1ZsEDf1Th6Ax3FvApkTCvgg7mlvDiFF4IFJDBREyu/exec";

let currentDivision = "pendidikan";
let globalData = {
  members: [],
  tasks: [],
  dashboard: []
};

let currentPage = "overview";

// === 2. FUNGSI FETCH DATA DARI API (PERUBAHAN 2) ===
async function fetchDivisionData() {
  toast("Memuat data Google Sheets...");
  try {
    const [membersRes, kpiRes, dashRes] = await Promise.all([
      fetch(`${API_URL}?action=getMembers&division=${currentDivision}`).then(r => r.json()),
      fetch(`${API_URL}?action=getKPI&division=${currentDivision}`).then(r => r.json()),
      fetch(`${API_URL}?action=getDashboard&division=${currentDivision}`).then(r => r.json())
    ]);

    globalData.members = membersRes.data || [];
    globalData.tasks = kpiRes.data || [];
    globalData.dashboard = dashRes.data || [];

    render();
  } catch (e) {
    toast("Gagal mengambil data dari Google Sheets!");
  }
}

// === FUNGSI HELPER TAMPILAN ===
function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2400);
}

function head(kicker, title, sub, action = "") {
  return `
    <div class="page-head">
      <div>
        <p class="eyebrow">${kicker}</p>
        <h1>${title}</h1>
        <p class="subtitle">${sub}</p>
      </div>
      <div class="head-actions">${action}</div>
    </div>
  `;
}

function stat(label, value, icon, color, foot = "") {
  return `
    <article class="stat-card">
      <div class="stat-top">
        <span class="stat-label">${label}</span>
        <span class="stat-icon ${color}">${icon}</span>
      </div>
      <div class="stat-value">${value}</div>
      <div class="stat-foot">${foot}</div>
    </article>
  `;
}

function emptyRow(cols, msg = "Belum ada data") {
  return `
    <tr>
      <td colspan="${cols}" class="empty-cell">
        <div style="font-size:24px">▤</div>
        <strong>${msg}</strong>
        <span>Data akan muncul setelah diisi di Google Sheets.</span>
      </td>
    </tr>
  `;
}

function badge(status) {
  let cls = status === "Selesai" || status === "Memenuhi" ? "green" : status === "Proses" ? "orange" : "gray";
  return `<span class="badge badge-${cls}">${esc(status || "—")}</span>`;
}

function table(headers, rows, emptyText) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>
        </thead>
        <tbody>${rows || emptyRow(headers.length, emptyText)}</tbody>
      </table>
    </div>
  `;
}

// === TAMPILAN HALAMAN DENGAN DATA GOOGLE SHEETS ===
function overview() {
  const tasks = globalData.tasks || [];
  const members = globalData.members || [];
  const done = tasks.filter(t => t.status === "Selesai" || t.progres === 100 || t.progres === "100%").length;

  return `
    ${head("OVERVIEW", "Dashboard", `Monitoring Divisi ${currentDivision.toUpperCase()}`)}
    <div class="stats-grid">
      ${stat("Total Anggota", members.length, "♙", "blue", "Anggota terdaftar")}
      ${stat("Total Proker", tasks.length, "▤", "purple", "Program kerja")}
      ${stat("Proker Selesai", done, "▥", "green", "Telah selesai")}
      ${stat("Divisi Aktif", currentDivision.toUpperCase(), "✦", "orange", "Terhubung GS")}
    </div>
    ${taskStatusPanel()}
  `;
}

function taskStatusPanel() {
  const tasks = globalData.tasks || [];
  const total = tasks.length;

  if (total === 0) {
    return `
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Status Program Kerja</h2>
            <p>Belum ada data proker di Google Sheets untuk divisi ini.</p>
          </div>
        </div>
      </section>
    `;
  }

  const done = tasks.filter(t => t.status === "Selesai" || t.progres === 100 || t.progres === "100%").length;
  const process = tasks.filter(t => t.status === "Proses" || (t.progres > 0 && t.progres < 100)).length;
  const pending = total - done - process;

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Status Program Kerja Divisi</h2>
          <p>Ringkasan status proker yang tercatat di Google Sheets.</p>
        </div>
      </div>
      <div class="legend" style="display:flex; gap:20px;">
        <div><span>Belum Mulai: </span><strong>${pending}</strong></div>
        <div><span>Proses: </span><strong>${process}</strong></div>
        <div><span>Selesai: </span><strong>${done}</strong></div>
      </div>
    </section>
  `;
}

function memberRow(m) {
  return `
    <tr>
      <td><strong>${esc(m.idAnggota || m.id || "—")}</strong></td>
      <td><strong>${esc(m.namaLengkap || m.nama || "—")}</strong></td>
      <td>${esc(m.divisi || currentDivision)}</td>
      <td>${esc(m.role || "Anggota")}</td>
    </tr>
  `;
}

function membersPage() {
  const members = globalData.members || [];
  const rows = members.map(memberRow).join("");

  return `
    ${head("DATA & MONITORING", "Monitoring Anggota", "Daftar anggota divisi dari Google Sheets.")}
    <section class="panel">
      ${table(["ID Anggota", "Nama Lengkap", "Divisi", "Role"], rows, "Belum ada anggota terdaftar")}
    </section>
  `;
}

function taskRow(t) {
  return `
    <tr>
      <td><strong>${esc(t.idProker || t.id || "—")}</strong></td>
      <td>${esc(t.namaProker || t.nama || "—")}</td>
      <td>${esc(t.target || "—")}</td>
      <td>${badge(t.status || "Proses")}</td>
      <td>${esc(t.progres || "0")}%</td>
    </tr>
  `;
}

function tasksPage() {
  const tasks = globalData.tasks || [];
  const rows = tasks.map(taskRow).join("");

  return `
    ${head("DATA & MONITORING", "Monitoring Proker", "Pantau indikator kinerja proker divisi.")}
    <section class="panel">
      ${table(["ID Proker", "Nama Proker", "Target", "Status", "Progres"], rows, "Belum ada proker terdaftar")}
    </section>
  `;
}

// === NAVIGASI HALAMAN ===
const pageRender = {
  overview,
  members: membersPage,
  tasks: tasksPage
};

function render() {
  const fn = pageRender[currentPage] || overview;
  $("#content").innerHTML = fn();   $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === currentPage));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function go(page) {
  currentPage = page;
  render();
  $("#sidebar")?.classList.remove("open");
}

document.addEventListener("click", e => {
  const nav = e.target.closest("[data-page]");
  if (nav) go(nav.dataset.page);
});

$("#menuBtn").onclick = () => $("#sidebar")?.classList.toggle("open");

// === 3. EVENT LISTENER DROPDOWN DIVISI & INITIAL LOAD (PERUBAHAN 3) ===
document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "divisionSelect") {
    currentDivision = e.target.value;
    fetchDivisionData();
  }
});

// Jalankan pertama kali saat web dibuka
fetchDivisionData();