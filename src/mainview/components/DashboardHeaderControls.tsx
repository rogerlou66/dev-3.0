import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { useContainerWidth } from "../hooks/useContainerWidth";
import { useNarrowViewport } from "../hooks/useNarrowViewport";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface Props {
	surface: "board" | "projects";
	onSurfaceChange: (surface: "board" | "projects") => void;
	query: string;
	onQueryChange: (query: string) => void;
	disabled?: boolean;
}

function SearchIcon() {
	return <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
}

export default function DashboardHeaderControls({ surface, onSurfaceChange, query, onQueryChange, disabled = false }: Props) {
	const t = useT();
	const rootRef = useRef<HTMLElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const width = useContainerWidth(rootRef);
	const narrow = useNarrowViewport(768);
	const compactSearch = narrow || (width > 0 && width < 420);
	const [searchOpen, setSearchOpen] = useState(false);
	const showSearch = searchOpen && compactSearch && surface === "board" && !disabled;

	function closeSearch(restoreFocus = false) {
		setSearchOpen(false);
		if (restoreFocus) triggerRef.current?.focus();
	}
	useEscapeKey(() => closeSearch(true), { enabled: showSearch });
	useEffect(() => {
		if (!compactSearch && searchOpen && !disabled && surface === "board") inputRef.current?.focus();
		if (!compactSearch || surface !== "board" || disabled) setSearchOpen(false);
	}, [compactSearch, surface, disabled, searchOpen]);
	useEffect(() => {
		if (!showSearch) return;
		inputRef.current?.focus();
		function onPointerDown(event: PointerEvent) {
			if (!rootRef.current?.contains(event.target as Node)) setSearchOpen(false);
		}
		document.addEventListener("pointerdown", onPointerDown, true);
		return () => document.removeEventListener("pointerdown", onPointerDown, true);
	}, [showSearch]);

	const input = <input ref={inputRef} aria-label={t("workspaceBoard.search")} value={query}
		onChange={(event) => onQueryChange(event.target.value)} placeholder={t("workspaceBoard.search")}
		className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none" />;

	return (
		<nav ref={rootRef} aria-label={t("dashboard.views")} className="flex min-w-0 flex-1 items-center gap-1.5" data-help-id="header.dashboardViews">
			<div className="flex min-w-0 shrink items-center rounded-md bg-base/50 p-0.5">
				{(["board", "projects"] as const).map((view) => (
					<button key={view} type="button" onClick={() => { closeSearch(); onSurfaceChange(view); }}
						aria-current={surface === view ? "page" : undefined}
						className={`min-h-7 min-w-0 truncate rounded px-2 text-xs font-semibold transition-colors motion-safe:active:scale-[0.96] ${surface === view ? "bg-elevated text-fg" : "text-fg-3 hover:bg-raised-hover hover:text-fg"}`}>
						{t(view === "board" ? "dashboard.tabBoard" : "dashboard.tabProjects")}
					</button>
				))}
			</div>
			{surface === "board" && (compactSearch ? (
				<button ref={triggerRef} type="button" aria-label={t("workspaceBoard.search")} title={t("workspaceBoard.search")}
					aria-expanded={showSearch} aria-haspopup="dialog" onClick={() => setSearchOpen((open) => !open)}
					className={`ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-elevated ${query ? "bg-accent/10 text-accent" : "text-fg-3"}`}>
					<SearchIcon />
					{query && <span className="sr-only">{query}</span>}
				</button>
			) : <div className="ml-auto flex h-8 min-w-0 max-w-sm flex-1 items-center gap-2 rounded-md border border-edge bg-base/50 px-2 text-fg-3 focus-within:border-accent"><SearchIcon />{input}</div>)}
			{showSearch && (
				<div role="dialog" aria-label={t("workspaceBoard.search")} className="absolute right-2 top-full z-50 mt-1 flex w-96 max-w-[calc(100vw-1rem)] items-center gap-2 rounded-lg bg-overlay p-2 text-fg-3 shadow-xl"
					onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node) && event.relatedTarget !== triggerRef.current) closeSearch(); }}>
					<SearchIcon />{input}
					<button type="button" onClick={() => closeSearch(true)} aria-label={t("task.close")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-elevated">×</button>
				</div>
			)}
		</nav>
	);
}
