import {
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  database,
  formatCurrency,
  requireAdmin,
  setupLogoutButton,
  showAlert
} from "./firebase-app.js";

const pageConfig = {
  products: {
    title: "Produk",
    collection: "products",
    formId: "item-form",
    fields: ["name", "category", "price", "stock", "isActive", "description"],
    listTitle: (item) => item.name,
    listSubtitle: (item) => `${item.category} - ${formatCurrency(item.price)} - Stok: ${Number(item.stock || 0)} - ${item.isActive === false ? "Disembunyikan" : "Ditampilkan"}`
  },
  services: {
    title: "Jasa",
    collection: "services",
    formId: "item-form",
    fields: ["name", "category", "price", "estimatedDays", "isActive", "description"],
    listTitle: (item) => item.name,
    listSubtitle: (item) => `${item.category} - ${formatCurrency(item.price)} - Estimasi: ${Number(item.estimatedDays || 1)} hari - ${item.isActive === false ? "Disembunyikan" : "Ditampilkan"}`
  },
  rentals: {
    title: "Sewa Barang",
    collection: "rentals",
    formId: "item-form",
    fields: ["name", "category", "pricePerDay", "isActive", "description"],
    listTitle: (item) => item.name,
    listSubtitle: (item) => `${item.category} - ${formatCurrency(item.pricePerDay)} / hari - ${item.isActive === false ? "Disembunyikan" : "Ditampilkan"}`
  }
};

const pageName = document.body.dataset.adminPage;
const config = pageConfig[pageName];
const form = document.querySelector("#item-form");
const list = document.querySelector("#item-list");
const itemId = document.querySelector("#item-id");
const categoryInput = document.querySelector("#category");
const categoryOptions = document.querySelector("#category-options");
const categorySuggestions = document.querySelector("#category-suggestions");
let knownCategories = [];

function normalizeCategory(value) {
  const clean = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!clean) {
    return "";
  }
  return clean
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function renderCategorySuggestions(filterText = "") {
  if (!categorySuggestions) {
    return;
  }

  const filtered = (filterText
    ? knownCategories.filter((category) => category.toLowerCase().includes(filterText.toLowerCase()))
    : knownCategories
  ).slice(0, 8);

  if (!filtered.length) {
    categorySuggestions.innerHTML = "";
    return;
  }

  categorySuggestions.innerHTML = filtered
    .map((category) => `<button type="button" class="list-group-item list-group-item-action" data-category-item="${category}">${category}</button>`)
    .join("");

  categorySuggestions.querySelectorAll("[data-category-item]").forEach((button) => {
    button.addEventListener("click", () => {
      categoryInput.value = button.dataset.categoryItem;
      categorySuggestions.innerHTML = "";
      categoryInput.focus();
    });
  });
}

function getPayload() {
  const payload = {};

  config.fields.forEach((field) => {
    const input = document.querySelector(`#${field}`);
    if (input.type === "checkbox") {
      payload[field] = input.checked;
      return;
    }

    if (input.type === "number") {
      payload[field] = Number(input.value);
      return;
    }

    if (field === "category") {
      payload[field] = normalizeCategory(input.value);
      return;
    }

    payload[field] = input.value.trim();
  });

  payload.updatedAt = serverTimestamp();
  return payload;
}

function fillForm(id, item) {
  itemId.value = id;
  config.fields.forEach((field) => {
    const input = document.querySelector(`#${field}`);
    if (!input) {
      return;
    }
    if (input.type === "checkbox") {
      input.checked = item[field] !== false;
      return;
    }
    input.value = item[field] ?? "";
  });
  document.querySelector("#submit-label").textContent = `Update ${config.title}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteItem(id) {
  // Konfirmasi dulu sebelum hapus data.
  const confirmed = window.confirm(`Hapus data ${config.title.toLowerCase()} ini?`);
  if (!confirmed) {
    return;
  }

  await remove(ref(database, `${config.collection}/${id}`));
  showAlert(`Data ${config.title.toLowerCase()} berhasil dihapus.`, "success");
}

function renderList(data) {
  const entries = data ? Object.entries(data) : [];
  const categories = [...new Set(entries.map(([, item]) => normalizeCategory(item.category || "")).filter(Boolean))];
  knownCategories = categories.sort();

  if (categoryOptions) {
    categoryOptions.innerHTML = knownCategories
      .map((category) => `<option value="${category}"></option>`)
      .join("");
  }

  if (!entries.length) {
    list.innerHTML = `<div class="empty-card">Belum ada data ${config.title.toLowerCase()}.</div>`;
    return;
  }

  list.innerHTML = entries
    .map(([id, item]) => `
      <article class="data-card">
        <div>
          <h3>${config.listTitle(item)}</h3>
          <p>${config.listSubtitle(item)}</p>
          <small>${item.description || "Tidak ada deskripsi."}</small>
        </div>
        <div class="data-card__actions">
          <button class="btn btn-outline-success btn-sm" data-action="edit" data-id="${id}">Edit</button>
          <button class="btn btn-outline-danger btn-sm" data-action="delete" data-id="${id}">Hapus</button>
        </div>
      </article>
    `)
    .join("");

  list.querySelectorAll("[data-action='edit']").forEach((button) => {
    button.addEventListener("click", () => {
      const item = data[button.dataset.id];
      fillForm(button.dataset.id, item);
    });
  });

  list.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", () => deleteItem(button.dataset.id));
  });
}

function listenItems() {
  // Read data realtime sesuai modul halaman admin.
  onValue(ref(database, config.collection), (snapshot) => {
    renderList(snapshot.val());
  });
}

function setupForm() {
  if (categoryInput) {
    categoryInput.addEventListener("focus", () => {
      renderCategorySuggestions(categoryInput.value.trim());
    });

    categoryInput.addEventListener("input", () => {
      renderCategorySuggestions(categoryInput.value.trim());
    });

    categoryInput.addEventListener("blur", () => {
      setTimeout(() => {
        if (categorySuggestions) {
          categorySuggestions.innerHTML = "";
        }
      }, 150);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = getPayload();
    const id = itemId.value;

    try {
      if (id) {
        // Update data lama.
        await update(ref(database, `${config.collection}/${id}`), payload);
        showAlert(`Data ${config.title.toLowerCase()} berhasil diupdate.`, "success");
      } else {
        // Create data baru.
        const newRef = push(ref(database, config.collection));
        await set(newRef, {
          ...payload,
          createdAt: serverTimestamp()
        });
        showAlert(`Data ${config.title.toLowerCase()} berhasil ditambahkan.`, "success");
      }

      form.reset();
      itemId.value = "";
      document.querySelector("#submit-label").textContent = `Simpan ${config.title}`;
    } catch (error) {
      showAlert(error.message, "danger");
    }
  });

  document.querySelector("#reset-form").addEventListener("click", () => {
    form.reset();
    itemId.value = "";
    document.querySelector("#submit-label").textContent = `Simpan ${config.title}`;
  });
}

if (config) {
  requireAdmin(() => {
    setupLogoutButton();
    setupForm();
    listenItems();
  });
}
