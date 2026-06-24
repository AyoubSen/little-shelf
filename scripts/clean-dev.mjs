import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { platform } from "node:os";

for (const path of [".output", "node_modules/.nitro"]) {
	rmSync(path, { force: true, recursive: true });
}

if (platform() === "win32") {
	const command = [
		"$connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue;",
		"$connections | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
	].join(" ");

	execFileSync("powershell.exe", ["-NoProfile", "-Command", command], {
		stdio: "ignore",
	});
}
