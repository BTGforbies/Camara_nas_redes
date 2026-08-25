import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Câmara nas Redes - Análise de Propostas",
  description:
    "Sistema para análise automatizada de propostas em CSV ou Excel, revisão dos resultados e geração de relatório em PDF.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
