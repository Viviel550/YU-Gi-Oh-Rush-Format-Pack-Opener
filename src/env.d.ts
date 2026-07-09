type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {}
}

interface Env {
	BACKEND_URL: string;
	YGO_KV: KVNamespace;
	IMAGES_DB: string;
	PACKS_DB: string;
}
