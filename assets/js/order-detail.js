import {
  ref,
  get,
  push,
  set,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  auth,
  database,
  formatCurrency,
  requireLogin,
  setupLogoutButton,
  showAlert
} from "./firebase-app.js";
import { whatsappNumber, paymentConfig } from "./firebase-config.js";

const pageTitle = document.querySelector("#order-title");
const itemSummary = document.querySelector("#item-summary");
const orderForm = document.querySelector("#order-form");
const extraFields = document.querySelector("#extra-fields");
const buyerNameInput = document.querySelector("#buyer-name");
const buyerWhatsappInput = document.querySelector("#buyer-whatsapp");
const chatAdminLink = document.querySelector("#chat-admin");
const paymentMethodSelect = document.querySelector("#payment-method");
const paymentInfo = document.querySelector("#payment-info");
const paymentTotal = document.querySelector("#payment-total");

const collectionMap = {
  produk: {
    label: "Produk",
    collection: "products",
    priceKey: "price"
  },
  jasa: {
    label: "Jasa",
    collection: "services",
    priceKey: "price"
  },
  sewa: {
    label: "Sewa",
    collection: "rentals",
    priceKey: "pricePerDay"
  }
};

const query = new URLSearchParams(window.location.search);
const type = query.get("type");
const itemId = query.get("id");
const config = collectionMap[type];
let currentItem = null;

function toDateId(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateId, days) {
  const date = new Date(`${dateId}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateId(date);
}

function normalizeWhatsapp(value) {
  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  if (digits.startsWith("0")) {
    return `62${digits.slice(1)}`;
  }
  return digits;
}

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function parseStock(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.max(0, Math.floor(parsed));
  }
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function unitPrice() {
  if (!currentItem || !config) {
    return 0;
  }
  return Number(currentItem[config.priceKey] || 0);
}

function buildWhatsAppAdminLink(itemName, buyerName) {
  const message = encodeURIComponent(
    `Halo Admin MarketFlow, saya ${buyerName}. Saya ingin konfirmasi pesanan ${itemName}.`
  );
  return `https://wa.me/${whatsappNumber}?text=${message}`;
}

function buildWhatsAppBuyerLink(phone, itemName) {
  const message = encodeURIComponent(
    `Halo, kami dari MarketFlow terkait pesanan ${itemName}.`
  );
  return `https://wa.me/${phone}?text=${message}`;
}

function renderExtraFields() {
  const today = toDateId(new Date());

  if (type === "produk") {
    extraFields.innerHTML = `
      <div class="col-md-6">
        <label class="form-label" for="product-qty">Jumlah produk</label>
        <input class="form-control" id="product-qty" type="number" min="1" value="1" required />
      </div>
    `;
    return;
  }

  if (type === "jasa") {
    const estimatedDays = Number(currentItem?.estimatedDays || 1);
    extraFields.innerHTML = `
      <div class="col-md-6">
        <label class="form-label" for="service-qty">Jumlah paket jasa</label>
        <input class="form-control" id="service-qty" type="number" min="1" value="1" required />
      </div>
      <div class="col-md-6">
        <label class="form-label">Estimasi hari per jasa</label>
        <input class="form-control" type="text" value="${estimatedDays} hari" disabled />
      </div>
      <div class="col-12">
        <small class="text-muted" id="service-duration-summary">Estimasi total pengerjaan: ${estimatedDays} hari.</small>
      </div>
      <div class="col-12">
        <label class="form-label" for="service-brief">Brief singkat (opsional)</label>
        <textarea class="form-control" id="service-brief" rows="2"></textarea>
      </div>
    `;
    return;
  }

  if (type === "sewa") {
    extraFields.innerHTML = `
      <div class="col-md-6">
        <label class="form-label" for="rental-start">Tanggal mulai pinjam</label>
        <input class="form-control" id="rental-start" type="date" min="${today}" required />
      </div>
      <div class="col-md-6">
        <label class="form-label" for="rental-duration">Durasi pinjam (hari)</label>
        <input class="form-control" id="rental-duration" type="number" min="1" value="1" required />
      </div>
    `;
    return;
  }

  extraFields.innerHTML = "";
}

function getMultiplier() {
  if (type === "produk") {
    return parsePositiveInt(document.querySelector("#product-qty")?.value, 1);
  }
  if (type === "jasa") {
    return parsePositiveInt(document.querySelector("#service-qty")?.value, 1);
  }
  return parsePositiveInt(document.querySelector("#rental-duration")?.value, 1);
}

function getServiceEstimateInfo() {
  const qty = parsePositiveInt(document.querySelector("#service-qty")?.value, 1);
  const perServiceDays = Math.max(1, Number(currentItem?.estimatedDays || 1));
  const totalDays = qty * perServiceDays;
  return { qty, perServiceDays, totalDays };
}

function renderServiceDurationSummary() {
  if (type !== "jasa") {
    return;
  }
  const summary = document.querySelector("#service-duration-summary");
  if (!summary) {
    return;
  }
  const info = getServiceEstimateInfo();
  summary.textContent = `Estimasi total pengerjaan: ${info.totalDays} hari (${info.qty} paket x ${info.perServiceDays} hari).`;
}

function getTotalPayment() {
  return unitPrice() * getMultiplier();
}

function renderTotalPayment() {
  const multiplier = getMultiplier();
  const total = getTotalPayment();

  let text = "";
  if (type === "produk") {
    text = `${formatCurrency(unitPrice())} x ${multiplier} produk`;
  } else if (type === "jasa") {
    const info = getServiceEstimateInfo();
    text = `${formatCurrency(unitPrice())} x ${multiplier} paket jasa (estimasi ${info.totalDays} hari)`;
  } else {
    text = `${formatCurrency(unitPrice())} x ${multiplier} hari sewa`;
  }

  paymentTotal.innerHTML = `
    <h3 class="h6 fw-bold mb-2">Total Pembayaran</h3>
    <p class="mb-1">${text}</p>
    <p class="mb-0 fw-bold">${formatCurrency(total)}</p>
  `;

  renderServiceDurationSummary();
}

function renderPaymentInfo() {
  const method = paymentMethodSelect.value;

  if (method === "Transfer Manual") {
    paymentInfo.innerHTML = `
      <h3 class="h6 fw-bold mb-2">Instruksi Transfer Manual</h3>
      <p class="mb-1">Bank: ${paymentConfig.transferManual.bankName}</p>
      <p class="mb-1">Nomor Rekening: ${paymentConfig.transferManual.accountNumber}</p>
      <p class="mb-0">Atas Nama: ${paymentConfig.transferManual.accountHolder}</p>
    `;
    return;
  }

  paymentInfo.innerHTML = `
    <h3 class="h6 fw-bold mb-2">Instruksi QRIS</h3>
    <div class="mb-2">
      <img src="${paymentConfig.qris.imageUrl}" alt="QRIS MarketFlow" class="img-fluid rounded border" style="max-width: 280px;">
    </div>
    <p class="mb-0">${paymentConfig.qris.note}</p>
  `;
}

function updateChatAdminLink() {
  const buyerName = buyerNameInput.value.trim() || "User";
  chatAdminLink.href = buildWhatsAppAdminLink(currentItem?.name || "pesanan", buyerName);
}

function setupRealtimeSummary() {
  orderForm.addEventListener("input", (event) => {
    if (
      event.target.id === "product-qty"
      || event.target.id === "service-qty"
      || event.target.id === "rental-duration"
    ) {
      renderTotalPayment();
    }
  });
}

async function loadItem() {
  if (!config || !itemId) {
    showAlert("Link order tidak valid.", "danger");
    orderForm.classList.add("d-none");
    return;
  }

  const snapshot = await get(ref(database, `${config.collection}/${itemId}`));
  const item = snapshot.val();

  if (!item) {
    showAlert("Item tidak ditemukan.", "danger");
    orderForm.classList.add("d-none");
    return;
  }
  if (item.isActive === false) {
    showAlert("Item ini sedang disembunyikan admin.", "danger");
    orderForm.classList.add("d-none");
    return;
  }

  currentItem = item;
  pageTitle.textContent = `Pesan ${config.label}`;
  itemSummary.innerHTML = `
    <h2 class="h4 fw-bold mb-1">${item.name}</h2>
    <p class="text-muted mb-1">${item.description || "Deskripsi belum tersedia."}</p>
    <p class="mb-0"><strong>Harga dasar: ${formatCurrency(item[config.priceKey])}${type === "sewa" ? " / hari" : ""}</strong></p>
    ${type === "produk" ? `<p class="mb-0"><small>Stok tersedia: ${parseStock(item.stock)}</small></p>` : ""}
  `;

  renderExtraFields();
  if (type === "produk") {
    const qtyInput = document.querySelector("#product-qty");
    const stock = parseStock(item.stock);
    if (qtyInput && stock > 0) {
      qtyInput.max = String(stock);
    }
  }
  updateChatAdminLink();
  renderTotalPayment();
}

function buildPayload() {
  const buyerName = buyerNameInput.value.trim();
  const buyerWhatsapp = normalizeWhatsapp(buyerWhatsappInput.value.trim());
  const paymentMethod = paymentMethodSelect.value;
  const proofLink = document.querySelector("#proof-link").value.trim();
  const qty = getMultiplier();
  const totalPayment = getTotalPayment();

  if (!buyerName) {
    throw new Error("Nama buyer wajib diisi.");
  }
  if (buyerWhatsapp.length < 10) {
    throw new Error("Nomor WhatsApp buyer tidak valid.");
  }

  const payload = {
    userId: auth.currentUser.uid,
    userEmail: auth.currentUser.email,
    type,
    itemId,
    itemName: currentItem.name,
    itemPrice: unitPrice(),
    totalPayment,
    buyerName,
    buyerWhatsapp,
    buyerWhatsappUrl: buildWhatsAppBuyerLink(buyerWhatsapp, currentItem.name),
    adminWhatsappUrl: buildWhatsAppAdminLink(currentItem.name, buyerName),
    paymentMethod,
    paymentStatus: proofLink ? "Menunggu Verifikasi" : "Belum Terverifikasi",
    proofLink,
    adminNote: "",
    adminAttachmentLink: "",
    createdAtClient: Date.now(),
    createdAt: serverTimestamp()
  };

  if (type === "produk") {
    const stock = parseStock(currentItem.stock);
    if (stock <= 0) {
      throw new Error("Stok produk sedang habis.");
    }
    payload.productQty = qty;
    payload.shippingStatus = "Diproses";
    payload.buyerReceivedConfirmed = false;
  }

  if (type === "jasa") {
    const createdDate = toDateId(new Date());
    const estimatedDays = Number(currentItem.estimatedDays || 1);
    const totalServiceDays = Math.max(1, estimatedDays * qty);
    payload.serviceQty = qty;
    payload.serviceEstimatedDays = estimatedDays;
    payload.serviceDurationDaysTotal = totalServiceDays;
    payload.serviceStartDate = createdDate;
    payload.serviceEstimatedEndDate = addDays(createdDate, totalServiceDays);
    payload.serviceBrief = document.querySelector("#service-brief")?.value.trim() || "";
    payload.serviceStatus = "Menunggu Pengerjaan";
    payload.serviceDoneConfirmed = false;
  }

  if (type === "sewa") {
    const rentalStartDate = document.querySelector("#rental-start")?.value;
    const rentalDurationDays = qty;

    if (!rentalStartDate) {
      throw new Error("Tanggal mulai pinjam wajib diisi.");
    }

    const startDate = new Date(`${rentalStartDate}T00:00:00`);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + rentalDurationDays - 1);

    payload.actualRentalStartDate = "";
    payload.rentalStartDate = rentalStartDate;
    payload.rentalDurationDays = rentalDurationDays;
    payload.rentalEndDate = toDateId(endDate);
    payload.rentalStatus = "Menunggu Pengambilan";
    payload.rentalReceivedConfirmed = false;
    payload.rentalReturnedConfirmed = false;
  }

  return payload;
}

async function createOrder(event) {
  event.preventDefault();

  let reservedQty = 0;
  let stockRef = null;
  let previousStock = null;

  try {
    const payload = buildPayload();
    if (type === "produk") {
      reservedQty = Number(payload.productQty || 0);
      stockRef = ref(database, `products/${itemId}/stock`);
      const latestStockSnapshot = await get(stockRef);
      const latestStock = parseStock(latestStockSnapshot.val());

      if (latestStock < reservedQty) {
        throw new Error(`Stok tidak cukup. Stok tersedia saat ini: ${latestStock}.`);
      }

      previousStock = latestStock;
      const nextStock = latestStock - reservedQty;
      await set(stockRef, nextStock);
      currentItem.stock = nextStock;
    }

    const orderRef = push(ref(database, "orders"));
    try {
      await set(orderRef, payload);
    } catch (error) {
      if (type === "produk" && reservedQty > 0 && stockRef && previousStock !== null) {
        await set(stockRef, previousStock);
      }
      throw error;
    }
    showAlert("Order berhasil dibuat. Silakan lanjut konfirmasi ke admin.", "success");
    orderForm.reset();
    buyerNameInput.value = "";
    renderPaymentInfo();
    renderTotalPayment();
    updateChatAdminLink();
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

requireLogin(async () => {
  setupLogoutButton();
  buyerNameInput.value = "";
  buyerNameInput.addEventListener("input", updateChatAdminLink);
  paymentMethodSelect.addEventListener("change", renderPaymentInfo);
  setupRealtimeSummary();
  await loadItem();
  renderPaymentInfo();
  orderForm.addEventListener("submit", createOrder);
});
