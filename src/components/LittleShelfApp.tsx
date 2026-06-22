import {
	BookOpen,
	Dice5,
	Library,
	NotebookPen,
	Plus,
	Search,
	Sparkles,
	Trash2,
} from "lucide-react";
import {
	type Dispatch,
	type SetStateAction,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
	seedBooks,
	statusLabels,
} from "./bookData";

const storageKey = "little-shelf-books";
const themeStorageKey = "little-shelf-theme";
const focusedReadingStorageKey = "little-shelf-focused-reading";
const tabs = ["Now", "Shelf", "Pick", "Journal"] as const;
type Tab = (typeof tabs)[number];
const themes = ["paper", "moss", "plum", "night"] as const;
type ThemeName = (typeof themes)[number];

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
	author_name?: string[];
	cover_i?: number;
	number_of_pages_median?: number;
	first_publish_year?: number;
};

type OpenLibrarySearchResponse = {
	docs?: OpenLibraryDoc[];
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
	const [books, setBooks] = useState<Book[]>(() => loadBooks());
	const [activeTab, setActiveTab] = useState<Tab>("Now");
	const [draft, setDraft] = useState<BookDraft>(blankDraft);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [isBookSheetOpen, setIsBookSheetOpen] = useState(false);
	const [finishingBookId, setFinishingBookId] = useState<string | null>(null);
	const [energy, setEnergy] = useState(energyLabels[0]);
	const [pickIndex, setPickIndex] = useState(0);
	const [theme, setTheme] = useState<ThemeName>(() => loadTheme());
	const [focusedReadingId, setFocusedReadingId] = useState<string | null>(() =>
		loadFocusedReadingId(),
	);

	useEffect(() => {
		window.localStorage.setItem(storageKey, JSON.stringify(books));
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

	function openAddBook() {
		setActiveTab("Shelf");
		setDraft(blankDraft);
		setEditingId(null);
		setIsBookSheetOpen(true);
	}

	function closeBookSheet() {
		setDraft(blankDraft);
		setEditingId(null);
		setIsBookSheetOpen(false);
	}

	function saveDraft() {
		if (!draft.title.trim() || !draft.author.trim()) return;
		const totalPages = Number(draft.totalPages) || 0;
		const currentPage = Number(draft.currentPage) || 0;
		const progress =
			totalPages > 0
				? { currentPage: Math.min(currentPage, totalPages), totalPages }
				: undefined;

		if (editingId) {
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
	}

	const finishingBook = books.find((book) => book.id === finishingBookId);

	return (
		<main className="mx-auto min-h-dvh w-full max-w-5xl px-4 pb-28 pt-5 text-ink sm:px-6 lg:pb-10">
			<header className="mb-6 flex items-start justify-between gap-4">
				<div>
					<p className="mb-2 text-[0.68rem] font-bold uppercase tracking-[0.26em] text-sage">
						Little Shelf
					</p>
					<h1 className="max-w-64 font-serif text-[2rem] font-semibold leading-[0.96] text-ink sm:max-w-none sm:text-4xl">
						Your quiet reading corner
					</h1>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<ThemeChooser theme={theme} onTheme={setTheme} />
					<button
						className="tap rounded-full bg-burgundy px-4 py-2.5 text-sm font-bold text-paper shadow-soft"
						onClick={openAddBook}
						type="button"
					>
						<Plus className="mr-1 inline size-4" /> Add
					</button>
				</div>
			</header>

			{activeTab === "Now" && (
				<NowScreen
					books={orderedReadingBooks}
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
					onOpenAdd={openAddBook}
				/>
			)}
			{activeTab === "Pick" && (
				<PickScreen
					book={pickedBook}
					energy={energy}
					onEnergy={(value) => {
						setEnergy(value);
						setPickIndex(0);
					}}
					onReshuffle={() => setPickIndex((value) => value + 1)}
				/>
			)}
			{activeTab === "Journal" && (
				<JournalScreen books={finishedBooks} onUpdate={updateBook} />
			)}

			<nav className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--theme-line)] bg-cream/90 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 shadow-[0_-14px_30px_var(--theme-shadow)] backdrop-blur lg:left-1/2 lg:w-[28rem] lg:-translate-x-1/2 lg:rounded-t-3xl lg:border-x">
				<div className="grid grid-cols-4 gap-1">
					{tabs.map((tab) => (
						<button
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

			{finishingBook && (
				<FinishReflectionSheet
					book={finishingBook}
					onClose={() => setFinishingBookId(null)}
					onUpdate={updateBook}
				/>
			)}
		</main>
	);
}

function NowScreen({
	books,
	onFocus,
	onPick,
	onUpdate,
}: {
	books: Book[];
	onFocus: (bookId: string) => void;
	onPick: () => void;
	onUpdate: (id: string, updates: Partial<Book>) => void;
}) {
	if (books.length === 0) {
		return (
			<section className="surface page-marker p-6 pl-7">
				<p className="mb-3 text-sm font-bold text-sage">
					No open book right now
				</p>
				<h2 className="font-serif text-3xl text-ink">
					Let the shelf choose gently.
				</h2>
				<p className="mt-3 text-muted">
					Pick from books you already saved, based on what you have energy for
					today.
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
			<div>
				<p className="text-xs font-bold uppercase tracking-[0.22em] text-sage">
					{books.length} current {books.length === 1 ? "read" : "reads"}
				</p>
				<h2 className="mt-2 font-serif text-3xl leading-none text-ink">
					Continue where you left off.
				</h2>
			</div>

			<div className="surface page-marker grid gap-5 p-5 pl-7 sm:grid-cols-[11rem_1fr]">
				<BookCover book={featuredBook} large />
				<div>
					<p className="text-sm font-bold text-sage">
						Most recent current read
					</p>
					<h3 className="mt-1 font-serif text-3xl leading-none text-ink">
						{featuredBook.title}
					</h3>
					<p className="mt-1 text-muted">{featuredBook.author}</p>
					{featuredBook.progress && (
						<>
							<div className="mt-5 h-3 overflow-hidden rounded-full bg-[var(--theme-accent-soft)]">
								<div
									className="h-full rounded-full bg-burgundy"
									style={{ width: `${progress}%` }}
								/>
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
							<p className="mt-2 text-sm text-muted">
								{progress}% through {featuredBook.progress.totalPages} pages
							</p>
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

			{otherBooks.length > 0 && (
				<section className="space-y-3">
					<div className="flex items-end justify-between border-b border-[var(--theme-line)] pb-2">
						<h3 className="font-serif text-2xl leading-none text-ink">
							Also open
						</h3>
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
		<article className="surface grid grid-cols-[4.25rem_1fr] gap-4 p-3 sm:grid-cols-[5rem_1fr] sm:p-4">
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
						className="tap -mr-1 rounded-full px-3 py-1.5 text-xs font-bold text-sage"
						onClick={() => onFocus(book.id)}
						type="button"
					>
						Focus
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
	onOpenAdd: () => void;
}) {
	const sections = ["reading", "want", "finished", "paused"] as BookStatus[];

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
			{sections.map((status) => {
				const books = props.books.filter((book) => book.status === status);

				return (
					<section className="space-y-3" key={status}>
						<div className="flex items-end justify-between gap-3 border-b border-[var(--theme-line)] pb-2">
							<div>
								<p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-muted">
									{statusHint(status)}
								</p>
								<h2 className="font-serif text-2xl leading-none text-ink">
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
										onDelete={props.onDelete}
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
			})}
		</section>
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
	const [searchError, setSearchError] = useState("");
	const pageLookupKeyRef = useRef<string | null>(null);
	const detailsRef = useRef<HTMLDivElement | null>(null);
	const titleInputRef = useRef<HTMLInputElement | null>(null);

	async function searchOnline() {
		const trimmedQuery =
			query.trim() || [draft.title, draft.author].filter(Boolean).join(" ");
		if (!trimmedQuery) return;

		setIsSearching(true);
		setSearchError("");

		try {
			const nextResults = await searchOpenLibrary(trimmedQuery);
			setResults(nextResults);
			if (nextResults.length === 0) {
				setSearchError("No matching books found. Manual add still works.");
			}
		} catch {
			setSearchError(
				"Could not reach Open Library. Try again or add it manually.",
			);
		} finally {
			setIsSearching(false);
		}
	}

	async function applyResult(result: OpenLibraryResult) {
		pageLookupKeyRef.current = result.key;
		setPageLookupKey(result.key);

		onChangeDraft((currentDraft) => ({
			...currentDraft,
			title: result.title,
			author: result.author,
			coverUrl: result.coverUrl ?? currentDraft.coverUrl,
			totalPages: result.pageCount
				? String(result.pageCount)
				: currentDraft.totalPages,
		}));
		requestAnimationFrame(() => {
			detailsRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
			titleInputRef.current?.focus({ preventScroll: true });
		});

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
				aria-modal="true"
				className="surface relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.75rem] p-5 sm:max-w-2xl sm:rounded-[1.75rem] sm:p-6"
				role="dialog"
			>
				<div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/15 sm:hidden" />
				<div className="flex items-start justify-between gap-4">
					<div>
						<p className="text-sm font-bold text-sage">
							{isEditing ? "Make it feel right" : "A new book for the shelf"}
						</p>
						<h2 className="mt-1 font-serif text-2xl text-ink">
							{isEditing ? "Edit book" : "Add a book"}
						</h2>
					</div>
					<button
						className="tap rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink"
						onClick={onCancel}
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
							placeholder="Title or author"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
						/>
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
					{searchError && (
						<p className="mt-2 text-xs font-bold text-muted">{searchError}</p>
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
								className="field min-h-12"
								placeholder="Title"
								ref={titleInputRef}
								value={draft.title}
								onChange={(event) =>
									onChangeDraft({ ...draft, title: event.target.value })
								}
							/>
						</label>
						<label className="grid gap-2 text-sm font-bold text-ink">
							Author
							<input
								className="field min-h-12"
								placeholder="Author"
								value={draft.author}
								onChange={(event) =>
									onChangeDraft({ ...draft, author: event.target.value })
								}
							/>
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
				<div className="mt-4 flex flex-wrap gap-2">
					{moodTags.map((tag) => (
						<button
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
						className="tap rounded-full bg-burgundy px-5 py-3 font-bold text-paper"
						onClick={onSave}
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
	onEnergy,
	onReshuffle,
}: {
	book?: Book;
	energy: string;
	onEnergy: (energy: string) => void;
	onReshuffle: () => void;
}) {
	const matches = book
		? book.moodTags.filter((tag) => energyMap[energy].includes(tag))
		: [];
	const reason = book ? pickReason(book, energy, matches) : "";
	const subtitle = pickSubtitle(energy);

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
					Choose the kind of attention you have. Little Shelf will stay inside
					your saved books.
				</p>
			</div>
			<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{energyLabels.map((option) => (
					<button
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
						<button
							className="tap mt-5 rounded-full bg-burgundy px-5 py-3 font-bold text-paper"
							onClick={onReshuffle}
							type="button"
						>
							<Dice5 className="mr-2 inline size-4" />
							Reshuffle
						</button>
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
		</section>
	);
}

function JournalScreen({
	books,
	onUpdate,
}: {
	books: Book[];
	onUpdate: (id: string, updates: Partial<Book>) => void;
}) {
	return (
		<section className="space-y-4">
			<div>
				<p className="text-sm font-bold uppercase tracking-[0.24em] text-sage">
					Journal
				</p>
				<h2 className="mt-2 font-serif text-3xl text-ink">
					Finished books as memories
				</h2>
			</div>
			{books.length === 0 && (
				<p className="surface p-5 text-muted">
					Finished books will gather here as a private reading diary.
				</p>
			)}
			{books.map((book) => {
				const reflection = book.reflection ?? emptyReflection;
				return (
					<article className="surface page-marker p-5 pl-7" key={book.id}>
						<div className="flex gap-4">
							<BookCover book={book} />
							<div>
								<h3 className="font-serif text-2xl text-ink">{book.title}</h3>
								<p className="text-sm text-muted">{book.author}</p>
							</div>
						</div>
						<div className="mt-4 grid gap-3">
							<label className="text-sm font-bold text-ink">
								How did this book make you feel?
								<textarea
									className="field mt-2"
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
											reflection: { ...reflection, quote: event.target.value },
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
											reflection: { ...reflection, giveTo: event.target.value },
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
						</div>
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
	onClose: () => void;
	onUpdate: (id: string, updates: Partial<Book>) => void;
}) {
	const reflection = book.reflection ?? emptyReflection;

	function updateReflection(updates: Partial<typeof reflection>) {
		onUpdate(book.id, {
			reflection: {
				...reflection,
				...updates,
			},
		});
	}

	return (
		<div className="fixed inset-0 z-30 flex items-end bg-ink/35 px-3 pt-12 backdrop-blur-sm sm:items-center sm:justify-center sm:p-6">
			<button
				aria-label="Skip reflection"
				className="absolute inset-0 cursor-default"
				onClick={onClose}
				type="button"
			/>
			<section
				aria-modal="true"
				className="surface relative max-h-[88dvh] w-full overflow-y-auto rounded-t-[1.75rem] p-5 sm:max-w-2xl sm:rounded-[1.75rem] sm:p-6"
				role="dialog"
			>
				<div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/15 sm:hidden" />
				<div className="grid gap-4 sm:grid-cols-[5rem_1fr]">
					<BookCover book={book} />
					<div>
						<p className="text-sm font-bold text-sage">Finished</p>
						<h2 className="mt-1 font-serif text-3xl leading-none text-ink">
							How did it leave you?
						</h2>
						<p className="mt-2 text-sm leading-6 text-muted">
							Capture the feeling while it is still close. You can edit this
							later in Journal.
						</p>
					</div>
				</div>

				<div className="mt-5 grid gap-3">
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
						onClick={onClose}
						type="button"
					>
						Save memory
					</button>
					<button
						className="tap rounded-full border border-[var(--theme-line)] px-5 py-3 font-bold text-ink"
						onClick={onClose}
						type="button"
					>
						Skip for now
					</button>
				</div>
			</section>
		</div>
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

function loadBooks() {
	if (typeof window === "undefined") return seedBooks;
	const stored = window.localStorage.getItem(storageKey);
	if (!stored) return seedBooks;
	try {
		const parsed = JSON.parse(stored) as Book[];
		return parsed.length ? parsed : seedBooks;
	} catch {
		return seedBooks;
	}
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
		limit: "6",
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
			const title = doc.title?.trim();
			const author = doc.author_name?.[0]?.trim();

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

function rankBooks(books: Book[], energy: string) {
	const tags = energyMap[energy];
	if (energy === "surprise me") {
		return [...books].sort((a, b) => a.addedAt.localeCompare(b.addedAt));
	}
	return [...books].sort((a, b) => scoreBook(b, tags) - scoreBook(a, tags));
}

function scoreBook(book: Book, tags: MoodTag[]) {
	const tagScore = book.moodTags.filter((tag) => tags.includes(tag)).length * 3;
	const pausedNudge = book.status === "paused" ? 1 : 0;
	const shortNudge = book.moodTags.includes("short") ? 1 : 0;
	return tagScore + pausedNudge + shortNudge;
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
		return `${book.title} is waiting on your shelf, and surprise mode is choosing by instinct rather than matching a mood.`;
	}

	if (matches.length === 0) {
		return `${book.title} is not a perfect tag match, but it is already saved and ready. Sometimes that is enough of a reason.`;
	}

	const tagList = readableList(matches);
	const statusNote =
		book.status === "paused"
			? " It was paused, so this is also a gentle invitation to return."
			: "";

	return `This fits ${energy} because you tagged it ${tagList}.${statusNote}`;
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
