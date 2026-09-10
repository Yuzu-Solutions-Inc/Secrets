"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#fdf2f8",
          color: "#1f2937",
        }}
      >
        <div
          style={{
            maxWidth: "26rem",
            margin: "1.25rem",
            padding: "1.75rem",
            textAlign: "center",
            background: "#fff",
            borderRadius: "1.5rem",
            boxShadow: "0 20px 45px -20px rgba(190, 24, 93, 0.35)",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: 0 }}>
            Cette page n’a pas pu se charger
          </h1>
          <p style={{ marginTop: "0.75rem", color: "#6b7280" }}>
            Un problème est survenu de notre côté. Réessayez dans un instant.
            <br />
            <span style={{ opacity: 0.7 }}>Something went wrong on our side. Try again in a moment.</span>
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: "0.5rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.75rem",
                color: "#9ca3af",
              }}
            >
              {error.digest}
            </p>
          ) : null}
          <button
            onClick={() => retry()}
            style={{
              marginTop: "1.5rem",
              width: "100%",
              padding: "0.75rem 1rem",
              borderRadius: "9999px",
              border: "none",
              fontWeight: 700,
              cursor: "pointer",
              background: "#db2777",
              color: "#fff",
            }}
          >
            Réessayer / Try again
          </button>
        </div>
      </body>
    </html>
  );
}
