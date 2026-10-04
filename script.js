const $ = (s, root = document) => root.querySelector(s); const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const API_URL = "https://script.google.com/macros/s/AKfycbxYpvxxkElZVostCLGLV51N_kU1ZsEDf1Th6Ax3FvApkTCvgg7mlvDiFF4IFJDBREyu/exec";

let currentDivision = "pendidikan";
let currentUser = null;
let globalData = { members: [], tasks: [], dashboard: [] };
let currentPage = "overview";
let isFetching = false;
let selectedMemberId = null;

// === 1. BYPASS AUTENTIKASI (AKSES DEFAULT ADMIN) ===
async function initApp() {
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
  select.disabled = false;
}

// === 2. FETCH DATA DIVISI ===
async function fetchDivisionData() {
  const cacheKey = `genbi_cache_${currentDivision}`;
  const cachedData = sessionStorage.getItem(cacheKey);

  if (cachedData) {
    try {
      // 1. Tampilkan data dari cache secara INSTAN (0 detik loading)
      const parsed = JSON.parse(cachedData);
      globalData.members = parsed.members;
      globalData.tasks = parsed.tasks;
      render(); // Halaman langsung muncul tanpa teks "Memuat..."
    } catch (e) {}
  } else {
    // Kalau belum ada cache sama sekali, tampilkan teks loading standar
    if (!isFetching) {
      $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>Memuat Data Google Sheets (${currentDivision.toUpperCase()})...</strong></div>`;
    }
  }

  // 2. Tarik data terbaru dari Google Sheets di BALIK LAYAR (Background Sync)
  if (isFetching) return;
  isFetching = true;

  try {
    const [membersRes, kpiRes] = await Promise.all([
      fetch(`${API_URL}?action=getMembers&division=${currentDivision}`).then(r => r.json()),
      fetch(`${API_URL}?action=getKPI&division=${currentDivision}`).then(r => r.json())
    ]);

    const freshMembers = membersRes.data || [];
    const freshTasks = kpiRes.data || [];

    // Bandingkan apakah ada perubahan data
    const hasChanged = JSON.stringify(freshTasks) !== JSON.stringify(globalData.tasks);

    if (hasChanged || !cachedData) {
      globalData.members = freshMembers;
      globalData.tasks = freshTasks;

      // Update cache dengan data terbaru
      sessionStorage.setItem(cacheKey, JSON.stringify({
        members: freshMembers,
        tasks: freshTasks
      }));

      // Render ulang layar secara mulus jika ada perubahan data dari server
      render();
    }
  } catch (e) {
    // Jika offline/gagal fetch, biarkan pakai data cache yang sudah ada
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
  const prokerId = t.iDProker || t.idProker || t.IDProker || t.id || "";
  const namaTugas = t.namaProgramKerja || t.namaProker || t.namaTugas || t.nama || "—";
  const picTugas = t.pIC || t.penanggungJawab || t.pj || "—";
  const linkBukti = t.linkBuktiUtama || t.bukti || t.linkBukti || "";
  const hasBukti = Boolean(linkBukti);
  
  // FIX PERSENTASE: Mengubah format desimal Google Sheets jadi persentase normal
  let rawProgres = Number(t.progres || t.Progres || t['%Progres'] || 0);
  const progresNum = (rawProgres > 0 && rawProgres <= 1) ? Math.round(rawProgres * 100) : rawProgres;
  
  // Rapikan format tanggal kalau dari Google Sheets bentuknya aneh
  let tenggatTampil = t.tenggat || t.tenggatWaktu || "—";
  if (String(tenggatTampil).includes('T')) {
    tenggatTampil = tenggatTampil.split('T')[0];
  }

  return `
    <tr>
      <td><strong>${esc(prokerId)}</strong></td>
      <td>${esc(namaTugas)}</td>
      <td>${esc(t.divisi || currentDivision)}</td>
      <td>${esc(picTugas)}</td>
      <td>${badge(t.status || "Belum Mulai")}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="progress-track" style="min-width:60px;"><div class="progress-fill" style="width:${progresNum}%"></div></div>
          ${progresNum}%
        </div>
      </td>
      <td>${esc(tenggatTampil)}</td>
      <td>${renderEvidenceLinks(linkBukti)}</td>
      <td>${esc(t.catatan || "—")}</td>
      <td><button class="mini-btn" onclick="openUploadModal('${esc(prokerId)}')">${hasBukti ? "Edit Bukti" : "+ Tambah Bukti"}</button></td>
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

// === 5. HALAMAN ANGGOTA & DETAIL PROFIL (DENGAN TRACKER TAB) ===
function memberRow(m) {
  const id = m.idAnggota || m.id || "—";
  return `
    <tr>
      <td><strong>${esc(id)}</strong></td>
      <td><strong>${esc(m.namaLengkap || m.nama || "—")}</strong></td>
      <td>${esc(m.divisi || currentDivision)}</td>
      <td><button class="mini-btn" data-member-detail="${esc(id)}">Detail</button></td>
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
            <tr>
              <th>ID Anggota</th>
              <th>Nama Lengkap</th>
              <th>Divisi</th>
              <th>Aksi</th>
            </tr>
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
  const namaPanggilan = m.panggilan || m.namaPanggilan || m.namaLengkap.split(' ')[0];
  
  // Ambil data tracker dari tab perorangan di Google Sheets
  fetch(`${API_URL}?action=getTracker&division=${currentDivision}&nickname=${namaPanggilan}`)
    .then(r => r.json())
    .then(res => {
      const tbody = $("#trackerTableBody");
      if (!tbody) return;
      
      if (res.status === "success" && res.data.length > 0) {
        tbody.innerHTML = res.data.map(t => `
          <tr>
            <td style="white-space: nowrap;">${esc(t.tanggal instanceof Date ? t.tanggal.toLocaleDateString('id-ID') : t.tanggal)}</td>
            <td>
              <strong>${esc(t.kegiatan)}</strong> 
              <span class="badge ${t.poin > 0 ? 'badge-green' : (t.poin < 0 ? 'badge-red' : 'badge-gray')}" style="margin-left:8px;">${t.poin > 0 ? '+' : ''}${esc(t.poin)} Poin</span>
              <br><small>${esc(t.catatan)}</small>
            </td>
          </tr>
        `).join("");
      } else {
        tbody.innerHTML = `<tr><td colspan="2" class="empty-cell">Belum ada riwayat / Tab '${namaPanggilan}' tidak ditemukan.</td></tr>`;
      }
    });

  return `
    ${head("MONITORING ANGGOTA", "Detail Anggota", `Profil dan catatan tracker ${esc(m.namaLengkap || m.nama)}.`, backBtn)}
    
    <div class="stats-grid">
      ${stat("Nama Anggota", esc(m.namaLengkap || m.nama), "♙", "blue", esc(m.idAnggota || m.id))}
      ${stat("Divisi", esc(m.divisi || currentDivision), "▣", "purple", "Divisi aktif")}
      ${stat("Role / Jabatan", esc(m.role || m.jabatan || "Anggota"), "✦", "green", "Posisi kepengurusan")}
      ${stat("Tab Panggilan", esc(namaPanggilan), "◷", "orange", "Referensi sheet")}
    </div>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Catatan Tracker Jabatan</h2>
          <p>Daftar riwayat aktivitas, keaktifan, dan evaluasi anggota.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width: 150px;">Tanggal</th>
              <th>Aktivitas & Catatan Auditor</th>
            </tr>
          </thead>
          <tbody id="trackerTableBody">
            <tr><td colspan="2" style="text-align:center; padding: 30px;"><em>Memuat riwayat tracker...</em></td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

// === 6. MODAL UPLOAD LINK & TAMBAH PROKER ===
function openUploadModal(idProker) {
  const task = globalData.tasks.find(t => String(t.iDProker || t.idProker || t.id) === String(idProker));
  if (!task) {
    toast("ID Proker tidak ditemukan!");
    return;
  }
  
  $("#formProkerId").value = idProker;
  $("#modalProkerTitle").textContent = `Update: ${task.namaProgramKerja || task.namaProker || idProker}`;
  
  // Konversi progres untuk input form
  let rawProgres = Number(task.progres || task.Progres || task['%Progres'] || 0);
  $("#formProgres").value = (rawProgres > 0 && rawProgres <= 1) ? Math.round(rawProgres * 100) : rawProgres;
  
  $("#formStatus").value = task.status || "Belum Mulai";
  $("#formPic").value = task.pIC || task.penanggungJawab || task.pj || "";
  $("#formCatatan").value = task.catatan || "";
  $("#formExistingLink").value = task.linkBuktiUtama || task.bukti || task.linkBukti || "";
  $("#formNewLink").value = ""; 

  // Ambil tanggal untuk ditaruh di type="date"
  let tgl = task.tenggat || task.tenggatWaktu || "";
  if (String(tgl).includes('T')) tgl = String(tgl).split('T')[0];
  $("#formTenggat").value = tgl;
  
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
    pic: $("#formPic").value.trim(),
    catatan: $("#formCatatan").value.trim(),
    existingEvidence: $("#formExistingLink").value,
    newLink: $("#formNewLink").value.trim(),
    tenggat: $("#formTenggat").value // Menangkap inputan tanggal
  };

  toast("Menyimpan data ke Google Sheets...");
  await sendPostPayload(payload);
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
  const nav = e.target.closest("[data-page]");
  if (nav) { go(nav.dataset.page); return; }

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