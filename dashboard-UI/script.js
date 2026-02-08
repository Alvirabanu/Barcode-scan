// ================= SUPABASE SETUP =================
const SUPABASE_URL = "https://gunkkbepdlsdwgxgpcxj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__peI72hPciL0iaBVn0odIg_Uv6D1OTz";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

let currentUserId = null;
let html5QrCode = null;
let scannedCode = null;
let userMap = {};
let userReady = false; // ✅ ADDED
let scannerReady = false; // ✅ ADD THIS LINE ONLY
// ===== AUDIT VARIABLES =====
let expectedStockCache = {};
let scannedStockCache = {};
let lastScannedCode = null;
let lastScanTime = 0;
let deleteQueue = [];
const beep = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");


// ================= 🔔 CUSTOM NOTIFICATION =================
function showNotify(message) {
  const overlay = document.getElementById("notifyOverlay");
  const text = document.getElementById("notifyMessage");
  if (!overlay || !text) return;

  text.textContent = message;
  overlay.classList.remove("hidden");
}

function closeNotify() {
  document.getElementById("notifyOverlay").classList.add("hidden");
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
  data?.forEach(u => userMap[u.id] = u.username);
}

// ================= SELECT ALL (MY BARCODES) =================
function toggleSelectAll(master){

  const tbody = document.getElementById("myBarcodesBody");
  const checkboxes = tbody.querySelectorAll(".row-check");

  checkboxes.forEach(cb=>{
    cb.checked = master.checked;
  });

  syncSelectAll();
  updateDeleteUI();
}



function syncSelectAll(){

  const all = document.querySelectorAll(".row-check");
  const checked = document.querySelectorAll(".row-check:checked");
  const master = document.getElementById("selectAll");

  if(!master) return;

  master.checked = all.length > 0 && all.length === checked.length;
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

  document.getElementById("dashboard-title").textContent =
    `${userMap[currentUserId]} Dashboard`;

  closeScanner(true);
  loadMyBarcodes();
  loadCommonSummary();
  loadAuditTable();

  userReady = true; // ✅ ADDED
}

// ================= TABS =================
function showTab(tabName) {

  document.getElementById("my").classList.add("hidden");
  document.getElementById("common").classList.add("hidden");
  document.getElementById("audit").classList.add("hidden"); // ⭐ THIS WAS MISSING

  document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));

  document.getElementById(tabName).classList.remove("hidden");
  event.target.classList.add("active");

  // load audit only when opening it
  if(tabName === "audit"){
    loadAuditTable();
  }
}

// ================= SAVE BARCODE (FIXED LIVE UPDATE) =================
async function saveBarcode() {

  if (!userReady || !currentUserId) {
    showNotify("Please wait, loading user...");
    return;
  }

  const input = document.getElementById("barcode-input");
  const barcode = input.value.trim();

  if (!barcode) {
    showNotify("Please enter a barcode");
    return;
  }

  // Check if exists
  const { data: existing, error: fetchError } = await supabaseClient
    .from("user_scans")
    .select("*")
    .eq("user_id", currentUserId)
    .eq("barcode", barcode)
    .maybeSingle();   // IMPORTANT CHANGE

  if (fetchError) {
    showNotify("Database error");
    return;
  }

  // Update or insert
  if (existing) {
    await supabaseClient
      .from("user_scans")
      .update({ quantity: existing.quantity + 1 })
      .eq("id", existing.id);
  } else {
    await supabaseClient
      .from("user_scans")
      .insert({
        user_id: currentUserId,
        barcode,
        quantity: 1
      });
  }

  input.value = "";

  // ⭐ WAIT FOR DATABASE COMMIT (THIS IS THE MAGIC)
  await new Promise(resolve => setTimeout(resolve, 350));

  // Reload everything
  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  showNotify("Barcode Saved");
}

// ================= DELETE SINGLE (MY) =================
async function deleteBarcodeSystem(code){

  // delete my scans
  await supabaseClient
    .from("user_scans")
    .delete()
    .eq("user_id", currentUserId)
    .eq("barcode", code);

  // also remove stored stock
  await supabaseClient
    .from("expected_stock")
    .delete()
    .eq("barcode", code);

  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  updateDeleteUI();

  showNotify("Barcode deleted ✔");
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
  loadMyBarcodes();
  loadCommonSummary();
}

// DELETE FOR ALL USERS //
function openDeleteConfirm(barcodes){
  deleteQueue = barcodes;
  document.getElementById("deleteConfirmOverlay").classList.remove("hidden");
}

function closeDeleteConfirm(){
  deleteQueue = [];
  document.getElementById("deleteConfirmOverlay").classList.add("hidden");
}

async function confirmDelete(){

  if(deleteQueue.length === 0) return;

  // remove from expected stock (stored)
  await supabaseClient
    .from("expected_stock")
    .delete()
    .in("barcode", deleteQueue);

  // remove from scanned stock (all users)
  await supabaseClient
    .from("user_scans")
    .delete()
    .in("barcode", deleteQueue);

  closeDeleteConfirm();

  // reload dashboards
  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();
  await updateDeleteUI();

  showNotify("Deleted successfully ✔");
}

// ================= LOAD MY BARCODES =================
async function loadMyBarcodes() {

  const tbody = document.getElementById("myBarcodesBody");
  tbody.innerHTML = "";

  // master stock
  const { data: expected } = await supabaseClient
    .from("expected_stock")
    .select("barcode, quantity")

  // my scans
  const { data: scanned } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity, created_at")
    .eq("user_id", currentUserId);

  const scanMap = {};
  const lastScanMap = {};

  scanned?.forEach(s => {
    scanMap[s.barcode] = s.quantity;
    lastScanMap[s.barcode] = s.created_at;
  });

  // combine
  const allCodes = new Set([
    ...(expected || []).map(e => e.barcode),
    ...(scanned || []).map(s => s.barcode)
  ]);

  allCodes.forEach(code => {

    const stored = expected?.find(e => e.barcode === code)?.quantity || 0;
    const scannedQty = scanMap[code] || 0;

    let status = "";
    let color = "";

    if (stored === scannedQty) {
      status = "Match";
      color = "green";
    }
    else if (scannedQty < stored) {
      status = `Short ${stored - scannedQty}`;
      color = "red";
    }
    else {
      status = `Excess ${scannedQty - stored}`;
      color = "orange";
    }

    const lastScan = lastScanMap[code]
      ? new Date(lastScanMap[code]).toLocaleString()
      : "-";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
      <input type="checkbox"
      class="row-check"
      data-barcode="${code}"
      onchange="syncSelectAll(); updateDeleteUI();">
      ${code}
      </td>

      <td>${stored}</td>
      <td>${scannedQty}</td>
      <td style="color:${color};font-weight:600">${status}</td>
      <td>${lastScan}</td>
      <td>
      <span class="edit" onclick="editScan('${code}', ${scannedQty})">✏️</span>
      <span class="delete"
      onclick="event.preventDefault(); event.stopPropagation(); deleteBarcodeSystem('${code}')">🗑</span>
      </td>

    `;

    tbody.appendChild(tr);
  });
  const master = document.getElementById("selectAll");
  if(master) master.checked = false;
  updateDeleteUI();
  syncSelectAll();
}

// EDIT FUNCTION //
function editScan(barcode, qty){
  document.getElementById("editBarcodeInput").value = barcode;
  document.getElementById("editQtyInput").value = qty;
  editingId = barcode;
  document.getElementById("editModal").classList.remove("hidden");
}

// ================= COMMON SUMMARY =================
async function loadCommonSummary() {

  const tbody = document.getElementById("commonSummaryBody");
  tbody.innerHTML = "";

  const { data } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity, user_id");

  const summary = {};

  data.forEach(row => {
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
      }).join(" ");

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <input type="checkbox"
          class="common-check"
          data-barcode="${barcode}"
          onchange="syncCommonSelectAll(); updateCommonDeleteUI();">
        ${barcode}
      </td>
      <td>${usersHtml}</td>
      <td>${info.total}</td>
      <td>
        <span class="delete" onclick="event.preventDefault(); event.stopPropagation(); openDeleteConfirm(['${barcode}'])">🗑</span>
      </td>
    `;

    tbody.appendChild(tr);
  });

  updateCommonDeleteUI();
}

function toggleCommonSelectAll(master){
  const checkboxes = document.querySelectorAll(".common-check");

  checkboxes.forEach(cb=>{
    cb.checked = master.checked;
  });

  updateCommonDeleteUI();
}

function syncCommonSelectAll(){
  const all = document.querySelectorAll(".common-check");
  const checked = document.querySelectorAll(".common-check:checked");
  const master = document.getElementById("selectAllCommon");

  if(!master) return;
  master.checked = all.length > 0 && all.length === checked.length;
}

function updateCommonDeleteUI(){

  const checked = document.querySelectorAll(".common-check:checked");
  const floating = document.getElementById("floatingCommonDelete");
  const count = document.getElementById("commonDeleteCount");

  if(!floating) return;

  if(checked.length > 0){
    floating.classList.remove("hidden");
    count.textContent = checked.length;
  }else{
    floating.classList.add("hidden");
  }
}

async function deleteSelectedCommonBarcodes(){

  const checked = document.querySelectorAll(".common-check:checked");

  if(checked.length === 0){
    showNotify("No barcode selected");
    return;
  }

  const barcodes = Array.from(checked).map(cb => cb.dataset.barcode);

  // delete stored stock
  const { error: stockError } = await supabaseClient
    .from("expected_stock")
    .delete()
    .in("barcode", barcodes);

  // delete scans of ALL users
  const { error: scanError } = await supabaseClient
    .from("user_scans")
    .delete()
    .in("barcode", barcodes);

  if(stockError || scanError){
    console.error(stockError || scanError);
    showNotify("Delete failed");
    return;
  }

  // reload EVERYTHING
  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  updateCommonDeleteUI();

  showNotify("Removed from system ✔");
}

// ================= SEARCH MY BARCODE =================
function searchBarcode() {
  const input = document.getElementById("searchInput").value.toLowerCase();
  const rows = document.querySelectorAll("#myBarcodesBody tr");

  rows.forEach(row => {
    const barcodeText = row.innerText.toLowerCase();
    if (barcodeText.includes(input)) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  });
}

function clearSearch(){
  document.getElementById("searchInput").value = "";
  searchBarcode();
}

// ================= SEARCH COMMON SUMMARY =================
function searchCommonSummary() {
  const input = document.getElementById("commonSearchInput").value.toLowerCase();
  const rows = document.querySelectorAll("#commonSummaryBody tr");

  rows.forEach(row => {
    const rowText = row.innerText.toLowerCase();
    if (rowText.includes(input)) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  });
}

function clearCommonSearch(){
  document.getElementById("commonSearchInput").value = "";
  searchCommonSummary();
}

// ================= SEARCH AUDIT TABLE =================
function searchAudit() {
  const input = document
    .getElementById("auditSearchInput")
    .value
    .toLowerCase();

  const rows = document.querySelectorAll("#auditBody tr");

  rows.forEach(row => {
    const text = row.innerText.toLowerCase();

    if (text.includes(input)) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  });
}

function clearAuditSearch() {
  document.getElementById("auditSearchInput").value = "";
  searchAudit();
}

// ================= EDIT BARCODE =================
let editingId = null;

// open modal
function editBarcode(id, barcode, quantity) {
  editingId = id;

  document.getElementById("editBarcodeInput").value = barcode;
  document.getElementById("editQtyInput").value = quantity;

  document.getElementById("editModal").classList.remove("hidden");
}

// close modal
function closeEditModal() {
  document.getElementById("editModal").classList.add("hidden");
}

// SAVE LOGIC //
async function saveEdit() {

  const newBarcode = document.getElementById("editBarcodeInput").value.trim();
  const newQty = parseInt(document.getElementById("editQtyInput").value);

  if (!newBarcode) {
    showNotify("Barcode cannot be empty");
    return;
  }

  if (isNaN(newQty) || newQty < 0) {
    showNotify("Invalid quantity");
    return;
  }

  const { error } = await supabaseClient
    .from("user_scans")
    .update({
      barcode: newBarcode,
      quantity: newQty
    })
    .eq("user_id", currentUserId)
    .eq("barcode", editingId);


  if (error) {
    showNotify("Update failed");
    return;
  }

  closeEditModal();

  loadMyBarcodes();
  loadCommonSummary();

  showNotify("Updated successfully");
}

// DELETE SCAN //
async function deleteMyScan(barcode){

  if(!confirm("Reset your scanned count for this barcode?")) return;

  await supabaseClient
    .from("user_scans")
    .delete()
    .eq("user_id", currentUserId)
    .eq("barcode", barcode);

  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  showNotify("Scan reset");
}

function updateDeleteUI(){

  setTimeout(()=>{

    const checked = document.querySelectorAll("#myBarcodesBody .row-check:checked");
    const floating = document.getElementById("floatingDelete");
    const count = document.getElementById("deleteCount");

    if(!floating) return;

    if(checked.length > 0){
      floating.classList.remove("hidden");
      count.textContent = checked.length;
    }else{
      floating.classList.add("hidden");
    }

  }, 0);
}

// Read Excel //
document.getElementById("stockUpload").addEventListener("change", handleStockUpload);

async function handleStockUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async function(evt) {

    const data = new Uint8Array(evt.target.result);
    const workbook = XLSX.read(data, { type: "array" });

    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // read rows as ARRAY
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,      // ⭐ IMPORTANT (prevents number conversion)
      defval: ""
    });

    // remove old stock FIRST
    await supabaseClient
    .from("expected_stock")
    .delete()
    .neq("barcode", "");


    const insertData = [];

    // start from A2 B2 (skip header row)
    for (let i = 1; i < rows.length; i++) {

      const row = rows[i];

      if (!row || row.length < 2) continue;

      let barcode = String(row[0]).trim();
      let quantity = parseInt(row[1]);

      // keep alphabets (VERY IMPORTANT)
      barcode = barcode.replace(/\.0$/, "");

      if (!barcode || isNaN(quantity)) continue;

      insertData.push({
        barcode: barcode,
        quantity: quantity
      });
    }

    if (insertData.length === 0) {
      showNotify("No valid rows found in Excel");
      return;
    }

    // insert ALL rows at once (fast + correct)
    const { error } = await supabaseClient
      .from("expected_stock")
      .insert(insertData);

    if (error) {
      console.error(error);
      showNotify("Upload failed");
      return;
    }

    showNotify("Stock Excel uploaded successfully ✔");

    await new Promise(r => setTimeout(r, 300));
    await loadMyBarcodes();
    await loadCommonSummary();
    await loadAuditTable();
  };

  reader.readAsArrayBuffer(file);
}

 // COMPARE EXCEL //
async function compareStock() {
  showTab("audit");
}


// ================= DELETE COMMON (SINGLE) =================
function deleteSingleBarcode(code){
  openDeleteConfirm([code]);
}

// ================= DELETE COMMON (BULK) =================
async function deleteSelectedMyBarcodes(){

  const checked = document.querySelectorAll(".row-check:checked");

  if(checked.length === 0){
    showNotify("No barcode selected");
    return;
  }

  const barcodes = Array.from(checked).map(cb => cb.dataset.barcode);

  await supabaseClient
    .from("user_scans")
    .delete()
    .eq("user_id", currentUserId)
    .in("barcode", barcodes);

  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  updateDeleteUI();

  showNotify("Selected barcodes deleted");
}

// ================= DOWNLOAD MY BARCODES EXCEL =================
async function downloadMyBarcodesExcel() {
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

  // ✅ Required for mobile browsers
  await new Promise(r => setTimeout(r, 0));

  XLSX.writeFile(workbook, "my-barcodes.xlsx");
}

// ================= DOWNLOAD COMMON SUMMARY EXCEL =================
async function downloadCommonSummaryExcel() {
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
      summary[row.barcode] = {
        users: {},
        total: 0
      };
    }

    const username =
      row.user_id === currentUserId
        ? "you"
        : userMap[row.user_id] || "unknown";

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

  // ✅ Required for mobile browsers
  await new Promise(r => setTimeout(r, 0));

  XLSX.writeFile(workbook, "common-summary.xlsx");
}

// ================= CAMERA =================
async function openScanner() {
  if (!userReady) {
    showNotify("Please wait, loading user...");
    return;
  }
  const overlay = document.getElementById("scannerOverlay");
  overlay.classList.remove("hidden");

  scannedCode = null;

  try {
    if (html5QrCode) {
      await html5QrCode.stop().catch(() => {});
      html5QrCode = null;
    }

    html5QrCode = new Html5Qrcode("reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 150 } },
      (decodedText) => {
        const now = Date.now();
        // prevent same barcode rapid fire
        if (decodedText === lastScannedCode && now - lastScanTime < 1500) {
          return;
        }
        lastScannedCode = decodedText;
        lastScanTime = now;
        // 🔊 BEEP
        beep.currentTime = 0;
        beep.play().catch(() => {});
        // Auto save
        autoSaveBarcode(decodedText);
      }

    );
  } catch (err) {
    console.error("Camera error:", err);
    showNotify("Camera permission denied or camera not available");
    closeScanner(true);
  }
}

async function autoSaveBarcode(barcode) {

  if (!userReady || !currentUserId) return;

  const { data: existing } = await supabaseClient
    .from("user_scans")
    .select("*")
    .eq("user_id", currentUserId)
    .eq("barcode", barcode)
    .maybeSingle();

  if (existing) {
    await supabaseClient
      .from("user_scans")
      .update({ quantity: existing.quantity + 1 })
      .eq("id", existing.id);
  } else {
    await supabaseClient
      .from("user_scans")
      .insert({
        user_id: currentUserId,
        barcode,
        quantity: 1
      });
  }

  // wait for commit
  await new Promise(resolve => setTimeout(resolve, 350));

  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  showNotify(`Barcode Saved: ${barcode}`);
}

function tryAgain() {
  scannedCode = null;
  scannerReady = false; // ✅ ADD
  closeScanner(true);
  openScanner();
}

function saveScanned() {
  if (!userReady) {
    showNotify("Please wait, loading user...");
    return;
  }
  if (!scannerReady) {
    showNotify("Scan a barcode first");
    return;
  }
  // ✅ ADDED (guard)
  if (!userReady) {
    showNotify("Please wait, loading user...");
    return;
  }

  if (!scannedCode) {
    showNotify("No barcode detected yet");
    return;
  }

  document.getElementById("barcode-input").value = scannedCode;
  saveBarcode();
  closeScanner();
}

function closeScanner(force = false) {
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }

  if (force) {
    scannedCode = null;
    scannerReady = false; // ✅ ADD
    }


  document.getElementById("scannerOverlay").classList.add("hidden");
}

// ================= LOAD AUDIT TABLE =================
async function loadAuditTable() {

  if (!currentUserId) return;

  const tbody = document.getElementById("auditBody");
  if (!tbody) return;

  tbody.innerHTML = "";
  // get expected stock (excel uploaded)
  const { data: expected } = await supabaseClient
  .from("expected_stock")
  .select("barcode, quantity")

  // get scanned stock
  const { data: scanned } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity")

  expectedStockCache = {};
  scannedStockCache = {};

  expected?.forEach(item => {
    expectedStockCache[item.barcode] = item.quantity;
  });

  scanned?.forEach(item => {
    scannedStockCache[item.barcode] = item.quantity;
  });

  const allCodes = new Set([
    ...Object.keys(expectedStockCache),
    ...Object.keys(scannedStockCache)
  ]);

  allCodes.forEach(code => {

    const stored = expectedStockCache[code] || 0;
    const scannedQty = scannedStockCache[code] || 0;
    const diff = scannedQty - stored;

    let status = "";
    let color = "";

    if (diff === 0) {
      status = "Match";
      color = "green";
    }
    else if (diff < 0) {
      status = `Short ${Math.abs(diff)}`;
      color = "red";
    }
    else {
      status = `Excess ${diff}`;
      color = "orange";
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${code}</td>
      <td>${stored}</td>
      <td>${scannedQty}</td>
      <td style="color:${color}; font-weight:600">${status}</td>
    `;

    tbody.appendChild(tr);
  });
}

// ================= DOWNLOAD AUDIT REPORT EXCEL =================
async function downloadAuditExcel() {

  if (!currentUserId) {
    showNotify("User not ready");
    return;
  }

  // expected stock (uploaded excel)
  const { data: expected } = await supabaseClient
    .from("expected_stock")
    .select("barcode, quantity")
    .eq("user_id", currentUserId);

  // scanned stock
  const { data: scanned } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity")
    .eq("user_id", currentUserId);

  if ((!expected || expected.length === 0) && (!scanned || scanned.length === 0)) {
    showNotify("No audit data to export");
    return;
  }

  const expectedMap = {};
  const scannedMap = {};

  expected?.forEach(item => {
    expectedMap[item.barcode] = item.quantity;
  });

  scanned?.forEach(item => {
    scannedMap[item.barcode] = item.quantity;
  });

  const allCodes = new Set([
    ...Object.keys(expectedMap),
    ...Object.keys(scannedMap)
  ]);

  const rows = [];

  allCodes.forEach(code => {
    const stored = expectedMap[code] || 0;
    const scannedQty = scannedMap[code] || 0;

    let status = "";

    if (stored === scannedQty) {
      status = "Match";
    }
    else if (scannedQty < stored) {
      status = `Short ${stored - scannedQty}`;
    }
    else {
      status = `Excess ${scannedQty - stored}`;
    }

    rows.push({
      Barcode: code,
      Stored: stored,
      Scanned: scannedQty,
      Status: status
    });
  });

  // create excel
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Audit Report");

  await new Promise(r => setTimeout(r, 0));
  XLSX.writeFile(workbook, "audit-report.xlsx");
}

// ================= LOGOUT =================
async function logout() {
  await supabaseClient.auth.signOut();
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = "../login-UI/signin.html";
}

// ================= INIT =================
loadUser();

// ===== FLOATING DELETE CONNECTIONS =====
document.addEventListener("DOMContentLoaded", () => {

  // MY BARCODES DELETE
  const myBtn = document.getElementById("floatingDeleteBtn");
  if(myBtn){
    myBtn.addEventListener("click", () => {

      const checked = document.querySelectorAll("#myBarcodesBody .row-check:checked");
      if(checked.length === 0){
        showNotify("No barcode selected");
        return;
      }

      const barcodes = Array.from(checked).map(cb => cb.dataset.barcode);
      openDeleteConfirm(barcodes);
    });
  }

  // COMMON SUMMARY DELETE
  const commonBtn = document.getElementById("floatingCommonDeleteBtn");
  if(commonBtn){
    commonBtn.addEventListener("click", () => {

      const checked = document.querySelectorAll("#commonSummaryBody .common-check:checked");
      if(checked.length === 0){
        showNotify("No barcode selected");
        return;
      }

      const barcodes = Array.from(checked).map(cb => cb.dataset.barcode);
      openDeleteConfirm(barcodes);
    });
  }

});
