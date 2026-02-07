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

// ================= ✅ SCAN CONFIRMATION =================
function showScanSuccess() {
  const el = document.getElementById("scanSuccess");
  if (!el) return;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 900);
}

// ================= 🔔 NOTIFICATION =================
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
    `${userMap[currentUserId] || "User"} Dashboard`;

  await loadMyBarcodes();
  await loadCommonSummary();
  userReady = true;
}

// ================= SAVE BARCODE =================
async function saveBarcode() {
  if (!userReady) return;

  const input = document.getElementById("barcode-input");
  const barcode = input.value.trim();
  if (!barcode) return;

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

  input.value = "";
  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= CAMERA (STOP → SAVE → TICK → RESTART) =================
async function openScanner() {
  if (!userReady) {
    showNotify("Please wait, loading user...");
    return;
  }

  document.getElementById("scannerOverlay").classList.remove("hidden");

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

        // 1️⃣ TURN OFF CAMERA
        await html5QrCode.stop().catch(() => {});
        html5QrCode = null;

        // 2️⃣ SAVE BARCODE
        document.getElementById("barcode-input").value = decodedText;
        await saveBarcode();

        // 3️⃣ SHOW ✅
        showScanSuccess();

        // 4️⃣ RESTART CAMERA AFTER SHORT DELAY
        setTimeout(() => openScanner(), 900);
      }
    );
  } catch (err) {
    console.error(err);
    showNotify("Camera error or permission denied");
  }
}

// ================= TABLES =================
async function loadMyBarcodes() {
  const tbody = document.getElementById("myBarcodesBody");
  tbody.innerHTML = "";

  const { data } = await supabaseClient
    .from("user_scans")
    .select("*")
    .eq("user_id", currentUserId)
    .order("created_at", { ascending: false });

  data?.forEach(row => {
    tbody.innerHTML += `
      <tr>
        <td>${row.barcode}</td>
        <td>${row.quantity}</td>
        <td>${new Date(row.created_at).toLocaleDateString()}</td>
        <td>
          <span class="delete" onclick="deleteBarcode('${row.barcode}')">🗑</span>
        </td>
      </tr>`;
  });
}

async function loadCommonSummary() {
  const tbody = document.getElementById("commonSummaryBody");
  tbody.innerHTML = "";

  const { data } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity, user_id");

  const summary = {};

  data?.forEach(row => {
    summary[row.barcode] = (summary[row.barcode] || 0) + row.quantity;
  });

  Object.entries(summary).forEach(([barcode, total]) => {
    tbody.innerHTML += `
      <tr>
        <td>${barcode}</td>
        <td>${total}</td>
      </tr>`;
  });
}

// ================= DELETE =================
async function deleteBarcode(barcode) {
  await supabaseClient
    .from("user_scans")
    .delete()
    .eq("barcode", barcode)
    .eq("user_id", currentUserId);

  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= LOGOUT =================
async function logout() {
  await supabaseClient.auth.signOut();
  localStorage.clear();
  window.location.href = "../login-UI/signin.html";
}

// ================= INIT =================
loadUser();
