import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import ConvexClientProvider from "../components/ConvexClientProvider";
import StoreUser from "../components/StoreUser";
import Header from "../components/Header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LendLoop — neighbourhood tool lending",
  description:
    "Borrow and lend tools with your neighbours. Built with Next.js, Clerk, Convex and n8n.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ClerkProvider>
          <ConvexClientProvider>
            <StoreUser />
            <Header />
            <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
              {children}
            </main>
            <footer className="border-t border-black/10 py-4 text-center text-xs opacity-60 dark:border-white/15">
              LendLoop — a take-home build. Be kind, return tools on time.
            </footer>
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
