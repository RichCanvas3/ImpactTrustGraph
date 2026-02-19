import type { Metadata } from "next";
import dynamic from "next/dynamic";
import * as React from "react";
import { Providers } from "./providers";

const Web3AuthProvider = dynamic(
  () =>
    import("../components/Web3AuthProvider").then(
      (mod) => mod.Web3AuthProvider
    ),
  { ssr: false }
);

const WalletProvider = dynamic(
  () =>
    import("../components/WalletProvider").then((mod) => mod.WalletProvider),
  { ssr: false }
);

export const metadata: Metadata = {
  title: "ATN App",
  description: "ATN Next.js application in the itg monorepo."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Web3AuthProvider>
          <WalletProvider>
            <Providers>{children}</Providers>
          </WalletProvider>
        </Web3AuthProvider>
      </body>
    </html>
  );
}

