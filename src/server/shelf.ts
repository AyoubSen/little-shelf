import { auth } from "@clerk/tanstack-react-start/server";
import { neon } from "@neondatabase/serverless";
import { createServerFn } from "@tanstack/react-start";

import type { Book } from "../components/bookData";
import { normalizeBooks } from "../components/bookStorage";

type ShelfResult =
	| { ok: true; books: Book[]; updatedAt: string | null }
	| {
			ok: false;
			message: string;
			reason?: "conflict" | "config" | "auth" | "database";
	  };

type SaveShelfInput = {
	books: unknown;
	expectedUpdatedAt?: string | null;
};

type ShelfDiagnosticsResult =
	| {
			ok: true;
			userId: string;
			databaseHost: string;
			databaseName: string;
			bookCount: number;
			updatedAt: string | null;
	  }
	| {
			ok: false;
			message: string;
			reason?: "auth" | "config" | "database";
	  };

const tableName = "little_shelf_shelves";

export const getShelf = createServerFn({ method: "GET" }).handler(
	async (): Promise<ShelfResult> => {
		const userId = await getUserId();
		if (!userId) {
			return {
				ok: false,
				message: "Sign in to sync your shelf.",
				reason: "auth",
			};
		}

		const sql = getDatabase();
		if (!sql) {
			return {
				ok: false,
				message: "Add DATABASE_URL to enable cloud sync.",
				reason: "config",
			};
		}

		try {
			await ensureShelfTable(sql);
			const rows = await sql.query(
				`select books, updated_at from ${tableName} where user_id = $1`,
				[userId],
			);
			const row = rows[0] as
				| { books?: unknown; updated_at?: string | Date | null }
				| undefined;

			return {
				ok: true,
				books: normalizeBooks(row?.books ?? []),
				updatedAt: row?.updated_at
					? new Date(row.updated_at).toISOString()
					: null,
			};
		} catch {
			return {
				ok: false,
				message: "Could not reach the shelf database.",
				reason: "database",
			};
		}
	},
);

export const saveShelf = createServerFn({ method: "POST" })
	.validator(
		(data: SaveShelfInput): SaveShelfInput => ({
			books: data?.books ?? [],
			expectedUpdatedAt: data?.expectedUpdatedAt ?? null,
		}),
	)
	.handler(async ({ data }): Promise<ShelfResult> => {
		const userId = await getUserId();
		if (!userId) {
			return {
				ok: false,
				message: "Sign in to sync your shelf.",
				reason: "auth",
			};
		}

		const sql = getDatabase();
		if (!sql) {
			return {
				ok: false,
				message: "Add DATABASE_URL to enable cloud sync.",
				reason: "config",
			};
		}

		const books = normalizeBooks(data.books);
		const expectedUpdatedAt = data.expectedUpdatedAt ?? null;

		try {
			await ensureShelfTable(sql);

			const rows = expectedUpdatedAt
				? await sql.query(
						`update ${tableName}
						 set books = $2::jsonb, updated_at = now()
						 where user_id = $1 and updated_at = $3::timestamptz
						 returning updated_at`,
						[userId, JSON.stringify(books), expectedUpdatedAt],
					)
				: await sql.query(
						`insert into ${tableName} (user_id, books, updated_at)
						 values ($1, $2::jsonb, now())
						 on conflict (user_id) do nothing
						 returning updated_at`,
						[userId, JSON.stringify(books)],
					);
			const row = rows[0] as { updated_at?: string | Date | null } | undefined;

			if (!row) {
				return {
					ok: false,
					message: "Cloud shelf changed. Sync again before saving.",
					reason: "conflict",
				};
			}

			return {
				ok: true,
				books,
				updatedAt: row.updated_at
					? new Date(row.updated_at).toISOString()
					: null,
			};
		} catch {
			return {
				ok: false,
				message: "Could not save to the shelf database.",
				reason: "database",
			};
		}
	});

export const getShelfDiagnostics = createServerFn({ method: "GET" }).handler(
	async (): Promise<ShelfDiagnosticsResult> => {
		const userId = await getUserId();
		if (!userId) {
			return {
				ok: false,
				message: "Sign in to inspect cloud sync.",
				reason: "auth",
			};
		}

		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) {
			return {
				ok: false,
				message: "DATABASE_URL is missing.",
				reason: "config",
			};
		}

		try {
			const databaseInfo = getDatabaseInfo(databaseUrl);
			const sql = neon(databaseUrl);
			await ensureShelfTable(sql);
			const rows = await sql.query(
				`select jsonb_array_length(books) as book_count, updated_at
				 from ${tableName}
				 where user_id = $1`,
				[userId],
			);
			const row = rows[0] as
				| { book_count?: number | string; updated_at?: string | Date | null }
				| undefined;

			return {
				ok: true,
				userId,
				databaseHost: databaseInfo.host,
				databaseName: databaseInfo.name,
				bookCount: row?.book_count ? Number(row.book_count) : 0,
				updatedAt: row?.updated_at
					? new Date(row.updated_at).toISOString()
					: null,
			};
		} catch {
			return {
				ok: false,
				message: "Could not inspect the shelf database.",
				reason: "database",
			};
		}
	},
);

async function getUserId() {
	const authState = await auth();
	return authState.isAuthenticated ? authState.userId : null;
}

function getDatabase() {
	const databaseUrl = process.env.DATABASE_URL;
	return databaseUrl ? neon(databaseUrl) : null;
}

function getDatabaseInfo(databaseUrl: string) {
	const url = new URL(databaseUrl);
	return {
		host: url.host,
		name: url.pathname.replace(/^\//, "") || "unknown",
	};
}

async function ensureShelfTable(sql: ReturnType<typeof neon>) {
	await sql.query(`create table if not exists ${tableName} (
		user_id text primary key,
		books jsonb not null default '[]'::jsonb,
		updated_at timestamptz not null default now()
	)`);
}
