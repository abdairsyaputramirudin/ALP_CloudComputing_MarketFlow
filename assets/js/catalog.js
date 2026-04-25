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
const searchInput = document.querySelector("#catalog-search");
const categorySelect = document.querySelector("#catalog-category");
const sortSelect = document.querySelector("#catalog-sort");

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

function getBaseEntries() {
  let entries = catalogCache ? Object.entries(catalogCache) : [];

  // Item yang disembunyikan admin tidak ditampilkan ke user.
  entries = entries.filter(([, item]) => item?.isActive !== false);

  if (catalogType === "sewa") {
    const busyIds = getBusyRentalItemIds();
    entries = entries.filter(([id]) => !busyIds.has(String(id)));
  }

  return entries;
}

function fillCategoryOptions(entries) {
  if (!categorySelect) {
    return;
  }

  const currentValue = categorySelect.value || "Semua";
  const categories = [...new Set(entries.map(([, item]) => (item.category || "").trim()).filter(Boolean))].sort();

  categorySelect.innerHTML = `
    <option value="Semua">Semua Kategori</option>
    ${categories.map((category) => `<option value="${category}">${category}</option>`).join("")}
  `;

  if (categories.includes(currentValue)) {
    categorySelect.value = currentValue;
  }
}

function getFilteredEntries() {
  let entries = getBaseEntries();
  fillCategoryOptions(entries);

  const searchValue = (searchInput?.value || "").trim().toLowerCase();
  const categoryValue = categorySelect?.value || "Semua";
  const sortValue = sortSelect?.value || "default";

  if (searchValue) {
    entries = entries.filter(([, item]) => (item.name || "").toLowerCase().includes(searchValue));
  }

  if (categoryValue !== "Semua") {
    entries = entries.filter(([, item]) => (item.category || "") === categoryValue);
  }

  if (sortValue === "price-asc") {
    entries.sort((a, b) => Number(a[1][config.priceKey] || 0) - Number(b[1][config.priceKey] || 0));
  }

  if (sortValue === "price-desc") {
    entries.sort((a, b) => Number(b[1][config.priceKey] || 0) - Number(a[1][config.priceKey] || 0));
  }

  return entries;
}

function renderCatalog() {
  const baseEntries = getBaseEntries();
  const entries = getFilteredEntries();

  if (!entries.length) {
    if (catalogType === "sewa" && baseEntries.length === 0 && Object.keys(catalogCache).length > 0) {
      list.innerHTML = `<div class="empty-card">Semua barang sewa sedang dipinjam. Cek lagi nanti.</div>`;
      return;
    }
    list.innerHTML = `<div class="empty-card">Data tidak ditemukan. Coba ganti kata kunci atau filter.</div>`;
    return;
  }

  list.innerHTML = entries
    .map(([id, item]) => {
      const stock = Number(item.stock || 0);
      const soldOut = catalogType === "produk" && stock <= 0;

      return `
        <div class="col-md-6 col-xl-4">
          <article class="market-card">
            <div class="market-card__icon">${(item.name || "M").trim().charAt(0).toUpperCase()}</div>
            <h3>${item.name}</h3>
            <p>${item.description || "Deskripsi belum tersedia."}</p>
            <strong>${formatCurrency(item[config.priceKey])}${catalogType === "sewa" ? " / hari" : ""}</strong>
            ${catalogType === "produk"
              ? `<small class="${soldOut ? "text-danger fw-semibold" : "text-muted"}">Stok: ${stock}${soldOut ? " (Habis)" : ""}</small>`
              : ""}
            <div class="d-grid mt-3">
              ${soldOut
                ? `<button class="btn btn-secondary" disabled>Stok Habis</button>`
                : `<a class="btn btn-success" href="${buildOrderLink(id)}">Pesan Item Ini</a>`}
            </div>
          </article>
        </div>
      `;
    })
    .join("");
}

function setupCatalogFilters() {
  [searchInput, categorySelect, sortSelect].forEach((element) => {
    if (!element) {
      return;
    }
    element.addEventListener("input", renderCatalog);
    element.addEventListener("change", renderCatalog);
  });
}

if (config) {
  requireLogin(() => {
    setupLogoutButton();
    setupCatalogFilters();

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
