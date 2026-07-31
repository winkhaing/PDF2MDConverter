import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "katex/dist/katex.min.css";

const title = "PDF2MD Converter — Private PDF to Markdown";
const description =
  "Convert research PDFs into clean, editable Markdown. OCR, two-column reading order, figures, tables, equations, and citations—all processed locally.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const baseUrl = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", baseUrl).href;

  return {
    metadataBase: baseUrl,
    title,
    description,
    applicationName: "PDF2MD Converter",
    manifest: "/manifest.webmanifest",
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "PDF2MD Converter",
      images: [{ url: socialImage, width: 1748, height: 896 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f0e7",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
