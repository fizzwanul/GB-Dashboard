const $ = (s, root = document) => root.querySelector(s); const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const API_URL = "https://script.google.com/macros/s/AKfycbxYpvxxkElZVostCLGLV51N_kU1ZsEDf1Th6Ax3FvApkTCvgg7mlvDiFF4IFJDBREyu/exec";

let currentDivision = "pendidikan";
let currentUser = null;
let globalData = { members: [], tasks: [], dashboard: [] };
let currentPage = "overview";
let isFetching = false;
let selectedMemberId = null; // Variabel penyimpan ID untuk fitur Detail Anggota

// === 1. BYPASS AUTENTIKASI (AKSES DEFAULT ADMIN) ===
async function initApp() {
  // Mode Testing: Langsung jadikan Admin agar semua fitur terbuka
  currentUser = {
    nama: "Admin Tester",
    email: "admin@genbi",
    role: "Admin",
    divisionKey: "pendidikan"
  };
  
  applyRolePermissions();
  await fetchDivisionData();
}

function applyRolePermissions() {
  const select = $("#divisionSelect");
  if (!select) return;
  // Karena bypass sebagai Admin, dropdown divisi dibiarkan aktif
  select.disabled = false;
}

// === 2. FETCH DATA ===
async function fetchDivisionData() {
  if (isFetching) return;
  isFetching = true;

  globalData = { members: [], tasks: [], dashboard: [] };
  $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>Memuat Data Google Sheets (${currentDivision.toUpperCase()})...</strong></div>`;

  try {
    const [membersRes, kpiRes] = await Promise.all([
      fetch(`${API_URL}?action=getMembers&division=${currentDivision}`).then(r => r.json()),
      fetch(`${API_URL}?action=getKPI&division=${currentDivision}`).then(r => r.json())
    ]);

    globalData.members = membersRes.data || [];
    globalData.tasks = kpiRes.data || [];
    render();
  } catch (e) {
    toast("Gagal memuat data divisi!");
  } finally {
    isFetching = false;
  }
}

// === 3. HELPER TAMPILAN ===
function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

function head(kicker, title, sub, action = "") {
  return `<div class="page-head"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="subtitle">${sub}</p></div><div class="head-actions">${action}</div></div>`;
}

function stat(label, value, icon, color, foot = "") {
  return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;
}

function badge(status) {
  let cls = status === "Selesai" ? "green" : status === "Proses" ? "orange" : "gray";
  return `<span class="badge badge-${cls}">${esc(status || "—")}</span>`;
}

function renderEvidenceLinks(evidenceStr) {
  if (!evidenceStr) return "—";
  const links = String(evidenceStr).split("\n").filter(l => l.trim().length > 0);
  return links.map((url, idx) => {
    let clean = url.trim();
    return /^https?:\/\//i.test(clean) ? `<a href="${esc(clean)}" target="_blank" rel="noopener">Bukti ${idx + 1} ↗</a>` : esc(clean);
  }).join("<br>");
}

// === 4. HALAMAN DASHBOARD & MONITORING TUGAS ===
function overview() {
  const tasks = globalData.tasks || [];
  const members = globalData.members || [];
  const done = tasks.filter(t => t.status === "Selesai").length;

  return `
    ${head("OVERVIEW", "Dashboard", `Monitoring Divisi ${currentDivision.toUpperCase()}`)}
    <div class="stats-grid">
      ${stat("Total Anggota", members.length, "♙", "blue", "Anggota terdaftar")}
      ${stat("Total Proker", tasks.length, "▤", "purple", "Program kerja")}
      ${stat("Proker Selesai", done, "▥", "green", "Telah selesai")}
    </div>
  `;
}

function taskRow(t) {
  const hasBukti = Boolean(t.bukti || t.linkBukti);
  const progresNum = Number(t.progres || 0);
  
  return `
    <tr>
      <td><strong>${esc(t.idProker || t.id || "—")}</strong></td>
      <td>${esc(t.namaProker || t.namaTugas || t.nama || "—")}</td>
      <td>${esc(t.divisi || currentDivision)}</td>
      <td>${esc(t.penanggungJawab || t.pj || "—")}</td>
      <td>${badge(t.status || "Belum Mulai")}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="progress-track" style="min-width:60px;"><div class="progress-fill" style="width:${progresNum}%"></div></div>
          ${progresNum}%
        </div>
      </td>
      <td>${esc(t.tenggat || t.tenggatWaktu || "—")}</td>
      <td>${renderEvidenceLinks(t.bukti || t.linkBukti)}</td>
      <td>${esc(t.catatan || "—")}</td>
      <td><button class="mini-btn" onclick="openUploadModal('${esc(t.idProker || t.id)}', '${progresNum}', '${esc(t.status)}')">${hasBukti ? "Edit Bukti" : "+ Tambah Bukti"}</button></td>
    </tr>
  `;
}

function tasksPage() {
  const tasks = globalData.tasks || [];
  const rows = tasks.map(taskRow).join("");
  const addBtn = `<button class="btn btn-primary" onclick="handleAddProkerPrompt()">＋ Tambah Proker Baru</button>`;

  return `
    ${head("DATA & MONITORING", "Monitoring Tugas", "Pantau tugas, progres, bukti, dan catatan situasi khusus.", addBtn)}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nama Tugas</th>
              <th>Divisi</th>
              <th>Penanggung Jawab</th>
              <th>Status</th>
              <th>Progres</th>
              <th>Tenggat</th>
              <th>Bukti</th>
              <th>Catatan</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="10" class="empty-cell">Belum ada proker terdaftar.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

// === 5. HALAMAN ANGGOTA & DETAIL PROFIL ===
function memberRow(m) {
  const id = m.idAnggota || m.id || "—";
  return `
    <tr>
      <td><strong>${esc(id)}</strong></td>
      <td><strong>${esc(m.namaLengkap || m.nama || "—")}</strong></td>
      <td>${esc(m.divisi || currentDivision)}</td>
      <td><div class="row-actions"><button class="mini-btn" data-member-detail="${esc(id)}">Detail</button></div></td>
    </tr>
  `;
}

function membersPage() {
  const members = globalData.members || [];
  const rows = members.map(memberRow).join("");

  return `
    ${head("DATA & MONITORING", "Monitoring Anggota", "Cari anggota dan buka profil detail.")}
    <section class="panel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID Anggota</th><th>Nama Lengkap</th><th>Divisi</th><th>Aksi</th></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="4" class="empty-cell">Belum ada anggota.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function memberDetailPage() {
  const members = globalData.members || [];
  const m = members.find(x => String(x.idAnggota || x.id) === String(selectedMemberId));
  
  if (!m) return membersPage();

  const backBtn = `<button class="btn btn-light" data-page="members">← Kembali ke daftar</button>`;
  
  return `
    ${head("MONITORING ANGGOTA", "Detail Anggota", `Profil lengkap ${esc(m.namaLengkap || m.nama)}.`, backBtn)}
    <div class="stats-grid">
      ${stat("Nama Anggota", esc(m.namaLengkap || m.nama), "♙", "blue", esc(m.idAnggota || m.id))}
      ${stat("Divisi", esc(m.divisi || currentDivision), "▣", "purple", "Divisi aktif")}
      ${stat("Role / Jabatan", esc(m.role || m.jabatan || "Anggota"), "✦", "green", "Posisi kepengurusan")}
      ${stat("Email", esc(m.email || "Belum diatur"), "◷", "orange", "Kontak anggota")}
    </div>
    <section class="panel">
      <div class="empty-cell"><strong>Biodata Lengkap</strong><span>Tampilan riwayat/biodata sedang dalam pengembangan.</span></div>
    </section>
  `;
}

// === 6. MODAL UPLOAD / ADD PROKER HANDLER ===
function openUploadModal(idProker, progres, status) {
  $("#formProkerId").value = idProker;
  $("#formProgres").value = progres;
  $("#formStatus").value = status;
  $("#formNewLink").value = "";
  $("#uploadModal")?.showModal();
}

async function handleSaveProker(e) {
  e.preventDefault();
  const payload = {
    action: "uploadEvidence",
    division: currentDivision,
    idProker: $("#formProkerId").value,
    progres: Number($("#formProgres").value),
    status: $("#formStatus").value,
    newLink: $("#formNewLink").value.trim()
  };

  toast("Menyimpan ke Google Sheets...");
  const fileInput = $("#formFile")?.files[0];

  if (fileInput) {
    const reader = new FileReader();
    reader.onload = async () => {
      payload.fileData = reader.result;
      payload.fileName = fileInput.name;
      payload.mimeType = fileInput.type;
      await sendPostPayload(payload);
    };
    reader.readAsDataURL(fileInput);
  } else {
    await sendPostPayload(payload);
  }
}

async function handleAddProkerPrompt() {
  const nama = prompt("Masukkan Nama Program Kerja / Tugas Baru:");
  if (!nama) return;
  toast("Menambahkan tugas baru...");
  await sendPostPayload({
    action: "addProker",
    division: currentDivision,
    prokerData: { namaProker: nama, target: 100, progres: 0, status: "Belum Mulai" }
  });
}

async function sendPostPayload(payload) {
  try {
    const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) }).then(r => r.json());
    if (res.status === "success") {
      toast("Berhasil disimpan!");
      $("#uploadModal")?.close();
      fetchDivisionData();
    } else {
      toast("Gagal: " + res.message);
    }
  } catch (err) {
    toast("Terjadi kesalahan koneksi!");
  }
}

// === 7. EVENT LISTENER & NAVIGASI ===
const pageRender = { 
  overview, 
  members: membersPage, 
  "member-detail": memberDetailPage,
  tasks: tasksPage 
};

function render() {
  const fn = pageRender[currentPage] || overview;
  $("#content").innerHTML = fn();   $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === (currentPage === "member-detail" ? "members" : currentPage)));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function go(page) {
  currentPage = page;
  render();
  $("#sidebar")?.classList.remove("open");
}

document.addEventListener("click", e => {
  // Navigasi Menu
  const nav = e.target.closest("[data-page]");
  if (nav) { go(nav.dataset.page); return; }

  // Klik Detail Anggota
  const detailBtn = e.target.closest("[data-member-detail]");
  if (detailBtn) {
    selectedMemberId = detailBtn.dataset.memberDetail;
    go("member-detail");
  }
});

document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "divisionSelect") {
    currentDivision = e.target.value;
    fetchDivisionData();
  }
});

$("#menuBtn").onclick = () => $("#sidebar")?.classList.toggle("open");

// Jalankan Inisialisasi Utama
initApp();