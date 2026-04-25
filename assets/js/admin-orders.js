import {
  ref,
  onValue,
  get,
  set,
  remove,
  update,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  database,
  formatDateTime,
  parseTimestamp,
  requireAdmin,
  setupLogoutButton,
  showAlert
} from "./firebase-app.js";

const list = document.querySelector("#order-list");
const paymentButtons = document.querySelectorAll("[data-payment-filter]");
const typeButtons = document.querySelectorAll("[data-type-filter]");
const completionButtons = document.querySelectorAll("[data-completion-filter]");
const searchInput = document.querySelector("#order-search");
let paymentFilter = "Semua";
let typeFilter = "Semua";
let completionFilter = "Semua";
let searchKeyword = "";
let orderCache = {};
let countdownInterval = null;

const paymentStatusList = ["Belum Terverifikasi", "Menunggu Verifikasi", "Lunas"];
const workflowConfig = {
  produk: {
    label: "Status Pengiriman",
    key: "shippingStatus",
    options: ["Diproses", "Dikirim", "Sampai"]
  },
  jasa: {
    label: "Status Pengerjaan Jasa",
    key: "serviceStatus",
    options: ["Menunggu Pengerjaan", "Dalam Pengerjaan", "Revisi", "Selesai"]
  },
  sewa: {
    label: "Status Sewa",
    key: "rentalStatus",
    options: ["Menunggu Pengambilan", "Dipinjam", "Dikembalikan"]
  }
};

function toDateId(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseStock(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.floor(parsed));
  }
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function addDays(dateId, days) {
  const date = new Date(`${dateId}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateId(date);
}

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

function isAfterToday(dateId) {
  const target = parseDate(dateId);
  if (!target) {
    return false;
  }
  return target.getTime() > startOfToday().getTime();
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
      endDate = toDateId(date);
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

async function updatePaymentStatus(orderId, status) {
  try {
    await update(ref(database, `orders/${orderId}`), {
      paymentStatus: status,
      paymentUpdatedAt: serverTimestamp()
    });
    showAlert("Status pembayaran berhasil diupdate.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function updateWorkflowStatus(orderId, orderType, status) {
  const config = workflowConfig[orderType];
  if (!config) {
    return;
  }

  const payload = {
    [config.key]: status,
    workflowUpdatedAt: serverTimestamp()
  };
  const currentOrder = orderCache[orderId] || {};

  // Khusus sewa: ketika admin set Dipinjam, waktu aktif dihitung dari status ini.
  if (orderType === "sewa") {
    const duration = Number(currentOrder.rentalDurationDays || 1);
    const todayId = toDateId(new Date());

    if (status === "Dipinjam" && currentOrder.rentalStartDate && currentOrder.rentalStartDate !== todayId) {
      const confirmed = window.confirm(
        `Jadwal pinjam seharusnya ${currentOrder.rentalStartDate}. Yakin ingin mulai peminjaman di tanggal ${todayId}?`
      );
      if (!confirmed) {
        renderOrders(orderCache);
        return;
      }
    }

    if (status === "Dikembalikan" && isAfterToday(currentOrder.rentalEndDate)) {
      const confirmed = window.confirm("Masa sewa belum habis. Yakin ingin menyelesaikan sewa lebih awal?");
      if (!confirmed) {
        renderOrders(orderCache);
        return;
      }
      payload.actualRentalEndDate = toDateId(new Date());
      payload.rentalEndDate = toDateId(new Date());
    }

    if (status === "Dipinjam") {
      const activeStart = toDateId(new Date());
      payload.actualRentalStartDate = activeStart;
      payload.rentalEndDate = addDays(activeStart, duration - 1);
    }

    if (status === "Menunggu Pengambilan") {
      payload.actualRentalStartDate = "";
      payload.actualRentalEndDate = "";
      if (currentOrder.rentalStartDate) {
        payload.rentalEndDate = addDays(currentOrder.rentalStartDate, duration - 1);
      }
    }
  }

  try {
    await update(ref(database, `orders/${orderId}`), payload);
    showAlert(`${config.label} berhasil diupdate.`, "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function updateAdminNotes(orderId) {
  const noteInput = document.querySelector(`#admin-note-${orderId}`);
  const linkInput = document.querySelector(`#admin-link-${orderId}`);

  try {
    await update(ref(database, `orders/${orderId}`), {
      adminNote: noteInput?.value.trim() || "",
      adminAttachmentLink: linkInput?.value.trim() || "",
      adminUpdatedAt: serverTimestamp()
    });
    showAlert("Catatan admin berhasil disimpan.", "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

async function cancelOrder(orderId) {
  const order = orderCache[orderId];
  if (!order) {
    showAlert("Order tidak ditemukan.", "warning");
    return;
  }

  const confirmed = window.confirm("Yakin ingin membatalkan dan menghapus order ini?");
  if (!confirmed) {
    return;
  }

  let stockRef = null;
  let previousStock = null;
  let stockRestored = false;

  try {
    if (order.type === "produk" && order.itemId) {
      const qty = Math.max(0, Number(order.productQty || 0));
      if (qty > 0) {
        stockRef = ref(database, `products/${order.itemId}/stock`);
        const stockSnapshot = await get(stockRef);
        previousStock = parseStock(stockSnapshot.val());
        await set(stockRef, previousStock + qty);
        stockRestored = true;
      }
    }

    await remove(ref(database, `orders/${orderId}`));
    showAlert(
      stockRestored
        ? "Order berhasil dibatalkan dan dihapus. Stok produk sudah dikembalikan."
        : "Order berhasil dibatalkan dan dihapus.",
      "success"
    );
  } catch (error) {
    if (stockRef && previousStock !== null) {
      await set(stockRef, previousStock);
    }
    showAlert(error.message, "danger");
  }
}

function getFilteredEntries() {
  const entries = orderCache ? Object.entries(orderCache) : [];
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
      order.userEmail,
      order.buyerName,
      order.buyerWhatsapp,
      completionStatus
    ].join(" ").toLowerCase();
    const matchSearch = !keyword || searchText.includes(keyword);
    return matchPayment && matchType && matchCompletion && matchSearch;
  });
}

function renderWorkflowSection(orderId, order) {
  const config = workflowConfig[order.type];
  if (!config) {
    return "";
  }

  const currentValue = order[config.key] || config.options[0];
  const options = config.options
    .map((item) => `<option value="${item}" ${item === currentValue ? "selected" : ""}>${item}</option>`)
    .join("");

  let details = "";
  if (order.type === "jasa") {
    const serviceInfo = getServiceDurationInfo(order);
    details = `
      <small>Jumlah paket jasa: ${serviceInfo.qty}</small>
      <small>Estimasi per jasa: ${serviceInfo.perServiceDays} hari</small>
      <small>Estimasi total pengerjaan: ${serviceInfo.totalDays} hari</small>
      <small>Mulai order: ${serviceInfo.startDate}</small>
      <small>Estimasi selesai: ${serviceInfo.endDate}</small>
      ${order.serviceBrief ? `<small>Brief: ${order.serviceBrief}</small>` : ""}
      <small>Konfirmasi user: ${order.serviceDoneConfirmed ? "Sudah" : "Belum"}</small>
    `;
  }
  if (order.type === "sewa") {
    details = `
      <small>Jadwal mulai: ${order.rentalStartDate || "-"}</small>
      <small>Mulai aktif: ${order.actualRentalStartDate || order.rentalStartDate || "-"}</small>
      <small>Batas kembali: ${order.rentalEndDate || "-"} (${getRentalTimeText(order)})</small>
      <small>Konfirmasi terima barang: ${order.rentalReceivedConfirmed ? "Sudah" : "Belum"}</small>
      <small>Konfirmasi pengembalian: ${order.rentalReturnedConfirmed ? "Sudah" : "Belum"}</small>
    `;
  }
  if (order.type === "produk") {
    details = `
      <small>Konfirmasi barang diterima user: ${order.buyerReceivedConfirmed ? "Sudah" : "Belum"}</small>
    `;
  }

  return `
    <div class="order-workflow">
      <label class="form-label mb-1 order-section-title">${config.label}</label>
      <select class="form-select form-select-sm" data-workflow-status="${orderId}" data-order-type="${order.type}">
        ${options}
      </select>
      <div class="order-workflow__details">${details}</div>
    </div>
  `;
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
              <p class="order-card__email">${order.buyerName || "-"} | ${order.buyerWhatsapp || "-"}</p>
            </div>
            <div class="order-card__summary-right">
              <small class="order-summary-time">Order Masuk: ${formatDateTime(order.createdAt || order.createdAtClient)}</small>
              <small class="order-summary-total">Total: Rp${Number(order.totalPayment || order.itemPrice || 0).toLocaleString("id-ID")}</small>
              <button class="btn btn-sm btn-outline-success" data-toggle-detail="${id}">Lihat Detail</button>
            </div>
          </div>
          <div class="order-card__detail d-none" id="order-detail-${id}">
            <div class="order-card__meta">
              <div><span class="order-meta__label">Email User</span><span class="order-meta__value">${order.userEmail || "-"}</span></div>
              <div><span class="order-meta__label">Buyer</span><span class="order-meta__value">${order.buyerName || "-"}</span></div>
              <div><span class="order-meta__label">WhatsApp</span><span class="order-meta__value">${order.buyerWhatsapp || "-"}</span></div>
              <div><span class="order-meta__label">Metode Bayar</span><span class="order-meta__value">${order.paymentMethod || "-"}</span></div>
              <div><span class="order-meta__label">Order Dibuat</span><span class="order-meta__value">${formatDateTime(order.createdAt || order.createdAtClient)}</span></div>
              <div><span class="order-meta__label">Terakhir Update</span><span class="order-meta__value">${formatDateTime(order.workflowUpdatedAt || order.paymentUpdatedAt || order.adminUpdatedAt)}</span></div>
              <div><span class="order-meta__label">Status Order</span><span class="order-meta__value">${getCompletionStatus(order)}</span></div>
            </div>
            <div class="order-card__actions-row">
              ${order.proofLink ? `<a class="btn btn-sm btn-outline-secondary" href="${order.proofLink}" target="_blank" rel="noreferrer">Link Bukti Bayar</a>` : ""}
              ${order.buyerWhatsappUrl ? `<a class="btn btn-sm btn-success" href="${order.buyerWhatsappUrl}" target="_blank" rel="noreferrer">Chat Buyer</a>` : ""}
              <button class="btn btn-sm btn-outline-danger" data-cancel-order="${id}">Batalkan & Hapus</button>
            </div>
            <div class="order-card__pay-status mt-2">
              <label class="form-label mb-1 order-section-title">Status Bayar</label>
              <select class="form-select form-select-sm" data-order-status="${id}">
                ${paymentStatusList
                  .map((status) => `<option value="${status}" ${normalizePaymentStatus(order.paymentStatus) === status ? "selected" : ""}>${status}</option>`)
                  .join("")}
              </select>
            </div>
            ${renderWorkflowSection(id, order)}
            <div class="order-note-box">
              <label class="form-label mb-1 order-section-title" for="admin-note-${id}">Catatan admin ke user</label>
              <textarea class="form-control" id="admin-note-${id}" rows="2" placeholder="Contoh: pembayaran valid, pesanan diproses.">${order.adminNote || ""}</textarea>
              <label class="form-label mb-1 order-section-title" for="admin-link-${id}">Link admin ke user (opsional)</label>
              <input class="form-control" id="admin-link-${id}" type="url" value="${order.adminAttachmentLink || ""}" placeholder="https://drive.google.com/..." />
              <button class="btn btn-outline-success btn-sm align-self-start" data-save-admin-note="${id}">Simpan Catatan Admin</button>
            </div>
          </div>
        </div>
      </article>
    `)
    .join("");

  list.querySelectorAll("[data-order-status]").forEach((select) => {
    select.addEventListener("change", () => {
      updatePaymentStatus(select.dataset.orderStatus, select.value);
    });
  });

  list.querySelectorAll("[data-workflow-status]").forEach((select) => {
    select.addEventListener("change", () => {
      updateWorkflowStatus(
        select.dataset.workflowStatus,
        select.dataset.orderType,
        select.value
      );
    });
  });

  list.querySelectorAll("[data-save-admin-note]").forEach((button) => {
    button.addEventListener("click", () => {
      updateAdminNotes(button.dataset.saveAdminNote);
    });
  });

  list.querySelectorAll("[data-cancel-order]").forEach((button) => {
    button.addEventListener("click", () => {
      cancelOrder(button.dataset.cancelOrder);
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

requireAdmin(() => {
  setupLogoutButton();
  setupFilters();
  setupCountdownRefresh();
  onValue(ref(database, "orders"), (snapshot) => {
    renderOrders(snapshot.val());
  });
});
