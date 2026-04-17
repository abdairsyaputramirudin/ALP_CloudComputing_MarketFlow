import {
  ref,
  onValue,
  update
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  database,
  requireAdmin,
  setupLogoutButton,
  showAlert
} from "./firebase-app.js";

const list = document.querySelector("#order-list");

async function updatePaymentStatus(orderId, status) {
  try {
    // Admin update status pembayaran pesanan.
    await update(ref(database, `orders/${orderId}`), {
      paymentStatus: status
    });
    showAlert("Status pembayaran berhasil diupdate.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

function renderOrders(data) {
  const entries = data ? Object.entries(data).reverse() : [];

  if (!entries.length) {
    list.innerHTML = '<div class="empty-card">Belum ada order masuk.</div>';
    return;
  }

  list.innerHTML = entries
    .map(([id, order]) => `
      <article class="data-card">
        <div>
          <span class="badge text-bg-success text-capitalize">${order.type}</span>
          <h3>${order.itemName}</h3>
          <p>${order.userEmail || "Email user belum tersedia"}</p>
          <small>Metode: ${order.paymentMethod} | Status: ${order.paymentStatus}</small>
          <div class="mt-2 d-flex gap-2 flex-wrap">
            ${order.proofUrl ? `<a class="btn btn-sm btn-outline-dark" href="${order.proofUrl}" target="_blank" rel="noreferrer">Lihat Bukti Bayar</a>` : ""}
            ${order.proofLink ? `<a class="btn btn-sm btn-outline-secondary" href="${order.proofLink}" target="_blank" rel="noreferrer">Bukti via Link</a>` : ""}
            ${order.whatsappUrl ? `<a class="btn btn-sm btn-success" href="${order.whatsappUrl}" target="_blank" rel="noreferrer">Konfirmasi via WhatsApp</a>` : ""}
          </div>
        </div>
        <div class="data-card__actions">
          <select class="form-select form-select-sm" data-order-status="${id}">
            <option value="Belum Dibayar" ${order.paymentStatus === "Belum Dibayar" ? "selected" : ""}>Belum Dibayar</option>
            <option value="Menunggu Verifikasi" ${order.paymentStatus === "Menunggu Verifikasi" ? "selected" : ""}>Menunggu Verifikasi</option>
            <option value="Terverifikasi" ${order.paymentStatus === "Terverifikasi" ? "selected" : ""}>Terverifikasi</option>
            <option value="Ditolak" ${order.paymentStatus === "Ditolak" ? "selected" : ""}>Ditolak</option>
          </select>
        </div>
      </article>
    `)
    .join("");

  list.querySelectorAll("[data-order-status]").forEach((select) => {
    select.addEventListener("change", () => {
      updatePaymentStatus(select.dataset.orderStatus, select.value);
    });
  });
}

requireAdmin(() => {
  setupLogoutButton();
  // Tampilkan order masuk secara realtime.
  onValue(ref(database, "orders"), (snapshot) => {
    renderOrders(snapshot.val());
  });
});
