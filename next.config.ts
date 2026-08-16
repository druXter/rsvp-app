import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Gilt für alle Routen auf der ersten Ebene (deine Event-Slugs)
        source: '/:slug',
        headers: [
          {
            key: 'Content-Security-Policy',
            // Erlaubt das Einbinden als iFrame auf allen Domains (*).
            // Für mehr Sicherheit kannst du '*' durch die URL deines CMS ersetzen.
            value: "frame-ancestors *;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;