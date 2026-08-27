/**
 * Report every observed element as visible, for tests of components that defer
 * work until they intersect the viewport (Streamdown holds Mermaid back that
 * way). happy-dom ships an IntersectionObserver that never intersects.
 *
 * Deliberately opt-in per test file rather than installed globally: components
 * that page in content on intersection (Changelog day groups, TaskDiffViewer)
 * would render everything at once and their batching assertions would be moot.
 */
export function installImmediateIntersectionObserver() {
	class ImmediateIntersectionObserver {
		private readonly callback: IntersectionObserverCallback;

		constructor(callback: IntersectionObserverCallback) {
			this.callback = callback;
		}

		observe(target: Element) {
			this.callback(
				[{ isIntersecting: true, target } as IntersectionObserverEntry],
				this as unknown as IntersectionObserver,
			);
		}

		unobserve() {}
		disconnect() {}
		takeRecords() { return []; }
		root = null;
		rootMargin = "0px";
		thresholds = [0];
	}

	for (const target of [globalThis, globalThis.window].filter(Boolean)) {
		Object.defineProperty(target, "IntersectionObserver", {
			configurable: true,
			writable: true,
			value: ImmediateIntersectionObserver,
		});
	}
}
