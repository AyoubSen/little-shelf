import { createFileRoute } from "@tanstack/react-router";
import { LittleShelfApp } from "../components/LittleShelfApp";

export const Route = createFileRoute("/")({ component: LittleShelfApp });
