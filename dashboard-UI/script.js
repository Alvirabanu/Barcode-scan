// ================= SUPABASE SETUP =================
const SUPABASE_URL = "https://gunkkbepdlsdwgxgpcxj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__peI72hPciL0iaBVn0odIg_Uv6D1OTz";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

let currentUserId = null;
let html5QrCode = null;
let userMap = {};
let userReady = false;

// ✅ Cache for "My Barcodes" (used for search filtering)
let myBarcodesCache = [];

// ================= ✅ SCAN SUCCESS TICK =================
// Make sure dashboard-UI/index.html has:
// <div id="scanSuccess" class="scan-success hidden">✅ Saved</div>
function showScanSuccess() {
  const el = document.getElementById("scanSuccess");
  if (!el) return;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 900);
}

// ================= 🔔 CUSTOM NOTIFICATION =================
function showNotify(message) {
  const overlay = document.getElementById("notifyOverlay");
  const text = document.getElementById("notifyMessage");
  if (!overlay || !text) return;

  text.textContent = message;
  overlay.classList.remove("hidden");
}

function closeNotify() {
  document.getElementById("notifyOverlay")?.classList.add("hidden");
}

// ================= 👤 PROFILE =================
async function ensureProfile(user) {
  const username = user.user_metadata?.username || "unknown";

  const { data } = await supabaseClient
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!data) {
    await supabaseClient.from("profiles").insert({
      id: user.id,
      username
    });
  }
}

async function loadUsernames() {
  const { data } = await supabaseClient
    .from("profiles")
    .select("id, username");

  userMap = {};
  data?.forEach(u => (userMap[u.id] = u.username));
}

// ================= SELECT ALL (MY BARCODES) =================
function toggleSelectAll(master) {
  document
    .querySelectorAll(".row-check")
    .forEach(cb => (cb.checked = master.checked));
}

function syncSelectAll() {
  const all = document.querySelectorAll(".row-check");
  const checked = document.querySelectorAll(".row-check:checked");
  const master = document.getElementById("selectAll");
  if (master) master.checked = all.length && all.length === checked.length;
}

// ================= TABS =================
// Your HTML calls: showTab('my', this) and showTab('common', this)
function showTab(tabName, btnEl) {
  document.getElementById("my")?.classList.add("hidden");
  document.getElementById("common")?.classList.add("hidden");

  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
  document.getElementById(tabName)?.classList.remove("hidden");
  if (btnEl) btnEl.classList.add("active");
}

// ================= LOAD USER =================
async function loadUser() {
  const { data } = await supabaseClient.auth.getUser();

  if (!data.user) {
    window.location.href = "../login-UI/signin.html";
    return;
  }

  currentUserId = data.user.id;

  await ensureProfile(data.user);
  await loadUsernames();

  const title = document.getElementById("dashboard-title");
  if (title) {
    title.textContent = `${userMap[currentUserId] || "User"} Dashboard`;
  }

  await loadMyBarcodes();
  await loadCommonSummary();

  userReady = true;
}

// ================= SAVE BARCODE =================
async function saveBarcode() {
  if (!userReady || !currentUserId) {
    showNotify("Please wait, loading user...");
    return;
  }

  const input = document.getElementById("barcode-input");
  const barcode = (input?.value || "").trim();

  if (!barcode) {
    showNotify("Please enter a barcode");
    return;
  }

  const { data: existing } = await supabaseClient
    .from("user_scans")
    .select("*")
    .eq("user_id", currentUserId)
    .eq("barcode", barcode)
    .single();

  if (existing) {
    await supabaseClient
      .from("user_scans")
      .update({ quantity: existing.quantity + 1 })
      .eq("id", existing.id);
  } else {
    await supabaseClient
      .from("user_scans")
      .insert({ user_id: currentUserId, barcode, quantity: 1 });
  }

  if (input) input.value = "";

  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= CAMERA (SCAN → SAVE → ✅ → CLOSE) =================
async function openScanner() {
  if (!userReady) {
    showNotify("Please wait, loading user...");
    return;
  }

  document.getElementById("scannerOverlay")?.classList.remove("hidden");

  try {
    if (html5QrCode) {
      await html5QrCode.stop().catch(() => {});
      html5QrCode = null;
    }

    html5QrCode = new Html5Qrcode("reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      async (decodedText) => {
        // Stop camera immediately
        await html5QrCode.stop().catch(() => {});
        html5QrCode = null;

        // Save
        const input = document.getElementById("barcode-input");
        if (input) input.value = decodedText;
        await saveBarcode();

        // Tick
        showScanSuccess();

        // Close scanner overlay (back to dashboard)
        setTimeout(() => closeScanner(), 900);
      }
    );
  } catch (err) {
    console.error("Camera error:", err);
    showNotify("Camera permission denied or camera not available");
    closeScanner();
  }
}

function closeScanner() {
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }
  document.getElementById("scannerOverlay")?.classList.add("hidden");
}

// ================= MY BARCODES (RENDER + SEARCH) =================
function renderMyBarcodes(rows) {
  const tbody = document.getElementById("myBarcodesBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  (rows || []).forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input type="checkbox"
          class="row-check"
          data-barcode="${row.barcode}"
          onchange="syncSelectAll()">
        ${row.barcode}
      </td>
      <td>${row.quantity}</td>
      <td>${new Date(row.created_at).toLocaleDateString()}</td>
      <td>
        <span class="delete" title="Edit count"
          onclick="editBarcodeCount('${row.barcode}', ${row.quantity})">✏️</span>
        &nbsp;&nbsp;
        <span class="delete" title="Delete"
          onclick="deleteBarcode('${row.barcode}')">🗑</span>
      </td>
    `;
    tbody.appendChild(tr);
  });

  syncSelectAll();
}

function filterMyBarcodes() {
  const q = (document.getElementById("mySearch")?.value || "")
    .trim()
    .toLowerCase();

  if (!q) {
    renderMyBarcodes(myBarcodesCache);
    return;
  }

  const filtered = myBarcodesCache.filter(r =>
    String(r.barcode).toLowerCase().includes(q)
  );

  renderMyBarcodes(filtered);
}

function clearMySearch() {
  const input = document.getElementById("mySearch");
  if (input) input.value = "";
  renderMyBarcodes(myBarcodesCache);
}

// ================= LOAD MY BARCODES =================
async function loadMyBarcodes() {
  const { data } = await supabaseClient
    .from("user_scans")
    .select("*")
    .eq("user_id", currentUserId)
    .order("created_at", { ascending: false });

  myBarcodesCache = data || [];
  renderMyBarcodes(myBarcodesCache);

  // If user is searching, keep filter applied after refresh
  const q = (document.getElementById("mySearch")?.value || "").trim();
  if (q) filterMyBarcodes();
}

// ================= EDIT COUNT (MY BARCODES) =================
async function editBarcodeCount(barcode, currentQty) {
  if (!userReady || !currentUserId) {
    showNotify("Please wait, loading user...");
    return;
  }

  const input = prompt(
    `Edit count for: ${barcode}\nCurrent: ${currentQty}\nEnter new count:`,
    currentQty
  );

  if (input === null) return; // cancelled

  const newQty = parseInt(input, 10);

  if (Number.isNaN(newQty) || newQty < 0) {
    showNotify("Please enter a valid number (0 or more)");
    return;
  }

  // If set to 0, ask to delete
  if (newQty === 0) {
    const ok = confirm("Count is 0. Do you want to delete this barcode?");
    if (!ok) return;
    await deleteBarcode(barcode);
    return;
  }

  const { data: row, error: fetchErr } = await supabaseClient
    .from("user_scans")
    .select("id")
    .eq("user_id", currentUserId)
    .eq("barcode", barcode)
    .single();

  if (fetchErr || !row) {
    showNotify("Could not find this barcode");
    return;
  }

  const { error } = await supabaseClient
    .from("user_scans")
    .update({ quantity: newQty })
    .eq("id", row.id);

  if (error) {
    showNotify("Update failed");
    return;
  }

  showNotify("✅ Count updated");
  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= DELETE SINGLE (MY) =================
async function deleteBarcode(barcode) {
  const { error } = await supabaseClient
    .from("user_scans")
    .delete()
    .eq("user_id", currentUserId)
    .eq("barcode", barcode);

  if (error) {
    showNotify("Delete failed");
    return;
  }

  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= BULK DELETE (MY) =================
async function deleteSelected() {
  const checked = document.querySelectorAll(".row-check:checked");

  if (!checked.length) {
    showNotify("No barcodes selected");
    return;
  }

  const barcodes = Array.from(checked).map(cb => cb.dataset.barcode);

  const { error } = await supabaseClient
    .from("user_scans")
    .delete()
    .eq("user_id", currentUserId)
    .in("barcode", barcodes);

  if (error) {
    showNotify("Failed to delete selected");
    return;
  }

  showNotify("Selected barcodes deleted");
  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= COMMON SUMMARY =================
async function loadCommonSummary() {
  const tbody = document.getElementById("commonSummaryBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const { data } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity, user_id");

  const summary = {};

  (data || []).forEach(row => {
    if (!summary[row.barcode]) {
      summary[row.barcode] = { total: 0, users: {} };
    }
    summary[row.barcode].total += row.quantity;
    summary[row.barcode].users[row.user_id] =
      (summary[row.barcode].users[row.user_id] || 0) + row.quantity;
  });

  Object.entries(summary).forEach(([barcode, info]) => {
    const usersHtml = Object.entries(info.users)
      .map(([uid, count]) => {
        const name = uid === currentUserId ? "you" : userMap[uid] || "unknown";
        return `<span class="chip">${name}: ${count}</span>`;
      })
      .join(" ");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input type="checkbox" class="common-check" data-barcode="${barcode}">
        ${barcode}
      </td>
      <td>${usersHtml}</td>
      <td>${info.total}</td>
      <!-- DELETE DISABLED -->
  ${
    ""
    /*
    <td>
      <span class="delete" onclick="deleteCommonBarcode('${barcode}')">🗑</span>
    </td>
    */
    `;
    tbody.appendChild(tr);
  });
}

// ================= DELETE COMMON (SINGLE) =================
async function deleteCommonBarcode(barcode) {
  const { error } = await supabaseClient
    .from("user_scans")
    .delete()
    .eq("barcode", barcode);

  if (error) {
    showNotify("Delete failed");
    return;
  }

  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= DELETE COMMON (BULK) =================
async function deleteCommonSelected() {
  const checked = document.querySelectorAll(".common-check:checked");

  if (!checked.length) {
    showNotify("No barcodes selected");
    return;
  }

  const barcodes = Array.from(checked).map(cb => cb.dataset.barcode);

  const { error } = await supabaseClient
    .from("user_scans")
    .delete()
    .in("barcode", barcodes);

  if (error) {
    showNotify("Failed to delete selected");
    return;
  }

  showNotify("Selected barcodes deleted");
  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= DOWNLOAD MY BARCODES EXCEL =================
async function downloadMyBarcodesExcel() {
  if (typeof XLSX === "undefined") {
    showNotify("Excel library not loaded. Add XLSX script in dashboard index.html.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity, created_at")
    .eq("user_id", currentUserId)
    .order("created_at", { ascending: false });

  if (error || !data || !data.length) {
    showNotify("No data to export");
    return;
  }

  const formatted = data.map(row => ({
    Barcode: row.barcode,
    Quantity: row.quantity,
    "Last Scanned": new Date(row.created_at).toLocaleDateString()
  }));

  const worksheet = XLSX.utils.json_to_sheet(formatted);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "My Barcodes");

  await new Promise(r => setTimeout(r, 0)); // mobile friendly
  XLSX.writeFile(workbook, "my-barcodes.xlsx");
}

// ================= DOWNLOAD COMMON SUMMARY EXCEL =================
async function downloadCommonSummaryExcel() {
  if (typeof XLSX === "undefined") {
    showNotify("Excel library not loaded. Add XLSX script in dashboard index.html.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity, user_id");

  if (error || !data || !data.length) {
    showNotify("No data to export");
    return;
  }

  const summary = {};

  data.forEach(row => {
    if (!summary[row.barcode]) {
      summary[row.barcode] = { users: {}, total: 0 };
    }

    const username =
      row.user_id === currentUserId ? "you" : userMap[row.user_id] || "unknown";

    summary[row.barcode].users[username] =
      (summary[row.barcode].users[username] || 0) + row.quantity;

    summary[row.barcode].total += row.quantity;
  });

  const rows = Object.entries(summary).map(([barcode, info]) => {
    const userCounts = Object.entries(info.users)
      .map(([name, count]) => `${name}: ${count}`)
      .join(", ");

    return {
      Barcode: barcode,
      "User Counts": userCounts,
      Total: info.total
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Common Summary");

  await new Promise(r => setTimeout(r, 0)); // mobile friendly
  XLSX.writeFile(workbook, "common-summary.xlsx");
}

// ================= LOGOUT =================
async function logout() {
  await supabaseClient.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "../login-UI/signin.html";
}

// ================= MAKE FUNCTIONS AVAILABLE TO HTML onclick =================
window.openScanner = openScanner;
window.closeScanner = closeScanner;
window.saveBarcode = saveBarcode;
window.logout = logout;

window.showTab = showTab;

window.toggleSelectAll = toggleSelectAll;
window.deleteSelected = deleteSelected;
window.deleteCommonSelected = deleteCommonSelected;

window.downloadMyBarcodesExcel = downloadMyBarcodesExcel;
window.downloadCommonSummaryExcel = downloadCommonSummaryExcel;

window.deleteBarcode = deleteBarcode;
window.deleteCommonBarcode = deleteCommonBarcode;
window.editBarcodeCount = editBarcodeCount;

window.filterMyBarcodes = filterMyBarcodes;
window.clearMySearch = clearMySearch;

window.closeNotify = closeNotify;

// ================= INIT =================
loadUser();


