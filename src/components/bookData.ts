export const moodTags = [
	"cozy",
	"sad",
	"romantic",
	"smart",
	"weird",
	"easy",
	"heavy",
	"short",
	"hopeful",
	"dark",
	"funny",
	"beautiful",
] as const;

export type MoodTag = (typeof moodTags)[number];
export type BookStatus = "want" | "reading" | "finished" | "paused";

export type Reflection = {
	feeling: string;
	quote: string;
	note: string;
	wouldReread: boolean;
	giveTo?: string;
};

export type Book = {
	id: string;
	title: string;
	author: string;
	coverUrl?: string;
	coverColor?: string;
	status: BookStatus;
	moodTags: MoodTag[];
	progress?: {
		currentPage: number;
		totalPages: number;
	};
	addedAt: string;
	startedAt?: string;
	finishedAt?: string;
	rating?: number;
	reflection?: Reflection;
};

export const statusLabels: Record<BookStatus, string> = {
	reading: "Reading",
	want: "Want",
	finished: "Finished",
	paused: "Paused",
};

export const coverColorOptions = [
	{ name: "Clay", value: "#8b5e4b" },
	{ name: "Wine", value: "#7a3145" },
	{ name: "Moss", value: "#526f5f" },
	{ name: "Ochre", value: "#b08b57" },
	{ name: "Night", value: "#334155" },
	{ name: "Rosewood", value: "#9a6f63" },
];

export const coverColors = coverColorOptions.map((color) => color.value);

export const seedBooks: Book[] = [
	{
		id: "seed-1",
		title: "A Psalm for the Wild-Built",
		author: "Becky Chambers",
		coverColor: "#526f5f",
		status: "reading",
		moodTags: ["cozy", "hopeful", "beautiful", "short"],
		progress: { currentPage: 72, totalPages: 160 },
		addedAt: "2026-01-04T10:00:00.000Z",
		startedAt: "2026-01-08T10:00:00.000Z",
	},
	{
		id: "seed-2",
		title: "Piranesi",
		author: "Susanna Clarke",
		coverColor: "#334155",
		status: "want",
		moodTags: ["weird", "beautiful", "smart", "dark"],
		progress: { currentPage: 0, totalPages: 272 },
		addedAt: "2026-01-02T10:00:00.000Z",
	},
	{
		id: "seed-3",
		title: "Book Lovers",
		author: "Emily Henry",
		coverColor: "#b08b57",
		status: "paused",
		moodTags: ["romantic", "funny", "easy"],
		progress: { currentPage: 118, totalPages: 384 },
		addedAt: "2025-12-14T10:00:00.000Z",
		startedAt: "2025-12-20T10:00:00.000Z",
	},
	{
		id: "seed-4",
		title: "The Remains of the Day",
		author: "Kazuo Ishiguro",
		coverColor: "#7a3145",
		status: "finished",
		moodTags: ["sad", "smart", "beautiful", "heavy"],
		progress: { currentPage: 258, totalPages: 258 },
		addedAt: "2025-11-02T10:00:00.000Z",
		startedAt: "2025-11-08T10:00:00.000Z",
		finishedAt: "2025-11-22T10:00:00.000Z",
		rating: 5,
		reflection: {
			feeling: "Quietly devastated, in the best way.",
			quote: "A life can be dignified and still ache.",
			note: "Give this to someone who likes restraint and regret.",
			wouldReread: true,
			giveTo: "Mina",
		},
	},
];

export const energyMap: Record<string, MoodTag[]> = {
	"soft and easy": ["easy", "short", "funny", "cozy"],
	"hurt a little": ["sad", "romantic", "hopeful", "heavy"],
	"fast and sticky": ["dark", "weird", "funny", "romantic"],
	"beautiful sentences": ["beautiful", "hopeful", "sad", "smart"],
	"strange and smart": ["smart", "heavy", "weird", "beautiful"],
	"surprise me": [...moodTags],
};

export const energyLabels = Object.keys(energyMap);

export const emptyReflection: Reflection = {
	feeling: "",
	quote: "",
	note: "",
	wouldReread: false,
	giveTo: "",
};
