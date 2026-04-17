import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
  signOut,
  reload
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref,
  set,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  auth,
  database,
  getCurrentUserRole,
  isFirebaseConfigured,
  showAlert
} from "./firebase-app.js";
import { adminEmail } from "./firebase-config.js";

const registerForm = document.querySelector("#register-form");
const loginForm = document.querySelector("#login-form");

if (loginForm) {
  // Notif setelah register sukses.
  const query = new URLSearchParams(window.location.search);
  if (query.get("registered") === "1") {
    showAlert("Akun berhasil dibuat. Harap cek email Anda, klik link verifikasi, lalu login.", "success");
  }
}

function getAuthErrorMessage(error, context = "login") {
  const code = error?.code || "";

  const commonMap = {
    "auth/invalid-email": "Format email tidak valid.",
    "auth/network-request-failed": "Koneksi internet bermasalah. Coba lagi.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi beberapa saat.",
    "auth/user-disabled": "Akun ini dinonaktifkan."
  };

  const loginMap = {
    "auth/invalid-credential": "Email atau password salah.",
    "auth/user-not-found": "Email belum terdaftar.",
    "auth/wrong-password": "Password salah."
  };

  const registerMap = {
    "auth/email-already-in-use": "Email sudah terdaftar. Silakan login.",
    "auth/weak-password": "Password terlalu lemah. Minimal 6 karakter."
  };

  if (commonMap[code]) {
    return commonMap[code];
  }

  if (context === "login" && loginMap[code]) {
    return loginMap[code];
  }

  if (context === "register" && registerMap[code]) {
    return registerMap[code];
  }

  return "Terjadi kendala saat proses autentikasi. Coba lagi.";
}

if (registerForm) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isFirebaseConfigured()) {
      showAlert("Isi konfigurasi Firebase terlebih dahulu.", "warning");
      return;
    }

    const name = document.querySelector("#name").value.trim();
    const email = document.querySelector("#email").value.trim();
    const password = document.querySelector("#password").value;

    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const role = email === adminEmail ? "admin" : "user";

      // Kirim verifikasi email segera setelah akun dibuat.
      await sendEmailVerification(credential.user);

      try {
        await updateProfile(credential.user, { displayName: name });
      } catch (_profileError) {
        // Tidak memblokir proses utama register.
      }

      try {
        await set(ref(database, `users/${credential.user.uid}`), {
          name,
          email,
          role,
          createdAt: serverTimestamp()
        });
      } catch (_dbError) {
        showAlert("Akun berhasil dibuat, namun penyimpanan profil ke database gagal sementara.", "warning");
      }

      showAlert("Pendaftaran berhasil. Harap cek email Anda dan verifikasi akun terlebih dahulu.", "success");
      registerForm.reset();
      setTimeout(() => {
        window.location.href = "login.html?registered=1";
      }, 1200);
    } catch (error) {
      showAlert(getAuthErrorMessage(error, "register"), "danger");
    }
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isFirebaseConfigured()) {
      showAlert("Isi konfigurasi Firebase terlebih dahulu.", "warning");
      return;
    }

    const email = document.querySelector("#email").value.trim();
    const password = document.querySelector("#password").value;

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      await reload(credential.user);
      // Login ditahan jika email belum diverifikasi.
      if (!credential.user.emailVerified) {
        try {
          await sendEmailVerification(credential.user);
        } catch (_verifyError) {
          // Abaikan error resend agar tetap tampil pesan verifikasi.
        }
        await signOut(auth);
        showAlert("Harap verifikasi email Anda terlebih dahulu sebelum login. Cek inbox/spam untuk link verifikasi.", "warning");
        return;
      }

      // Arahkan user sesuai role.
      const role = await getCurrentUserRole(credential.user);

      if (role === "admin") {
        window.location.href = "dashboard-admin.html";
      } else {
        window.location.href = "dashboard-user.html";
      }
    } catch (error) {
      showAlert(getAuthErrorMessage(error, "login"), "danger");
    }
  });
}
