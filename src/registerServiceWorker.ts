export function registerServiceWorker() {
	if (import.meta.env.DEV) return;
	if (!("serviceWorker" in navigator)) return;

	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/service-worker.js").catch(() => {
			// A failed registration should never block the reading app itself.
		});
	});
}
