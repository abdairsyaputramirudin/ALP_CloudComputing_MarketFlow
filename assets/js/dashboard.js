import {
  ref,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  auth,
  database,
  requireAdmin,
  requireLogin,
  setupLogoutButton
} from "./firebase-app.js";

const dashboardType = document.body.dataset.dashboard;

function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) {
    element.textContent = value;
  }
}

function countCollection(collection, targetId) {
  onValue(ref(database, collection), (snapshot) => {
    const data = snapshot.val();
    setText(targetId, data ? Object.keys(data).length : 0);
  });
}

if (dashboardType === "admin") {
  requireAdmin(() => {
    setupLogoutButton();
    countCollection("products", "product-count");
    countCollection("services", "service-count");
    countCollection("rentals", "rental-count");
    countCollection("orders", "order-count");
  });
}

if (dashboardType === "user") {
  requireLogin((user) => {
    setupLogoutButton();
    setText("user-email", user.email);

    onValue(ref(database, "orders"), (snapshot) => {
      const data = snapshot.val() || {};
      const total = Object.values(data).filter((order) => order.userId === auth.currentUser.uid).length;
      setText("user-order-count", total);
    });
  });
}
