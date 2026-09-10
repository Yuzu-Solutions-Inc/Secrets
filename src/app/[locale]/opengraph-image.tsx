import { ImageResponse } from "next/og";
import { getTranslations, setRequestLocale } from "next-intl/server";

// Social share card — Next wires this into og:image and twitter:image.
export const alt = "Secrets — a realtime party game of secrets, clues and missions";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function siteHost() {
  try {
    return new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    ).host;
  } catch {
    return "secrets";
  }
}

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #eb2f96, #7c3aed)",
          padding: "72px 80px",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 72,
              height: 72,
              borderRadius: 999,
              background: "rgba(255,255,255,0.16)",
            }}
          >
            <svg
              width="42"
              height="42"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-0.03em" }}>
            {t("brand")}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              color: "rgba(255,255,255,0.75)",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            {t("landing.eyebrow")}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 66,
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              maxWidth: 1000,
            }}
          >
            {t("landing.meta.title")}
          </div>
        </div>

        <div style={{ display: "flex", color: "rgba(255,255,255,0.7)", fontSize: 24 }}>
          {siteHost()}
        </div>
      </div>
    ),
    size,
  );
}
