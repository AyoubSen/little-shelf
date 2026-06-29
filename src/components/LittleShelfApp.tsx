import {
	Show,
	SignInButton,
	SignUpButton,
	UserButton,
	useUser,
} from "@clerk/tanstack-react-start";
import {
	BookOpen,
	Dice5,
	Library,
	NotebookPen,
	Plus,
	Search,
	Settings,
	Sparkles,
	Star,
	Trash2,
} from "lucide-react";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { getShelf, saveShelf } from "../server/shelf";
import {
	type Book,
	type BookStatus,
	coverColorOptions,
	coverColors,
	emptyReflection,
	energyLabels,
	energyMap,
	type MoodTag,
	moodTags,
	statusLabels,
} from "./bookData";
import {
	dedupeBooks,
	loadBooks,
	parseBooksJson,
	serializeShelfBackup,
	storageKey,
} from "./bookStorage";

const themeStorageKey = "little-shelf-theme";
const focusedReadingStorageKey = "little-shelf-focused-reading";
const tabs = ["Now", "Shelf", "Pick", "Journal"] as const;
type Tab = (typeof tabs)[number];
const themes = ["paper", "moss", "plum", "night"] as const;
type ThemeName = (typeof themes)[number];
type ShelfFilter = "all" | BookStatus;
type DiscoveryMode = "mood" | "author";
type CloudStatus =
	| "local"
	| "loading"
	| "saving"
	| "synced"
	| "conflict"
	| "error";

const cloudStatusLabels: Record<CloudStatus, string> = {
	local: "Local only",
	loading: "Loading cloud shelf",
	saving: "Saving",
	synced: "Cloud synced",
	conflict: "Sync needed",
	error: "Sync paused",
};

type CloudSyncDetails = {
	isLoaded: boolean;
	isSignedIn: boolean;
	status: CloudStatus;
	message: string;
	lastSyncedAt: string | null;
	onSyncNow: () => void;
};

type MigrationChoice = {
	cloudBooks: Book[];
	localBooks: Book[];
	mergedBooks: Book[];
};

type BookDraft = {
	title: string;
	author: string;
	coverUrl: string;
	status: BookStatus;
	moodTags: MoodTag[];
	totalPages: string;
	currentPage: string;
	coverColor: string;
};

type OpenLibraryDoc = {
	key?: string;
	title?: string;
	title_suggest?: string;
	author_name?: string[];
	cover_i?: number;
	language?: string[];
	number_of_pages_median?: number;
	first_publish_year?: number;
};

type OpenLibrarySearchResponse = {
	docs?: OpenLibraryDoc[];
};

type OpenLibrarySubjectWork = {
	key?: string;
	title?: string;
	authors?: { name?: string }[];
	cover_id?: number;
	first_publish_year?: number;
};

type OpenLibrarySubjectResponse = {
	works?: OpenLibrarySubjectWork[];
};

type OpenLibraryEdition = {
	title?: string;
	number_of_pages?: number;
	pagination?: string;
};

type OpenLibraryEditionsResponse = {
	entries?: OpenLibraryEdition[];
};

type OpenLibraryResult = {
	key: string;
	title: string;
	author: string;
	coverUrl?: string;
	pageCount?: number;
	year?: number;
};

const blankDraft: BookDraft = {
	title: "",
	author: "",
	coverUrl: "",
	status: "want",
	moodTags: [],
	totalPages: "",
	currentPage: "",
	coverColor: coverColors[0],
};

export function LittleShelfApp() {
	const { isLoaded, isSignedIn } = useUser();
	const [books, setBooks] = useState<Book[]>(() => loadBooks());
	const [activeTab, setActiveTab] = useState<Tab>("Shelf");
	const [draft, setDraft] = useState<BookDraft>(blankDraft);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [isBookSheetOpen, setIsBookSheetOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [finishingBookId, setFinishingBookId] = useState<string | null>(null);
	const [energy, setEnergy] = useState(energyLabels[0]);
	const [pickIndex, setPickIndex] = useState(0);
	const [theme, setTheme] = useState<ThemeName>(() => loadTheme());
	const [toast, setToast] = useState("");
	const [lastDiscoveryMoodBookId, setLastDiscoveryMoodBookId] = useState<
		string | null
	>(null);
	const [focusedReadingId, setFocusedReadingId] = useState<string | null>(() =>
		loadFocusedReadingId(),
	);
	const [cloudStatus, setCloudStatus] = useState<CloudStatus>("local");
	const [cloudMessage, setCloudMessage] = useState(
		"Sign in to back up this shelf across devices.",
	);
	const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
	const [migrationChoice, setMigrationChoice] =
		useState<MigrationChoice | null>(null);
	const toastTimerRef = useRef<number | null>(null);
	const booksRef = useRef<Book[]>(books);
	const hasLoadedCloudShelfRef = useRef(false);
	const lastKnownCloudUpdatedAtRef = useRef<string | null>(null);
	const cloudSaveTimerRef = useRef<number | null>(null);
	const cloudSaveVersionRef = useRef(0);
	const skipNextAutoSaveRef = useRef(false);

	const notify = useCallback((message: string) => {
		setToast(message);
		if (toastTimerRef.current) {
			window.clearTimeout(toastTimerRef.current);
		}
		toastTimerRef.current = window.setTimeout(() => setToast(""), 2200);
	}, []);

	const saveBooksToCloud = useCallback(
		async (
			nextBooks: Book[],
			{
				isCurrent = () => true,
				saveVersion,
			}: {
				isCurrent?: () => boolean;
				saveVersion?: number;
			} = {},
		) => {
			setCloudStatus("saving");
			setCloudMessage("Saving your latest shelf changes...");

			try {
				const result = await saveShelf({
					data: {
						books: nextBooks,
					},
				});

				if (!isCurrent()) return;
				if (saveVersion && cloudSaveVersionRef.current !== saveVersion) return;

				if (!result.ok) {
					setCloudStatus(result.reason === "conflict" ? "conflict" : "error");
					setCloudMessage(result.message);
					return;
				}

				lastKnownCloudUpdatedAtRef.current = result.updatedAt;
				setCloudStatus("synced");
				setCloudMessage("Cloud backup is up to date.");
				setLastSyncedAt(new Date().toISOString());
			} catch {
				if (!isCurrent()) return;
				if (saveVersion && cloudSaveVersionRef.current !== saveVersion) return;
				setCloudStatus("error");
				setCloudMessage(
					"Could not save to cloud. Your local shelf is still here.",
				);
			}
		},
		[],
	);

	const loadCloudShelf = useCallback(
		async ({
			isCurrent = () => true,
			notifyWhenDone = false,
		}: {
			isCurrent?: () => boolean;
			notifyWhenDone?: boolean;
		} = {}) => {
			setCloudStatus("loading");
			setCloudMessage("Checking your cloud shelf...");

			try {
				const result = await getShelf();
				if (!isCurrent()) return;

				if (!result.ok) {
					setCloudStatus(result.reason === "conflict" ? "conflict" : "error");
					setCloudMessage(result.message);
					return;
				}

				lastKnownCloudUpdatedAtRef.current = result.updatedAt;
				const cloudBooks = sortBooksByAddedAt(dedupeBooks(result.books));
				const localBooks = sortBooksByAddedAt(dedupeBooks(booksRef.current));
				const shouldUploadLocalBooks =
					cloudBooks.length === 0 && localBooks.length > 0;

				hasLoadedCloudShelfRef.current = true;

				if (shouldUploadLocalBooks) {
					await saveBooksToCloud(localBooks, { isCurrent });
					if (notifyWhenDone && isCurrent()) notify("Shelf synced");
					return;
				}

				if (!areBooksEqual(result.books, cloudBooks)) {
					await saveBooksToCloud(cloudBooks, { isCurrent });
				}

				if (!areBooksEqual(localBooks, cloudBooks)) {
					setMigrationChoice({
						cloudBooks,
						localBooks,
						mergedBooks: sortBooksByAddedAt(
							dedupeBooks([...cloudBooks, ...localBooks]),
						),
					});
					setCloudStatus("conflict");
					setCloudMessage("Choose how to handle books saved on this device.");
					return;
				}

				if (!areBooksEqual(booksRef.current, cloudBooks)) {
					skipNextAutoSaveRef.current = true;
					setBooks(cloudBooks);
				}

				setCloudStatus("synced");
				setCloudMessage("Cloud backup is up to date.");
				setLastSyncedAt(new Date().toISOString());
				if (notifyWhenDone) notify("Shelf already synced");
			} catch {
				if (!isCurrent()) return;
				setCloudStatus("error");
				setCloudMessage("Could not reach cloud sync. Try again in a moment.");
			}
		},
		[notify, saveBooksToCloud],
	);

	const syncNow = useCallback(() => {
		if (!isLoaded) return;
		if (!isSignedIn) {
			notify("Sign in to sync your shelf");
			return;
		}

		if (cloudSaveTimerRef.current) {
			window.clearTimeout(cloudSaveTimerRef.current);
			cloudSaveTimerRef.current = null;
		}

		if (hasLoadedCloudShelfRef.current) {
			saveBooksToCloud(booksRef.current).then(() => notify("Shelf synced"));
			return;
		}

		loadCloudShelf({ notifyWhenDone: true });
	}, [isLoaded, isSignedIn, loadCloudShelf, notify, saveBooksToCloud]);

	useEffect(() => {
		window.localStorage.setItem(storageKey, JSON.stringify(books));
	}, [books]);

	useEffect(() => {
		booksRef.current = books;
	}, [books]);

	useEffect(() => {
		document.documentElement.dataset.theme = theme;
		window.localStorage.setItem(themeStorageKey, theme);
	}, [theme]);

	useEffect(() => {
		if (focusedReadingId) {
			window.localStorage.setItem(focusedReadingStorageKey, focusedReadingId);
		} else {
			window.localStorage.removeItem(focusedReadingStorageKey);
		}
	}, [focusedReadingId]);

	useEffect(() => {
		if (!isLoaded) return;

		if (!isSignedIn) {
			hasLoadedCloudShelfRef.current = false;
			lastKnownCloudUpdatedAtRef.current = null;
			setCloudStatus("local");
			setCloudMessage("Sign in to back up this shelf across devices.");
			setLastSyncedAt(null);
			if (cloudSaveTimerRef.current) {
				window.clearTimeout(cloudSaveTimerRef.current);
				cloudSaveTimerRef.current = null;
			}
			return;
		}

		let isCurrent = true;
		loadCloudShelf({ isCurrent: () => isCurrent });

		return () => {
			isCurrent = false;
		};
	}, [isLoaded, isSignedIn, loadCloudShelf]);

	useEffect(() => {
		if (!isLoaded || !isSignedIn || !hasLoadedCloudShelfRef.current) return;
		if (skipNextAutoSaveRef.current) {
			skipNextAutoSaveRef.current = false;
			return;
		}

		if (cloudSaveTimerRef.current) {
			window.clearTimeout(cloudSaveTimerRef.current);
		}

		setCloudStatus("saving");
		setCloudMessage("Saving your latest shelf changes...");
		const saveVersion = cloudSaveVersionRef.current + 1;
		cloudSaveVersionRef.current = saveVersion;
		cloudSaveTimerRef.current = window.setTimeout(() => {
			saveBooksToCloud(books, { saveVersion });
		}, 800);

		return () => {
			if (cloudSaveTimerRef.current) {
				window.clearTimeout(cloudSaveTimerRef.current);
				cloudSaveTimerRef.current = null;
			}
		};
	}, [books, isLoaded, isSignedIn, saveBooksToCloud]);

	const readingBooks = sortReadingBooks(
		books.filter((book) => book.status === "reading"),
	);
	const focusedReadingBook =
		readingBooks.find((book) => book.id === focusedReadingId) ??
		readingBooks[0];
	const orderedReadingBooks = focusedReadingBook
		? [
				focusedReadingBook,
				...readingBooks.filter((book) => book.id !== focusedReadingBook.id),
			]
		: [];
	const finishedBooks = books.filter((book) => book.status === "finished");
	const recommendationPool = books.filter(
		(book) => book.status === "want" || book.status === "paused",
	);
	const picks = useMemo(
		() => rankBooks(recommendationPool, energy),
		[recommendationPool, energy],
	);
	const pickedBook = picks[pickIndex % Math.max(picks.length, 1)];
	const isEditing = editingId !== null;

	function openAddBook(status: BookStatus = "want") {
		setActiveTab("Shelf");
		setDraft({ ...blankDraft, status });
		setEditingId(null);
		setIsBookSheetOpen(true);
	}

	function useCloudShelf() {
		if (!migrationChoice) return;
		skipNextAutoSaveRef.current = true;
		setBooks(migrationChoice.cloudBooks);
		setMigrationChoice(null);
		setCloudStatus("synced");
		setCloudMessage("Cloud backup is up to date.");
		setLastSyncedAt(new Date().toISOString());
		notify("Using cloud shelf");
	}

	async function mergeDeviceShelf() {
		if (!migrationChoice) return;
		const nextBooks = migrationChoice.mergedBooks;
		setBooks(nextBooks);
		setMigrationChoice(null);
		await saveBooksToCloud(nextBooks);
		notify("Device books merged");
	}

	function exportLocalShelf() {
		if (!migrationChoice) return;
		exportBooksBackup(migrationChoice.localBooks, "little-shelf-local-backup");
		notify("Local backup exported");
	}

	function replaceBooks(nextBooks: Book[]) {
		setMigrationChoice(null);
		setBooks(nextBooks);
		notify(
			`Imported ${nextBooks.length} ${nextBooks.length === 1 ? "book" : "books"}`,
		);
	}

	function closeBookSheet() {
		setDraft(blankDraft);
		setEditingId(null);
		setIsBookSheetOpen(false);
	}

	function saveDraft() {
		if (!draft.title.trim() || !draft.author.trim()) return;
		const wasEditing = editingId !== null;
		const totalPages = Number(draft.totalPages) || 0;
		const currentPage = Number(draft.currentPage) || 0;
		const progress =
			totalPages > 0
				? { currentPage: Math.min(currentPage, totalPages), totalPages }
				: undefined;

		if (editingId) {
			setMigrationChoice(null);
			setBooks((current) =>
				current.map((book) =>
					book.id === editingId
						? {
								...book,
								title: draft.title.trim(),
								author: draft.author.trim(),
								coverUrl: draft.coverUrl.trim() || undefined,
								coverColor: draft.coverColor,
								status: draft.status,
								moodTags: draft.moodTags,
								progress,
								startedAt:
									draft.status === "reading"
										? (book.startedAt ?? new Date().toISOString())
										: book.startedAt,
								finishedAt:
									draft.status === "finished"
										? (book.finishedAt ?? new Date().toISOString())
										: book.finishedAt,
							}
						: book,
				),
			);
		} else {
			setMigrationChoice(null);
			setBooks((current) => [
				{
					id: crypto.randomUUID(),
					title: draft.title.trim(),
					author: draft.author.trim(),
					coverUrl: draft.coverUrl.trim() || undefined,
					coverColor: draft.coverColor,
					status: draft.status,
					moodTags: draft.moodTags,
					progress,
					addedAt: new Date().toISOString(),
					startedAt:
						draft.status === "reading" ? new Date().toISOString() : undefined,
					finishedAt:
						draft.status === "finished" ? new Date().toISOString() : undefined,
				},
				...current,
			]);
		}

		setDraft(blankDraft);
		setEditingId(null);
		setIsBookSheetOpen(false);
		notify(wasEditing ? "Book updated" : "Book added");
	}

	function saveDiscovery(result: OpenLibraryResult) {
		const alreadySaved = books.some(
			(book) =>
				normalizeBookTitle(book.title) === normalizeBookTitle(result.title),
		);

		if (alreadySaved) {
			notify("Already on your shelf");
			return;
		}

		const id = crypto.randomUUID();

		setMigrationChoice(null);
		setBooks((current) => [
			{
				id,
				title: result.title,
				author: result.author,
				coverUrl: result.coverUrl,
				coverColor: coverColors[0],
				status: "want",
				moodTags: [],
				addedAt: new Date().toISOString(),
			},
			...current,
		]);
		setLastDiscoveryMoodBookId(id);
		notify("Saved to Want");
	}

	function updateBookMoods(id: string, moodTags: MoodTag[]) {
		updateBook(id, { moodTags });
	}

	function editBook(book: Book) {
		setActiveTab("Shelf");
		setEditingId(book.id);
		setDraft({
			title: book.title,
			author: book.author,
			coverUrl: book.coverUrl ?? "",
			status: book.status,
			moodTags: book.moodTags,
			totalPages: book.progress?.totalPages?.toString() ?? "",
			currentPage: book.progress?.currentPage?.toString() ?? "",
			coverColor: book.coverColor ?? coverColors[0],
		});
		setIsBookSheetOpen(true);
	}

	function updateBook(id: string, updates: Partial<Book>) {
		setBooks((current) =>
			current.map((book) => (book.id === id ? { ...book, ...updates } : book)),
		);
	}

	function changeStatus(book: Book, status: BookStatus) {
		if (book.status === status) return;
		updateBook(book.id, {
			status,
			startedAt:
				status === "reading"
					? (book.startedAt ?? new Date().toISOString())
					: book.startedAt,
			finishedAt:
				status === "finished"
					? (book.finishedAt ?? new Date().toISOString())
					: book.finishedAt,
		});

		if (status === "finished") {
			setFinishingBookId(book.id);
		}
		notify(`Moved to ${statusLabels[status]}`);
	}

	const finishingBook = books.find((book) => book.id === finishingBookId);
	const cloudSync: CloudSyncDetails = {
		isLoaded,
		isSignedIn: Boolean(isSignedIn),
		status: cloudStatus,
		message: cloudMessage,
		lastSyncedAt,
		onSyncNow: syncNow,
	};

	return (
		<main className="mx-auto min-h-dvh w-full max-w-5xl px-4 pb-28 pt-5 text-ink sm:px-6 lg:pb-10">
			<header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<p className="mb-2 text-[0.68rem] font-bold uppercase tracking-[0.26em] text-sage">
						Little Shelf
					</p>
					<h1 className="max-w-64 font-serif text-[2rem] font-semibold leading-[0.96] text-ink sm:max-w-none sm:text-4xl">
						Your quiet reading corner
					</h1>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
					<AuthControls cloudStatus={cloudStatus} />
					<ThemeChooser theme={theme} onTheme={setTheme} />
					<button
						aria-label="Open settings"
						className="tap rounded-full border border-[var(--theme-line)] bg-paper/70 px-3 py-2.5 text-sm font-bold text-sage shadow-soft"
						onClick={() => setIsSettingsOpen(true)}
						type="button"
					>
						<Settings className="size-4" />
					</button>
					<button
						className="tap rounded-full bg-burgundy px-4 py-2.5 text-sm font-bold text-paper shadow-soft"
						onClick={() => openAddBook()}
						type="button"
					>
						<Plus className="mr-1 inline size-4" /> Add
					</button>
				</div>
			</header>

			{activeTab === "Now" && (
				<NowScreen
					hasAnyBooks={books.length > 0}
					books={orderedReadingBooks}
					onAdd={() => openAddBook("reading")}
					onFinish={(book) => changeStatus(book, "finished")}
					onFocus={setFocusedReadingId}
					onPick={() => setActiveTab("Pick")}
					onUpdate={updateBook}
				/>
			)}
			{activeTab === "Shelf" && (
				<ShelfScreen
					books={books}
					onChangeStatus={changeStatus}
					onDelete={(id) =>
						setBooks((current) => current.filter((book) => book.id !== id))
					}
					onEdit={editBook}
					onNotify={notify}
					onOpenAdd={() => openAddBook()}
				/>
			)}
			{activeTab === "Pick" && (
				<PickScreen
					book={pickedBook}
					energy={energy}
					hasAnyBooks={books.length > 0}
					onAdd={() => openAddBook()}
					onEnergy={(value) => {
						setEnergy(value);
						setPickIndex(0);
					}}
					onSkip={() => setPickIndex((value) => value + 1)}
					onSaveDiscovery={saveDiscovery}
					onUpdateDiscoveryMoods={updateBookMoods}
					savedDiscoveryBook={
						books.find((book) => book.id === lastDiscoveryMoodBookId) ?? null
					}
					savedTitles={books.map((savedBook) => savedBook.title)}
				/>
			)}
			{activeTab === "Journal" && (
				<JournalScreen
					books={finishedBooks}
					hasAnyBooks={books.length > 0}
					onAdd={() => openAddBook()}
					onNotify={notify}
					onUpdate={updateBook}
				/>
			)}

			<nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--theme-line)] bg-cream/90 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 shadow-[0_-14px_30px_var(--theme-shadow)] backdrop-blur lg:left-1/2 lg:w-[28rem] lg:-translate-x-1/2 lg:rounded-t-3xl lg:border-x">
				<div className="grid grid-cols-4 gap-1">
					{tabs.map((tab) => (
						<button
							aria-current={activeTab === tab ? "page" : undefined}
							className={`tap rounded-2xl px-2 py-3 text-xs font-bold ${activeTab === tab ? "bg-sage text-paper" : "text-muted"}`}
							key={tab}
							onClick={() => setActiveTab(tab)}
							type="button"
						>
							{tabIcon(tab)}
							<span className="mt-1 block">{tab}</span>
						</button>
					))}
				</div>
			</nav>

			{isBookSheetOpen && (
				<BookSheet
					draft={draft}
					isEditing={isEditing}
					onCancel={closeBookSheet}
					onChangeDraft={setDraft}
					onSave={saveDraft}
				/>
			)}

			{isSettingsOpen && (
				<SettingsSheet
					books={books}
					cloudSync={cloudSync}
					onClose={() => setIsSettingsOpen(false)}
					onImport={replaceBooks}
					onNotify={notify}
				/>
			)}

			{finishingBook && (
				<FinishReflectionSheet
					book={finishingBook}
					onClose={(saved) => {
						setFinishingBookId(null);
						if (saved) notify("Memory saved");
					}}
					onUpdate={updateBook}
				/>
			)}

			{migrationChoice && (
				<ShelfMigrationSheet
					choice={migrationChoice}
					onExportLocal={exportLocalShelf}
					onMerge={mergeDeviceShelf}
					onUseCloud={useCloudShelf}
				/>
			)}

			<AppToast message={toast} />
		</main>
	);
}

function AuthControls({ cloudStatus }: { cloudStatus: CloudStatus }) {
	return (
		<div className="flex items-center gap-2">
			<Show when="signed-out">
				<SignInButton>
					<button
						className="tap rounded-full border border-[var(--theme-line)] bg-paper/70 px-3 py-2.5 text-sm font-bold text-sage shadow-soft"
						type="button"
					>
						Sign in
					</button>
				</SignInButton>
				<SignUpButton>
					<button
						className="tap rounded-full bg-ink px-3 py-2.5 text-sm font-bold text-paper shadow-soft"
						type="button"
					>
						Sign up
					</button>
				</SignUpButton>
			</Show>
			<Show when="signed-in">
				<span className="rounded-full border border-[var(--theme-line)] bg-paper/70 px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.16em] text-muted shadow-soft">
					{cloudStatusLabels[cloudStatus]}
				</span>
				<div className="rounded-full border border-[var(--theme-line)] bg-paper/70 p-1 shadow-soft">
					<UserButton />
				</div>
			</Show>
		</div>
	);
}

function ShelfMigrationSheet({
	choice,
	onExportLocal,
	onMerge,
	onUseCloud,
}: {
	choice: MigrationChoice;
	onExportLocal: () => void;
	onMerge: () => void;
	onUseCloud: () => void;
}) {
	return (
		<div className="fixed inset-0 z-30 flex items-end bg-ink/35 px-3 pt-12 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
			<section className="surface relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.75rem] p-5 sm:max-w-xl sm:rounded-[1.75rem] sm:p-6">
				<div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/15 sm:hidden" />
				<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
					Shelf sync
				</p>
				<h2 className="mt-1 font-serif text-3xl leading-none text-ink">
					This device has different books.
				</h2>
				<p className="mt-3 text-sm leading-6 text-muted">
					Your cloud shelf has {choice.cloudBooks.length}{" "}
					{choice.cloudBooks.length === 1 ? "book" : "books"}. This device has{" "}
					{choice.localBooks.length}. Choose what to keep before syncing.
				</p>

				<div className="mt-5 grid gap-3">
					<button
						className="tap rounded-[1.25rem] bg-sage px-5 py-3 text-left font-bold text-paper"
						onClick={onUseCloud}
						type="button"
					>
						Use cloud shelf
						<span className="mt-1 block text-xs font-semibold text-paper/75">
							Replace this device with the cloud copy.
						</span>
					</button>
					<button
						className="tap rounded-[1.25rem] bg-burgundy px-5 py-3 text-left font-bold text-paper"
						onClick={onMerge}
						type="button"
					>
						Merge this device
						<span className="mt-1 block text-xs font-semibold text-paper/75">
							Save {choice.mergedBooks.length}{" "}
							{choice.mergedBooks.length === 1 ? "book" : "books"} to cloud
							after removing duplicates.
						</span>
					</button>
					<button
						className="tap rounded-[1.25rem] border border-[var(--theme-line)] bg-[var(--theme-surface-muted)] px-5 py-3 text-left font-bold text-ink"
						onClick={onExportLocal}
						type="button"
					>
						Export local backup
						<span className="mt-1 block text-xs font-semibold text-muted">
							Download this device's books before choosing.
						</span>
					</button>
				</div>
			</section>
		</div>
	);
}

function areBooksEqual(firstBooks: Book[], secondBooks: Book[]) {
	return JSON.stringify(firstBooks) === JSON.stringify(secondBooks);
}

function sortBooksByAddedAt(books: Book[]) {
	return [...books].sort((firstBook, secondBook) => {
		return getBookTime(secondBook) - getBookTime(firstBook);
	});
}

function exportBooksBackup(books: Book[], filePrefix = "little-shelf-backup") {
	const backup = serializeShelfBackup(books);
	const blob = new Blob([backup], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.json`;
	link.click();
	URL.revokeObjectURL(url);
}

function RatingControl({
	rating,
	onRate,
}: {
	rating?: number;
	onRate: (rating?: number) => void;
}) {
	return (
		<div className="mt-2 flex flex-wrap items-center gap-2">
			<div className="flex rounded-full border border-[var(--theme-line)] bg-[var(--theme-surface-muted)] p-1">
				{[1, 2, 3, 4, 5].map((value) => {
					const isActive = Boolean(rating && value <= rating);
					return (
						<button
							aria-label={`Rate ${value} out of 5`}
							aria-pressed={rating === value}
							className={`tap rating-star ${isActive ? "rating-star-on" : ""}`}
							key={value}
							onClick={() => onRate(rating === value ? undefined : value)}
							type="button"
						>
							<Star
								className="size-4"
								fill={isActive ? "currentColor" : "none"}
							/>
						</button>
					);
				})}
			</div>
			<span className="text-xs font-bold text-muted">
				{rating ? `${rating}/5` : "No rating"}
			</span>
		</div>
	);
}

function RatingPill({ rating }: { rating: number }) {
	return (
		<span className="inline-flex items-center gap-1 rounded-full bg-[var(--theme-strong-soft)] px-2.5 py-1 text-[0.68rem] font-bold text-burgundy">
			<Star className="size-3" fill="currentColor" />
			{rating}/5
		</span>
	);
}

function getBookTime(book: Book) {
	return new Date(book.addedAt).getTime() || 0;
}

function NowScreen({
	hasAnyBooks,
	books,
	onAdd,
	onFinish,
	onFocus,
	onPick,
	onUpdate,
}: {
	hasAnyBooks: boolean;
	books: Book[];
	onAdd: () => void;
	onFinish: (book: Book) => void;
	onFocus: (bookId: string) => void;
	onPick: () => void;
	onUpdate: (id: string, updates: Partial<Book>) => void;
}) {
	if (books.length === 0) {
		if (!hasAnyBooks) {
			return (
				<EmptyState
					actionLabel="Add your first book"
					description="Start with one book you are reading, want to read, or keep thinking about. Little Shelf gets useful once it has a few real titles from your life."
					eyebrow="Blank shelf"
					onAction={onAdd}
					title="Begin with one book."
				/>
			);
		}

		return (
			<section className="surface page-marker p-6 pl-7">
				<p className="text-xs font-bold uppercase tracking-[0.24em] text-sage">
					No open book right now
				</p>
				<h2 className="mt-3 max-w-xl font-serif text-3xl leading-none text-ink">
					Nothing is asking for your bookmark today.
				</h2>
				<p className="mt-3 max-w-xl text-sm leading-6 text-muted">
					Choose from Want or Paused when you are ready. The shelf can make a
					low-pressure suggestion without turning it into homework.
				</p>
				<button
					className="tap mt-6 rounded-full bg-sage px-5 py-3 font-bold text-paper"
					onClick={onPick}
					type="button"
				>
					Open Pick
				</button>
			</section>
		);
	}

	const [featuredBook, ...otherBooks] = books;
	const progress = getProgressPercent(featuredBook);
	const pagesLeft = featuredBook.progress
		? Math.max(
				featuredBook.progress.totalPages - featuredBook.progress.currentPage,
				0,
			)
		: null;
	const isReadyToFinish = Boolean(featuredBook.progress && progress >= 100);

	function updateProgress(book: Book, currentPage: number) {
		if (!book.progress) return;
		onUpdate(book.id, {
			progress: {
				currentPage: Math.min(currentPage, book.progress.totalPages),
				totalPages: book.progress.totalPages,
			},
		});
	}

	function updateFeeling(book: Book, feeling: string) {
		onUpdate(book.id, {
			reflection: {
				...(book.reflection ?? emptyReflection),
				feeling,
			},
		});
	}

	return (
		<section className="space-y-5">
			<div className="surface page-marker p-5 pl-7">
				<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
					{books.length} current {books.length === 1 ? "read" : "reads"}
				</p>
				<h2 className="mt-2 font-serif text-3xl leading-none text-ink">
					Today’s open book.
				</h2>
				<p className="mt-3 max-w-xl text-sm leading-6 text-muted">
					Keep one book close, and let the rest wait quietly nearby.
				</p>
			</div>

			<div className="surface page-marker overflow-hidden p-0">
				<div className="grid gap-5 p-5 pl-7 sm:grid-cols-[11rem_1fr]">
					<BookCover book={featuredBook} large />
					<div>
						<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
							Bookmark is here
						</p>
						<h3 className="mt-1 font-serif text-3xl leading-none text-ink">
							{featuredBook.title}
						</h3>
						<p className="mt-1 text-muted">{featuredBook.author}</p>
						{featuredBook.progress && (
							<>
								<div className="mt-5 grid gap-2 rounded-[1.35rem] bg-[var(--theme-surface-muted)] p-4">
									<div className="flex items-end justify-between gap-3">
										<div>
											<p className="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-muted">
												Progress
											</p>
											<p className="mt-1 font-serif text-2xl leading-none text-ink">
												Page {featuredBook.progress.currentPage}
											</p>
										</div>
										<p className="rounded-full bg-[var(--theme-accent-soft)] px-3 py-1 text-xs font-bold text-sage">
											{progress}%
										</p>
									</div>
									<div className="h-3 overflow-hidden rounded-full bg-[var(--theme-accent-soft)]">
										<div
											className="h-full rounded-full bg-burgundy"
											style={{ width: `${progress}%` }}
										/>
									</div>
									<p className="text-xs font-bold text-muted">
										{pagesLeft === 0
											? "Ready to be finished."
											: `${pagesLeft} pages left of ${featuredBook.progress.totalPages}.`}
									</p>
								</div>
								<label className="mt-4 block text-sm font-bold text-ink">
									Current page
									<input
										className="field mt-2"
										min="0"
										max={featuredBook.progress.totalPages}
										type="number"
										value={featuredBook.progress.currentPage}
										onChange={(event) =>
											updateProgress(featuredBook, Number(event.target.value))
										}
									/>
								</label>
								{isReadyToFinish && (
									<button
										className="tap mt-4 rounded-full bg-burgundy px-5 py-3 text-sm font-bold text-paper"
										onClick={() => onFinish(featuredBook)}
										type="button"
									>
										Finish book
									</button>
								)}
							</>
						)}
						<label className="mt-5 block text-sm font-bold text-ink">
							A quick feeling
							<textarea
								className="field mt-2 min-h-28"
								placeholder="What is this book doing to your mood?"
								value={featuredBook.reflection?.feeling ?? ""}
								onChange={(event) =>
									updateFeeling(featuredBook, event.target.value)
								}
							/>
						</label>
					</div>
				</div>
			</div>

			{otherBooks.length > 0 && (
				<section className="space-y-3">
					<div className="flex items-end justify-between border-b border-[var(--theme-line)] pb-2">
						<div>
							<p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-muted">
								Waiting nearby
							</p>
							<h3 className="mt-1 font-serif text-2xl leading-none text-ink">
								Other open books
							</h3>
						</div>
						<span className="rounded-full bg-[var(--theme-accent-soft)] px-3 py-1 text-xs font-bold text-sage">
							{otherBooks.length}
						</span>
					</div>
					<div className="grid gap-3 lg:grid-cols-2">
						{otherBooks.map((book) => (
							<CurrentReadCard
								book={book}
								key={book.id}
								onFocus={onFocus}
								onUpdateProgress={updateProgress}
							/>
						))}
					</div>
				</section>
			)}
		</section>
	);
}

function useDialogEffects({
	isOpen,
	onClose,
}: {
	isOpen: boolean;
	onClose: () => void;
}) {
	const dialogRef = useRef<HTMLElement | null>(null);
	const initialFocusRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!isOpen) return;
		const previousActiveElement = document.activeElement as HTMLElement | null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		requestAnimationFrame(() => {
			(
				initialFocusRef.current ?? getFocusableElements(dialogRef.current)[0]
			)?.focus();
		});

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}

			if (event.key !== "Tab") return;
			const focusableElements = getFocusableElements(dialogRef.current);
			if (focusableElements.length === 0) return;
			const firstElement = focusableElements[0];
			const lastElement = focusableElements[focusableElements.length - 1];

			if (event.shiftKey && document.activeElement === firstElement) {
				event.preventDefault();
				lastElement.focus();
			} else if (!event.shiftKey && document.activeElement === lastElement) {
				event.preventDefault();
				firstElement.focus();
			}
		}

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
			document.body.style.overflow = previousOverflow;
			previousActiveElement?.focus();
		};
	}, [isOpen, onClose]);

	return { dialogRef, initialFocusRef };
}

function getFocusableElements(container: HTMLElement | null) {
	if (!container) return [];
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
		),
	).filter((element) => !element.hasAttribute("hidden"));
}

function CurrentReadCard({
	book,
	onFocus,
	onUpdateProgress,
}: {
	book: Book;
	onFocus: (bookId: string) => void;
	onUpdateProgress: (book: Book, currentPage: number) => void;
}) {
	const progress = getProgressPercent(book);

	return (
		<article className="surface grid grid-cols-[4.25rem_1fr] gap-4 p-3 shadow-none sm:grid-cols-[5rem_1fr] sm:p-4">
			<BookCover book={book} />
			<div className="min-w-0 py-1">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<h4 className="font-serif text-[1.35rem] leading-[1.02] text-ink">
							{book.title}
						</h4>
						<p className="mt-1 text-sm text-muted">{book.author}</p>
					</div>
					<button
						className="tap -mr-1 rounded-full bg-[var(--theme-accent-soft)] px-3 py-1.5 text-xs font-bold text-sage"
						onClick={() => onFocus(book.id)}
						type="button"
					>
						Read this
					</button>
				</div>
				{book.progress && (
					<div className="mt-4">
						<div className="flex items-center justify-between text-xs font-bold text-muted">
							<span>{book.progress.currentPage} pages in</span>
							<span>{progress}%</span>
						</div>
						<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--theme-accent-soft)]">
							<div
								className="h-full rounded-full bg-sage"
								style={{ width: `${progress}%` }}
							/>
						</div>
						<label className="mt-3 block text-xs font-bold text-ink">
							Current page
							<input
								className="field mt-2 py-2 text-sm"
								min="0"
								max={book.progress.totalPages}
								type="number"
								value={book.progress.currentPage}
								onChange={(event) =>
									onUpdateProgress(book, Number(event.target.value))
								}
							/>
						</label>
					</div>
				)}
			</div>
		</article>
	);
}

function ShelfScreen(props: {
	books: Book[];
	onChangeStatus: (book: Book, status: BookStatus) => void;
	onDelete: (id: string) => void;
	onEdit: (book: Book) => void;
	onNotify: (message: string) => void;
	onOpenAdd: () => void;
}) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<ShelfFilter>("all");
	const [moodFilter, setMoodFilter] = useState<MoodTag | "all">("all");
	const [filtersOpen, setFiltersOpen] = useState(false);
	const sections = ["reading", "want", "finished", "paused"] as BookStatus[];
	const normalizedQuery = query.trim().toLowerCase();
	const foundMeowshroom = normalizedQuery.includes("meowshroom");
	const isFiltered =
		normalizedQuery.length > 0 || filter !== "all" || moodFilter !== "all";
	const activeFilterSummary = [
		filter !== "all" ? statusLabels[filter] : null,
		moodFilter !== "all" ? moodFilter : null,
	]
		.filter(Boolean)
		.join(" · ");
	const filteredBooks = props.books.filter((book) => {
		const matchesQuery = normalizedQuery
			? `${book.title} ${book.author}`.toLowerCase().includes(normalizedQuery)
			: true;
		const matchesStatus = filter === "all" ? true : book.status === filter;
		const matchesMood =
			moodFilter === "all" ? true : book.moodTags.includes(moodFilter);
		return matchesQuery && matchesStatus && matchesMood;
	});

	function deleteBook(id: string) {
		props.onDelete(id);
		props.onNotify("Book deleted");
	}

	return (
		<section className="space-y-7">
			<div className="surface page-marker p-5 pl-7 sm:flex sm:items-end sm:justify-between sm:gap-4">
				<div>
					<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
						{props.books.length} saved books
					</p>
					<h2 className="mt-2 font-serif text-3xl leading-none text-ink">
						A shelf you can read at a glance.
					</h2>
					<p className="mt-3 max-w-xl text-sm leading-6 text-muted">
						Grouped by where each book sits in your reading life. Open a card
						when you need to change the details.
					</p>
				</div>
				<button
					className="tap mt-4 rounded-full bg-burgundy px-5 py-3 text-sm font-bold text-paper sm:mt-0"
					onClick={props.onOpenAdd}
					type="button"
				>
					<Plus className="mr-1 inline size-4" /> Add book
				</button>
			</div>

			{props.books.length === 0 ? (
				<EmptyState
					actionLabel="Add a book"
					description="Search Open Library or add one manually. You can decide later whether it belongs in Reading, Want, Finished, or Paused."
					eyebrow="No books yet"
					onAction={props.onOpenAdd}
					title="Your shelf is waiting for its first spine."
				/>
			) : (
				<>
					<div className="surface p-4 sm:p-5">
						<label className="grid gap-2 text-sm font-bold text-ink">
							Find a book
							<div className="flex min-h-12 items-center gap-2 rounded-2xl border border-[var(--theme-line)] bg-[var(--theme-surface-muted)] px-3 focus-within:ring-3 focus-within:ring-[var(--theme-accent-soft)]">
								<Search className="size-4 text-muted" />
								<input
									className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-muted"
									placeholder="Search title or author"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
								/>
							</div>
						</label>
						<div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--theme-line)] pt-3 sm:hidden">
							<div>
								<p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">
									Filters
								</p>
								<p className="mt-1 text-xs text-muted">
									{activeFilterSummary || "All books"}
								</p>
							</div>
							<button
								aria-expanded={filtersOpen}
								className="tap rounded-full bg-[var(--theme-accent-soft)] px-4 py-2 text-sm font-bold text-sage"
								onClick={() => setFiltersOpen((value) => !value)}
								type="button"
							>
								Filter shelf
							</button>
						</div>
						<div className={`${filtersOpen ? "grid" : "hidden"} gap-3 sm:grid`}>
							<div className="chip-list mt-3">
								{(["all", ...sections] as ShelfFilter[]).map((item) => (
									<button
										aria-pressed={filter === item}
										className={`chip ${filter === item ? "chip-on" : ""}`}
										key={item}
										onClick={() => setFilter(item)}
										type="button"
									>
										{item === "all" ? "All" : statusLabels[item]}
									</button>
								))}
							</div>
							<div className="mt-4 border-t border-[var(--theme-line)] pt-3">
								<p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-muted">
									Mood filter
								</p>
								<div className="chip-list">
									<button
										aria-pressed={moodFilter === "all"}
										className={`chip ${moodFilter === "all" ? "chip-on" : ""}`}
										onClick={() => setMoodFilter("all")}
										type="button"
									>
										All moods
									</button>
									{moodTags.map((tag) => (
										<button
											aria-pressed={moodFilter === tag}
											className={`chip ${moodFilter === tag ? "chip-on" : ""}`}
											key={tag}
											onClick={() => setMoodFilter(tag)}
											type="button"
										>
											{tag}
										</button>
									))}
								</div>
							</div>
						</div>
					</div>

					{foundMeowshroom && <MeowshroomNote />}

					{isFiltered ? (
						<section className="space-y-3">
							<div className="flex items-end justify-between gap-3 border-b border-[var(--theme-line)] pb-3">
								<div>
									<p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-muted">
										Filtered shelf
									</p>
									<h2 className="mt-1.5 font-serif text-2xl leading-none text-ink">
										{filteredBooks.length}{" "}
										{filteredBooks.length === 1 ? "match" : "matches"}
									</h2>
								</div>
								<button
									className="tap rounded-full px-3 py-2 text-xs font-bold text-sage"
									onClick={() => {
										setQuery("");
										setFilter("all");
										setMoodFilter("all");
									}}
									type="button"
								>
									Clear
								</button>
							</div>
							{filteredBooks.length > 0 ? (
								<div className="grid gap-3 lg:grid-cols-2">
									{filteredBooks.map((book) => (
										<BookCard
											book={book}
											key={book.id}
											onChangeStatus={props.onChangeStatus}
											onDelete={deleteBook}
											onEdit={props.onEdit}
										/>
									))}
								</div>
							) : foundMeowshroom ? (
								<p className="rounded-2xl border border-dashed border-[var(--theme-line)] px-4 py-5 text-sm text-muted">
									No shelf books match that secret word. The note still found
									you.
								</p>
							) : (
								<p className="rounded-2xl border border-dashed border-[var(--theme-line)] px-4 py-5 text-sm text-muted">
									No books match that search. Try a title, author, status, or
									mood.
								</p>
							)}
						</section>
					) : (
						sections.map((status) => {
							const books = props.books.filter(
								(book) => book.status === status,
							);

							return (
								<section className="space-y-3" key={status}>
									<div className="flex items-end justify-between gap-3 border-b border-[var(--theme-line)] pb-3">
										<div>
											<p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-muted">
												{statusHint(status)}
											</p>
											<h2 className="mt-1.5 font-serif text-2xl leading-none text-ink">
												{statusLabels[status]}
											</h2>
										</div>
										<span className="rounded-full bg-[var(--theme-accent-soft)] px-3 py-1 text-xs font-bold text-sage">
											{books.length}
										</span>
									</div>
									{books.length > 0 ? (
										<div className="grid gap-3 lg:grid-cols-2">
											{books.map((book) => (
												<BookCard
													book={book}
													key={book.id}
													onChangeStatus={props.onChangeStatus}
													onDelete={deleteBook}
													onEdit={props.onEdit}
												/>
											))}
										</div>
									) : (
										<p className="rounded-2xl border border-dashed border-[var(--theme-line)] px-4 py-5 text-sm text-muted">
											{emptyStatusCopy(status)}
										</p>
									)}
								</section>
							);
						})
					)}
				</>
			)}
		</section>
	);
}

function MeowshroomNote() {
	return (
		<aside className="relative overflow-hidden rounded-[1.65rem] border border-[#B78D68]/45 bg-[#F8E8D4] p-5 text-[#3C2A20] shadow-soft">
			<div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-[#D86B58]/20 blur-2xl" />
			<div className="relative grid gap-4 sm:grid-cols-[4.5rem_1fr] sm:items-center">
				<div
					aria-hidden="true"
					className="mx-auto flex h-20 w-20 items-end justify-center rounded-full bg-[#5D6E4A]/15 pb-3 shadow-[inset_0_-10px_0_rgba(93,110,74,0.08)] sm:mx-0"
				>
					<div className="relative h-12 w-12">
						<span className="absolute left-1/2 top-0 h-8 w-10 -translate-x-1/2 rounded-t-full bg-[#D86B58] shadow-[inset_-7px_-5px_0_rgba(60,42,32,0.14)]" />
						<span className="absolute left-4 top-2 h-2 w-2 rounded-full bg-[#F8E8D4]" />
						<span className="absolute right-4 top-3 h-1.5 w-1.5 rounded-full bg-[#F8E8D4]" />
						<span className="absolute bottom-0 left-1/2 h-8 w-5 -translate-x-1/2 rounded-b-full rounded-t-sm bg-[#F3D1AE]" />
						<span className="absolute bottom-4 left-3 h-1 w-1 rounded-full bg-[#3C2A20]" />
						<span className="absolute bottom-4 right-3 h-1 w-1 rounded-full bg-[#3C2A20]" />
					</div>
				</div>
				<div>
					<p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-[#8C4A3B]">
						A note found under the moss
					</p>
					<h3 className="mt-2 font-serif text-3xl leading-none text-[#3C2A20]">
						Insaf was here.
					</h3>
					<p className="mt-3 max-w-xl text-sm leading-6 text-[#6F5648]">
						The Algerian cat council has approved this reading cave. It
						recommends one strange detective thought, one impossible boss fight,
						and a seat at the very top of the shelf.
					</p>
				</div>
			</div>
		</aside>
	);
}

function SettingsSheet({
	books,
	cloudSync,
	onClose,
	onImport,
	onNotify,
}: {
	books: Book[];
	cloudSync: CloudSyncDetails;
	onClose: () => void;
	onImport: (books: Book[]) => void;
	onNotify: (message: string) => void;
}) {
	const [importMessage, setImportMessage] = useState("");
	const { dialogRef, initialFocusRef } = useDialogEffects({
		isOpen: true,
		onClose,
	});

	function exportBackup() {
		exportBooksBackup(books);
		onNotify("Backup exported");
	}

	async function importBackup(file?: File) {
		if (!file) return;
		const text = await file.text();
		const result = parseBooksJson(text);

		if (!result.ok) {
			setImportMessage(result.message);
			return;
		}

		onImport(result.books);
		setImportMessage(
			`Ready. Your shelf now has ${result.books.length} ${result.books.length === 1 ? "book" : "books"}.`,
		);
	}

	const syncTone =
		cloudSync.status === "synced"
			? "text-sage"
			: cloudSync.status === "conflict" || cloudSync.status === "error"
				? "text-burgundy"
				: "text-muted";

	return (
		<div className="fixed inset-0 z-30 flex items-end bg-ink/35 px-3 pt-12 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
			<button
				aria-label="Close settings"
				className="absolute inset-0 cursor-default"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-labelledby="settings-title"
				aria-modal="true"
				className="surface soft-scroll relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.75rem] p-5 sm:max-w-xl sm:rounded-[1.75rem] sm:p-6"
				ref={dialogRef}
				role="dialog"
			>
				<div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/15 sm:hidden" />
				<div className="flex items-start justify-between gap-4">
					<div>
						<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
							Shelf keeping
						</p>
						<h2
							className="mt-1 font-serif text-3xl leading-none text-ink"
							id="settings-title"
						>
							Back up your shelf
						</h2>
						<p className="mt-2 text-sm leading-6 text-muted">
							Signed-in shelves sync to cloud. Export is still here as a simple
							backup before clearing browser data or moving phones.
						</p>
					</div>
					<button
						className="tap rounded-full border border-[var(--theme-line)] px-4 py-2 text-sm font-bold text-ink"
						onClick={onClose}
						ref={(element) => {
							initialFocusRef.current = element;
						}}
						type="button"
					>
						Close
					</button>
				</div>

				<div className="mt-5 rounded-[1.25rem] border border-[var(--theme-line)] bg-[var(--theme-surface-muted)] p-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
								Cloud sync
							</p>
							<p className={`mt-2 text-sm font-bold ${syncTone}`}>
								{cloudStatusLabels[cloudSync.status]}
							</p>
							<p className="mt-1 text-xs leading-5 text-muted">
								{cloudSync.message}
							</p>
							<p className="mt-2 text-xs font-bold text-muted">
								{cloudSync.isSignedIn
									? `Signed in. ${cloudSync.lastSyncedAt ? `Last checked ${formatShortDateTime(cloudSync.lastSyncedAt)}.` : "No completed sync yet."}`
									: cloudSync.isLoaded
										? "Signed out. This shelf is local on this device."
										: "Checking sign-in state..."}
							</p>
						</div>
						<button
							className="tap rounded-full bg-sage px-4 py-2.5 text-sm font-bold text-paper disabled:cursor-not-allowed disabled:opacity-60"
							disabled={
								!cloudSync.isLoaded ||
								!cloudSync.isSignedIn ||
								cloudSync.status === "loading" ||
								cloudSync.status === "saving"
							}
							onClick={cloudSync.onSyncNow}
							type="button"
						>
							Sync now
						</button>
					</div>
				</div>

				<div className="mt-3 grid gap-3">
					<button
						className="tap rounded-[1.25rem] bg-burgundy px-5 py-3 text-left font-bold text-paper"
						onClick={exportBackup}
						type="button"
					>
						Export backup
						<span className="mt-1 block text-xs font-semibold text-paper/75">
							Download {books.length} {books.length === 1 ? "book" : "books"} as
							JSON.
						</span>
					</button>

					<label className="rounded-[1.25rem] border border-[var(--theme-line)] bg-[var(--theme-surface-muted)] p-4 text-sm font-bold text-ink">
						Replace shelf from backup
						<span className="mt-1 block text-xs font-semibold leading-5 text-muted">
							This replaces the books on this device. Export first if you want
							to keep the current shelf.
						</span>
						<input
							accept="application/json,.json"
							className="field mt-3"
							type="file"
							onChange={(event) => importBackup(event.target.files?.[0])}
						/>
					</label>
					{importMessage && (
						<p className="rounded-2xl bg-[var(--theme-accent-soft)] px-4 py-3 text-sm font-bold text-sage">
							{importMessage}
						</p>
					)}
				</div>
			</section>
		</div>
	);
}

function BookSheet({
	draft,
	isEditing,
	onCancel,
	onChangeDraft,
	onSave,
}: {
	draft: BookDraft;
	isEditing: boolean;
	onCancel: () => void;
	onChangeDraft: Dispatch<SetStateAction<BookDraft>>;
	onSave: () => void;
}) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<OpenLibraryResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);
	const [pageLookupKey, setPageLookupKey] = useState<string | null>(null);
	const [selectedResultTitle, setSelectedResultTitle] = useState("");
	const [searchError, setSearchError] = useState("");
	const [hasTriedSave, setHasTriedSave] = useState(false);
	const pageLookupKeyRef = useRef<string | null>(null);
	const searchRequestIdRef = useRef(0);
	const detailsRef = useRef<HTMLDivElement | null>(null);
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const { dialogRef, initialFocusRef } = useDialogEffects({
		isOpen: true,
		onClose: onCancel,
	});
	const titleError = hasTriedSave && !draft.title.trim();
	const authorError = hasTriedSave && !draft.author.trim();
	const canSave = Boolean(draft.title.trim() && draft.author.trim());
	const canLiveSearch = query.trim().length >= 3;

	function handleSave() {
		setHasTriedSave(true);
		if (!canSave) return;
		onSave();
	}

	const runSearch = useCallback(
		async (searchQuery: string, source: "live" | "manual") => {
			const trimmedQuery = searchQuery.trim();
			if (!trimmedQuery) return;
			const requestId = searchRequestIdRef.current + 1;
			searchRequestIdRef.current = requestId;

			setIsSearching(true);
			setSearchError("");
			if (source === "manual") {
				setSelectedResultTitle("");
			}

			try {
				const nextResults = await searchOpenLibrary(trimmedQuery);
				if (searchRequestIdRef.current !== requestId) return;
				setResults(nextResults);
				if (nextResults.length === 0) {
					setSearchError("No matching books found. Manual add still works.");
				}
			} catch {
				if (searchRequestIdRef.current !== requestId) return;
				setSearchError(
					"Could not reach Open Library. Try again or add it manually.",
				);
			} finally {
				if (searchRequestIdRef.current === requestId) {
					setIsSearching(false);
				}
			}
		},
		[],
	);

	useEffect(() => {
		const trimmedQuery = query.trim();
		if (trimmedQuery.length < 3) {
			searchRequestIdRef.current += 1;
			setIsSearching(false);
			setSearchError("");
			setResults([]);
			return;
		}

		const timer = window.setTimeout(() => {
			runSearch(trimmedQuery, "live");
		}, 450);

		return () => window.clearTimeout(timer);
	}, [query, runSearch]);

	function searchOnline() {
		const trimmedQuery =
			query.trim() || [draft.title, draft.author].filter(Boolean).join(" ");
		runSearch(trimmedQuery, "manual");
	}

	async function applyResult(result: OpenLibraryResult) {
		setHasTriedSave(false);
		pageLookupKeyRef.current = result.key;
		setPageLookupKey(result.key);
		setSelectedResultTitle(result.title);

		onChangeDraft((currentDraft) => ({
			...currentDraft,
			title: result.title,
			author: result.author,
			coverUrl: result.coverUrl ?? currentDraft.coverUrl,
			totalPages: result.pageCount
				? String(result.pageCount)
				: currentDraft.totalPages,
		}));
		window.setTimeout(() => {
			const dialog = dialogRef.current;
			const details = detailsRef.current;
			if (!dialog || !details) return;

			dialog.scrollTo({
				behavior: "smooth",
				top: details.offsetTop - 12,
			});
			titleInputRef.current?.focus({ preventScroll: true });
		}, 80);

		if (result.pageCount) {
			pageLookupKeyRef.current = null;
			setPageLookupKey(null);
			return;
		}

		try {
			const editionPageCount = await getOpenLibraryEditionPageCount(
				result.key,
				result.title,
			);
			if (pageLookupKeyRef.current !== result.key) return;
			if (!editionPageCount) return;

			onChangeDraft((currentDraft) => ({
				...currentDraft,
				title: result.title,
				author: result.author,
				coverUrl: result.coverUrl ?? currentDraft.coverUrl,
				totalPages: String(editionPageCount),
			}));
		} catch {
			// Page counts are edition-specific and often missing; manual entry remains available.
		} finally {
			if (pageLookupKeyRef.current === result.key) {
				pageLookupKeyRef.current = null;
				setPageLookupKey(null);
			}
		}
	}

	return (
		<div className="fixed inset-0 z-30 flex items-end bg-ink/35 px-3 pt-12 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
			<button
				aria-label="Close book form"
				className="absolute inset-0 cursor-default"
				onClick={onCancel}
				type="button"
			/>
			<section
				aria-labelledby="book-sheet-title"
				aria-modal="true"
				className="surface soft-scroll relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.75rem] p-5 sm:max-w-2xl sm:rounded-[1.75rem] sm:p-6"
				ref={dialogRef}
				role="dialog"
			>
				<div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/15 sm:hidden" />
				<div className="flex items-start justify-between gap-4">
					<div>
						<p className="text-sm font-bold text-sage">
							{isEditing ? "Make it feel right" : "A new book for the shelf"}
						</p>
						<h2
							className="mt-1 font-serif text-2xl text-ink"
							id="book-sheet-title"
						>
							{isEditing ? "Edit book" : "Add a book"}
						</h2>
					</div>
					<button
						className="tap rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink"
						onClick={onCancel}
						ref={(element) => {
							initialFocusRef.current = element;
						}}
						type="button"
					>
						Close
					</button>
				</div>
				<div className="mt-5 rounded-2xl border border-[var(--theme-line)] bg-[var(--theme-surface-muted)] p-3.5">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-sm font-bold text-ink">Search online</p>
							<p className="mt-1 text-xs leading-5 text-muted">
								Optional. Uses Open Library to fill basics, then you can edit
								anything before saving.
							</p>
						</div>
					</div>
					<div className="mt-3 flex items-stretch rounded-2xl border border-[var(--theme-line)] bg-paper/70 p-1 focus-within:ring-3 focus-within:ring-[var(--theme-accent-soft)]">
						<input
							className="min-h-11 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-ink outline-none placeholder:text-muted"
							placeholder="Type 3+ letters"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
						{isSearching && (
							<output
								aria-label="Searching"
								className="flex items-center px-2 text-sage"
							>
								<span className="h-4 w-4 rounded-full border-2 border-sage/30 border-t-sage motion-safe:animate-spin" />
							</output>
						)}
						<button
							className="tap inline-flex min-w-11 items-center justify-center rounded-xl bg-sage px-3 text-sm font-bold text-paper disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-24 sm:px-4"
							disabled={isSearching}
							onClick={searchOnline}
							type="button"
						>
							<Search className="size-4 sm:mr-1" />
							<span className="sr-only sm:not-sr-only">
								{isSearching ? "Searching" : "Search"}
							</span>
						</button>
					</div>
					{query.trim().length > 0 && !canLiveSearch && !isSearching && (
						<p className="mt-2 text-xs font-bold text-muted">
							Keep typing to search Open Library.
						</p>
					)}
					{isSearching && (
						<p className="mt-2 text-xs font-bold text-sage">
							Looking through Open Library...
						</p>
					)}
					{searchError && (
						<p className="mt-2 text-xs font-bold text-muted">{searchError}</p>
					)}
					{selectedResultTitle && (
						<p className="mt-2 rounded-xl bg-[var(--theme-accent-soft)] px-3 py-2 text-xs font-bold text-sage">
							Selected from Open Library: {selectedResultTitle}. Review the
							details below.
						</p>
					)}
					{results.length > 0 && (
						<div className="mt-3 grid gap-2">
							{results.map((result) => (
								<button
									className="tap flex gap-3 rounded-2xl border border-[var(--theme-line)] bg-paper/70 p-2.5 text-left transition hover:border-sage/50 hover:bg-paper"
									key={result.key}
									onClick={() => applyResult(result)}
									type="button"
								>
									{result.coverUrl ? (
										<img
											alt=""
											className="h-16 w-11 rounded-r-md rounded-l-sm object-cover"
											src={result.coverUrl}
										/>
									) : (
										<span className="h-16 w-11 rounded-r-md rounded-l-sm bg-sage/30" />
									)}
									<span className="min-w-0 flex-1 pt-0.5">
										<span className="line-clamp-1 font-serif text-lg leading-tight text-ink">
											{result.title}
										</span>
										<span className="mt-1 block text-xs text-muted">
											{result.author}
											{result.year ? `, ${result.year}` : ""}
											{result.pageCount ? ` · ${result.pageCount} pages` : ""}
										</span>
										<span className="mt-1 block text-xs font-bold text-sage">
											Use this book
										</span>
									</span>
								</button>
							))}
						</div>
					)}
				</div>
				<div className="mt-5 scroll-mt-6" ref={detailsRef}>
					<div className="mb-3 flex items-end justify-between gap-3 border-b border-[var(--theme-line)] pb-2">
						<div>
							<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
								Review details
							</p>
							<p className="mt-1 text-xs text-muted">
								Search can fill this in. You still decide what to keep.
							</p>
						</div>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="grid gap-2 text-sm font-bold text-ink">
							Title
							<input
								aria-invalid={titleError}
								className={`field min-h-12 ${titleError ? "border-burgundy ring-3 ring-burgundy/15" : ""}`}
								placeholder="Title"
								ref={titleInputRef}
								value={draft.title}
								onChange={(event) =>
									onChangeDraft({ ...draft, title: event.target.value })
								}
							/>
							{titleError && (
								<p className="text-xs font-bold text-burgundy">Add a title.</p>
							)}
						</label>
						<label className="grid gap-2 text-sm font-bold text-ink">
							Author
							<input
								aria-invalid={authorError}
								className={`field min-h-12 ${authorError ? "border-burgundy ring-3 ring-burgundy/15" : ""}`}
								placeholder="Author"
								value={draft.author}
								onChange={(event) =>
									onChangeDraft({ ...draft, author: event.target.value })
								}
							/>
							{authorError && (
								<p className="text-xs font-bold text-burgundy">
									Add an author.
								</p>
							)}
						</label>
						<label className="grid gap-2 text-sm font-bold text-ink">
							Status
							<select
								className="field min-h-12 py-0"
								value={draft.status}
								onChange={(event) =>
									onChangeDraft({
										...draft,
										status: event.target.value as BookStatus,
									})
								}
							>
								{Object.entries(statusLabels).map(([value, label]) => (
									<option key={value} value={value}>
										{label}
									</option>
								))}
							</select>
						</label>
						<label className="grid gap-2 text-sm font-bold text-ink">
							<span className="flex min-h-5 items-center justify-between gap-3">
								Total pages
								{pageLookupKey && (
									<output className="inline-flex items-center gap-2 text-xs font-bold text-sage">
										<span
											aria-hidden="true"
											className="h-3.5 w-3.5 rounded-full border-2 border-sage/30 border-t-sage motion-safe:animate-spin"
										/>
										Looking up pages
									</output>
								)}
							</span>
							<input
								className="field min-h-12"
								placeholder={
									pageLookupKey ? "Checking editions..." : "Total pages"
								}
								type="number"
								value={draft.totalPages}
								onChange={(event) =>
									onChangeDraft({ ...draft, totalPages: event.target.value })
								}
							/>
						</label>
						<label className="grid gap-2 text-sm font-bold text-ink">
							Current page
							<input
								className="field min-h-12"
								placeholder="Current page"
								type="number"
								value={draft.currentPage}
								onChange={(event) =>
									onChangeDraft({ ...draft, currentPage: event.target.value })
								}
							/>
						</label>
					</div>
				</div>
				<div className="mt-4">
					<p className="mb-2 text-sm font-bold text-ink">Cover color</p>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{coverColorOptions.map((color) => (
							<button
								aria-pressed={draft.coverColor === color.value}
								className={`tap flex items-center gap-3 rounded-2xl border px-3 py-2 text-left text-sm font-bold ${draft.coverColor === color.value ? "border-sage bg-[var(--theme-accent-soft)] text-ink" : "border-[var(--theme-line)] bg-[var(--theme-surface-muted)] text-muted"}`}
								key={color.value}
								onClick={() =>
									onChangeDraft({ ...draft, coverColor: color.value })
								}
								type="button"
							>
								<span
									aria-hidden="true"
									className="h-8 w-6 rounded-r-md rounded-l-sm shadow-cover"
									style={{ background: color.value }}
								/>
								{color.name}
							</button>
						))}
					</div>
				</div>
				<div className="chip-list mt-4">
					{moodTags.map((tag) => (
						<button
							aria-pressed={draft.moodTags.includes(tag)}
							className={`chip ${draft.moodTags.includes(tag) ? "chip-on" : ""}`}
							key={tag}
							onClick={() =>
								onChangeDraft({
									...draft,
									moodTags: draft.moodTags.includes(tag)
										? draft.moodTags.filter((item) => item !== tag)
										: [...draft.moodTags, tag],
								})
							}
							type="button"
						>
							{tag}
						</button>
					))}
				</div>
				<div className="mt-5 flex gap-2">
					<button
						className="tap rounded-full bg-burgundy px-5 py-3 font-bold text-paper disabled:cursor-not-allowed disabled:opacity-60"
						disabled={hasTriedSave && !canSave}
						onClick={handleSave}
						type="button"
					>
						{isEditing ? "Save changes" : "Add book"}
					</button>
					{isEditing && (
						<button
							className="tap rounded-full border border-ink/15 px-5 py-3 font-bold text-ink"
							onClick={onCancel}
							type="button"
						>
							Cancel
						</button>
					)}
				</div>
			</section>
		</div>
	);
}

function PickScreen({
	book,
	energy,
	hasAnyBooks,
	onAdd,
	onEnergy,
	onSaveDiscovery,
	onSkip,
	onUpdateDiscoveryMoods,
	savedDiscoveryBook,
	savedTitles,
}: {
	book?: Book;
	energy: string;
	hasAnyBooks: boolean;
	onAdd: () => void;
	onEnergy: (energy: string) => void;
	onSaveDiscovery: (result: OpenLibraryResult) => void;
	onSkip: () => void;
	onUpdateDiscoveryMoods: (bookId: string, moodTags: MoodTag[]) => void;
	savedDiscoveryBook: Book | null;
	savedTitles: string[];
}) {
	const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>("mood");
	const [discoveries, setDiscoveries] = useState<OpenLibraryResult[]>([]);
	const [isDiscovering, setIsDiscovering] = useState(false);
	const [discoveryError, setDiscoveryError] = useState("");
	const matches = book
		? book.moodTags.filter((tag) => energyMap[energy].includes(tag))
		: [];
	const reason = book ? pickReason(book, energy, matches) : "";
	const subtitle = pickSubtitle(energy);
	const discoverySubject = getDiscoverySubject(energy, book);
	const canDiscoverByAuthor = Boolean(book?.author);
	const normalizedSavedTitles = new Set(savedTitles.map(normalizeBookTitle));

	function toggleDiscoveryMood(tag: MoodTag) {
		if (!savedDiscoveryBook) return;
		onUpdateDiscoveryMoods(
			savedDiscoveryBook.id,
			savedDiscoveryBook.moodTags.includes(tag)
				? savedDiscoveryBook.moodTags.filter((item) => item !== tag)
				: [...savedDiscoveryBook.moodTags, tag],
		);
	}

	async function discoverBooks(mode: DiscoveryMode) {
		setDiscoveryMode(mode);
		setIsDiscovering(true);
		setDiscoveryError("");

		try {
			const nextDiscoveries = await getOpenLibraryDiscoveries({
				book,
				energy,
				mode,
			});
			const filteredDiscoveries = nextDiscoveries.filter(
				(result) =>
					!normalizedSavedTitles.has(normalizeBookTitle(result.title)),
			);
			setDiscoveries(filteredDiscoveries);
			if (filteredDiscoveries.length === 0) {
				setDiscoveryError("Open Library did not have a clean suggestion here.");
			}
		} catch {
			setDiscoveryError("Could not reach Open Library. Try again in a moment.");
		} finally {
			setIsDiscovering(false);
		}
	}

	if (!hasAnyBooks) {
		return (
			<EmptyState
				actionLabel="Add books to pick from"
				description="Pick works best after you save a few books as Want or Paused. Then it can choose based on the kind of attention you have."
				eyebrow="No choices yet"
				onAction={onAdd}
				title="The shelf needs a few possibilities."
			/>
		);
	}

	return (
		<section className="space-y-5">
			<div>
				<p className="text-xs font-bold uppercase tracking-[0.24em] text-sage">
					Tonight's question
				</p>
				<h2 className="mt-2 font-serif text-3xl leading-none text-ink">
					What do you have energy for?
				</h2>
				<p className="mt-3 max-w-xl text-sm leading-6 text-muted">
					Choose the kind of attention you have. Little Shelf will pick from
					books you already wanted, plus paused books that might be worth
					returning to.
				</p>
			</div>
			<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{energyLabels.map((option) => (
					<button
						aria-pressed={energy === option}
						className={`tap rounded-2xl px-4 py-3 text-left text-sm font-bold ${energy === option ? "bg-sage text-paper" : "surface text-ink shadow-none"}`}
						key={option}
						onClick={() => onEnergy(option)}
						type="button"
					>
						<span className="block capitalize">{option}</span>
						<span
							className={`mt-1 block text-xs font-semibold ${energy === option ? "text-paper/75" : "text-muted"}`}
						>
							{pickSubtitle(option)}
						</span>
					</button>
				))}
			</div>
			{book ? (
				<article className="surface page-marker grid gap-5 p-5 pl-7 sm:grid-cols-[11rem_1fr]">
					<BookCover book={book} large />
					<div>
						<p className="text-sm font-bold text-sage">{subtitle}</p>
						<h3 className="mt-1 font-serif text-3xl leading-none text-ink">
							{book.title}
						</h3>
						<p className="mt-1 text-muted">{book.author}</p>
						<p className="mt-4 max-w-md text-sm leading-6 text-muted">
							{reason}
						</p>
						<div className="mt-4 flex flex-wrap gap-1.5">
							{book.moodTags.map((tag) => (
								<span
									className={`rounded-full px-2.5 py-1 text-xs font-bold ${matches.includes(tag) ? "bg-sage text-paper" : "bg-[var(--theme-accent-soft)] text-sage"}`}
									key={tag}
								>
									{tag}
								</span>
							))}
						</div>
						<div className="mt-5 flex flex-wrap gap-2">
							<button
								className="tap rounded-full bg-burgundy px-5 py-3 font-bold text-paper"
								onClick={onSkip}
								type="button"
							>
								<Dice5 className="mr-2 inline size-4" />
								Not this one
							</button>
							<p className="self-center text-xs font-bold text-muted">
								Skip without changing your shelf.
							</p>
						</div>
					</div>
				</article>
			) : (
				<div className="surface page-marker p-5 pl-7">
					<p className="font-serif text-2xl text-ink">Nothing waiting yet.</p>
					<p className="mt-2 text-sm leading-6 text-muted">
						Add a book with status Want or Paused. Pick only chooses from books
						you already saved.
					</p>
				</div>
			)}

			<section className="surface p-5">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="text-xs font-bold uppercase tracking-[0.24em] text-sage">
							Beyond your shelf
						</p>
						<h3 className="mt-2 font-serif text-2xl leading-none text-ink">
							Find a possible next book.
						</h3>
						<p className="mt-2 max-w-xl text-sm leading-6 text-muted">
							Optional Open Library suggestions. These stay outside your shelf
							until you decide to add one yourself.
						</p>
					</div>
					<div className="chip-list">
						<button
							aria-pressed={discoveryMode === "mood"}
							className={`tap rounded-full px-4 py-2.5 text-sm font-bold ${discoveryMode === "mood" ? "bg-sage text-paper" : "border border-[var(--theme-line)] text-muted"}`}
							disabled={isDiscovering}
							onClick={() => discoverBooks("mood")}
							type="button"
						>
							Try {discoverySubject.label}
						</button>
						<button
							aria-pressed={discoveryMode === "author"}
							className={`tap rounded-full px-4 py-2.5 text-sm font-bold ${discoveryMode === "author" ? "bg-sage text-paper" : "border border-[var(--theme-line)] text-muted"}`}
							disabled={isDiscovering || !canDiscoverByAuthor}
							onClick={() => discoverBooks("author")}
							type="button"
						>
							More by author
						</button>
					</div>
				</div>

				{isDiscovering && (
					<p className="mt-4 rounded-2xl bg-[var(--theme-accent-soft)] px-4 py-3 text-sm font-bold text-sage">
						Looking through Open Library...
					</p>
				)}
				{discoveryError && !isDiscovering && (
					<p className="mt-4 rounded-2xl border border-dashed border-[var(--theme-line)] px-4 py-3 text-sm text-muted">
						{discoveryError}
					</p>
				)}
				{savedDiscoveryBook && (
					<div className="mt-4 rounded-[1.35rem] border border-[var(--theme-line)] bg-paper/60 p-4">
						<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
							Saved to Want
						</p>
						<h4 className="mt-1 font-serif text-xl leading-tight text-ink">
							Add a mood for {savedDiscoveryBook.title}?
						</h4>
						<p className="mt-1 text-xs leading-5 text-muted">
							Optional, but it helps Pick understand why this book belongs on
							the shelf.
						</p>
						<div className="chip-list mt-3">
							{moodTags.map((tag) => (
								<button
									aria-pressed={savedDiscoveryBook.moodTags.includes(tag)}
									className={`chip ${savedDiscoveryBook.moodTags.includes(tag) ? "chip-on" : ""}`}
									key={tag}
									onClick={() => toggleDiscoveryMood(tag)}
									type="button"
								>
									{tag}
								</button>
							))}
						</div>
					</div>
				)}
				{discoveries.length > 0 && !isDiscovering && (
					<div className="mt-4 grid gap-3 lg:grid-cols-3">
						{discoveries.map((result) => (
							<OpenLibrarySuggestionCard
								isSaved={normalizedSavedTitles.has(
									normalizeBookTitle(result.title),
								)}
								key={result.key}
								onSave={onSaveDiscovery}
								result={result}
							/>
						))}
					</div>
				)}
			</section>
		</section>
	);
}

function OpenLibrarySuggestionCard({
	isSaved,
	onSave,
	result,
}: {
	isSaved: boolean;
	onSave: (result: OpenLibraryResult) => void;
	result: OpenLibraryResult;
}) {
	return (
		<article className="grid grid-cols-[3.25rem_1fr] gap-3 rounded-2xl border border-[var(--theme-line)] bg-[var(--theme-surface-muted)] p-3 text-left transition hover:border-sage/50 hover:bg-paper">
			{result.coverUrl ? (
				<img
					alt=""
					className="h-16 w-11 rounded-r-md rounded-l-sm object-cover shadow-cover"
					src={result.coverUrl}
				/>
			) : (
				<span className="h-16 w-11 rounded-r-md rounded-l-sm bg-sage/25 shadow-cover" />
			)}
			<span className="min-w-0 pt-0.5">
				<span className="line-clamp-2 font-serif text-lg leading-tight text-ink">
					{result.title}
				</span>
				<span className="mt-1 block text-xs leading-4 text-muted">
					{result.author}
					{result.year ? `, ${result.year}` : ""}
				</span>
				<span className="mt-3 flex flex-wrap gap-2">
					<button
						className="tap rounded-full bg-burgundy px-3 py-1.5 text-xs font-bold text-paper disabled:cursor-default disabled:opacity-60"
						disabled={isSaved}
						onClick={() => onSave(result)}
						type="button"
					>
						{isSaved ? "Saved" : "Save to shelf"}
					</button>
					<a
						className="tap rounded-full px-3 py-1.5 text-xs font-bold text-sage"
						href={`https://openlibrary.org${result.key}`}
						rel="noreferrer"
						target="_blank"
					>
						Open details
					</a>
				</span>
			</span>
		</article>
	);
}

function JournalScreen({
	books,
	hasAnyBooks,
	onAdd,
	onNotify,
	onUpdate,
}: {
	books: Book[];
	hasAnyBooks: boolean;
	onAdd: () => void;
	onNotify: (message: string) => void;
	onUpdate: (id: string, updates: Partial<Book>) => void;
}) {
	const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
	const sortedBooks = sortFinishedBooks(books);

	function saveMemory() {
		setEditingMemoryId(null);
		onNotify("Memory saved");
	}

	if (!hasAnyBooks) {
		return (
			<EmptyState
				actionLabel="Add your first book"
				description="Journal fills itself slowly. Finish a book, save what stayed, and it becomes a private memory here."
				eyebrow="No memories yet"
				onAction={onAdd}
				title="Memories start after the first book."
			/>
		);
	}

	return (
		<section className="space-y-5">
			<div className="surface page-marker p-5 pl-7">
				<p className="text-sm font-bold uppercase tracking-[0.24em] text-sage">
					Journal
				</p>
				<h2 className="mt-2 font-serif text-3xl leading-none text-ink">
					Finished books as memories
				</h2>
				<p className="mt-3 max-w-xl text-sm leading-6 text-muted">
					The shelf slows down here. Finished books are sorted by when they left
					you, with the feeling first and the bookkeeping tucked away.
				</p>
			</div>
			{books.length === 0 && (
				<p className="surface p-5 text-muted">
					Finished books will gather here as a private reading diary.
				</p>
			)}
			{sortedBooks.map((book) => {
				const reflection = book.reflection ?? emptyReflection;
				const isEditing = editingMemoryId === book.id;
				const hasFeeling = reflection.feeling.trim().length > 0;
				const hasQuote = reflection.quote.trim().length > 0;
				const hasNote = reflection.note.trim().length > 0;
				const hasGiveTo = (reflection.giveTo ?? "").trim().length > 0;
				const finishedDate = formatFinishedDate(book.finishedAt);
				const hasNisserinNote = memoryMentionsNisserin(book, reflection);

				return (
					<article
						className="surface page-marker overflow-hidden p-0"
						key={book.id}
					>
						<div className="grid gap-4 p-5 pl-7 sm:grid-cols-[5rem_1fr_auto] sm:items-start">
							<BookCover book={book} />
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-2">
									<p className="text-xs font-bold uppercase tracking-[0.2em] text-sage">
										Finished memory
									</p>
									<span className="rounded-full bg-[var(--theme-accent-soft)] px-2.5 py-1 text-[0.68rem] font-bold text-sage">
										{finishedDate}
									</span>
									{book.rating ? <RatingPill rating={book.rating} /> : null}
								</div>
								<h3 className="mt-2 font-serif text-3xl leading-none text-ink">
									{book.title}
								</h3>
								<p className="mt-1 text-sm text-muted">{book.author}</p>
							</div>
							<div className="flex sm:justify-end">
								<button
									className="tap rounded-full border border-[var(--theme-line)] px-3 py-2 text-xs font-bold text-sage"
									onClick={() => setEditingMemoryId(isEditing ? null : book.id)}
									type="button"
								>
									{isEditing ? "Close" : "Edit memory"}
								</button>
							</div>
						</div>

						{isEditing ? (
							<div className="grid gap-3 border-t border-[var(--theme-line)] p-5 pl-7">
								<div>
									<p className="text-sm font-bold text-ink">Private rating</p>
									<RatingControl
										rating={book.rating}
										onRate={(rating) => onUpdate(book.id, { rating })}
									/>
								</div>
								<label className="text-sm font-bold text-ink">
									How did this book make you feel?
									<textarea
										className="field mt-2 min-h-24"
										value={reflection.feeling}
										onChange={(event) =>
											onUpdate(book.id, {
												reflection: {
													...reflection,
													feeling: event.target.value,
												},
											})
										}
									/>
								</label>
								<label className="text-sm font-bold text-ink">
									What line stayed with you?
									<input
										className="field mt-2"
										value={reflection.quote}
										onChange={(event) =>
											onUpdate(book.id, {
												reflection: {
													...reflection,
													quote: event.target.value,
												},
											})
										}
									/>
								</label>
								<label className="text-sm font-bold text-ink">
									Private note
									<textarea
										className="field mt-2 min-h-20"
										value={reflection.note}
										onChange={(event) =>
											onUpdate(book.id, {
												reflection: { ...reflection, note: event.target.value },
											})
										}
									/>
								</label>
								<label className="text-sm font-bold text-ink">
									Who would you give it to?
									<input
										className="field mt-2"
										value={reflection.giveTo ?? ""}
										onChange={(event) =>
											onUpdate(book.id, {
												reflection: {
													...reflection,
													giveTo: event.target.value,
												},
											})
										}
									/>
								</label>
								<label className="flex items-center gap-3 text-sm font-bold text-ink">
									<input
										checked={reflection.wouldReread}
										type="checkbox"
										onChange={(event) =>
											onUpdate(book.id, {
												reflection: {
													...reflection,
													wouldReread: event.target.checked,
												},
											})
										}
									/>
									Would reread
								</label>
								<button
									className="tap w-fit rounded-full bg-burgundy px-5 py-3 font-bold text-paper"
									onClick={saveMemory}
									type="button"
								>
									Save memory
								</button>
							</div>
						) : (
							<div className="grid gap-4 border-t border-[var(--theme-line)] p-5 pl-7">
								{hasNisserinNote && <NisserinJournalNote />}
								<div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
									<MemoryField
										label="How it felt"
										text={
											hasFeeling
												? reflection.feeling
												: "No feeling saved yet. Add one when the book settles."
										}
									/>
									<MemoryField
										label="Line that stayed"
										quote
										text={hasQuote ? reflection.quote : "No line saved yet."}
									/>
								</div>
								{hasNote && (
									<MemoryField label="Private note" text={reflection.note} />
								)}
								<div className="flex flex-wrap gap-2">
									<span className="rounded-full bg-[var(--theme-accent-soft)] px-3 py-2 text-xs font-bold text-sage">
										{book.rating ? `${book.rating}/5 remembered` : "No rating"}
									</span>
									<span className="rounded-full bg-[var(--theme-accent-soft)] px-3 py-2 text-xs font-bold text-sage">
										{hasGiveTo
											? `Give to ${reflection.giveTo}`
											: "No person named"}
									</span>
									<span className="rounded-full bg-[var(--theme-accent-soft)] px-3 py-2 text-xs font-bold text-sage">
										{reflection.wouldReread ? "Would reread" : "No reread note"}
									</span>
								</div>
							</div>
						)}
					</article>
				);
			})}
		</section>
	);
}

function FinishReflectionSheet({
	book,
	onClose,
	onUpdate,
}: {
	book: Book;
	onClose: (saved: boolean) => void;
	onUpdate: (id: string, updates: Partial<Book>) => void;
}) {
	const reflection = book.reflection ?? emptyReflection;
	const { dialogRef, initialFocusRef } = useDialogEffects({
		isOpen: true,
		onClose: () => onClose(false),
	});

	function updateReflection(updates: Partial<typeof reflection>) {
		onUpdate(book.id, {
			reflection: {
				...reflection,
				...updates,
			},
		});
	}

	function updateRating(rating?: number) {
		onUpdate(book.id, { rating });
	}

	return (
		<div className="fixed inset-0 z-30 flex items-end bg-ink/35 px-3 pt-12 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
			<button
				aria-label="Skip reflection"
				className="absolute inset-0 cursor-default"
				onClick={() => onClose(false)}
				type="button"
			/>
			<section
				aria-labelledby="finish-title"
				aria-modal="true"
				className="surface soft-scroll relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.75rem] p-5 sm:max-w-2xl sm:rounded-[1.75rem] sm:p-6"
				ref={dialogRef}
				role="dialog"
			>
				<div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/15 sm:hidden" />
				<div className="grid gap-4 sm:grid-cols-[5rem_1fr]">
					<BookCover book={book} />
					<div>
						<p className="text-sm font-bold text-sage">Finished</p>
						<h2
							className="mt-1 font-serif text-3xl leading-none text-ink"
							id="finish-title"
						>
							How did it leave you?
						</h2>
						<p className="mt-2 text-sm leading-6 text-muted">
							Capture the feeling while it is still close. You can edit this
							later in Journal.
						</p>
					</div>
				</div>

				<div className="mt-5 grid gap-3">
					<div>
						<p className="text-sm font-bold text-ink">A tiny rating</p>
						<p className="mt-1 text-xs leading-5 text-muted">
							Private, optional, and allowed to be emotional instead of precise.
						</p>
						<RatingControl rating={book.rating} onRate={updateRating} />
					</div>
					<label className="text-sm font-bold text-ink">
						How did this book make you feel?
						<textarea
							className="field mt-2 min-h-24"
							placeholder="Quiet, wrecked, lighter, annoyed, changed..."
							value={reflection.feeling}
							onChange={(event) =>
								updateReflection({ feeling: event.target.value })
							}
						/>
					</label>
					<label className="text-sm font-bold text-ink">
						What line stayed with you?
						<input
							className="field mt-2"
							placeholder="A sentence, image, or thought"
							value={reflection.quote}
							onChange={(event) =>
								updateReflection({ quote: event.target.value })
							}
						/>
					</label>
					<label className="text-sm font-bold text-ink">
						Who would you give it to?
						<input
							className="field mt-2"
							placeholder="A friend, a past version of you, nobody"
							value={reflection.giveTo ?? ""}
							onChange={(event) =>
								updateReflection({ giveTo: event.target.value })
							}
						/>
					</label>
					<label className="flex items-center gap-3 text-sm font-bold text-ink">
						<input
							checked={reflection.wouldReread}
							type="checkbox"
							onChange={(event) =>
								updateReflection({ wouldReread: event.target.checked })
							}
						/>
						Would reread
					</label>
				</div>

				<div className="mt-5 flex flex-wrap gap-2">
					<button
						className="tap rounded-full bg-burgundy px-5 py-3 font-bold text-paper"
						onClick={() => onClose(true)}
						ref={(element) => {
							initialFocusRef.current = element;
						}}
						type="button"
					>
						Save memory
					</button>
					<button
						className="tap rounded-full border border-[var(--theme-line)] px-5 py-3 font-bold text-ink"
						onClick={() => onClose(false)}
						type="button"
					>
						Skip for now
					</button>
				</div>
			</section>
		</div>
	);
}

function MemoryField({
	label,
	quote = false,
	text,
}: {
	label: string;
	quote?: boolean;
	text: string;
}) {
	return (
		<div
			className={
				quote
					? "rounded-[1.35rem] bg-[var(--theme-surface-muted)] px-4 py-4"
					: ""
			}
		>
			<p className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-muted">
				{label}
			</p>
			<p
				className={`${quote ? "font-serif text-2xl italic leading-snug" : "text-sm leading-6"} mt-1 text-ink`}
			>
				{quote ? `"${text}"` : text}
			</p>
		</div>
	);
}

function NisserinJournalNote() {
	return (
		<aside className="rounded-[1.35rem] border border-[#9B6A7A]/25 bg-[#F5E8EC] px-4 py-3 text-[#3F2D33]">
			<p className="text-[0.68rem] font-black uppercase tracking-[0.22em] text-[#8A5263]">
				A margin note
			</p>
			<p className="mt-2 text-sm leading-6 text-[#684D56]">
				Someone with excellent taste has passed through this page. The book is
				still pretending to be calm about it.
			</p>
		</aside>
	);
}

function sortFinishedBooks(books: Book[]) {
	return [...books].sort((a, b) => {
		const aTime = new Date(a.finishedAt ?? a.addedAt).getTime();
		const bTime = new Date(b.finishedAt ?? b.addedAt).getTime();
		return bTime - aTime;
	});
}

function memoryMentionsNisserin(
	book: Book,
	reflection: typeof emptyReflection,
) {
	const memoryText = [
		book.title,
		book.author,
		reflection.feeling,
		reflection.quote,
		reflection.note,
		reflection.giveTo ?? "",
	]
		.join(" ")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();

	return memoryText.includes("nisserin");
}

function formatFinishedDate(date?: string) {
	if (!date) return "Finished someday";
	return new Intl.DateTimeFormat("en", {
		day: "numeric",
		month: "short",
		year: "numeric",
	}).format(new Date(date));
}

function formatShortDateTime(date: string) {
	return new Intl.DateTimeFormat("en", {
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		month: "short",
	}).format(new Date(date));
}

function AppToast({ message }: { message: string }) {
	if (!message) return null;

	return (
		<div className="fixed left-1/2 bottom-24 z-40 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded-full border border-[var(--theme-line)] bg-paper/95 px-4 py-3 text-center text-sm font-bold text-ink shadow-soft backdrop-blur">
			{message}
		</div>
	);
}

function EmptyState({
	actionLabel,
	description,
	eyebrow,
	onAction,
	title,
}: {
	actionLabel: string;
	description: string;
	eyebrow: string;
	onAction: () => void;
	title: string;
}) {
	return (
		<section className="surface page-marker p-6 pl-7">
			<p className="text-xs font-bold uppercase tracking-[0.24em] text-sage">
				{eyebrow}
			</p>
			<h2 className="mt-3 max-w-xl font-serif text-3xl leading-none text-ink">
				{title}
			</h2>
			<p className="mt-3 max-w-xl text-sm leading-6 text-muted">
				{description}
			</p>
			<div className="mt-5 grid gap-2 text-sm text-muted sm:grid-cols-3">
				<p className="rounded-2xl bg-[var(--theme-accent-soft)] px-4 py-3">
					Add what you might read.
				</p>
				<p className="rounded-2xl bg-[var(--theme-accent-soft)] px-4 py-3">
					Mark what is open now.
				</p>
				<p className="rounded-2xl bg-[var(--theme-accent-soft)] px-4 py-3">
					Remember what stayed.
				</p>
			</div>
			<button
				className="tap mt-6 rounded-full bg-burgundy px-5 py-3 font-bold text-paper"
				onClick={onAction}
				type="button"
			>
				<Plus className="mr-1 inline size-4" />
				{actionLabel}
			</button>
		</section>
	);
}

function BookCard({
	book,
	onChangeStatus,
	onDelete,
	onEdit,
}: {
	book: Book;
	onChangeStatus: (book: Book, status: BookStatus) => void;
	onDelete: (id: string) => void;
	onEdit: (book: Book) => void;
}) {
	const progress = getProgressPercent(book);

	return (
		<article className="surface grid grid-cols-[4.25rem_1fr] gap-4 p-3 sm:grid-cols-[5rem_1fr] sm:p-4">
			<BookCover book={book} />
			<div className="min-w-0 py-1">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<h3 className="font-serif text-[1.35rem] leading-[1.02] text-ink">
							{book.title}
						</h3>
						<p className="mt-1 text-sm text-muted">{book.author}</p>
					</div>
					<button
						className="tap -mr-1 rounded-full px-3 py-1.5 text-xs font-bold text-sage"
						onClick={() => onEdit(book)}
						type="button"
					>
						Edit
					</button>
				</div>

				{book.progress && (
					<div className="mt-4">
						<div className="flex items-center justify-between text-xs font-bold text-muted">
							<span>{book.progress.currentPage} pages in</span>
							<span>{progress}%</span>
						</div>
						<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--theme-accent-soft)]">
							<div
								className="h-full rounded-full bg-sage"
								style={{ width: `${progress}%` }}
							/>
						</div>
					</div>
				)}

				<div className="mt-3 flex flex-wrap gap-1.5">
					{book.moodTags.slice(0, 3).map((tag) => (
						<span
							className="rounded-full bg-[var(--theme-accent-soft)] px-2.5 py-1 text-xs font-bold text-sage"
							key={tag}
						>
							{tag}
						</span>
					))}
				</div>

				<div className="mt-4 flex items-center gap-2 border-t border-[var(--theme-line)] pt-3">
					<label className="min-w-0 flex-1">
						<span className="sr-only">Status</span>
						<select
							className="field py-2 text-sm"
							value={book.status}
							onChange={(event) =>
								onChangeStatus(book, event.target.value as BookStatus)
							}
						>
							{Object.entries(statusLabels).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<button
						aria-label={`Delete ${book.title}`}
						className="tap rounded-full border border-[var(--theme-line)] px-3 py-2 text-sm font-bold text-muted"
						onClick={() => onDelete(book.id)}
						type="button"
					>
						<Trash2 className="size-4" />
					</button>
				</div>
			</div>
		</article>
	);
}

function BookCover({ book, large = false }: { book: Book; large?: boolean }) {
	const sizeClass = large ? "h-56 w-36" : "h-24 w-16 sm:h-28 sm:w-20";

	if (book.coverUrl) {
		return (
			<img
				alt=""
				className={`${sizeClass} shrink-0 rounded-r-xl rounded-l-sm object-cover shadow-cover`}
				src={book.coverUrl}
			/>
		);
	}

	return (
		<div
			className={`${sizeClass} shrink-0 rounded-r-xl rounded-l-sm p-3 text-white shadow-cover`}
			style={{ background: book.coverColor ?? coverColors[0] }}
		>
			<div className="flex h-full min-w-0 flex-col overflow-hidden border-l border-white/30 pl-3">
				<p className="line-clamp-5 break-words font-serif text-sm font-semibold leading-tight">
					{book.title}
				</p>
				<p className="mt-2 line-clamp-2 break-words text-[0.65rem] leading-tight opacity-80">
					{book.author}
				</p>
			</div>
		</div>
	);
}

function ThemeChooser({
	theme,
	onTheme,
}: {
	theme: ThemeName;
	onTheme: (theme: ThemeName) => void;
}) {
	return (
		<fieldset className="flex rounded-full border border-[var(--theme-line)] bg-paper/70 p-1">
			<legend className="sr-only">Theme</legend>
			{themes.map((item) => (
				<button
					aria-label={`Use ${item} theme`}
					aria-pressed={theme === item}
					className={`h-8 w-8 rounded-full text-[0.65rem] font-bold capitalize ${theme === item ? "bg-sage text-paper" : "text-muted"}`}
					key={item}
					onClick={() => onTheme(item)}
					type="button"
				>
					{item.slice(0, 1)}
				</button>
			))}
		</fieldset>
	);
}

function getProgressPercent(book: Book) {
	if (!book.progress || book.progress.totalPages <= 0) return 0;
	return Math.min(
		100,
		Math.round((book.progress.currentPage / book.progress.totalPages) * 100),
	);
}

function sortReadingBooks(books: Book[]) {
	return [...books].sort((a, b) => readingTime(b) - readingTime(a));
}

function readingTime(book: Book) {
	return new Date(book.startedAt ?? book.addedAt).getTime();
}

function statusHint(status: BookStatus) {
	if (status === "reading") return "open now";
	if (status === "want") return "waiting";
	if (status === "finished") return "remembered";
	return "set aside";
}

function emptyStatusCopy(status: BookStatus) {
	if (status === "reading")
		return "No current read. Pick one when the mood is right.";
	if (status === "want")
		return "No waiting books yet. Add a title you keep thinking about.";
	if (status === "finished") return "Finished books will become memories here.";
	return "Paused books can wait here without guilt.";
}

function loadTheme(): ThemeName {
	if (typeof window === "undefined") return "paper";
	const stored = window.localStorage.getItem(themeStorageKey);
	return themes.includes(stored as ThemeName) ? (stored as ThemeName) : "paper";
}

function loadFocusedReadingId() {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem(focusedReadingStorageKey);
}

async function searchOpenLibrary(query: string): Promise<OpenLibraryResult[]> {
	const params = new URLSearchParams({
		language: "eng",
		limit: "18",
		q: query,
	});
	const response = await fetch(`https://openlibrary.org/search.json?${params}`);

	if (!response.ok) {
		throw new Error("Open Library search failed");
	}

	const data = (await response.json()) as OpenLibrarySearchResponse;
	if (import.meta.env.DEV) {
		console.log(
			"Open Library search docs",
			(data.docs ?? []).slice(0, 6).map((doc) => ({
				title: doc.title,
				author: doc.author_name?.[0],
				number_of_pages_median: doc.number_of_pages_median,
				cover_i: doc.cover_i,
				key: doc.key,
			})),
		);
	}
	return (data.docs ?? [])
		.map((doc, index) => {
			const title = getPreferredOpenLibraryTitle(doc);
			const author = getPreferredOpenLibraryAuthor(doc);

			if (!title || !author) return null;

			return {
				key: doc.key ?? `${title}-${author}-${index}`,
				title,
				author,
				coverUrl: doc.cover_i
					? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
					: undefined,
				pageCount: doc.number_of_pages_median,
				year: doc.first_publish_year,
			};
		})
		.filter((result): result is OpenLibraryResult => result !== null)
		.sort(
			(a, b) =>
				scoreOpenLibraryResult(b, query) - scoreOpenLibraryResult(a, query),
		)
		.slice(0, 6);
}

async function getOpenLibraryDiscoveries({
	book,
	energy,
	mode,
}: {
	book?: Book;
	energy: string;
	mode: DiscoveryMode;
}): Promise<OpenLibraryResult[]> {
	if (mode === "author" && book?.author) {
		return searchOpenLibrary(`author:${book.author}`);
	}

	const subject = getDiscoverySubject(energy, book).subject;
	const response = await fetch(
		`https://openlibrary.org/subjects/${subject}.json?limit=9`,
	);

	if (!response.ok) {
		throw new Error("Open Library subject lookup failed");
	}

	const data = (await response.json()) as OpenLibrarySubjectResponse;
	return (data.works ?? [])
		.map((work, index) => {
			const title = work.title?.trim();
			const author = work.authors?.[0]?.name?.trim();

			if (!title || !author) return null;

			return {
				key: work.key ?? `/works/discovery-${index}`,
				title,
				author,
				coverUrl: work.cover_id
					? `https://covers.openlibrary.org/b/id/${work.cover_id}-M.jpg`
					: undefined,
				year: work.first_publish_year,
			};
		})
		.filter((result): result is OpenLibraryResult => result !== null);
}

async function getOpenLibraryEditionPageCount(
	workKey: string,
	selectedTitle: string,
) {
	if (!workKey.startsWith("/works/")) return null;

	const response = await fetch(
		`https://openlibrary.org${workKey}/editions.json?limit=12`,
	);

	if (!response.ok) {
		throw new Error("Open Library editions lookup failed");
	}

	const data = (await response.json()) as OpenLibraryEditionsResponse;
	const normalizedSelectedTitle = normalizeBookTitle(selectedTitle);
	const candidates = (data.entries ?? [])
		.map((edition) => ({
			pageCount: getEditionPageCount(edition),
			title: edition.title ?? "",
		}))
		.filter((candidate) => candidate.pageCount !== null)
		.sort((a, b) => {
			const aMatches = normalizeBookTitle(a.title) === normalizedSelectedTitle;
			const bMatches = normalizeBookTitle(b.title) === normalizedSelectedTitle;

			if (aMatches === bMatches) return 0;
			return aMatches ? -1 : 1;
		});

	if (import.meta.env.DEV) {
		console.log("Open Library edition page counts", {
			workKey,
			selectedTitle,
			candidates,
		});
	}

	return candidates[0]?.pageCount ?? null;
}

function getEditionPageCount(edition: OpenLibraryEdition) {
	if (
		edition.number_of_pages &&
		Number.isFinite(edition.number_of_pages) &&
		edition.number_of_pages > 0
	) {
		return edition.number_of_pages;
	}

	const paginationNumber = edition.pagination?.match(/\d+/)?.[0];
	if (!paginationNumber) return null;

	const parsed = Number(paginationNumber);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBookTitle(title: string) {
	return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function getPreferredOpenLibraryTitle(doc: OpenLibraryDoc) {
	return (
		[doc.title_suggest, doc.title]
			.map((title) => title?.trim())
			.find((title): title is string => Boolean(title && isLatinText(title))) ??
		doc.title?.trim() ??
		doc.title_suggest?.trim() ??
		""
	);
}

function getPreferredOpenLibraryAuthor(doc: OpenLibraryDoc) {
	return (
		doc.author_name
			?.map((author) => author.trim())
			.find((author) => isLatinText(author)) ??
		doc.author_name?.[0]?.trim() ??
		""
	);
}

function scoreOpenLibraryResult(result: OpenLibraryResult, query: string) {
	let score = 0;
	const normalizedQuery = normalizeBookTitle(query);
	const normalizedTitle = normalizeBookTitle(result.title);
	if (isLatinText(result.title)) score += 8;
	if (isLatinText(result.author)) score += 4;
	if (normalizedTitle === normalizedQuery) score += 12;
	if (normalizedQuery && normalizedTitle.includes(normalizedQuery)) score += 6;
	if (queryWordOverlap(normalizedTitle, normalizedQuery) >= 0.5) score += 3;
	if (result.coverUrl) score += 1;
	if (result.pageCount) score += 1;
	if (result.year) score += 1;
	return score;
}

function queryWordOverlap(title: string, query: string) {
	const queryWords = query.split(" ").filter((word) => word.length > 2);
	if (queryWords.length === 0) return 0;
	const titleWords = new Set(title.split(" "));
	const matches = queryWords.filter((word) => titleWords.has(word)).length;
	return matches / queryWords.length;
}

function isLatinText(text: string) {
	const letters = [...text].filter((char) => /\p{L}/u.test(char));
	if (letters.length === 0) return true;
	const latinLetters = letters.filter((char) => /\p{Script=Latin}/u.test(char));
	return latinLetters.length / letters.length >= 0.75;
}

function getDiscoverySubject(energy: string, book?: Book) {
	if (book?.moodTags.includes("romantic")) {
		return { label: "romance", subject: "romance" };
	}
	if (book?.moodTags.includes("dark")) {
		return { label: "dark fiction", subject: "dark_fiction" };
	}
	if (book?.moodTags.includes("funny")) {
		return { label: "humor", subject: "humor" };
	}
	if (energy === "soft and easy") {
		return { label: "comfort reads", subject: "juvenile_fiction" };
	}
	if (energy === "hurt a little") {
		return { label: "literary fiction", subject: "literary_fiction" };
	}
	if (energy === "fast and sticky") {
		return { label: "thrillers", subject: "thriller" };
	}
	if (energy === "beautiful sentences") {
		return { label: "poetic fiction", subject: "poetry" };
	}
	if (energy === "strange and smart") {
		return { label: "philosophy", subject: "philosophy" };
	}
	return { label: "something odd", subject: "speculative_fiction" };
}

function rankBooks(books: Book[], energy: string) {
	const tags = energyMap[energy];
	if (energy === "surprise me") {
		return [...books].sort((a, b) => {
			const statusDiff = statusPickWeight(b) - statusPickWeight(a);
			if (statusDiff !== 0) return statusDiff;
			return a.addedAt.localeCompare(b.addedAt);
		});
	}
	return [...books].sort((a, b) => {
		const scoreDiff = scoreBook(b, tags) - scoreBook(a, tags);
		if (scoreDiff !== 0) return scoreDiff;
		return b.addedAt.localeCompare(a.addedAt);
	});
}

function scoreBook(book: Book, tags: MoodTag[]) {
	const tagScore = book.moodTags.filter((tag) => tags.includes(tag)).length * 3;
	const pausedNudge = book.status === "paused" ? 1 : 0;
	const shortNudge = book.moodTags.includes("short") ? 1 : 0;
	return tagScore + pausedNudge + shortNudge + statusPickWeight(book);
}

function statusPickWeight(book: Book) {
	return book.status === "want" ? 2 : 0;
}

function pickSubtitle(energy: string) {
	if (energy === "soft and easy") return "Low pressure, quick to enter";
	if (energy === "hurt a little") return "Feelings, ache, aftertaste";
	if (energy === "fast and sticky") return "Momentum over manners";
	if (energy === "beautiful sentences") return "For reading slowly";
	if (energy === "strange and smart") return "Odd corners, sharper edges";
	return "Let the shelf interrupt you";
}

function pickReason(book: Book, energy: string, matches: MoodTag[]) {
	if (energy === "surprise me") {
		return book.status === "paused"
			? `${book.title} has been paused long enough to become interesting again. Surprise mode is giving it a quiet tap on the spine.`
			: `${book.title} is waiting on your shelf, and surprise mode is choosing by instinct rather than matching a mood.`;
	}

	if (matches.length === 0) {
		return book.status === "paused"
			? `${book.title} is not a clean match for ${energy}, but it is already half-open in your reading life. That can be reason enough to return.`
			: `${book.title} is not a perfect tag match, but it is already saved and ready. Sometimes that is enough of a reason.`;
	}

	const tagList = readableList(matches.map(moodTagLabel));
	const moodNote = pickMoodNote(energy, matches);
	const statusNote =
		book.status === "paused"
			? " It was paused before, so this is a low-pressure invitation to return rather than start from zero."
			: "";

	return `${moodNote} You tagged it ${tagList}.${statusNote}`;
}

function pickMoodNote(energy: string, matches: MoodTag[]) {
	if (energy === "soft and easy") {
		return matches.includes("short")
			? "This should be easy to enter and not too heavy to carry."
			: "This looks like a gentle door back into reading.";
	}
	if (energy === "hurt a little") {
		return "This has enough ache or tenderness to leave an aftertaste.";
	}
	if (energy === "fast and sticky") {
		return "This has the kind of pull that can make one more chapter happen by accident.";
	}
	if (energy === "beautiful sentences") {
		return "This is a slower pick, better for noticing the shape of the sentences.";
	}
	if (energy === "strange and smart") {
		return "This has odd corners and enough bite to keep your attention awake.";
	}
	return "The shelf is following the strongest mood signal it can find.";
}

function moodTagLabel(tag: MoodTag) {
	if (tag === "smart") return "sharp";
	if (tag === "easy") return "easygoing";
	return tag;
}

function readableList(items: string[]) {
	if (items.length === 1) return items[0];
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function tabIcon(tab: Tab) {
	const className = "mx-auto size-5";
	if (tab === "Now") return <BookOpen className={className} />;
	if (tab === "Shelf") return <Library className={className} />;
	if (tab === "Pick") return <Sparkles className={className} />;
	return <NotebookPen className={className} />;
}
