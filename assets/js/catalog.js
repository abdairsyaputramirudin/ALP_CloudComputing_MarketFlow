import {
  ref,
  push,
  set,
  onValue,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  auth,
  database,
  storage,
  formatCurrency,
  requireLogin,
  setupLogoutButton,
  showAlert
} from "./firebase-app.js";
import { whatsappNumber } from "./firebase-config.js";

const catalogType = document.body.dataset.catalogType;
const collectionMap = {
  produk: {
    collection: "products",
    priceKey: "price",
    emptyText: "Belum ada produk."
  },
  jasa: {
    collection: "services",
    priceKey: "price",
    emptyText: "Belum ada jasa."
  },
  sewa: {
    collection: "rentals",
    priceKey: "pricePerDay",
    emptyText: "Belum ada barang sewa."
  }
};

const config = collectionMap[catalogType];
const list = document.querySelector("#catalog-list");

function buildWhatsAppLink(itemName) {
  // Link chat admin dengan pesan otomatis.
  const message = encodeURIComponent(
    `Halo Admin MarketFlow, saya ingin konfirmasi pembayaran untuk pesanan ${itemName}.`
  );
  return `https://wa.me/${whatsappNumber}?text=${message}`;
}

async function uploadProof(file, userId) {
  if (!file) {
    return "";
  }

  const safeName = file.name.replaceAll(" ", "-");
  const path = `payment-proofs/${userId}/${Date.now()}-${safeName}`;
  const target = storageRef(storage, path);
  await uploadBytes(target, file);
  return getDownloadURL(target);
}

async function createOrder(itemId, item) {
  const user = auth.currentUser;
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const method = document.querySelector(`#payment-${itemId}`).value;
  const proofFile = document.querySelector(`#proof-${itemId}`).files[0];
  const proofLink = document.querySelector(`#proof-link-${itemId}`).value.trim();

  try {
    let proofUrl = "";
    if (proofFile) {
      try {
        proofUrl = await uploadProof(proofFile, user.uid);
      } catch (uploadError) {
        showAlert("Upload ke Firebase Storage gagal. Lanjut pakai link bukti bayar manual.", "warning");
      }
    }
    const orderRef = push(ref(database, "orders"));

    // Simpan order user ke Realtime DB.
    await set(orderRef, {
      userId: user.uid,
      userEmail: user.email,
      type: catalogType,
      itemId,
      itemName: item.name,
      paymentMethod: method,
      paymentStatus: proofUrl || proofLink ? "Menunggu Verifikasi" : "Belum Dibayar",
      proofUrl,
      proofLink,
      whatsappUrl: buildWhatsAppLink(item.name),
      createdAt: serverTimestamp()
    });

    showAlert(`Pesanan ${item.name} berhasil dibuat. Silakan konfirmasi via WhatsApp.`, "success");
  } catch (error) {
    showAlert(error.message, "danger");
  }
}

function renderCatalog(data) {
  const entries = data ? Object.entries(data) : [];

  if (!entries.length) {
    list.innerHTML = `<div class="empty-card">${config.emptyText}</div>`;
    return;
  }

  list.innerHTML = entries
    .map(([id, item]) => `
      <div class="col-md-6 col-xl-4">
        <article class="market-card">
          <div class="market-card__icon">${item.category?.slice(0, 1) || "M"}</div>
          <h3>${item.name}</h3>
          <p>${item.description || "Deskripsi belum tersedia."}</p>
          <strong>${formatCurrency(item[config.priceKey])}${catalogType === "sewa" ? " / hari" : ""}</strong>
          <div class="order-box">
            <label class="form-label" for="payment-${id}">Metode pembayaran</label>
            <select class="form-select" id="payment-${id}">
              <option value="Transfer Manual">Transfer Manual</option>
              <option value="QRIS Manual">QRIS Manual</option>
              <option value="COD">COD</option>
            </select>
            <label class="form-label mt-2" for="proof-${id}">Upload bukti bayar</label>
            <input class="form-control" id="proof-${id}" type="file" accept="image/png,image/jpeg,image/jpg" />
            <label class="form-label mt-2" for="proof-link-${id}">Link bukti bayar (opsional)</label>
            <input class="form-control" id="proof-link-${id}" type="url" placeholder="https://drive.google.com/..." />
            <div class="d-grid gap-2 mt-3">
              <button class="btn btn-success" data-order-id="${id}">Buat Pesanan</button>
              <a class="btn btn-outline-success" href="${buildWhatsAppLink(item.name)}" target="_blank" rel="noreferrer">
                Konfirmasi via WhatsApp
              </a>
            </div>
          </div>
        </article>
      </div>
    `)
    .join("");

  list.querySelectorAll("[data-order-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.orderId;
      createOrder(itemId, data[itemId]);
    });
  });
}

if (config) {
  requireLogin(() => {
    setupLogoutButton();
    // Read katalog realtime sesuai halaman (produk/jasa/sewa).
    onValue(ref(database, config.collection), (snapshot) => {
      renderCatalog(snapshot.val());
    });
  });
}
