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
  if (!userReady || !currentUserId) return;

  const input = document.getElementById("barcode-input");
  const barcode = (input?.value || "").trim();
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

  if (input) input.value = "";

  await loadMyBarcodes();
  await loadCommonSummary();
}

// ================= CAMERA (SCAN → SAVE → CLOSE → HOME) =================
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
        // 1) STOP CAMERA
        await html5QrCode.stop().catch(() => {});
        html5QrCode = null;

        // 2) SAVE BARCODE
        const input = document.getElementById("barcode-input");
        if (input) input.value = decodedText;
        await saveBarcode();

        // 3) SHOW ✅
        showScanSuccess();

        // 4) CLOSE SCANNER OVERLAY (back to dashboard)
        setTimeout(() => {
          closeScanner();
        }, 900);
      }
    );
  } catch (err) {
    console.error(err);
    showNotify("Camera error or permission denied");
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

// ================= TABLES =================
async function loadMyBarcodes() {
  const tbody = document.getElementById("myBarcodesBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const { data } = await supabaseClient
    .from("user_scans")
    .select("*")
    .eq("user_id", currentUserId)
    .order("created_at", { ascending: false });

  (data || []).forEach(row => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.barcode}</td>
      <td>${row.quantity}</td>
      <td>${new Date(row.created_at).toLocaleDateString()}</td>
      <td>
        <span
          class="delete"
          title="Edit count"
          onclick="editBarcodeCount('${row.barcode}', ${row.quantity})"
        >✏️</span>
        &nbsp;&nbsp;
        <span
          class="delete"
          title="Delete barcode"
          onclick="deleteBarcode('${row.barcode}')"
        >🗑</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadCommonSummary() {
  const tbody = document.getElementById("commonSummaryBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const { data } = await supabaseClient
    .from("user_scans")
    .select("barcode, quantity");

  const summary = {};
  (data || []).forEach(row => {
    summary[row.barcode] = (summary[row.barcode] || 0) + row.quantity;
  });

  Object.entries(summary).forEach(([barcode, total]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${barcode}</td>
      <td>${total}</td>
    `;
    tbody.appendChild(tr);
  });
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

// ================= DELETE (MY) =================
async function deleteBarcode(barcode) {
  const { error } = await supabaseClient
    .from("user_scans")
    .delete()
    .eq("barcode", barcode)
    .eq("user_id", currentUserId);

  if (error) {
    showNotify("Delete failed");
    return;
  }

  await loadMyBarcodes();
  await loadCommonSummary();
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
