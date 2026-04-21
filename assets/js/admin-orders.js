import {
  ref,
  onValue,
  update,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  database,
  requireAdmin,
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
  return date.toISOString().slice(0, 10);
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

function getFilteredEntries() {
  const entries = orderCache ? Object.entries(orderCache).reverse() : [];

  return entries.filter(([, order]) => {
    const matchPayment = paymentFilter === "Semua"
      || normalizePaymentStatus(order.paymentStatus) === paymentFilter;
    const matchType = typeFilter === "Semua" || order.type === typeFilter;
    return matchPayment && matchType;
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
    details = `
      <small>Deadline: ${order.serviceDeadline || "-"}</small>
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
    <div class="mt-2 d-flex flex-column gap-1">
      <label class="form-label mb-0">${config.label}</label>
      <select class="form-select form-select-sm" data-workflow-status="${orderId}" data-order-type="${order.type}">
        ${options}
      </select>
      ${details}
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
      <article class="data-card">
        <div>
          <div class="d-flex gap-2 mb-2 flex-wrap">
            <span class="badge text-bg-dark text-capitalize">${order.type}</span>
            <span class="badge ${getPaymentBadgeClass(normalizePaymentStatus(order.paymentStatus))}">${normalizePaymentStatus(order.paymentStatus)}</span>
          </div>
          <h3>${order.itemName}</h3>
          <p class="mb-1">${order.userEmail || "Email user belum tersedia"}</p>
          <small>Buyer: ${order.buyerName || "-"} | WA: ${order.buyerWhatsapp || "-"}</small>
          <small>Metode bayar: ${order.paymentMethod || "-"}</small>
          <small>Harga: Rp${Number(order.itemPrice || 0).toLocaleString("id-ID")}</small>
          <div class="mt-2 d-flex gap-2 flex-wrap">
            ${order.proofLink ? `<a class="btn btn-sm btn-outline-secondary" href="${order.proofLink}" target="_blank" rel="noreferrer">Link Bukti Bayar</a>` : ""}
            ${order.buyerWhatsappUrl ? `<a class="btn btn-sm btn-success" href="${order.buyerWhatsappUrl}" target="_blank" rel="noreferrer">Chat Buyer</a>` : ""}
          </div>
          ${renderWorkflowSection(id, order)}
          <div class="mt-3 d-flex flex-column gap-2">
            <label class="form-label mb-0" for="admin-note-${id}">Catatan admin ke user</label>
            <textarea class="form-control" id="admin-note-${id}" rows="2" placeholder="Contoh: pembayaran valid, pesanan diproses.">${order.adminNote || ""}</textarea>
            <label class="form-label mb-0" for="admin-link-${id}">Link admin ke user (opsional)</label>
            <input class="form-control" id="admin-link-${id}" type="url" value="${order.adminAttachmentLink || ""}" placeholder="https://drive.google.com/..." />
            <button class="btn btn-outline-success btn-sm align-self-start" data-save-admin-note="${id}">Simpan Catatan Admin</button>
          </div>
        </div>
        <div class="data-card__actions">
          <select class="form-select form-select-sm" data-order-status="${id}">
            ${paymentStatusList
              .map((status) => `<option value="${status}" ${normalizePaymentStatus(order.paymentStatus) === status ? "selected" : ""}>${status}</option>`)
              .join("")}
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

requireAdmin(() => {
  setupLogoutButton();
  setupFilters();
  setupCountdownRefresh();
  onValue(ref(database, "orders"), (snapshot) => {
    renderOrders(snapshot.val());
  });
});
