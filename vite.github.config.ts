import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/frontier/",
  plugins: [
    {
      name: "frontier-static-css",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/app/globals.css") || id.endsWith("\\app\\globals.css")) {
          return code
            .replace('@import "tailwindcss";', "")
            .replace("@import 'tailwindcss';", "");
        }
      },
    },
    react(),
  ],
  build: {
    outDir: "dist-pages",
    emptyOutDir: true,
  },
});
