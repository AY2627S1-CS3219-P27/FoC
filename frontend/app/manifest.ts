import type { MetadataRoute } from "next";

// Minimal manifest: makes the app installable and enables push notifications
// for installed PWAs (iOS 16.4+ requires home-screen installation).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FoC — Friend on Campus",
    short_name: "FoC",
    description: "Peer-to-peer campus errand platform",
    start_url: "/home",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#003D7C",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
