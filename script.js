const $ = (s, root = document) => root.querySelector(s); const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const API_URL = "https://script.google.com/macros/s/AKfycbxYpvxxkElZVostCLGLV51N_kU1ZsEDf1Th6Ax3FvApkTCvgg7mlvDiFF4IFJDBREyu/exec";
const GOOGLE_CLIENT_ID = "913208175994-26v5bqfrqftd4ijpg6an1ihisnqmeu1a.apps.googleusercontent.com";

let currentDivision = "pendidikan";
let currentUser = null; // null = guest (belum login)
let idToken = null;
let globalData = { members: [], tasks: [], dashboard: [], allMembers: [] };
let currentPage = "members";
let isFetching = false;
let currentFetchDivision = null; // Untuk mencegah race condition
let selectedMemberId = null;
let memberQuery = "";

const DIVISION_LABELS = {
  inti: "Pengurus Inti",
  pendidikan: "Pendidikan",
  pubsos: "Publikasi & Sosialisasi",
  pengabdian: "Pengabdian Masyarakat",
  kewirausahaan: "Kewirausahaan",
  lingkungan: "Lingkungan Hidup"
};
const isGuest = () => !currentUser;

// === 1. INISIALISASI: GOOGLE LOGIN ===
async function initApp() {
  const savedUser = sessionStorage.getItem("genbi_user");
  const savedToken = sessionStorage.getItem("genbi_token");
  
  if (savedUser && savedToken) {
    try {
      currentUser = JSON.parse(savedUser);
      idToken = savedToken;
      currentDivision = currentUser.divisionKey || "pendidikan";
      currentPage = "overview";
    } catch(e) {
      currentUser = null; idToken = null; currentPage = "members";
    }
  } else {
    currentUser = null; idToken = null; currentPage = "members";
  }

  applyRolePermissions();
  
  if (window.google) initializeGoogleSignIn();
  else window.addEventListener('load', initializeGoogleSignIn);

  if (isGuest()) await fetchAllMembers();
  else {
    render(); // Render dashboard state directly
    await fetchDivisionData();
  }
}

function initializeGoogleSignIn() {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
    cancel_on_tap_outside: false
  });
  
  if (isGuest()) {
    const btnContainer = document.getElementById("googleLoginBtn");
    if (btnContainer) {
      btnContainer.innerHTML = "";
      google.accounts.id.renderButton(btnContainer, { theme: "outline", size: "medium", shape: "pill" });
    }
  }
}

async function handleCredentialResponse(response) {
  const token = response.credential;
  toast("Memvalidasi login...");
  
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "verifyLogin", idToken: token })
    }).then(r => r.json());
    
    if (res.status === "success") {
      currentUser = res.user;
      idToken = token;
      currentDivision = currentUser.divisionKey || "pendidikan";
      currentPage = "overview";
      
      sessionStorage.setItem("genbi_user", JSON.stringify(currentUser));
      sessionStorage.setItem("genbi_token", token);
      
      toast(`Selamat datang, ${currentUser.nama}!`);
      applyRolePermissions();
      
      const btnContainer = document.getElementById("googleLoginBtn");
      if (btnContainer) btnContainer.style.display = "none";
      
      render();
      await fetchDivisionData();
    } else {
      toast(res.message || "Gagal login.");
      google.accounts.id.revoke(token, () => {});
    }
  } catch (e) {
    toast("Kesalahan jaringan saat validasi login.");
  }
}

function handleLogout() {
  if (idToken && window.google) google.accounts.id.revoke(idToken, () => {});
  sessionStorage.removeItem("genbi_user");
  sessionStorage.removeItem("genbi_token");
  currentUser = null; idToken = null; currentPage = "members";
  toast("Anda telah keluar.");
  applyRolePermissions();
  render();
  fetchAllMembers();
  setTimeout(() => initializeGoogleSignIn(), 100);
}

function applyRolePermissions() {
  const guest = isGuest();
  const select = $("#divisionSelect");
  if (select) {
    select.disabled = false;
    select.style.display = guest ? "none" : "";
    if (!guest && currentUser && currentUser.divisionKey) select.value = currentDivision;
  }
  
  $$(".nav-item").forEach(b => {
    const page = b.dataset.page;
    b.style.display = guest && page !== "members" ? "none" : "";
  });
  const membersNav = $('.nav-item[data-page="members"]');
  if (membersNav) membersNav.lastChild.textContent = guest ? " Cari Anggota" : " Monitoring Anggota";

  const googleBtn = $("#googleLoginBtn");
  if (googleBtn) googleBtn.style.display = guest ? "block" : "none";
  const loginBtn = $("#loginBtn");
  if (loginBtn) loginBtn.style.display = "none"; // Hide fallback button entirely
  
  const userProfile = $("#userProfile");
  if (userProfile) {
    userProfile.style.display = guest ? "none" : "flex";
    const userBadge = $("#userBadge");
    if (userBadge && !guest) {
      userBadge.textContent = `${currentUser.nama} · ${currentUser.role}`;
    }
  }
}

// === 1b. FETCH DAFTAR ANGGOTA SEMUA DIVISI (MODE GUEST) ===
async function fetchAllMembers() {
  const cacheKey = "genbi_cache_all_members";
  let cachedData = null;
  try { cachedData = sessionStorage.getItem(cacheKey); } catch (e) {}

  if (cachedData) {
    try {
      globalData.allMembers = JSON.parse(cachedData);
      render();
    } catch (e) { cachedData = null; }
  }
  if (!cachedData) {
    $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>Memuat daftar anggota...</strong></div>`;
  }

  try {
    const res = await fetch(`${API_URL}?action=getAllMembers`).then(r => r.json());
    const fresh = res.data || [];
    if (!cachedData || JSON.stringify(fresh) !== JSON.stringify(globalData.allMembers)) {
      globalData.allMembers = fresh;
      try { sessionStorage.setItem(cacheKey, JSON.stringify(fresh)); } catch (e) {}
      // Jangan render ulang kalau user sedang mengetik di kolom cari
      if (document.activeElement?.id !== "memberSearch") render();
    }
  } catch (e) {
    if (!cachedData) {
      $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>Gagal memuat data. Periksa koneksi lalu muat ulang halaman.</strong></div>`;
    }
  }
}

// === 2. FETCH DATA DIVISI ===
async function fetchDivisionData() {
  const targetDivision = currentDivision; // Capture divisi saat ini untuk memblokir race condition
  currentFetchDivision = targetDivision;

  const cacheKey = `genbi_cache_${targetDivision}`;
  const cachedData = sessionStorage.getItem(cacheKey);

  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      globalData.members = parsed.members;
      globalData.tasks = parsed.tasks;
      if (currentFetchDivision === targetDivision) render();
    } catch (e) {}
  } else {
    if (!isFetching) {
      $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>Memuat Data Google Sheets (${targetDivision.toUpperCase()})...</strong></div>`;
    }
  }

  if (isFetching) return;
  isFetching = true;

  try {
    const [membersRes, kpiRes] = await Promise.all([
      fetch(`${API_URL}?action=getMembers&division=${targetDivision}`).then(r => r.json()),
      fetch(`${API_URL}?action=getKPI&division=${targetDivision}`).then(r => r.json())
    ]);

    const freshMembers = membersRes.data || [];
    const freshTasks = kpiRes.data || [];

    // Bandingkan apakah ada perubahan data (members ATAU tasks)
    const membersChanged = JSON.stringify(freshMembers) !== JSON.stringify(globalData.members);
    const tasksChanged = JSON.stringify(freshTasks) !== JSON.stringify(globalData.tasks);
    const hasChanged = membersChanged || tasksChanged;

    if (hasChanged || !cachedData) {
      // Pastikan user belum pindah divisi sebelum data selesai dimuat
      if (currentFetchDivision === targetDivision) {
        globalData.members = freshMembers;
        globalData.tasks = freshTasks;

        sessionStorage.setItem(cacheKey, JSON.stringify({
          members: freshMembers,
          tasks: freshTasks
        }));

        render();
      }
    }
  } catch (e) {
    console.error("Gagal memuat data dari server:", e);
  } finally {
    isFetching = false;
    // Jika ada request pindah divisi tertunda yang diblokir oleh isFetching
    if (currentFetchDivision !== currentDivision) {
      fetchDivisionData(); 
    }
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
// Backend mengubah header "ID Anggota" menjadi key "iDAnggota", jadi cek beberapa kemungkinan.
// Kalau kolom ID kosong, pakai nama lengkap agar tombol Detail tetap berfungsi.
// Untuk daftar lintas divisi (guest), awalan divisionKey menjaga ID tetap unik.
function getMemberId(m) {
  const base = String(m.iDAnggota || m.idAnggota || m.IDAnggota || m.id || m.namaLengkap || m.nama || "").trim();
  return (m.divisionKey ? m.divisionKey + "|" : "") + base;
}

function getMemberDivisionKey(m) {
  return m.divisionKey || currentDivision;
}

function currentMemberList() {
  return isGuest() ? (globalData.allMembers || []) : (globalData.members || []);
}

function filterMembers(list, query) {
  const named = list.filter(m => m.namaLengkap || m.nama);
  const q = String(query || "").trim().toLowerCase();
  if (!q) return named;
  return named.filter(m => [
    m.namaLengkap, m.nama, m.namaPanggilan, m.panggilan,
    m.divisi, DIVISION_LABELS[getMemberDivisionKey(m)], m.role, m.iDAnggota
  ].some(v => String(v || "").toLowerCase().includes(q)));
}

function memberRow(m) {
  const id = getMemberId(m);
  const idTampil = m.iDAnggota || m.idAnggota || m.IDAnggota || m.id || "—";
  const divTampil = m.divisi || DIVISION_LABELS[getMemberDivisionKey(m)] || getMemberDivisionKey(m);
  return `
    <tr>
      <td><strong>${esc(idTampil)}</strong></td>
      <td><strong>${esc(m.namaLengkap || m.nama || "—")}</strong></td>
      <td>${esc(divTampil)}</td>
      <td><button class="mini-btn" data-member-detail="${esc(id)}">Detail</button></td>
    </tr>
  `;
}

function memberRows(list) {
  const filtered = filterMembers(list, memberQuery);
  if (filtered.length === 0) {
    const msg = memberQuery ? `Tidak ada anggota yang cocok dengan "${esc(memberQuery)}".` : "Belum ada anggota.";
    return `<tr><td colspan="4" class="empty-cell">${msg}</td></tr>`;
  }
  return filtered.map(memberRow).join("");
}

// Hanya isi tabel yang diganti agar kolom cari tidak kehilangan fokus saat mengetik
function onMemberSearch(value) {
  memberQuery = value;
  const tbody = $("#memberTableBody");
  if (tbody) tbody.innerHTML = memberRows(currentMemberList());
}

function membersPage() {
  const guest = isGuest();
  const members = currentMemberList();

  return `
    ${head(
      guest ? "PROFIL ANGGOTA" : "DATA & MONITORING",
      guest ? "Cari Anggota" : "Monitoring Anggota",
      guest ? "Cari anggota GenBI dari semua divisi dan buka profilnya." : "Cari anggota dan buka profil detail."
    )}
    <section class="panel">
      <div class="toolbar">
        <input id="memberSearch" type="search" placeholder="Cari nama, panggilan, divisi, atau role..." value="${esc(memberQuery)}" oninput="onMemberSearch(this.value)" autocomplete="off">
      </div>
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
          <tbody id="memberTableBody">${memberRows(members)}</tbody>
        </table>
      </div>
    </section>
  `;
}

function memberDetailPage() {
  const m = currentMemberList().find(x => getMemberId(x) === String(selectedMemberId));
  
  if (!m) return membersPage();

  const divKey = getMemberDivisionKey(m);
  const backBtn = `<button class="btn btn-light" data-page="members">← Kembali ke daftar</button>`;
  const namaPanggilan = m.panggilan || m.namaPanggilan || String(m.namaLengkap || m.nama || "").split(' ')[0];
  
  // Ambil data tracker dari tab perorangan di Google Sheets
  fetch(`${API_URL}?action=getTracker&division=${encodeURIComponent(divKey)}&nickname=${encodeURIComponent(namaPanggilan)}`)
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
        tbody.innerHTML = `<tr><td colspan="2" class="empty-cell">Belum ada riwayat / Tab '${esc(namaPanggilan)}' tidak ditemukan.</td></tr>`;
      }
    })
    .catch(() => {
      const tbody = $("#trackerTableBody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="2" class="empty-cell">Gagal memuat riwayat. Periksa koneksi.</td></tr>`;
    });

  return `
    ${head("MONITORING ANGGOTA", "Detail Anggota", `Profil dan catatan tracker ${esc(m.namaLengkap || m.nama)}.`, backBtn)}
    
    <div class="stats-grid">
      ${stat("Nama Anggota", esc(m.namaLengkap || m.nama), "♙", "blue", esc(m.iDAnggota || m.idAnggota || m.id || "—"))}
      ${stat("Divisi", esc(m.divisi || DIVISION_LABELS[divKey] || divKey), "▣", "purple", "Divisi aktif")}
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
  $("#formLinkBukti").value = task.linkBuktiUtama || task.bukti || task.linkBukti || "";

  // Ambil tanggal untuk ditaruh di type="date"
  let tgl = task.tenggat || task.tenggatWaktu || "";
  if (String(tgl).includes('T')) tgl = String(tgl).split('T')[0];
  $("#formTenggat").value = tgl;
  
  $("#uploadModal")?.showModal();
}

function handleAddProkerPrompt() {
  const namaProker = prompt("Masukkan nama Program Kerja baru:");
  if (!namaProker) return;
  
  const payload = {
    action: "addProker",
    division: currentDivision,
    prokerData: { namaProker: namaProker.trim() }
  };
  
  toast("Menyiapkan proker baru...");
  sendPostPayload(payload);
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
   tenggat: $("#formTenggat").value,
   linkBukti: $("#formLinkBukti").value.trim() // Cukup kirim 1 data link ini saja
  };

  toast("Menyimpan data ke Google Sheets...");
  await sendPostPayload(payload);
}

async function sendPostPayload(payload) {
  if (idToken) payload.idToken = idToken;
  try {
    const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) }).then(r => r.json());
    if (res.status === "success") {
      toast(res.message || "Berhasil disimpan!");
      $("#uploadModal")?.close();
      
      // PENTING: Hapus cache ingatan lama agar layar langsung mengambil data baru!
      sessionStorage.removeItem(`genbi_cache_${currentDivision}`);
      
      // Tarik ulang data ke layar
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
  // Guest hanya boleh melihat pencarian anggota & profil
  if (isGuest() && !["members", "member-detail"].includes(currentPage)) currentPage = "members";
  const fn = pageRender[currentPage] || overview;
  $("#content").innerHTML = fn();   
  $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === (currentPage === "member-detail" ? "members" : currentPage)));
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
  
  // Close sidebar on mobile when clicking outside
  const sidebar = $("#sidebar");
  if (sidebar && sidebar.classList.contains("open") && !e.target.closest("#sidebar") && !e.target.closest("#menuBtn")) {
    sidebar.classList.remove("open");
  }
});

document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "divisionSelect") {
    currentDivision = e.target.value;
    fetchDivisionData();
  }
});

$("#menuBtn").onclick = () => $("#sidebar")?.classList.toggle("open");

// Swipe Gestures for Mobile Sidebar
let touchStartX = 0;
document.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].screenX;
}, {passive: true});

document.addEventListener('touchend', e => {
  const touchEndX = e.changedTouches[0].screenX;
  const swipeDist = touchEndX - touchStartX;
  const sidebar = $("#sidebar");
  if (!sidebar) return;
  
  // Usap ke kanan untuk membuka (jika mulai dari pinggir kiri)
  if (swipeDist > 50 && touchStartX < 30) {
    sidebar.classList.add("open");
  }
  // Usap ke kiri untuk menutup
  if (swipeDist < -50 && sidebar.classList.contains("open")) {
    sidebar.classList.remove("open");
  }
}, {passive: true});

// Jalankan Inisialisasi Utama
initApp();