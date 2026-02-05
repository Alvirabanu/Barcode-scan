// ================= SUPABASE SETUP =================
const SUPABASE_URL = "https://gunkkbepdlsdwgxgpcxj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable__peI72hPciL0iaBVn0odIg_Uv6D1OTz";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// ================= SIGN UP =================
async function signUp() {
  const username = document.querySelector('input[type="text"]').value.trim();
  const email = document.querySelector('input[type="email"]').value.trim();
  const password = document.querySelector('input[type="password"]').value;

  if (!username || !email || !password) {
    alert("Please fill all fields");
    return;
  }

  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      // 🔑 IMPORTANT: redirect AFTER email verification
      emailRedirectTo: "http://127.0.0.1:5500/login-UI/signin.html"
    }
  });

  if (error) {
    alert(error.message);
  } else {
    alert("Signup successful! Please verify your email, then log in.");
    window.location.href = "signin.html";
  }
}

// ================= SIGN IN =================
async function signIn() {
  const email = document.querySelector('input[type="email"]').value.trim();
  const password = document.querySelector('input[type="password"]').value;

  if (!email || !password) {
    alert("Please enter email and password");
    return;
  }

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    alert(error.message);
    return;
  }

  // 🔒 Block unverified users
  if (!data.user.email_confirmed_at) {
    alert("Please verify your email before logging in.");
    return;
  }

  // ✅ ALWAYS redirect to dashboard index
  window.location.href = "../dashboard-UI/";
}

// ================= FORGOT PASSWORD =================
async function forgotPassword() {
  const email = document.querySelector('input[type="email"]').value.trim();

  if (!email) {
    alert("Enter your email first");
    return;
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: "http://127.0.0.1:5500/login-UI/signin.html"
  });

  if (error) {
    alert(error.message);
  } else {
    alert("Password reset email sent. Check your inbox.");
  }
}
