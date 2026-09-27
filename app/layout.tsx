import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "IDV Control Center", template: "%s · IDV Control Center" },
  description: "Motor IDV deviation workflow — underwriting operations console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={cn("font-sans antialiased", geist.variable, geistMono.variable)}>
      <body>
        {/* Route-change bar. Nav bars are a timed estimate by nature (no byte-level progress for RSC navigations);
            real per-section progress lives in <SectionProgress>. */}
        <NextTopLoader color="var(--primary)" height={2} showSpinner={false} shadow="0 0 6px var(--primary)" />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
