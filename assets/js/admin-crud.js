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
    fields: ["name", "category", "price", "description"],
    listTitle: (item) => item.name,
    listSubtitle: (item) => `${item.category} - ${formatCurrency(item.price)}`
  },
  services: {
    title: "Jasa",
    collection: "services",
    formId: "item-form",
    fields: ["name", "category", "price", "description"],
    listTitle: (item) => item.name,
    listSubtitle: (item) => `${item.category} - ${formatCurrency(item.price)}`
  },
  rentals: {
    title: "Sewa Barang",
    collection: "rentals",
    formId: "item-form",
    fields: ["name", "category", "pricePerDay", "description"],
    listTitle: (item) => item.name,
    listSubtitle: (item) => `${item.category} - ${formatCurrency(item.pricePerDay)} / hari`
  }
};

const pageName = document.body.dataset.adminPage;
const config = pageConfig[pageName];
const form = document.querySelector("#item-form");
const list = document.querySelector("#item-list");
const itemId = document.querySelector("#item-id");

function getPayload() {
  const payload = {};

  config.fields.forEach((field) => {
    const input = document.querySelector(`#${field}`);
    payload[field] = input.type === "number" ? Number(input.value) : input.value.trim();
  });

  payload.updatedAt = serverTimestamp();
  return payload;
}

function fillForm(id, item) {
  itemId.value = id;
  config.fields.forEach((field) => {
    document.querySelector(`#${field}`).value = item[field] ?? "";
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
