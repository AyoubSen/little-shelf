import { describe, expect, it } from "vitest";

import {
	backupVersion,
	dedupeBooks,
	parseBooksJson,
	serializeShelfBackup,
} from "./bookStorage";

const rawBook = {
	id: "book-1",
	title: "A Wizard of Earthsea",
	author: "Ursula K. Le Guin",
	status: "reading",
	moodTags: ["smart", "beautiful", "not-a-tag"],
	progress: { currentPage: 44, totalPages: 180 },
	addedAt: "2026-01-01T00:00:00.000Z",
};

describe("bookStorage", () => {
	it("loads the existing raw array format", () => {
		const result = parseBooksJson(JSON.stringify([rawBook]));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.books).toHaveLength(1);
		expect(result.books[0]).toMatchObject({
			title: "A Wizard of Earthsea",
			author: "Ursula K. Le Guin",
			status: "reading",
			moodTags: ["smart", "beautiful"],
		});
	});

	it("loads the backup wrapper format", () => {
		const result = parseBooksJson(
			JSON.stringify({
				app: "little-shelf",
				version: backupVersion,
				exportedAt: "2026-01-02T00:00:00.000Z",
				books: [rawBook],
			}),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.books[0]?.title).toBe("A Wizard of Earthsea");
	});

	it("rejects invalid JSON", () => {
		const result = parseBooksJson("not json");

		expect(result.ok).toBe(false);
	});

	it("normalizes invalid fields safely", () => {
		const result = parseBooksJson(
			JSON.stringify([
				{
					title: "  Piranesi  ",
					author: "Susanna Clarke",
					status: "missing",
					moodTags: ["weird", "fake"],
					progress: { currentPage: 999, totalPages: 245 },
					addedAt: "not a date",
				},
			]),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.books[0]).toMatchObject({
			title: "Piranesi",
			status: "want",
			moodTags: ["weird"],
			progress: { currentPage: 245, totalPages: 245 },
		});
		expect(
			Number.isNaN(new Date(result.books[0]?.addedAt ?? "").getTime()),
		).toBe(false);
	});

	it("serializes an importable backup", () => {
		const serialized = serializeShelfBackup([rawBook]);
		const result = parseBooksJson(serialized);

		expect(result.ok).toBe(true);
	});

	it("does not duplicate unique books while deduping", () => {
		const books = dedupeBooks([
			{
				...rawBook,
				moodTags: ["smart"],
				status: "want",
			},
			{
				...rawBook,
				id: "book-2",
				title: "Piranesi",
				author: "Susanna Clarke",
				moodTags: ["weird"],
				status: "finished",
			},
		]);

		expect(books).toHaveLength(2);
	});

	it("dedupes the same title and author with different ids", () => {
		const books = dedupeBooks([
			{
				...rawBook,
				id: "atomic-1",
				title: "Atomic Habits",
				author: "James Clear",
				moodTags: [],
				status: "finished",
			},
			{
				...rawBook,
				id: "atomic-2",
				title: "Atomic Habits",
				author: "James Clear",
				coverUrl: "https://example.com/cover.jpg",
				moodTags: ["smart"],
				status: "finished",
			},
		]);

		expect(books).toHaveLength(1);
		expect(books[0]?.coverUrl).toBe("https://example.com/cover.jpg");
	});
});
