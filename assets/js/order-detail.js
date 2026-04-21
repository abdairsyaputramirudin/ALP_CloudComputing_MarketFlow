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
import { whatsappNumber } from "./firebase-config.js";

const pageTitle = document.querySelector("#order-title");
const itemSummary = document.querySelector("#item-summary");
const orderForm = document.querySelector("#order-form");
const extraFields = document.querySelector("#extra-fields");
const buyerNameInput = document.querySelector("#buyer-name");
const buyerWhatsappInput = document.querySelector("#buyer-whatsapp");
const chatAdminLink = document.querySelector("#chat-admin");

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
  return date.toISOString().slice(0, 10);
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

  if (type === "jasa") {
    extraFields.innerHTML = `
      <div class="col-md-6">
        <label class="form-label" for="service-deadline">Deadline jasa</label>
        <input class="form-control" id="service-deadline" type="date" min="${today}" required />
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

function updateChatAdminLink() {
  const buyerName = buyerNameInput.value.trim() || auth.currentUser?.displayName || "User";
  chatAdminLink.href = buildWhatsAppAdminLink(currentItem?.name || "pesanan", buyerName);
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

  currentItem = item;
  pageTitle.textContent = `Pesan ${config.label}`;
  itemSummary.innerHTML = `
    <h2 class="h4 fw-bold mb-1">${item.name}</h2>
    <p class="text-muted mb-1">${item.description || "Deskripsi belum tersedia."}</p>
    <p class="mb-0"><strong>${formatCurrency(item[config.priceKey])}${type === "sewa" ? " / hari" : ""}</strong></p>
  `;

  renderExtraFields();
  updateChatAdminLink();
}

function buildPayload() {
  const buyerName = buyerNameInput.value.trim();
  const buyerWhatsapp = normalizeWhatsapp(buyerWhatsappInput.value.trim());
  const paymentMethod = document.querySelector("#payment-method").value;
  const proofLink = document.querySelector("#proof-link").value.trim();

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
    itemPrice: Number(currentItem[config.priceKey] || 0),
    buyerName,
    buyerWhatsapp,
    buyerWhatsappUrl: buildWhatsAppBuyerLink(buyerWhatsapp, currentItem.name),
    adminWhatsappUrl: buildWhatsAppAdminLink(currentItem.name, buyerName),
    paymentMethod,
    paymentStatus: proofLink ? "Menunggu Verifikasi" : "Belum Terverifikasi",
    proofLink,
    adminNote: "",
    adminAttachmentLink: "",
    createdAt: serverTimestamp()
  };

  if (type === "produk") {
    payload.shippingStatus = "Diproses";
    payload.buyerReceivedConfirmed = false;
  }

  if (type === "jasa") {
    const serviceDeadline = document.querySelector("#service-deadline")?.value;
    if (!serviceDeadline) {
      throw new Error("Deadline jasa wajib diisi.");
    }
    payload.serviceDeadline = serviceDeadline;
    payload.serviceBrief = document.querySelector("#service-brief")?.value.trim() || "";
    payload.serviceStatus = "Menunggu Pengerjaan";
    payload.serviceDoneConfirmed = false;
  }

  if (type === "sewa") {
    const rentalStartDate = document.querySelector("#rental-start")?.value;
    const rentalDurationDays = Number(document.querySelector("#rental-duration")?.value || 0);

    if (!rentalStartDate) {
      throw new Error("Tanggal mulai pinjam wajib diisi.");
    }
    if (!Number.isInteger(rentalDurationDays) || rentalDurationDays < 1) {
      throw new Error("Durasi pinjam minimal 1 hari.");
    }

    const startDate = new Date(`${rentalStartDate}T00:00:00`);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + rentalDurationDays - 1);

    payload.rentalStartDate = rentalStartDate;
    payload.actualRentalStartDate = "";
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

  try {
    const payload = buildPayload();
    const orderRef = push(ref(database, "orders"));
    await set(orderRef, payload);
    showAlert("Order berhasil dibuat. Silakan lanjut konfirmasi ke admin.", "success");
    orderForm.reset();
    buyerNameInput.value = auth.currentUser?.displayName || "";
    updateChatAdminLink();
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

requireLogin(async () => {
  setupLogoutButton();
  buyerNameInput.value = auth.currentUser?.displayName || "";
  buyerNameInput.addEventListener("input", updateChatAdminLink);
  await loadItem();
  orderForm.addEventListener("submit", createOrder);
});
