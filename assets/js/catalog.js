import {
  ref,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  database,
  formatCurrency,
  requireLogin,
  setupLogoutButton
} from "./firebase-app.js";

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
let catalogCache = {};
let orderCache = {};

function getBusyRentalItemIds() {
  const entries = orderCache ? Object.values(orderCache) : [];
  const busyIds = entries
    .filter((order) => order.type === "sewa" && order.rentalStatus === "Dipinjam")
    .map((order) => String(order.itemId || ""));
  return new Set(busyIds);
}

function buildOrderLink(itemId) {
  return `order-detail.html?type=${encodeURIComponent(catalogType)}&id=${encodeURIComponent(itemId)}`;
}

function getVisibleEntries() {
  let entries = catalogCache ? Object.entries(catalogCache) : [];

  if (catalogType === "sewa") {
    const busyIds = getBusyRentalItemIds();
    entries = entries.filter(([id]) => !busyIds.has(String(id)));
  }

  return entries;
}

function renderCatalog() {
  const entries = getVisibleEntries();

  if (!entries.length) {
    if (catalogType === "sewa" && catalogCache && Object.keys(catalogCache).length > 0) {
      list.innerHTML = `<div class="empty-card">Semua barang sewa sedang dipinjam. Cek lagi nanti.</div>`;
      return;
    }
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
          <div class="d-grid mt-3">
            <a class="btn btn-success" href="${buildOrderLink(id)}">Pesan Item Ini</a>
          </div>
        </article>
      </div>
    `)
    .join("");
}

if (config) {
  requireLogin(() => {
    setupLogoutButton();
    onValue(ref(database, config.collection), (snapshot) => {
      catalogCache = snapshot.val() || {};
      renderCatalog();
    });

    if (catalogType === "sewa") {
      onValue(ref(database, "orders"), (snapshot) => {
        orderCache = snapshot.val() || {};
        renderCatalog();
      });
    }
  });
}
