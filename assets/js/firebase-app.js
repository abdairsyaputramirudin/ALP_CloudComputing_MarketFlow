import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  get,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { firebaseConfig, adminEmail } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const database = getDatabase(app);
export const storage = getStorage(app);

export function isFirebaseConfigured() {
  return !Object.values(firebaseConfig).some((value) =>
    String(value).includes("ISI_"),
  );
}

export function showAlert(message, type = "success") {
  const wrapper = document.querySelector("#alert-area");
  if (!wrapper) {
    window.alert(message);
    return;
  }

  wrapper.innerHTML = `
    <div class="alert alert-${type} alert-dismissible fade show" role="alert">
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    </div>
  `;
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export async function getCurrentUserRole(user) {
  if (!user) {
    return null;
  }

  try {
    // Ambil role user dari Realtime DB, batasi waktu biar tidak macet.
    const roleSnapshot = await Promise.race([
      get(ref(database, `users/${user.uid}`)),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("role-check-timeout")), 5000);
      }),
    ]);

    const profile = roleSnapshot.val();
    if (profile?.role) {
      return profile.role;
    }
  } catch (_error) {}

  return user.email === adminEmail ? "admin" : "user";
}

export function requireLogin(callback) {
  onAuthStateChanged(auth, (user) => {
    if (!isFirebaseConfigured()) {
      showAlert("Konfigurasi Firebase belum diisi.", "warning");
      return;
    }

    if (!user) {
      window.location.href = "login.html";
      return;
    }

    callback(user);
  });
}

export function requireAdmin(callback) {
  requireLogin(async (user) => {
    const role = await getCurrentUserRole(user);
    // User non-admin tidak boleh akses halaman admin.
    if (role !== "admin") {
      window.location.href = "dashboard-user.html";
      return;
    }

    callback(user);
  });
}

export function setupLogoutButton() {
  const logoutButton = document.querySelector("#logout-button");
  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}
