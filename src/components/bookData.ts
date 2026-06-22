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
