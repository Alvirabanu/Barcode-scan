// ================= SUPABASE SETUP =================
const SUPABASE_URL = "https://gunkkbepdlsdwgxgpcxj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__peI72hPciL0iaBVn0odIg_Uv6D1OTz";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

let scanLock = false;

// 🔥 GET ALL ROWS FROM ANY TABLE (SOLVES 3000+ DATA ISSUE)
async function fetchAll(tableName, columns="*"){

  let allData = [];
  let from = 0;
  const size = 1000;

  while(true){

    const { data, error } = await supabaseClient
      .from(tableName)
      .select(columns)
      .range(from, from + size - 1);

    if(error) break;

    allData = allData.concat(data);

    if(!data || data.length < size) break;

    from += size;
  }

  return allData;
}

let lastScanValue = null;
let lastScanTimestamp = 0;
let savingScan = false;
let currentUserId = null;
// pagination states
let myPage = 1;
let commonPage = 1;
let auditPage = 1;
const PAGE_SIZE = 1000;
let mySearch = "";
let commonSearch = "";
let auditSearch = "";
let totalMy = 0;
let totalCommon = 0;
let totalAudit = 0;
let totalProducts = 0;
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
  const checkboxes = document.querySelectorAll("#myBarcodesBody .row-check");
  checkboxes.forEach(cb=>cb.checked = master.checked);
  updateDeleteUI();
}

// PAGES //
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
  startRealtime();

  userReady = true; // ✅ ADDED
}

// ================= REALTIME LIVE UPDATES =================

function startRealtime(){

  // LISTEN PRODUCTS (book count, item name, delete, upload)
  supabaseClient
    .channel('products-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products' },
      payload => {
        console.log("Products changed", payload);
        payload => {
          if(!document.getElementById("my").classList.contains("hidden"))
            loadMyBarcodes();
          if(!document.getElementById("common").classList.contains("hidden"))
            loadCommonSummary();
          if(!document.getElementById("audit").classList.contains("hidden"))
            loadAuditTable();
          }

      }
    )
    .subscribe();

  // LISTEN SCANS (physical count)
  supabaseClient
    .channel('scans-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scans' },
      payload => {
        console.log("Scans changed", payload);

        loadMyBarcodes();
        loadCommonSummary();
        loadAuditTable();
      }
    )
    .subscribe();
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

  const barcode = document.getElementById("barcode-input").value.trim();
  if(!barcode) return;

  // just open editor instead of saving
  await openScanEditor(barcode);

  document.getElementById("barcode-input").value = "";
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

  await supabaseClient.from("products").delete().in("barcode", deleteQueue);
  await supabaseClient.from("scans").delete().in("barcode", deleteQueue);

  closeDeleteConfirm();

  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  showNotify("Barcode removed from system ✔");

  // page correction after delete
  const pages = Math.ceil(totalMy / PAGE_SIZE);
  if(myPage > pages) myPage = pages;
  // reset checkboxes
  const master = document.getElementById("selectAll");
  if(master) master.checked = false;
  const floating = document.getElementById("floatingDelete");
  if(floating) floating.classList.add("hidden");

}


// ================= LOAD MY BARCODES =================
async function loadMyBarcodes(){

  const tbody = document.getElementById("myBarcodesBody");
  tbody.innerHTML = "";

  const maxPage = Math.max(1, Math.ceil(totalMy / PAGE_SIZE));
  if(myPage > maxPage) myPage = maxPage;

  const from = (myPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  
  let query = supabaseClient
  .from("products")
  .select("*", { count: "exact" });
  if(mySearch){
    query = query.ilike("barcode", `%${mySearch}%`);
  }
  const result = await query.range(from, to);
  const products = result.data || [];
  totalMy = result.count || 0;


  const { data: myScans } = await supabaseClient
    .from("scans")
    .select("barcode, qty")
    .eq("user_id", currentUserId);

  const myMap = {};
  myScans.forEach(s=>{
    myMap[s.barcode]=(myMap[s.barcode]||0)+s.qty;
  });

  products.forEach(p=>{

    const physical = myMap[p.barcode] || 0;
    const book = p.book_count || 0;

    let status="",color="";
    if(physical==book){status="Match";color="green";}
    else if(physical<book){status=`Short ${book-physical}`;color="red";}
    else{status=`Excess ${physical-book}`;color="orange";}

    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>
        <input type="checkbox" class="row-check" data-barcode="${p.barcode}" onchange="updateDeleteUI()">
        ${p.barcode}
      </td>
      <td>${p.item_name || "-"}</td>
      <td>${book}</td>
      <td>${physical}</td>
      <td style="color:${color};font-weight:600">${status}</td>
      <td>
        <span class="edit" onclick="openEditProduct('${p.barcode}','${p.item_name}')">✏️</span>
        <span class="delete"
        onclick="event.preventDefault();event.stopPropagation();openDeleteConfirm(['${p.barcode}'])">🗑</span>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // reset select-all every reload
  const master = document.getElementById("selectAll");
  if(master) master.checked = false;

  renderMyPagination();
  updateDeleteUI();
}


// EDIT FUNCTION //
function editScan(barcode, qty){
  document.getElementById("editBarcodeInput").value = barcode;
  document.getElementById("editQtyInput").value = qty;
  editingId = barcode;
  document.getElementById("editModal").classList.remove("hidden");
}

// MY BARCODE PAGE NUMBER //
function renderMyPagination(){

  const pages = Math.ceil(totalMy / PAGE_SIZE);
  const box = document.getElementById("paginationMy");

  if(!box) return;

  // 🧠 hide if 0 or 1 page
  if(pages <= 1){
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  // 🧠 page overflow protection (CRITICAL)
  if(myPage > pages){
    myPage = pages;
  }

  box.style.display = "flex";

  box.innerHTML = `
    <button class="page-btn" onclick="prevMyPage()" ${myPage===1?'disabled':''}>‹ Prev</button>
    <span class="page-info">Page ${myPage} of ${pages}</span>
    <button class="page-btn" onclick="nextMyPage()" ${myPage===pages?'disabled':''}>Next ›</button>
  `;
}

function nextMyPage(){
  const pages = Math.ceil(totalMy / PAGE_SIZE);
  if(myPage >= pages) return;
  myPage++;
  loadMyBarcodes();
}

function prevMyPage(){
  if(myPage <= 1) return;
  myPage--;
  loadMyBarcodes();
}

// ================= COMMON SUMMARY =================
async function loadCommonSummary(){

  const tbody = document.getElementById("commonSummaryBody");
  tbody.innerHTML = "";

  const res = await supabaseClient
  .from("products")
  .select("*", { count: "exact", head: true });
  const count = res.count || 0;
  totalCommon = count || 0;

  const maxPage = Math.max(1, Math.ceil(totalCommon / PAGE_SIZE));
  if(commonPage > maxPage) commonPage = maxPage;

  // 1️⃣ Products (Book Count + Item Name)
  const from = (commonPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabaseClient
  .from("products")
  .select("*", { count: "exact" });
  if(commonSearch){
    query = query.ilike("barcode", `%${commonSearch}%`);
  }
  
  const result = await query.range(from, to);
  const products = result.data || [];
  totalCommon = result.count || 0;
  // 2️⃣ All scans with users
  const { data: scans } = await supabaseClient
    .from("scans")
    .select("barcode, qty, user_id");

  // user name map
  const { data: profiles } = await supabaseClient
    .from("profiles")
    .select("id, username");

  const userNameMap = {};
  profiles.forEach(p => userNameMap[p.id] = p.username);

  // build scan maps
  const physicalMap = {};
  const userMap = {};

  scans.forEach(s => {

    physicalMap[s.barcode] = (physicalMap[s.barcode] || 0) + s.qty;

    if (!userMap[s.barcode]) userMap[s.barcode] = {};
    userMap[s.barcode][s.user_id] =
      (userMap[s.barcode][s.user_id] || 0) + s.qty;
  });

  products.forEach(p => {

    const book = p.book_count || 0;
    const physical = physicalMap[p.barcode] || 0;

    // status
    let status = "", color = "";
    if (physical === book) {
      status = "Match"; color = "green";
    } else if (physical < book) {
      status = `Short ${book - physical}`; color = "red";
    } else {
      status = `Excess ${physical - book}`; color = "orange";
    }

    // user counts text
    let userCounts = "-";
    if (userMap[p.barcode]) {
      userCounts = Object.entries(userMap[p.barcode])
        .map(([uid, count]) =>
          `${userNameMap[uid] || "unknown"}: ${count}`
        )
        .join(", ");
    }

    const tr = document.createElement("tr");
    tr.innerHTML = `
    <td>
    <input type="checkbox"
    class="common-check"
    data-barcode="${p.barcode}"
    onchange="updateCommonDeleteUI(); syncCommonSelectAll();">
    ${p.barcode}
    </td>
    <td>${p.item_name || "-"}</td>
    <td>${book}</td>
    <td>${physical}</td>
    <td>${userCounts}</td>
    <td>${physical}</td>
    <td style="color:${color};font-weight:600">${status}</td>
    <td>
    <span class="delete"
    onclick="openDeleteConfirm(['${p.barcode}'])">🗑</span>
    </td>
    `;

    tbody.appendChild(tr);
  });

  renderCommonPagination();
  updateCommonDeleteUI();
}

async function openScanEditor(barcode){

  const modal = document.getElementById("scanEditor");
  modal.classList.remove("hidden");

  const barcodeClean = barcode.trim();
  document.getElementById("scanBarcode").value = barcodeClean;

  // get product
  const { data: product } = await supabaseClient
    .from("products")
    .select("*")
    .eq("barcode", barcodeClean)
    .maybeSingle();

  // get all scans of that barcode
  const { data: scansData } = await supabaseClient
    .from("scans")
    .select("user_id, qty")
    .eq("barcode", barcodeClean);

  const scans = scansData || [];

  const itemName = document.getElementById("scanItemName");
  const bookCount = document.getElementById("scanBook");
  const physicalInput = document.getElementById("scanPhysical");
  const usersBox = document.getElementById("scanUsers");
  const statusBox = document.getElementById("scanStatus");

  /* ================= NEW ITEM ================= */

  if(!product){

    itemName.value = "";
    bookCount.value = 0;

    // IMPORTANT → editable
    physicalInput.disabled = false;
    physicalInput.value = 1;

    usersBox.innerText = "New Item";
    statusBox.innerText = "New";

    return;
  }

  /* ================= EXISTING ITEM ================= */

  itemName.value = product.item_name || "";
  bookCount.value = product.book_count || 0;

  // ----------- GROUP USER COUNTS -----------
  let userTotals = {};
  let totalPhysical = 0;
  let myCount = 0;

  scans.forEach(s=>{
    totalPhysical += s.qty;

    // group per user
    if(!userTotals[s.user_id]) userTotals[s.user_id] = 0;
    userTotals[s.user_id] += s.qty;

    // MY COUNT ONLY
    if(s.user_id === currentUserId){
      myCount += s.qty;
    }
  });

  // show MY editable count
  physicalInput.disabled = false;
  physicalInput.value = myCount || 1;

  // show grouped user counts
  let text = "";
  Object.entries(userTotals).forEach(([uid,count])=>{
    text += `${userMap[uid] || "unknown"}: ${count}\n`;
  });

  usersBox.innerText = text || "-";

  // STATUS calculation
  let status = "";
  if(totalPhysical === product.book_count) status = "Match";
  else if(totalPhysical < product.book_count) status = `Short ${product.book_count - totalPhysical}`;
  else status = `Excess ${totalPhysical - product.book_count}`;

  statusBox.innerText = status;

  scanLock = false;
}

async function saveScanEdit(){

  const barcode = scanBarcode.value.trim();
  const name = scanItemName.value.trim();
  const book = parseInt(scanBook.value) || 0;
  const physical = parseInt(scanPhysical.value) || 0;

  // 1️⃣ ensure product exists
  await supabaseClient.from("products").upsert({
    barcode: barcode,
    item_name: name,
    book_count: book
  },{ onConflict:"barcode" });

  // 2️⃣ remove MY previous scans
  await supabaseClient
    .from("scans")
    .delete()
    .eq("barcode", barcode)
    .eq("user_id", currentUserId);

  // 3️⃣ recreate exact physical count
  if(physical > 0){

    const rows = [];
    for(let i=0;i<physical;i++){
      rows.push({
        barcode: barcode,
        user_id: currentUserId,
        qty: 1
      });
    }

    while(rows.length){
      await supabaseClient.from("scans").insert(rows.splice(0,500));
    }
  }

  document.getElementById("scanEditor").classList.add("hidden");

  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  // reopen scanner
  setTimeout(openScanner, 400);

  scanLock = false;
}

function cancelScanEdit(){
  document.getElementById("scanEditor").classList.add("hidden");
  scanLock = false;
  openScanner();
}


// COMMON PAGE NUMBER //
function renderCommonPagination(){

  const pages = Math.ceil(totalCommon / PAGE_SIZE);
  const box = document.getElementById("paginationCommon");

  if(!box) return;

  if(pages <= 1){
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  if(commonPage > pages){
    commonPage = pages;
  }

  box.style.display = "flex";

  box.innerHTML = `
    <button class="page-btn" onclick="prevCommonPage()" ${commonPage===1?'disabled':''}>‹ Prev</button>
    <span class="page-info">Page ${commonPage} of ${pages}</span>
    <button class="page-btn" onclick="nextCommonPage()" ${commonPage===pages?'disabled':''}>Next ›</button>
  `;
}


function nextCommonPage(){
  const pages = Math.ceil(totalCommon / PAGE_SIZE);
  if(commonPage >= pages) return;
  commonPage++;
  loadCommonSummary();
}

function prevCommonPage(){
  if(commonPage <= 1) return;
  commonPage--;
  loadCommonSummary();
}

function toggleCommonSelectAll(master){

  const checkboxes = document.querySelectorAll("#commonSummaryBody .common-check");

  checkboxes.forEach(cb=>{
    cb.checked = master.checked;
  });

  updateCommonDeleteUI();
}

function syncCommonSelectAll(){

  const all = document.querySelectorAll("#commonSummaryBody .common-check");
  const checked = document.querySelectorAll("#commonSummaryBody .common-check:checked");
  const master = document.getElementById("selectAllCommon");

  if(!master) return;

  master.checked = all.length > 0 && all.length === checked.length;
}

function updateCommonDeleteUI(){

  const checked = document.querySelectorAll("#commonSummaryBody .common-check:checked");
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

async function deleteSelectedCommon(){

  const checked = document.querySelectorAll("#commonSummaryBody .common-check:checked");

  if(checked.length === 0){
    showNotify("No barcode selected");
    return;
  }

  const barcodes = Array.from(checked).map(cb => cb.dataset.barcode);

  openDeleteConfirm(barcodes);
}


// ================= SEARCH MY BARCODE =================
function searchBarcode(){
  mySearch = document.getElementById("searchInput").value.trim();
  myPage = 1;   // reset to first page
  loadMyBarcodes();
}


function clearSearch(){
  document.getElementById("searchInput").value = "";
  mySearch = "";
  myPage = 1;
  loadMyBarcodes();
}


// ================= SEARCH COMMON SUMMARY =================
function searchCommonSummary(){
  commonSearch = document.getElementById("commonSearchInput").value.trim();
  commonPage = 1;
  loadCommonSummary();
}


function clearCommonSearch(){
  document.getElementById("commonSearchInput").value = "";
  commonSearch = "";
  commonPage = 1;
  loadCommonSummary();
}

// ================= SEARCH AUDIT TABLE =================
function searchAudit(){
  auditSearch = document.getElementById("auditSearchInput").value.trim();
  auditPage = 1;
  loadAuditTable();
}


function clearAuditSearch(){
  document.getElementById("auditSearchInput").value = "";
  auditSearch = "";
  auditPage = 1;
  loadAuditTable();
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
async function saveEdit(){

  const barcode = document.getElementById("editBarcodeInput").value;
  const qty = parseInt(document.getElementById("editQtyInput").value);
  const name = document.getElementById("editNameInput").value;

  if(isNaN(qty) || qty < 0){
    showNotify("Invalid quantity");
    return;
  }

  // update product name
  await supabaseClient
    .from("products")
    .update({ item_name: name })
    .eq("barcode", barcode);

  // 🔴 REAL INVENTORY UPDATE
  await supabaseClient
    .from("scans")
    .upsert({
      barcode: barcode,
      user_id: currentUserId,
      qty: qty
    }, { onConflict: "barcode,user_id" });

  closeEditModal();

  await loadMyBarcodes();
  await loadCommonSummary();
  await loadAuditTable();

  showNotify("Physical count updated ✔");
}


function updateDeleteUI(){

  const checked = document.querySelectorAll("#myBarcodesBody .row-check:checked");
  const floating = document.getElementById("floatingDelete");
  const count = document.getElementById("deleteCount");

  if(!floating) return;

  if(checked.length>0){
    floating.classList.remove("hidden");
    count.textContent = checked.length;
  }else{
    floating.classList.add("hidden");
  }
}


// Read Excel //
document.getElementById("stockUpload").addEventListener("change", handleStockUpload);

async function handleStockUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = async function(evt) {

    showNotify("Uploading... Please wait ⏳");

    const data = new Uint8Array(evt.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    let batch = [];

    for (let i = 1; i < rows.length; i++) {

      let barcode = rows[i][0]?.toString().replace(/\.0$/, '').trim();
      let qty = parseInt(rows[i][1]);
      let name = String(rows[i][2] || "");

      if (!barcode || isNaN(qty)) continue;

      batch.push({
        barcode: barcode,
        item_name: name,
        book_count: qty
      });

      // upload per 500 rows
      if (batch.length === 500) {
        await supabaseClient
          .from("products")
          .upsert(batch, { onConflict: "barcode" }); // 🔥 IMPORTANT
        batch = [];
      }
    }

    if (batch.length > 0) {
      await supabaseClient
        .from("products")
        .upsert(batch, { onConflict: "barcode" });
    }

    showNotify("Stock Updated Successfully ✔");

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
async function deleteProduct(barcode){

  if(!confirm("Delete this barcode for ALL users?")) return;

  await supabaseClient.from("products").delete().eq("barcode",barcode);
  await supabaseClient.from("scans").delete().eq("barcode",barcode);

  loadMyBarcodes();
  loadCommonSummary();
  loadAuditTable();
}


// ================= DELETE COMMON (BULK) =================
function deleteSelectedMyBarcodes(){

  const checked = document.querySelectorAll("#myBarcodesBody .row-check:checked");

  if(checked.length === 0){
    showNotify("No barcode selected");
    return;
  }

  const barcodes = Array.from(checked).map(cb=>cb.dataset.barcode);

  openDeleteConfirm(barcodes);
}


async function openEditProduct(barcode, name){

  // barcode
  document.getElementById("editBarcodeInput").value = barcode;
  document.getElementById("editBarcodeInput").disabled = true;

  // item name
  document.getElementById("editNameInput").value = name || "";

  // 🔴 GET MY PHYSICAL COUNT
  const { data: myScans } = await supabaseClient
    .from("scans")
    .select("qty")
    .eq("barcode", barcode)
    .eq("user_id", currentUserId);

  let myPhysical = 0;

  if(myScans){
    myScans.forEach(s => myPhysical += s.qty);
  }

  // set physical count in modal
  document.getElementById("editQtyInput").value = myPhysical;

  document.getElementById("editModal").classList.remove("hidden");
}



// ================= DOWNLOAD MY BARCODES EXCEL =================
async function downloadMyBarcodesExcel(){

  if(!currentUserId){
    showNotify("User not ready");
    return;
  }

  // GET ALL PRODUCTS (no 1000 limit)
  const products = await fetchAll("products");

  // GET ALL MY SCANS
  const scans = await supabaseClient
    .from("scans")
    .select("barcode, qty, created_at")
    .eq("user_id", currentUserId);

  const scanRows = scans.data || [];

  // build physical map
  const physicalMap = {};
  const lastScanMap = {};

  scanRows.forEach(s=>{
    physicalMap[s.barcode] = (physicalMap[s.barcode] || 0) + s.qty;
    lastScanMap[s.barcode] = s.created_at;
  });

  const rows = [];

  products.forEach(p=>{

    const book = p.book_count || 0;
    const physical = physicalMap[p.barcode] || 0;

    let status="";
    if(book === physical) status="Match";
    else if(physical < book) status=`Short ${book-physical}`;
    else status=`Excess ${physical-book}`;

    rows.push({
      Barcode: p.barcode,
      "Item Name": p.item_name || "-",
      "Book Count": book,
      "Physical Count": physical,
      Status: status,
    });

  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "My Barcodes");

  XLSX.writeFile(wb, "My-Barcodes.xlsx");
}


// ================= DOWNLOAD COMMON SUMMARY EXCEL =================
async function downloadCommonSummaryExcel(){

  // get ALL products
  const products = await fetchAll("products");

  // get ALL scans
  const scans = await fetchAll("scans");

  // get usernames
  const profiles = await fetchAll("profiles");

  const nameMap = {};
  profiles.forEach(p => nameMap[p.id] = p.username);

  // build maps
  const physicalMap = {};
  const userMap = {};

  scans.forEach(s=>{

    // total physical
    physicalMap[s.barcode] = (physicalMap[s.barcode] || 0) + s.qty;

    // per user
    if(!userMap[s.barcode]) userMap[s.barcode] = {};

    userMap[s.barcode][s.user_id] =
      (userMap[s.barcode][s.user_id] || 0) + s.qty;
  });

  const rows = [];

  products.forEach(p=>{

    const book = p.book_count || 0;
    const physical = physicalMap[p.barcode] || 0;

    let status="";
    if(book === physical) status="Match";
    else if(physical < book) status=`Short ${book-physical}`;
    else status=`Excess ${physical-book}`;

    // user counts text (SAME AS DASHBOARD)
    let userCounts = "-";

    if(userMap[p.barcode]){
      userCounts = Object.entries(userMap[p.barcode])
        .map(([uid,count]) => `${nameMap[uid] || "unknown"}: ${count}`)
        .join(", ");
    }

    rows.push({
      Barcode: p.barcode,
      "Item Name": p.item_name || "-",
      "Book Count": book,
      "Physical Count": physical,
      "User Counts": userCounts,
      Status: status
    });

  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Common Summary");

  XLSX.writeFile(wb, "Common-Summary.xlsx");
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

    // stop any previous camera
    if (html5QrCode) {
      try {
        await html5QrCode.stop();
      } catch(e){}
      html5QrCode = null;
    }

    // create scanner
    html5QrCode = new Html5Qrcode("reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      {
        fps: 8,
        qrbox: { width: 300, height: 140 }
      },

      // ===== WHEN BARCODE IS DETECTED =====
      async (decodedText) => {

        // prevent multiple triggers
        if (scanLock) return;
        scanLock = true;

        try {

          // STOP CAMERA FIRST
          if (html5QrCode) {
            await html5QrCode.stop();
            html5QrCode = null;
          }

          // hide camera UI
          document.getElementById("scannerOverlay").classList.add("hidden");

          // beep sound
          beep.currentTime = 0;
          beep.play().catch(()=>{});

          const barcode = normalizeBarcode(decodedText);

          // duplicate scan protection
          const now = Date.now();
          if (barcode === lastScanValue && (now - lastScanTimestamp) < 1500) {
            scanLock = false;
            return;
          }

          lastScanValue = barcode;
          lastScanTimestamp = now;

          // allow camera to release before popup
          setTimeout(() => {
            handleScannedBarcode(barcode);
          }, 150);

        } catch (err) {
          console.error("SCAN ERROR:", err);
          scanLock = false;
          closeScanner(true);
        }
      }
    );

  } catch (err) {
    console.error("Camera start error:", err);
    showNotify("Camera permission denied or camera not available");
    closeScanner(true);
  }
}


function normalizeBarcode(code){
  let c = String(code).replace(/\D/g,'');

  // EAN padding fix (CRITICAL)
  if(c.length === 12) c = "0" + c;

  return c;
}

async function handleScannedBarcode(rawCode){

  const barcode = normalizeBarcode(rawCode);

  // play beep (guaranteed)
  try{
    beep.currentTime = 0;
    await beep.play();
  }catch(e){}

  // ALWAYS OPEN EDITOR
  await openScanEditor(barcode);

  // unlock scanner
  scanLock = false;
}


async function savePhysicalCount(barcode, qty){

  // remove my previous scans
  await supabaseClient
    .from("scans")
    .delete()
    .eq("user_id", currentUserId)
    .eq("barcode", barcode);

  // recreate exact count
  if(qty > 0){

    const rows = [];

    for(let i=0;i<qty;i++){
      rows.push({
        user_id: currentUserId,
        barcode: barcode,
        qty: 1
      });
    }

    while(rows.length){
      await supabaseClient.from("scans").insert(rows.splice(0,500));
    }
  }
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
async function loadAuditTable(){

  const tbody = document.getElementById("auditBody");
  tbody.innerHTML = "";

  const res = await supabaseClient
  .from("products")
  .select("*", { count: "exact", head: true });
  const count = res.count || 0;
  totalAudit = count || 0;

  const maxPage = Math.max(1, Math.ceil(totalAudit / PAGE_SIZE));
  if(auditPage > maxPage) auditPage = maxPage;


  // 1️⃣ Uploaded stock (BOOK COUNT)
  const from = (auditPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  let query = supabaseClient
  .from("products")
  .select("*", { count: "exact" });
  if(auditSearch){
  query = query.ilike("barcode", `%${auditSearch}%`);
}

const result = await query.range(from, to);
const products = result.data || [];
totalAudit = result.count || 0;



  // 2️⃣ All users scans (PHYSICAL COUNT)
  const { data: allScans } = await supabaseClient
    .from("scans")
    .select("barcode, qty");

  // Create total scan map
  const physicalMap = {};

  allScans.forEach(s=>{
    physicalMap[s.barcode] = (physicalMap[s.barcode] || 0) + s.qty;
  });

  // combine all barcodes
  const barcodeSet = new Set([
    ...products.map(p=>p.barcode),
    ...Object.keys(physicalMap)
  ]);

  barcodeSet.forEach(code=>{

    const product = products.find(p=>p.barcode === code);

    const book = product ? (productSafe?.book_count || 0) : 0;
    const name = product ? (productSafe?.item_name || "-") : "-";
    const physical = physicalMap[code] || 0;

    let status="",color="";

    if(book === physical){
      status="Match";
      color="green";
    }
    else if(physical < book){
      status=`Short ${book-physical}`;
      color="red";
    }
    else{
      status=`Excess ${physical-book}`;
      color="orange";
    }

    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${code}</td>
      <td>${name}</td>
      <td>${book}</td>
      <td>${physical}</td>
      <td style="color:${color};font-weight:600">${status}</td>
    `;

    tbody.appendChild(tr);
  });

  renderAuditPagination();
}

// AUDIT PAGE NUMBER //
function renderAuditPagination(){

  const pages = Math.ceil(totalAudit / PAGE_SIZE);
  const box = document.getElementById("paginationAudit");

  if(!box) return;

  if(pages <= 1){
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  if(auditPage > pages){
    auditPage = pages;
  }

  box.style.display = "flex";

  box.innerHTML = `
    <button class="page-btn" onclick="prevAuditPage()" ${auditPage===1?'disabled':''}>‹ Prev</button>
    <span class="page-info">Page ${auditPage} of ${pages}</span>
    <button class="page-btn" onclick="nextAuditPage()" ${auditPage===pages?'disabled':''}>Next ›</button>
  `;
}


function nextAuditPage(){
  const pages = Math.ceil(totalAudit / PAGE_SIZE);
  if(auditPage >= pages) return;
  auditPage++;
  loadAuditTable();
}

function prevAuditPage(){
  if(auditPage <= 1) return;
  auditPage--;
  loadAuditTable();
}

// ================= DOWNLOAD AUDIT REPORT EXCEL =================
async function downloadAuditExcel(){

  const products = await fetchAll("products");
  const scans = await fetchAll("scans");


  const physicalMap = {};
  scans.forEach(s=>{
    physicalMap[s.barcode]=(physicalMap[s.barcode]||0)+s.qty;
  });

  const allCodes = new Set([
    ...products.map(p=>p.barcode),
    ...Object.keys(physicalMap)
  ]);

  const rows=[];

  allCodes.forEach(code=>{

    const product = products.find(p=>p.barcode===code);

    const name = product?.item_name || "-";
    const book = product?.book_count || 0;
    const physical = physicalMap[code] || 0;

    let status="";
    if(book===physical) status="Match";
    else if(physical<book) status=`Short ${book-physical}`;
    else status=`Excess ${physical-book}`;

    rows.push({
      Barcode: code,
      "Item Name": name,
      "Book Count": book,
      "Physical Count": physical,
      Status: status
    });

  });

  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Audit Compare");

  XLSX.writeFile(wb,"Audit-Compare-Report.xlsx");
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
