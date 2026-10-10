import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything runs in the browser; no server-side data fetching. Static export keeps hosting trivial.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // pdfjs / tesseract ship their own workers; keep them out of server bundling
  serverExternalPackages: ["pdfjs-dist", "tesseract.js"],
};

export default nextConfig;
