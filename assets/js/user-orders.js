import {
  ref,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  auth,
  database,
  requireLogin,
  setupLogoutButton
} from "./firebase-app.js";

const list = document.querySelector("#order-list");

function renderOrders(data) {
  const entries = data
    ? Object.entries(data).filter(([, order]) => order.userId === auth.currentUser.uid).reverse()
    : [];

  if (!entries.length) {
    list.innerHTML = '<div class="empty-card">Kamu belum memiliki pesanan.</div>';
    return;
  }

  list.innerHTML = entries
    .map(([, order]) => `
      <article class="data-card">
        <div>
          <span class="badge text-bg-success text-capitalize">${order.type}</span>
          <h3>${order.itemName}</h3>
          <p>Metode: ${order.paymentMethod}</p>
          <small>Status pembayaran: ${order.paymentStatus}</small>
          <div class="mt-2 d-flex gap-2 flex-wrap">
            ${order.proofUrl ? `<a class="btn btn-sm btn-outline-dark" href="${order.proofUrl}" target="_blank" rel="noreferrer">Lihat Bukti Bayar</a>` : ""}
            ${order.proofLink ? `<a class="btn btn-sm btn-outline-secondary" href="${order.proofLink}" target="_blank" rel="noreferrer">Bukti via Link</a>` : ""}
            ${order.whatsappUrl ? `<a class="btn btn-sm btn-success" href="${order.whatsappUrl}" target="_blank" rel="noreferrer">Konfirmasi via WhatsApp</a>` : ""}
          </div>
        </div>
      </article>
    `)
    .join("");
}

requireLogin(() => {
  setupLogoutButton();
  onValue(ref(database, "orders"), (snapshot) => {
    renderOrders(snapshot.val());
  });
});
