import {
	type Book,
	type BookStatus,
	coverColors,
	emptyReflection,
	type MoodTag,
	moodTags,
} from "./bookData";

export const storageKey = "little-shelf-books";
export const backupVersion = 1;

export type ShelfBackup = {
	app: "little-shelf";
	version: typeof backupVersion;
	exportedAt: string;
	books: Book[];
};

type ImportResult =
	| { ok: true; books: Book[] }
	| { ok: false; message: string };

const statuses: BookStatus[] = ["want", "reading", "finished", "paused"];

export function loadBooks() {
	if (typeof window === "undefined") return [];
	const stored = window.localStorage.getItem(storageKey);
	if (!stored) return [];
	const result = parseBooksJson(stored);
	return result.ok ? result.books : [];
}

export function createShelfBackup(books: Book[]): ShelfBackup {
	return {
		app: "little-shelf",
		version: backupVersion,
		exportedAt: new Date().toISOString(),
		books: normalizeBooks(books),
	};
}

export function serializeShelfBackup(books: Book[]) {
	return JSON.stringify(createShelfBackup(books), null, 2);
}

export function parseBooksJson(json: string): ImportResult {
	let parsed: unknown;

	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, message: "Choose a valid Little Shelf JSON file." };
	}

	return parseBooksValue(parsed);
}

export function parseBooksValue(value: unknown): ImportResult {
	const candidateBooks = Array.isArray(value)
		? value
		: isRecord(value) && Array.isArray(value.books)
			? value.books
			: null;

	if (!candidateBooks) {
		return { ok: false, message: "This file does not contain a shelf backup." };
	}

	const books = normalizeBooks(candidateBooks);
	if (books.length === 0 && candidateBooks.length > 0) {
		return { ok: false, message: "No readable books were found in this file." };
	}

	return { ok: true, books };
}

export function normalizeBooks(value: unknown): Book[] {
	if (!Array.isArray(value)) return [];
	return dedupeBooks(
		value.map(normalizeBook).filter((book): book is Book => book !== null),
	);
}

export function dedupeBooks(books: Book[]) {
	const booksById = new Map<string, Book>();
	const booksByIdentity = new Map<string, Book>();

	for (const book of books) {
		const identityKey = getBookIdentityKey(book);
		const existingBook = [
			booksById.get(book.id),
			booksByIdentity.get(identityKey),
		].find((candidate): candidate is Book => Boolean(candidate));
		const nextBook = existingBook
			? pickMoreCompleteBook(existingBook, book)
			: book;

		booksById.set(nextBook.id, nextBook);
		booksByIdentity.set(getBookIdentityKey(nextBook), nextBook);
	}

	return Array.from(new Set(booksByIdentity.values()));
}

function normalizeBook(value: unknown): Book | null {
	if (!isRecord(value)) return null;
	const title = stringOrEmpty(value.title).trim();
	const author = stringOrEmpty(value.author).trim();

	if (!title || !author) return null;

	const status = statuses.includes(value.status as BookStatus)
		? (value.status as BookStatus)
		: "want";
	const progress = normalizeProgress(value.progress);
	const reflection = normalizeReflection(value.reflection);

	return {
		id: stringOrEmpty(value.id) || cryptoFallbackId(title, author),
		title,
		author,
		coverUrl: optionalString(value.coverUrl),
		coverColor: optionalString(value.coverColor) ?? coverColors[0],
		status,
		moodTags: normalizeMoodTags(value.moodTags),
		progress,
		addedAt: normalizeDate(value.addedAt) ?? new Date().toISOString(),
		startedAt: normalizeDate(value.startedAt),
		finishedAt: normalizeDate(value.finishedAt),
		rating: normalizeRating(value.rating),
		reflection,
	};
}

function normalizeMoodTags(value: unknown): MoodTag[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value)].filter((tag): tag is MoodTag =>
		moodTags.includes(tag as MoodTag),
	);
}

function normalizeProgress(value: unknown): Book["progress"] {
	if (!isRecord(value)) return undefined;
	const totalPages = positiveInteger(value.totalPages);
	if (!totalPages) return undefined;
	const currentPage = Math.min(
		positiveInteger(value.currentPage) ?? 0,
		totalPages,
	);
	return { currentPage, totalPages };
}

function normalizeReflection(value: unknown): Book["reflection"] {
	if (!isRecord(value)) return undefined;
	return {
		...emptyReflection,
		feeling: stringOrEmpty(value.feeling),
		quote: stringOrEmpty(value.quote),
		note: stringOrEmpty(value.note),
		wouldReread: value.wouldReread === true,
		giveTo: stringOrEmpty(value.giveTo),
	};
}

function normalizeRating(value: unknown) {
	const rating = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(rating) || rating < 0) return undefined;
	return rating;
}

function normalizeDate(value: unknown) {
	const text = optionalString(value);
	if (!text) return undefined;
	return Number.isNaN(new Date(text).getTime()) ? undefined : text;
}

function positiveInteger(value: unknown) {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number) || number < 0) return undefined;
	return Math.round(number);
}

function optionalString(value: unknown) {
	const text = stringOrEmpty(value).trim();
	return text || undefined;
}

function stringOrEmpty(value: unknown) {
	return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function cryptoFallbackId(title: string, author: string) {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${title}-${author}-${Date.now()}`;
}

function pickMoreCompleteBook(firstBook: Book, secondBook: Book) {
	return getBookScore(secondBook) >= getBookScore(firstBook)
		? { ...firstBook, ...secondBook }
		: { ...secondBook, ...firstBook };
}

function getBookScore(book: Book) {
	return (
		[
			book.coverUrl,
			book.coverColor,
			book.startedAt,
			book.finishedAt,
			book.rating,
			book.reflection?.feeling,
			book.reflection?.quote,
			book.reflection?.note,
			book.progress?.totalPages,
			book.progress?.currentPage,
		].filter(Boolean).length + book.moodTags.length
	);
}

function getBookIdentityKey(book: Book) {
	return `${normalizeBookIdentityText(book.title)}::${normalizeBookIdentityText(book.author)}`;
}

function normalizeBookIdentityText(value: string) {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}
