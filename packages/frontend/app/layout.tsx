import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Covenant — Behavioral Vesting Engine for FlowVault",
  description:
    "Adaptive lock/split/hold routing rules that tighten or loosen automatically based on on-chain behavior. Compiled from plain English. Built for FlowVault on Stacks testnet.",
  keywords: [
    "FlowVault", "Stacks", "behavioral vesting", "adaptive routing",
    "treasury automation", "payroll", "DeFi", "smart contracts"
  ],
  openGraph: {
    title: "Covenant — Behavioral Vesting Engine for FlowVault",
    description: "One engine. Four bounty categories. Routing rules that adapt to behavior.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        <div className="app-wrapper">
          {children}
        </div>
      </body>
    </html>
  );
}
