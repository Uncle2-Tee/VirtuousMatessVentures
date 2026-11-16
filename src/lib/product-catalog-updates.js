const channelName = "virtuous-matess-ventures-product-catalog-updates";
const localEventName = "virtuous-matess-ventures:catalog-updated";

export function notifyProductCatalogUpdate() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(localEventName));
  }
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({ type: "catalog-updated" });
    channel.close();
  }
}

export function subscribeToProductCatalogUpdates(listener) {
  const handleLocalUpdate = () => listener();
  if (typeof window !== "undefined") {
    window.addEventListener(localEventName, handleLocalUpdate);
  }
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(channelName);
  if (channel) {
    channel.onmessage = (event) => {
      if (event.data?.type === "catalog-updated") listener();
    };
  }
  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener(localEventName, handleLocalUpdate);
    }
    if (channel) channel.close();
  };
}
