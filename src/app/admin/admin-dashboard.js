"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LockResetIcon from "@mui/icons-material/LockReset";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import VisibilityIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOffOutlined";
import { defaultProductCaution, defaultProductUsage, getProductSizePlaceholder, mergeProductCategories, productCategories } from "../../lib/catalog";
import { notifyProductCatalogUpdate, subscribeToProductCatalogUpdates } from "../../lib/product-catalog-updates";
import { MAX_PRODUCT_PRICE } from "../../lib/products";
import BrandWordmark from "../components/brand-wordmark";

const money = new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", minimumFractionDigits: 2 });
const emptyForm = { name: "", category: "Dresses", price: "", size: "", stockQuantity: "", image: "", description: "", howToUse: defaultProductUsage, caution: defaultProductCaution };
const LOW_STOCK_THRESHOLD = 5;
const DASHBOARD_REFRESH_INTERVAL_MS = 10_000;

function timeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

function subscribeToTimeGreeting(onChange) {
  const interval = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(interval);
}

function getServerGreeting() {
  return "Welcome admin.";
}

async function readApiResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

async function uploadImageFile(file) {
  if (file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error("Image file must be smaller than 5 MB.");
  if (!file.type.startsWith("image/")) throw new Error("File must be an image.");
  const formData = new FormData();
  formData.append("file", file);
  const { url } = await readApiResponse(await fetch("/api/admin/upload-image", { method: "POST", body: formData }));
  return url;
}

function toggleAdminDropdown(event) {
  event.preventDefault();
  event.stopPropagation();
  const details = event.currentTarget.closest("details");
  if (!details) throw new Error("Admin dropdown controls must be inside a details element.");
  details.open = !details.open;
  const expanded = String(details.open);
  event.currentTarget.setAttribute("aria-expanded", expanded);
  event.currentTarget.setAttribute("aria-label", `${details.open ? "Collapse" : "Expand"} ${event.currentTarget.dataset.dropdownLabel}`);
}

export default function AdminDashboard({ username }) {
  const greeting = useSyncExternalStore(subscribeToTimeGreeting, timeBasedGreeting, getServerGreeting);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState(productCategories);
  const [form, setForm] = useState(emptyForm);
  const [addingProduct, setAddingProduct] = useState(false);
  const addingProductRef = useRef(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryRemoving, setCategoryRemoving] = useState("");
  const [categoryRemoval, setCategoryRemoval] = useState(null);
  const [productCategoryDrafts, setProductCategoryDrafts] = useState({});
  const [catalogueRetryKey, setCatalogueRetryKey] = useState(0);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [nameDrafts, setNameDrafts] = useState({});
  const [priceDrafts, setPriceDrafts] = useState({});
  const [stockDrafts, setStockDrafts] = useState({});
  const [savingProductIds, setSavingProductIds] = useState({});
  const [message, setMessage] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [databaseReady, setDatabaseReady] = useState(false);
  const [stockRefreshError, setStockRefreshError] = useState("");
  const [securityPanelOpen, setSecurityPanelOpen] = useState(false);
  const [credentialTarget, setCredentialTarget] = useState("admin");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [securityFeedback, setSecurityFeedback] = useState(null);
  const [salesUsername, setSalesUsername] = useState("");
  const [salesPassword, setSalesPassword] = useState("");
  const [salesPasswordConfirm, setSalesPasswordConfirm] = useState("");
  const [salesAccessLoading, setSalesAccessLoading] = useState(false);
  const knownLowStockProductIds = useRef(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    async function loadCatalogue() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const { products: saved, categories: savedCategories } = await readApiResponse(await fetch("/api/admin/products", { cache: "no-store" }));
        if (cancelled) return;
        if (!Array.isArray(saved)) throw new Error("The product inventory response is invalid.");
        if (!Array.isArray(savedCategories)) throw new Error("The product categories response is invalid.");
        const availableCategories = mergeProductCategories(productCategories, savedCategories);
        setProducts(saved);
        setCategories(availableCategories);
        setForm((current) => availableCategories.some((category) => category.toLowerCase() === current.category.toLowerCase())
          ? current
          : { ...current, category: availableCategories[0] || "" });
        setDatabaseReady(true);
        setStockRefreshError("");

        const lowStockProducts = saved.filter((product) => product.stockQuantity <= LOW_STOCK_THRESHOLD);
        const previousLowStockProductIds = knownLowStockProductIds.current;
        knownLowStockProductIds.current = new Set(lowStockProducts.map((product) => product.id));
        const newlyLowStockProducts = previousLowStockProductIds
          ? lowStockProducts.filter((product) => !previousLowStockProductIds.has(product.id))
          : [];
        if (newlyLowStockProducts.length && typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification(newlyLowStockProducts.length === 1 ? "Low stock alert" : `${newlyLowStockProducts.length} low stock alerts`, {
            body: newlyLowStockProducts.map((product) => `${product.name}: ${product.stockQuantity} ${product.stockQuantity === 1 ? "unit" : "units"} left`).join("\n"),
            tag: "virtuous-matess-ventures-low-stock",
          });
        }
      } catch (error) {
        if (!cancelled && knownLowStockProductIds.current === null) {
          setDatabaseReady(false);
          setMessage(error.message);
        } else if (!cancelled) {
          setStockRefreshError(error.message || "Could not refresh inventory.");
        }
      } finally {
        requestInFlight = false;
        if (!cancelled) setCatalogueLoading(false);
      }
    }
    void loadCatalogue();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void loadCatalogue();
    };
    const unsubscribeFromProductUpdates = subscribeToProductCatalogUpdates(refreshWhenVisible);
    const interval = window.setInterval(refreshWhenVisible, DASHBOARD_REFRESH_INTERVAL_MS);
    const onFocus = refreshWhenVisible;
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      unsubscribeFromProductUpdates();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [catalogueRetryKey]);

  useEffect(() => {
    if (!securityPanelOpen || credentialTarget !== "sales") return undefined;
    let active = true;
    void fetch("/api/admin/sales-credentials", { cache: "no-store" })
      .then(readApiResponse)
      .then(({ username: savedUsername }) => {
        if (active) setSalesUsername(savedUsername);
      })
      .catch((error) => {
        if (active) setSecurityFeedback({ type: "error", message: error.message || "Could not load sales login settings." });
      })
      .finally(() => {
        if (active) setSalesAccessLoading(false);
      });
    return () => { active = false; };
  }, [securityPanelOpen, credentialTarget]);

  useEffect(() => {
    if (!message || !databaseReady) return;
    const timer = window.setTimeout(() => setMessage(""), 2800);
    return () => window.clearTimeout(timer);
  }, [message, databaseReady]);

  async function addProduct(event) {
    event.preventDefault();
    if (addingProductRef.current) return;
    if (uploadingImage) return;
    if (!databaseReady) return;
    if (!form.image) { setMessage("Upload a product image."); return; }
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0 || price > MAX_PRODUCT_PRICE) {
      setMessage(`Enter a price between GHS 0.01 and GHS ${MAX_PRODUCT_PRICE.toLocaleString("en-GH", { minimumFractionDigits: 2 })}.`);
      return;
    }
    const description = form.description.trim() || "A thoughtfully selected piece for everyday style and living.";
    const product = { id: crypto.randomUUID(), name: form.name.trim(), category: form.category, price, size: form.size.trim() || "One size", stockQuantity: Number(form.stockQuantity), image: form.image, description, cardDescription: description, howToUse: form.howToUse.trim() || defaultProductUsage, caution: form.caution.trim() || defaultProductCaution, badge: "Just added" };
    addingProductRef.current = true;
    setAddingProduct(true);
    try {
      const { product: saved } = await readApiResponse(await fetch("/api/admin/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product }) }));
      setProducts((current) => [saved, ...current]);
      notifyProductCatalogUpdate();
      setForm(emptyForm);
      setMessage(`${saved.name} has been published.`);
    } catch (error) { setMessage(error.message); }
    finally {
      addingProductRef.current = false;
      setAddingProduct(false);
    }
  }

  async function addCategory(event) {
    event.preventDefault();
    if (!databaseReady || categorySaving) return;
    const name = categoryDraft.trim().replace(/\s+/g, " ");
    if (!name) { setMessage("Enter a category name."); return; }
    if (name.length > 50) { setMessage("Category names must be 50 characters or fewer."); return; }
    setCategorySaving(true);
    try {
      const { category } = await readApiResponse(await fetch("/api/admin/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }));
      setCategories((current) => mergeProductCategories(current, [category]));
      setForm((current) => ({ ...current, category }));
      setCategoryDraft("");
      notifyProductCatalogUpdate();
      setMessage(`${category} has been added as a category.`);
    } catch (error) { setMessage(error.message); }
    finally { setCategorySaving(false); }
  }

  function requestCategoryRemoval(categoryName) {
    if (!databaseReady || categorySaving || categoryRemoving) return;
    const categoryKey = categoryName.toLowerCase();
    const destinations = categories.filter((category) => category.toLowerCase() !== categoryKey);
    const productCount = products.filter((product) => product.category.toLowerCase() === categoryKey).length;
    if (productCount > 0 && destinations.length === 0) {
      setMessage("Add another category before removing this one so its products have a destination.");
      return;
    }
    setCategoryRemoval({ name: categoryName, replacementCategory: destinations[0] || "" });
  }

  async function removeCategory() {
    if (!categoryRemoval || !databaseReady || categorySaving || categoryRemoving) return;
    const { name, replacementCategory } = categoryRemoval;
    const categoryKey = name.toLowerCase();
    const productsToMove = products.filter((product) => product.category.toLowerCase() === categoryKey);
    if (productsToMove.length > 0 && !replacementCategory) {
      setMessage("Choose a destination category for the products.");
      return;
    }

    setCategoryRemoving(name);
    try {
      const { category, movedProducts = 0, replacementCategory: destinationName } = await readApiResponse(await fetch("/api/admin/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          ...(productsToMove.length > 0 ? { replacementCategory } : {}),
        }),
      }));
      setCategories((current) => current.filter((name) => name.toLowerCase() !== category.toLowerCase()));
      const remainingCategories = categories.filter((name) => name.toLowerCase() !== category.toLowerCase());
      const nextFormCategory = destinationName || remainingCategories[0] || "";
      setProducts((current) => current.map((product) =>
        destinationName && product.category.toLowerCase() === category.toLowerCase()
          ? { ...product, category: destinationName }
          : product));
      setForm((current) => current.category.toLowerCase() === category.toLowerCase()
        ? { ...current, category: nextFormCategory }
        : current);
      setProductCategoryDrafts((current) => {
        const next = { ...current };
        for (const product of productsToMove) delete next[product.id];
        for (const [productId, draft] of Object.entries(next)) {
          if (draft.toLowerCase() === category.toLowerCase()) delete next[productId];
        }
        return next;
      });
      setCategoryRemoval(null);
      notifyProductCatalogUpdate();
      setMessage(`${category} has been removed.${movedProducts > 0 ? ` ${movedProducts} ${movedProducts === 1 ? "product was" : "products were"} moved to ${destinationName}.` : ""}`);
    } catch (error) { setMessage(error.message); }
    finally { setCategoryRemoving(""); }
  }

  async function handleImageUpload(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (uploadingImage) return;
    setUploadingImage(true);
    try {
      const url = await uploadImageFile(file);
      setForm({ ...form, image: url });
      setMessage(`${file.name} uploaded.`);
    } catch (error) { setMessage(error.message); }
    finally { setUploadingImage(false); }
  }

  async function deleteProduct(product) {
    try {
      await readApiResponse(await fetch(`/api/admin/products?id=${encodeURIComponent(product.id)}`, { method: "DELETE" }));
      setProducts((current) => current.filter((item) => item.id !== product.id));
      notifyProductCatalogUpdate();
      setMessage(`${product.name} has been removed.`);
    } catch (error) { setMessage(error.message); }
  }

  async function saveProduct(product) {
    const name = (nameDrafts[product.id] ?? product.name).trim();
    const priceValue = priceDrafts[product.id] ?? String(product.price);
    const stockQuantityChanged = Object.hasOwn(stockDrafts, product.id);
    const stockValue = stockDrafts[product.id] ?? String(product.stockQuantity);
    const category = productCategoryDrafts[product.id] ?? product.category;
    const price = Number(priceValue);
    const stockQuantity = Number(stockValue);
    if (!name) {
      setMessage("Enter a product name.");
      return;
    }
    if (name.length > 200) {
      setMessage("Product names must be 200 characters or fewer.");
      return;
    }
    if (priceValue.trim() === "" || !Number.isFinite(price) || price <= 0) {
      setMessage("Enter a valid price greater than zero.");
      return;
    }
    if (stockQuantityChanged && (stockValue.trim() === "" || !Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 2_147_483_647)) {
      setMessage("Enter a whole stock quantity between 0 and 2,147,483,647.");
      return;
    }

    setSavingProductIds((current) => ({ ...current, [product.id]: true }));
    try {
      const { product: saved } = await readApiResponse(await fetch("/api/admin/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: product.id, name, price, ...(stockQuantityChanged ? { stockQuantity } : {}), ...(category !== product.category ? { category } : {}) }),
      }));
      setProducts((current) => current.map((item) => item.id === product.id ? saved : item));
      notifyProductCatalogUpdate();
      setNameDrafts((current) => { const next = { ...current }; delete next[product.id]; return next; });
      setPriceDrafts((current) => { const next = { ...current }; delete next[product.id]; return next; });
      setStockDrafts((current) => { const next = { ...current }; delete next[product.id]; return next; });
      setProductCategoryDrafts((current) => { const next = { ...current }; delete next[product.id]; return next; });
      setMessage(`${saved.name} updated.`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSavingProductIds((current) => { const next = { ...current }; delete next[product.id]; return next; });
    }
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    router.replace("/admin");
    router.refresh();
  }

  function toggleSecurityPanel() {
    const nextOpen = !securityPanelOpen;
    setSecurityPanelOpen(nextOpen);
    setSalesAccessLoading(nextOpen && credentialTarget === "sales");
    setSecurityFeedback(null);
    if (!nextOpen) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSalesPassword("");
      setSalesPasswordConfirm("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
    }
  }

  function changeCredentialTarget(event) {
    const target = event.target.value;
    setCredentialTarget(target);
    setSalesAccessLoading(target === "sales");
    setSecurityFeedback(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSalesPassword("");
    setSalesPasswordConfirm("");
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  }

  async function updateSalesLogin(event) {
    event.preventDefault();
    setSecurityFeedback(null);
    if (salesPassword !== salesPasswordConfirm) {
      setSecurityFeedback({ type: "error", message: "The new passwords do not match." });
      return;
    }

    setSecuritySaving(true);
    try {
      const { username: savedUsername } = await readApiResponse(await fetch("/api/admin/sales-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: salesUsername, password: salesPassword }),
      }));
      setSalesUsername(savedUsername);
      setSalesPassword("");
      setSalesPasswordConfirm("");
      setSecurityFeedback({ type: "success", message: "Salesperson login updated. Existing salesperson sessions have been signed out." });
    } catch (error) {
      setSecurityFeedback({ type: "error", message: error.message || "Could not update sales login settings." });
    } finally {
      setSecuritySaving(false);
    }
  }

  async function updateAdminPassword(event) {
    event.preventDefault();
    setSecurityFeedback(null);
    if (newPassword !== confirmPassword) {
      setSecurityFeedback({ type: "error", message: "The new passwords do not match." });
      return;
    }

    setSecuritySaving(true);
    try {
      await readApiResponse(await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      }));
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setSecurityFeedback({ type: "success", message: "Admin password updated. Other admin sessions have been signed out." });
    } catch (error) {
      setSecurityFeedback({ type: "error", message: error.message || "Could not update the password." });
    } finally {
      setSecuritySaving(false);
    }
  }

  return <main className="dashboard-shell">
    <header className="dashboard-header"><div className="dashboard-brand-logo"><BrandWordmark /></div><div className="dashboard-header-actions"><span className="secure-status">● Signed in as {username}</span><Link className="dashboard-sales-button" href="/sales?from=admin">Sales dashboard</Link><button type="button" className="dashboard-password-toggle" onClick={toggleSecurityPanel} aria-expanded={securityPanelOpen} aria-controls="admin-password-panel"><LockResetIcon fontSize="small" aria-hidden="true" />Manage passwords</button><button onClick={signOut}>Sign out</button></div></header>
    {securityPanelOpen && <section className="admin-password-panel" id="admin-password-panel" aria-labelledby="admin-password-heading">
      <div className="admin-password-panel-heading">
        <div><p className="atelier-kicker">Account security</p><h2 id="admin-password-heading">Manage account credentials</h2></div>
        <button type="button" className="admin-password-close" onClick={toggleSecurityPanel} aria-label="Close credential settings"><CloseIcon fontSize="small" /></button>
      </div>
      <div className="admin-password-form">
        <div className="admin-password-field admin-password-target">
          <label htmlFor="credential-target">Choose account</label>
          <select id="credential-target" value={credentialTarget} onChange={changeCredentialTarget} disabled={securitySaving}>
            <option value="admin">Admin account</option>
            <option value="sales">Salesperson account</option>
          </select>
        </div>
        {credentialTarget === "admin" ? <form onSubmit={updateAdminPassword}>
          <div className="admin-password-fields">
            <div className="admin-password-field">
              <label htmlFor="admin-current-password">Current admin password</label>
              <span className="admin-password-input"><input id="admin-current-password" type={showCurrentPassword ? "text" : "password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your current password" required /><button type="button" className="admin-password-visibility" onClick={() => setShowCurrentPassword((visible) => !visible)} aria-label={showCurrentPassword ? "Hide current password" : "Show current password"} aria-pressed={showCurrentPassword}>{showCurrentPassword ? <VisibilityOffIcon aria-hidden="true" /> : <VisibilityIcon aria-hidden="true" />}</button></span>
            </div>
            <div className="admin-password-field">
              <label htmlFor="admin-new-password">New admin password</label>
              <span className="admin-password-input"><input id="admin-new-password" type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder="At least 8 characters" minLength={8} maxLength={128} required /><button type="button" className="admin-password-visibility" onClick={() => setShowNewPassword((visible) => !visible)} aria-label={showNewPassword ? "Hide new password" : "Show new password"} aria-pressed={showNewPassword}>{showNewPassword ? <VisibilityOffIcon aria-hidden="true" /> : <VisibilityIcon aria-hidden="true" />}</button></span>
            </div>
            <div className="admin-password-field">
              <label htmlFor="admin-confirm-password">Confirm new password</label>
              <span className="admin-password-input"><input id="admin-confirm-password" type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="Re-enter your new password" minLength={8} maxLength={128} required /><button type="button" className="admin-password-visibility" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={showConfirmPassword}>{showConfirmPassword ? <VisibilityOffIcon aria-hidden="true" /> : <VisibilityIcon aria-hidden="true" />}</button></span>
            </div>
          </div>
          {securityFeedback && <p className={`admin-password-feedback ${securityFeedback.type}`} role={securityFeedback.type === "error" ? "alert" : "status"}>{securityFeedback.message}</p>}
          <div className="admin-password-actions"><p>Confirm your current password to change admin access. Other admin sessions will be signed out.</p><button type="submit" disabled={securitySaving}><LockResetIcon fontSize="small" aria-hidden="true" />{securitySaving ? "Updating…" : "Update admin password"}</button></div>
        </form> : <form onSubmit={updateSalesLogin}>
          <div className="admin-password-fields admin-sales-credential-fields">
            <div className="admin-password-field">
              <label htmlFor="sales-login-username">Salesperson username</label>
              <input id="sales-login-username" type="text" value={salesUsername} onChange={(event) => setSalesUsername(event.target.value)} minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]{3,32}" autoComplete="username" placeholder={salesAccessLoading ? "Loading current username…" : "Enter a sales username"} required disabled={salesAccessLoading || securitySaving} />
            </div>
            <div className="admin-password-field">
              <label htmlFor="sales-login-password">New salesperson password</label>
              <input id="sales-login-password" type="password" value={salesPassword} onChange={(event) => setSalesPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" placeholder="Use at least 8 characters" required disabled={salesAccessLoading || securitySaving} />
            </div>
            <div className="admin-password-field">
              <label htmlFor="sales-login-confirm-password">Confirm new password</label>
              <input id="sales-login-confirm-password" type="password" value={salesPasswordConfirm} onChange={(event) => setSalesPasswordConfirm(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" placeholder="Re-enter the password" required disabled={salesAccessLoading || securitySaving} />
            </div>
          </div>
          {securityFeedback && <p className={`admin-password-feedback ${securityFeedback.type}`} role={securityFeedback.type === "error" ? "alert" : "status"}>{securityFeedback.message}</p>}
          <div className="admin-password-actions"><p>Use a 3–32 character username and 8–128 character password. Updating access signs out active salesperson sessions.</p><button type="submit" disabled={salesAccessLoading || securitySaving}><LockResetIcon fontSize="small" aria-hidden="true" />{securitySaving ? "Updating…" : "Update salesperson credentials"}</button></div>
        </form>}
      </div>
    </section>}
    <section className="dashboard-heading"><p className="atelier-kicker">Store administration</p><h1>{greeting}</h1><p>Keep your collection polished, current, and ready to shop.</p></section>
    {message && !databaseReady && <p className="database-warning" role="alert">{message} Check DATABASE_URL in your environment and run `npx prisma db push` if the schema has not been applied.</p>}
    <section className="dashboard-overview-grid" aria-label="New listing and live catalogue">
      <div className="dashboard-overview-left">
      {stockRefreshError && <p className="database-warning" role="alert">Inventory could not be refreshed. The displayed stock may be out of date. {stockRefreshError}</p>}
    <section className="dashboard-grid">
      <form className="catalog-form" onSubmit={addProduct}>
        <details className="listing-dropdown admin-dropdown-card">
          <summary className="listing-dropdown-summary admin-dropdown-summary" tabIndex={-1}>
            <span><span className="atelier-kicker">New listing</span><strong>Add a product</strong></span>
            <span className="listing-dropdown-note">Create a catalogue listing</span>
            <button className="admin-dropdown-toggle" type="button" aria-label="Expand new listing form" aria-expanded="false" aria-controls="listing-dropdown-content" data-dropdown-label="new listing form" onClick={toggleAdminDropdown}><span className="admin-dropdown-chevron" aria-hidden="true" /></button>
          </summary>
          <div className="listing-dropdown-content" id="listing-dropdown-content">
            <p className="listing-intro">Add the details customers need to discover and shop this product.</p>
            <section className="listing-form-section" aria-labelledby="listing-details-heading">
              <div className="listing-section-heading"><span>01</span><h3 id="listing-details-heading">Product details</h3></div>
              <label>Product name<input required maxLength={200} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Sneakers" /></label>
              <div className="field-row listing-field-row"><label>Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label>Price (GHS)<input required min="0.01" max={MAX_PRODUCT_PRICE} step="0.01" type="number" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="36.00" /></label></div>
              <div className="field-row listing-field-row"><label>Size<input value={form.size} onChange={(event) => setForm({ ...form, size: event.target.value })} placeholder={getProductSizePlaceholder(form.category)} /></label><label>Stock quantity<input required type="number" min="0" max="2147483647" step="1" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} placeholder="e.g. 25" /><small>Available units; pending payments reserve stock temporarily.</small></label></div>
              <div className="listing-image-field">
                <span className="listing-field-label">Product image <span>Required</span></span>
                <label className={`listing-image-upload${form.image ? " has-image" : ""}`}>
                  <span className="listing-image-preview" aria-hidden="true" style={form.image ? { backgroundImage: `url("${form.image}")` } : undefined}>
                    {!form.image && <svg viewBox="0 0 24 24" fill="none"><path d="M4 6.75A1.75 1.75 0 0 1 5.75 5h12.5A1.75 1.75 0 0 1 20 6.75v10.5A1.75 1.75 0 0 1 18.25 19H5.75A1.75 1.75 0 0 1 4 17.25V6.75Z" /><circle cx="9" cy="9" r="1.5" /><path d="m5 16 4-4 3 3 2-2 5 5" /></svg>}
                  </span>
                  <span className="listing-image-copy" aria-live="polite"><strong>{uploadingImage ? "Uploading image…" : form.image ? "Image ready" : "Choose a product photo"}</strong><span>JPEG, PNG, WebP, AVIF or GIF · Up to 5 MB</span></span>
                  <span className="listing-image-action">{form.image ? "Replace" : "Browse"}</span>
                  <input className="listing-image-input" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/gif" onChange={handleImageUpload} disabled={uploadingImage} aria-label="Choose product image" />
                </label>
              </div>
            </section>
            <section className="listing-form-section listing-description-section" aria-labelledby="listing-description-heading">
              <div className="listing-section-heading"><span>02</span><h3 id="listing-description-heading">Product description</h3></div>
              <label>Description <span className="listing-field-optional">Optional</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the details that make this product special." /></label>
            </section>
            <button className="publish-button" type="submit" disabled={!databaseReady || uploadingImage || addingProduct}>{uploadingImage ? "Uploading image…" : addingProduct ? "Publishing…" : "Publish product"} <span aria-hidden="true">→</span></button>
          </div>
        </details>
      </form>
    </section>
      </div>
      <section className="catalog-panel">
        <div className="panel-heading"><div><p className="atelier-kicker">Live catalogue</p><h2>Products</h2></div><span className="product-count">{databaseReady ? `${products.length} live` : "Database unavailable"}</span></div>
        <form className="category-create-form" onSubmit={addCategory}>
          <label htmlFor="admin-new-category">Add a category</label>
          <div className="category-create-controls">
            <input id="admin-new-category" maxLength={50} required value={categoryDraft} onChange={(event) => setCategoryDraft(event.target.value)} placeholder="e.g. Accessories" />
            <button type="submit" disabled={!databaseReady || categorySaving || Boolean(categoryRemoving)}>{categorySaving ? "Adding…" : "Add"}</button>
          </div>
          <p>Categories appear in product listings and storefront filters. Add a removed category again to restore it.</p>
        </form>
        <details className="category-management admin-dropdown-card" aria-labelledby="category-management-heading">
          <summary className="category-management-summary admin-dropdown-summary" tabIndex={-1}>
            <div><h3 id="category-management-heading">Manage categories</h3><span className="category-management-count">{categories.length} total</span></div>
            <button className="admin-dropdown-toggle" type="button" aria-label="Expand category management" aria-expanded="false" aria-controls="category-management-content" data-dropdown-label="category management" onClick={toggleAdminDropdown}><span className="admin-dropdown-chevron" aria-hidden="true" /></button>
          </summary>
          <div className="category-management-content" id="category-management-content">
            <div className="category-management-heading">
            <p>Remove any category. If it has products, choose where to move them first.</p>
            {!databaseReady && <button className="category-retry-button" type="button" onClick={() => { setCatalogueLoading(true); setCatalogueRetryKey((current) => current + 1); }} disabled={catalogueLoading}>{catalogueLoading ? "Checking database…" : "Retry connection"}</button>}
            </div>
            <ul className="category-management-list">
              {categories.map((category) => {
                const categoryKey = category.toLowerCase();
                const isDefault = productCategories.some((item) => item.toLowerCase() === categoryKey);
                const productCount = products.filter((product) => product.category.toLowerCase() === categoryKey).length;
                const isRemoving = categoryRemoving === category;
                const status = isDefault
                  ? productCount ? `Default · ${productCount} ${productCount === 1 ? "product" : "products"}` : "Default"
                  : productCount ? `${productCount} ${productCount === 1 ? "product" : "products"}` : "Custom";
                return <li className="category-management-item" key={category}>
                  <div className="category-management-copy">
                    <span className="category-management-name">{category}</span>
                    <span className={`category-management-status${isDefault ? " default" : productCount ? " in-use" : ""}`}>{status}</span>
                  </div>
                  <button
                    className="category-remove-button"
                    type="button"
                    onClick={() => requestCategoryRemoval(category)}
                    disabled={!databaseReady || categorySaving || Boolean(categoryRemoving)}
                    aria-label={`Remove ${category} category`}
                    title={productCount ? `Move ${productCount} ${productCount === 1 ? "product" : "products"} and remove ${category}` : `Remove ${category}`}
                  >
                    {isRemoving ? "…" : <DeleteOutlineIcon fontSize="small" />}
                  </button>
                </li>;
              })}
            </ul>
          </div>
        </details>
        {categoryRemoval && (() => {
          const categoryKey = categoryRemoval.name.toLowerCase();
          const productsToMove = products.filter((product) => product.category.toLowerCase() === categoryKey);
          const destinationCategories = categories.filter((category) => category.toLowerCase() !== categoryKey);
          return <div className="category-removal-backdrop">
            <section
              className="category-removal-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="category-removal-title"
              aria-describedby="category-removal-description"
            >
              <div className="category-removal-heading">
                <h3 id="category-removal-title">Remove {categoryRemoval.name}?</h3>
                <button
                  type="button"
                  className="category-removal-close"
                  aria-label="Close category removal"
                  onClick={() => setCategoryRemoval(null)}
                  disabled={Boolean(categoryRemoving)}
                >×</button>
              </div>
              <p id="category-removal-description">
                {productsToMove.length > 0
                  ? `${productsToMove.length} ${productsToMove.length === 1 ? "product is" : "products are"} currently in this category. Choose where to move ${productsToMove.length === 1 ? "it" : "them"} before removing the category.`
                  : "This category has no products and will be removed from the storefront filters."}
              </p>
              {productsToMove.length > 0 && <label className="category-removal-label" htmlFor="category-removal-destination">Move products to</label>}
              {productsToMove.length > 0 && <select
                id="category-removal-destination"
                className="category-removal-select"
                value={categoryRemoval.replacementCategory}
                onChange={(event) => setCategoryRemoval((current) => current
                  ? { ...current, replacementCategory: event.target.value }
                  : current)}
              >
                {destinationCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>}
              <div className="category-removal-actions">
                <button type="button" onClick={() => setCategoryRemoval(null)} disabled={Boolean(categoryRemoving)}>Cancel</button>
                <button
                  type="button"
                  className="confirm"
                  onClick={removeCategory}
                  disabled={Boolean(categoryRemoving) || (productsToMove.length > 0 && !categoryRemoval.replacementCategory)}
                >
                  {categoryRemoving ? "Removing…" : productsToMove.length > 0 ? "Move products & remove" : "Remove category"}
                </button>
              </div>
            </section>
          </div>;
        })()}
        <details className="catalog-dropdown admin-dropdown-card">
          <summary className="admin-dropdown-summary" tabIndex={-1}><span>Browse and manage products</span><span className="catalog-dropdown-count">{products.length}</span><button className="admin-dropdown-toggle" type="button" aria-label="Expand product catalogue" aria-expanded="false" aria-controls="catalog-dropdown-content" data-dropdown-label="product catalogue" onClick={toggleAdminDropdown}><span className="admin-dropdown-chevron" aria-hidden="true" /></button></summary>
          <div className="catalog-list" id="catalog-dropdown-content">{products.map((product) => <article key={product.id} className="catalog-item">
            <div className="catalog-item-overview">
              <span className="catalog-image" style={{ backgroundImage: `url(${product.image})` }} />
              <div className="catalog-item-details"><h3>{product.name}</h3><p>{product.category} <i>·</i> {product.size}</p><small>{product.stockQuantity} {product.stockQuantity === 1 ? "item" : "items"} available</small></div>
              <button className="catalog-remove-button" type="button" onClick={() => deleteProduct(product)} aria-label={`Remove ${product.name}`}>Remove</button>
            </div>
            <div className="catalog-editors">
              <div className="catalog-category-editor"><label htmlFor={`category-${product.id}`}>Category</label><select id={`category-${product.id}`} aria-label={`Category for ${product.name}`} value={productCategoryDrafts[product.id] ?? product.category} onChange={(event) => setProductCategoryDrafts((current) => ({ ...current, [product.id]: event.target.value }))}>{categories.map((category) => <option key={category}>{category}</option>)}</select></div>
              <div className="catalog-name-editor"><label htmlFor={`name-${product.id}`}>Product name</label><div><input id={`name-${product.id}`} aria-label={`Name for ${product.name}`} maxLength={200} value={nameDrafts[product.id] ?? product.name} onChange={(event) => setNameDrafts((current) => ({ ...current, [product.id]: event.target.value }))} /></div></div>
              <div className="catalog-price-editor"><label htmlFor={`price-${product.id}`}>Price (GHS)</label><div><input id={`price-${product.id}`} aria-label={`Price for ${product.name} in Ghana cedis`} type="number" min="0.01" step="0.01" required value={priceDrafts[product.id] ?? String(product.price)} onChange={(event) => setPriceDrafts((current) => ({ ...current, [product.id]: event.target.value }))} /></div></div>
              <div className="catalog-stock-editor"><label htmlFor={`stock-${product.id}`}>Stock quantity</label><input id={`stock-${product.id}`} aria-label={`Stock quantity for ${product.name}`} type="number" min="0" max="2147483647" step="1" required value={stockDrafts[product.id] ?? String(product.stockQuantity)} onChange={(event) => setStockDrafts((current) => ({ ...current, [product.id]: event.target.value }))} /></div>
              <button className="catalog-save-button" type="button" onClick={() => saveProduct(product)} disabled={Boolean(savingProductIds[product.id])}>{savingProductIds[product.id] ? "Saving…" : "Save changes"}</button>
            </div>
          </article>)}</div>
        </details>
      </section>
    </section>
    {message && databaseReady && <div className="admin-toast" role="status">✓ {message}</div>}
  </main>;
}
