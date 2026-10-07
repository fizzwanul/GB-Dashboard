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
    } else if (res.status === "debug_error") {
      const dbg = `DIAGNOSTIC LOGIN GAGAL:\n\nHTTP Code: ${res.httpCode}\nValid Audience: ${res.validAud}\nValid Issuer: ${res.validIss}\nValid Expiry: ${res.validExp}\nEmail Verified: ${res.emailVerified}\nHas Email: ${res.hasEmail}\nHas Sub: ${res.hasSub}`;
      alert(dbg);
      toast("Login ditolak. Lihat alert diagnostik.");
      google.accounts.id.revoke(token, () => {});
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
    const userAvatar = $("#userAvatar");
    if (!guest) {
      if (userBadge) userBadge.textContent = `${currentUser.nama} · ${currentUser.role}`;
      if (userAvatar) userAvatar.textContent = String(currentUser.nama).charAt(0).toUpperCase();
    }
  }
}

function openMyProfile() {
  selectedMemberId = "me";
  go("member-detail");
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
      fetch(`${API_URL}?action=getMembers&division=${targetDivision}${idToken ? '&idToken=' + idToken : ''}`).then(r => r.json()),
      fetch(`${API_URL}?action=getKPI&division=${targetDivision}${idToken ? '&idToken=' + idToken : ''}`).then(r => r.json())
    ]);

    const freshMembers = membersRes.data || [];
    const freshTasks = kpiRes.data || [];
    
    if (membersRes.status === "error") {
      toast(membersRes.message);
      if (membersRes.message.includes("Akses ditolak")) {
        // Clean screen or show error
        $("#content").innerHTML = `<div style="text-align:center; padding:50px;"><strong>${membersRes.message}</strong></div>`;
        return;
      }
    }

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
  const namaTugas = t.namaProgramKerja || t.namaProker || t.namaTugas || t.nama || "-";
  const picTugas = t.pIC || t.penanggungJawab || t.pj || "-";
  const linkBukti = t.linkBuktiUtama || t.bukti || t.linkBukti || "";
  const hasBukti = Boolean(linkBukti);
  
  let rawProgres = Number(t.progres || t.Progres || t['%Progres'] || 0);
  const progresNum = (rawProgres > 0 && rawProgres <= 1) ? Math.round(rawProgres * 100) : rawProgres;
  
  let tenggatTampil = t.tenggat || t.tenggatWaktu || "-";
  if (String(tenggatTampil).includes('T')) tenggatTampil = tenggatTampil.split('T')[0];

  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isKoord = roleLower.includes("koordinator") || roleLower.includes("kord");
  const isGlobalScope = t.scope === "global";
  
  const canManage = isAdmin || (isKoord && (isGlobalScope || currentUser.divisionKey === currentDivision));

  let actionsHTML = "-";
  if (canManage) {
    actionsHTML = `
      <div style="display:flex;align-items:center;gap:4px">
        <button class="mini-btn" onclick="openUploadModal('${esc(prokerId)}')">Edit</button>
        <button class="mini-btn" style="background:#fce8e8;color:#d32f2f;" onclick="handleDeleteProker('${esc(prokerId)}', '${isGlobalScope ? 'global' : 'divisi'}')">Hapus</button>
      </div>
    `;
  }

  return `
    <tr>
      <td><strong>${esc(prokerId)}</strong>${isGlobalScope ? ' <span class="badge badge-purple" style="font-size:0.7em">Global</span>' : ''}</td>
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
      <td>${esc(t.catatan || "-")}</td>
      <td>${actionsHTML}</td>
    </tr>
  `;
}

function tasksPage() {
  const tasks = globalData.tasks || [];
  const rows = tasks.map(taskRow).join("");
  
  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isKoord = roleLower.includes("koordinator") || roleLower.includes("kord");
  
  let addBtn = "";
  if (isAdmin || isKoord) {
    addBtn = `<button class="btn btn-primary" onclick="handleAddProkerPrompt()">+ Tambah Proker Baru</button>`;
  }

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
  const isMe = selectedMemberId === "me";
  const m = isMe ? currentUser : currentMemberList().find(x => getMemberId(x) === String(selectedMemberId));
  
  if (!m) return membersPage();

  const divKey = isMe ? m.divisionKey : getMemberDivisionKey(m);
  const backBtn = `<button class="btn btn-light" data-page="${isMe ? 'overview' : 'members'}">? Kembali</button>`;
  const namaPanggilan = m.panggilan || m.namaPanggilan || String(m.namaLengkap || m.nama || "").split(' ')[0];
  
  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isAudit = roleLower.includes("audit");
  const isKoord = roleLower.includes("koordinator") || roleLower.includes("kord");
  const canManageTracker = isAdmin || isAudit || (isKoord && currentUser.divisionKey === divKey);

  // Ambil data tracker dari tab perorangan di Google Sheets
  fetch(`${API_URL}?action=getTracker&division=${encodeURIComponent(divKey)}&nickname=${encodeURIComponent(namaPanggilan)}${idToken ? '&idToken=' + idToken : ''}`)
    .then(r => r.json())
    .then(res => {
      if (res.totalPoin !== undefined) {
        const totalPoin = Number(res.totalPoin) || 0;
        const targetPoin = 25;
        const percent = Math.min(100, Math.max(0, Math.round((totalPoin / targetPoin) * 100)));
        const statusText = res.statusEvaluasi || "Belum memenuhi";
        const strokeColor = statusText === "Memenuhi" ? "#4caf50" : (totalPoin > 0 ? "#ff9800" : "#ccc");
        
        const circle = $("#progressCircle");
        if (circle) {
          circle.setAttribute("stroke-dasharray", `${percent}, 100`);
          circle.setAttribute("stroke", strokeColor);
        }
        
        const pctEl = $("#progressPercent");
        if (pctEl) {
          pctEl.textContent = `${percent}%`;
          pctEl.style.color = strokeColor;
        }
        
        const txtEl = $("#progressText");
        if (txtEl) txtEl.textContent = `${totalPoin} / ${targetPoin}`;
        
        const statusEl = $("#progressStatus");
        if (statusEl) {
          statusEl.textContent = statusText;
          statusEl.style.color = strokeColor;
        }
      }

      const tbody = $("#trackerTableBody");
      if (!tbody) return;
      
      if (res.status === "error") {
        tbody.innerHTML = `<tr><td colspan="3" class="empty-cell" style="color:#b93a3a;"><strong>Akses Ditolak:</strong> ${esc(res.message)}</td></tr>`;
      } else if (res.status === "success" && res.data.length > 0) {
        window.currentTrackerData = res.data; // Simpan untuk edit
        tbody.innerHTML = res.data.map((t, idx) => {
          let dateStr = t.tanggal;
          if (t.tanggal instanceof Date) dateStr = t.tanggal.toLocaleDateString('id-ID');
          else if (String(t.tanggal).includes('T')) dateStr = t.tanggal.split('T')[0];
          
          let actionBtns = "-";
          if (canManageTracker && t.rowId) {
            actionBtns = `
              <div style="display:flex;gap:4px">
                <button class="mini-btn" onclick="openTrackerModal('edit', '${divKey}', '${esc(namaPanggilan)}', ${t.rowId}, ${idx})">Edit</button>
                <button class="mini-btn" style="background:#fce8e8;color:#d32f2f;" onclick="deleteTrackerRow('${divKey}', '${esc(namaPanggilan)}', ${t.rowId})">Hapus</button>
              </div>
            `;
          }
          
          return `
          <tr>
            <td style="white-space: nowrap;">${esc(dateStr)}</td>
            <td>
              <strong>${esc(t.kegiatan)}</strong> 
              <span class="badge ${t.poin > 0 ? 'badge-green' : (t.poin < 0 ? 'badge-red' : 'badge-gray')}" style="margin-left:8px;">${t.poin > 0 ? '+' : ''}${esc(t.poin)} Poin</span>
              <br><small>${esc(t.catatan)}</small>
            </td>
            <td>${actionBtns}</td>
          </tr>
        `}).join("");
      } else {
        tbody.innerHTML = `<tr><td colspan="3" class="empty-cell">Belum ada riwayat / Tab '${esc(namaPanggilan)}' tidak ditemukan.</td></tr>`;
      }
    })
    .catch(() => {
      const tbody = $("#trackerTableBody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="empty-cell">Gagal memuat riwayat. Periksa koneksi.</td></tr>`;
    });

  let addTrackerBtnHTML = "";
  if (canManageTracker) {
    addTrackerBtnHTML = `<button class="btn btn-primary" style="margin-top:10px" onclick="openTrackerModal('add', '${divKey}', '${esc(namaPanggilan)}')">+ Tambah Riwayat</button>`;
  }

  return `
    ${head("MONITORING ANGGOTA", "Detail Anggota", `Profil dan riwayat poin keaktifan ${esc(m.namaLengkap || m.nama)}.`, backBtn)}
    
    <div class="stats-grid">
      <article class="stat-card">
        <div class="stat-top">
          <span class="stat-label">Nama Anggota</span>
          <span class="stat-icon blue">♙</span>
        </div>
        <div class="stat-value">${esc(m.namaLengkap || m.nama)}</div>
        <div class="stat-foot">${esc(m.iDAnggota || m.idAnggota || m.id || "—")}</div>
        <div style="font-size: 0.85em; color: #666; margin-top: 4px; overflow-wrap: anywhere;">
          ${esc(m.email || m.surel || namaPanggilan)}
        </div>
      </article>
      
      ${stat("Divisi", esc(m.divisi || DIVISION_LABELS[divKey] || divKey), "▣", "purple", "Divisi aktif")}
      ${stat("Role / Jabatan", esc(m.role || m.jabatan || "Anggota"), "✦", "green", "Posisi kepengurusan")}
      
      <article class="stat-card" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; padding: 15px;">
        <span style="font-size:12px; color:#666; align-self:flex-start;">Total Poin Keaktifan</span>
        <div style="position:relative; width:70px; height:70px;">
          <svg viewBox="0 0 36 36" style="width:100%; height:100%;">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#eee" stroke-width="3.5" />
            <path id="progressCircle" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#ccc" stroke-width="3.5" stroke-dasharray="0, 100" />
          </svg>
          <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); font-weight:bold; font-size:14px; text-align:center;">
            <span id="progressPercent">0%</span>
          </div>
        </div>
        <div style="text-align:center; line-height:1.2;">
          <div id="progressText" style="font-weight:600; font-size:14px;">- / 25</div>
          <div id="progressStatus" style="font-size:12px; color:#666;">Memuat...</div>
        </div>
      </article>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Riwayat Poin Keaktifan</h2>
          <p>Daftar riwayat aktivitas, keaktifan, dan evaluasi anggota.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width: 150px;">Tanggal</th>
              <th>Aktivitas & Catatan Auditor</th>
              <th style="width: 120px;">Aksi</th>
            </tr>
          </thead>
          <tbody id="trackerTableBody">
            <tr><td colspan="2" style="text-align:center; padding: 30px;"><em>Memuat riwayat poin...</em></td></tr>
          </tbody>
        </table>
      </div>
      ${addTrackerBtnHTML}
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
  $("#addProkerName").value = "";
  
  const roleLower = currentUser && currentUser.role ? String(currentUser.role).toLowerCase() : "";
  const isAdmin = roleLower.includes("admin");
  const isKoord = roleLower.includes("koordinator") || roleLower.includes("kord");
  
  if (isAdmin || isKoord) {
    $("#addProkerScopeContainer").style.display = "block";
    $("#addProkerScope").value = "divisi"; // default
  } else {
    $("#addProkerScopeContainer").style.display = "none";
    $("#addProkerScope").value = "divisi";
  }

  $("#addProkerModal")?.showModal();
}

function submitAddProker(e) {
  e.preventDefault();
  const namaProker = $("#addProkerName").value.trim();
  const scope = $("#addProkerScope").value;
  
  if (!namaProker) return;
  
  $("#addProkerModal")?.close();
  toast("Menyiapkan proker baru...");
  
  const payload = {
    action: "addProker",
    division: currentDivision,
    scope: scope,
    prokerData: { namaProker: namaProker }
  };
  
  sendPostPayload(payload);
}

function handleDeleteProker(idProker, scope) {
  if (!confirm(`Apakah Anda yakin ingin menghapus proker ${idProker}? Tindakan ini tidak dapat dibatalkan.`)) return;
  
  toast(`Menghapus proker ${idProker}...`);
  sendPostPayload({
    action: "deleteProker",
    division: currentDivision,
    scope: scope,
    idProker: idProker
  });
}

async function handleSaveProker(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Menyimpan...";
  }

  const payload = {
    action: "uploadEvidence",
   division: currentDivision,
   idProker: $("#formProkerId").value,
   progres: Number($("#formProgres").value),
   status: $("#formStatus").value,
   pic: $("#formPic").value.trim(),
   catatan: $("#formCatatan").value.trim(),
   tenggat: $("#formTenggat").value,
   linkBukti: $("#formLinkBukti").value.trim()
  };

  toast("Menyimpan data ke Google Sheets...");
  await sendPostPayload(payload);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = "Simpan Perubahan";
  }
}

async function sendPostPayload(payload) {
  if (idToken) payload.idToken = idToken;
  try {
    const res = await fetch(API_URL, { method: "POST", body: JSON.stringify(payload) }).then(r => r.json());
    if (res.status === "success") {
      toast(res.message || "Berhasil disimpan!");
      $("#uploadModal")?.close();
      $("#addProkerModal")?.close();
      $("#trackerModal")?.close();
      
      // Background sync
      fetchDivisionData();
      return res;
    } else {
      toast("Gagal: " + res.message);
      return Promise.reject(res.message);
    }
  } catch (err) {
    toast("Terjadi kesalahan koneksi!");
    return Promise.reject(err);
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

$("#menuBtn").onclick = () => $("#sidebar")?.classList.add("open");
if ($("#closeSidebarBtn")) {
  $("#closeSidebarBtn").onclick = () => $("#sidebar")?.classList.remove("open");
}

// Swipe Gestures for Mobile Sidebar
let touchStartX = 0;
let touchStartY = 0;
document.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].screenX;
  touchStartY = e.changedTouches[0].screenY;
}, {passive: true});

document.addEventListener('touchend', e => {
  const touchEndX = e.changedTouches[0].screenX;
  const touchEndY = e.changedTouches[0].screenY;
  const swipeDistX = touchEndX - touchStartX;
  const swipeDistY = Math.abs(touchEndY - touchStartY);
  const sidebar = $("#sidebar");
  if (!sidebar) return;
  
  // Pastikan swipe lebih horizontal daripada vertikal (mencegah scroll vertikal memicu sidebar)
  if (Math.abs(swipeDistX) > swipeDistY) {
    // Usap ke kanan untuk membuka (jika mulai dari pinggir kiri)
    if (swipeDistX > 50 && touchStartX < 30) {
      sidebar.classList.add("open");
    }
    // Usap ke kiri untuk menutup
    if (swipeDistX < -50 && sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
    }
  }
}, {passive: true});

// Jalankan Inisialisasi Utama
initApp();





// === TRACKER CRUD FUNCTIONS ===
window.currentTrackerContext = {};

function openTrackerModal(action, divKey, nickname, rowId = null, dataIdx = null) {
  window.currentTrackerContext = { action, divKey, nickname, rowId };
  $("#trackerModalTitle").textContent = action === "add" ? "Tambah Riwayat" : "Edit Riwayat";
  $("#formTrackerAction").value = action;
  $("#formTrackerRowId").value = rowId || "";
  
  if (action === "edit" && window.currentTrackerData && window.currentTrackerData[dataIdx]) {
    const t = window.currentTrackerData[dataIdx];
    let dateStr = t.tanggal;
    if (t.tanggal instanceof Date) dateStr = t.tanggal.toISOString().split('T')[0];
    else if (String(t.tanggal).includes('T')) dateStr = t.tanggal.split('T')[0];
    else {
      try { dateStr = new Date(t.tanggal).toISOString().split('T')[0]; } catch(e) { dateStr = ""; }
    }
    
    $("#formTrackerTanggal").value = dateStr;
    $("#formTrackerKegiatan").value = t.kegiatan || "";
    $("#formTrackerPoin").value = t.poin || 0;
    $("#formTrackerCatatan").value = t.catatan || "";
  } else {
    const tzOffset = new Date().getTimezoneOffset() * 60000;
    const localDate = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
    $("#formTrackerTanggal").value = localDate;
    $("#formTrackerKegiatan").value = "";
    $("#formTrackerPoin").value = "";
    $("#formTrackerCatatan").value = "";
  }
  
  $("#trackerModal")?.showModal();
}

function handleSaveTracker(e) {
  e.preventDefault();
  const ctx = window.currentTrackerContext;
  if (!ctx || !ctx.divKey) return;
  
  $("#trackerModal")?.close();
  toast("Menyimpan riwayat...");
  
  const payload = {
    action: "manageTracker",
    division: ctx.divKey,
    actionTracker: $("#formTrackerAction").value,
    nickname: ctx.nickname,
    rowId: $("#formTrackerRowId").value ? Number($("#formTrackerRowId").value) : null,
    tanggal: $("#formTrackerTanggal").value,
    kegiatan: $("#formTrackerKegiatan").value.trim(),
    poin: Number($("#formTrackerPoin").value),
    catatan: $("#formTrackerCatatan").value.trim()
  };
  
  sendPostPayload(payload).then(() => {
    if (currentPage === "member-detail") go("member-detail");
  }).catch(() => {});
}

function deleteTrackerRow(divKey, nickname, rowId) {
  if (!confirm("Hapus baris riwayat ini? Tindakan ini tidak dapat dibatalkan.")) return;
  toast("Menghapus riwayat...");
  const payload = {
    action: "manageTracker",
    division: divKey,
    actionTracker: "delete",
    nickname: nickname,
    rowId: rowId
  };
  sendPostPayload(payload).then(() => {
    if (currentPage === "member-detail") go("member-detail");
  }).catch(() => {});
}















