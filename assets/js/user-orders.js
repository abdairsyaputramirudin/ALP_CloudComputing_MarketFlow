import {
  ref,
  onValue,
  update,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  auth,
  database,
  formatDateTime,
  parseTimestamp,
  requireLogin,
  setupLogoutButton,
  showAlert
} from "./firebase-app.js";

const list = document.querySelector("#order-list");
const paymentButtons = document.querySelectorAll("[data-payment-filter]");
const typeButtons = document.querySelectorAll("[data-type-filter]");
const completionButtons = document.querySelectorAll("[data-completion-filter]");
const searchInput = document.querySelector("#order-search-user");
let paymentFilter = "Semua";
let typeFilter = "Semua";
let completionFilter = "Semua";
let searchKeyword = "";
let orderCache = {};
let countdownInterval = null;

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toLocalDateId(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function getCompletionStatus(order) {
  const paymentLunas = normalizePaymentStatus(order.paymentStatus) === "Lunas";
  if (!paymentLunas) {
    return "Belum Selesai";
  }

  if (order.type === "produk") {
    return order.shippingStatus === "Sampai" && order.buyerReceivedConfirmed
      ? "Selesai"
      : "Belum Selesai";
  }

  if (order.type === "jasa") {
    return order.serviceStatus === "Selesai" && order.serviceDoneConfirmed
      ? "Selesai"
      : "Belum Selesai";
  }

  if (order.type === "sewa") {
    return order.rentalStatus === "Dikembalikan" && order.rentalReturnedConfirmed
      ? "Selesai"
      : "Belum Selesai";
  }

  return "Belum Selesai";
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

function getServiceDurationInfo(order) {
  const qty = Math.max(1, Number(order.serviceQty || 1));
  const perServiceDays = Math.max(1, Number(order.serviceEstimatedDays || 1));
  const totalDays = Math.max(1, Number(order.serviceDurationDaysTotal || (qty * perServiceDays)));
  const startDate = order.serviceStartDate || "-";
  let endDate = order.serviceEstimatedEndDate || "-";

  // Hitung ulang dari tanggal mulai + total hari supaya konsisten (menghindari data lama yang sempat geser timezone).
  if (order.serviceStartDate) {
    const date = new Date(`${order.serviceStartDate}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      date.setDate(date.getDate() + totalDays);
      endDate = toLocalDateId(date);
    }
  }

  return {
    qty,
    perServiceDays,
    totalDays,
    startDate,
    endDate
  };
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
    const serviceInfo = getServiceDurationInfo(order);
    return `
      <small>Jumlah paket jasa: ${serviceInfo.qty}</small>
      <small>Estimasi per jasa: ${serviceInfo.perServiceDays} hari</small>
      <small>Estimasi total pengerjaan: ${serviceInfo.totalDays} hari</small>
      <small>Mulai order: ${serviceInfo.startDate}</small>
      <small>Estimasi selesai: ${serviceInfo.endDate}</small>
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

function renderUserWorkflowSection(order, orderId) {
  return `
    <div class="order-workflow">
      <label class="form-label mb-1 order-section-title">Progress Order</label>
      <div class="order-workflow__details">
        ${renderOrderProgress(order, orderId)}
      </div>
    </div>
  `;
}

function getFilteredEntries() {
  const entries = orderCache
    ? Object.entries(orderCache).filter(([, order]) => order.userId === auth.currentUser.uid)
    : [];
  const sortedEntries = entries.sort((a, b) => {
    const aTime = parseTimestamp(a[1]?.createdAt) || parseTimestamp(a[1]?.createdAtClient) || 0;
    const bTime = parseTimestamp(b[1]?.createdAt) || parseTimestamp(b[1]?.createdAtClient) || 0;
    return bTime - aTime;
  });

  return sortedEntries.filter(([, order]) => {
    const matchPayment = paymentFilter === "Semua"
      || normalizePaymentStatus(order.paymentStatus) === paymentFilter;
    const matchType = typeFilter === "Semua" || order.type === typeFilter;
    const completionStatus = getCompletionStatus(order);
    const matchCompletion = completionFilter === "Semua" || completionStatus === completionFilter;
    const keyword = searchKeyword.trim().toLowerCase();
    const searchText = [
      order.itemName,
      order.type,
      order.paymentMethod,
      normalizePaymentStatus(order.paymentStatus),
      completionStatus
    ].join(" ").toLowerCase();
    const matchSearch = !keyword || searchText.includes(keyword);
    return matchPayment && matchType && matchCompletion && matchSearch;
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
      <article class="data-card order-card">
        <div class="order-card__main">
          <div class="order-card__summary">
            <div class="order-card__summary-left">
              <div class="d-flex gap-2 flex-wrap">
                <span class="badge text-bg-dark text-capitalize">${order.type}</span>
                <span class="badge ${getPaymentBadgeClass(normalizePaymentStatus(order.paymentStatus))}">${normalizePaymentStatus(order.paymentStatus)}</span>
                <span class="badge ${getCompletionStatus(order) === "Selesai" ? "text-bg-success" : "text-bg-secondary"}">${getCompletionStatus(order)}</span>
              </div>
              <h3 class="order-card__title">${order.itemName}</h3>
              <p class="order-card__email">${order.paymentMethod || "-"} | ${formatDateTime(order.createdAt || order.createdAtClient)}</p>
            </div>
            <div class="order-card__summary-right">
              <small class="order-summary-total">Total: Rp${Number(order.totalPayment || order.itemPrice || 0).toLocaleString("id-ID")}</small>
              <button class="btn btn-sm btn-outline-success" data-toggle-detail="${id}">Lihat Detail</button>
            </div>
          </div>
          <div class="order-card__detail d-none" id="order-detail-${id}">
            <div class="order-card__meta">
              <div><span class="order-meta__label">Buyer</span><span class="order-meta__value">${order.buyerName || "-"}</span></div>
              <div><span class="order-meta__label">WhatsApp</span><span class="order-meta__value">${order.buyerWhatsapp || "-"}</span></div>
              <div><span class="order-meta__label">Metode Bayar</span><span class="order-meta__value">${order.paymentMethod || "-"}</span></div>
              <div><span class="order-meta__label">Status Bayar</span><span class="order-meta__value">${normalizePaymentStatus(order.paymentStatus)}</span></div>
              <div><span class="order-meta__label">Status Order</span><span class="order-meta__value">${getCompletionStatus(order)}</span></div>
              <div><span class="order-meta__label">Order Dibuat</span><span class="order-meta__value">${formatDateTime(order.createdAt || order.createdAtClient)}</span></div>
              <div><span class="order-meta__label">Terakhir Update</span><span class="order-meta__value">${formatDateTime(order.workflowUpdatedAt || order.paymentUpdatedAt || order.adminUpdatedAt)}</span></div>
            </div>
            <div class="order-card__actions-row">
              ${order.proofLink ? `<a class="btn btn-sm btn-outline-secondary" href="${order.proofLink}" target="_blank" rel="noreferrer">Lihat Bukti Bayar</a>` : ""}
              ${order.adminWhatsappUrl ? `<a class="btn btn-sm btn-success" href="${order.adminWhatsappUrl}" target="_blank" rel="noreferrer">Chat Admin</a>` : ""}
            </div>
            ${renderUserWorkflowSection(order, id)}
            <div class="order-note-box">
              <label class="form-label mb-1 order-section-title">Catatan admin</label>
              <p class="mb-1">${order.adminNote || "-"}</p>
              ${order.adminAttachmentLink ? `<a href="${order.adminAttachmentLink}" target="_blank" rel="noreferrer">Lihat Link dari Admin</a>` : ""}
            </div>
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

  list.querySelectorAll("[data-toggle-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.toggleDetail;
      const detailBox = document.querySelector(`#order-detail-${id}`);
      if (!detailBox) {
        return;
      }
      detailBox.classList.toggle("d-none");
      button.textContent = detailBox.classList.contains("d-none") ? "Lihat Detail" : "Tutup Detail";
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

  completionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      completionFilter = button.dataset.completionFilter;
      completionButtons.forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderOrders(orderCache);
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchKeyword = searchInput.value || "";
      renderOrders(orderCache);
    });
  }
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
