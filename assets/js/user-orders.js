import {
  ref,
  onValue,
  update,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  auth,
  database,
  requireLogin,
  setupLogoutButton,
  showAlert
} from "./firebase-app.js";

const list = document.querySelector("#order-list");
const paymentButtons = document.querySelectorAll("[data-payment-filter]");
const typeButtons = document.querySelectorAll("[data-type-filter]");
let paymentFilter = "Semua";
let typeFilter = "Semua";
let orderCache = {};
let countdownInterval = null;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(dateId) {
  if (!dateId) {
    return null;
  }
  const date = new Date(`${dateId}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function diffDays(dateId) {
  const target = parseDate(dateId);
  if (!target) {
    return null;
  }
  const msDay = 24 * 60 * 60 * 1000;
  return Math.ceil((target.getTime() - startOfToday().getTime()) / msDay);
}

function normalizePaymentStatus(status) {
  if (status === "Belum Dibayar" || status === "Ditolak") {
    return "Belum Terverifikasi";
  }
  if (status === "Terverifikasi") {
    return "Lunas";
  }
  if (status === "Menunggu Verifikasi" || status === "Lunas" || status === "Belum Terverifikasi") {
    return status;
  }
  return "Belum Terverifikasi";
}

function getPaymentBadgeClass(status) {
  if (status === "Lunas") {
    return "text-bg-success";
  }
  if (status === "Menunggu Verifikasi") {
    return "text-bg-warning";
  }
  return "text-bg-secondary";
}

function getRentalTimeText(order) {
  const startDate = order.actualRentalStartDate || order.rentalStartDate;
  const days = diffDays(order.rentalEndDate);

  if (order.rentalStatus === "Dikembalikan") {
    return "Sewa sudah selesai.";
  }

  if (order.rentalStatus !== "Dipinjam") {
    const waitDays = diffDays(startDate);
    if (waitDays === null) {
      return "-";
    }
    if (waitDays > 0) {
      return `Mulai ${waitDays} hari lagi`;
    }
    return "Menunggu admin ubah status ke Dipinjam";
  }

  if (days === null) {
    return "-";
  }
  if (days < 0) {
    return `Lewat ${Math.abs(days)} hari`;
  }
  return `Sisa ${days} hari`;
}

async function confirmOrderAction(orderId, action) {
  try {
    if (action === "confirm-product") {
      await update(ref(database, `orders/${orderId}`), {
        buyerReceivedConfirmed: true,
        buyerReceivedAt: serverTimestamp()
      });
      showAlert("Konfirmasi barang diterima berhasil.", "success");
      return;
    }

    if (action === "confirm-service") {
      await update(ref(database, `orders/${orderId}`), {
        serviceDoneConfirmed: true,
        serviceDoneConfirmedAt: serverTimestamp()
      });
      showAlert("Konfirmasi jasa selesai berhasil.", "success");
      return;
    }

    if (action === "confirm-rental-pickup") {
      await update(ref(database, `orders/${orderId}`), {
        rentalReceivedConfirmed: true,
        rentalReceivedAt: serverTimestamp()
      });
      showAlert("Konfirmasi barang sewa diterima berhasil.", "success");
      return;
    }

    if (action === "confirm-rental-return") {
      await update(ref(database, `orders/${orderId}`), {
        rentalReturnedConfirmed: true,
        rentalReturnedAt: serverTimestamp()
      });
      showAlert("Konfirmasi pengembalian barang sewa berhasil.", "success");
    }
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

function renderOrderProgress(order, orderId) {
  if (order.type === "produk") {
    return `
      <small>Status pengiriman: ${order.shippingStatus || "Diproses"}</small>
      <small>Konfirmasi terima: ${order.buyerReceivedConfirmed ? "Sudah" : "Belum"}</small>
      ${(order.shippingStatus === "Sampai") && !order.buyerReceivedConfirmed
        ? `<button class="btn btn-sm btn-outline-success mt-2" data-user-action="confirm-product" data-order-id="${orderId}">Konfirmasi Barang Diterima</button>`
        : ""}
    `;
  }

  if (order.type === "jasa") {
    return `
      <small>Deadline: ${order.serviceDeadline || "-"}</small>
      <small>Status jasa: ${order.serviceStatus || "Menunggu Pengerjaan"}</small>
      <small>Konfirmasi selesai: ${order.serviceDoneConfirmed ? "Sudah" : "Belum"}</small>
      ${order.serviceStatus === "Selesai" && !order.serviceDoneConfirmed
        ? `<button class="btn btn-sm btn-outline-success mt-2" data-user-action="confirm-service" data-order-id="${orderId}">Konfirmasi Jasa Selesai</button>`
        : ""}
    `;
  }

  if (order.type === "sewa") {
    return `
      <small>Jadwal mulai: ${order.rentalStartDate || "-"}</small>
      <small>Mulai aktif: ${order.actualRentalStartDate || order.rentalStartDate || "-"}</small>
      <small>Batas kembali: ${order.rentalEndDate || "-"} (${getRentalTimeText(order)})</small>
      <small>Status sewa: ${order.rentalStatus || "Menunggu Pengambilan"}</small>
      <div class="d-flex gap-2 flex-wrap mt-2">
        ${order.rentalStatus === "Dipinjam" && !order.rentalReceivedConfirmed
          ? `<button class="btn btn-sm btn-outline-success" data-user-action="confirm-rental-pickup" data-order-id="${orderId}">Konfirmasi Barang Diterima</button>`
          : ""}
        ${order.rentalStatus === "Dikembalikan" && !order.rentalReturnedConfirmed
          ? `<button class="btn btn-sm btn-outline-secondary" data-user-action="confirm-rental-return" data-order-id="${orderId}">Konfirmasi Barang Dikembalikan</button>`
          : ""}
      </div>
    `;
  }

  return "";
}

function getFilteredEntries() {
  const entries = orderCache
    ? Object.entries(orderCache).filter(([, order]) => order.userId === auth.currentUser.uid).reverse()
    : [];

  return entries.filter(([, order]) => {
    const matchPayment = paymentFilter === "Semua"
      || normalizePaymentStatus(order.paymentStatus) === paymentFilter;
    const matchType = typeFilter === "Semua" || order.type === typeFilter;
    return matchPayment && matchType;
  });
}

function renderOrders(data) {
  orderCache = data || {};
  const entries = getFilteredEntries();

  if (!entries.length) {
    list.innerHTML = `<div class="empty-card">Belum ada order untuk filter yang dipilih.</div>`;
    return;
  }

  list.innerHTML = entries
    .map(([id, order]) => `
      <article class="data-card">
        <div>
          <div class="d-flex gap-2 mb-2 flex-wrap">
            <span class="badge text-bg-dark text-capitalize">${order.type}</span>
            <span class="badge ${getPaymentBadgeClass(normalizePaymentStatus(order.paymentStatus))}">${normalizePaymentStatus(order.paymentStatus)}</span>
          </div>
          <h3>${order.itemName}</h3>
          <p class="mb-1">Metode: ${order.paymentMethod || "-"}</p>
          <small>Buyer: ${order.buyerName || "-"} (${order.buyerWhatsapp || "-"})</small>
          ${renderOrderProgress(order, id)}
          <div class="mt-2 d-flex gap-2 flex-wrap">
            ${order.proofLink ? `<a class="btn btn-sm btn-outline-secondary" href="${order.proofLink}" target="_blank" rel="noreferrer">Lihat Bukti Bayar</a>` : ""}
            ${order.adminWhatsappUrl ? `<a class="btn btn-sm btn-success" href="${order.adminWhatsappUrl}" target="_blank" rel="noreferrer">Chat Admin</a>` : ""}
          </div>
          <div class="mt-3">
            <small class="d-block">Catatan admin:</small>
            <p class="mb-1">${order.adminNote || "-"}</p>
            ${order.adminAttachmentLink ? `<a href="${order.adminAttachmentLink}" target="_blank" rel="noreferrer">Lihat Link dari Admin</a>` : ""}
          </div>
        </div>
      </article>
    `)
    .join("");

  list.querySelectorAll("[data-user-action]").forEach((button) => {
    button.addEventListener("click", () => {
      confirmOrderAction(button.dataset.orderId, button.dataset.userAction);
    });
  });
}

function setupFilters() {
  paymentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      paymentFilter = button.dataset.paymentFilter;
      paymentButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderOrders(orderCache);
    });
  });

  typeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      typeFilter = button.dataset.typeFilter;
      typeButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderOrders(orderCache);
    });
  });
}

function setupCountdownRefresh() {
  if (countdownInterval) {
    return;
  }
  countdownInterval = setInterval(() => {
    renderOrders(orderCache);
  }, 60000);
}

requireLogin(() => {
  setupLogoutButton();
  setupFilters();
  setupCountdownRefresh();
  onValue(ref(database, "orders"), (snapshot) => {
    renderOrders(snapshot.val());
  });
});
